const L = require('./_lib');
const R = require('./_rpc');
const N = require('./_narr');

let cache = { at: 0, body: null };
const tweetCache = new Map();
const xCache = new Map(); // topic → best real tweet (or null)
// small concurrency limiter so Bing is not hit 30 times at once
let running = 0; const queue = [];
function limit(fn) { return new Promise((resolve, reject) => { const run = () => { running++; fn().then(resolve, reject).finally(() => { running--; const n = queue.shift(); if (n) n(); }); }; running < 8 ? run() : queue.push(run); }); }
async function tweetCached(id) {
  const hit = tweetCache.get(id); if (hit && Date.now() - hit.at < 15 * 60000) return hit.v;
  try { const v = await L.tweet(id); tweetCache.set(id, { at: Date.now(), v }); return v; } catch (e) { return { id, err: String(e.message || e).slice(0, 80) }; }
}

const NEWS = [
  ['AI OR OpenAI OR Anthropic OR Nvidia OR "ChatGPT" OR robot', 'ai'],
  ['"White House" OR Trump OR Senate OR Congress', 'whitehouse'],
  ['stocks OR Nasdaq OR "Wall Street" OR Fed OR billion', 'money'],
  ['crypto OR bitcoin OR solana OR memecoin', 'crypto'],
  ['rescue OR zoo OR kitten OR puppy OR raccoon OR "animal"', 'animals'],
  ['Apple OR Google OR Tesla OR SpaceX OR startup OR app', 'tech'],
];

