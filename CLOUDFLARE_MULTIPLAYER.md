# Moliya Quiz Racer — Cloudflare multiplayer backend

This repository keeps the original single-device game intact. The multiplayer backend is a separate Cloudflare Worker using SQLite-backed Durable Objects (no Supabase required).

## API
- `GET /api/health`
- `POST /api/rooms` — body: `{"name":"Host"}`
- `POST /api/rooms/:CODE/join` — body: `{"name":"Player 2"}`
- `GET /api/rooms/:CODE/state?token=PLAYER_TOKEN`
- `POST /api/rooms/:CODE/start` — body: `{"token":"...","seq":[...],"tsec":30}`
- `POST /api/rooms/:CODE/answer` — body: `{"token":"...","questionIndex":0,"choice":2,"elapsed":8.4}`

A room is limited to three players. Only the host can start; the server enforces turn order and calculates scores. Correct answers are not exposed in the active question response.

## Deploy
1. Install Wrangler: `npm i -D wrangler`
2. Authenticate: `npx wrangler login`
3. From this directory run: `npx wrangler deploy`
4. Test: open `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/health`

No secrets or paid bindings are required for this first version. The current original HTML game is not replaced by these backend files; client-side room/lobby integration is the next step.
