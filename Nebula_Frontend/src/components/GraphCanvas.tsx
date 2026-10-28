import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type GraphData as ForceGraphData,
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { forceCollide } from 'd3-force-3d';
import { NodeTooltip } from './NodeTooltip';
import { LoadingOverlay } from './LoadingOverlay';
import { ErrorState } from './ErrorState';
import { GraphLegend } from './GraphLegend';
import { FunctionGraphCanvas } from './FunctionGraphCanvas';
import { useGraphStore } from '../store/useGraphStore';
import { applyFilters } from '../lib/applyFilters';
import type { GraphEdge, GraphNode } from '../types/graph';
import { resolveEndpoints, type LinkEndpoints } from '../utils/graphEdges';
import { buildAdjacency } from '../lib/graphHighlight';
import { fetchHealth } from '../api/client';
import { folderColor, folderLegend, nodeRadius } from '../lib/graphStyle';
import {
  GRAPH_PERFORMANCE_THRESHOLDS,
  graphPerformanceForNodeCount,
} from '../lib/graphPerformance';
import { buildFolderGraphData, topLevelFolder } from '../lib/folderGraph';
type GraphInstance = ForceGraphMethods<
  NodeObject<GraphNode>,
  LinkObject<GraphNode, GraphEdge>
>;

type EdgeDirection = 'outgoing' | 'incoming' | 'unrelated';
function nodeImportance(node: GraphNode): number {
  const fanIn = Number.isFinite(node.fanIn) ? Math.max(0, node.fanIn) : 0;
  const fanOut = Number.isFinite(node.fanOut) ? Math.max(0, node.fanOut) : 0;
  const loc = Number.isFinite(node.loc) ? Math.max(0, node.loc) : 0;
  return fanIn * 4 + fanOut * 2 + Math.log1p(loc);
}

function uniqueLinks(edges: readonly GraphEdge[], nodeIds: ReadonlySet<string>): GraphEdge[] {
  const seen = new Set<string>();
  const links: GraphEdge[] = [];

  for (const edge of edges) {
    const { sourceId, targetId } = resolveEndpoints(edge);
    if (!sourceId || !targetId || !nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue;

    const key = JSON.stringify([sourceId, targetId, edge.type]);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ ...edge });
  }

  return links;
}

function truncateLabel(label: string, maxLength = 32): string {
  if (label.length <= maxLength) return label;
  const visibleLength = maxLength - 1;
  const prefixLength = Math.ceil(visibleLength / 2);
  const suffixLength = Math.floor(visibleLength / 2);
  return `${label.slice(0, prefixLength)}…${label.slice(-suffixLength)}`;
}

const OUTGOING_COLOR = 'rgba(94, 234, 212, 0.96)';
const INCOMING_COLOR = 'rgba(251, 191, 36, 0.96)';
const CYCLE_COLOR = '#F87171';

function endpointPosition(endpoint: unknown): { x: number; y: number } | null {
  if (typeof endpoint !== 'object' || endpoint === null || !('x' in endpoint) || !('y' in endpoint)) {
    return null;
  }
  const { x, y } = endpoint as { x?: unknown; y?: unknown };
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
    ? { x, y }
    : null;
}

function edgeDirection(link: LinkEndpoints, selectedId: string | null): EdgeDirection {
  if (!selectedId) return 'unrelated';
  const { sourceId, targetId } = resolveEndpoints(link);
  if (sourceId === selectedId) return 'outgoing';
  if (targetId === selectedId) return 'incoming';
  return 'unrelated';
}

