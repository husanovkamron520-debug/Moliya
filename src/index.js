/**
 * Moliya Quiz Racer — Cloudflare multiplayer room server
 * Runtime: Cloudflare Workers + Durable Objects (SQLite-backed).
 * API: POST /api/rooms, POST /api/rooms/:code/join,
 *      GET /api/rooms/:code/state?token=..., POST /api/rooms/:code/start,
 *      POST /api/rooms/:code/answer
 */
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS" }
});
const fail = (message, status = 400) => json({ error: message }, status);
const code = () => Array.from(crypto.getRandomValues(new Uint8Array(6)))
  .map(x => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x % 32]).join("");
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)))
  .map(x => x.toString(16).padStart(2, "0")).join("");

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: {
      "access-control-allow-origin": "*", "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS" } });
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ ok: true, service: "moliya-quiz-racer" });
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || "").trim().slice(0, 24);
      if (!name) return fail("Ism kiriting.");
      const roomCode = code();
      const id = env.ROOMS.idFromName(roomCode);
      const stub = env.ROOMS.get(id);
      const res = await stub.fetch("https://room.internal/init", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: roomCode, name }) });
      return res;
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|state|start|answer|ws)$/);
    if (!match) return fail("API endpoint topilmadi.", 404);
    const [, roomCode, action] = match;
    const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
    return stub.fetch(new Request("https://room.internal/" + action + url.search, request));
  }
};

export class MultiplayerRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = null;
    // Durable Object instances can be recreated after hibernation/restart.
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get("room") || null;
    });
  }
  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      if (this.state) return fail("Xona allaqachon mavjud.", 409);
      const b = await request.json();
      const host = { id: token(), publicId: crypto.randomUUID(), name: b.name, role: "host", joinedAt: Date.now() };
      this.state = { code: b.code, status: "waiting", hostId: host.id,
        players: [host], game: null, updatedAt: Date.now() };
      await this.save();
      return json({ code: b.code, token: host.id, player: host, state: this.publicState() });
    }
    if (!this.state) return fail("Xona topilmadi yoki muddati tugagan.", 404);
    if (url.pathname === "/join" && request.method === "POST") {
      const b = await request.json();
      const name = String(b.name || "").trim().slice(0, 24);
      if (!name) return fail("Ism kiriting.");
      if (this.state.status !== "waiting") return fail("O‘yin boshlangan.", 409);
      if (this.state.players.length >= 3) return fail("Xona to‘la (3/3).", 409);
      if (this.state.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
        return fail("Bu ism xonada band.", 409);
      const player = { id: token(), publicId: crypto.randomUUID(), name, role: "player", joinedAt: Date.now() };
      this.state.players.push(player); await this.save(); await this.broadcast();
      return json({ code: this.state.code, token: player.id, player, state: this.publicState() });
    }
    const auth = request.method === "GET" ? url.searchParams.get("token") : (await request.clone().json().catch(() => ({}))).token;
    const player = this.state.players.find(p => p.id === auth);
    if (!player) return fail("Ruxsat yo‘q. Xonaga qayta kiring.", 401);
    if (url.pathname === "/state" && request.method === "GET") return json(this.publicState(player.id));
    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ token: player.id });
      server.send(JSON.stringify({ type: "state", state: this.publicState(player.id) }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/start" && request.method === "POST") {
      if (player.id !== this.state.hostId) return fail("Faqat xona egasi boshlashi mumkin.", 403);
      if (this.state.status !== "waiting") return fail("O‘yin allaqachon boshlangan.", 409);
      if (this.state.players.length !== 3) return fail("Boshlash uchun 3 o‘yinchi kerak.", 409);
      const b = await request.json();
      const seq = b.seq;
      if (!Array.isArray(seq) || seq.length < 12 || seq.length > 90 || seq.length % 3 !== 0 ||
          seq.some(q => !q || typeof q.q !== "string" || !Array.isArray(q.opts) ||
            q.opts.length !== 4 || !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3))
        return fail("Savollar paketi noto‘g‘ri (12–90 ta, 3 ga bo‘linadigan savol; har birida 4 variant).");
      const per = Math.floor(seq.length / 3);
      this.state.game = { per, tsec: Math.max(10, Math.min(90, Number(b.tsec) || 30)),
        seq, qi: 0, questionStartedAt: Date.now(), teams: this.state.players.map((p, i) => ({
          playerId: p.id, playerPublicId: p.publicId, name: p.name, bounty: 0, correct: 0, answered: 0,
          streak: 0, idx: i, lv: { tires: 0, engine: 0, turbo: 0, aero: 0, weight: 0 },
          p50: 2, pT: 3
        })), reveal: null };
      this.state.status = "playing"; await this.save(); await this.broadcast();
      return json(this.publicState(player.id));
    }
    if (url.pathname === "/answer" && request.method === "POST") {
      const b = await request.json();
      const g = this.state.game;
      if (!g || this.state.status !== "playing") return fail("O‘yin faol emas.", 409);
      if (b.questionIndex !== g.qi) return fail("Bu savol endi faol emas.", 409);
      const team = g.teams[g.qi % 3];
      if (team.playerId !== player.id) return fail("Hozir sizning navbatingiz emas.", 403);
      if (g.reveal && g.reveal.questionIndex === g.qi) return fail("Javob qabul qilingan.", 409);
      const q = g.seq[g.qi], choice = Number(b.choice);
      if (!Number.isInteger(choice) || choice < -1 || choice > 3) return fail("Javob varianti noto‘g‘ri.");
      const elapsed = Math.max(0, (Date.now() - g.questionStartedAt) / 1000);
      if (choice >= 0 && elapsed > g.tsec + 1) return fail("Vaqt tugagan.", 409);
      const ok = choice >= 0 && choice === q.correct;
      const points = ok ? 1000 + Math.ceil(g.tsec - Math.min(g.tsec, elapsed)) * 50 : 0;
      team.answered++; if (ok) { team.correct++; team.bounty += points; team.streak++; } else team.streak = 0;
      g.reveal = { questionIndex: g.qi, choice, correct: q.correct, ok, points,
        explanation: String(q.e || ""), answeredBy: player.id };
      g.qi++; g.questionStartedAt = Date.now();
      if (g.qi >= g.seq.length) this.state.status = "finished";
      await this.save(); await this.broadcast();
      return json(this.publicState(player.id));
    }
    return fail("Method yoki endpoint noto‘g‘ri.", 404);
  }
  async save() { this.state.updatedAt = Date.now(); await this.ctx.storage.put("room", this.state); }
  publicState(viewerId) {
    const s = this.state, g = s.game;
    let current = null;
    if (g && s.status === "playing" && g.qi < g.seq.length) {
      const q = g.seq[g.qi]; current = { questionIndex: g.qi, q: q.q, opts: q.opts,
        difficulty: q.d, activePlayerId: g.teams[g.qi % 3].playerPublicId,
        activePlayerName: g.teams[g.qi % 3].name };
    }
    return { code: s.code, status: s.status, players: s.players.map(({ publicId, name, role }) => ({ id: publicId, name, role })),
      isHost: viewerId === s.hostId,
      game: g ? { per: g.per, tsec: g.tsec, qi: g.qi, total: g.seq.length,
        teams: g.teams.map(({ playerId, ...team }) => team), current, lastResult: g.reveal } : null,
      updatedAt: s.updatedAt };
  }
  async broadcast() {
    const sockets = this.ctx.getWebSockets();
    const payload = JSON.stringify({ type: "state", state: this.publicState() });
    for (const ws of sockets) { try { ws.send(payload); } catch {} }
  }
}
