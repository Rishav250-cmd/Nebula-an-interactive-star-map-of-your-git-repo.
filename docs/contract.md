# Nebula API contract

This document describes the implemented Nebula backend API. All endpoints are rooted at `http://localhost:5001/api`. JSON request bodies use `Content-Type: application/json`. Repository paths use `/` separators and are relative to the repository root.

## Implemented endpoints

| Method | Path                                            | Request                                                                                   | Response                                                                                         |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/api/analyze`                                  | JSON: `{ "url": "https://github.com/owner/repo", "async"?: true }`                       | Blocking: `{ "id": string, "status": "ready" }`; async: `202 { "id": string, "status": "cloning" }` |
| `GET`  | `/api/analyze/:id/status`                       | Analysis `id` in the path                                                                 | `{ "id": string, "status": JobStatus, "error": string \| null, "progress": Progress }`; `404` if unknown |
| `GET`  | `/api/progress/:id`                             | Analysis `id` in the path                                                                 | Server-Sent Events with `data: JobState` updates; ends on `ready` or `error`                      |
| `POST` | `/api/graph`                                    | Same JSON body as `/api/analyze`                                                          | `GraphData` plus an `id` field                                                                   |
| `GET`  | `/api/graph/:id`                                | Analysis `id` in the path                                                                 | `GraphData` including cycles and file complexity; `404` if the id is unknown                     |
| `POST` | `/api/upload`                                   | Multipart form with one `.zip` file in the `file` field; maximum compressed size is 50 MB | `{ "id": string, "status": "done", "fileCount": number, "files": string[], "tree": FileTree }`   |
| `GET`  | `/api/mock-graph`                               | No parameters                                                                             | Example graph JSON from `docs/mock-graph.json`                                                   |
| `GET`  | `/api/callgraph?id=:id&path=:path&depth=:depth` | Analysis id, analyzed code path, optional depth `1` or `2` (default `1`)                  | `CallGraph`; `400` for missing id/path or invalid depth, `404` for unknown id or unanalyzed path |
| `GET`  | `/api/file?id=:id&path=:path`                   | Analysis id and repository-relative path                                                  | `{ "content": string, "language": string, "loc": number, "functions": FileFunction[] }`          |
| `GET`  | `/api/search?id=:id&q=:q`                       | Analysis id and search query (case-insensitive)                                           | Up to 10 file results followed by up to 10 symbol results                                        |
| `GET`  | `/api/blast?id=:id&path=:path&depth=:depth`     | Analysis id, graph node path, optional integer depth 1–6 (default `4`)                    | `BlastResult`; `400` for missing path or invalid depth, `404` for unknown id or non-node path      |
| `GET`  | `/api/onboarding/:id`                           | Analysis `id` in the path                                                                 | `OnboardingResult`; `404` if unknown                                                             |

`POST /api/analyze` clones a public GitHub repository and stores its graph for retrieval. Blocking behavior is the default. With `"async": true`, it returns `202` immediately and runs the job in the background. A second async request for a currently running repository reuses that job. `GET /api/analyze/:id/status` returns the current job state, and `GET /api/progress/:id` streams state changes as Server-Sent Events. Job states are `cloning`, `listing`, `parsing`, `graph`, `ready`, and `error`; parsing progress reports `{ "done": number, "total": number }`. Jobs have a three-minute timeout. `POST /api/graph` runs the same clone and graph pipeline and returns the graph immediately with the analysis id added. `GET /api/graph/:id` builds and caches the graph if it has not been built yet. GitHub analyses are cached on disk by repository and commit SHA; ZIP uploads are not cached.

`POST /api/upload` extracts a ZIP archive, returns the file list and tree, and stores the repository for later graph retrieval through `GET /api/graph/:id`. Uploads must be `.zip` files no larger than 50 MB; extraction rejects unsafe paths and is capped at 20,000 entries and 200 MB uncompressed. An archive with one top-level directory is treated as though that directory were the repository root. The graph's `repo` field is the uploaded ZIP filename. ZIP archives do not contain Git commit metadata, so their graph `sha` is the upload id.

The backend also serves `GET /api/ping` and `GET /health`, both returning a small health response.

`GET /api/file` reads one text file from the stored repository for the code panel. It returns `400` for a missing `id`/`path` or an unsafe path (absolute, `..`, or a symlink leaving the repo), `404` for an unknown id, a missing file, a directory, or files Nebula never indexes (`.git`, `node_modules`, images, lock files), `413` for files over 1 MB, and `415` for binary files. `language` is a react-syntax-highlighter name (for example `javascript`, `tsx`, `python`) or `plaintext`, and `loc` is the number of lines. `functions` is empty for non-code files; for code files it lists each function, method, and class with its kind, line range, and complexity.

`GET /api/search` matches the query against indexed file paths and symbol names or paths. Exact file names rank first, then names that start with the query, then names that contain it, then folder-only matches. File results come first and have `{ "type": "file", "name": file name, "path": repo-relative path, "line": 1 }`; symbol results have `{ "type": "symbol", "name": symbol name, "path": repo-relative path, "line": number, "kind": "function" | "method" | "class" }`. Each result group is capped at 10. It returns `400` when `id` is missing or `q` is repeated or longer than 200 characters, and `404` for an unknown id.

`GET /api/blast` walks reverse import edges to find files that depend on the selected file. Its response includes the starting `file`, affected file ids and depths, `count`, `depthMap`, `byDepth`, `maxDepthReached`, `truncated`, `totalFiles`, and `percentOfRepo` rounded to one decimal place. A node's `blastRadius` is the number of files reachable through importer edges up to depth 4.

`GET /api/onboarding/:id` returns an entry point, a breadth-first reading path of up to eight files, up to five low-risk starter files, and issue suggestions matched to repository files. The full response is cached in memory for ten minutes. GitHub issues are fetched only for GitHub repository analyses; ZIP uploads return `issuesStatus: "none"`.

Good-first-issue fetching uses the public GitHub API. `GITHUB_TOKEN` is optional and can be set in `Nebula_backend/.env` to raise the API rate limit. Keep the token private and do not commit it.

## Planned endpoints

These routes are planned and are not implemented yet.

| Method | Path                           | Request                                  | Planned response shape                                                                   |
| ------ | ------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET`  | `/api/health/:id`              | Analysis id                              | `{ "grade": string, "hotspots": Hotspot[], "godFiles": string[], "cycleCount": number }` |

