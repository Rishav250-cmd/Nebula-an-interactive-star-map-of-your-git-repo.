import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFolderGraphData } from '../src/lib/folderGraph.ts';
import type { GraphEdge, GraphNode } from '../src/types/graph.ts';

function makeNode(index: number): GraphNode {
  const folder = ['src', 'packages', 'tests', 'scripts'][index % 4];
  return {
    id: `${folder}/area-${index % 5}/file-${index}.ts`,
    folder: `${folder}/area-${index % 5}`,
    loc: 10,
    tokens: 40,
    complexity: 2,
    churn: 0,
    healthScore: null,
    isGodFile: false,
    inCycle: false,
    fanIn: 0,
    fanOut: 0,
  };
}

test('groups a 2,000-file graph into top-level folders with aggregated links', () => {
  const nodes = Array.from({ length: 2_000 }, (_, index) => makeNode(index));
  const edges: GraphEdge[] = nodes.map((node, index) => ({
    source: node.id,
    target: nodes[(index + 1) % nodes.length].id,
    type: 'import',
  }));

  const grouped = buildFolderGraphData(nodes, edges, new Set(), new Map());
  assert.equal(grouped.nodes.length, 4);
  assert.equal(grouped.nodes.reduce((sum, node) => sum + node.fileCount!, 0), 2_000);
  assert.equal(grouped.nodes.reduce((sum, node) => sum + node.loc, 0), 20_000);
  assert.ok(grouped.nodes.every((node) => node.isFolderGroup));
  assert.ok(grouped.links.length <= 4);
  assert.equal(grouped.links.reduce((sum, edge) => sum + (edge.aggregateCount ?? 0), 0), 2_000);
});

test('expands one folder into files and preserves positions for a smooth collapse', () => {
  const nodes = Array.from({ length: 40 }, (_, index) => makeNode(index));
  const edges: GraphEdge[] = nodes.slice(0, -1).map((node, index) => ({
    source: node.id,
    target: nodes[index + 1].id,
    type: 'import',
  }));
  const srcGroupId = 'folder:src';
  const groupPosition = { x: 120, y: -45 };
  const expanded = buildFolderGraphData(
    nodes,
    edges,
    new Set(['src']),
    new Map([[srcGroupId, groupPosition]]),
  );

  const srcMembers = nodes.filter((node) => node.folder.startsWith('src/'));
  const srcFiles = expanded.nodes.filter((node) => srcMembers.some((member) => member.id === node.id));
  assert.equal(srcFiles.length, srcMembers.length);
  assert.ok(srcFiles.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.deepEqual(
    expanded.nodes.find((node) => node.id === srcGroupId) && {
      x: expanded.nodes.find((node) => node.id === srcGroupId)?.x,
      y: expanded.nodes.find((node) => node.id === srcGroupId)?.y,
    },
    groupPosition,
  );
  assert.ok(expanded.links.some((edge) => edge.source === srcMembers[0].id));

  const collapsed = buildFolderGraphData(nodes, edges, new Set(), new Map([[srcGroupId, groupPosition]]));
  assert.equal(collapsed.nodes.filter((node) => node.folder === 'src').length, 1);
  assert.deepEqual(
    { x: collapsed.nodes.find((node) => node.id === srcGroupId)?.x, y: collapsed.nodes.find((node) => node.id === srcGroupId)?.y },
    groupPosition,
  );
});
