# Nebula performance baseline

Measured 29 Oct 2026 with `DEBUG_TIMING=1` by sending each documented repository to `POST /api/analyze` in one fresh Node process, sequentially. Each repository was cloned into clean temporary storage; timings therefore include a cold clone and a cache write. The React repository's remote size estimate (1,103.7 MB) exceeds the default 250 MB repository limit, so `MAX_REPO_MB=1500` and `MAX_CLONE_MB=2000` were set for this run. The 2,000-file cap and default 420 MB RSS guard were unchanged. Stage times are milliseconds; peak RSS is sampled every 20 ms and is process-wide.

| Stage | Small: chalk/chalk | Medium: fastify/fastify | Large: facebook/react |
|---|---:|---:|---:|
| Clone | 2,614.91 | 2,719.07 | 6,776.72 |
| File walk | 1.61 | 16.64 | 315.17 |
| Churn | 4.36 | 4.52 | 4.39 |
| Parse (includes Babel complexity extraction) | 24.99 | 455.60 | 35.45 |
| Complexity metrics pass | 0.58 | 15.62 | 3.72 |
| Import resolution | 0.30 | 2.12 | 0.34 |
| Cycles | 0.17 | 0.34 | 0.14 |
| Cache write | 1.39 | 23.36 | 7.49 |
| **Total request** | **3,822.34** | **4,426.78** | **8,919.48** |
| **Peak RSS** | **114 MB** | **494 MB** | **502 MB** |

The small run walked 26 files and analyzed 14; the medium run walked 391 files and analyzed 296. React walked 7,171 files, of which 4,468 were JavaScript or TypeScript. It returned successfully but analyzed 50 files before the default RSS guard stopped further parsing (`truncatedReason: "memory"`). This is the current large-repository behavior, not a full parse of all eligible React files.

## Slowest stages

Aggregated across these cold runs, the three longest measured stages were:

1. **Clone — 12,110.70 ms total.** Network transfer and Git checkout dominate cold requests.
2. **Parse — 516.04 ms total.** Fastify accounts for most of the parsing time among the bounded analysis runs.
3. **File walk — 333.42 ms total.** React's 7,171-file tree accounts for nearly all of this time.

The large run's peak RSS exceeded the configured 420 MB parsing guard because it includes the Node process's peak during prior sequential requests and is sampled across the full request. These measurements are a baseline from one machine and one network path; they are not an optimization target or a repeated-run average.
