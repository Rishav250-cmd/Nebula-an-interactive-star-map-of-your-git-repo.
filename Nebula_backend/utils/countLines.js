// server/utils/countLines.js

/**
 * Count the lines of code (LOC) in a piece of text.
 * Rules:
 *  - empty string or non-string -> 0
 *  - works with both Unix (\n) and Windows (\r\n) line endings
 *  - a single trailing newline does NOT add an extra line
 *  - blank lines in the middle DO count (simple and predictable)
 *
 * @param {string} text
 * @returns {number}
 */
function countLines(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;

  const lines = text.split(/\r\n|\r|\n/);

  // "a\nb\n" splits into ["a", "b", ""] -> the last empty piece is not a real line
  if (lines[lines.length - 1] === '') lines.pop();

  return lines.length;
}

export { countLines };
