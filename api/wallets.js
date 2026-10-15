// Tracked deployer wallets: their pump.fun creates read from the chain (pump.fun's API refuses servers), stats from Jupiter.
const L = require('./_lib');
const R = require('./_rpc');
const N = require('./_narr');
const cache = new Map();

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const ws = String(req.query && req.query.w || '').split(',').map(s => s.trim()).filter(s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)).slice(0, 16);
  if (!ws.length) return res.status(400).end(JSON.stringify({ error: 'w=comma,separated,wallets' }));
  const rows = await Promise.all(ws.map(async w => {
    const hit = cache.get(w); if (hit && Date.now() - hit.at < 240000) return hit.v;
    const r = await L.timed('creates', () => R.creatorCreates(w, 160));
    const cs = r.ok ? r.data.coins : [];
    try { await R.jupEnrich(cs); } catch (e) { }
    try { await R.metaFill(cs, 12); } catch (e) { }
    const v = { wallet: w, ok: r.ok, err: r.err || null, sigs: r.ok ? r.data.sigs : 0, lastTx: r.ok ? r.data.last : null, count: cs.length, last: cs[0] ? cs[0].t : null, coins: cs.map(c => ({ mint: c.mint, name: c.name, symbol: c.symbol, t: c.t, mc: c.mc, img: c.img, tw: c.tw, web: c.web, url: c.url, tid: N.tweetId(c.tw), b5: c.b5, v1h: c.v1h, organic: c.organic })) };
    cache.set(w, { at: Date.now(), v });
    return v;
  }));
  res.status(200).end(JSON.stringify({ ts: Date.now(), note: 'creates found among each wallet\'s last 160 transactions; a wallet that trades a lot shows fewer creates', wallets: rows }));
};