function withAlpha(color: string, alpha: number): string {
  const normalizedAlpha = Math.round(alpha * 100) / 100;
  const cacheKey = `${color}:${normalizedAlpha}`;
  const cachedColor = alphaColorCache.get(cacheKey);
  if (cachedColor) return cachedColor;
  const hex = color.slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const result = `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
  alphaColorCache.set(cacheKey, result);
  return result;
}

const alphaColorCache = new Map<string, string>();

function healthColor(score: number | null): string {
  if (score === null) return '#94a3b8';
  if (score >= 75) return '#34d399';
  if (score >= 45) return '#fbbf24';
  return '#fb7185';
}

export function GraphCanvas() {
  const graph = useGraphStore((state) => state.graph);
  const analysisId = useGraphStore((state) => state.analysisId);
  const healthReport = useGraphStore((state) => state.healthReport);
  const setHealthReport = useGraphStore((state) => state.setHealthReport);
  const phase = useGraphStore((state) => state.phase);
  const phaseStartedAt = useGraphStore((state) => state.phaseStartedAt);
  const error = useGraphStore((state) => state.error);
  const lastUrl = useGraphStore((state) => state.lastUrl);
  const analyze = useGraphStore((state) => state.analyze);
  const selectedId = useGraphStore((state) => state.selectedId);
  const selectedCycleIndex = useGraphStore((state) => state.selectedCycleIndex);
  const importsVisible = useGraphStore((state) => state.edgeToggles.imports);
  const callsVisible = useGraphStore((state) => state.edgeToggles.calls);
  const cyclesVisible = useGraphStore((state) => state.edgeToggles.cycles);
  const filters = useGraphStore((state) => state.filters);
  const toggleEdges = useGraphStore((state) => state.toggleEdges);
  const hoveredId = useGraphStore((state) => state.hoveredId);
  const focusRequest = useGraphStore((state) => state.focusRequest);
  const focusLine = useGraphStore((state) => state.focusLine);
  const clearFocus = useGraphStore((state) => state.clearFocus);
  const focusNode = useGraphStore((state) => state.focusNode);
  const hoverNode = useGraphStore((state) => state.hoverNode);
  const viewMode = useGraphStore((state) => state.viewMode);
  const setViewMode = useGraphStore((state) => state.setViewMode);

  const containerRef = useRef<HTMLElement | null>(null);
  const graphRef = useRef<GraphInstance | undefined>(undefined);
  const hasFittedGraph = useRef(false);
  const reheatedGraph = useRef(graph);
  const handledFocusRequest = useRef(focusRequest);
  const labelBounds = useRef(new Float32Array(0));
  const labelBoundsCount = useRef(0);
  const renderedNodes = useRef<NodeObject<GraphNode>[]>([]);
  const cyclePulseAlpha = useRef(0.35);
  const handledSymbolFocusRequest = useRef(focusRequest);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [symbolPulse, setSymbolPulse] = useState<{ id: string; startedAt: number } | null>(null);
  const [groupByFolderOverride, setGroupByFolderOverride] = useState<boolean | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const nodePositions = useRef(new Map<string, { x: number; y: number }>());

  useEffect(() => {
    if (!analysisId) {
      setHealthReport(null);
      return undefined;
    }
    const controller = new AbortController();
    fetchHealth(analysisId, controller.signal)
      .then((report) => setHealthReport(report))
      .catch(() => {
        if (controller.signal.aborted) return;
        setHealthReport(null);
      });
    return () => controller.abort();
  }, [analysisId, setHealthReport]);

  // The graph without the files hidden in the filter panel (same object when no filter is active).
  const visibleGraph = useMemo(() => applyFilters(graph, filters), [graph, filters]);
  const groupByFolder = groupByFolderOverride
    ?? ((graph?.nodes.length ?? 0) > GRAPH_PERFORMANCE_THRESHOLDS.simplifiedRendering);

  const rememberNodePositions = useCallback(() => {
    for (const node of renderedNodes.current) {
      if (
        node.id !== undefined
        && typeof node.x === 'number' && Number.isFinite(node.x)
        && typeof node.y === 'number' && Number.isFinite(node.y)
      ) nodePositions.current.set(String(node.id), { x: node.x, y: node.y });
    }
  }, []);

  const toggleFolderExpansion = useCallback((folder: string) => {
    rememberNodePositions();
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }, [rememberNodePositions]);

  const toggleFolderGrouping = useCallback(() => {
    rememberNodePositions();
    setExpandedFolders(new Set());
    setGroupByFolderOverride(!groupByFolder);
  }, [groupByFolder, rememberNodePositions]);

  useEffect(() => {
    nodePositions.current.clear();
    setExpandedFolders((current) => current.size === 0 ? current : new Set());
    setGroupByFolderOverride(null);
  }, [graph]);

  const graphData = useMemo<ForceGraphData<GraphNode, GraphEdge>>(
    () => {
      // ForceGraph mutates nodes and links with simulation coordinates.
      const fileNodes = visibleGraph?.nodes ?? [];
      let nodes: NodeObject<GraphNode>[];
      let links: GraphEdge[];

      if (!groupByFolder) {
        nodes = fileNodes.map((node) => {
          const position = nodePositions.current.get(node.id);
          return position ? { ...node, ...position } : { ...node };
        });
        links = visibleGraph?.edges ?? [];
      } else {
        const grouped = buildFolderGraphData(
          fileNodes,
          visibleGraph?.edges ?? [],
          expandedFolders,
          nodePositions.current,
        );
        nodes = grouped.nodes;
        links = grouped.links;
      }

      nodes.sort((left, right) => (
        nodeImportance(right) - nodeImportance(left) || left.id.localeCompare(right.id)
      ));
      const nodeIds = new Set(nodes.map((node) => node.id));
      return {
        nodes,
        links: uniqueLinks(links, nodeIds),
      };
    },
    [expandedFolders, groupByFolder, visibleGraph],
  );
  renderedNodes.current = graphData.nodes;
  const performanceNodeCount = Math.max(
    graphData.nodes.length,
    groupByFolder ? graph?.nodes.length ?? 0 : 0,
  );
  const performanceMode = graphPerformanceForNodeCount(performanceNodeCount);
  const nodeRenderData = useMemo(() => new Map(graphData.nodes.map((node) => [
    node.id,
    {
      radius: node.isFolderGroup
        ? Math.min(28, 9 + Math.sqrt(Math.max(0, node.loc)) * 0.08)
        : nodeRadius(node.loc),
      label: truncateLabel(node.isFolderGroup
        ? `${node.folder === '.' ? 'Root' : node.folder} · ${node.fileCount ?? 0}`
        : node.id.split('/').pop() ?? ''),
    },
  ] as const)), [graphData]);
  const truncatedCounts = graph?.meta?.truncated
    ? {
      analyzed: graph.meta.analyzedFiles ?? graph.nodes.length,
      total: graph.meta.totalCodeFiles ?? graph.nodes.length,
    }
    : null;
  const labelPriority = useMemo(
    () => new Map(graphData.nodes.map((node, index) => [node.id, index] as const)),
    [graphData],
  );

  const allFolders = useMemo(() => graph?.nodes.map((node) => node.folder) ?? [], [graph]);
  const colorByFolder = useMemo(() => new Map(
    [...new Set(allFolders)].map((folder) => [folder, folderColor(folder, allFolders)] as const),
  ), [allFolders]);
  const colorById = useMemo(() => new Map(
    graphData.nodes.map((node) => [node.id, colorByFolder.get(node.folder) ?? '#a0aec0'] as const),
  ), [colorByFolder, graphData]);
  const healthById = useMemo(() => new Map(
    healthReport?.files.map((file) => [file.id, file] as const) ?? [],
  ), [healthReport]);
  const graphNodeById = useMemo(() => new Map(
    graph?.nodes.map((node) => [node.id, node] as const) ?? [],
  ), [graph]);
  const healthScoreById = useMemo(() => new Map(
    graphData.nodes.map((node) => {
      if (node.isFolderGroup) {
        let scoreTotal = 0;
        let scoreCount = 0;
        for (const memberId of node.memberIds ?? []) {
          const score = healthById.get(memberId)?.healthScore
            ?? graphNodeById.get(memberId)?.healthScore;
          if (score === null || score === undefined) continue;
          scoreTotal += score;
          scoreCount += 1;
        }
        return [node.id, scoreCount > 0 ? scoreTotal / scoreCount : null] as const;
      }
      return [
        node.id,
        healthById.get(node.id)?.healthScore ?? node.healthScore ?? null,
      ] as const;
    }),
  ), [graphData, graphNodeById, healthById]);
  const legend = useMemo(() => folderLegend(allFolders, 8), [allFolders]);
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const graphSelectedId = graph?.nodes.some((node) => node.id === selectedId) ? selectedId : null;
  const selectedCycleNodeIds = useMemo(
    () => new Set(selectedCycleIndex === null ? [] : graph?.cycles[selectedCycleIndex] ?? []),
    [graph, selectedCycleIndex],
  );
  const hasActiveFocus = graphSelectedId !== null || selectedCycleIndex !== null;
  const cycleEdgeCount = useMemo(
    () => graphData.links.reduce((count, link) => count + Number(link.inCycle === true), 0),
    [graphData],
  );
  const hasCycleEdges = cycleEdgeCount > 0;
  const animateCyclePulse = cycleEdgeCount <= 300 && performanceMode.tier === 'full';

  const blastDistanceById = useMemo(() => {
    const distances = new Map<string, number>();
    if (!graphSelectedId) return distances;
    distances.set(graphSelectedId, 0);
    const queue = [graphSelectedId];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const distance = distances.get(current) ?? 0;
      if (distance >= 4) continue;
      const neighbors = new Set([
        ...(adjacency.imports.get(current) ?? []),
        ...(adjacency.importers.get(current) ?? []),
      ]);
      for (const neighbor of neighbors) {
        if (distances.has(neighbor)) continue;
        distances.set(neighbor, distance + 1);
        queue.push(neighbor);
      }
    }
    return distances;
  }, [adjacency, graphSelectedId]);
  const blastCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const distance of blastDistanceById.values()) counts[distance] += 1;
    return counts;
  }, [blastDistanceById]);
  const relatedNodeIds = blastDistanceById;
  const isHighlightedLink = useCallback((link: LinkEndpoints) => {
    if (selectedCycleIndex !== null) {
      const { sourceId, targetId } = resolveEndpoints(link);
      return link.inCycle === true
        && sourceId !== null
        && targetId !== null
        && selectedCycleNodeIds.has(sourceId)
        && selectedCycleNodeIds.has(targetId);
    }
    const { sourceId, targetId } = resolveEndpoints(link);
    const sourceDistance = sourceId ? blastDistanceById.get(sourceId) : undefined;
    const targetDistance = targetId ? blastDistanceById.get(targetId) : undefined;
    return edgeDirection(link, graphSelectedId) !== 'unrelated'
      || (sourceDistance !== undefined && targetDistance !== undefined
        && Math.abs(sourceDistance - targetDistance) === 1);
  }, [blastDistanceById, graphSelectedId, selectedCycleIndex, selectedCycleNodeIds]);

  useEffect(() => {
    if (!selectedId && selectedCycleIndex === null) return;
    const clearSelectionOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearFocus();
    };
    window.addEventListener('keydown', clearSelectionOnEscape);
    return () => window.removeEventListener('keydown', clearSelectionOnEscape);
  }, [clearFocus, selectedCycleIndex, selectedId]);

  useEffect(() => {
    if (focusRequest === handledSymbolFocusRequest.current) return;
    handledSymbolFocusRequest.current = focusRequest;
    if (viewMode !== 'file' || !selectedId || focusLine === null) return;

    setSymbolPulse({ id: selectedId, startedAt: performance.now() });
    const timeoutId = window.setTimeout(() => setSymbolPulse(null), 1_500);
    return () => window.clearTimeout(timeoutId);
  }, [focusLine, focusRequest, selectedId, viewMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = (width: number, height: number) => {
      const nextSize = { width: Math.floor(width), height: Math.floor(height) };
      setCanvasSize((currentSize) => (
        currentSize.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize
      ));
    };

    updateSize(container.clientWidth, container.clientHeight);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    hasFittedGraph.current = false;
  }, [visibleGraph]);

  useEffect(() => {
    if (groupByFolder || !hasFittedGraph.current || graphData.nodes.length === 0) return;
    graphRef.current?.zoomToFit(600, 60);
  }, [canvasSize.height, canvasSize.width, graphData.nodes.length, groupByFolder]);

  useEffect(() => {
    const graphInstance = graphRef.current;
    if (!graphInstance || graphData.nodes.length === 0) return;

    graphInstance.d3Force(
      'collide',
      forceCollide<NodeObject<GraphNode>>((node) => (nodeRenderData.get(String(node.id))?.radius ?? 3) + 3),
    );
    graphInstance.d3Force('charge')?.strength(graphData.nodes.length > 40 ? -34 : -30);
    if (reheatedGraph.current !== graph) {
      reheatedGraph.current = graph;
      graphInstance.d3ReheatSimulation();
    }
  }, [graph, graphData, nodeRenderData]);

  const groupLayoutKey = `${groupByFolder ? 'grouped' : 'files'}:${[...expandedFolders].sort().join('|')}`;
  const previousGroupLayoutKey = useRef(groupLayoutKey);
  useEffect(() => {
    if (previousGroupLayoutKey.current === groupLayoutKey) return;
    previousGroupLayoutKey.current = groupLayoutKey;
    graphRef.current?.d3ReheatSimulation();
  }, [groupLayoutKey]);

  useEffect(() => {
    if (
      focusRequest === handledFocusRequest.current
      || !selectedId
      || graphData.nodes.length === 0
      || viewMode === 'function'
    ) return;

    const selectedFile = graph?.nodes.find((candidate) => candidate.id === selectedId);
    if (groupByFolder && selectedFile) {
      const folder = topLevelFolder(selectedFile.folder);
      if (!expandedFolders.has(folder)) {
        rememberNodePositions();
        setExpandedFolders((current) => new Set(current).add(folder));
        return;
      }
    }

    const node = graphData.nodes.find((candidate) => candidate.id === selectedId);
    if (!node) return;
    handledFocusRequest.current = focusRequest;

    const startedAt = performance.now();
    let lastX: number | null = null;
    let lastY: number | null = null;
    let stableFrames = 0;
    let frameId = 0;
    const focusSelectedNode = () => {
      if (node && typeof node.x === 'number' && typeof node.y === 'number') {
        if (lastX !== null && lastY !== null && Math.hypot(node.x - lastX, node.y - lastY) < 0.15) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        lastX = node.x;
        lastY = node.y;

        if (stableFrames >= 5 || performance.now() - startedAt >= 4_000) {
          graphRef.current?.centerAt(node.x, node.y, 450);
          graphRef.current?.zoom(3, 450);
          return;
        }
      }

      if (performance.now() - startedAt < 5_000) {
        frameId = requestAnimationFrame(focusSelectedNode);
      }
    };

    frameId = requestAnimationFrame(focusSelectedNode);
    return () => cancelAnimationFrame(frameId);
  }, [expandedFolders, focusRequest, graph, graphData.nodes, groupByFolder, rememberNodePositions, selectedId, viewMode]);

  useEffect(() => {
    if (selectedCycleIndex === null) return;
    const cycle = graph?.cycles[selectedCycleIndex];
    if (!cycle?.length) return;
    const cycleNodeIds = new Set(cycle);
    const startedAt = performance.now();
    let previousPositions: number[] | null = null;
    let stableFrames = 0;
    let frameId = 0;

    const fitCycleWhenStable = () => {
      const nodes = graphData.nodes.filter((node) => cycleNodeIds.has(node.id));
      const positions = nodes.flatMap((node) => (
        typeof node.x === 'number' && Number.isFinite(node.x)
        && typeof node.y === 'number' && Number.isFinite(node.y)
          ? [node.x, node.y]
          : []
      ));
      const elapsed = performance.now() - startedAt;

      if (nodes.length === cycleNodeIds.size && positions.length === cycleNodeIds.size * 2) {
        if (previousPositions && positions.every((position, index) => (
          Math.abs(position - previousPositions![index]) < 0.15
        ))) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        previousPositions = positions;

        if ((stableFrames >= 5 && elapsed >= 300) || elapsed >= 4_000) {
          graphRef.current?.zoomToFit(
            700,
            80,
            (node) => node.id !== undefined && cycleNodeIds.has(String(node.id)),
          );
          return;
        }
      }

      if (elapsed < 4_500) frameId = requestAnimationFrame(fitCycleWhenStable);
    };

    frameId = requestAnimationFrame(fitCycleWhenStable);
    return () => cancelAnimationFrame(frameId);
  }, [graph, graphData.nodes.length, selectedCycleIndex]);

  const drawNode = useCallback((
    node: NodeObject<GraphNode>,
    context: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return;

    const id = String(node.id ?? '');
    const nodeHealth = healthById.get(id);
    const color = viewMode === 'heatmap'
      ? healthColor(healthScoreById.get(id) ?? null)
      : colorById.get(id) ?? '#a0aec0';
    const zoomScale = Math.max(globalScale, 0.01);
    const radius = nodeRenderData.get(id)?.radius ?? 3;
    const isGraphSelected = id === graphSelectedId;
    const isHovered = id === hoveredId;
    const isSymbolPulse = symbolPulse?.id === id;
    const isRelated = relatedNodeIds.has(id);
    const isInSelectedCycle = selectedCycleNodeIds.has(id);
    const isImport = graphSelectedId !== null && adjacency.imports.get(graphSelectedId)?.has(id) === true;
    const isImporter = graphSelectedId !== null && adjacency.importers.get(graphSelectedId)?.has(id) === true;
    const isDirectlyConnected = isImport || isImporter;

    context.save();
    const isHighlighted = selectedCycleIndex !== null
      ? isInSelectedCycle
      : graphSelectedId !== null
        ? isGraphSelected || isDirectlyConnected
        : isRelated;
    if (hasActiveFocus && !isHighlighted) context.globalAlpha = 0.3;
    if (performanceMode.tier === 'full') {
      const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 1.62);
      glow.addColorStop(0, withAlpha(color, 0.57));
      glow.addColorStop(0.38, withAlpha(color, 0.18));
      glow.addColorStop(1, withAlpha(color, 0));
      context.fillStyle = glow;
      context.beginPath();
      context.arc(node.x, node.y, radius * 1.62, 0, Math.PI * 2);
      context.fill();
    }

    if (graphSelectedId === id && blastDistanceById.size > 1) {
      for (let distance = 1; distance <= 4; distance += 1) {
        if (blastCounts[distance] === 0) continue;
        const ringRadius = radius + (distance * 27) / zoomScale;
        context.beginPath();
        context.arc(node.x, node.y, ringRadius, 0, Math.PI * 2);
        context.strokeStyle = withAlpha(distance === 1 ? '#5eead4' : distance === 2 ? '#fbbf24' : '#fb7185', 0.42);
        context.lineWidth = 1 / zoomScale;
        if (performanceMode.tier === 'full') context.setLineDash([3 / zoomScale, 4 / zoomScale]);
        context.stroke();
        if (performanceMode.tier === 'full') context.setLineDash([]);
        context.font = `${8 / zoomScale}px Inter, ui-sans-serif, sans-serif`;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillStyle = 'rgba(226, 232, 240, 0.78)';
        context.fillText(`${distance} hop · ${blastCounts[distance]}`, node.x + ringRadius, node.y);
      }
      if (performanceMode.tier === 'full') {
        const progress = ((performance.now() % 1700) / 1700);
        const rippleRadius = radius + (progress * 78) / zoomScale;
        context.beginPath();
        context.arc(node.x, node.y, rippleRadius, 0, Math.PI * 2);
        context.strokeStyle = withAlpha('#c4b5fd', 0.52 * (1 - progress));
        context.lineWidth = 2 / zoomScale;
        context.setLineDash([2 / zoomScale, 4 / zoomScale]);
        context.stroke();
        context.setLineDash([]);
      }
    }

    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = performanceMode.tier === 'full'
      ? (hasActiveFocus && isHighlighted ? 12 / zoomScale : 6 / zoomScale)
      : 0;
    context.fill();
    context.shadowBlur = 0;

    if (node.inCycle && cyclesVisible && (!hasActiveFocus || isHighlighted)) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 2.5 / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = withAlpha(CYCLE_COLOR, cyclePulseAlpha.current);
      context.lineWidth = 2 / zoomScale;
      context.shadowColor = CYCLE_COLOR;
      context.shadowBlur = performanceMode.tier === 'full' ? 8 / zoomScale : 0;
      context.stroke();
      context.shadowBlur = 0;
    }

    if (isSymbolPulse && symbolPulse) {
      const elapsed = performance.now() - symbolPulse.startedAt;
      const wave = performanceMode.tier === 'full' ? 0.5 + 0.5 * Math.sin(elapsed / 95) : 0;
      context.beginPath();
      context.arc(node.x, node.y, radius + (8 + wave * 5) / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = withAlpha('#e9d5ff', 0.35 + wave * 0.6);
      context.lineWidth = (1.6 + wave * 1.3) / zoomScale;
      context.shadowColor = '#c4b5fd';
      context.shadowBlur = performanceMode.tier === 'full' ? (8 + wave * 8) / zoomScale : 0;
      context.stroke();
      context.shadowBlur = 0;
    }

    if (isGraphSelected || (isHovered && (!hasActiveFocus || isHighlighted))) {
      context.beginPath();
      context.arc(node.x, node.y, radius + (isGraphSelected ? 5 : 4) / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = isGraphSelected ? '#c4b5fd' : '#5eead4';
      context.lineWidth = 1.4 / zoomScale;
      context.stroke();
    }

    if (nodeHealth?.isGodFile && isHovered && (!hasActiveFocus || isHighlighted)) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 7 / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = '#c4b5fd';
      context.lineWidth = 2 / zoomScale;
      context.stroke();
    }

    const visibleFraction = Math.min(1, Math.max(0.12, 0.12 + ((globalScale - 0.55) / 1.2) * 0.88));
    const visibleLabelCount = Math.ceil(graphData.nodes.length * visibleFraction);
    const isImportantAtCurrentZoom = (labelPriority.get(id) ?? Number.MAX_SAFE_INTEGER) < visibleLabelCount;
    const shouldDrawLabel = performanceMode.tier === 'full'
      ? isGraphSelected || isImport || isImporter || isHovered || isImportantAtCurrentZoom
      : isGraphSelected || isHovered || (globalScale >= 1.35 && isImportantAtCurrentZoom);

    if (shouldDrawLabel) {
      const fileName = nodeRenderData.get(id)?.label ?? '';
      context.font = `${11 / zoomScale}px Inter, ui-sans-serif, sans-serif`;
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      const labelX = node.x + radius + 6 / zoomScale;
      const labelWidth = context.measureText(fileName).width;
      const labelHeight = 12 / zoomScale;
      const left = labelX;
      const top = node.y - labelHeight / 2;
      const right = labelX + labelWidth;
      const bottom = node.y + labelHeight / 2;
      let overlapsLabel = false;
      for (let index = 0; index < labelBoundsCount.current; index += 1) {
        const offset = index * 4;
        if (
          left < labelBounds.current[offset + 2]
          && right > labelBounds.current[offset]
          && top < labelBounds.current[offset + 3]
          && bottom > labelBounds.current[offset + 1]
        ) {
          overlapsLabel = true;
          break;
        }
      }

      if (!overlapsLabel) {
        const offset = labelBoundsCount.current * 4;
        labelBounds.current[offset] = left;
        labelBounds.current[offset + 1] = top;
        labelBounds.current[offset + 2] = right;
        labelBounds.current[offset + 3] = bottom;
        labelBoundsCount.current += 1;
        context.fillStyle = isGraphSelected
          ? '#f8fafc'
          : isImport
            ? '#5eead4'
            : isImporter
              ? '#fbbf24'
              : 'rgba(226, 232, 240, 0.94)';
        context.shadowColor = 'rgba(5, 6, 15, 0.9)';
        context.shadowBlur = 4 / zoomScale;
        context.fillText(fileName, labelX, node.y);
      }
    }

    context.restore();
  }, [adjacency, blastCounts, blastDistanceById, colorById, cyclesVisible, graphData.nodes.length, graphSelectedId, hasActiveFocus, healthById, healthScoreById, hoveredId, labelPriority, nodeRenderData, performanceMode.tier, relatedNodeIds, selectedCycleIndex, selectedCycleNodeIds, symbolPulse, viewMode]);

  const resetLabelBounds = useCallback(() => {
    if (labelBounds.current.length < graphData.nodes.length * 4) {
      labelBounds.current = new Float32Array(graphData.nodes.length * 4);
    }
    labelBoundsCount.current = 0;
    cyclePulseAlpha.current = animateCyclePulse
      ? 0.35 + 0.35 * Math.sin(performance.now() / 450)
      : 0.62;
  }, [animateCyclePulse, graphData.nodes.length]);

  const getLinkColor = useCallback((link: LinkEndpoints) => {
    if (link.inCycle === true && cyclesVisible) {
      return withAlpha(CYCLE_COLOR, hasActiveFocus && !isHighlightedLink(link) ? 0.12 : 0.82);
    }
    const direction = edgeDirection(link, graphSelectedId);
    if (direction === 'outgoing') return OUTGOING_COLOR;
    if (direction === 'incoming') return INCOMING_COLOR;
    const { sourceId } = resolveEndpoints(link);
    const sourceColor = colorById.get(sourceId ?? '') ?? '#94a3b8';
    return withAlpha(sourceColor, hasActiveFocus ? 0.12 : 0.28);
  }, [colorById, cyclesVisible, graphSelectedId, hasActiveFocus, isHighlightedLink]);

  const getLinkWidth = useCallback((link: LinkEndpoints) => {
    if (performanceMode.tier !== 'full') {
      if (hasActiveFocus && !isHighlightedLink(link)) return 0.3;
      const aggregateCount = typeof link.aggregateCount === 'number' ? link.aggregateCount : 1;
      const aggregateWidth = 0.4 + Math.log2(aggregateCount) * 0.14;
      return Math.min(link.inCycle === true && cyclesVisible ? 1.2 : 1, aggregateWidth);
    }
    if (hasActiveFocus && !isHighlightedLink(link)) return 0.35;
    if (link.inCycle === true && cyclesVisible) return 1.9;
    return edgeDirection(link, graphSelectedId) === 'unrelated'
      ? (hasActiveFocus ? 0.35 : 0.7)
      : 1.8;
  }, [cyclesVisible, graphSelectedId, hasActiveFocus, isHighlightedLink, performanceMode.tier]);

  const getLinkParticles = useCallback((link: LinkEndpoints) => {
    if (performanceMode.tier !== 'full') return 0;
    if (hasActiveFocus && !isHighlightedLink(link)) return 0;
    return 2;
  }, [hasActiveFocus, isHighlightedLink, performanceMode.tier]);

  const getParticleColor = useCallback((link: LinkEndpoints) => {
    if (link.inCycle === true && cyclesVisible) return CYCLE_COLOR;
    const { sourceId } = resolveEndpoints(link);
    return withAlpha(colorById.get(sourceId ?? '') ?? '#94a3b8', 0.58);
  }, [colorById, cyclesVisible]);

  const drawCycleLink = useCallback((
    link: LinkObject<GraphNode, GraphEdge>,
    context: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (link.inCycle !== true || !cyclesVisible) return;
    const source = endpointPosition(link.source);
    const target = endpointPosition(link.target);
    if (!source || !target) return;

    const dimmed = hasActiveFocus && !isHighlightedLink(link);
    const alpha = cyclePulseAlpha.current * (dimmed ? 0.12 : 1);
    const scale = Math.max(globalScale, 0.01);
    context.save();
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.strokeStyle = withAlpha(CYCLE_COLOR, alpha);
    context.lineWidth = performanceMode.tier === 'full' ? 3.2 / scale : 1.2 / scale;
    context.shadowColor = CYCLE_COLOR;
    context.shadowBlur = performanceMode.tier === 'full' ? 9 / scale : 0;
    context.stroke();
    context.restore();
  }, [cyclesVisible, hasActiveFocus, isHighlightedLink, performanceMode.tier]);

  const paintNodePointerArea = useCallback((
    node: NodeObject<GraphNode>,
    paintColor: string,
    context: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
    const radius = nodeRenderData.get(String(node.id))?.radius ?? 3;
    context.fillStyle = paintColor;
    context.beginPath();
    context.arc(node.x, node.y, Math.max(radius, 5 / Math.max(globalScale, 0.01)), 0, Math.PI * 2);
    context.fill();
  }, [nodeRenderData]);

  const isLinkVisible = useCallback((link: LinkEndpoints) => (
    (link.inCycle === true && cyclesVisible) || importsVisible
  ), [cyclesVisible, importsVisible]);

  const handleEngineStop = useCallback(() => {
    if (hasFittedGraph.current || graphData.nodes.length === 0) return;
    hasFittedGraph.current = true;
    graphRef.current?.zoomToFit(600, 60);
  }, [graphData.nodes]);

  const handleNodeHover = useCallback((node: NodeObject<GraphNode> | null) => {
    const id = node?.id == null ? null : String(node.id);
    hoverNode(id);
    if (containerRef.current) {
      containerRef.current.style.cursor = id ? 'pointer' : 'grab';
    }
  }, [hoverNode]);

  return (
    <main
      className={`graph-canvas${phase === 'ready' ? ' graph-canvas--interactive' : ''}`}
      aria-label="Interactive dependency graph"
      ref={containerRef}
    >
      <div className="graph-view-switch" role="group" aria-label="Graph view">
        <button
          type="button"
          className={viewMode === 'file' ? 'graph-view-switch__button is-active' : 'graph-view-switch__button'}
          aria-pressed={viewMode === 'file'}
          onClick={() => setViewMode('file')}
        >
          File graph
        </button>
        <button
          type="button"
          className={viewMode === 'function' ? 'graph-view-switch__button is-active' : 'graph-view-switch__button'}
          aria-pressed={viewMode === 'function'}
          onClick={() => setViewMode('function')}
        >
          Function graph
        </button>
        <button
          type="button"
          className={viewMode === 'heatmap' ? 'graph-view-switch__button is-active' : 'graph-view-switch__button'}
          aria-pressed={viewMode === 'heatmap'}
          onClick={() => setViewMode('heatmap')}
        >
          Health map
        </button>
      </div>
      {phase === 'ready' && graph && (
      <div className="edge-toggle-toolbar" role="group" aria-label="Edge visibility">
        <button
          type="button"
          aria-pressed={importsVisible}
          disabled={viewMode === 'function'}
          title={viewMode !== 'function' ? 'Toggle import edges' : 'Imports applies to the file graph.'}
          onClick={() => toggleEdges('imports')}
        >
          Imports
        </button>
        <button
          type="button"
          aria-pressed={callsVisible}
          disabled={viewMode !== 'function'}
          title={viewMode === 'function' ? 'Toggle function call edges' : 'Calls applies to the function graph.'}
          onClick={() => toggleEdges('calls')}
        >
          Calls
        </button>
        <button
          type="button"
          aria-pressed={cyclesVisible}
          disabled={viewMode === 'function'}
          title={viewMode !== 'function' ? 'Toggle circular import edges' : 'Cycles applies to the file graph.'}
          onClick={() => toggleEdges('cycles')}
        >
          Cycles
        </button>
        <button
          type="button"
          className="folder-group-toggle"
          aria-pressed={groupByFolder}
          disabled={viewMode === 'function'}
          title="Show one node per top-level folder"
          onClick={toggleFolderGrouping}
        >
          Group by folder
        </button>
      </div>
      )}
      {phase === 'idle' && !graph && (
        <p className="welcome-state">Paste a GitHub URL to map its code</p>
      )}
      {(phase === 'cloning' || phase === 'parsing') && (
        <LoadingOverlay phase={phase} phaseStartedAt={phaseStartedAt} />
      )}
      {phase === 'error' && (
        <ErrorState
          error={error ?? 'Could not load graph data.'}
          lastUrl={lastUrl}
          onRetry={(url) => { void analyze(url); }}
        />
      )}
      {truncatedCounts && phase === 'ready' && (
        <div className="large-repo-banner" role="status">
          Large repo: showing the {truncatedCounts.analyzed.toLocaleString()} most relevant files of {truncatedCounts.total.toLocaleString()}
        </div>
      )}
      {viewMode === 'function' && phase === 'ready' && graph && (
        <FunctionGraphCanvas />
      )}
      {viewMode !== 'function' && phase === 'ready' && canvasSize.width > 0 && canvasSize.height > 0 && graph && (
        <div className="file-graph-stage">
        <ForceGraph2D<GraphNode, GraphEdge>
          ref={graphRef}
          width={canvasSize.width}
          height={Math.max(0, canvasSize.height - 48)}
          graphData={graphData}
          backgroundColor="rgba(0, 0, 0, 0)"
          onRenderFramePre={resetLabelBounds}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintNodePointerArea}
          linkCanvasObjectMode="after"
          linkCanvasObject={drawCycleLink}
          linkVisibility={isLinkVisible}
          autoPauseRedraw={performanceMode.tier !== 'full' || !(
            (hasCycleEdges && cyclesVisible && animateCyclePulse)
            || symbolPulse !== null
            || graphSelectedId !== null
          )}
          linkColor={getLinkColor}
          linkWidth={getLinkWidth}
          linkDirectionalArrowLength={performanceMode.tier === 'full' ? 4 : 0}
          linkDirectionalArrowColor={getLinkColor}
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={getLinkParticles}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleWidth={1.6}
          linkDirectionalParticleColor={getParticleColor}
          warmupTicks={performanceMode.warmupTicks}
          cooldownTicks={performanceMode.cooldownTicks}
          d3AlphaDecay={performanceMode.alphaDecay}
          onEngineStop={handleEngineStop}
          onNodeHover={handleNodeHover}
          onNodeClick={(node) => {
            if ((node as GraphNode).isFolderGroup) {
              toggleFolderExpansion((node as GraphNode).folder);
            } else if (node.id != null) focusNode(String(node.id));
            else clearFocus();
          }}
          onBackgroundClick={clearFocus}
          showPointerCursor={(object) => Boolean(object && 'id' in object)}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />
        </div>
      )}
      {viewMode === 'file' && phase === 'ready' && graph && <GraphLegend legend={legend} />}
      {viewMode === 'heatmap' && phase === 'ready' && graph && (
        <aside className="health-map-legend" aria-label="Health map legend">
          <strong>File health</strong>
          <div className="health-map-gradient" role="img" aria-label="Green good health through yellow to red at risk" />
          <div className="health-map-gradient-labels"><span>Healthy</span><span>At risk</span></div>
          {healthReport && !healthReport.historyAvailable && <small>Git history unavailable; churn is excluded.</small>}
          {!healthReport && analysisId && <small>Loading health metrics…</small>}
        </aside>
      )}
      {viewMode !== 'function' && <NodeTooltip containerRef={containerRef} />}
    </main>
  );
}
