import test from 'node:test';
import assert from 'node:assert';
import { detectLanguage } from '../utils/detectLanguage.js';

test('.js is javascript', () => {
  assert.strictEqual(detectLanguage('index.js'), 'javascript');
});

test('.jsx is jsx and .tsx is tsx', () => {
  assert.strictEqual(detectLanguage('App.jsx'), 'jsx');
  assert.strictEqual(detectLanguage('App.tsx'), 'tsx');
});

test('.ts is typescript', () => {
  assert.strictEqual(detectLanguage('server.ts'), 'typescript');
});

test('works with full paths', () => {
  assert.strictEqual(detectLanguage('src/utils/api.py'), 'python');
});

test('is case-insensitive', () => {
  assert.strictEqual(detectLanguage('README.MD'), 'markdown');
});

test('unknown extension returns plaintext', () => {
  assert.strictEqual(detectLanguage('notes.xyz'), 'plaintext');
});

test('no extension / dotfile returns plaintext', () => {
  assert.strictEqual(detectLanguage('LICENSE'), 'plaintext');
  assert.strictEqual(detectLanguage('.gitignore'), 'plaintext');
});

test('Dockerfile is recognised by name', () => {
  assert.strictEqual(detectLanguage('Dockerfile'), 'docker');
});

test('empty or invalid input returns plaintext', () => {
  assert.strictEqual(detectLanguage(''), 'plaintext');
  assert.strictEqual(detectLanguage(undefined), 'plaintext');
});
