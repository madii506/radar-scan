// Light poll for the browser: the newest pump.fun creates (chain) with Jupiter stats. The page accumulates these into its own window.
const L = require('./_lib');
const R = require('./_rpc');
const N = require('./_narr');
let cache = { at: 0, body: null };
module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  try {
    if (cache.body && Date.now() - cache.at < 20000) return res.status(200).end(cache.body);
    const n = Math.min(150, Math.max(25, parseInt(req.query && req.query.n || '75', 10) || 75));
    const [chain, jrec] = await Promise.all([L.timed('chain', () => R.recentCreates(n)), L.timed('jup', () => L.jupList('recent'))]);
    const byMint = new Map();
    if (chain.ok) for (const c of chain.data.coins) byMint.set(c.mint, c);
    if (jrec.ok) for (const t of jrec.data) { if (byMint.has(t.mint)) { const o = byMint.get(t.mint); for (const k in t) if (t[k] != null && o[k] == null) o[k] = t[k]; } else if (t.launchpad === 'pump.fun' || t.launchpad === 'met-dbc') byMint.set(t.mint, { ...t, creator: t.dev }); }
    const coins = [...byMint.values()];
    for (const c of coins) if (!c.url) c.url = 'https://pump.fun/coin/' + c.mint;
    try { await R.jupEnrich(coins); } catch (e) { }
    try { await R.metaFill(coins, 30); } catch (e) { }
    coins.sort((a, b) => (b.t || 0) - (a.t || 0));
    const body = JSON.stringify({ ts: Date.now(), ok: chain.ok || jrec.ok, err: chain.err || null, n: coins.length, coins: coins.map(c => ({ mint: c.mint, name: c.name, symbol: c.symbol, t: c.t, mc: c.mc, img: c.img, tw: c.tw, web: c.web, creator: c.creator, url: c.url, tid: N.tweetId(c.tw), b5: c.b5, v5: c.v5, organic: c.organic })) });
    cache = { at: Date.now(), body };
    res.status(200).end(body);
  } catch (e) { res.status(500).end(JSON.stringify({ error: String(e.message || e) })); }
};
