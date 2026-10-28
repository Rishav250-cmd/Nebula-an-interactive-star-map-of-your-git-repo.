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

  router.post("/qa", async (request, response) => {
    const { id, question } = request.body ?? {};
    if (typeof id !== "string" || id === "") {
      throw new NebulaError("INVALID_QUERY", { message: "The 'id' value is required" });
    }
    if (typeof question !== "string" || question.trim().length < 3 || question.length > 300) {
      throw new NebulaError("INVALID_QUERY", { message: "Ask a question between 3 and 300 characters long." });
    }

    const analysis = getAnalysisImpl(id);
    if (!analysis) throw unknownIdError(id);

    const terms = questionTerms(question);
    const files = (await getFileList(analysis)).filter((filePath) => (
      CODE_EXTENSIONS.has(pathModule.extname(filePath).toLowerCase())
    ));
    const ranked = [];

    for (const filePath of files) {
      try {
        const source = (await readRepoFile(analysis.dir, filePath)).content;
        const lowerSource = source.toLowerCase();
        const matchedTerms = terms.filter(({ expression }) => expression.test(lowerSource));
        if (matchedTerms.length === 0) continue;

        const lines = source.split(/\r?\n/);
        let bestLine = null;
        let bestLineScore = 0;
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index].trim();
          if (!line) continue;
          const matchedOnLine = terms.filter(({ expression }) => expression.test(line.toLowerCase()));
          const lineScore = matchedOnLine.reduce((score, term) => score + term.weight, 0);
          if (lineScore > bestLineScore) {
            bestLineScore = lineScore;
            bestLine = { line: index + 1, snippet: line.slice(0, 280), matchedTerms: matchedOnLine.map(({ label }) => label) };
          }
        }

        const pathMatches = matchedTerms.reduce((score, term) => (
          score + (term.expression.test(filePath.toLowerCase()) ? term.weight * 2 : 0)
        ), 0);
        const score = matchedTerms.reduce((total, term) => {
          const occurrences = lowerSource.match(new RegExp(term.source, "g"))?.length ?? 0;
          return total + term.weight * Math.min(occurrences, 5);
        }, pathMatches);
        if (score > 0 && bestLine) ranked.push({ path: filePath, ...bestLine, score });
      } catch {
        // Skip files that disappear or cannot be read during retrieval.
      }
    }

    ranked.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    const matches = ranked.slice(0, 6).map(({ path, line, snippet, matchedTerms: matched }) => ({
      path,
      line,
      snippet,
      matchedTerms: matched,
    }));
    const answer = matches.length
      ? `The strongest code evidence for “${question.trim()}” is in ${matches[0].path}:${matches[0].line}. The other supporting files below contain related references.`
      : `I couldn't find a clear match for “${question.trim()}” in the indexed JavaScript or TypeScript files. Try a narrower term, such as a function name, route, token, or service.`;

    return response.status(200).json({ answer, matches });
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

const QUESTION_STOP_WORDS = new Set([
  "a", "an", "and", "are", "at", "be", "by", "do", "does", "for", "from",
  "handled", "how", "in", "is", "it", "of", "on", "or", "the", "this", "to", "what", "where", "which", "who", "with",
]);
const QUESTION_SYNONYMS = [
  { pattern: /\b(auth|authentication|authorization|authorize|authorized|login|log\s*in|sign\s*in|signin|session|token|jwt|passport|credential)\b/i, terms: ["auth", "authentication", "authorization", "authorize", "login", "signin", "session", "token", "jwt", "passport", "credential", "middleware"] },
  { pattern: /\b(api|route|endpoint|request|controller)\b/i, terms: ["api", "route", "router", "endpoint", "controller", "express"] },
  { pattern: /\b(database|db|storage|persist|query)\b/i, terms: ["database", "db", "storage", "persist", "query", "model", "repository"] },
  { pattern: /\b(error|exception|failure|fail)\b/i, terms: ["error", "exception", "failure", "catch", "throw"] },
  { pattern: /\b(test|testing|spec)\b/i, terms: ["test", "spec", "describe", "assert", "expect"] },
];

function questionTerms(question) {
  const rawTerms = question.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
  const terms = new Map();
  for (const term of rawTerms) {
    if (!QUESTION_STOP_WORDS.has(term)) terms.set(term, 2);
  }
  for (const group of QUESTION_SYNONYMS) {
    if (!group.pattern.test(question)) continue;
    for (const term of group.terms) {
      if (!terms.has(term)) terms.set(term, 1);
    }
  }
  return [...terms].map(([label, weight]) => ({
    label,
    weight,
    source: `(?<![a-z0-9_])${escapeRegex(label)}(?![a-z0-9_])`,
    expression: new RegExp(`(?<![a-z0-9_])${escapeRegex(label).replace(/ /g, "\\s+")}(?![a-z0-9_])`, "i"),
  }));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
