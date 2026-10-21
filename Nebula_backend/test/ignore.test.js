import test from 'node:test';
import assert from 'node:assert';
import { shouldIgnore } from '../ignore.js';

test('ignores node_modules at any depth', () => {
  assert.strictEqual(shouldIgnore('node_modules/react/index.js'), true);
  assert.strictEqual(shouldIgnore('client/node_modules/x/y.js'), true);
});

test('ignores dist, build and .git folders', () => {
  assert.strictEqual(shouldIgnore('dist/bundle.js'), true);
  assert.strictEqual(shouldIgnore('build/out.js'), true);
  assert.strictEqual(shouldIgnore('.git/config'), true);
});

test('ignores lock files and minified files', () => {
  assert.strictEqual(shouldIgnore('yarn.lock'), true);
  assert.strictEqual(shouldIgnore('package-lock.json'), true);
  assert.strictEqual(shouldIgnore('public/jquery.min.js'), true);
});

test('ignores images', () => {
  assert.strictEqual(shouldIgnore('assets/logo.png'), true);
  assert.strictEqual(shouldIgnore('assets/PHOTO.JPG'), true);
});

test('keeps normal source files', () => {
  assert.strictEqual(shouldIgnore('src/utils/api.js'), false);
  assert.strictEqual(shouldIgnore('server/index.ts'), false);
});

test('a file merely named like a folder is NOT ignored', () => {
  assert.strictEqual(shouldIgnore('src/build.js'), false);
});
