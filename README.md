# Nebula

Nebula turns a public GitHub repository into an interactive dependency graph.

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
