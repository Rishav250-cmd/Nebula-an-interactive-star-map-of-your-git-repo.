# Nebula API contract

This document defines the planned v1 JSON contract for repository analysis. Endpoint owners are backend components responsible for the behavior; they are not individual people.

All endpoints are rooted at `/api`. JSON request bodies use `Content-Type: application/json`. Query values such as file paths should be URL-encoded.

## Endpoints

| Method | Path | Request | Response shape | Owner |
| --- | --- | --- | --- | --- |
| `POST` | `/api/analyze` | JSON body: `{ "url": "https://github.com/owner/repo" }` | `{ "id": string, "status": "queued" \| "processing" \| "ready" \| "failed" }` | `AnalysisService` |
| `GET` | `/api/graph/:id` | `id` path parameter | `{ "repo": string, "sha": string, "nodes": Node[], "edges": Edge[], "cycles": string[][] }` | `GraphService` |
| `GET` | `/api/file?id=:id&path=:path` | `id` and repository-relative `path` query parameters | `{ "content": string, "language": string, "loc": number }` | `FileService` |
| `GET` | `/api/callgraph?id=:id&path=:path` | `id` and repository-relative `path` query parameters | `{ "nodes": Node[], "edges": Edge[] }` | `CallGraphService` |
| `GET` | `/api/search?id=:id&q=:q` | `id` and search query `q` query parameters | `SearchResult[]` | `SearchService` |
| `GET` | `/api/blast?id=:id&path=:path` | `id` and repository-relative `path` query parameters | `{ "affected": string[], "count": number, "depthMap": Record<string, number> }` | `BlastRadiusService` |
| `GET` | `/api/health/:id` | `id` path parameter | `{ "grade": string, "hotspots": Hotspot[], "godFiles": string[], "cycleCount": number }` | `HealthService` |
| `GET` | `/api/onboarding/:id` | `id` path parameter | `{ "path": string[], "issues": OnboardingIssue[] }` | `OnboardingService` |

`id` is the analysis identifier returned by `POST /api/analyze`. Repository paths use `/` separators and are relative to the repository root.

## Shared shapes

### Node

```ts
type Node = {
  id: string;          // repository-relative file path; unique within a graph
  folder: string;      // containing folder, relative to the repository root
  loc: number;         // lines of code
  tokens: number;      // token count
  complexity: number;  // cyclomatic complexity
  churn: number;       // file change activity count for the analysis window
  healthScore: number; // normalized score from 0 to 100
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
