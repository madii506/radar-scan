// /api/xfind?q=<topic> → the real tweets Bing knows about a topic, with the best one read in full. Used by the page's "find a tweet" and for debugging.
const L = require('./_lib');
const cache = new Map();
module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const q = String(req.query && req.query.q || '').trim().slice(0, 120);
  if (!q) return res.status(400).end(JSON.stringify({ error: 'q' }));
  const k = q.toLowerCase(); const hit = cache.get(k); if (hit && Date.now() - hit.at < 30 * 60000) return res.status(200).end(hit.body);
  try {
    const hits = await L.bingTweetIds(q, 4);
    const ts = await Promise.all(hits.map(h => L.tweet(h.id).catch(() => null)));
    const tweets = ts.filter(Boolean).sort((a, b) => (b.likes || 0) + (b.views || 0) / 50 - (a.likes || 0) - (a.views || 0) / 50);
    const body = JSON.stringify({ q, hits, tweets });
    cache.set(k, { at: Date.now(), body });
    res.status(200).end(body);
  } catch (e) { res.status(200).end(JSON.stringify({ q, error: String(e.message || e).slice(0, 160), hits: [], tweets: [] })); }
};
