import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_FILTERS,
  applyFilters,
  fileExtension,
  getFilterOptions,
  hasActiveFilters,
} from '../src/lib/applyFilters.ts';

const node = (id: string, folder: string) => ({
  id,
  folder,
  loc: 10,
  tokens: 50,
  complexity: 1,
  churn: 0,
  healthScore: null,
  isGodFile: false,
  inCycle: false,
  fanIn: 0,
  fanOut: 0,
});

const makeGraph = () => ({
  repo: 'https://github.com/example/repo',
  sha: 'abc123',
  nodes: [
    node('src/index.ts', 'src'),
    node('src/util.js', 'src'),
    node('src/App.tsx', 'src'),
    node('test/index.test.ts', 'test'),
    node('build.js', '.'),
  ],
  edges: [
    { source: 'src/index.ts', target: 'src/util.js', type: 'import' as const },
    { source: 'src/index.ts', target: 'src/App.tsx', type: 'import' as const },
    { source: 'test/index.test.ts', target: 'src/index.ts', type: 'import' as const },
    { source: 'build.js', target: 'src/util.js', type: 'import' as const },
  ],
  cycles: [['src/index.ts', 'src/util.js']],
});

test('fileExtension reads the extension, lowercased, and handles files without one', () => {
  assert.equal(fileExtension('src/App.tsx'), '.tsx');
  assert.equal(fileExtension('types/index.d.ts'), '.ts');
  assert.equal(fileExtension('DATA.JSON'), '.json');
  assert.equal(fileExtension('README'), '(none)');
  assert.equal(fileExtension('docs/.gitignore'), '(none)');
});

test('applyFilters returns the very same graph when nothing is hidden', () => {
  const graph = makeGraph();
  assert.equal(applyFilters(graph, EMPTY_FILTERS), graph);
  assert.equal(applyFilters(null, { hiddenFolders: ['src'], hiddenExtensions: [] }), null);
});

test('hiding a folder removes its files and every edge touching them', () => {
  const result = applyFilters(makeGraph(), { hiddenFolders: ['test'], hiddenExtensions: [] });
  assert.ok(result);
  assert.deepEqual(result.nodes.map((n) => n.id), ['src/index.ts', 'src/util.js', 'src/App.tsx', 'build.js']);
  assert.equal(result.edges.length, 3);
  assert.ok(result.edges.every((e) => e.source !== 'test/index.test.ts'));
});

test('hiding a file type removes those files and their edges', () => {
  const result = applyFilters(makeGraph(), { hiddenFolders: [], hiddenExtensions: ['.ts'] });
  assert.ok(result);
  assert.deepEqual(result.nodes.map((n) => n.id), ['src/util.js', 'src/App.tsx', 'build.js']);
  assert.deepEqual(result.edges, [{ source: 'build.js', target: 'src/util.js', type: 'import' }]);
});

test('folder and type filters combine, and the root folder "." can be hidden', () => {
  const result = applyFilters(makeGraph(), { hiddenFolders: ['test', '.'], hiddenExtensions: ['.tsx'] });
  assert.ok(result);
  assert.deepEqual(result.nodes.map((n) => n.id), ['src/index.ts', 'src/util.js']);
  assert.equal(result.edges.length, 1);
});

test('applyFilters keeps cycles and other fields, and does not change its input', () => {
  const graph = makeGraph();
  const before = JSON.stringify(graph);
  const result = applyFilters(graph, { hiddenFolders: ['src'], hiddenExtensions: [] });
  assert.ok(result);
  assert.equal(result.repo, graph.repo);
  assert.equal(result.sha, graph.sha);
  assert.deepEqual(result.cycles, graph.cycles);
  assert.equal(JSON.stringify(graph), before);
});

test('hiding everything gives an empty graph instead of an error', () => {
  const result = applyFilters(makeGraph(), { hiddenFolders: ['src', 'test', '.'], hiddenExtensions: [] });
  assert.ok(result);
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.edges, []);
});

test('hasActiveFilters is true only when something is hidden', () => {
  assert.equal(hasActiveFilters(EMPTY_FILTERS), false);
  assert.equal(hasActiveFilters({ hiddenFolders: ['src'], hiddenExtensions: [] }), true);
  assert.equal(hasActiveFilters({ hiddenFolders: [], hiddenExtensions: ['.js'] }), true);
});

test('getFilterOptions counts folders and types, biggest first', () => {
  const { folders, extensions } = getFilterOptions(makeGraph());
  assert.deepEqual(folders, [
    { name: 'src', count: 3 },
    { name: '.', count: 1 },
    { name: 'test', count: 1 },
  ]);
  assert.deepEqual(extensions, [
    { name: '.js', count: 2 }, // tie with .ts: alphabetical
    { name: '.ts', count: 2 },
    { name: '.tsx', count: 1 },
  ]);
  assert.deepEqual(getFilterOptions(null), { folders: [], extensions: [] });
});
