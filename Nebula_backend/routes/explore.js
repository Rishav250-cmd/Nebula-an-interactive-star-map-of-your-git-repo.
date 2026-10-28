import express from "express";
import { stat } from "node:fs/promises";
import { simpleGit } from "simple-git";
import pathModule from "node:path";
import { readRepoFile } from "../services/fileService.js";
import { cloneRepo, listFiles } from "../services/ingest.js";
import { searchFiles, searchSymbols } from "../services/searchService.js";
import { listSymbols } from "../services/symbolService.js";
import { parseFile } from "../services/parser.js";
import { getAnalysis, unknownIdError } from "../services/store.js";
import { NebulaError } from "../services/errors.js";

const MAX_QUERY_LENGTH = 200;
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

/**
 * Routes used by the code panel and the search bar:
 *   GET /api/file?id=...&path=...   -> { content, language, loc }
 *   GET /api/search?id=...&q=...    -> [{ type, name, path, line }]
 */
export function createExploreRouter({
  getAnalysisImpl = getAnalysis,
  listFilesImpl = listFiles,
  listSymbolsImpl = listSymbols,
  cloneRepoImpl = cloneRepo,
} = {}) {
  const router = express.Router();
  const checkoutJobs = new WeakMap();

  // Search is called on every keystroke, so remember each repo's file list
  // instead of walking the disk again. (Keyed by the analysis object itself.)
  const fileListCache = new WeakMap();

  async function getFileList(analysis) {
    if (!fileListCache.has(analysis)) {
      await ensureLocalClone(analysis);
      fileListCache.set(analysis, await listFilesImpl(analysis.dir));
    }
    return fileListCache.get(analysis);
  }

  async function ensureLocalClone(analysis) {
    const existing = await stat(analysis.dir).catch(() => null);
    if (existing?.isDirectory()) return;
    const currentJob = checkoutJobs.get(analysis);
    if (currentJob) return currentJob;
    const job = (async () => {
      const cloned = await cloneRepoImpl(analysis.url);
      if (analysis.sha && cloned.sha !== analysis.sha) {
        const git = simpleGit(cloned.dir);
        await git.fetch(["--depth=1", "origin", analysis.sha]);
        await git.checkout(["--detach", analysis.sha]);
        const checkedOutSha = (await git.revparse(["HEAD"])).trim();
        if (checkedOutSha !== analysis.sha)
          throw new Error("Could not restore the cached repository revision.");
      }
      analysis.dir = cloned.dir;
      analysis.cloneInfo = {
        defaultBranch: cloned.defaultBranch ?? null,
        shallow: cloned.shallow === true,
      };
    })();
    checkoutJobs.set(analysis, job);
    try {
      await job;
    } finally {
      checkoutJobs.delete(analysis);
    }
  }

  router.get("/file", async (request, response) => {
    const { id, path } = request.query;
    if (
      typeof id !== "string" ||
      id === "" ||
      typeof path !== "string" ||
      path === ""
    ) {
      throw new NebulaError("INVALID_QUERY", { message: "Both 'id' and 'path' query parameters are required" });
    }

    const analysis = getAnalysisImpl(id);
    if (!analysis) throw unknownIdError(id);

    try {
      await ensureLocalClone(analysis);
      const result = await readRepoFile(analysis.dir, path);
      const fileFunctions = analysis.analysis?.files?.[path]?.functions;
      const functions = CODE_EXTENSIONS.has(
        pathModule.extname(path).toLowerCase(),
      )
        ? (fileFunctions ?? parseFile(result.content, path).functions).map(
            ({ name, kind, line, endLine, complexity }) => ({
              name,
              kind,
              line,
              endLine,
              complexity,
            }),
          )
        : [];
      return response.status(200).json({ ...result, functions });
    } catch (error) {
      throw error;
    }
  });

  router.get("/search", async (request, response) => {
    const { id, q } = request.query;
    if (typeof id !== "string" || id === "") {
      throw new NebulaError("INVALID_QUERY", { message: "The 'id' query parameter is required" });
    }
    if (
      q !== undefined &&
      (typeof q !== "string" || q.length > MAX_QUERY_LENGTH)
    ) {
      throw new NebulaError("INVALID_QUERY", { message: "Invalid search query" });
    }

    const analysis = getAnalysisImpl(id);
    if (!analysis) throw unknownIdError(id);

    try {
      const files = await getFileList(analysis);
      const query = q ?? "";
      const fileMatches = searchFiles(files, query, 10);
      const symbols =
        query.trim() === "" ? [] : await listSymbolsImpl(id, analysis);
      const symbolMatches = searchSymbols(symbols, query, 10);
      return response.status(200).json([...fileMatches, ...symbolMatches]);
    } catch (error) {
      throw error;
    }
  });

  return router;
}
