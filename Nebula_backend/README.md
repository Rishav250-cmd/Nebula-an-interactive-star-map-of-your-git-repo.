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
