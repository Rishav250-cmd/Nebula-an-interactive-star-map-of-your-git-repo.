import { createHash } from "node:crypto";
import { readdir, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";

const skippedDirectories = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
]);
const skippedExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".pdf",
  ".woff",
  ".woff2",
]);

export function cloneLocationForUrl(url) {
  const id = repoIdFor(url);
  const dir = path.join(os.tmpdir(), "nebula", id);
  return { id, dir };
}

export function repoIdFor(url) {
  return createHash("sha1").update(url).digest("hex").slice(0, 10);
}

export async function cloneRepo(url) {
  const { id, dir } = cloneLocationForUrl(url);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.dirname(dir), { recursive: true });
  await simpleGit().clone(url, dir, ["--depth", "200"]);
  const sha = (await simpleGit(dir).revparse(["HEAD"])).trim();

  return { id, dir, sha };
}

export async function listFiles(root) {
  const files = [];

  async function visit(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        if (!shouldIgnoreEntry(relativePath, true)) {
          await visit(path.join(directory, entry.name), relativePath);
        }
      } else if (entry.isFile() && !shouldIgnoreEntry(relativePath, false)) {
        files.push(relativePath);
      }
    }
  }

  await visit(root);
  return files;
}

export function buildTree(files) {
  const tree = {};

  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    let current = tree;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isFile = index === parts.length - 1;

      if (!Object.hasOwn(current, part)) {
        Object.defineProperty(current, part, {
          value: isFile ? null : {},
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }

      if (!isFile) current = current[part];
    }
  }

  return tree;
}

export function shouldIgnoreEntry(relativePath, isDirectory = false) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const directoryParts = isDirectory ? parts : parts.slice(0, -1);
  if (directoryParts.some((part) => skippedDirectories.has(part))) return true;

  const filename = parts.at(-1) ?? "";
  const lowerName = filename.toLowerCase();
  const extension = path.extname(lowerName);

  return (
    !isDirectory &&
    (lowerName.endsWith(".lock") ||
      lowerName.endsWith("-lock.json") ||
      lowerName.endsWith(".min.js") ||
      skippedExtensions.has(extension))
  );
}