## Shared shapes

### GraphData

```ts
type GraphData = {
  repo: string; // GitHub URL or uploaded ZIP filename
  sha: string; // Git commit SHA, or upload id for ZIP archives
  nodes: Node[];
  edges: Edge[];
  cycles: string[][];
  warnings: GraphWarning[];
};
```

### Node

```ts
type Node = {
  id: string; // repository-relative file path; unique within a graph
  folder: string; // top-level folder, or "." for a root-level file
  loc: number; // lines of code
  tokens: number; // token count
  complexity: number; // file cyclomatic complexity
  functionCount: number; // functions and methods; excludes class declarations
  churn: number; // commits touching this file in the last 12 months; 0 if unavailable
  healthScore: number | null; // normalized score from 0 to 100 when available
  isGodFile: boolean;
  inCycle: boolean; // true when this file belongs to a circular import component
  fanIn: number; // number of incoming dependency edges
  fanOut: number; // number of outgoing dependency edges
  blastRadius: number; // number of importer files affected within four reverse-edge levels
};
```

### Edge

```ts
type Edge = {
  source: string; // source node id
  target: string; // target node id
  type: "import" | "call";
  inCycle: boolean; // true when both endpoints belong to the same import cycle
};
```

### Async job state

```ts
type JobStatus = "cloning" | "listing" | "parsing" | "graph" | "ready" | "error";
type Progress = { done: number; total: number };
type JobState = {
  id: string;
  status: JobStatus;
  error: string | null;
  progress: Progress;
};
```

The SSE endpoint sends the current `JobState` immediately, checks for changes every 300 ms, and sends a comment heartbeat every 15 seconds. It closes after `ready` or `error`, or when the client disconnects.

### BlastResult

