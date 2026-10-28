import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import './NodeTooltip.css';

type Point = { x: number; y: number };

type NodeTooltipProps = {
  containerRef: RefObject<HTMLElement | null>;
};

function displayValue(value: number | undefined): string {
  return value == null ? '—' : value.toLocaleString();
}

export function NodeTooltip({ containerRef }: NodeTooltipProps) {
  const hoveredId = useGraphStore((state) => state.hoveredId);
  const graph = useGraphStore((state) => state.graph);
  const healthReport = useGraphStore((state) => state.healthReport);
  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((candidate) => [candidate.id, candidate] as const) ?? []),
    [graph],
  );
  const healthById = useMemo(
    () => new Map(healthReport?.files.map((file) => [file.id, file] as const) ?? []),
    [healthReport],
  );
  const node = hoveredId ? nodesById.get(hoveredId) ?? null : null;
  const health = hoveredId ? healthById.get(hoveredId) ?? null : null;
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const latestPointer = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });

  const placeTooltip = useCallback((point: Point) => {
    const bounds = tooltipRef.current?.getBoundingClientRect();
    const width = bounds?.width ?? 250;
    const height = bounds?.height ?? 150;
    const gap = 16;
    const margin = 8;
    const preferredX = point.x + width + gap <= window.innerWidth - margin
      ? point.x + gap
      : point.x - width - gap;
    const preferredY = point.y + height + gap <= window.innerHeight - margin
      ? point.y + gap
      : point.y - height - gap;
    const nextPosition = {
      x: Math.min(Math.max(margin, preferredX), Math.max(margin, window.innerWidth - width - margin)),
      y: Math.min(Math.max(margin, preferredY), Math.max(margin, window.innerHeight - height - margin)),
    };

    setPosition((current) => (
      current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition
    ));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseMove = (event: MouseEvent) => {
      latestPointer.current = { x: event.clientX, y: event.clientY };
      if (frameRef.current !== null) return;

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const point = latestPointer.current;
        if (!point) return;
        setPointer(point);
        placeTooltip(point);
      });
    };
    const handleResize = () => {
      if (latestPointer.current) placeTooltip(latestPointer.current);
    };

    container.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('resize', handleResize);
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [containerRef, placeTooltip]);

  // Measure after the content changes so edge positions stay inside the viewport.
  useLayoutEffect(() => {
    if (pointer && node) placeTooltip(pointer);
  }, [node, pointer, placeTooltip]);

  if (!node || !pointer) return null;

  return (
    <div
      ref={tooltipRef}
      className="node-tooltip"
      role="status"
      aria-label={`Details for ${node.id}`}
      style={{ left: position.x, top: position.y }}
    >
      <strong className="node-tooltip__path" title={node.id}>{node.id}</strong>
      <dl className="node-tooltip__metrics">
        <div><dt>LOC</dt><dd>{displayValue(node.loc)}</dd></div>
        <div><dt>Complexity</dt><dd>{displayValue(health?.maxComplexity ?? node.complexity)}</dd></div>
        <div><dt>Churn</dt><dd>{health?.churn == null ? (healthReport && !healthReport.historyAvailable ? 'No Git history' : displayValue(node.churn)) : displayValue(health.churn)}</dd></div>
        {health && <div><dt>Health</dt><dd>{health.healthScore}/100</dd></div>}
      </dl>
      <div className="node-tooltip__badges">
        {(health?.isGodFile ?? node.isGodFile) && <span className="node-tooltip__badge node-tooltip__badge--god">God file</span>}
        {health?.isHotspot && <span className="node-tooltip__badge">Hotspot</span>}
        {(health?.inCycle ?? node.inCycle) && <span className="node-tooltip__badge node-tooltip__badge--cycle">In a circular import</span>}
      </div>
    </div>
  );
}
