# Nebula performance baseline

Both runs were measured on 29 Oct 2026 with `DEBUG_TIMING=1`, sending each documented repository to `POST /api/analyze` sequentially in one fresh Node process. Each run used clean temporary clone and cache directories, so clone time is cold. The React repository's GitHub size estimate (1,103.7 MB) exceeds the default repository limit; both runs used `MAX_REPO_MB=1500` and `MAX_CLONE_MB=2000`. `MAX_CODE_FILES` remained 2,000 and `MAX_RSS_MB` remained 420. The step 2 run also set `MAX_ANALYSIS_FILE_KB=300` and `CLONE_TIMEOUT_MS=90000` (the existing default). Stage and request times are milliseconds. Peak RSS is sampled every 20 ms and includes the Node process state retained between these sequential requests.

## Stage times: baseline → step 2

| Stage | Small: chalk | Medium: fastify | Large: React |
|---|---:|---:|---:|
| Clone | 2,614.91 → 3,963.47 | 2,719.07 → 4,213.20 | 6,776.72 → 10,611.02 |
| File walk | 1.61 → 8.43 | 16.64 → 13.01 | 315.17 → 216.70 |
| Churn | 4.36 in request → 1,352.48 background | 4.52 in request → 3,682.03 background | 4.39 in request → 18,493.93 background |
| Parse | 24.99 → 23.94 | 455.60 → 426.30 | 35.45 → 570.05 |
| Complexity metrics pass | 0.58 → 0.57 | 15.62 → 16.01 | 3.72 → 61.21 |
| Import resolution | 0.30 → 0.26 | 2.12 → 2.14 | 0.34 → 5.92 |
| Cycles | 0.17 → 0.16 | 0.34 → 0.34 | 0.14 → 1.78 |
| Cache write, initial + after churn | 1.39 → 2.92 + 1.43 | 23.36 → 22.68 + 31.07 | 7.49 → 18.35 + 26.74 |
| **Graph-ready request total** | **3,822.34 → 4,979.51** | **4,426.78 → 6,341.84** | **8,919.48 → 14,815.47** |
| **Peak RSS** | **114 → 112.6 MB** | **494 → 509.2 MB** | **502 → 519.6 MB** |

The small run walked 26 files and analyzed 14. Fastify walked 391 and analyzed 296. React walked 7,098 files, filtered four over the 300 KB per-file limit, and found 4,467 JS/TS files. It analyzed 2,000 files and returned successfully with `truncated: true` and `truncatedReason: "file-cap"`; the baseline run stopped at 50 files because of the memory guard. Churn completed after the graph-ready response in all three runs, and the health endpoint reported history once the refresh finished.

The React file-walk stage fell about 31% (315.17 ms to 216.70 ms), and Fastify parsing fell about 6% (455.60 ms to 426.30 ms). React now reaches the 2,000-file cap instead of stopping at 50. Request totals increased in this single cold comparison, alongside higher measured clone times; network variability and the much larger React parse make this unsuitable for claiming a clone-time improvement. The main latency change is that churn (18.5 seconds for React here) no longer holds the graph-ready response open.

## Current critical-path bottlenecks

Aggregated over the step 2 requests, the slowest request-path stages were:

1. **Clone — 18,787.69 ms.** This includes cold Git transfer and checkout; its wall time was higher than the one-shot baseline in this run.
2. **Parse — 1,020.29 ms.** React contributes 570 ms while analyzing 2,000 files.
3. **File walk — 238.14 ms.** React's 7,098-entry tree dominates this stage.

The deferred churn refresh took 23,528.44 ms across the three repos, mostly on React. That time is off the graph-ready request path but remains background work. These are single-machine, single-network-path measurements, not repeated-run averages.