async function scan() {
  const now = Date.now();
  const [chain, jrec, jtr, jorg, gt5, gtNew, dex, trUS, trGB, xt, poly, ph, gh, hn, cg, ...news] = await Promise.all([
    L.timed('chain creates (RPC)', () => R.recentCreates(100)),
    L.timed('Jupiter recent', () => L.jupList('recent')),
    L.timed('Jupiter trending 5m', () => L.jupList('toptrending/5m')),
    L.timed('Jupiter organic 5m', () => L.jupList('toporganicscore/5m')),
    L.timed('GeckoTerminal trending 5m', () => L.gtTrending('5m')),
    L.timed('GeckoTerminal new pools', () => L.gtNewPools(2)),
    L.timed('Dexscreener boosts+profiles', () => L.dexPaid()),
    L.timed('Google Trends US', () => L.googleTrends('US')),
    L.timed('Google Trends GB', () => L.googleTrends('GB')),
    L.timed('X trends', () => L.xTrends('united-states')),
    L.timed('Polymarket', () => L.polymarket()),
    L.timed('Product Hunt', () => L.productHunt()),
    L.timed('GitHub trending', () => L.githubTrending()),
    L.timed('Hacker News', () => L.hackerNews()),
    L.timed('CoinGecko trending', () => L.coingeckoTrending()),
    ...NEWS.map(([q, cat]) => L.timed('News · ' + cat, () => L.googleNews(q, cat))),
  ]);

  // the on-chain window: chain creates (RPC) ∪ Jupiter recent ∪ GeckoTerminal new pools, enriched with Jupiter stats + metadata images
  const byMint = new Map();
  const add = c => { if (!c || !c.mint) return; const o = byMint.get(c.mint); if (o) { for (const k in c) if (c[k] != null && o[k] == null) o[k] = c[k]; } else byMint.set(c.mint, { ...c }); };
  if (chain.ok) chain.data.coins.forEach(add);
  if (jrec.ok) jrec.data.filter(t => t.launchpad === 'pump.fun' || t.launchpad === 'met-dbc' || !t.launchpad).forEach(t => add({ ...t, creator: t.dev }));
  if (gtNew.ok) gtNew.data.filter(p => p.dex === 'pump-fun' || p.dex === 'meteora-dbc').forEach(p => add({ mint: p.mint, name: p.name, symbol: p.symbol, img: p.img, t: Date.parse(p.created) || null, mc: p.mc, url: p.url }));
  let coins = [...byMint.values()];
  for (const c of coins) { if (!c.url) c.url = 'https://pump.fun/coin/' + c.mint; if (!c.t && c.created) c.t = Date.parse(c.created) || null; }
  try { await R.jupEnrich(coins); } catch (e) { }
  try { await R.metaFill(coins, 40); } catch (e) { }
  coins.sort((a, b) => (b.t || 0) - (a.t || 0));
  const ts = coins.map(c => c.t).filter(Boolean);
  const win = ts.length ? { from: Math.min(...ts), to: Math.max(...ts), minutes: Math.round((Math.max(...ts) - Math.min(...ts)) / 60000), n: coins.length, src: chain.ok ? 'chain + jupiter' : 'jupiter + gecko' } : { n: 0, src: 'none' };

  const clusters = N.buildClusters(coins, now).slice(0, 40);

  // ---- COULD LAUNCH: everything off-chain, one list, categorised, with heat and a launched count ----
  const could = []; const seenK = new Set();
  const push = o => { const k = N.norm(o.title); if (!k || seenK.has(k)) return; seenK.add(k); const m = N.matchTrend(o.title.replace(/^[^/]+\//, ''), coins); o.launched = m.n; o.coins = m.coins; o.cats = N.categorize(o.title + ' ' + (o.desc || ''), o.kind, (o.news || []).map(n => n.title).join(' ')); o.heat = N.heatOf(o); could.push(o); };
  for (const src of [trUS, trGB]) if (src.ok) for (const t of src.data) push({ kind: 'gtrend', title: t.title, url: t.url, img: t.img, t: t.t, tn: t.tn, traffic: t.traffic, geo: t.geo, news: t.news, xq: 'https://x.com/search?q=' + encodeURIComponent(t.title) + '&f=live' });
  if (xt.ok) for (const x of xt.data) push({ kind: 'xtrend', title: x.name, url: x.url, rank: x.rank, t: now, img: null });
  if (gh.ok) for (const o of gh.data) push({ ...o });
  if (hn.ok) for (const o of hn.data) push({ ...o });
  if (ph.ok) for (const o of ph.data) push({ ...o });
  if (cg.ok) for (const o of cg.data) push({ ...o });
  if (poly.ok) for (const m of poly.data) push({ kind: 'market', title: m.q, url: m.url, img: m.img, t: m.created ? Date.parse(m.created) : null, v24: m.v24, vol: m.vol, yes: m.yes, mkind: m.kind });
  for (const n of news) if (n.ok) for (const o of n.data) push({ ...o });
  could.sort((a, b) => b.heat - a.heat || (b.t || 0) - (a.t || 0));

  // the content behind every narrative, inline: the deployers' own tweet when the thing is already launched; a real tweet via X API / Serper when a key is set;
  // and the source page's own preview (og title / description / image) so the story is readable without clicking (budgeted, cached)
  const MAIN = new Set(['ai', 'animals', 'github', 'tech', 'whitehouse', 'money', 'crypto']);
  const order = could.slice().sort((a, b) => (b.cats.some(c => MAIN.has(c)) - a.cats.some(c => MAIN.has(c))) || b.heat - a.heat);
  const mode = L.tweetSearchMode();
  let budget = mode ? 24 : 0, pbudget = 36; const jobs = [];
  for (const o of order) {
    const key = N.norm(o.title.replace(/^[^/]+\//, ''));
    const own = (o.coins || []).map(c => N.tweetId(c.tw)).find(Boolean);
    const hit = xCache.get(key);
    if (own) jobs.push(tweetCached(own).then(t => { o.tweet = t && !t.err ? t : null; o.tweetSrc = 'deployer'; }));
    else if (hit && Date.now() - hit.at < 2 * 3600e3) { o.tweet = hit.v; o.tweetSrc = hit.v ? 'search' : null; }
    else if (budget > 0 && o.kind !== 'coingecko') { budget--; jobs.push(limit(() => L.tweetFor(key.slice(0, 80)).catch(() => null).then(t => { xCache.set(key, { at: Date.now(), v: t }); o.tweet = t; o.tweetSrc = t ? 'search' : null; }))); }
    // page preview for the source link (news article, repo, product, HN target)
    const purl = o.kind === 'gtrend' ? ((o.news || [])[0] || {}).url : o.kind === 'market' || o.kind === 'xtrend' || o.kind === 'coingecko' ? null : (o.out || o.url);
    if (purl && pbudget > 0 && !/news\.google\.com/.test(purl)) { pbudget--; jobs.push(limit(() => L.pagePreview(purl).then(p => { if (p) o.preview = p; }))); }
  }
  await Promise.all(jobs);
  const tweetMode = mode || 'off';

  // clusters ↔ could-launch cross-reference
  const trendWords = new Map(); for (const o of could) if (o.kind === 'gtrend' || o.kind === 'xtrend') for (const w of N.words(o.title)) if (w.length >= 4) trendWords.set(w, o.title);
  for (const cl of clusters) { const ws = cl.kind === 'w' ? [cl.label] : cl.kind === 'b' ? cl.label.split(' ') : N.words(cl.coins[0].name); cl.trend = [...new Set(ws.map(w => trendWords.get(w)).filter(Boolean))]; if (cl.trend.length) cl.score = +(cl.score * 1.8).toFixed(1); }
  clusters.sort((a, b) => b.score - a.score);

  // tweet previews for tweet clusters + the newest sniped tweets
  const tweetIds = []; const addT = id => { if (id && !tweetIds.includes(id)) tweetIds.push(id); };
  for (const cl of clusters) if (cl.kind === 'tw') addT(cl.label);
  for (const c of coins.slice(0, 120)) addT(N.tweetId(c.tw));
  const tweets = {}; const ids = tweetIds.slice(0, 12);
  const tv = await Promise.all(ids.map(tweetCached)); ids.forEach((id, i) => tweets[id] = tv[i]);

  // ---- GETTING BIDS: Jupiter organic/trending 5m + GeckoTerminal 5m, de-duplicated, tagged with trends ----
  const bids = []; const seenB = new Set();
  const MAJOR = /^(wrapped sol|usd coin|tether|usdt|usdc|jupiter|raydium|bonk|dogwifhat|pudgy|jito|pyth|render|wormhole|kamino|orca|marinade|helium|drift)|backpack securities|xstock|tokenized/i;
  const addB = (p, src) => { if (!p.mint || seenB.has(p.mint)) return; if (MAJOR.test(p.name) || (p.mc || 0) > 30e6 || /^(SOL|USDC|USDT|JUP|RAY|JTO|PYTH|KMNO|ORCA|MNDE)$/i.test(p.symbol || '')) return; seenB.add(p.mint); const ws = N.words(p.name + ' ' + p.symbol); bids.push({ ...p, src, trend: [...new Set(ws.map(w => trendWords.get(w)).filter(Boolean))], cats: N.categorize(p.name + ' ' + p.symbol, 'jup') }); };
  if (jorg.ok) jorg.data.forEach(p => addB(p, 'organic 5m'));
  if (jtr.ok) jtr.data.forEach(p => addB(p, 'trending 5m'));
  if (gt5.ok) gt5.data.forEach(p => addB({ ...p, t: Date.parse(p.created) || null, pump: null }, 'gecko 5m'));
  // young first: what is getting bids AND is new is the meta; old majors are noise here
  bids.sort((a, b) => { const ya = a.t ? (now - a.t) / 3600000 : 999, yb = b.t ? (now - b.t) / 3600000 : 999; return (ya < 48) === (yb < 48) ? (b.v1h || 0) - (a.v1h || 0) : ya < 48 ? -1 : 1; });

  const stream = coins.slice(0, 80).map(c => ({ ...c, tid: N.tweetId(c.tw) }));

  return {
    ts: now, window: win, tweetMode,
    sources: [chain, jrec, jtr, jorg, gt5, gtNew, dex, trUS, trGB, xt, poly, ph, gh, hn, cg, ...news].map(s => ({ name: s.name, ok: s.ok, n: s.ok && s.data && s.data.coins ? s.data.coins.length : s.n, ms: s.ms, err: s.err || null })),
    could: could.slice(0, 220), clusters, bids: bids.slice(0, 50), paid: dex.ok ? dex.data.slice(0, 40) : [], tweets, stream, coins: coins.map(c => ({ mint: c.mint, name: c.name, symbol: c.symbol, t: c.t, mc: c.mc, img: c.img, tw: c.tw, web: c.web, creator: c.creator, url: c.url })),
  };
}

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  const force = req.query && req.query.fresh === '1';
  try {
    if (!force && cache.body && Date.now() - cache.at < 90 * 1000) { res.setHeader('x-radar-cache', 'hit'); return res.status(200).end(cache.body); }
    const out = await scan();
    cache = { at: Date.now(), body: JSON.stringify(out) };
    res.setHeader('x-radar-cache', 'miss');
    res.status(200).end(cache.body);
  } catch (e) {
    res.status(500).end(JSON.stringify({ error: String(e.message || e) }));
  }
};
