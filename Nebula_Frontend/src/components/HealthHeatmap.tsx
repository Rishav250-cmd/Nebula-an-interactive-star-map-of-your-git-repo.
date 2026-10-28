import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { API_BASE } from '../api/client';

type Quadrant = 'healthy' | 'watch' | 'dormant' | 'debt';

type HeatFile = {
    id: string;
    loc: number;
    churn: number | null;
    maxComplexity: number;
    hotspotScore: number | null;
    isHotspot: boolean;
    isGodFile: boolean;
    fragileGod: boolean;
    inCycle: boolean;
};

type HeatCell = {
    complexityBin: number;
    churnBin: number;
    quadrant: Quadrant;
    count: number;
    files: HeatFile[];
};

type HeatmapResponse = {
    historyAvailable: boolean;
    churnLabels: string[];
    complexityLabels: string[];
    grid: HeatCell[][];
};

// Full class names are written out so Tailwind can detect them.
const QUADRANTS: Record<Quadrant, { label: string; hint: string; cell: string; dot: string; text: string }> = {
    debt: {
        label: 'Tech-debt hotspot',
        hint: 'Complex and changing. Fix first.',
        cell: 'bg-red-500/85 hover:bg-red-400',
        dot: 'bg-red-500',
        text: 'text-red-300',
    },
    dormant: {
        label: 'Complex, stable',
        hint: 'Add tests before changing it.',
        cell: 'bg-blue-500/85 hover:bg-blue-400',
        dot: 'bg-blue-500',
        text: 'text-blue-300',
    },
    watch: {
        label: 'Changing, simple',
        hint: 'Usually routine updates.',
        cell: 'bg-amber-400/85 hover:bg-amber-300',
        dot: 'bg-amber-400',
        text: 'text-amber-300',
    },
    healthy: {
        label: 'Healthy',
        hint: 'Simple and stable.',
        cell: 'bg-emerald-500/85 hover:bg-emerald-400',
        dot: 'bg-emerald-500',
        text: 'text-emerald-300',
    },
};

const QUADRANT_ORDER: Quadrant[] = ['debt', 'dormant', 'watch', 'healthy'];

const BADGE_TONES = {
    red: 'bg-red-500/15 text-red-300 ring-red-500/30',
    rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
    violet: 'bg-violet-500/15 text-violet-200 ring-violet-500/30',
    amber: 'bg-amber-400/15 text-amber-200 ring-amber-400/30',
} as const;

function cellKey(cell: HeatCell): string {
    return `${cell.complexityBin}-${cell.churnBin}`;
}

// Pre-select the first populated debt cell so the detail panel is useful immediately.
function firstDebtKey(data: HeatmapResponse): string | null {
    const cells = data.grid.flat();
    const cell =
        cells.find((c) => c.quadrant === 'debt' && c.count > 0) ??
        cells.find((c) => c.count > 0);
    return cell ? cellKey(cell) : null;
}

