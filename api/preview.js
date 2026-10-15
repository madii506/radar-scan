// /api/preview?u=<url> → the page's og title / description / image plus the tweets it embeds (resolved in full). Cached on the CDN for 30 min.
const L = require('./_lib');
module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const u = String(req.query && req.query.u || '').slice(0, 1000);
  if (!/^https?:\/\//.test(u)) { res.setHeader('cache-control', 'no-store'); return res.status(400).end(JSON.stringify({ error: 'u' })); }
  try {
    const p = await L.pagePreview(u);
    let tweet = null;
    if (p && (p.tweets || []).length) { const ts = await Promise.all(p.tweets.slice(0, 2).map(t => L.tweet(t.id).catch(() => null))); tweet = ts.filter(Boolean).sort((a, b) => (b.likes || 0) - (a.likes || 0))[0] || null; }
    res.setHeader('cache-control', 's-maxage=1800, stale-while-revalidate=86400');
    res.status(200).end(JSON.stringify({ url: u, preview: p, tweet }));
  } catch (e) { res.setHeader('cache-control', 'no-store'); res.status(200).end(JSON.stringify({ url: u, preview: null, tweet: null, error: String(e.message || e).slice(0, 120) })); }
};
