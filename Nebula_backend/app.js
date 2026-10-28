import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAnalyzeRouter } from "./routes/analyze.js";
import { createExploreRouter } from "./routes/explore.js";
import { createInsightsRouter } from "./routes/insights.js";
import { NebulaError, errorMiddleware } from "./services/errors.js";
import { config } from "./services/config.js";

const mockGraphPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/mock-graph.json");

export function createApp(options = {}) {
  const app = express();

  app.use(cors({ origin: config.CORS_ORIGIN }));
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
  app.use("/api", createExploreRouter(options));
  app.use("/api", createInsightsRouter(options));
  app.use("/api", (_request, _response, next) => {
    next(new NebulaError("UNKNOWN_ROUTE"));
  });
  app.use(errorMiddleware({ logger: options.errorLogger ?? console.error }));

  return app;
}

export const app = createApp();
export default app;
