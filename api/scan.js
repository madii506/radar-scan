const L = require('./_lib');
const N = require('./_narr');

let cache = { at: 0, body: null };
const tweetCache = new Map();
async function tweetCached(id) {
  const hit = tweetCache.get(id); if (hit && Date.now() - hit.at < 15 * 60000) return hit.v;
  try { const v = await L.tweet(id); tweetCache.set(id, { at: Date.now(), v }); return v; } catch (e) { return { id, err: String(e.message || e).slice(0, 80) }; }
}

async function scan() {
  const now = Date.now();
  const [pump, gt5, gt1h, gtNew, dex, trUS, trGB, xt, poly, ph, gh, hn, rdA, rdI] = await Promise.all([
    L.timed('pump.fun new coins', () => L.pumpNew(5, 100)),
    L.timed('GeckoTerminal trending 5m', () => L.gtTrending('5m')),
    L.timed('GeckoTerminal trending 1h', () => L.gtTrending('1h')),
    L.timed('GeckoTerminal new pools', () => L.gtNewPools(3)),
    L.timed('Dexscreener boosts+profiles', () => L.dexPaid()),
    L.timed('Google Trends US', () => L.googleTrends('US')),
    L.timed('Google Trends GB', () => L.googleTrends('GB')),
    L.timed('X trends (trends24)', () => L.xTrends('united-states')),
    L.timed('Polymarket', () => L.polymarket()),
    L.timed('Product Hunt', () => L.productHunt()),
    L.timed('GitHub trending', () => L.githubTrending()),
    L.timed('Hacker News', () => L.hackerNews()),
    L.timed('Reddit animals', () => L.reddit('aww+AnimalsBeingBros+rarepuppers+raccoons+AnimalsBeingDerps+Eyebleach', 'reddit-animals')),
    L.timed('Reddit internet', () => L.reddit('interestingasfuck+Damnthatsinteresting+nextfuckinglevel+InternetIsBeautiful+technology+artificial', 'reddit-internet')),
  ]);

  // the on-chain window: pump.fun newest coins; fall back to GeckoTerminal new pools when pump is unreadable
  let coins = pump.ok ? pump.data : [];
  let windowSrc = 'pump.fun';
  if (!coins.length && gtNew.ok) { windowSrc = 'geckoterminal new pools'; coins = gtNew.data.filter(p => p.dex === 'pump-fun' || p.dex === 'meteora-dbc' || p.dex === 'pumpswap').map(p => ({ mint: p.mint, name: p.name, symbol: p.symbol, img: p.img, t: Date.parse(p.created) || null, mc: p.mc, tw: null, web: null, creator: null, url: p.url })); }
  const ts = coins.map(c => c.t).filter(Boolean);
  const win = ts.length ? { from: Math.min(...ts), to: Math.max(...ts), minutes: Math.round((Math.max(...ts) - Math.min(...ts)) / 60000), n: coins.length, src: windowSrc } : { n: 0, src: windowSrc };

  const clusters = N.buildClusters(coins, now).slice(0, 40);

  // trends → launched count (0 = nobody has made it yet)
  const trends = [];
  const seenT = new Set();
  for (const src of [trUS, trGB]) if (src.ok) for (const t of src.data) { const k = N.norm(t.title); if (seenT.has(k)) continue; seenT.add(k); const m = N.matchTrend(t.title, coins); trends.push({ ...t, launched: m.n, coins: m.coins }); }
  trends.sort((a, b) => (b.t || 0) - (a.t || 0) || b.tn - a.tn);

  // x trends (names only) → launched count
  const xtrends = xt.ok ? xt.data.map(x => ({ ...x, ...(() => { const m = N.matchTrend(x.name, coins); return { launched: m.n, coins: m.coins }; })() })) : [];

  // clusters ↔ trends cross-reference
  const trendWords = new Map(); for (const t of trends) for (const w of N.words(t.title)) if (w.length >= 4) trendWords.set(w, t.title);
  for (const x of xtrends) for (const w of N.words(x.name)) if (w.length >= 4) trendWords.set(w, x.name);
  for (const cl of clusters) { const ws = cl.kind === 'w' ? [cl.label] : cl.kind === 'b' ? cl.label.split(' ') : N.words(cl.coins[0].name); cl.trend = [...new Set(ws.map(w => trendWords.get(w)).filter(Boolean))]; if (cl.trend.length) cl.score = +(cl.score * 1.8).toFixed(1); }
  clusters.sort((a, b) => b.score - a.score);

  // tweet previews for the strongest tweet clusters + the most recent sniped tweets
  const tweetIds = []; const addT = id => { if (id && !tweetIds.includes(id)) tweetIds.push(id); };
  for (const cl of clusters) if (cl.kind === 'tw') addT(cl.label);
  for (const c of coins.slice(0, 120)) addT(N.tweetId(c.tw));
  const tweets = {}; const ids = tweetIds.slice(0, 14);
  const tv = await Promise.all(ids.map(tweetCached)); ids.forEach((id, i) => tweets[id] = tv[i]);

  // "getting bids": GeckoTerminal 5m + 1h trending (pump-fun / pumpswap / meteora pools); mark the ones that match a trend or a cluster
  const bids = [];
  const seenB = new Set();
  for (const [src, tf] of [[gt5, '5m'], [gt1h, '1h']]) if (src.ok) for (const p of src.data) { if (!p.mint || seenB.has(p.mint)) continue; seenB.add(p.mint); const m = N.matchTrend(p.name, coins); const ws = N.words(p.name + ' ' + p.symbol); bids.push({ ...p, tf, launched: m.n, trend: [...new Set(ws.map(w => trendWords.get(w)).filter(Boolean))] }); }

  // the raw stream: latest 60 coins (what deployers are putting out right now)
  const stream = coins.slice(0, 60).map(c => ({ ...c, tid: N.tweetId(c.tw) }));

  // fresh internet objects (the esotericpigeon lane): new products, repos, posts → launched count
  const fresh = [];
  for (const src of [ph, gh, hn, rdA, rdI]) if (src.ok) for (const o of src.data) { const m = N.matchTrend(o.title.replace(/^[^/]+\//, ''), coins); fresh.push({ ...o, launched: m.n, coins: m.coins }); }
  // markets → launched count too
  const markets = poly.ok ? poly.data.slice(0, 50).map(m => { const r = N.matchTrend(m.q, coins); return { ...m, launched: r.n, coins: r.coins }; }) : [];

  return {
    ts: now, window: win,
    sources: [pump, gt5, gt1h, gtNew, dex, trUS, trGB, xt, poly, ph, gh, hn, rdA, rdI].map(s => ({ name: s.name, ok: s.ok, n: s.n, ms: s.ms, err: s.err || null })),
    clusters, trends: trends.slice(0, 40), xtrends, bids: bids.slice(0, 40), paid: dex.ok ? dex.data.slice(0, 40) : [], markets, fresh, tweets, stream,
  };
}

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  const force = req.query && req.query.fresh === '1';
  try {
    if (!force && cache.body && Date.now() - cache.at < 90 * 1000) { res.setHeader('cache-control', 'no-store'); res.setHeader('x-radar-cache', 'hit'); return res.status(200).end(cache.body); }
    const out = await scan();
    cache = { at: Date.now(), body: JSON.stringify(out) };
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-radar-cache', 'miss');
    res.status(200).end(cache.body);
  } catch (e) {
    res.status(500).end(JSON.stringify({ error: String(e.message || e) }));
  }
};
