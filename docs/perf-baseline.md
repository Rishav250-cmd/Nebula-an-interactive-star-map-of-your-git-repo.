# Nebula performance baseline

Runs were measured on 29 Oct 2026 with `DEBUG_TIMING=1`, sending each documented repository to `POST /api/analyze` sequentially in a fresh Node process. Each run used temporary clone and cache directories, so clone time is cold. The React repository's GitHub size estimate (1,103.7 MB) exceeds the default repository limit; runs used `MAX_REPO_MB=1500` and `MAX_CLONE_MB=2000`. `MAX_CODE_FILES` remained 2,000. Step 2 used `MAX_RSS_MB=420`; step 3 used `MAX_RSS_MB=620` to account for worker isolate memory while exercising all three repositories sequentially. Step 2 and 3 used `MAX_ANALYSIS_FILE_KB=300` and `CLONE_TIMEOUT_MS=90000`. Step 3 used `PARSER_WORKERS=2`. Stage and request times are milliseconds. Peak RSS is sampled every 20 ms and includes the Node process state retained between these sequential requests.

## Stage times: baseline → step 2 → step 3

| Stage | Small: chalk | Medium: fastify | Large: React |
|---|---:|---:|---:|
| Clone | 2,614.91 → 3,963.47 → 3,912.86 | 2,719.07 → 4,213.20 → 4,371.52 | 6,776.72 → 10,611.02 → 30,338.43 |
| File walk | 1.61 → 8.43 → 8.22 | 16.64 → 13.01 → 12.99 | 315.17 → 216.70 → 282.12 |
| Churn | 4.36 in request → 1,352.48 background → 1,340.22 background | 4.52 in request → 3,682.03 background → 2,927.16 background | 4.39 in request → 18,493.93 background → 25,559 background |
| Parse | 24.99 → 23.94 → 58.66 | 455.60 → 426.30 → 372.90 | 35.45 → 570.05 → 753.02 |
| Complexity metrics pass | 0.58 → 0.57 → 0.55 | 15.62 → 16.01 → 14.01 | 3.72 → 61.21 → 104.60 |
| Import resolution | 0.30 → 0.26 → 0.31 | 2.12 → 2.14 → 2.45 | 0.34 → 5.92 → 8.83 |
| Cycles | 0.17 → 0.16 → 0.21 | 0.34 → 0.34 → 0.37 | 0.14 → 1.78 → 2.66 |
| Cache write, initial + after churn | 1.39 → 2.92 + 1.43 → 2.16 + 1.50 | 23.36 → 22.68 + 31.07 → 21.52 + 28.74 | 7.49 → 18.35 + 26.74 → 29.23 + 29.80 |
| **Graph-ready request total** | **3,822.34 → 4,979.51 → 5,104.01** | **4,426.78 → 6,341.84 → 6,118.27** | **8,919.48 → 14,815.47 → 33,548.69** |
| **Peak RSS** | **114 → 112.6 → 150.1 MB** | **494 → 509.2 → 455.8 MB** | **502 → 519.6 → 473.4 MB** |

The step 3 small run walked 26 files and analyzed 14; Fastify walked 391 and analyzed 296. React walked 7,098 files, filtered four over the 300 KB per-file limit, and found 4,467 JS/TS files. It analyzed 2,000 files and returned successfully with `truncated: true` and `truncatedReason: "file-cap"`; the baseline run stopped at 50 files because of the memory guard. Churn completed after the graph-ready response in all three step 3 runs, and the health endpoint reported history once the refresh finished. The parser logs a warning for files its Babel configuration cannot parse; React contains many Flow syntax files that currently fail parsing.

Compared with step 2, Fastify parsing fell about 13% (426.30 ms to 372.90 ms), while the small repo's parse time grew from 23.94 ms to 58.66 ms because worker startup dominates this tiny input. React parse time was 753.02 ms versus 570.05 ms; it still reaches the 2,000-file cap. Cold React clone time and total time were higher in this single run, so this does not show an end-to-end speedup. Network variability applies to clone duration. Churn (25.6 seconds for React here) remains off the graph-ready path.

## Current critical-path bottlenecks

Aggregated over the step 3 requests, the slowest request-path stages were:

1. **Clone — 38,622.81 ms.** This includes cold Git transfer and checkout; wall time varied substantially between runs.
2. **Parse — 1,184.58 ms.** React contributes 753 ms while analyzing 2,000 files.
3. **File walk — 303.33 ms.** React's 7,098-entry tree dominates this stage.

The deferred churn refresh took 29,826 ms across the three repos, mostly on React. That time is off the graph-ready request path but remains background work. These are single-machine, single-network-path measurements, not repeated-run averages. The small-repository graph was compared directly with the step 2 cache: nodes, edges, and cycles were identical (14, 11, and 0, respectively). The new worker regression test also asserts those outputs for a small cyclic fixture with one malformed file.
