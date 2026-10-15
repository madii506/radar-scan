// /api/xfind?q=<topic> → a real tweet about a topic (needs X_BEARER or SERPER_KEY on the project; says so when neither is set)
const L = require('./_lib');
const cache = new Map();
module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const q = String(req.query && req.query.q || '').trim().slice(0, 120);
  if (!q) return res.status(400).end(JSON.stringify({ error: 'q' }));
  const mode = L.tweetSearchMode();
  if (!mode) return res.status(200).end(JSON.stringify({ q, mode: 'off', tweets: [], note: 'tweet search is off: add X_BEARER (X API v2) or SERPER_KEY (serper.dev) to the Vercel project' }));
  const k = q.toLowerCase(); const hit = cache.get(k); if (hit && Date.now() - hit.at < 30 * 60000) return res.status(200).end(hit.body);
  try {
    const t = await L.tweetFor(q);
    const body = JSON.stringify({ q, mode, tweets: t ? [t] : [] });
    cache.set(k, { at: Date.now(), body });
    res.status(200).end(body);
  } catch (e) { res.status(200).end(JSON.stringify({ q, mode, error: String(e.message || e).slice(0, 160), tweets: [] })); }
};
