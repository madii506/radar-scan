const L = require('./_lib');
module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const id = String(req.query && req.query.id || '').replace(/\D/g, '');
  if (!id) return res.status(400).end(JSON.stringify({ error: 'id' }));
  try { const t = await L.tweet(id); res.setHeader('cache-control', 's-maxage=600, stale-while-revalidate=3600'); res.status(200).end(JSON.stringify(t)); }
  catch (e) { res.setHeader('cache-control', 'no-store'); res.status(200).end(JSON.stringify({ id, err: String(e.message || e).slice(0, 120) })); }
};