function Badge({ tone, children }: { tone: keyof typeof BADGE_TONES; children: ReactNode }) {
    return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${BADGE_TONES[tone]}`}>
            {children}
        </span>
    );
}

export function HealthHeatmap({ onSelectFile }: { onSelectFile: (fileId: string) => void }) {
    const analysisId = useGraphStore((state) => state.analysisId);
    const [data, setData] = useState<HeatmapResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    useEffect(() => {
        if (!analysisId) return undefined;

        const controller = new AbortController();
        setData(null);
        setError(null);
        setSelectedKey(null);

        fetch(
            `${API_BASE}/api/heatmap?id=${encodeURIComponent(analysisId)}`,
            { signal: controller.signal },
        )
        .then(async (response) => {
                const body = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(body.error ?? 'Could not build the heatmap.');
                return body as HeatmapResponse;
            })
            .then((body) => {
                setData(body);
                setSelectedKey(firstDebtKey(body));
            })
            .catch((err: unknown) => {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : 'Could not build the heatmap.');
            });

        return () => controller.abort();
    }, [analysisId]);

    const cells = useMemo(() => data?.grid.flat() ?? [], [data]);
    const total = useMemo(() => cells.reduce((sum, c) => sum + c.count, 0), [cells]);
    const totals = useMemo(() => {
        const result: Record<Quadrant, number> = { debt: 0, dormant: 0, watch: 0, healthy: 0 };
        for (const cell of cells) result[cell.quadrant] += cell.count;
        return result;
    }, [cells]);
    const selected = cells.find((c) => cellKey(c) === selectedKey) ?? null;

    if (!analysisId) {
        return <p className="py-16 text-center text-sm text-slate-400">Analyze a repository to see its heatmap.</p>;
    }
    if (error) {
        return (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                {error}
            </div>
        );
    }
    if (!data) {
        return <p role="status" className="py-16 text-center text-sm text-slate-400">Building heatmap…</p>;
    }

    return (
        <div className="heatmap">
            {!data.historyAvailable && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
                    No git history (ZIP upload), so churn is unavailable. Every file sits in the first column.
                </div>
            )}

            <div className="heatmap-summary">
                {QUADRANT_ORDER.map((q) => (
                    <div key={q} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-white">
                            <span className={`h-2.5 w-2.5 rounded-full ${QUADRANTS[q].dot}`} aria-hidden="true" />
                            {QUADRANTS[q].label}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{QUADRANTS[q].hint}</p>
                        <p className={`mt-2 text-2xl font-bold tabular-nums ${QUADRANTS[q].text}`}>{totals[q]}</p>
                    </div>
                ))}
            </div>

            <div className="heatmap-grid-scroll">
                <div className="heatmap-grid">
                    <div className="flex items-end justify-end pb-1 pr-2 text-[11px] font-medium text-slate-400">
                        Complexity ↑
                    </div>
                    {data.churnLabels.map((label) => (
                        <div key={label} className="pb-1 text-center text-[11px] font-medium text-slate-400">
                            {label}
                        </div>
                    ))}

                    {[...data.grid].reverse().map((row, offset) => {
                        const complexityBin = data.grid.length - 1 - offset;
                        return (
                            <Fragment key={complexityBin}>
                                <div className="flex items-center justify-end pr-2 text-[11px] text-slate-400">
                                    {data.complexityLabels[complexityBin]}
                                </div>
                                {row.map((cell) => {
                                    const key = cellKey(cell);
                                    const meta = QUADRANTS[cell.quadrant];
                                    const empty = cell.count === 0;
                                    const isSelected = selectedKey === key;

                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            disabled={empty}
                                            aria-pressed={isSelected}
                                            aria-label={`${meta.label}: ${cell.count} files, churn ${data.churnLabels[cell.churnBin]}, complexity ${data.complexityLabels[cell.complexityBin]}`}
                                            onClick={() => setSelectedKey(key)}
                                            className={[
                                                'heatmap-cell',
                                                empty
                                                    ? 'cursor-default bg-white/[0.03] text-transparent'
                                                    : `${meta.cell} cursor-pointer text-slate-950 hover:scale-[1.03]`,
                                                isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-950' : '',
                                            ].join(' ')}
                                        >
                                            {cell.count || ''}
                                        </button>
                                    );
                                })}
                            </Fragment>
                        );
                    })}
                </div>
            </div>
            <p className="text-center text-xs text-slate-500">Churn: commits in the last 12 months →</p>

            <section className="heatmap-files">
                {selected && selected.count > 0 ? (
                    <>
                        <h3 className="mb-3 text-sm font-semibold text-white">
                            {QUADRANTS[selected.quadrant].label}
                            <span className="font-normal text-slate-400"> · {selected.count} files</span>
                        </h3>
                        <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto">
                            {selected.files.map((file) => (
                                <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                                    <button
                                        type="button"
                                        title={`Show ${file.id} on the map`}
                                        onClick={() => onSelectFile(file.id)}
                                        className="min-w-0 flex-1 truncate text-left font-mono text-sm text-violet-200 hover:text-white hover:underline"
                                    >
                                        {file.id}
                                    </button>
                                    <span className="flex gap-1.5">
                                        {file.fragileGod && <Badge tone="rose">Fragile god</Badge>}
                                        {file.isGodFile && !file.fragileGod && <Badge tone="violet">God</Badge>}
                                        {file.isHotspot && <Badge tone="red">Hotspot</Badge>}
                                        {file.inCycle && <Badge tone="amber">Cycle</Badge>}
                                    </span>
                                    <span className="text-xs tabular-nums text-slate-400">
                                        LOC {file.loc} · C{file.maxComplexity}
                                        {file.churn !== null && ` · churn ${file.churn}`}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : (
                    <p className="text-sm text-slate-400">
                        {total === 0 ? 'No files to plot.' : 'Select a cell to see its files.'}
                    </p>
                )}
            </section>
        </div>
    );
}
