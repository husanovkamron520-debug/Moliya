# Moliya Quiz Racer — Cloudflare multiplayer backend

This repository keeps the original single-device game intact. The multiplayer backend is a separate Cloudflare Worker using SQLite-backed Durable Objects (no Supabase required).

## API
- `GET /api/health`
- `POST /api/rooms` — body: `{"name":"Host"}`
- `POST /api/rooms/:CODE/join` — body: `{"name":"Player 2"}`
- `GET /api/rooms/:CODE/state?token=PLAYER_TOKEN` (fallback snapshot)\n- `GET /api/rooms/:CODE/ws?token=PLAYER_TOKEN` (authenticated WebSocket; pushes live room updates)
- `POST /api/rooms/:CODE/start` — body: `{"token":"...","seq":[...],"tsec":30}`
- `POST /api/rooms/:CODE/answer` — body: `{"token":"...","questionIndex":0,"choice":2,"elapsed":8.4}`

A room is limited to three players. Only the host can start; the server enforces turn order, a server-side answer timer, and score calculation. Correct answers are not exposed in the active question response. WebSocket clients receive room updates immediately; the state endpoint can be used as a fallback.

## Deploy
1. Install Wrangler: `npm i -D wrangler`
2. Authenticate: `npx wrangler login`
3. From this directory run: `npx wrangler deploy`
4. Test: open `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/health`

No secrets or paid bindings are required for this first version. The current original HTML game is not replaced by these backend files; client-side room/lobby integration is the next step.
