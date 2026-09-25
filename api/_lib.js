// Shared helpers for the cloud-save API (anonymous account + recovery code).
// Storage: Upstash Redis REST if KV_REST_API_URL/TOKEN (or UPSTASH_REDIS_REST_*) are set,
// otherwise the private Vercel Blob store (BLOB_READ_WRITE_TOKEN). MEM_BACKEND=1 = in-memory (local tests only).
import crypto from 'node:crypto';

export const MAX_BODY = 200 * 1024;                // 200 KB payload cap
const CODE_ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L

const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const BACKEND = process.env.MEM_BACKEND ? 'memory' : (redisUrl && redisTok) ? 'redis' : 'blob';
// Blob's free Hobby quota is 2,000 writes/month, so the server accepts at most one write per player every 30 s there.
export const MIN_INTERVAL = BACKEND === 'blob' ? 30 : 8;

const mem = new Map();
let blobMod = null;
async function blob() { if (!blobMod) blobMod = await import('@vercel/blob'); return blobMod; }

export async function kvGet(key) {
  if (BACKEND === 'memory') return mem.has(key) ? JSON.parse(mem.get(key)) : null;
  if (BACKEND === 'redis') {
    const r = await fetch(redisUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + redisTok, 'Content-Type': 'application/json' }, body: JSON.stringify(['GET', key]) });
    if (!r.ok) throw new Error('redis ' + r.status); const j = await r.json(); return j.result ? JSON.parse(j.result) : null;
  }
  const { get } = await blob();
  const r = await get(key + '.json', { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}
export async function kvSet(key, val) {
  const s = JSON.stringify(val);
  if (BACKEND === 'memory') { mem.set(key, s); return; }
  if (BACKEND === 'redis') {
    const r = await fetch(redisUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + redisTok, 'Content-Type': 'application/json' }, body: JSON.stringify(['SET', key, s]) });
    if (!r.ok) throw new Error('redis ' + r.status); return;
  }
  const { put } = await blob();
  await put(key + '.json', s, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
}

export const sha = s => crypto.createHash('sha256').update(s).digest('hex');
export const rid = n => crypto.randomBytes(n).toString('base64url');
export function newCode() { const b = crypto.randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += CODE_ALPHA[b[i] % CODE_ALPHA.length]; return 'HAY-' + s.slice(0, 4) + '-' + s.slice(4); }
export function normCode(c) { let s = String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); if (s.startsWith('HAY')) s = s.slice(3); s = s.replace(/O/g, '0').replace(/[IL]/g, '1'); if (s.length !== 8 || [...s].some(ch => !CODE_ALPHA.includes(ch))) return null; return 'HAY-' + s.slice(0, 4) + '-' + s.slice(4); }
export const codeKey = code => 'c/' + sha('code:' + code);
export const playerKey = id => 'p/' + id;
export const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{16,40}$/.test(id);
export const validTok = t => typeof t === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(t);

// best-effort in-memory rate limiting (per serverless instance)
const hits = new Map();
export function limited(bucket, max, windowMs) {
  const now = Date.now(); const a = (hits.get(bucket) || []).filter(t => now - t < windowMs);
  if (a.length >= max) { hits.set(bucket, a); return true; }
  a.push(now); hits.set(bucket, a); if (hits.size > 5000) hits.clear(); return false;
}
export const ipOf = req => String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || 'x').trim();

export async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== 'string' && !Buffer.isBuffer(req.body)) {
    const s = JSON.stringify(req.body); if (s.length > MAX_BODY) throw Object.assign(new Error('too big'), { code: 413 }); return req.body;
  }
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null;
  if (raw === null) { raw = ''; for await (const ch of req) { raw += ch; if (raw.length > MAX_BODY) throw Object.assign(new Error('too big'), { code: 413 }); } }
  if (raw.length > MAX_BODY) throw Object.assign(new Error('too big'), { code: 413 });
  try { return JSON.parse(raw || '{}'); } catch (_) { throw Object.assign(new Error('bad json'), { code: 400 }); }
}
export function send(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }
export function wrap(fn) { return async (req, res) => { try { await fn(req, res); } catch (e) { send(res, e.code >= 400 && e.code < 500 ? e.code : 500, { ok: false, error: e.code >= 400 && e.code < 500 ? e.message : 'server' }); if (!(e.code >= 400 && e.code < 500)) console.error(e); } }; }
