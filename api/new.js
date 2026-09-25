// POST /api/new -> creates an anonymous player { id, token, code }
import { kvGet, kvSet, rid, sha, newCode, codeKey, playerKey, limited, ipOf, send, wrap, MIN_INTERVAL } from './_lib.js';
export default wrap(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });
  if (limited('new:' + ipOf(req), 30, 10 * 60e3)) return send(res, 429, { ok: false, error: 'rate' });
  const id = rid(16), token = rid(32);
  let code = newCode(); for (let i = 0; i < 3 && await kvGet(codeKey(code)); i++) code = newCode();
  await kvSet(codeKey(code), { id });
  await kvSet(playerKey(id), { v: 1, tokens: [sha(token)], created: Date.now(), t: 0, lastWrite: 0, save: null });
  send(res, 200, { ok: true, id, token, code, minInterval: MIN_INTERVAL });
});
