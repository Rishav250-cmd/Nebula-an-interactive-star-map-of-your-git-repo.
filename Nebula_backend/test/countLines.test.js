import test from 'node:test';
import assert from 'node:assert';
import { countLines } from '../utils/countLines.js';

test('empty string has 0 lines', () => {
  assert.strictEqual(countLines(''), 0);
});

test('single line without newline is 1 line', () => {
  assert.strictEqual(countLines('hello'), 1);
});

test('three lines separated by \\n', () => {
  assert.strictEqual(countLines('a\nb\nc'), 3);
});

test('trailing newline does not add an extra line', () => {
  assert.strictEqual(countLines('a\nb\n'), 2);
});

test('Windows \\r\\n line endings are handled', () => {
  assert.strictEqual(countLines('a\r\nb\r\nc\r\n'), 3);
});

test('blank lines in the middle still count', () => {
  assert.strictEqual(countLines('a\n\nb'), 3);
});

test('non-string input returns 0', () => {
  assert.strictEqual(countLines(null), 0);
  assert.strictEqual(countLines(undefined), 0);
  assert.strictEqual(countLines(42), 0);
});
