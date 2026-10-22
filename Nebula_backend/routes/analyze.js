import express from "express";
import { buildGraph } from "../services/analyzeService.js";
import { cloneRepo, listFiles } from "../services/ingest.js";
import { cacheAnalysisGraph, getAnalysis, storeAnalysis } from "../services/store.js";
import { GraphError } from "../src/graph.js";

const githubRepositoryUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/;

export function createAnalyzeRouter({
  cloneRepoImpl = cloneRepo,
  listFilesImpl = listFiles,
  buildGraphImpl = buildGraph,
  getAnalysisImpl = getAnalysis,
  storeAnalysisImpl = storeAnalysis,
  cacheAnalysisGraphImpl = cacheAnalysisGraph,
} = {}) {
  const router = express.Router();

  router.post("/analyze", async (request, response) => {
    const { url } = request.body ?? {};
    if (!isValidRepositoryUrl(url)) return response.status(400).json({ error: "Invalid GitHub URL" });

    try {
      const repository = await cloneAndBuild(url);
      storeAnalysisImpl(repository);
      return response.status(200).json({ id: repository.id, status: "ready" });
    } catch (error) {
      return sendPipelineError(response, error);
    }
  });

  router.post("/graph", async (request, response) => {
    const { url } = request.body ?? {};
    if (!isValidRepositoryUrl(url)) return response.status(400).json({ error: "Invalid GitHub URL" });

    try {
      const repository = await cloneAndBuild(url);
      storeAnalysisImpl(repository);
      return response.status(200).json({ ...repository.graph, id: repository.id });
    } catch (error) {
      return sendPipelineError(response, error);
    }
  });

  router.get("/graph/:id", async (request, response) => {
    const analysis = getAnalysisImpl(request.params.id);
    if (!analysis) return response.status(404).json({ error: "Unknown repository id" });

    if (!analysis.graph) {
      try {
        analysis.graph = await buildGraphForRepository(analysis);
        cacheAnalysisGraphImpl(analysis.id, analysis.graph);
      } catch (error) {
        return sendPipelineError(response, error);
      }
    }

    return response.status(200).json(analysis.graph);
  });

  async function cloneAndBuild(url) {
    let clonedRepository;
    try {
      clonedRepository = await cloneRepoImpl(url);
    } catch (error) {
      throw new RepositoryPipelineError("clone", error);
    }

    const repository = {
      id: clonedRepository.id,
      dir: clonedRepository.dir,
      url,
      graph: null,
    };
    repository.graph = await buildGraphForRepository(repository);
    return repository;
  }

  async function buildGraphForRepository(repository) {
    try {
      const files = await listFilesImpl(repository.dir);
      return await buildGraphImpl({
        id: repository.id,
        dir: repository.dir,
        files,
        repoUrl: repository.url,
      });
    } catch (error) {
      throw new RepositoryPipelineError("build", error);
    }
  }

  return router;
}

function isValidRepositoryUrl(url) {
  return typeof url === "string" && githubRepositoryUrl.test(url);
}

function sendPipelineError(response, error) {
  const cause = error instanceof RepositoryPipelineError ? error.cause : error;
  if (cause instanceof GraphError) return response.status(cause.statusCode).json({ error: cause.message });

  if (error instanceof RepositoryPipelineError && error.stage === "clone") {
    console.error("Repository clone failed:", cause?.message ?? String(cause));
    return response.status(500).json({ error: "Could not clone repo (private or not found?)" });
  }

  console.error("Repository graph build failed:", cause?.message ?? String(cause));
  return response.status(500).json({ error: "Could not build repository graph." });
}

class RepositoryPipelineError extends Error {
  constructor(stage, cause) {
    super(`Repository ${stage} failed`, { cause });
    this.name = "RepositoryPipelineError";
    this.stage = stage;
  }
}
