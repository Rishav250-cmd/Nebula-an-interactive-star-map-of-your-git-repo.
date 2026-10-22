import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAnalyzeRouter } from "./routes/analyze.js";

const mockGraphPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/mock-graph.json");

export function createApp(options = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/ping", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/mock-graph", (_request, response) => {
    response.sendFile(mockGraphPath);
  });

  app.use("/api", createAnalyzeRouter(options));

  return app;
}

export const app = createApp();
export default app;
