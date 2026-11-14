// Scorecard live score relay.
//
// One Durable Object per live match holds the latest match state and pushes it to viewers
// over WebSockets. Only the phone that started the match can update it: its first PUT sets
// a secret key (we store a SHA-256 hash), and every later PUT must present the same key.
//
//   PUT  /m/:id      Authorization: Bearer <key>   body: match state JSON  -> store + broadcast
//   GET  /m/:id                                                             -> latest state
//   GET  /m/:id/ws   (WebSocket)                                            -> state now + on every update
//
// Matches are deleted 30 days after their last update.

import { DurableObject } from 'cloudflare:workers';

const ID_RE = /^\/m\/([A-Za-z0-9_-]{16,64})(\/ws)?$/;
const MAX_BODY = 64 * 1024;
const MIN_KEY = 24;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/') return json({ ok: true, service: 'scorecard-live' });
    const m = url.pathname.match(ID_RE);
    if (!m) return json({ error: 'not found' }, 404);
    const stub = env.LIVE.get(env.LIVE.idFromName(m[1]));
    return stub.fetch(req);
  },
};

export class LiveMatch extends DurableObject {
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.endsWith('/ws')) {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server); // hibernatable: no cost while idle
      server.send(this.message(await this.ctx.storage.get('rec')));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (req.method === 'GET') {
      const rec = await this.ctx.storage.get('rec');
      return rec ? json(this.payload(rec)) : json({ error: 'not found' }, 404);
    }

    if (req.method === 'PUT') {
      const body = await req.text(); // always read the body before replying
      const key = (req.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '');
      if (key.length < MIN_KEY) return json({ error: 'missing key' }, 401);
      if (body.length > MAX_BODY) return json({ error: 'too large' }, 413);
      let state;
      try { state = JSON.parse(body); } catch { return json({ error: 'bad json' }, 400); }
      if (!state || typeof state !== 'object') return json({ error: 'bad state' }, 400);

      const keyHash = await sha256(key);
      const prev = await this.ctx.storage.get('rec');
      if (prev && prev.keyHash !== keyHash) return json({ error: 'forbidden' }, 403);

      const rec = { keyHash, state, updatedAt: Date.now(), seq: (prev?.seq || 0) + 1 };
      await this.ctx.storage.put('rec', rec);
      await this.ctx.storage.setAlarm(rec.updatedAt + TTL_MS);
      const msg = this.message(rec);
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(msg); } catch { /* socket already gone */ }
      }
      return json({ ok: true, updatedAt: rec.updatedAt, seq: rec.seq });
    }

    return json({ error: 'method not allowed' }, 405);
  }

  payload(rec) {
    return { state: rec.state, updatedAt: rec.updatedAt, seq: rec.seq, serverNow: Date.now() };
  }

  message(rec) {
    return JSON.stringify(rec ? this.payload(rec) : { gone: true, serverNow: Date.now() });
  }

  // Viewers may send "ping"; reply so they can tell the connection is alive.
  webSocketMessage(ws, msg) {
    if (msg === 'ping') ws.send(JSON.stringify({ pong: true, serverNow: Date.now() }));
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  // 30 days after the last update: delete the match and disconnect viewers.
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify({ gone: true, serverNow: Date.now() })); ws.close(1000, 'expired'); } catch { /* gone */ }
    }
    await this.ctx.storage.deleteAll();
  }
}
