import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import test from "node:test";
import { NebulaError, errorMiddleware } from "../services/errors.js";
import { createApp } from "../app.js";

test("structured error middleware returns a safe production response and Retry-After", async () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const logged = [];
  const app = express();
  app.get("/limited", () => {
    throw new NebulaError("RATE_LIMITED", { retryAfter: 23 });
  });
  app.get("/failed", () => {
    throw new Error("internal failure at /private/server/path");
  });
  app.use(errorMiddleware({ logger: (...args) => logged.push(args) }));

  try {
    await withServer(app, async (baseUrl) => {
      const limited = await fetch(`${baseUrl}/limited`);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "23");
      assert.deepEqual(await limited.json(), {
        error: "GitHub API rate limit exceeded",
        code: "RATE_LIMITED",
        hint: "Try again after the rate limit resets.",
        details: null,
      });

      const failed = await fetch(`${baseUrl}/failed`);
      const body = await failed.json();
      assert.equal(failed.status, 500);
      assert.deepEqual(Object.keys(body).sort(), ["code", "details", "error", "hint"]);
      assert.equal(body.code, "INTERNAL");
      assert.equal(body.error, "An internal error occurred");
      assert.equal(JSON.stringify(body).includes("stack"), false);
      assert.equal(JSON.stringify(body).includes("/private/server/path"), false);
      assert.ok(logged.length >= 2);
      assert.match(String(logged[1][1]), /\/private\/server\/path/);
    });
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});

test("unknown API routes use the structured JSON 404 handler", async () => {
  await withServer(createApp({ errorLogger: () => {} }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/not-a-route`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: "API endpoint not found",
      code: "UNKNOWN_ROUTE",
      hint: "Check the API route and try again.",
      details: null,
    });
  });
});

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}
