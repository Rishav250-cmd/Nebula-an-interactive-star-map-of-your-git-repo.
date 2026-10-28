import express from "express";
import multer from "multer";
import { rm } from "node:fs/promises";
import { buildGraph } from "../services/analyzeService.js";
import { extractZipArchive } from "../services/archive.js";
import {
  buildTree,
  cloneLocationForUrl,
  cloneRepo,
  listFiles,
  repoIdFor,
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
  updateAnalysisJob,
} from "../services/store.js";
import { NebulaError } from "../services/errors.js";
import { config } from "../services/config.js";

const githubRepositoryUrl =
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/;
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 0 },
});
const JOB_TIMEOUT_MS = config.JOB_TIMEOUT_MS;
const PROGRESS_POLL_MS = 300;
const PROGRESS_HEARTBEAT_MS = 15 * 1000;
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

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
  updateAnalysisJobImpl = updateAnalysisJob,
} = {}) {
  const router = express.Router();
  const runningJobs = new Map();

  router.post("/analyze", async (request, response) => {
    const { url, async: asyncMode } = request.body ?? {};
    if (!isValidRepositoryUrl(url)) throw new NebulaError("INVALID_URL", { message: "Invalid GitHub URL" });

    if (asyncMode === true) {
      const id = repoIdFor(url);
      if (runningJobs.has(id))
        return response.status(202).json({ id, status: "cloning" });

      const { dir } = cloneLocationForUrlImpl(url);
      storeAnalysisImpl({
        id,
        dir,
        url,
        graph: null,
        analysis: null,
        job: {
          status: "cloning",
          error: null,
          progress: { done: 0, total: 0 },
        },
      });
      const job = runAsyncJob(id, url);
      runningJobs.set(id, job);
      return response.status(202).json({ id, status: "cloning" });
    }

    try {
      const repository = await cloneAndBuild(url);
      storeAnalysisImpl(repository);
      return response.status(200).json({ id: repository.id, status: "ready" });
    } catch (error) {
      throw pipelineError(error);
    }
  });

  router.get("/analyze/:id/status", (request, response) => {
    const repository = getAnalysisImpl(request.params.id);
    if (!repository) throw new NebulaError("UNKNOWN_ID");
    const job = repository.job ?? {
      status: repository.graph ? "ready" : "cloning",
      error: null,
      progress: { done: 0, total: 0 },
    };
    return response.status(200).json({
      id: request.params.id,
      status: job.status,
      error: job.error ?? null,
      progress: job.progress ?? { done: 0, total: 0 },
    });
  });

  router.get("/progress/:id", (request, response) => {
    const repository = getAnalysisImpl(request.params.id);
    if (!repository) throw new NebulaError("UNKNOWN_ID");

    response.status(200);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();

    let closed = false;
    let lastState = "";
    const clearTimers = () => {
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
    };
    const closeStream = () => {
      if (closed) return;
      closed = true;
      clearTimers();
      if (!response.writableEnded) response.end();
    };
    const sendState = () => {
      if (closed) return;
      const current = getAnalysisImpl(request.params.id);
      if (!current) return closeStream();
      const job = current.job ?? {
        status: current.graph ? "ready" : "cloning",
        error: null,
        progress: { done: 0, total: 0 },
      };
      const payload = {
        id: request.params.id,
        status: job.status,
        error: job.error ?? null,
        progress: job.progress ?? { done: 0, total: 0 },
      };
      const serialized = JSON.stringify(payload);
      if (serialized !== lastState) {
        response.write(`data: ${serialized}\n\n`);
        lastState = serialized;
      }
      if (payload.status === "ready" || payload.status === "error")
        closeStream();
    };
    const pollTimer = setInterval(sendState, PROGRESS_POLL_MS);
    const heartbeatTimer = setInterval(() => {
      if (!closed) response.write(": heartbeat\n\n");
    }, PROGRESS_HEARTBEAT_MS);
    response.on("close", () => {
      closed = true;
      clearTimers();
    });
    sendState();
  });

  async function runAsyncJob(id, url) {
    let active = true;
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new JobTimeoutError()),
        JOB_TIMEOUT_MS,
      );
    });
    const update = (state) => {
      if (!active) return;
      updateAnalysisJobImpl(id, { ...state, error: state.error ?? null });
    };

    try {
      const repository = await Promise.race([
        cloneAndBuild(url, { onState: update }),
        timeout,
      ]);
      if (!active) return;
      const readyJob = {
        status: "ready",
        error: null,
        progress: getAnalysisImpl(id)?.job?.progress ?? { done: 0, total: 0 },
      };
      storeAnalysisImpl({ ...repository, job: readyJob });
      update(readyJob);
    } catch (error) {
      if (active) {
        active = false;
        updateAnalysisJobImpl(id, {
          status: "error",
          error: getJobErrorMessage(error),
          progress: getAnalysisImpl(id)?.job?.progress ?? { done: 0, total: 0 },
        });
      }
    } finally {
      clearTimeout(timeoutId);
      active = false;
      runningJobs.delete(id);
    }
  }

  router.post("/graph", async (request, response) => {
    const { url } = request.body ?? {};
    if (!isValidRepositoryUrl(url)) throw new NebulaError("INVALID_URL", { message: "Invalid GitHub URL" });

    try {
      const repository = await cloneAndBuild(url);
      storeAnalysisImpl(repository);
      return response
        .status(200)
        .json({ ...repository.graph, id: repository.id });
    } catch (error) {
      throw pipelineError(error);
    }
  });

  router.post("/upload", runZipUpload, async (request, response) => {
    if (!request.file) {
      throw new NebulaError("BAD_UPLOAD", { message: "A ZIP file is required in the 'file' field." });
    }

    const fileName = request.file.originalname.split(/[\\/]/).at(-1) || "";
    if (!fileName.toLowerCase().endsWith(".zip")) {
      throw new NebulaError("BAD_UPLOAD", { message: "Only .zip files are accepted." });
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
      if (error instanceof NebulaError) throw error;
      throw new NebulaError("BAD_UPLOAD", { cause: error });
    }
  });

  router.get("/graph/:id", async (request, response) => {
    const analysis = getAnalysisImpl(request.params.id);
    if (!analysis) throw new NebulaError("UNKNOWN_ID");

    try {
      await ensureGraphAnalysis(analysis);
    } catch (error) {
      throw pipelineError(error);
    }

    return response.status(200).json(analysis.graph);
  });

  router.get("/callgraph", async (request, response) => {
    const { id, path: filePath, depth: rawDepth } = request.query;
    if (typeof id !== "string" || id === "")
      throw new NebulaError("INVALID_QUERY", { message: "The 'id' query parameter is required" });
    if (typeof filePath !== "string" || filePath === "")
      throw new NebulaError("INVALID_QUERY", { message: "The 'path' query parameter is required" });
    if (rawDepth !== undefined && rawDepth !== "1" && rawDepth !== "2")
      throw new NebulaError("INVALID_QUERY", { message: "Depth must be 1 or 2" });

    const analysis = getAnalysisImpl(id);
    if (!analysis) throw new NebulaError("UNKNOWN_ID");

    try {
      await ensureGraphAnalysis(analysis);
      if (!Object.hasOwn(analysis.analysis?.files ?? {}, filePath))
        throw new NebulaError("FILE_NOT_FOUND", { message: "Path is not an analyzed code file" });

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
      throw pipelineError(error);
    }
  });

  router.get("/blast", async (request, response) => {
    const { id, path: filePath, depth: rawDepth } = request.query;
    if (typeof filePath !== "string" || filePath === "")
      throw new NebulaError("INVALID_QUERY", { message: "The 'path' query parameter is required" });
    if (typeof id !== "string" || id === "")
      throw new NebulaError("INVALID_QUERY", { message: "The 'id' query parameter is required" });
    if (
      rawDepth !== undefined &&
      (typeof rawDepth !== "string" || !/^[1-6]$/.test(rawDepth))
    ) {
      throw new NebulaError("INVALID_QUERY", { message: "Depth must be an integer from 1 to 6" });
    }

    const analysis = getAnalysisImpl(id);
    if (!analysis) throw new NebulaError("UNKNOWN_ID");

    try {
      await ensureGraphAnalysis(analysis);
      const nodes = analysis.graph?.nodes ?? [];
      if (!nodes.some((node) => node.id === filePath))
        throw new NebulaError("FILE_NOT_FOUND", { message: "Path is not a graph node" });

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
      throw pipelineError(error);
    }
  });

  router.get("/onboarding/:id", async (request, response) => {
    const repository = getAnalysisImpl(request.params.id);
    if (!repository) throw new NebulaError("UNKNOWN_ID");

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
      throw pipelineError(error);
    }
  });

  async function cloneAndBuild(url, { onState } = {}) {
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
          onState?.({ status: "ready", progress: { done: 0, total: 0 } });
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
      cloneInfo: {
        defaultBranch: clonedRepository.defaultBranch ?? null,
        shallow: clonedRepository.shallow === true,
      },
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
      onState?.({ status: "ready", progress: { done: 0, total: 0 } });
      return repository;
    }

    const built = await buildGraphForRepository(repository, onState);
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

  async function buildGraphForRepository(repository, onState) {
    try {
      onState?.({ status: "listing", progress: { done: 0, total: 0 } });
      const files = await listFilesImpl(repository.dir);
      const total = Math.min(
        files.filter((file) => /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(file))
          .length,
        config.MAX_CODE_FILES,
      );
      onState?.({ status: "parsing", progress: { done: 0, total } });
      const buildOptions = {
        id: repository.id,
        dir: repository.dir,
        files,
        repoUrl: repository.url,
      };
      if (onState) buildOptions.onProgress = onState;
      if (parseFileImpl) buildOptions.parseFileImpl = parseFileImpl;
      const built = await buildGraphImpl(buildOptions);
      onState?.({ status: "graph", progress: { done: total, total } });
      return built;
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
      return next(new NebulaError("UPLOAD_TOO_LARGE"));
    }
    return next(new NebulaError("BAD_UPLOAD", { message: "Upload exactly one file in the 'file' field." }));
  });
}

