const L = require('./_lib');
const N = require('./_narr');

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 's-maxage=60, stale-while-revalidate=120');
  const ws = String(req.query && req.query.w || '').split(',').map(s => s.trim()).filter(s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)).slice(0, 24);
  if (!ws.length) return res.status(400).end(JSON.stringify({ error: 'w=comma,separated,wallets' }));
  const rows = await Promise.all(ws.map(async w => {
    const [coins, user] = await Promise.all([L.timed('coins', () => L.pumpByCreator(w, 30)), L.pumpUser(w)]);
    const cs = coins.ok ? coins.data : [];
    const last = cs[0] ? cs[0].t : null;
    const j7 = cs.filter(c => /j7tracker/i.test(c.desc || '')).length;
    return { wallet: w, username: user.username, ok: coins.ok, err: coins.err || null, count: cs.length, last, j7, best: cs.reduce((b, c) => (c.ath || 0) > (b ? b.ath : 0) ? c : b, null), coins: cs.map(c => ({ ...c, tid: N.tweetId(c.tw) })) };
  }));
  res.status(200).end(JSON.stringify({ ts: Date.now(), wallets: rows }));
};
