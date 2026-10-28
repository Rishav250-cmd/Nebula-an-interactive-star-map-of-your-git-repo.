import { performance } from "node:perf_hooks";

export function timingEnabled() {
  return process.env.DEBUG_TIMING === "1";
}

export function logTiming(repoId, stage, durationMs, extra = {}) {
  if (!timingEnabled()) return;
  console.log(JSON.stringify({
    timing: true,
    repoId,
    stage,
    durationMs: Number(durationMs.toFixed(2)),
    ...extra,
  }));
}

export function startTimer() {
  return timingEnabled() ? performance.now() : null;
}

export function elapsedMs(startedAt) {
  return startedAt === null ? 0 : performance.now() - startedAt;
}
