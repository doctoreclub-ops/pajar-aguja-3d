// GET  /api/save?id=...   (Authorization: Bearer <token>)  -> { t, save }
// POST /api/save  { id, token, t, save, final? }            -> stores if newer (also used by sendBeacon)
import { kvGet, kvSet, sha, playerKey, validId, validTok, limited, ipOf, readBody, send, wrap, MIN_INTERVAL } from './_lib.js';
export default wrap(async (req, res) => {
  if (req.method === 'GET') {
    const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!validId(id) || !validTok(tok)) return send(res, 400, { ok: false, error: 'bad' });
    if (limited('get:' + ipOf(req), 60, 60e3)) return send(res, 429, { ok: false, error: 'rate' });
    const p = await kvGet(playerKey(id));
    if (!p || !p.tokens.includes(sha(tok))) return send(res, 403, { ok: false, error: 'auth' });
    return send(res, 200, { ok: true, t: p.t, save: p.save, minInterval: MIN_INTERVAL });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });
  const b = await readBody(req);
  const { id, token, save, final } = b || {}; let t = b && b.t;
  if (!validId(id) || !validTok(token) || typeof t !== 'number' || !isFinite(t) || !save || typeof save !== 'object' || Array.isArray(save)) return send(res, 400, { ok: false, error: 'bad' });
  t = Math.min(t, Date.now());   // clamp devices whose clock runs ahead
  if (limited('post:' + id, 12, 60e3) || limited('postip:' + ipOf(req), 60, 60e3)) return send(res, 429, { ok: false, error: 'rate' });
  const p = await kvGet(playerKey(id));
  if (!p || !p.tokens.includes(sha(token))) return send(res, 403, { ok: false, error: 'auth' });
  if (t <= p.t) return send(res, 200, { ok: true, stale: true, t: p.t });
  const since = (Date.now() - (p.lastWrite || 0)) / 1000;
  if (since < (final ? Math.min(5, MIN_INTERVAL) : MIN_INTERVAL - 1)) return send(res, 200, { ok: false, error: 'soon', retryIn: Math.ceil(MIN_INTERVAL - since) });
  p.t = t; p.save = save; p.lastWrite = Date.now();
  await kvSet(playerKey(id), p);
  send(res, 200, { ok: true, t });
});