function isValidRepositoryUrl(url) {
  return typeof url === "string" && githubRepositoryUrl.test(url);
}

function pipelineError(error) {
  if (error instanceof NebulaError) return error;
  if (error instanceof RepositoryPipelineError && error.cause instanceof NebulaError)
    return error.cause;
  if (error instanceof JobTimeoutError) return new NebulaError("JOB_TIMEOUT");
  if (error instanceof RepositoryPipelineError && error.stage === "clone") {
    return new NebulaError("CLONE_FAILED", {
      message: "Could not clone repo (private or not found?)",
      cause: error.cause,
    });
  }
  if (error instanceof RepositoryPipelineError && error.stage === "build") {
    return new NebulaError("INTERNAL", { message: "Could not build repository graph.", cause: error.cause });
  }
  return new NebulaError("INTERNAL", { cause: error });
}

function getJobErrorMessage(error) {
  if (error instanceof JobTimeoutError)
    return "Analysis job exceeded the 3 minute timeout.";
  if (error instanceof NebulaError) return error.message;
  if (error instanceof RepositoryPipelineError && error.cause instanceof NebulaError)
    return error.cause.message;
  if (error instanceof RepositoryPipelineError && error.stage === "clone")
    return "Could not clone repository.";
  if (error instanceof RepositoryPipelineError && error.stage === "build")
    return "Could not build repository graph.";
  return error?.message || "Analysis job failed.";
}

class JobTimeoutError extends Error {
  constructor() {
    super("Analysis job exceeded the 3 minute timeout.");
    this.name = "JobTimeoutError";
  }
}

class RepositoryPipelineError extends Error {
  constructor(stage, cause) {
    super(`Repository ${stage} failed`, { cause });
    this.name = "RepositoryPipelineError";
    this.stage = stage;
  }
}
