import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import { parseImports } from "./parser.js";
import { loadAliases, resolveImport } from "./resolver.js";

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const MAX_FILE_SIZE = 1024 * 1024;
const MAX_CODE_FILES = 2000;
const BATCH_SIZE = 50;
const TOKEN_PATTERN = /[A-Za-z_$][\w$]*|\d+|[^\s\w]/g;

export async function buildGraph({ id, dir, files, repoUrl }) {
  const sha = (await simpleGit(dir).revparse(["HEAD"])).trim();
  const sortedCodeFiles = [...new Set(Array.isArray(files) ? files : [])]
    .filter(
      (file) => typeof file === "string" && CODE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()),
    )
    .sort((left, right) => left.localeCompare(right));
  const selectedFiles = sortedCodeFiles.slice(0, MAX_CODE_FILES);
  const warnings = [];

  if (sortedCodeFiles.length > MAX_CODE_FILES) {
    warnings.push({
      file: sortedCodeFiles[MAX_CODE_FILES],
      message: `Repository has more than ${MAX_CODE_FILES} code files; only the first ${MAX_CODE_FILES} sorted paths were analyzed.`,
    });
  }

  const aliases = await loadAliases(dir);
  const parsedFiles = [];

  for (let offset = 0; offset < selectedFiles.length; offset += BATCH_SIZE) {
    const batch = selectedFiles.slice(offset, offset + BATCH_SIZE);
    const results = await Promise.all(batch.map((file) => readAndParseFile(dir, file)));

    for (const result of results) {
      if (result.warning) {
        warnings.push(result.warning);
      } else {
        if (result.error) warnings.push({ file: result.path, message: result.error });
        parsedFiles.push(result);
      }
    }
  }

  const nodes = parsedFiles.map(({ path: filePath, source }) => ({
    id: filePath,
    folder: filePath.includes("/") ? filePath.split("/")[0] : ".",
    loc: countNonEmptyLines(source),
    tokens: source.match(TOKEN_PATTERN)?.length ?? 0,
    complexity: 0,
    churn: 0,
    healthScore: null,
    isGodFile: false,
    inCycle: false,
    fanIn: 0,
    fanOut: 0,
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const edgeKeys = new Set();
  const edges = [];

  for (const { path: sourcePath, imports } of parsedFiles) {
    for (const { specifier } of imports) {
      const targetPath = resolveImport(specifier, sourcePath, nodeIds, { aliases });
      if (!targetPath || targetPath === sourcePath) continue;

      const edgeKey = `${sourcePath}\0${targetPath}`;
      if (edgeKeys.has(edgeKey)) continue;
      edgeKeys.add(edgeKey);
      edges.push({ source: sourcePath, target: targetPath, type: "import" });
    }
  }

  edges.sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
  for (const edge of edges) {
    nodesById.get(edge.source).fanOut += 1;
    nodesById.get(edge.target).fanIn += 1;
  }

  return {
    repo: repoUrl,
    sha,
    nodes,
    edges,
    cycles: [],
    warnings,
  };
}

async function readAndParseFile(dir, filePath) {
  const diskPath = path.join(dir, ...filePath.split("/"));
  const metadata = await stat(diskPath);

  if (metadata.size > MAX_FILE_SIZE) {
    return {
      path: filePath,
      warning: { file: filePath, message: "Skipped file larger than 1 MB." },
    };
  }

  const source = await readFile(diskPath, "utf8");
  const parsed = parseImports(source, filePath);

  return {
    path: filePath,
    source,
    imports: parsed.imports,
    error: parsed.error,
  };
}

function countNonEmptyLines(source) {
  return source.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0).length;
}
