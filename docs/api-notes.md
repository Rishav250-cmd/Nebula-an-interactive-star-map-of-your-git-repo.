# API operations notes

## Keep a free-tier instance awake

Free hosting plans may suspend an idle server. Configure an external uptime monitor or scheduled job to request `GET /api/ping` every 5–10 minutes, subject to the hosting provider's limits. The endpoint returns a small health payload and can confirm that the process is awake; it does not guarantee that the provider will keep a free instance running.

## Analysis cache limits

`MAX_CACHE_REPOS` limits the number of cached repositories (default 30), and `MAX_CACHE_DISK_MB` limits total analysis-cache disk usage (default 250 MB). When either cap is exceeded, the oldest repositories are evicted first. `MAX_CACHE_MB` remains the maximum size of one analysis entry.

## Analysis environment variables

| Variable | Default | Purpose |
| --- | ---: | --- |
| `CLONE_TIMEOUT_MS` | `90000` | Maximum time allowed for a repository clone. |
| `MAX_ANALYSIS_FILE_KB` | `300` | Skip individual files larger than this during repository ingestion. |
| `MAX_FILE_BYTES` | `1048576` (1 MiB) | Parser-side file-size ceiling. |
| `MAX_CODE_FILES` | `2000` | Maximum source files selected for graph analysis. |
| `PARSER_WORKERS` | Up to `2` CPUs | Parser worker count; defaults to the smaller of the available CPU count and two. |
| `MAX_CACHE_REPOS` | `30` | Maximum number of disk-cached analyses. |
| `MAX_CACHE_DISK_MB` | `250` | Total disk-cache size limit in MiB. |
| `MAX_CACHE_MB` | `50` | Maximum size of one cached analysis in MiB. |

Related repository limits are `MAX_REPO_MB` (250 MiB repository estimate) and `MAX_CLONE_MB` (400 MiB checkout size). `MAX_SOURCE_MB` limits selected source content to 40 MiB. `MAX_RSS_MB` (420 MiB) and `MAX_HEAP_MB` (350 MiB) stop analysis when memory approaches those limits. These values can be overridden in the server environment.

## Large repos

Graph analysis selects at most `MAX_CODE_FILES` source files, prioritizing useful source paths before tests, documentation, and examples. It also skips files over `MAX_ANALYSIS_FILE_KB` during ingestion and enforces `MAX_FILE_BYTES` before parsing. If the file-count, source-byte, or memory limit stops analysis, the request can still succeed with a partial graph: `meta.truncated` is `true`, `meta.truncatedReason` identifies the limit, and warnings explain the cutoff. Files that cannot be parsed are skipped and reported as warnings.

The limits bound memory and disk use; they do not guarantee complete graphs for very large repositories. A checkout may be rejected before analysis when it exceeds the repository/clone limits, and unsupported languages or syntax remain outside the JavaScript/TypeScript parser's coverage. Churn history is fetched separately after the graph is ready, so it may not be present in the initial graph response.
