import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { listFiles } from "./ingest.js";
import { parseFile } from "./parser.js";
import { getAnalysis } from "./store.js";
import { config } from "./config.js";

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const MAX_FILE_BYTES = config.MAX_FILE_BYTES;
const fallbackCache = new WeakMap();

/**
 * Return all parsed functions, methods and classes for a stored repository.
 * If the graph has not been built yet (for example, after a ZIP upload), parse
 * its code files directly and keep the small symbol index on that store entry.
 */
export async function listSymbols(id, repository = getAnalysis(id)) {
  if (!repository) return [];

  const indexed = symbolsFromAnalysis(repository.analysis);
  if (indexed !== null) return indexed;

  if (fallbackCache.has(repository)) return fallbackCache.get(repository);

  const files = await listFiles(repository.dir);
  const symbols = [];
  for (const filePath of files) {
    if (!CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;

    const absolutePath = path.join(repository.dir, ...filePath.split("/"));
    try {
      if ((await stat(absolutePath)).size > MAX_FILE_BYTES) continue;
      const source = await readFile(absolutePath, "utf8");
      const parsed = parseFile(source, filePath);
      for (const fn of parsed.functions) {
        symbols.push({
          name: fn.name,
          kind: fn.kind,
          path: filePath,
          line: fn.line,
        });
      }
    } catch {
      // Ignore files that disappear or become unreadable during indexing.
    }
  }

  fallbackCache.set(repository, symbols);
  return symbols;
}

function symbolsFromAnalysis(analysis) {
  if (!analysis || !analysis.files || typeof analysis.files !== "object")
    return null;

  const symbols = [];
  for (const [filePath, fileAnalysis] of Object.entries(analysis.files)) {
    for (const fn of fileAnalysis.functions ?? []) {
      symbols.push({
        name: fn.name,
        kind: fn.kind,
        path: filePath,
        line: fn.line,
      });
    }
  }
  return symbols;
}
