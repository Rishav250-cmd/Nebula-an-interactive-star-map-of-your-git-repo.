import { readFile } from "node:fs/promises";
import path from "node:path";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const TYPESCRIPT_EXTENSION_MAP = new Set([".js", ".jsx", ".mjs"]);

function normalizeRepoPath(candidate) {
  if (typeof candidate !== "string" || path.posix.isAbsolute(candidate)) return null;

  const normalized = path.posix.normalize(candidate);
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return null;
  }

  return normalized === "." ? "." : normalized.replace(/^\.\//, "");
}

function findFile(candidate, fileSet) {
  const normalized = normalizeRepoPath(candidate);
  if (normalized === null) return null;

  const candidates = [normalized];
  const extension = path.posix.extname(normalized).toLowerCase();

  // TypeScript commonly keeps .js-style ESM specifiers while sources use .ts/.tsx.
  if (TYPESCRIPT_EXTENSION_MAP.has(extension)) {
    const stem = normalized.slice(0, -extension.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }

  candidates.push(...EXTENSIONS.map((candidateExtension) => `${normalized}${candidateExtension}`));
  candidates.push(...EXTENSIONS.map((candidateExtension) => `${normalized}/index${candidateExtension}`));

  for (const pathCandidate of candidates) {
    const safeCandidate = normalizeRepoPath(pathCandidate);
    if (safeCandidate !== null && fileSet.has(safeCandidate)) return safeCandidate;
  }

  return null;
}

function aliasCandidates(specifier, aliases) {
  const sortedAliases = aliases
    .filter((alias) => alias && typeof alias.prefix === "string" && Array.isArray(alias.targets))
    .sort((left, right) => right.prefix.length - left.prefix.length);

  for (const alias of sortedAliases) {
    const wildcardIndex = alias.prefix.indexOf("*");
    const prefix = wildcardIndex >= 0 ? alias.prefix.slice(0, wildcardIndex) : alias.prefix;
    // A catch-all paths pattern must not turn ordinary package names into repo files.
    if (!prefix) continue;
    const targetHasWildcard = alias.targets.some((target) => typeof target === "string" && target.includes("*"));
    const isWildcard = wildcardIndex >= 0 || targetHasWildcard || alias.prefix.endsWith("/");
    if (isWildcard ? !specifier.startsWith(prefix) : specifier !== prefix) continue;

    const wildcardValue = specifier.slice(prefix.length);
    const candidates = alias.targets
      .filter((target) => typeof target === "string")
      .map((target) => target.replaceAll("*", wildcardValue));

    if (candidates.length > 0) return candidates;
  }

  return [];
}

export function resolveImport(specifier, fromFile, fileSet, options = {}) {
  if (typeof specifier !== "string" || typeof fromFile !== "string" || !(fileSet instanceof Set)) {
    return null;
  }

  const aliases = Array.isArray(options.aliases) ? options.aliases : [];
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const candidate = path.posix.join(path.posix.dirname(fromFile), specifier);
    return findFile(candidate, fileSet);
  }

  for (const candidate of aliasCandidates(specifier, aliases)) {
    const target = findFile(candidate, fileSet);
    if (target) return target;
  }

  return null;
}

export async function loadAliases(rootDir) {
  for (const configName of ["tsconfig.json", "jsconfig.json"]) {
    let source;
    try {
      source = await readFile(path.join(rootDir, configName), "utf8");
    } catch {
      continue;
    }

    let config;
    try {
      config = JSON.parse(stripTrailingCommas(stripJsonComments(source)));
    } catch {
      continue;
    }

    const compilerOptions = config?.compilerOptions;
    const paths = compilerOptions?.paths;
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) return [];

    const baseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
    const aliases = [];

    for (const [pattern, configuredTargets] of Object.entries(paths)) {
      if (typeof pattern !== "string" || !Array.isArray(configuredTargets)) continue;

      const wildcardIndex = pattern.indexOf("*");
      const prefix = wildcardIndex >= 0 ? pattern.slice(0, wildcardIndex) : pattern;
      const targets = configuredTargets
        .filter((target) => typeof target === "string")
        .map((target) => path.posix.normalize(path.posix.join(baseUrl, target)));

      if (targets.length > 0) aliases.push({ prefix, targets });
    }

    return aliases;
  }

  return [];
}

function stripJsonComments(source) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === "/" && nextCharacter === "/") {
      output += "  ";
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n" && source[index + 1] !== "\r") {
        output += " ";
        index += 1;
      }
    } else if (character === "/" && nextCharacter === "*") {
      output += "  ";
      index += 1;
      while (index + 1 < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        output += source[index + 1] === "\n" || source[index + 1] === "\r" ? source[index + 1] : " ";
        index += 1;
      }
      if (index + 1 < source.length) {
        output += "  ";
        index += 1;
      }
    } else {
      output += character;
    }
  }

  return output;
}

function stripTrailingCommas(source) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
    } else if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(source[nextIndex] ?? "")) nextIndex += 1;
      if (source[nextIndex] !== "}" && source[nextIndex] !== "]") output += character;
    } else {
      output += character;
    }
  }

  return output;
}
