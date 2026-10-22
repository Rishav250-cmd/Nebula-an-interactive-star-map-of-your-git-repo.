import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, {
  type GraphData as ForceGraphData,
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { useGraphStore } from '../store/useGraphStore';
import type { GraphEdge, GraphNode } from '../types/graph';

const NODE_PALETTE = [
  '#8b7cff', '#14b8a6', '#38bdf8', '#f472b6',
  '#a3e635', '#fbbf24', '#60a5fa', '#fb7185',
];

type GraphInstance = ForceGraphMethods<
  NodeObject<GraphNode>,
  LinkObject<GraphNode, GraphEdge>
>;

function folderColor(folder: string): string {
  const topLevelFolder = folder.split('/')[0] || '(root)';
  let hash = 2166136261;

  for (const character of topLevelFolder) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }

  return NODE_PALETTE[(hash >>> 0) % NODE_PALETTE.length];
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
  const status = useGraphStore((state) => state.status);
  const error = useGraphStore((state) => state.error);
  const selectedId = useGraphStore((state) => state.selectedId);
  const hoveredId = useGraphStore((state) => state.hoveredId);
  const focusRequest = useGraphStore((state) => state.focusRequest);
  const selectNode = useGraphStore((state) => state.selectNode);
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

  const colorById = useMemo(
    () => new Map(
      graph?.nodes.map((node) => [node.id, folderColor(node.folder)] as const) ?? [],
    ),
    [graph],
  );

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
    const color = colorById.get(id) ?? NODE_PALETTE[0];
    const zoomScale = Math.max(globalScale, 0.01);
    const loc = Number.isFinite(node.loc) ? Math.max(0, node.loc) : 0;
    const radius = Math.max(4, Math.min(14, 2 + Math.sqrt(loc) * 0.45));
    const isSelected = id === selectedId;
    const isHovered = id === hoveredId;

    context.save();
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

    if (globalScale > 1.5) {
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
  }, [colorById, hoveredId, selectedId]);

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
      className={`graph-canvas${status === 'ready' ? ' graph-canvas--interactive' : ''}`}
      aria-label="Interactive dependency graph"
      ref={containerRef}
    >
      {(status === 'idle' || status === 'loading') && (
        <p className="graph-state">Loading galaxy...</p>
      )}
      {status === 'error' && (
        <p className="graph-state graph-state--error" role="alert">
          {error ?? 'Could not load graph data.'}
        </p>
      )}
      {status === 'ready' && canvasSize.width > 0 && canvasSize.height > 0 && graph && (
        <ForceGraph2D<GraphNode, GraphEdge>
          ref={graphRef}
          width={canvasSize.width}
          height={canvasSize.height}
          graphData={graphData}
          backgroundColor="rgba(0, 0, 0, 0)"
          nodeCanvasObject={drawNode}
          linkColor="rgba(148, 163, 184, 0.3)"
          linkWidth={0.8}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowColor="rgba(148, 163, 184, 0.62)"
          linkDirectionalArrowRelPos={0.9}
          onEngineStop={handleEngineStop}
          onNodeHover={handleNodeHover}
          onNodeClick={(node) => selectNode(node.id == null ? null : String(node.id))}
          onBackgroundClick={() => selectNode(null)}
          showPointerCursor={(object) => Boolean(object && 'id' in object)}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />
      )}
    </main>
  );
}
