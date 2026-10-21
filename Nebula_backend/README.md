# Nebula Backend

Express API for the Nebula Git repository visualization project.

## Run locally

```sh
cd Nebula_backend
npm install
npm run dev
```

The server listens on port `3000` by default. Set `PORT` to use a different port.

## Health endpoint

`GET /health` returns HTTP `200` when the API is running:

```json
{
  "status": "ok"
}
```

## Build a repository graph

`POST /api/graph` accepts a public GitHub repository URL:

```sh
curl -X POST http://localhost:3000/api/graph \
  -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/octocat/hello-world"}'
```

The response includes repository metadata, source-file nodes, and directed edges for resolved, repo-relative imports:

```json
{
  "repository": {
    "name": "octocat/hello-world",
    "url": "https://github.com/octocat/hello-world",
    "defaultBranch": "main",
    "commit": "<commit-sha>"
  },
  "nodes": [
    {
      "id": "src/index.ts",
      "label": "index.ts",
      "path": "src/index.ts",
      "language": "ts"
    }
  ],
  "edges": [
    {
      "id": "src/index.ts->src/lib.ts",
      "source": "src/index.ts",
      "target": "src/lib.ts"
    }
  ]
}
```

The analyzer currently reads JavaScript and TypeScript files, and resolves literal relative imports. Package imports such as `react`, path aliases, and computed imports are not included. It analyzes at most 200 source files of up to 512 KiB each; larger Git trees or source sets return HTTP `413`.

GitHub access uses its [repository API](https://docs.github.com/en/rest/repos/repos) and [Git trees API](https://docs.github.com/en/rest/git/trees), then reads source files at the selected commit.

## Verify

```sh
npm test
```
