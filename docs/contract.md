# Nebula API contract

This document describes the implemented Day 3 backend API. All endpoints are rooted at `http://localhost:5001/api`. JSON request bodies use `Content-Type: application/json`. Repository paths use `/` separators and are relative to the repository root.

## Implemented endpoints

| Method | Path                                            | Request                                                                                   | Response                                                                                         |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/api/analyze`                                  | JSON: `{ "url": "https://github.com/owner/repo" }`                                        | `{ "id": string, "status": "ready" }`                                                            |
| `POST` | `/api/graph`                                    | Same JSON body as `/api/analyze`                                                          | `GraphData` plus an `id` field                                                                   |
| `GET`  | `/api/graph/:id`                                | Analysis `id` in the path                                                                 | `GraphData` including cycles and file complexity; `404` if the id is unknown                     |
| `POST` | `/api/upload`                                   | Multipart form with one `.zip` file in the `file` field; maximum compressed size is 50 MB | `{ "id": string, "status": "done", "fileCount": number, "files": string[], "tree": FileTree }`   |
| `GET`  | `/api/mock-graph`                               | No parameters                                                                             | Example graph JSON from `docs/mock-graph.json`                                                   |
| `GET`  | `/api/callgraph?id=:id&path=:path&depth=:depth` | Analysis id, analyzed code path, optional depth `1` or `2` (default `1`)                  | `CallGraph`; `400` for missing id/path or invalid depth, `404` for unknown id or unanalyzed path |
| `GET`  | `/api/file?id=:id&path=:path`                   | Analysis id and repository-relative path                                                  | `{ "content": string, "language": string, "loc": number, "functions": FileFunction[] }`          |
| `GET`  | `/api/search?id=:id&q=:q`                       | Analysis id and search query (case-insensitive)                                           | Up to 10 file results followed by up to 10 symbol results                                        |

`POST /api/analyze` clones a public GitHub repository and stores its graph for retrieval. `POST /api/graph` is a convenience endpoint that runs the same clone and graph pipeline and returns the graph immediately, with the analysis id added. `GET /api/graph/:id` builds and caches the graph if it has not been built yet. GitHub analyses are cached on disk by repository and commit SHA; ZIP uploads are not cached.

`POST /api/upload` extracts a ZIP archive, returns the file list and tree, and stores the repository for later graph retrieval through `GET /api/graph/:id`. Uploads must be `.zip` files no larger than 50 MB; extraction rejects unsafe paths and is capped at 20,000 entries and 200 MB uncompressed. An archive with one top-level directory is treated as though that directory were the repository root. The graph's `repo` field is the uploaded ZIP filename. ZIP archives do not contain Git commit metadata, so their graph `sha` is the upload id.

The backend also serves `GET /api/ping` and `GET /health`, both returning a small health response.

`GET /api/file` reads one text file from the stored repository for the code panel. It returns `400` for a missing `id`/`path` or an unsafe path (absolute, `..`, or a symlink leaving the repo), `404` for an unknown id, a missing file, a directory, or files Nebula never indexes (`.git`, `node_modules`, images, lock files), `413` for files over 1 MB, and `415` for binary files. `language` is a react-syntax-highlighter name (for example `javascript`, `tsx`, `python`) or `plaintext`, and `loc` is the number of lines. `functions` is empty for non-code files; for code files it lists each function, method, and class with its kind, line range, and complexity.

`GET /api/search` matches the query against indexed file paths and symbol names or paths. Exact file names rank first, then names that start with the query, then names that contain it, then folder-only matches. File results come first and have `{ "type": "file", "name": file name, "path": repo-relative path, "line": 1 }`; symbol results have `{ "type": "symbol", "name": symbol name, "path": repo-relative path, "line": number, "kind": "function" | "method" | "class" }`. Each result group is capped at 10. It returns `400` when `id` is missing or `q` is repeated or longer than 200 characters, and `404` for an unknown id.

## Planned endpoints

These routes describe future API work and are not implemented in the Day 3 backend yet.

| Method | Path                           | Request                                  | Planned response shape                                                                   |
| ------ | ------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET`  | `/api/blast?id=:id&path=:path` | Analysis id and repository-relative path | `{ "affected": string[], "count": number, "depthMap": Record<string, number> }`          |
| `GET`  | `/api/health/:id`              | Analysis id                              | `{ "grade": string, "hotspots": Hotspot[], "godFiles": string[], "cycleCount": number }` |
| `GET`  | `/api/onboarding/:id`          | Analysis id                              | `{ "path": string[], "issues": OnboardingIssue[] }`                                      |

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
  churn: number; // file change activity count for the analysis window
  healthScore: number | null; // normalized score from 0 to 100 when available
  isGodFile: boolean;
  inCycle: boolean; // true when this file belongs to a circular import component
  fanIn: number; // number of incoming dependency edges
  fanOut: number; // number of outgoing dependency edges
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

`cycles` contains strongly connected import components with more than one file, plus self-importing files. Files inside each cycle are sorted alphabetically; cycles are sorted by descending size and then by their first file. A node has `inCycle: true` when it belongs to one of these components. An edge has `inCycle: true` only when both endpoints belong to the same component; all other edges have `false`.

`complexity` is the file's cyclomatic complexity. `functionCount` counts functions and methods, excluding class declaration entries. `churn` is owned by Varish; `healthScore` and `isGodFile` are planned for Day 4. Their current values are `0`, `null`, and `false`, respectively.

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
