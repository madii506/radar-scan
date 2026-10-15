// Server-side reachability probe: /api/probe?u=<url>&ua=<plain|chrome|none>  (debug only, read-only GET)
const L = require('./_lib');
module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const u = String(req.query && req.query.u || '');
  if (!/^https:\/\//.test(u)) return res.status(400).end(JSON.stringify({ error: 'u=https://…' }));
  const ua = String(req.query && req.query.ua || 'chrome');
  const headers = {};
  if (ua === 'plain') headers['user-agent'] = 'radar/1.0';
  if (ua === 'curl') headers['user-agent'] = 'curl/8.5.0';
  if (ua === 'none') headers['user-agent'] = '';
  if (req.query.origin) headers.origin = req.query.origin;
  if (req.query.referer) headers.referer = req.query.referer;
  const t0 = Date.now();
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 9000);
    const r = await fetch(u, { headers: { accept: 'application/json,text/html,*/*', ...headers }, signal: c.signal }).finally(() => clearTimeout(t));
    const txt = await r.text();
    const statuses = req.query.find === 'status' ? [...new Set((txt.match(/https?:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/g) || []))].slice(0, 20) : undefined;
    res.status(200).end(JSON.stringify({ status: r.status, ms: Date.now() - t0, ct: r.headers.get('content-type'), len: txt.length, head: txt.slice(0, 240), statuses }));
  } catch (e) { res.status(200).end(JSON.stringify({ error: String(e.message || e), ms: Date.now() - t0 })); }
};
