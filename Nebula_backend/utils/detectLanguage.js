// server/utils/detectLanguage.js
// Returns a language name that react-syntax-highlighter understands.

const EXTENSION_MAP = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.json': 'json',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'markup',
  '.htm': 'markup',
  '.md': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.sh': 'bash',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
};

// Files with no extension but a well-known name
const NAME_MAP = {
  dockerfile: 'docker',
  makefile: 'makefile',
};

/**
 * @param {string} fileName  e.g. "App.jsx" or "src/utils/api.ts"
 * @returns {string} language name, or "plaintext" if unknown
 */
function detectLanguage(fileName) {
  if (typeof fileName !== 'string' || fileName === '') return 'plaintext';

  // Keep only the last part of the path, lowercase for case-insensitive match
  const base = fileName.replace(/\\/g, '/').split('/').pop().toLowerCase();

  if (NAME_MAP[base]) return NAME_MAP[base];

  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'plaintext'; // no extension, or a dotfile like ".gitignore"

  return EXTENSION_MAP[base.slice(dot)] || 'plaintext';
}

export { detectLanguage };
