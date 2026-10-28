import assert from "node:assert/strict";
import test from "node:test";
import { fetchGoodFirstIssues, parseGitHubRepo } from "../services/github.js";

test("parseGitHubRepo returns owner and repo for supported URLs", () => {
  assert.deepEqual(
    parseGitHubRepo("https://github.com/octocat/hello-world.git"),
    { owner: "octocat", repo: "hello-world" },
  );
  assert.equal(parseGitHubRepo("https://github.com/octocat"), null);
  assert.equal(parseGitHubRepo("https://github.com.evil.test/a/b"), null);
});

test("fetchGoodFirstIssues deduplicates labels and removes pull requests", async () => {
  const first = [
    issue(1, { labels: ["good first issue"] }),
    issue(2, { pull_request: {} }),
  ];
  const second = [issue(1, { labels: ["beginner"] }), issue(3)];
  let calls = 0;
  const response = await fetchGoodFirstIssues("octocat", "dedupe", {
    token: "secret-test-token",
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(new URL(url).searchParams.get("state"), "open");
      assert.equal(new URL(url).searchParams.get("per_page"), "30");
      assert.equal(options.headers.Accept, "application/vnd.github+json");
      assert.equal(options.headers["User-Agent"], "Nebula-App");
      assert.equal(options.headers["X-GitHub-Api-Version"], "2022-11-28");
      assert.equal(options.headers.Authorization, "Bearer secret-test-token");
      return jsonResponse(calls === 1 ? first : second);
    },
  });
  assert.equal(response.status, "ok");
  assert.equal(calls, 5);
  assert.deepEqual(
    response.issues.map(({ number }) => number),
    [1, 3],
  );
  assert.deepEqual(response.issues[0], {
    number: 1,
    title: "Issue 1",
    url: "https://github.com/octocat/repo/issues/1",
    labels: ["good first issue"],
    body: "body",
    comments: 2,
    createdAt: "2024-01-01T00:00:00Z",
  });
});

test("fetchGoodFirstIssues returns none when no matching issues exist", async () => {
  let calls = 0;
  const response = await fetchGoodFirstIssues("octocat", "none", {
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse([]);
    },
  });
  assert.equal(response.status, "none");
  assert.deepEqual(response.issues, []);
  assert.equal(calls, 5);
});

test("fetchGoodFirstIssues reports rate limiting with reset time", async () => {
  const response = await fetchGoodFirstIssues("octocat", "limited", {
    fetchImpl: async () =>
      responseWith(403, null, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "2000000000",
      }),
  });
  assert.equal(response.status, "rate_limited");
  assert.equal(response.resetAt, 2_000_000_000_000);
});

test("fetchGoodFirstIssues reports missing repositories", async () => {
  const response = await fetchGoodFirstIssues("octocat", "missing", {
    fetchImpl: async () => responseWith(404),
  });
  assert.equal(response.status, "not_found");
});

test("fetchGoodFirstIssues contains network errors and omits absent auth", async () => {
  const response = await fetchGoodFirstIssues("octocat", "network", {
    token: "",
    fetchImpl: async (_url, options) => {
      assert.equal(Object.hasOwn(options.headers, "Authorization"), false);
      throw new Error("network unavailable");
    },
  });
  assert.equal(response.status, "unavailable");
});

test("fetchGoodFirstIssues times out and never throws", async () => {
  const response = await fetchGoodFirstIssues("octocat", "timeout", {
    fetchImpl: (_url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  });
  assert.equal(response.status, "unavailable");
});

test("fetchGoodFirstIssues recognizes retry-after rate limits", async () => {
  const response = await fetchGoodFirstIssues("octocat", "retry", {
    fetchImpl: async () => responseWith(429, null, { "retry-after": "30" }),
  });
  assert.equal(response.status, "rate_limited");
  assert.equal(response.resetAt, null);
});

test("fetchGoodFirstIssues caches results for ten minutes", async () => {
  let clock = 1000;
  let calls = 0;
  const options = {
    now: () => clock,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse([]);
    },
  };
  await fetchGoodFirstIssues("octocat", "cache-success", options);
  await fetchGoodFirstIssues("octocat", "cache-success", options);
  assert.equal(calls, 5);
  clock += 10 * 60 * 1000 + 1;
  await fetchGoodFirstIssues("octocat", "cache-success", options);
  assert.equal(calls, 10);
});

test("fetchGoodFirstIssues stops after collecting twenty distinct issues", async () => {
  let calls = 0;
  const response = await fetchGoodFirstIssues("octocat", "limit", {
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse(
        Array.from({ length: 25 }, (_, index) => issue(index + 1)),
      );
    },
  });
  assert.equal(response.status, "ok");
  assert.equal(response.issues.length, 20);
  assert.equal(calls, 1);
});

function issue(number, overrides = {}) {
  return {
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/octocat/repo/issues/${number}`,
    labels: [{ name: "good first issue" }],
    body: "body",
    comments: 2,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function jsonResponse(value) {
  return responseWith(200, value);
}

function responseWith(status, value = null, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => value,
  };
}
