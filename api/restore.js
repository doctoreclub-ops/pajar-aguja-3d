// POST /api/restore { code } -> { id, token, code, t, save }  (adds a new device token to the account)
import { kvGet, kvSet, rid, sha, normCode, codeKey, playerKey, limited, ipOf, readBody, send, wrap, MIN_INTERVAL } from './_lib.js';
export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });
  const ip = ipOf(req);
  if (limited('restore:' + ip, 10, 10 * 60e3)) return send(res, 429, { ok: false, error: 'rate' });
  const b = await readBody(req); const code = normCode(b && b.code);
  if (!code) return send(res, 200, { ok: false, error: 'notfound' });
  const m = await kvGet(codeKey(code)); const p = m && await kvGet(playerKey(m.id));
  if (!p) return send(res, 200, { ok: false, error: 'notfound' });
  const token = rid(32); p.tokens = [...p.tokens, sha(token)].slice(-8);
  await kvSet(playerKey(m.id), p);
  send(res, 200, { ok: true, id: m.id, token, code, t: p.t, save: p.save, minInterval: MIN_INTERVAL });
});
