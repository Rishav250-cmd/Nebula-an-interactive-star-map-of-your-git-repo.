import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { shouldIgnore } from "../ignore.js";
import { countLines } from "../utils/countLines.js";
import { detectLanguage } from "../utils/detectLanguage.js";

// Files bigger than this are not sent to the code panel (the graph skips them too).
export const MAX_FILE_BYTES = 1024 * 1024;

export class FileError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "FileError";
    this.statusCode = statusCode;
  }
}

/**
 * Read one file from a cloned repository so the code panel can show it.
 *
 * @param {string} root          absolute path of the cloned repo folder
 * @param {string} relativePath  e.g. "src/utils/api.js" (always "/" separators)
 * @returns {Promise<{ content: string, language: string, loc: number }>}
 * @throws {FileError} with a status code the route sends back to the browser
 */
export async function readRepoFile(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new FileError(400, "A file path is required");
  }

  // 1. Reject obviously unsafe paths before touching the disk.
  const cleanPath = relativePath.replace(/\\/g, "/");
  const segments = cleanPath.split("/");
  if (
    cleanPath.includes("\0") ||
    path.isAbsolute(cleanPath) ||
    /^[a-zA-Z]:/.test(cleanPath) ||
    segments.includes("..")
  ) {
    throw new FileError(400, "Invalid file path");
  }

  // 2. Files Nebula never indexes (.git, node_modules, images, lock files...)
  //    are treated as not found.
  if (shouldIgnore(cleanPath)) throw new FileError(404, "File not found");

  // 3. Resolve the real location and make sure it is still inside the repo
  //    (this also stops symlinks that point outside the repo).
  const rootReal = await realpath(root);
  const target = path.resolve(rootReal, cleanPath);
  if (!isInside(rootReal, target)) throw new FileError(400, "Invalid file path");

  let targetReal;
  try {
    targetReal = await realpath(target);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      throw new FileError(404, "File not found");
    }
    throw error;
  }
  if (!isInside(rootReal, targetReal)) throw new FileError(400, "Invalid file path");

  const stats = await lstat(targetReal);
  if (!stats.isFile()) throw new FileError(404, "File not found");
  if (stats.size > MAX_FILE_BYTES) throw new FileError(413, "File is too large to display");

  // 4. Read it and refuse binary data (a NUL byte means "not text").
  const buffer = await readFile(targetReal);
  if (buffer.includes(0)) throw new FileError(415, "Binary files cannot be displayed");

  const content = buffer.toString("utf8").replace(/^\uFEFF/, "");
  return {
    content,
    language: detectLanguage(cleanPath),
    loc: countLines(content),
  };
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
