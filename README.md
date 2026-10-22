# Nebula

Nebula turns a public GitHub repository into an interactive dependency graph.

## Backend

The Express backend lives in `Nebula_backend/` and listens on port `5001`.

### Install and run

```sh
cd Nebula_backend
npm install
npm start
```

### Analyze a GitHub repository

`POST /api/analyze` clones and analyzes a public repository. Use the returned id to retrieve its graph:

```sh
API=http://localhost:5001
ANALYSIS_ID=$(curl -fsS "$API/api/analyze" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/expressjs/express"}' | jq -r '.id')
curl -fsS "$API/api/graph/$ANALYSIS_ID"
```

`GET /api/graph/:id` returns the graph with `repo`, `sha`, `nodes`, `edges`, `cycles`, and `warnings`. `POST /api/graph` is a convenience endpoint that accepts the same JSON body as `/api/analyze` and returns the graph immediately, with `id` included:

```sh
API=http://localhost:5001
curl -fsS "$API/api/graph" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/expressjs/express"}'
```

### Upload a ZIP archive

Upload a `.zip` file in the `file` form field (maximum 50 MB). The response contains the file list and tree; use its id to fetch the graph:

```sh
API=http://localhost:5001
UPLOAD_ID=$(curl -fsS "$API/api/upload" \
  -F 'file=@./repository.zip' | jq -r '.id')
curl -fsS "$API/api/graph/$UPLOAD_ID"
```

The graph contract and placeholder fields are documented in [docs/contract.md](docs/contract.md).

## Frontend

The React, Vite, and TypeScript frontend lives in `Nebula_Frontend/`.

### Install and run

```sh
cd Nebula_Frontend
npm install
npm run dev
```

### Configuration

Set `VITE_API_URL` in `Nebula_Frontend/.env` to the backend base URL. Start from
the provided example with:

```sh
cp .env.example .env
```

The default API URL is `http://localhost:5001`. The frontend requests the mock
graph from `/api/mock-graph` and uses its local mock file if the API is
unavailable.

### Source structure

```text
Nebula_Frontend/src/
├── api/client.ts              # Backend requests and local fallback
├── components/                # Top bar, side panels, graph, and node tooltip
├── data/                      # Mock graph and large performance fixture
├── store/useGraphStore.ts     # Shared graph and interaction state
├── styles/theme.css           # Galaxy theme and global styles
├── types/graph.ts             # Graph node, edge, and data types
├── App.tsx                    # App shell and graph loading
└── main.tsx                   # React entry point
```

### Focusing a graph node

Other components can focus a file through the shared store action:

```ts
const focusNode = useGraphStore((state) => state.focusNode);
focusNode('src/api.js');
```

`focusNode(id: string)` selects the node and increments `focusRequest`; the
graph watches that request to center and zoom to the selected file.
