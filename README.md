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

Graph nodes include file complexity, function counts, and cycle flags. The
`cycles` array lists circular import components; `inCycle` is set on their
nodes and internal edges.

### Function-level endpoints

`GET /api/callgraph` returns resolved function calls for a code file. Depth 1
is the default; depth 2 follows external callees one more level. The response
is capped at 150 nodes and sets `truncated` when the cap is reached:

```sh
API=http://localhost:5001
curl -fsS --get "$API/api/callgraph" \
  --data-urlencode "id=$ANALYSIS_ID" \
  --data-urlencode 'path=lib/response.js' \
  --data-urlencode 'depth=2'
```

`GET /api/file` preserves its code fields and adds a `functions` array for
JavaScript and TypeScript files. Non-code files return an empty array:

```sh
API=http://localhost:5001
curl -fsS --get "$API/api/file" \
  --data-urlencode "id=$ANALYSIS_ID" \
  --data-urlencode 'path=lib/response.js'
```

`GET /api/search` returns up to 10 file matches followed by up to 10 function,
method, or class matches:

```sh
API=http://localhost:5001
curl -fsS --get "$API/api/search" \
  --data-urlencode "id=$ANALYSIS_ID" \
  --data-urlencode 'q=send'
```

GitHub analyses are cached on disk by repository and commit SHA. A repeat
analysis of the same commit reuses the cached graph and function analysis.
ZIP uploads are analyzed on request and are not cached.

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

### Run both servers

Start the backend in one terminal:

```sh
cd Nebula_backend
npm install
npm start
```

It listens on `http://localhost:5001`. In a second terminal, start the frontend:

```sh
cd Nebula_Frontend
npm install
npm run dev
```

Vite prints the frontend URL, usually `http://localhost:5173`.

On the first visit in a browser session, a full-screen Nebula splash appears
with the sharp logo feathered over a blurred backdrop. It adapts to portrait,
landscape, ultrawide, and phone-landscape screens, then fades into the app after
its 2-second loader. Completion is remembered in `sessionStorage` under
`nebula_splash_seen`. Add `?nosplash=1` to the URL to skip the splash for demos
and tests.

### API configuration and analyze flow

The frontend uses `VITE_API_URL` as the backend base URL and defaults to
`http://localhost:5001`. To override it, copy the example and edit
`Nebula_Frontend/.env`:

```sh
cd Nebula_Frontend
cp .env.example .env
```

Set the backend base URL in that file:

```dotenv
VITE_API_URL=http://localhost:5001
```

When a user submits a GitHub URL, the frontend calls `POST /api/analyze` with
`{ "url": "..." }`, then calls `GET /api/graph/:id` with the returned analysis
id. The graph response supplies the repository metadata, nodes, edges, cycles,
and warnings. The code panel and search use `GET /api/file` and `GET /api/search`.
The function view requests `GET /api/callgraph?id=...&path=...&depth=1|2` for
the selected file. Function results are cached in memory while you move between
files and hop depths.

Append `?mock=1` to the frontend URL (for example,
`http://localhost:5173/?mock=1`) to load the mock graph. It tries the backend's
`/api/mock-graph` endpoint and falls back to the local fixture if that endpoint
is unavailable.

### File and function views

Use the **File graph / Function graph** control above the map to switch between
file imports and the selected file's functions and calls. Select a file first
to load its function graph. The `1` and `2 hops` controls choose how many call
levels to include; graphs over 150 functions show a truncation notice. Selecting
a function scrolls the code panel to its source line, and selecting an external
callee switches the function graph to that callee's file.

The floating **Imports**, **Calls**, and **Cycles** buttons control edge
visibility for the current view. Imports hides ordinary file import links,
Calls hides function call links while keeping function nodes, and Cycles shows
or hides circular-import links and their red styling. Controls that do not
apply to the current view are disabled.

The left panel's **Circular imports** list shows detected cycles. Select a cycle
to focus and zoom to its files; select it again, click the file graph
background, or press Escape to clear the focus. Select a file name in an open
cycle to inspect that file.

Search results are grouped into files and symbols when symbols are available.
Choose a function or class result to focus its file and source line. In the
function graph, the matching function is highlighted when it is present.

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

### Shared graph store actions

Other components can use these actions from `useGraphStore`:

```ts
const analyze = useGraphStore((state) => state.analyze);
const selectNode = useGraphStore((state) => state.selectNode);
const focusNode = useGraphStore((state) => state.focusNode);
const setViewMode = useGraphStore((state) => state.setViewMode);
const loadCallGraph = useGraphStore((state) => state.loadCallGraph);
const selectCycle = useGraphStore((state) => state.selectCycle);
const selectFunction = useGraphStore((state) => state.selectFunction);
const setFocusLine = useGraphStore((state) => state.setFocusLine);
const toggleEdges = useGraphStore((state) => state.toggleEdges);

void analyze("https://github.com/expressjs/express");
selectNode("lib/express.js");
focusNode("src/api.js");
setViewMode("function");
void loadCallGraph();
selectCycle(0);
selectFunction("src/api.js#handle:10");
setFocusLine(10);
toggleEdges("calls"); // "imports" and "cycles" are also supported
```

`analyze(url)` runs the full repository analysis flow. `selectNode(id)` sets or
clears the current selection; pass `null` to clear it. `focusNode(id)` selects
the file and increments `focusRequest`, which tells the graph to center and zoom
to it, including when the same file is focused again.
`setViewMode(mode)` selects the file or function view. `loadCallGraph()` loads
the current file using the selected depth and ignores stale responses.
`selectCycle(index)` focuses a cycle (`null` clears only the cycle index), while
`selectFunction(id)` and `setFocusLine(line)` set function and source-line
focus. `toggleEdges(kind)` switches one of the `imports`, `calls`, or `cycles`
visibility flags.
