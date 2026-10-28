# Nebula Backend

Express API for the Nebula Git repository visualization project.

## Run locally

```sh
cd Nebula_backend
npm install
npm run dev
```

The server listens on port `5000` by default. Set `PORT` in `.env` to use a different port.

Good-first-issue suggestions use the public GitHub API. Set `GITHUB_TOKEN` in `.env` to an optional GitHub token to increase API rate limits; `.env.example` includes the empty setting.

## Mock and status endpoints

`GET /api/ping` returns HTTP `200` when the API is running:

```json
{
  "ok": true
}
```

`GET /api/mock-graph` serves the sample graph from the repository's `docs/mock-graph.json` file.

`POST /api/analyze` accepts `{ "url": "https://github.com/owner/repo" }`, shallow-clones the repository, builds its graph, and returns `{ "id": string, "status": "ready" }`. The clone directory, URL, and cached graph are recorded in memory.

Repository clones remain limited to 200 commits. Churn can use only Git history available in the clone; a checkout Git identifies as shallow returns zero churn, while a complete checkout counts commits in the configured analysis window.

## Graph endpoints

`POST /api/graph` accepts the same `{ "url": "https://github.com/owner/repo" }` body and returns the graph with an extra `id` field. `GET /api/graph/:id` returns the cached graph, or builds and caches it if needed. Unknown IDs return HTTP `404`.

The graph includes `repo`, the checked-out `sha`, source-file `nodes`, resolved import `edges`, an empty `cycles` list, and `warnings`. Source files are read directly from the local clone; the analyzer does not request file contents from the GitHub API. It includes `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, and `.cjs` files up to 1 MB, and analyzes at most 2,000 code files sorted by path. Relative imports and configured TypeScript path aliases can resolve to graph edges; package imports are omitted.

## Verify

```sh
npm test
```