```ts
type BlastResult = {
  file: string;
  count: number;
  affected: { id: string; depth: number }[];
  depthMap: Record<string, number>;
  byDepth: Record<string, number>;
  maxDepthReached: number;
  truncated: boolean;
  totalFiles: number;
  percentOfRepo: number;
};
```

The endpoint defaults to depth 4 and accepts depths 1 through 6. Its response cap is 500 affected files; `truncated` indicates that additional files were available.

### OnboardingResult

```ts
type OnboardingPathStep = {
  id: string;
  depth: number;
  reason: string;
  blastRadius: number;
  complexity: number;
  loc: number;
  safety: number;
};
type OnboardingStarter = { id: string; safety: number; reason: string };
type MatchedIssueFile = { id: string; score: number; reason: string };
type OnboardingIssue = {
  number: number;
  title: string;
  url: string;
  labels: string[];
  files: MatchedIssueFile[];
  blastRadius: number | null;
  difficulty: "easy" | "medium" | "hard" | "unknown";
};
type OnboardingResult = {
  entry: string | null;
  path: OnboardingPathStep[];
  safeStarters: OnboardingStarter[];
  issues: OnboardingIssue[];
  issuesStatus: "ok" | "none" | "rate_limited" | "not_found" | "unavailable";
  issuesResetAt: number | null;
};
```

`issuesResetAt` is a Unix timestamp in milliseconds when GitHub supplies a rate-limit reset time, or `null` when unavailable. `issuesStatus` reports issue-fetch state independently of the onboarding path, so rate limits and API failures do not prevent path results.

`cycles` contains strongly connected import components with more than one file, plus self-importing files. Files inside each cycle are sorted alphabetically; cycles are sorted by descending size and then by their first file. A node has `inCycle: true` when it belongs to one of these components. An edge has `inCycle: true` only when both endpoints belong to the same component; all other edges have `false`.

`complexity` is the file's cyclomatic complexity. `functionCount` counts functions and methods, excluding class declaration entries. `churn` counts commits in the last 12 months that touched a file, counting a path at most once per commit. It reflects only Git history available in the checkout. Repository clones are limited to 200 commits; a checkout Git identifies as shallow reports zero churn. ZIP uploads have no Git history and report zero. `healthScore` and `isGodFile` are supplied by the health-analysis work; their values may be `null` and `false` when unavailable.

### CallGraph

```ts
type CallGraph = {
  file: string;
  depth: 1 | 2;
  nodes: CallGraphNode[]; // at most 150 nodes
  edges: CallGraphEdge[];
  truncated: boolean;
};

type CallGraphNode = {
  id: string; // `${file}#${name}:${line}`
  name: string;
  kind: "function" | "method" | "class";
  file: string;
  line: number;
  endLine: number;
  complexity: number;
  external: boolean; // true when this function is in another repository file
};

type CallGraphEdge = {
  source: string; // caller function id
  target: string; // callee function id
  type: "call";
};
```

Depth 1 includes the selected file's symbols and resolved callees in other files. Depth 2 follows those external callees' calls one additional level. Unresolved calls are omitted. `truncated` is true when the 150-node cap prevents adding more nodes.

### FileFunction

```ts
type FileFunction = {
  name: string;
  kind: "function" | "method" | "class";
  line: number;
  endLine: number;
  complexity: number;
};
```

### GraphWarning

```ts
type GraphWarning = {
  file: string;
  message: string;
};
```

Warnings report parse failures, files skipped for exceeding 1 MB, and repositories capped at 2,000 code files. The `warnings` array is present even when it is empty.

### FileTree

```ts
type FileTree = {
  [name: string]: FileTree | null; // null marks a file; objects contain directories
};
```

### SearchResult

```ts
type SearchResult = {
  type: "file" | "symbol";
  name: string;
  path: string;
  line: number;
  kind?: "function" | "method" | "class"; // present for symbol results
};
```

### Hotspot

```ts
type Hotspot = {
  path: string;
  healthScore: number;
  reasons: string[];
};
```

### OnboardingIssue

```ts
type OnboardingIssue = {
  title: string;
  url: string;
  files: string[];
  reason: string;
};
```

See [mock-graph.json](./mock-graph.json) for an example graph payload.
