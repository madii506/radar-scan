// /api/image?q=<topic> → real pictures for a topic (wikipedia page image + commons photos), cached a day on the CDN
const L = require('./_lib');
const cache = new Map();
module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const q = String(req.query && req.query.q || '').trim().slice(0, 80);
  if (!q) { res.setHeader('cache-control', 'no-store'); return res.status(400).end(JSON.stringify({ error: 'q' })); }
  const k = q.toLowerCase(); const hit = cache.get(k); if (hit && Date.now() - hit.at < 6 * 3600e3) { res.setHeader('cache-control', 's-maxage=86400, stale-while-revalidate=604800'); return res.status(200).end(hit.body); }
  try {
    const images = await L.imagesFor(q);
    const body = JSON.stringify({ q, images });
    cache.set(k, { at: Date.now(), body });
    res.setHeader('cache-control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).end(body);
  } catch (e) { res.setHeader('cache-control', 'no-store'); res.status(200).end(JSON.stringify({ q, images: [], error: String(e.message || e).slice(0, 120) })); }
};
