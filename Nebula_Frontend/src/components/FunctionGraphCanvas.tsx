import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import ForceGraph2D, {
  type GraphData as ForceGraphData,
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import { forceCollide } from 'd3-force-3d';
import { useGraphStore } from '../store/useGraphStore';
import type { CallGraphEdge, CallGraphNode } from '../types/graph';
import { folderColor } from '../lib/graphStyle';

type FunctionGraphInstance = ForceGraphMethods<
  NodeObject<CallGraphNode>,
  LinkObject<CallGraphNode, CallGraphEdge>
>;

type Point = { x: number; y: number };

function folderOf(file: string): string {
  const parts = file.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}

function clampRadius(complexity: number): number {
  return Math.max(5, Math.min(18, 5 + Math.max(0, complexity) * 1.2));
}

function complexityColor(complexity: number): string {
  if (complexity <= 5) return '#34d399';
  if (complexity <= 10) return '#fbbf24';
  return '#f87171';
}

function shortFileName(file: string): string {
  return file.split('/').pop() ?? file;
}

export function FunctionGraphCanvas() {
  const graph = useGraphStore((state) => state.graph);
  const selectedId = useGraphStore((state) => state.selectedId);
  const callGraph = useGraphStore((state) => state.callGraph);
  const callGraphStatus = useGraphStore((state) => state.callGraphStatus);
  const callGraphError = useGraphStore((state) => state.callGraphError);
  const callGraphDepth = useGraphStore((state) => state.callGraphDepth);
  const callsVisible = useGraphStore((state) => state.edgeToggles.calls);
  const selectedFunctionId = useGraphStore((state) => state.selectedFunctionId);
  const loadCallGraph = useGraphStore((state) => state.loadCallGraph);
  const setCallGraphDepth = useGraphStore((state) => state.setCallGraphDepth);
  const selectFunction = useGraphStore((state) => state.selectFunction);
  const setFocusLine = useGraphStore((state) => state.setFocusLine);
  const focusNode = useGraphStore((state) => state.focusNode);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<FunctionGraphInstance | undefined>(undefined);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [hoveredNode, setHoveredNode] = useState<CallGraphNode | null>(null);
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 });

  // ForceGraph mutates its inputs. Keep this instance's nodes and links separate
  // from the file graph and rebuild them only when the API result changes.
  const graphData = useMemo<ForceGraphData<CallGraphNode, CallGraphEdge>>(() => ({
    nodes: callGraph?.nodes.map((node) => ({ ...node })) ?? [],
    links: callGraph?.edges.map((edge) => ({ ...edge })) ?? [],
  }), [callGraph]);

  const folders = useMemo(() => {
    return graph?.nodes.map((node) => node.folder)
      ?? callGraph?.nodes.map((node) => folderOf(node.file))
      ?? [];
  }, [callGraph, graph]);
  const colorByFile = useMemo(() => new Map(
    (callGraph?.nodes ?? []).map((node) => {
      const folder = folderOf(node.file);
      return [node.file, folderColor(folder, folders)] as const;
    }),
  ), [callGraph, folders]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = (width: number, height: number) => {
      const nextSize = { width: Math.floor(width), height: Math.floor(height) };
      setCanvasSize((current) => (
        current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
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
    if (!graphData.nodes.length) return;
    graphRef.current?.d3Force(
      'collide',
      forceCollide<NodeObject<CallGraphNode>>((node) => (node.external ? 7 : clampRadius(node.complexity)) + 12),
    );
    graphRef.current?.d3Force('charge')?.strength(-45);
    graphRef.current?.d3ReheatSimulation();
  }, [graphData]);

  const drawNode = useCallback((
    node: NodeObject<CallGraphNode>,
    context: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
    const nodeFile = node.file ?? selectedId ?? '';
    const color = colorByFile.get(nodeFile) ?? '#a0aec0';
    const scale = Math.max(globalScale, 0.01);
    const complexity = Number.isFinite(node.complexity) ? Math.max(0, node.complexity) : 1;
    const radius = clampRadius(complexity) * (node.external ? 0.68 : 1);

    context.save();
    const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 2.5);
    glow.addColorStop(0, `${color}bb`);
    glow.addColorStop(0.42, `${color}44`);
    glow.addColorStop(1, `${color}00`);
    context.fillStyle = glow;
    context.beginPath();
    context.arc(node.x, node.y, radius * 2.5, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 9 / scale;
    context.fill();
    context.shadowBlur = 0;

    if (node.external) {
      context.beginPath();
      context.setLineDash([3 / scale, 2.5 / scale]);
      context.arc(node.x, node.y, radius + 3.2 / scale, 0, Math.PI * 2);
      context.strokeStyle = `${color}dd`;
      context.lineWidth = 1.4 / scale;
      context.stroke();
      context.setLineDash([]);
    } else {
      context.beginPath();
      context.arc(node.x, node.y, radius + 3.2 / scale, 0, Math.PI * 2);
      context.strokeStyle = complexityColor(complexity);
      context.lineWidth = 1.8 / scale;
      context.stroke();
    }

    if (node.id === selectedFunctionId) {
      context.beginPath();
      context.arc(node.x, node.y, radius + 6.2 / scale, 0, Math.PI * 2);
      context.strokeStyle = '#e9d5ff';
      context.lineWidth = 1.5 / scale;
      context.stroke();
    }

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${10 / scale}px Inter, ui-sans-serif, sans-serif`;
    context.fillStyle = '#f1f5f9';
    context.shadowColor = 'rgba(5, 6, 15, 0.9)';
    context.shadowBlur = 4 / scale;
    context.fillText(node.name ?? '', node.x, node.y + radius + 11 / scale);
    if (node.external) {
      context.font = `${8.5 / scale}px Inter, ui-sans-serif, sans-serif`;
      context.fillStyle = '#aab5c8';
      context.fillText(shortFileName(nodeFile), node.x, node.y + radius + 22 / scale);
    }
    context.restore();
  }, [colorByFile, selectedFunctionId, selectedId]);

  const handleEngineStop = useCallback(() => {
    graphRef.current?.zoomToFit(500, 60);
  }, []);

  const handleNodeHover = useCallback((node: NodeObject<CallGraphNode> | null) => {
    setHoveredNode(node ? node as CallGraphNode : null);
    if (containerRef.current) containerRef.current.style.cursor = node ? 'pointer' : 'grab';
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }, []);

  const hasSelectedFunctions = callGraph?.nodes.some((node) => !node.external) ?? false;

  return (
    <div className="function-graph-canvas" ref={containerRef} onMouseMove={handleMouseMove}>
      <div className="function-graph-depth" role="group" aria-label="Call graph depth">
        <span>Depth</span>
        <button
          type="button"
          aria-pressed={callGraphDepth === 1}
          className={callGraphDepth === 1 ? 'is-active' : ''}
          onClick={() => setCallGraphDepth(1)}
        >1</button>
        <button
          type="button"
          aria-pressed={callGraphDepth === 2}
          className={callGraphDepth === 2 ? 'is-active' : ''}
          onClick={() => setCallGraphDepth(2)}
        >2 hops</button>
      </div>

      {callGraphStatus === 'loading' && (
        <div className="function-graph-message" role="status">Loading function graph…</div>
      )}
      {callGraphStatus === 'error' && (
        <div className="function-graph-message function-graph-message--error" role="alert">
          <span>{callGraphError ?? 'Could not load this function graph.'}</span>
          <button type="button" onClick={() => { void loadCallGraph(); }}>Retry</button>
        </div>
      )}
      {!selectedId && callGraphStatus === 'idle' && (
        <div className="function-graph-message">Select a file to see its functions and calls</div>
      )}
      {selectedId && callGraphStatus === 'ready' && callGraph?.nodes.length === 0 && (
        <div className="function-graph-message">No functions found in this file</div>
      )}
      {callGraphStatus === 'ready' && callGraph && !hasSelectedFunctions && callGraph.nodes.length > 0 && (
        <div className="function-graph-message">No functions found in this file</div>
      )}

      {callGraphStatus === 'ready' && callGraph && callGraph.nodes.length > 0 && hasSelectedFunctions
        && canvasSize.width > 0 && canvasSize.height > 0 && (
          <ForceGraph2D<CallGraphNode, CallGraphEdge>
            ref={graphRef}
            width={canvasSize.width}
            height={canvasSize.height}
            graphData={graphData}
            backgroundColor="rgba(0, 0, 0, 0)"
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={(node, color, context) => {
              if (typeof node.x !== 'number' || typeof node.y !== 'number') return;
              const radius = clampRadius(node.complexity) * (node.external ? 0.68 : 1) + 9;
              context.fillStyle = color;
              context.beginPath();
              context.arc(node.x, node.y, radius, 0, Math.PI * 2);
              context.fill();
            }}
            linkDirectionalArrowLength={5}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowColor={() => 'rgba(203, 213, 225, 0.9)'}
            linkDirectionalParticles={callsVisible ? 2 : 0}
            linkDirectionalParticleSpeed={0.008}
            linkDirectionalParticleWidth={2}
            linkDirectionalParticleColor={() => '#c4b5fd'}
            linkVisibility={() => callsVisible}
            linkColor={() => 'rgba(148, 163, 184, 0.55)'}
            linkWidth={1.1}
            autoPauseRedraw={callGraph.edges.length === 0}
            onEngineStop={handleEngineStop}
            onNodeHover={handleNodeHover}
            onNodeClick={(node) => {
              if (node.external) {
                focusNode(node.file);
                return;
              }
              selectFunction(node.id);
              setFocusLine(node.line);
            }}
            showPointerCursor={(object) => Boolean(object && 'id' in object)}
            enableNodeDrag
            enableZoomInteraction
            enablePanInteraction
          />
        )}

      {callGraph?.truncated && callGraphStatus === 'ready' && (
        <div className="function-graph-truncated" role="status">Showing first 150 nodes</div>
      )}
      {hoveredNode && (
        <div
          className="function-node-tooltip"
          role="status"
          style={{ left: Math.min(pointer.x + 14, Math.max(8, canvasSize.width - 250)), top: pointer.y + 14 }}
        >
          <strong>{hoveredNode.name}</strong>
          <span>{hoveredNode.kind}</span>
          <span title={hoveredNode.file}>{hoveredNode.file}:{hoveredNode.line}</span>
          <span>Complexity {hoveredNode.complexity}</span>
        </div>
      )}
    </div>
  );
}
