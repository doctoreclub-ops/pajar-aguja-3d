import { BACKEND, MIN_INTERVAL, send, wrap } from './_lib.js';
export default wrap(async (req, res) => send(res, 200, { ok: true, backend: BACKEND, minInterval: MIN_INTERVAL, maxBytes: 200 * 1024 }));
