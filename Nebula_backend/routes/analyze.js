import express from "express";
import multer from "multer";
import { rm } from "node:fs/promises";
import { buildGraph } from "../services/analyzeService.js";
import { extractZipArchive, ZipArchiveError } from "../services/archive.js";
import {
  buildTree,
  cloneLocationForUrl,
  cloneRepo,
  listFiles,
} from "../services/ingest.js";
import { buildCallGraph } from "../services/callgraph.js";
import { computeBlast } from "../services/blast.js";
import { fetchGoodFirstIssues, parseGitHubRepo } from "../services/github.js";
import { buildOnboarding } from "../services/onboarding.js";
import { loadAnalysisCache, saveAnalysisCache } from "../services/cache.js";
import { getHeadSha, getRemoteHeadSha } from "../services/git.js";
import {
  cacheAnalysisGraph,
  getAnalysis,
  storeAnalysis,
} from "../services/store.js";
import { GraphError } from "../src/graph.js";

const githubRepositoryUrl =
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/;
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 0 },
});

export function createAnalyzeRouter({
  cloneRepoImpl = cloneRepo,
  cloneLocationForUrlImpl = cloneLocationForUrl,
  getRemoteShaImpl = getRemoteHeadSha,
  getHeadShaImpl = getHeadSha,
  loadAnalysisCacheImpl = loadAnalysisCache,
  saveAnalysisCacheImpl = saveAnalysisCache,
  parseFileImpl,
  listFilesImpl = listFiles,
  buildGraphImpl = buildGraph,
  getAnalysisImpl = getAnalysis,
  storeAnalysisImpl = storeAnalysis,
  cacheAnalysisGraphImpl = cacheAnalysisGraph,
  fetchGoodFirstIssuesImpl = fetchGoodFirstIssues,
  buildOnboardingImpl = buildOnboarding,
} = {}) {
  const router = express.Router();

  router.post("/analyze", async (request, response) => {
    const { url } = request.body ?? {};
    if (!isValidRepositoryUrl(url))
      return response.status(400).json({ error: "Invalid GitHub URL" });

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
    if (!isValidRepositoryUrl(url))
      return response.status(400).json({ error: "Invalid GitHub URL" });

    try {
      const repository = await cloneAndBuild(url);
      storeAnalysisImpl(repository);
      return response
        .status(200)
        .json({ ...repository.graph, id: repository.id });
    } catch (error) {
      return sendPipelineError(response, error);
    }
  });

  router.post("/upload", runZipUpload, async (request, response) => {
    if (!request.file) {
      return response
        .status(400)
        .json({ error: "A ZIP file is required in the 'file' field." });
    }

    const fileName = request.file.originalname.split(/[\\/]/).at(-1) || "";
    if (!fileName.toLowerCase().endsWith(".zip")) {
      return response
        .status(400)
        .json({ error: "Only .zip files are accepted." });
    }

    let extracted;
    try {
      extracted = await extractZipArchive(request.file.buffer);
      const files = await listFilesImpl(extracted.dir);
      const tree = buildTree(files);
      storeAnalysisImpl({
        id: extracted.id,
        dir: extracted.dir,
        url: fileName,
        graph: null,
      });
      return response.status(200).json({
        id: extracted.id,
        status: "done",
        fileCount: files.length,
        files,
        tree,
      });
    } catch (error) {
      if (extracted?.dir)
        await rm(extracted.dir, { recursive: true, force: true });
      if (error instanceof ZipArchiveError) {
        return response.status(error.statusCode).json({ error: error.message });
      }
      console.error(
        "Repository upload failed:",
        error?.message ?? String(error),
      );
      return response
        .status(500)
        .json({ error: "Could not process uploaded repository." });
    }
  });

  router.get("/graph/:id", async (request, response) => {
    const analysis = getAnalysisImpl(request.params.id);
    if (!analysis)
      return response.status(404).json({ error: "Unknown repository id" });

    try {
      await ensureGraphAnalysis(analysis);
    } catch (error) {
      return sendPipelineError(response, error);
    }

    return response.status(200).json(analysis.graph);
  });

  router.get("/callgraph", async (request, response) => {
    const { id, path: filePath, depth: rawDepth } = request.query;
    if (typeof id !== "string" || id === "")
      return response
        .status(400)
        .json({ error: "The 'id' query parameter is required" });
    if (typeof filePath !== "string" || filePath === "")
      return response
        .status(400)
        .json({ error: "The 'path' query parameter is required" });
    if (rawDepth !== undefined && rawDepth !== "1" && rawDepth !== "2")
      return response.status(400).json({ error: "Depth must be 1 or 2" });

    const analysis = getAnalysisImpl(id);
    if (!analysis)
      return response.status(404).json({ error: "Unknown repository id" });

    try {
      await ensureGraphAnalysis(analysis);
      if (!Object.hasOwn(analysis.analysis?.files ?? {}, filePath))
        return response
          .status(404)
          .json({ error: "Path is not an analyzed code file" });

      const callGraph = buildCallGraph(
        analysis.analysis,
        analysis.graph,
        filePath,
        {
          depth: rawDepth === "2" ? 2 : 1,
        },
      );
      return response.status(200).json(callGraph);
    } catch (error) {
      return sendPipelineError(response, error);
    }
  });

  router.get("/blast", async (request, response) => {
    const { id, path: filePath, depth: rawDepth } = request.query;
    if (typeof filePath !== "string" || filePath === "")
      return response
        .status(400)
        .json({ error: "The 'path' query parameter is required" });
    if (typeof id !== "string" || id === "")
      return response
        .status(400)
        .json({ error: "The 'id' query parameter is required" });
    if (
      rawDepth !== undefined &&
      (typeof rawDepth !== "string" || !/^[1-6]$/.test(rawDepth))
    ) {
      return response
        .status(400)
        .json({ error: "Depth must be an integer from 1 to 6" });
    }

    const analysis = getAnalysisImpl(id);
    if (!analysis)
      return response.status(404).json({ error: "Unknown repository id" });

    try {
      await ensureGraphAnalysis(analysis);
      const nodes = analysis.graph?.nodes ?? [];
      if (!nodes.some((node) => node.id === filePath))
        return response.status(404).json({ error: "Path is not a graph node" });

      const blast = computeBlast(analysis.analysis?.reverseIndex, filePath, {
        maxDepth: rawDepth === undefined ? 4 : Number(rawDepth),
      });
      const totalFiles = nodes.length;
      return response.status(200).json({
        ...blast,
        totalFiles,
        percentOfRepo:
          totalFiles === 0
            ? 0
            : Math.round((blast.count / totalFiles) * 1000) / 10,
      });
    } catch (error) {
      return sendPipelineError(response, error);
    }
  });

  router.get("/onboarding/:id", async (request, response) => {
    const repository = getAnalysisImpl(request.params.id);
    if (!repository)
      return response.status(404).json({ error: "Unknown repository id" });

    if (
      repository.onboardingCache &&
      repository.onboardingCache.expiresAt > Date.now()
    ) {
      return response.status(200).json(repository.onboardingCache.response);
    }

    try {
      await ensureGraphAnalysis(repository);
      let issueResult = { status: "none", issues: [], resetAt: null };
      const parsedRepo = parseGitHubRepo(repository.url);
      if (parsedRepo) {
        try {
          issueResult = await fetchGoodFirstIssuesImpl(
            parsedRepo.owner,
            parsedRepo.repo,
          );
        } catch {
          issueResult = { status: "unavailable", issues: [], resetAt: null };
        }
      }
      const onboarding = buildOnboardingImpl({
        graph: repository.graph,
        analysis: repository.analysis,
        issues: Array.isArray(issueResult?.issues) ? issueResult.issues : [],
      });
      const result = {
        ...onboarding,
        issuesStatus: issueResult?.status ?? "unavailable",
        issuesResetAt: issueResult?.resetAt ?? null,
      };
      repository.onboardingCache = {
        response: result,
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      return response.status(200).json(result);
    } catch (error) {
      return sendPipelineError(response, error);
    }
  });

  async function cloneAndBuild(url) {
    let remoteSha = null;
    try {
      remoteSha = await getRemoteShaImpl(url);
    } catch (error) {
      console.warn(
        "Could not check remote repository SHA:",
        error?.message ?? String(error),
      );
    }

    const remoteCache = remoteSha ? await loadCache(url, remoteSha) : null;
    if (remoteCache) {
      const previousClone = cloneLocationForUrlImpl(url);
      try {
        const previousSha = await getHeadShaImpl(previousClone.dir);
        if (previousSha === remoteSha) {
          return {
            id: previousClone.id,
            dir: previousClone.dir,
            url,
            graph: remoteCache.graph,
            analysis: remoteCache.analysis,
          };
        }
      } catch {
        // A missing or stale checkout simply means the request must clone.
      }
    }

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
      analysis: null,
    };

    let clonedSha = clonedRepository.sha ?? null;
    if (!clonedSha) {
      try {
        clonedSha = await getHeadShaImpl(clonedRepository.dir);
      } catch {
        // The graph builder may still provide a snapshot SHA for test doubles.
      }
    }

    const cloneCache =
      clonedSha === remoteSha
        ? remoteCache
        : clonedSha
          ? await loadCache(url, clonedSha)
          : null;
    if (cloneCache) {
      repository.graph = cloneCache.graph;
      repository.analysis = cloneCache.analysis;
      return repository;
    }

    const built = await buildGraphForRepository(repository);
    repository.graph = built.graph;
    repository.analysis = built.analysis;
    const builtSha = clonedSha ?? built.graph?.sha;
    if (builtSha) {
      try {
        await saveAnalysisCacheImpl({
          repo: url,
          sha: builtSha,
          graph: built.graph,
          analysis: built.analysis,
        });
      } catch (error) {
        console.error(
          "Analysis cache write failed:",
          error?.message ?? String(error),
        );
      }
    }
    return repository;
  }

  async function loadCache(url, sha) {
    try {
      return await loadAnalysisCacheImpl(url, sha);
    } catch (error) {
      console.error(
        "Analysis cache read failed:",
        error?.message ?? String(error),
      );
      return null;
    }
  }

  async function buildGraphForRepository(repository) {
    try {
      const files = await listFilesImpl(repository.dir);
      const buildOptions = {
        id: repository.id,
        dir: repository.dir,
        files,
        repoUrl: repository.url,
      };
      if (parseFileImpl) buildOptions.parseFileImpl = parseFileImpl;
      return await buildGraphImpl(buildOptions);
    } catch (error) {
      throw new RepositoryPipelineError("build", error);
    }
  }

  async function ensureGraphAnalysis(analysis) {
    if (analysis.graph && analysis.analysis) return;

    const built = await buildGraphForRepository(analysis);
    analysis.graph = built.graph;
    analysis.analysis = built.analysis;
    cacheAnalysisGraphImpl(analysis.id, built.graph, built.analysis);
  }

  return router;
}

