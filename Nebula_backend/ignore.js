// server/ignore.js
// Things Nebula should skip when reading a cloned repo.
// Why? They are huge, generated, or not source code, so they would
// slow down parsing and clutter the graph.

// Folders: skip if ANY part of the path is one of these names.
const IGNORED_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'vendor',
  'coverage',
  'third_party',
  'out',
  'target',
  '.next',
  'bower_components',
];

// File name patterns (matched against the end of the file name).
const IGNORED_FILE_PATTERNS = [
  /\.lock$/i,        // package-lock.json is handled below; this covers yarn.lock, Cargo.lock...
  /\.min\.js$/i,     // minified JavaScript
  /\.min\.css$/i,    // minified CSS
  /\.map$/i,         // source maps
  /(?:^|[._-])(?:bundle|chunk)(?:[._-]|$)/i,
  /(?:^|[._-])generated(?:[._-]|$)/i,
];

// Exact file names to skip.
const IGNORED_FILE_NAMES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  '.DS_Store',
];

// Images and other binary files (never useful in a code graph).
const IGNORED_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',
  '.pdf', '.zip', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3',
  '.avif', '.tif', '.tiff', '.webm', '.mov', '.ogg', '.otf', '.fon',
];

/**
 * Should this path be skipped?
 * @param {string} filePath  e.g. "src/utils/api.js" or "node_modules/react/index.js"
 * @returns {boolean}
 */
function shouldIgnore(filePath, isDirectory = false) {
  if (typeof filePath !== 'string' || filePath === '') return true;

  // Normalise Windows slashes so the rest of the code only deals with "/"
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const fileName = parts[parts.length - 1];
  const folders = isDirectory ? parts : parts.slice(0, -1);

  // 1. Is any parent folder on the ignore list?
  if (folders.some((folder) => IGNORED_DIRS.includes(folder.toLowerCase()))) return true;
  if (isDirectory) return false;

  // 2. Exact file name match
  if (IGNORED_FILE_NAMES.includes(fileName.toLowerCase())) return true;

  // 3. Pattern match (*.lock, *.min.js ...)
  if (IGNORED_FILE_PATTERNS.some((re) => re.test(fileName))) return true;

  // 4. Image / binary extension
  const lower = fileName.toLowerCase();
  if (IGNORED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;

  return false;
}

export {
  IGNORED_DIRS,
  IGNORED_FILE_PATTERNS,
  IGNORED_FILE_NAMES,
  IGNORED_EXTENSIONS,
  shouldIgnore,
};
