import "dotenv/config";
import cors from "cors";
import compression from "compression";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createAnalyzeRouter } from "./routes/analyze.js";
import { createExploreRouter } from "./routes/explore.js";
import { createInsightsRouter } from "./routes/insights.js";
import { NebulaError, errorMiddleware } from "./services/errors.js";
import { config } from "./services/config.js";
import { createIpRateLimiter } from "./services/limiter.js";
import { getAnalysis, getRepositoryCount } from "./services/store.js";
import { repoIdFor } from "./services/ingest.js";
import { createJobLimiter } from "./services/limiter.js";

const mockGraphPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/mock-graph.json");
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export function createApp(options = {}) {
  const app = express();
  const startedAt = Date.now();
  const jobLimiter = options.jobLimiter ?? createJobLimiter();
  const origins = String(options.corsOrigin ?? config.CORS_ORIGIN).split(",").map((origin) => origin.trim()).filter(Boolean);

  if (process.env.NODE_ENV === "production" && origins.includes("*"))
    console.warn("CORS_ORIGIN is '*'; all origins are allowed in production");

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(compression());
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || origins.includes("*") || origins.includes(origin)) }));
  app.use((request, response, next) => {
    const started = process.hrtime.bigint();
    response.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const requestPath = (request.originalUrl ?? request.path).split("?", 1)[0];
      console.log(`${request.method} ${requestPath} ${response.statusCode} ${durationMs.toFixed(1)}ms`);
    });
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  const requestRateLimiter = options.requestRateLimiter ?? createIpRateLimiter({
    maxRequests: options.rateLimitMax ?? config.RATE_LIMIT_MAX,
    windowMs: options.rateLimitWindowMs ?? config.RATE_LIMIT_WINDOW_MS,
    now: options.rateLimitNow ?? Date.now,
    shouldSkip: (request) => {
      const url = request.body?.url;
      if (typeof url !== "string") return false;
      const repository = getAnalysis(repoIdFor(url));
      return Boolean(repository?.graph && repository.job?.status === "ready");
    },
  });
  app.post("/api/analyze", requestRateLimiter, (_request, _response, next) => next());
  app.post("/api/upload", requestRateLimiter, (_request, _response, next) => next());

  app.get("/api/ping", (_request, response) => {
    const queue = jobLimiter.getState();
    response.json({
      ok: true,
      version: packageJson.version,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024 * 10) / 10,
      repos: getRepositoryCount(),
      queue: { running: queue.active, waiting: queue.queued + queue.reserved },
      limits: {
        maxCodeFiles: config.MAX_CODE_FILES,
        maxRepoMb: config.MAX_REPO_MB,
        maxConcurrentJobs: config.MAX_CONCURRENT_JOBS,
      },
    });
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/mock-graph", (_request, response) => {
    response.sendFile(mockGraphPath);
  });

  app.use("/api", createAnalyzeRouter({ ...options, jobLimiter }));
  app.use("/api", createExploreRouter(options));
  app.use("/api", createInsightsRouter(options));
  app.use("/api", (_request, _response, next) => {
    next(new NebulaError("UNKNOWN_ROUTE"));
  });
  app.use(errorMiddleware({ logger: options.errorLogger ?? (() => {}) }));

  return app;
}

export const app = createApp();
export default app;
