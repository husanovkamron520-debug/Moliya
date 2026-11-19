# Moliya Quiz Racer — Cloudflare multiplayer

This branch keeps the original 3D solo game and adds a separate three-player online room. The backend uses Cloudflare Workers + SQLite-backed Durable Objects; no Supabase project is needed.

## What is included

- `/` opens the original Most Wanted Quiz Racer solo game.
- The original game page adds an **ONLINE XONA** link.
- `/online.html` provides create-room / join-room / lobby / synchronized quiz screens.
- Rooms support exactly three players; the host starts the match.
- The host's built-in or saved question pack is exported from the original game page to browser local storage and read by the online page.
- The server enforces turn order, answer deadline, scoring, and hides correct answers until the question is answered. Durable Object alarms automatically time out unanswered turns even if the active player disconnects.
- WebSockets broadcast room and score updates; the state endpoint is available as fallback.

## Deploy

1. Install Wrangler: `npm i -D wrangler`
2. Authenticate with Cloudflare: `npx wrangler login`
3. From the repository root run: `npx wrangler deploy`
4. Check `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/health`
5. Open the Worker root URL. It redirects to the original solo game.
6. On the solo page, tap **ONLINE XONA**. The built-in quiz pack is saved automatically for the host browser.
7. Enter the same Worker URL on all three devices. One creates the room; the other two join using the six-character code.

## Online game flow

- Host taps **Xona yaratish**.
- Two other players enter their names and the room code.
- When all three are present, the host taps **O‘yinni boshlash**.
- Turns rotate between the three players. Only the active player can submit an answer.
- The other two devices see the live question, current turn, and synchronized scores.

## API

- `GET /api/health`
- `POST /api/rooms` — `{"name":"Host"}`
- `POST /api/rooms/:CODE/join` — `{"name":"Player 2"}`
- `GET /api/rooms/:CODE/state?token=PLAYER_TOKEN`
- `GET /api/rooms/:CODE/ws?token=PLAYER_TOKEN`
- `POST /api/rooms/:CODE/start` — `{"token":"...","seq":[...],"tsec":30}`
- `POST /api/rooms/:CODE/answer` — `{"token":"...","questionIndex":0,"choice":2}`

Question items use `{q, opts, correct, e, d}`. The sequence must contain 12–90 questions, divisible by three, with four options per question.

## Current scope and limitations

The online mode currently synchronizes the quiz and scores across three devices. The original 3D garage and live race are still part of Solo mode; synchronized online garage/race controls are a later integration step. The Worker has not yet been deployed or tested against a live Cloudflare account, so deploy and three-device testing are still required before using it in class.
