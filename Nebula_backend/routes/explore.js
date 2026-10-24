import express from "express";
import pathModule from "node:path";
import { FileError, readRepoFile } from "../services/fileService.js";
import { listFiles } from "../services/ingest.js";
import { searchFiles, searchSymbols } from "../services/searchService.js";
import { listSymbols } from "../services/symbolService.js";
import { parseFile } from "../services/parser.js";
import { getAnalysis } from "../services/store.js";

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
} = {}) {
  const router = express.Router();

  // Search is called on every keystroke, so remember each repo's file list
  // instead of walking the disk again. (Keyed by the analysis object itself.)
  const fileListCache = new WeakMap();

  async function getFileList(analysis) {
    if (!fileListCache.has(analysis)) {
      fileListCache.set(analysis, await listFilesImpl(analysis.dir));
    }
    return fileListCache.get(analysis);
  }

  router.get("/file", async (request, response) => {
    const { id, path } = request.query;
    if (
      typeof id !== "string" ||
      id === "" ||
      typeof path !== "string" ||
      path === ""
    ) {
      return response
        .status(400)
        .json({ error: "Both 'id' and 'path' query parameters are required" });
    }

    const analysis = getAnalysisImpl(id);
    if (!analysis)
      return response.status(404).json({ error: "Unknown repository id" });

    try {
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
      if (error instanceof FileError)
        return response.status(error.statusCode).json({ error: error.message });
      console.error("Reading file failed:", error?.message ?? String(error));
      return response.status(500).json({ error: "Could not read file." });
    }
  });

  router.get("/search", async (request, response) => {
    const { id, q } = request.query;
    if (typeof id !== "string" || id === "") {
      return response
        .status(400)
        .json({ error: "The 'id' query parameter is required" });
    }
    if (
      q !== undefined &&
      (typeof q !== "string" || q.length > MAX_QUERY_LENGTH)
    ) {
      return response.status(400).json({ error: "Invalid search query" });
    }

    const analysis = getAnalysisImpl(id);
    if (!analysis)
      return response.status(404).json({ error: "Unknown repository id" });

    try {
      const files = await getFileList(analysis);
      const query = q ?? "";
      const fileMatches = searchFiles(files, query, 10);
      const symbols =
        query.trim() === "" ? [] : await listSymbolsImpl(id, analysis);
      const symbolMatches = searchSymbols(symbols, query, 10);
      return response.status(200).json([...fileMatches, ...symbolMatches]);
    } catch (error) {
      console.error("Search failed:", error?.message ?? String(error));
      return response
        .status(500)
        .json({ error: "Could not search repository." });
    }
  });

  return router;
}
