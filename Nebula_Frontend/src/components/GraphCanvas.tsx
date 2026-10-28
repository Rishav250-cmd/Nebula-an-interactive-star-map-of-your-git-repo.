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
type GraphInstance = ForceGraphMethods<
  NodeObject<GraphNode>,
  LinkObject<GraphNode, GraphEdge>
>;

type EdgeDirection = 'outgoing' | 'incoming' | 'unrelated';
type LabelBounds = { left: number; top: number; right: number; bottom: number };

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
  const hex = color.slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

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
  const qaFilePaths = useGraphStore((state) => state.qaFilePaths);
  const qaFocusRequest = useGraphStore((state) => state.qaFocusRequest);
  const focusLine = useGraphStore((state) => state.focusLine);
  const clearFocus = useGraphStore((state) => state.clearFocus);
  const focusNode = useGraphStore((state) => state.focusNode);
  const hoverNode = useGraphStore((state) => state.hoverNode);
  const viewMode = useGraphStore((state) => state.viewMode);
  const setViewMode = useGraphStore((state) => state.setViewMode);

  const containerRef = useRef<HTMLElement | null>(null);
  const graphRef = useRef<GraphInstance | undefined>(undefined);
  const hasFittedGraph = useRef(false);
  const handledFocusRequest = useRef(focusRequest);
  const labelBounds = useRef<LabelBounds[]>([]);
  const cyclePulseAlpha = useRef(0.35);
  const handledSymbolFocusRequest = useRef(focusRequest);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [symbolPulse, setSymbolPulse] = useState<{ id: string; startedAt: number } | null>(null);

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

  const graphData = useMemo<ForceGraphData<GraphNode, GraphEdge>>(
    () => {
      // ForceGraph mutates nodes and links with simulation coordinates.
      const nodes = visibleGraph?.nodes
        .map((node) => ({ ...node }))
        .sort((left, right) => (
          nodeImportance(right) - nodeImportance(left) || left.id.localeCompare(right.id)
        )) ?? [];
      const nodeIds = new Set(nodes.map((node) => node.id));
      return {
        nodes,
        links: uniqueLinks(visibleGraph?.edges ?? [], nodeIds),
      };
    },
    [visibleGraph],
  );
  const labelPriority = useMemo(
    () => new Map(graphData.nodes.map((node, index) => [node.id, index] as const)),
    [graphData],
  );

  const allFolders = useMemo(() => graph?.nodes.map((node) => node.folder) ?? [], [graph]);
  const colorByFolder = useMemo(() => new Map(
    [...new Set(allFolders)].map((folder) => [folder, folderColor(folder, allFolders)] as const),
  ), [allFolders]);
  const colorById = useMemo(() => new Map(
    graph?.nodes.map((node) => [node.id, colorByFolder.get(node.folder) ?? '#a0aec0'] as const) ?? [],
  ), [colorByFolder, graph]);
  const healthById = useMemo(() => new Map(
    healthReport?.files.map((file) => [file.id, file] as const) ?? [],
  ), [healthReport]);
  const healthScoreById = useMemo(() => new Map(
    graph?.nodes.map((node) => [
      node.id,
      healthById.get(node.id)?.healthScore ?? node.healthScore ?? null,
    ] as const) ?? [],
  ), [graph, healthById]);
  const legend = useMemo(() => folderLegend(allFolders, 8), [allFolders]);
  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
  const graphSelectedId = graph?.nodes.some((node) => node.id === selectedId) ? selectedId : null;
  const selectedCycleNodeIds = useMemo(
    () => new Set(selectedCycleIndex === null ? [] : graph?.cycles[selectedCycleIndex] ?? []),
    [graph, selectedCycleIndex],
  );
  const qaMatchedNodeIds = useMemo(() => new Set(qaFilePaths), [qaFilePaths]);
  const hasQAFocus = qaMatchedNodeIds.size > 0;
  const hasActiveFocus = graphSelectedId !== null || selectedCycleIndex !== null || hasQAFocus;
  const cycleEdgeCount = useMemo(
    () => graphData.links.reduce((count, link) => count + Number(link.inCycle === true), 0),
    [graphData],
  );
  const hasCycleEdges = cycleEdgeCount > 0;
  const animateCyclePulse = cycleEdgeCount <= 300;

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
    if (hasQAFocus) {
      return (sourceId !== null && qaMatchedNodeIds.has(sourceId))
        || (targetId !== null && qaMatchedNodeIds.has(targetId));
    }
    const sourceDistance = sourceId ? blastDistanceById.get(sourceId) : undefined;
    const targetDistance = targetId ? blastDistanceById.get(targetId) : undefined;
    return edgeDirection(link, graphSelectedId) !== 'unrelated'
      || (sourceDistance !== undefined && targetDistance !== undefined
        && Math.abs(sourceDistance - targetDistance) === 1);
  }, [blastDistanceById, graphSelectedId, hasQAFocus, qaMatchedNodeIds, selectedCycleIndex, selectedCycleNodeIds]);

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
    if (!hasFittedGraph.current || graphData.nodes.length === 0) return;
    graphRef.current?.zoomToFit(600, 60);
  }, [canvasSize.height, canvasSize.width, graphData.nodes.length]);

  useEffect(() => {
    const graphInstance = graphRef.current;
    if (!graphInstance || graphData.nodes.length === 0) return;

    graphInstance.d3Force(
      'collide',
      forceCollide<NodeObject<GraphNode>>((node) => nodeRadius(node.loc) + 3),
    );
    graphInstance.d3Force('charge')?.strength(graphData.nodes.length > 40 ? -34 : -30);
    graphInstance.d3ReheatSimulation();
  }, [graphData]);

  useEffect(() => {
    if (
      focusRequest === handledFocusRequest.current
      || !selectedId
      || graphData.nodes.length === 0
    ) return;
    handledFocusRequest.current = focusRequest;

    const node = graphData.nodes.find((candidate) => candidate.id === selectedId);
    if (!node) return;

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
  }, [focusRequest, graphData.nodes, selectedId]);

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

  useEffect(() => {
    if (qaFocusRequest === 0 || !hasQAFocus || graphData.nodes.length === 0) return;
    const startedAt = performance.now();
    let previousPositions: number[] | null = null;
    let stableFrames = 0;
    let frameId = 0;
    const fitQAMatchesWhenStable = () => {
      const nodes = graphData.nodes.filter((node) => qaMatchedNodeIds.has(node.id));
      const positions = nodes.flatMap((node) => (
        typeof node.x === 'number' && Number.isFinite(node.x)
        && typeof node.y === 'number' && Number.isFinite(node.y)
          ? [node.x, node.y]
          : []
      ));
      const elapsed = performance.now() - startedAt;
      if (nodes.length === qaMatchedNodeIds.size && positions.length === nodes.length * 2) {
        if (previousPositions && positions.every((position, index) => (
          Math.abs(position - previousPositions![index]) < 0.15
        ))) stableFrames += 1;
        else stableFrames = 0;
        previousPositions = positions;
        if ((stableFrames >= 4 && elapsed >= 250) || elapsed >= 3_500) {
          graphRef.current?.zoomToFit(
            650,
            90,
            (node) => node.id !== undefined && qaMatchedNodeIds.has(String(node.id)),
          );
          return;
        }
      }
      if (elapsed < 4_000) frameId = requestAnimationFrame(fitQAMatchesWhenStable);
    };
    frameId = requestAnimationFrame(fitQAMatchesWhenStable);
    return () => cancelAnimationFrame(frameId);
  }, [graphData.nodes, hasQAFocus, qaFocusRequest, qaMatchedNodeIds]);

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
    const loc = Number.isFinite(node.loc) ? Math.max(0, node.loc) : 0;
    const radius = nodeRadius(loc);
    const isGraphSelected = id === graphSelectedId;
    const isHovered = id === hoveredId;
    const isSymbolPulse = symbolPulse?.id === id;
    const isRelated = relatedNodeIds.has(id);
    const isInSelectedCycle = selectedCycleNodeIds.has(id);
    const isQAMatched = qaMatchedNodeIds.has(id);
    const isImport = graphSelectedId !== null && adjacency.imports.get(graphSelectedId)?.has(id) === true;
    const isImporter = graphSelectedId !== null && adjacency.importers.get(graphSelectedId)?.has(id) === true;
    const isDirectlyConnected = isImport || isImporter;

    context.save();
    const isHighlighted = selectedCycleIndex !== null
      ? isInSelectedCycle
      : hasQAFocus
        ? isQAMatched
      : graphSelectedId !== null
        ? isGraphSelected || isDirectlyConnected
        : isRelated;
    if (hasActiveFocus && !isHighlighted) context.globalAlpha = 0.3;
    const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 1.62);
    glow.addColorStop(0, withAlpha(color, 0.57));
    glow.addColorStop(0.38, withAlpha(color, 0.18));
    glow.addColorStop(1, withAlpha(color, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(node.x, node.y, radius * 1.62, 0, Math.PI * 2);
    context.fill();

    if (graphSelectedId === id && blastDistanceById.size > 1) {
      for (let distance = 1; distance <= 4; distance += 1) {
        if (blastCounts[distance] === 0) continue;
        const ringRadius = radius + (distance * 27) / zoomScale;
        context.beginPath();
        context.arc(node.x, node.y, ringRadius, 0, Math.PI * 2);
        context.strokeStyle = withAlpha(distance === 1 ? '#5eead4' : distance === 2 ? '#fbbf24' : '#fb7185', 0.42);
        context.lineWidth = 1 / zoomScale;
        context.setLineDash([3 / zoomScale, 4 / zoomScale]);
        context.stroke();
        context.setLineDash([]);
        context.font = `${8 / zoomScale}px Inter, ui-sans-serif, sans-serif`;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillStyle = 'rgba(226, 232, 240, 0.78)';
        context.fillText(`${distance} hop · ${blastCounts[distance]}`, node.x + ringRadius, node.y);
      }
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

    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = hasActiveFocus && isHighlighted ? 12 / zoomScale : 6 / zoomScale;
    context.fill();
    context.shadowBlur = 0;

    if (isQAMatched) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 5 / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = '#c4b5fd';
      context.lineWidth = 2.2 / zoomScale;
      context.shadowColor = '#a78bfa';
      context.shadowBlur = 10 / zoomScale;
      context.stroke();
      context.shadowBlur = 0;
    }

    if (node.inCycle && cyclesVisible && (!hasActiveFocus || isHighlighted)) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 2.5 / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = withAlpha(CYCLE_COLOR, cyclePulseAlpha.current);
      context.lineWidth = 2 / zoomScale;
      context.shadowColor = CYCLE_COLOR;
      context.shadowBlur = 8 / zoomScale;
      context.stroke();
      context.shadowBlur = 0;
    }

    if (isSymbolPulse && symbolPulse) {
      const elapsed = performance.now() - symbolPulse.startedAt;
      const wave = 0.5 + 0.5 * Math.sin(elapsed / 95);
      context.beginPath();
      context.arc(node.x, node.y, radius + (8 + wave * 5) / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = withAlpha('#e9d5ff', 0.35 + wave * 0.6);
      context.lineWidth = (1.6 + wave * 1.3) / zoomScale;
      context.shadowColor = '#c4b5fd';
      context.shadowBlur = (8 + wave * 8) / zoomScale;
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
    const shouldDrawLabel = isGraphSelected
      || isQAMatched
      || isImport
      || isImporter
      || isHovered
      || isImportantAtCurrentZoom;

    if (shouldDrawLabel) {
      const fileName = truncateLabel(node.id?.toString().split('/').pop() ?? '');
      context.font = `${11 / zoomScale}px Inter, ui-sans-serif, sans-serif`;
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      const labelX = node.x + radius + 6 / zoomScale;
      const labelWidth = context.measureText(fileName).width;
      const labelHeight = 12 / zoomScale;
      const bounds = {
        left: labelX,
        top: node.y - labelHeight / 2,
        right: labelX + labelWidth,
        bottom: node.y + labelHeight / 2,
      };
      const overlapsLabel = labelBounds.current.some((existing) => (
        bounds.left < existing.right
        && bounds.right > existing.left
        && bounds.top < existing.bottom
        && bounds.bottom > existing.top
      ));

      if (!overlapsLabel) {
        labelBounds.current.push(bounds);
        context.fillStyle = isGraphSelected
          ? '#f8fafc'
          : isQAMatched
            ? '#ddd6fe'
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
  }, [adjacency, blastCounts, blastDistanceById, colorById, cyclesVisible, graphData.nodes.length, graphSelectedId, hasActiveFocus, hasQAFocus, healthById, healthScoreById, hoveredId, labelPriority, qaMatchedNodeIds, relatedNodeIds, selectedCycleIndex, selectedCycleNodeIds, symbolPulse, viewMode]);

  const resetLabelBounds = useCallback(() => {
    labelBounds.current = [];
    cyclePulseAlpha.current = animateCyclePulse
      ? 0.35 + 0.35 * Math.sin(performance.now() / 450)
      : 0.62;
  }, [animateCyclePulse]);

  const getLinkColor = useCallback((link: LinkEndpoints) => {
    if (link.inCycle === true && cyclesVisible) {
      return withAlpha(CYCLE_COLOR, hasActiveFocus && !isHighlightedLink(link) ? 0.12 : 0.82);
    }
    if (hasQAFocus && isHighlightedLink(link)) return 'rgba(196, 181, 253, 0.92)';
    const direction = edgeDirection(link, graphSelectedId);
    if (direction === 'outgoing') return OUTGOING_COLOR;
    if (direction === 'incoming') return INCOMING_COLOR;
    const { sourceId } = resolveEndpoints(link);
    const sourceColor = colorById.get(sourceId ?? '') ?? '#94a3b8';
    return withAlpha(sourceColor, hasActiveFocus ? 0.12 : 0.28);
  }, [colorById, cyclesVisible, graphSelectedId, hasActiveFocus, hasQAFocus, isHighlightedLink]);

  const getLinkWidth = useCallback((link: LinkEndpoints) => {
    if (hasActiveFocus && !isHighlightedLink(link)) return 0.35;
    if (link.inCycle === true && cyclesVisible) return 1.9;
    return edgeDirection(link, graphSelectedId) === 'unrelated'
      ? (hasActiveFocus ? 0.35 : 0.7)
      : 1.8;
  }, [cyclesVisible, graphSelectedId, hasActiveFocus, isHighlightedLink]);

  const getLinkParticles = useCallback((link: LinkEndpoints) => {
    if ((graph?.edges.length ?? 0) > 1500) return 0;
    if (hasActiveFocus && !isHighlightedLink(link)) return 0;
    return 2;
  }, [graph?.edges.length, hasActiveFocus, isHighlightedLink]);

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
    context.lineWidth = 3.2 / scale;
    context.shadowColor = CYCLE_COLOR;
    context.shadowBlur = 9 / scale;
    context.stroke();
    context.restore();
  }, [cyclesVisible, hasActiveFocus, isHighlightedLink]);

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
          linkCanvasObjectMode="after"
          linkCanvasObject={drawCycleLink}
          linkVisibility={isLinkVisible}
          autoPauseRedraw={(
            (hasCycleEdges && cyclesVisible && animateCyclePulse)
            || symbolPulse !== null
            || graphSelectedId !== null
          ) ? false : undefined}
          linkColor={getLinkColor}
          linkWidth={getLinkWidth}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowColor={getLinkColor}
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={getLinkParticles}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleWidth={1.6}
          linkDirectionalParticleColor={getParticleColor}
          onEngineStop={handleEngineStop}
          onNodeHover={handleNodeHover}
          onNodeClick={(node) => {
            if (node.id != null) focusNode(String(node.id));
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
