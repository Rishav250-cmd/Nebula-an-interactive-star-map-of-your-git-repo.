import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { shouldIgnoreEntry } from "./ingest.js";
import { NebulaError } from "./errors.js";

const MAX_ENTRIES = 20_000;
const MAX_UNCOMPRESSED_SIZE = 200 * 1024 * 1024;
const ZIP_SYMLINK_MODE = 0o120000;

export class ZipArchiveError extends NebulaError {
  constructor(message, statusCode = 400) {
    super(statusCode === 413 ? "UPLOAD_TOO_LARGE" : "BAD_UPLOAD", { message });
    this.name = "ZipArchiveError";
    this.statusCode = statusCode;
  }
}

export async function extractZipArchive(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new ZipArchiveError("The uploaded file is not a valid ZIP archive.");
  }

  let entries;
  try {
    entries = zip.getEntries();
  } catch {
    throw new ZipArchiveError("The uploaded file is not a valid ZIP archive.");
  }

  if (entries.length > MAX_ENTRIES) {
    throw new ZipArchiveError(`ZIP archive exceeds the ${MAX_ENTRIES} entry limit.`, 413);
  }

  let declaredSize = 0;
  const paths = entries.map((entry) => {
    declaredSize += Number(entry.header.size) || 0;
    if (declaredSize > MAX_UNCOMPRESSED_SIZE) {
      throw new ZipArchiveError("ZIP archive exceeds the 200 MB uncompressed size limit.", 413);
    }
    return validateArchivePath(entry.entryName);
  });

  const wrapper = findSingleTopLevelFolder(paths, entries);
  const parent = path.join(os.tmpdir(), "nebula");
  await mkdir(parent, { recursive: true });

  let id;
  let targetDir;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    id = randomBytes(5).toString("hex");
    targetDir = path.join(parent, id);
    try {
      await mkdir(targetDir);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 4) throw error;
    }
  }

  try {
    let extractedSize = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const archivePath = paths[index];
      if (!archivePath || isSymlink(entry)) continue;

      const relativePath = wrapper ? stripWrapper(archivePath, wrapper) : archivePath;
      if (!relativePath || shouldIgnoreEntry(archivePath, entry.isDirectory) ||
          shouldIgnoreEntry(relativePath, entry.isDirectory)) continue;

      const destination = path.resolve(targetDir, ...relativePath.split("/"));
      assertContained(targetDir, destination);

      if (entry.isDirectory) {
        await mkdir(destination, { recursive: true });
        continue;
      }

      const data = entry.getData();
      extractedSize += data.length;
      if (extractedSize > MAX_UNCOMPRESSED_SIZE) {
        throw new ZipArchiveError("ZIP archive exceeds the 200 MB uncompressed size limit.", 413);
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, data, { flag: "wx" });
    }

    return { id, dir: targetDir };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    if (error instanceof ZipArchiveError) throw error;
    throw new ZipArchiveError("Could not safely extract ZIP archive.");
  }
}

function validateArchivePath(entryName) {
  if (typeof entryName !== "string" || entryName.includes("\0")) {
    throw new ZipArchiveError("ZIP archive contains an invalid entry path.");
  }

  const normalizedSeparators = entryName.replaceAll("\\", "/");
  if (normalizedSeparators.startsWith("/") || /^[a-zA-Z]:/.test(normalizedSeparators)) {
    throw new ZipArchiveError("ZIP archive contains an entry that escapes its target folder.");
  }

  const normalized = path.posix.normalize(normalizedSeparators);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new ZipArchiveError("ZIP archive contains an entry that escapes its target folder.");
  }

  return normalized.replace(/^\.\//, "").replace(/\/$/, "");
}

function assertContained(root, destination) {
  const relative = path.relative(root, destination);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ZipArchiveError("ZIP archive contains an entry that escapes its target folder.");
  }
}

function isSymlink(entry) {
  return (((entry.attr ?? 0) >>> 16) & 0o170000) === ZIP_SYMLINK_MODE;
}

function findSingleTopLevelFolder(paths, entries) {
  const meaningfulPaths = paths.filter(Boolean);
  if (!meaningfulPaths.length) return null;

  const roots = new Set(meaningfulPaths.map((entryPath) => entryPath.split("/")[0]));
  if (roots.size !== 1) return null;
  const root = [...roots][0];
  if (meaningfulPaths.some((entryPath) => entryPath !== root && !entryPath.startsWith(`${root}/`))) return null;

  const hasFolder = entries.some((entry, index) => paths[index] === root && entry.isDirectory) ||
    meaningfulPaths.some((entryPath) => entryPath.startsWith(`${root}/`));
  return hasFolder ? root : null;
}

function stripWrapper(entryPath, wrapper) {
  if (entryPath === wrapper) return "";
  return entryPath.startsWith(`${wrapper}/`) ? entryPath.slice(wrapper.length + 1) : entryPath;
}
