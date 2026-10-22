# Nebula API contract

This document describes the implemented Day 2 backend API. All endpoints are rooted at `http://localhost:5001/api`. JSON request bodies use `Content-Type: application/json`. Repository paths use `/` separators and are relative to the repository root.

## Implemented endpoints

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `POST` | `/api/analyze` | JSON: `{ "url": "https://github.com/owner/repo" }` | `{ "id": string, "status": "ready" }` |
| `POST` | `/api/graph` | Same JSON body as `/api/analyze` | `GraphData` plus an `id` field |
| `GET` | `/api/graph/:id` | Analysis `id` in the path | `GraphData`; `404 { "error": "Unknown repository id" }` if the id is unknown |
| `POST` | `/api/upload` | Multipart form with one `.zip` file in the `file` field; maximum compressed size is 50 MB | `{ "id": string, "status": "done", "fileCount": number, "files": string[], "tree": FileTree }` |
| `GET` | `/api/mock-graph` | No parameters | Example graph JSON from `docs/mock-graph.json` |

`POST /api/analyze` clones a public GitHub repository and stores its graph for retrieval. `POST /api/graph` is a convenience endpoint that runs the same clone and graph pipeline and returns the graph immediately, with the analysis id added. `GET /api/graph/:id` builds and caches the graph if it has not been built yet.

`POST /api/upload` extracts a ZIP archive, returns the file list and tree, and stores the repository for later graph retrieval through `GET /api/graph/:id`. Uploads must be `.zip` files no larger than 50 MB; extraction rejects unsafe paths and is capped at 20,000 entries and 200 MB uncompressed. An archive with one top-level directory is treated as though that directory were the repository root. The graph's `repo` field is the uploaded ZIP filename. ZIP archives do not contain Git commit metadata, so their graph `sha` is the upload id.

The backend also serves `GET /api/ping` and `GET /health`, both returning a small health response.

## Planned endpoints

These routes describe future API work and are not implemented in the Day 2 backend yet.

| Method | Path | Request | Planned response shape |
| --- | --- | --- | --- |
| `GET` | `/api/file?id=:id&path=:path` | Analysis id and repository-relative path | `{ "content": string, "language": string, "loc": number }` |
| `GET` | `/api/callgraph?id=:id&path=:path` | Analysis id and repository-relative path | `{ "nodes": Node[], "edges": Edge[] }` |
| `GET` | `/api/search?id=:id&q=:q` | Analysis id and search query | `SearchResult[]` |
| `GET` | `/api/blast?id=:id&path=:path` | Analysis id and repository-relative path | `{ "affected": string[], "count": number, "depthMap": Record<string, number> }` |
| `GET` | `/api/health/:id` | Analysis id | `{ "grade": string, "hotspots": Hotspot[], "godFiles": string[], "cycleCount": number }` |
| `GET` | `/api/onboarding/:id` | Analysis id | `{ "path": string[], "issues": OnboardingIssue[] }` |

## Shared shapes

### GraphData

```ts
type GraphData = {
  repo: string;           // GitHub URL or uploaded ZIP filename
  sha: string;            // Git commit SHA, or upload id for ZIP archives
  nodes: Node[];
  edges: Edge[];
  cycles: string[][];
  warnings: GraphWarning[];
};
```

### Node

```ts
type Node = {
  id: string;          // repository-relative file path; unique within a graph
  folder: string;      // top-level folder, or "." for a root-level file
  loc: number;         // lines of code
  tokens: number;      // token count
  complexity: number;  // cyclomatic complexity
  churn: number;       // file change activity count for the analysis window
  healthScore: number | null; // normalized score from 0 to 100 when available
  isGodFile: boolean;
  inCycle: boolean;
  fanIn: number;       // number of incoming dependency edges
  fanOut: number;      // number of outgoing dependency edges
};
```

### Edge

```ts
type Edge = {
  source: string;              // source node id
  target: string;              // target node id
  type: "import" | "call";
};
```

Day 2 currently emits import edges. `complexity`, `churn`, `healthScore`, `isGodFile`, `inCycle`, and the top-level `cycles` are placeholders until Days 3 and 4; complexity and churn are `0`, health scores are `null`, boolean placeholders are `false`, and `cycles` is an empty array.

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
