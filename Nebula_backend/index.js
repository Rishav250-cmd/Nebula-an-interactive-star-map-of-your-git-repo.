import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

const app = createApp();
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Nebula backend listening on port ${port}`);
  });
}

export default app;
