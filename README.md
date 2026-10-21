# Nebula

Nebula turns a public GitHub repository into an interactive dependency graph.

## Backend

### Prerequisites

- Node.js and npm
- Git installed and available on `PATH` (used to clone repositories)

### Install and run

```sh
cd Nebula_backend && npm install
npm run dev
```

The API listens on port `5000` by default. Set `PORT` to use another port.

### Endpoints available so far

- `GET /api/ping` — returns `{ "ok": true }` when the API is running.
- `GET /health` — returns `{ "status": "ok" }`.
- `GET /api/mock-graph` — serves the sample graph in `docs/mock-graph.json`.
- `POST /api/analyze` — accepts `{ "url": "https://github.com/owner/repo" }`, clones the repository, and returns its ID, filtered file list, and directory tree.
- `POST /api/graph` — accepts `{ "repoUrl": "https://github.com/owner/repo" }` and returns a dependency graph for supported JavaScript and TypeScript imports.

Analyze a public repository:

```sh
curl -X POST http://localhost:5000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/expressjs/express"}'
```
