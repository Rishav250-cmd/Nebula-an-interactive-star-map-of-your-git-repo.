import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type GraphData as ForceGraphData,
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { NodeTooltip } from './NodeTooltip';
import { LoadingOverlay } from './LoadingOverlay';
import { ErrorState } from './ErrorState';
import { GraphLegend } from './GraphLegend';
import { useGraphStore } from '../store/useGraphStore';
import type { GraphEdge, GraphNode } from '../types/graph';
import { getNodeRelations, resolveEndpoints, type LinkEndpoints } from '../utils/graphEdges';
import { folderColor, folderLegend, nodeRadius } from '../lib/graphStyle';
type GraphInstance = ForceGraphMethods<
  NodeObject<GraphNode>,
  LinkObject<GraphNode, GraphEdge>
>;

type EdgeDirection = 'outgoing' | 'incoming' | 'unrelated';

const OUTGOING_COLOR = 'rgba(196, 181, 253, 0.94)';
const INCOMING_COLOR = 'rgba(94, 234, 212, 0.94)';

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

export function GraphCanvas() {
  const graph = useGraphStore((state) => state.graph);
  const phase = useGraphStore((state) => state.phase);
  const phaseStartedAt = useGraphStore((state) => state.phaseStartedAt);
  const error = useGraphStore((state) => state.error);
  const lastUrl = useGraphStore((state) => state.lastUrl);
  const analyze = useGraphStore((state) => state.analyze);
  const selectedId = useGraphStore((state) => state.selectedId);
  const hoveredId = useGraphStore((state) => state.hoveredId);
  const focusRequest = useGraphStore((state) => state.focusRequest);
  const selectNode = useGraphStore((state) => state.selectNode);
  const focusNode = useGraphStore((state) => state.focusNode);
  const hoverNode = useGraphStore((state) => state.hoverNode);

  const containerRef = useRef<HTMLElement | null>(null);
  const graphRef = useRef<GraphInstance | undefined>(undefined);
  const hasFittedGraph = useRef(false);
  const handledFocusRequest = useRef(focusRequest);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const graphData = useMemo<ForceGraphData<GraphNode, GraphEdge>>(
    () => ({
      // ForceGraph mutates nodes and links with simulation coordinates.
      nodes: graph?.nodes.map((node) => ({ ...node })) ?? [],
      links: graph?.edges.map((edge) => ({ ...edge })) ?? [],
    }),
    [graph],
  );

  const allFolders = useMemo(() => graph?.nodes.map((node) => node.folder) ?? [], [graph]);
  const colorByFolder = useMemo(() => new Map(
    [...new Set(allFolders)].map((folder) => [folder, folderColor(folder, allFolders)] as const),
  ), [allFolders]);
  const colorById = useMemo(() => new Map(
    graph?.nodes.map((node) => [node.id, colorByFolder.get(node.folder) ?? '#a0aec0'] as const) ?? [],
  ), [colorByFolder, graph]);
  const legend = useMemo(() => folderLegend(allFolders, 8), [allFolders]);

  const relatedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    ids.add(selectedId);

    const relations = getNodeRelations(graphData.links, selectedId);
    relations.imports.forEach((id) => ids.add(id));
    relations.importers.forEach((id) => ids.add(id));

    return ids;
  }, [graphData.links, selectedId]);

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
  }, [graph]);

  useEffect(() => {
    if (
      focusRequest === handledFocusRequest.current
      || !selectedId
      || graphData.nodes.length === 0
    ) return;
    handledFocusRequest.current = focusRequest;

    let frames = 0;
    let frameId = 0;
    const focusSelectedNode = () => {
      const node = graphData.nodes.find((candidate) => candidate.id === selectedId);
      if (node && typeof node.x === 'number' && typeof node.y === 'number') {
        graphRef.current?.centerAt(node.x, node.y, 450);
        graphRef.current?.zoom(3, 450);
        return;
      }

      if (frames++ < 60) frameId = requestAnimationFrame(focusSelectedNode);
    };

    frameId = requestAnimationFrame(focusSelectedNode);
    return () => cancelAnimationFrame(frameId);
  }, [focusRequest, graphData.nodes, selectedId]);

  const drawNode = useCallback((
    node: NodeObject<GraphNode>,
    context: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return;

    const id = String(node.id ?? '');
    const color = colorById.get(id) ?? '#a0aec0';
    const zoomScale = Math.max(globalScale, 0.01);
    const loc = Number.isFinite(node.loc) ? Math.max(0, node.loc) : 0;
    const radius = nodeRadius(loc);
    const isSelected = id === selectedId;
    const isHovered = id === hoveredId;
    const isRelated = relatedNodeIds.has(id);
    const isHighlighted = isSelected || isHovered || (selectedId !== null && isRelated);

    context.save();
    if (selectedId && !isRelated) context.globalAlpha = 0.17;
    const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 2.7);
    glow.addColorStop(0, withAlpha(color, 0.95));
    glow.addColorStop(0.38, withAlpha(color, 0.3));
    glow.addColorStop(1, withAlpha(color, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(node.x, node.y, radius * 2.7, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 10 / zoomScale;
    context.fill();
    context.shadowBlur = 0;

    if (node.inCycle) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 2.5 / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = '#fb5266';
      context.lineWidth = 1.8 / zoomScale;
      context.shadowColor = '#f43f5e';
      context.shadowBlur = 12 / zoomScale;
      context.stroke();
      context.shadowBlur = 0;
    }

    if (isSelected || isHovered) {
      context.beginPath();
      context.arc(node.x, node.y, radius + (isSelected ? 5 : 4) / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = isSelected ? '#c4b5fd' : '#5eead4';
      context.lineWidth = 1.4 / zoomScale;
      context.stroke();
    }

    if (selectedId && isRelated && !isSelected) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 2.5 / zoomScale, 0, Math.PI * 2);
      context.strokeStyle = 'rgba(94, 234, 212, 0.6)';
      context.lineWidth = 1 / zoomScale;
      context.stroke();
    }

    if (globalScale > 1.6 || isHighlighted) {
      const fileName = node.id?.toString().split('/').pop() ?? '';
      context.font = `${11 / zoomScale}px Inter, ui-sans-serif, sans-serif`;
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillStyle = 'rgba(226, 232, 240, 0.94)';
      context.shadowColor = 'rgba(5, 6, 15, 0.9)';
      context.shadowBlur = 4 / zoomScale;
      context.fillText(fileName, node.x + radius + 6 / zoomScale, node.y);
    }

    context.restore();
  }, [colorById, hoveredId, relatedNodeIds, selectedId]);

  const getLinkColor = useCallback((link: LinkEndpoints) => {
    const direction = edgeDirection(link, selectedId);
    if (direction === 'outgoing') return OUTGOING_COLOR;
    if (direction === 'incoming') return INCOMING_COLOR;
    const { sourceId } = resolveEndpoints(link);
    const sourceColor = colorById.get(sourceId ?? '') ?? '#94a3b8';
    return withAlpha(sourceColor, selectedId ? 0.055 : 0.28);
  }, [colorById, selectedId]);

  const getLinkWidth = useCallback((link: LinkEndpoints) => (
    edgeDirection(link, selectedId) === 'unrelated'
      ? (selectedId ? 0.35 : 0.7)
      : 1.8
  ), [selectedId]);

  const getLinkParticles = useCallback((link: LinkEndpoints) => {
    if ((graph?.edges.length ?? 0) > 1500) return 0;
    if (!selectedId) return 2;
    return edgeDirection(link, selectedId) === 'unrelated' ? 0 : 2;
  }, [graph?.edges.length, selectedId]);

  const getParticleColor = useCallback((link: LinkEndpoints) => {
    const { sourceId } = resolveEndpoints(link);
    return withAlpha(colorById.get(sourceId ?? '') ?? '#94a3b8', 0.58);
  }, [colorById]);

  const handleEngineStop = useCallback(() => {
    if (hasFittedGraph.current || graphData.nodes.length === 0) return;
    hasFittedGraph.current = true;
    graphRef.current?.zoomToFit(450, 48);
  }, [graphData.nodes.length]);

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
      {phase === 'ready' && canvasSize.width > 0 && canvasSize.height > 0 && graph && (
        <ForceGraph2D<GraphNode, GraphEdge>
          ref={graphRef}
          width={canvasSize.width}
          height={canvasSize.height}
          graphData={graphData}
          backgroundColor="rgba(0, 0, 0, 0)"
          nodeCanvasObject={drawNode}
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
            else selectNode(null);
          }}
          onBackgroundClick={() => selectNode(null)}
          showPointerCursor={(object) => Boolean(object && 'id' in object)}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />
      )}
      {phase === 'ready' && graph && <GraphLegend legend={legend} />}
      <NodeTooltip containerRef={containerRef} />
    </main>
  );
}
