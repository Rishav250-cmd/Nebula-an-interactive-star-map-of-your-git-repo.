import type { GraphEdge, GraphNode } from '../types/graph';
import { resolveEndpoints } from '../utils/graphEdges.ts';

export type NodePosition = { x: number; y: number };
export type PositionedGraphNode = GraphNode & { x?: number; y?: number };

export function topLevelFolder(folder: string): string {
  if (!folder || folder === '.') return '.';
  return folder.split('/')[0] || '.';
}

export function folderGroupId(folder: string): string {
  return `folder:${folder}`;
}

export function buildFolderGraphData(
  fileNodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  expandedFolders: ReadonlySet<string>,
  cachedPositions: ReadonlyMap<string, NodePosition>,
): { nodes: PositionedGraphNode[]; links: GraphEdge[] } {
  const filesByFolder = new Map<string, GraphNode[]>();
  const folderByFileId = new Map<string, string>();
  for (const node of fileNodes) {
    const folder = topLevelFolder(node.folder);
    const members = filesByFolder.get(folder) ?? [];
    members.push(node);
    filesByFolder.set(folder, members);
    folderByFileId.set(node.id, folder);
  }

  const nodes: PositionedGraphNode[] = [];
  for (const [folder, members] of filesByFolder) {
    const groupId = folderGroupId(folder);
    const groupNode: GraphNode = {
      id: groupId,
      folder,
      loc: members.reduce((sum, node) => sum + node.loc, 0),
      tokens: members.reduce((sum, node) => sum + node.tokens, 0),
      complexity: members.reduce((sum, node) => sum + node.complexity, 0),
      churn: members.reduce((sum, node) => sum + node.churn, 0),
      healthScore: null,
      isGodFile: members.some((node) => node.isGodFile),
      inCycle: members.some((node) => node.inCycle),
      fanIn: members.reduce((sum, node) => sum + node.fanIn, 0),
      fanOut: members.reduce((sum, node) => sum + node.fanOut, 0),
      functionCount: members.reduce((sum, node) => sum + (node.functionCount ?? 0), 0),
      isFolderGroup: true,
      fileCount: members.length,
      memberIds: members.map((node) => node.id),
    };

    let groupX = 0;
    let groupY = 0;
    let positionedMembers = 0;
    for (const member of members) {
      const position = cachedPositions.get(member.id);
      if (!position) continue;
      groupX += position.x;
      groupY += position.y;
      positionedMembers += 1;
    }
    const cachedGroupPosition = cachedPositions.get(groupId);
    const groupPosition = cachedGroupPosition ?? (positionedMembers > 0
      ? { x: groupX / positionedMembers, y: groupY / positionedMembers }
      : null);
    nodes.push(groupPosition ? { ...groupNode, ...groupPosition } : groupNode);

    if (!expandedFolders.has(folder)) continue;
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const position = cachedPositions.get(member.id);
      if (position) {
        nodes.push({ ...member, ...position });
      } else if (groupPosition) {
        const angle = index * 2.399963229728653;
        const distance = 22 + Math.sqrt(index) * 9;
        nodes.push({
          ...member,
          x: groupPosition.x + Math.cos(angle) * distance,
          y: groupPosition.y + Math.sin(angle) * distance,
        });
      } else {
        nodes.push({ ...member });
      }
    }
  }

  const aggregatedEdges = new Map<string, GraphEdge>();
  for (const edge of edges) {
    const { sourceId, targetId } = resolveEndpoints(edge);
    if (!sourceId || !targetId) continue;
    const sourceFolder = folderByFileId.get(sourceId);
    const targetFolder = folderByFileId.get(targetId);
    if (!sourceFolder || !targetFolder) continue;
    const source = expandedFolders.has(sourceFolder) ? sourceId : folderGroupId(sourceFolder);
    const target = expandedFolders.has(targetFolder) ? targetId : folderGroupId(targetFolder);
    if (source === target) continue;
    const key = JSON.stringify([source, target, edge.type]);
    const existing = aggregatedEdges.get(key);
    if (existing) {
      existing.aggregateCount = (existing.aggregateCount ?? 1) + (edge.aggregateCount ?? 1);
      existing.inCycle = existing.inCycle === true || edge.inCycle === true;
    } else {
      aggregatedEdges.set(key, { ...edge, source, target, aggregateCount: edge.aggregateCount ?? 1 });
    }
  }

  return { nodes, links: [...aggregatedEdges.values()] };
}
