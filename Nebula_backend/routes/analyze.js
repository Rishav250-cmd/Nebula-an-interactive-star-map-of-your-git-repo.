import express from "express";
import multer from "multer";
import path from "node:path";
import { rm } from "node:fs/promises";
import { stat } from "node:fs/promises";
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
import { buildReverseIndex, computeBlast } from "../services/blast.js";
import { fetchGoodFirstIssues, parseGitHubRepo } from "../services/github.js";
import { buildOnboarding } from "../services/onboarding.js";
import { loadAnalysisCache, loadLatestAnalysisCache, saveAnalysisCache } from "../services/cache.js";
import { getHeadSha, getRemoteHeadSha } from "../services/git.js";
import {
  cacheAnalysisGraph,
  getAnalysis,
  storeAnalysis,
  unknownIdError,
  updateAnalysisJob,
} from "../services/store.js";
import { NebulaError } from "../services/errors.js";
import { config } from "../services/config.js";
import { createJobLimiter } from "../services/limiter.js";
import { elapsedMs, logTiming, startTimer, timingEnabled } from "../services/timing.js";
import { getChurn } from "../services/churn.js";

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
  loadLatestAnalysisCacheImpl = loadLatestAnalysisCache,
  saveAnalysisCacheImpl = saveAnalysisCache,
  parseFileImpl,
  listFilesImpl = listFiles,
  buildGraphImpl = buildGraph,
  getChurnImpl = getChurn,
  getAnalysisImpl = getAnalysis,
  storeAnalysisImpl = storeAnalysis,
  cacheAnalysisGraphImpl = cacheAnalysisGraph,
  buildCallGraphImpl = buildCallGraph,
  buildReverseIndexImpl = buildReverseIndex,
  fetchGoodFirstIssuesImpl = fetchGoodFirstIssues,
  buildOnboardingImpl = buildOnboarding,
  updateAnalysisJobImpl = updateAnalysisJob,
  cleanupTemporaryClones,
  jobLimiter = createJobLimiter(),
} = {}) {
  const router = express.Router();
  const shouldCleanTemporaryClones = cleanupTemporaryClones ?? !config.REPO_DIR_EXPLICIT;
  const runningJobs = new Map();
  const blockingJobs = new Map();
  const perFileResultCache = new WeakMap();

  router.post("/analyze", async (request, response) => {
    const { async: asyncMode } = request.body ?? {};
    const url = normalizeRepositoryUrl(request.body?.url);
    if (!url) throw new NebulaError("INVALID_URL", { message: "Invalid GitHub URL" });

    if (asyncMode === true) {
      const id = repoIdFor(url);
      const existing = getAnalysisImpl(id);
      if (existing?.graph && existing.job?.status === "ready")
        return response.status(202).json({ id, status: "ready" });
      if (blockingJobs.has(id)) {
        const status = getAnalysisImpl(id)?.job?.status ?? "cloning";
        return response.status(202).json({ id, status });
      }
      if (runningJobs.has(id)) {
        const status = getAnalysisImpl(id)?.job?.status ?? "cloning";
        return response.status(202).json({ id, status });
      }

      const reservation = jobLimiter.reserve();
      const initialStatus = reservation.queued ? "queued" : "cloning";
      const timing = beginRequestTiming(response, id, { deferred: true });

      const { dir } = cloneLocationForUrlImpl(url);
      storeAnalysisImpl({
        id,
        dir,
        url,
        graph: null,
        analysis: null,
        job: {
          status: initialStatus,
          error: null,
          progress: { done: 0, total: 0 },
        },
      });
      const job = runAsyncJob(id, url, reservation, timing);
      runningJobs.set(id, job);
      return response.status(202).json({ id, status: initialStatus });
    }

    const timing = beginRequestTiming(response, repoIdFor(url));
    try {
      const existing = getAnalysisImpl(repoIdFor(url));
      if (existing?.graph && existing.job?.status === "ready") {
        return response.status(200).json({ id: existing.id, status: "ready" });
      }
      const repository = await runBlockingAnalysis(url, timing);
      return response.status(200).json({ id: repository.id, status: "ready" });
    } catch (error) {
      throw pipelineError(error);
    }
  });

  router.get("/analyze/:id/status", (request, response) => {
    const repository = getAnalysisImpl(request.params.id);
    if (!repository) throw unknownIdError(request.params.id);
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
    if (!repository) throw unknownIdError(request.params.id);

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

  async function runAsyncJob(id, url, reservation, timing) {
    let active = true;
    let timeoutId;
    const update = (state) => {
      if (!active) return;
      updateAnalysisJobImpl(id, { ...state, error: state.error ?? null });
    };

    try {
      const cacheProbe = await probeRepositoryCache(url);
      let repository = cacheProbe.repository;
      if (repository) {
        jobLimiter.cancelReservation(reservation);
        reservation = null;
      } else {
        repository = await jobLimiter.runReserved(reservation, () => {
          update({ status: "cloning" });
          const timeout = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new JobTimeoutError()), JOB_TIMEOUT_MS);
          });
          return Promise.race([
            cloneAndBuild(url, { onState: update, cacheProbe, timing }),
            timeout,
          ]);
        }, { onQueued: () => update({ status: "queued" }) });
        reservation = null;
      }
      if (!active) return;
      const readyJob = {
        status: "ready",
        error: null,
        progress: getAnalysisImpl(id)?.job?.progress ?? { done: 0, total: 0 },
      };
      storeAnalysisImpl({ ...repository, job: readyJob });
      startChurnRefresh(getAnalysisImpl(id));
      update(readyJob);
    } catch (error) {
      if (reservation) jobLimiter.cancelReservation(reservation);
      if (active) {
        active = false;
        await cleanupTemporaryClone(id, getAnalysisImpl(id)?.dir);
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
      finishRequestTiming(timing, id);
    }
  }

  async function runBlockingAnalysis(url, timing = null) {
    const id = repoIdFor(url);
    const activeAsyncJob = runningJobs.get(id);
    if (activeAsyncJob) {
      await activeAsyncJob;
      const completed = getAnalysisImpl(id);
      if (completed?.graph && completed.job?.status === "ready") return completed;
      throw new NebulaError("CLONE_FAILED", {
        message: completed?.job?.error ?? "Repository analysis failed.",
      });
    }
    const activeBlockingJob = blockingJobs.get(id);
    if (activeBlockingJob) return activeBlockingJob;

    const existing = getAnalysisImpl(id);
    if (existing?.graph && existing.job?.status === "ready") return existing;

    const { dir } = cloneLocationForUrlImpl(url);
    storeAnalysisImpl({
      id,
      dir,
      url,
      graph: null,
      analysis: null,
      job: { status: "cloning", error: null, progress: { done: 0, total: 0 } },
    });
    const update = (state) => updateAnalysisJobImpl(id, {
      ...state,
      error: state.error ?? null,
    });
    const job = (async () => {
      try {
        const cacheProbe = await probeRepositoryCache(url);
        const repository = cacheProbe.repository ?? await jobLimiter.run(
          () => cloneAndBuild(url, { cacheProbe, timing, onState: update }),
        );
        const ready = storeAnalysisImpl({
          ...repository,
          job: {
            status: "ready",
            error: null,
            progress: getAnalysisImpl(id)?.job?.progress ?? { done: 0, total: 0 },
          },
        });
        startChurnRefresh(ready ?? repository);
        return repository;
      } catch (error) {
        await cleanupTemporaryClone(id, getAnalysisImpl(id)?.dir);
        update({
          status: "error",
          error: getJobErrorMessage(error),
          progress: getAnalysisImpl(id)?.job?.progress ?? { done: 0, total: 0 },
        });
        throw error;
      } finally {
        blockingJobs.delete(id);
      }
    })();
    blockingJobs.set(id, job);
    return job;
  }

  router.post("/graph", async (request, response) => {
    const url = normalizeRepositoryUrl(request.body?.url);
    if (!url) throw new NebulaError("INVALID_URL", { message: "Invalid GitHub URL" });

    try {
      const id = repoIdFor(url);
      const existing = getAnalysisImpl(id);
      if (existing?.graph && existing.job?.status === "ready")
        return response.status(200).json({ ...existing.graph, id: existing.id });
      const repository = await runBlockingAnalysis(url);
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
    if (!analysis) throw unknownIdError(request.params.id);

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
    if (!analysis) throw unknownIdError(id);

    try {
      await ensureGraphAnalysis(analysis);
      if (!Object.hasOwn(analysis.analysis?.files ?? {}, filePath))
        throw new NebulaError("FILE_NOT_FOUND", { message: "Path is not an analyzed code file" });

      const depth = rawDepth === "2" ? 2 : 1;
      const callGraph = cachedFileResult(
        perFileResultCache,
        analysis,
        `callgraph:${filePath}:${depth}`,
        () => buildCallGraphImpl(analysis.analysis, analysis.graph, filePath, { depth }),
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
    if (!analysis) throw unknownIdError(id);

    try {
      await ensureGraphAnalysis(analysis);
      const nodes = analysis.graph?.nodes ?? [];
      if (!nodes.some((node) => node.id === filePath))
        throw new NebulaError("FILE_NOT_FOUND", { message: "Path is not a graph node" });

      const maxDepth = rawDepth === undefined ? 4 : Number(rawDepth);
      const reverseIndex = analysis.analysis.reverseIndex instanceof Map
        ? analysis.analysis.reverseIndex
        : buildReverseIndexImpl(analysis.graph?.edges);
      analysis.analysis.reverseIndex = reverseIndex;
      const blast = cachedFileResult(
        perFileResultCache,
        analysis,
        `blast:${filePath}:${maxDepth}`,
        () => computeBlast(reverseIndex, filePath, { maxDepth }),
      );
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
    if (!repository) throw unknownIdError(request.params.id);

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

  async function probeRepositoryCache(url) {
    let remoteSha = null;
    try {
      remoteSha = await getRemoteShaImpl(url);
    } catch (error) {
      console.warn(
        "Could not check remote repository SHA:",
        error?.message ?? String(error),
      );
    }

    if (!remoteSha) {
      const previousClone = cloneLocationForUrlImpl(url);
      const staleCache = await loadLatestAnalysisCacheImpl(url);
      if (staleCache) {
        try {
          if ((await stat(previousClone.dir)).isDirectory()) {
            const graph = {
              ...staleCache.graph,
              meta: { ...staleCache.graph.meta, stale: true },
              warnings: [
                ...(staleCache.graph.warnings ?? []),
                { file: null, message: "GitHub could not be reached; showing the last analysis" },
              ],
            };
            return {
              remoteSha: null,
              remoteCache: staleCache,
              repository: {
                id: previousClone.id,
                dir: previousClone.dir,
                url,
                sha: staleCache.sha,
                graph,
                analysis: staleCache.analysis,
              },
            };
          }
        } catch { /* Missing clone means stale cache cannot be served. */ }
      }
    }

    const remoteCache = remoteSha ? await loadCache(url, remoteSha) : null;
    if (remoteCache) {
      const previousClone = cloneLocationForUrlImpl(url);
      return {
        remoteSha,
        remoteCache,
        repository: {
          id: previousClone.id,
          dir: previousClone.dir,
          url,
          sha: remoteSha,
          graph: remoteCache.graph,
          analysis: remoteCache.analysis,
        },
      };
    }
    return { remoteSha, remoteCache, repository: null };
  }

  async function cloneAndBuild(url, { onState, cacheProbe, timing } = {}) {
    const probe = cacheProbe ?? await probeRepositoryCache(url);
    if (probe.repository) {
      onState?.({ status: "ready", progress: { done: 0, total: 0 } });
      return probe.repository;
    }
    const { remoteSha, remoteCache } = probe;

    let clonedRepository;
    const cloneStartedAt = startTimer();
    try {
      clonedRepository = await cloneRepoImpl(url);
    } catch (error) {
      reportTiming(timing, repoIdFor(url), "clone", elapsedMs(cloneStartedAt));
      throw new RepositoryPipelineError("clone", error);
    }
    reportTiming(timing, repoIdFor(url), "clone", elapsedMs(cloneStartedAt));

    const repository = {
      id: clonedRepository.id,
      dir: clonedRepository.dir,
      url,
      sha: clonedRepository.sha ?? null,
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
      repository.sha = clonedSha;
      onState?.({ status: "ready", progress: { done: 0, total: 0 } });
      return repository;
    }

    const built = await buildGraphForRepository(repository, onState, timing);
    repository.graph = built.graph;
    repository.analysis = built.analysis;
    const builtSha = clonedSha ?? built.graph?.sha;
    repository.sha = builtSha ?? null;
    if (builtSha) {
      const cacheWriteStartedAt = startTimer();
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
      reportTiming(timing, repository.id, "cache write", elapsedMs(cacheWriteStartedAt));
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

  async function buildGraphForRepository(repository, onState, timing) {
    try {
      onState?.({ status: "listing", progress: { done: 0, total: 0 } });
      const fileWalkStartedAt = startTimer();
      const files = await listFilesImpl(repository.dir);
      reportTiming(timing, repository.id, "file walk", elapsedMs(fileWalkStartedAt), { files: files.length });
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
      if (buildGraphImpl === buildGraph) buildOptions.deferChurn = true;
      if (timing) {
        buildOptions.onTiming = (stage, durationMs, extra) =>
          reportTiming(timing, repository.id, stage, durationMs, extra);
      }
      const built = await buildGraphImpl(buildOptions);
      onState?.({ status: "graph", progress: { done: total, total } });
      return built;
    } catch (error) {
      throw new RepositoryPipelineError("build", error);
    }
  }

  function startChurnRefresh(repository) {
    if (!repository?.graph || !repository.analysis || !isValidRepositoryUrl(repository.url)) return;
    if (repository.churnRefresh) return repository.churnRefresh;
    repository.churnRefresh = Promise.resolve()
      .then(async () => {
        const directory = await stat(repository.dir).catch(() => null);
        if (!directory?.isDirectory()) return null;
        const churnStartedAt = startTimer();
        const churn = await getChurnImpl(repository.dir, { months: 12 });
        reportTiming(null, repository.id, "churn", elapsedMs(churnStartedAt), { files: churn.size });
        return churn;
      })
      .then(async (churn) => {
        if (!churn) return;
        repository.analysis.churn = churn;
        for (const node of repository.graph.nodes) node.churn = churn.get(node.id) ?? 0;
        repository.hasHistory = churn.size > 0;
        repository.graph.meta.churnAvailable = repository.hasHistory;
        if (repository.sha) {
          const cacheWriteStartedAt = startTimer();
          await Promise.resolve()
            .then(() => saveAnalysisCacheImpl({
              repo: repository.url,
              sha: repository.sha,
              graph: repository.graph,
              analysis: repository.analysis,
            }))
            .catch(() => {});
          reportTiming(null, repository.id, "cache write", elapsedMs(cacheWriteStartedAt));
        }
      })
      .catch((error) => {
        console.warn("Repository churn refresh failed:", error?.message ?? String(error));
      })
      .finally(() => cleanupTemporaryClone(repository.id, repository.dir));
    return repository.churnRefresh;
  }

  async function cleanupTemporaryClone(id, directory) {
    if (!shouldCleanTemporaryClones || typeof directory !== "string") return;
    const resolvedDirectory = path.resolve(directory);
    const explicitlyAllowedExternalDirectory = cleanupTemporaryClones === true;
    if (!explicitlyAllowedExternalDirectory) {
      const relativeToRepoRoot = path.relative(config.REPO_DIR, resolvedDirectory);
      if (relativeToRepoRoot.startsWith("..") || path.isAbsolute(relativeToRepoRoot)) return;
    }
    const expectedDirectory = cloneLocationForUrlImpl(
      getAnalysisImpl(id)?.url ?? "",
    ).dir;
    if (resolvedDirectory !== path.resolve(expectedDirectory)) return;
    await rm(resolvedDirectory, { recursive: true, force: true }).catch(() => {});
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

function reportTiming(timing, repoId, stage, durationMs, extra) {
  if (!timingEnabled()) return;
  logTiming(repoId, stage, durationMs, extra);
  if (timing) timing.stages[stage] = (timing.stages[stage] ?? 0) + durationMs;
}

function cachedFileResult(cacheByAnalysis, analysis, key, build) {
  let cache = cacheByAnalysis.get(analysis);
  if (!cache) {
    cache = new Map();
    cacheByAnalysis.set(analysis, cache);
  }
  if (cache.has(key)) {
    const result = cache.get(key);
    cache.delete(key);
    cache.set(key, result);
    return result;
  }
  const result = build();
  cache.set(key, result);
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return result;
}

function beginRequestTiming(response, repoId, { deferred = false } = {}) {
  if (!timingEnabled()) return null;
  const timing = { startedAt: startTimer(), stages: {}, peakRss: process.memoryUsage().rss };
  const sampler = setInterval(() => {
    timing.peakRss = Math.max(timing.peakRss, process.memoryUsage().rss);
  }, 20);
  sampler.unref?.();
  timing.sampler = sampler;
  timing.finish = () => finishRequestTiming(timing, repoId, sampler);
  if (!deferred) response.once("finish", timing.finish);
  return timing;
}

function finishRequestTiming(timing, repoId, sampler = null) {
  if (!timing || timing.finished) return;
  timing.finished = true;
  clearInterval(sampler ?? timing.sampler);
  timing.peakRss = Math.max(timing.peakRss, process.memoryUsage().rss);
  reportTiming(timing, repoId, "total", elapsedMs(timing.startedAt), {
    peakRssMb: Number((timing.peakRss / 1024 / 1024).toFixed(1)),
    stages: timing.stages,
  });
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

function normalizeRepositoryUrl(value) {
  if (typeof value !== "string") return null;

  try {
    const parsedUrl = new URL(value.trim());
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "github.com" ||
      parsedUrl.username ||
      parsedUrl.password
    ) return null;

    const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) return null;

    const [owner, rawRepository] = pathParts;
    const repository = rawRepository.replace(/\.git$/i, "");
    const validSegment = /^[A-Za-z0-9_.-]+$/;
    if (!validSegment.test(owner) || !validSegment.test(repository)) return null;

    // GitHub links can include a trailing slash, query, fragment, or a page
    // path such as /tree/main. Analysis always operates on the repository root.
    return `https://github.com/${owner}/${repository}`;
  } catch {
    return null;
  }
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