function runZipUpload(request, response, next) {
  uploadZip.single("file")(request, response, (error) => {
    if (!error) return next();
    if (
      error instanceof multer.MulterError &&
      error.code === "LIMIT_FILE_SIZE"
    ) {
      return response
        .status(413)
        .json({ error: "ZIP upload exceeds the 50 MB limit." });
    }
    return response
      .status(400)
      .json({ error: "Upload exactly one file in the 'file' field." });
  });
}

function isValidRepositoryUrl(url) {
  return typeof url === "string" && githubRepositoryUrl.test(url);
}

function sendPipelineError(response, error) {
  const cause = error instanceof RepositoryPipelineError ? error.cause : error;
  if (cause instanceof GraphError)
    return response.status(cause.statusCode).json({ error: cause.message });

  if (error instanceof RepositoryPipelineError && error.stage === "clone") {
    console.error("Repository clone failed:", cause?.message ?? String(cause));
    return response
      .status(500)
      .json({ error: "Could not clone repo (private or not found?)" });
  }

  console.error(
    "Repository graph build failed:",
    cause?.message ?? String(cause),
  );
  return response
    .status(500)
    .json({ error: "Could not build repository graph." });
}

class RepositoryPipelineError extends Error {
  constructor(stage, cause) {
    super(`Repository ${stage} failed`, { cause });
    this.name = "RepositoryPipelineError";
    this.stage = stage;
  }
}
