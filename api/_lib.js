// Shared readers for RADAR. Every reader returns {ok, data, err, ms, n}.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function fetchText(url, opt = {}, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, headers: { 'user-agent': UA, accept: 'application/json,text/html,application/xml,text/plain,*/*', ...(opt.headers || {}) }, signal: c.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + txt.slice(0, 100).replace(/\s+/g, ' '));
    return txt;
  } finally { clearTimeout(t); }
}
async function fetchJson(url, opt, ms) { return JSON.parse(await fetchText(url, opt, ms)); }

// wrap a reader so one failure never kills the scan
async function timed(name, fn) {
  const t0 = Date.now();
  try {
    const data = await fn();
    return { name, ok: true, data, n: Array.isArray(data) ? data.length : (data && data.n) || 0, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, data: null, n: 0, err: String(e && e.message || e).slice(0, 160), ms: Date.now() - t0 };
  }
}

const PUMP = 'https://frontend-api-v3.pump.fun';
const pumpHeaders = { origin: 'https://pump.fun', referer: 'https://pump.fun/' };

function slimCoin(c) {
  return {
    mint: c.mint, name: c.name || '', symbol: c.symbol || '', img: c.image_uri || null,
    t: c.created_timestamp || null, mc: Math.round(c.usd_market_cap || 0), ath: Math.round(c.ath_market_cap || 0),
    tw: c.twitter || null, web: c.website || null, tg: c.telegram || null, desc: (c.description || '').slice(0, 200),
    replies: c.reply_count || 0, complete: !!c.complete, creator: c.creator || null, koth: c.king_of_the_hill_timestamp || null,
    url: 'https://pump.fun/coin/' + c.mint,
  };
}

// newest pump.fun coins, several pages
async function pumpNew(pages = 5, limit = 100) {
  const reqs = [];
  for (let p = 0; p < pages; p++) reqs.push(fetchJson(`${PUMP}/coins?offset=${p * limit}&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=true`, { headers: pumpHeaders }, 9000));
  const res = await Promise.allSettled(reqs);
  const out = []; const seen = new Set(); let okPages = 0;
  for (const r of res) if (r.status === 'fulfilled' && Array.isArray(r.value)) { okPages++; for (const c of r.value) if (c && c.mint && !seen.has(c.mint)) { seen.add(c.mint); out.push(slimCoin(c)); } }
  if (!okPages) throw new Error(res[0].reason && res[0].reason.message || 'no pages');
  out.sort((a, b) => (b.t || 0) - (a.t || 0));
  return out;
}

// coins by creator wallet
async function pumpByCreator(wallet, limit = 30) {
  const j = await fetchJson(`${PUMP}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=true&creator=${wallet}`, { headers: pumpHeaders }, 9000);
  return (Array.isArray(j) ? j : []).map(slimCoin);
}
async function pumpUser(wallet) {
  try { const j = await fetchJson(`${PUMP}/users/${wallet}`, { headers: pumpHeaders }, 6000); return { username: j.username || null, img: j.profile_image || null }; } catch { return { username: null, img: null }; }
}

// GeckoTerminal trending / new pools on Solana
function gtParse(j) {
  const inc = {}; for (const i of (j.included || [])) inc[i.id] = i.attributes || {};
  return (j.data || []).map(p => {
    const a = p.attributes || {}; const rel = p.relationships || {};
    const bt = rel.base_token && rel.base_token.data ? inc[rel.base_token.data.id] || {} : {};
    const addr = (rel.base_token && rel.base_token.data && rel.base_token.data.id || '').replace(/^solana_/, '') || bt.address || null;
    const tx = a.transactions || {}; const pc = a.price_change_percentage || {}; const vol = a.volume_usd || {};
    return {
      pool: a.address, name: bt.name || (a.name || '').split(' / ')[0], symbol: bt.symbol || '', img: bt.image_url && bt.image_url !== 'missing.png' ? bt.image_url : null,
      mint: addr, dex: rel.dex && rel.dex.data ? rel.dex.data.id : null, created: a.pool_created_at,
      mc: Math.round(Number(a.market_cap_usd || a.fdv_usd || 0)), liq: Math.round(Number(a.reserve_in_usd || 0)),
      ch5: pc.m5 != null ? Number(pc.m5) : null, ch1h: pc.h1 != null ? Number(pc.h1) : null,
      b5: tx.m5 ? tx.m5.buys : null, s5: tx.m5 ? tx.m5.sells : null, b1h: tx.h1 ? tx.h1.buys : null, s1h: tx.h1 ? tx.h1.sells : null,
      v5: Math.round(Number(vol.m5 || 0)), v1h: Math.round(Number(vol.h1 || 0)),
      url: addr ? 'https://dexscreener.com/solana/' + addr : null, gt: 'https://www.geckoterminal.com/solana/pools/' + a.address,
    };
  });
}
async function gtTrending(duration = '5m') {
  const j = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token,dex&duration=${duration}&page=1`, {}, 9000);
  return gtParse(j);
}
async function gtNewPools(pages = 3) {
  const reqs = []; for (let p = 1; p <= pages; p++) reqs.push(fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token,dex&page=${p}`, {}, 9000));
  const res = await Promise.allSettled(reqs); const out = []; let ok = 0;
  for (const r of res) if (r.status === 'fulfilled') { ok++; out.push(...gtParse(r.value)); }
  if (!ok) throw new Error(res[0].reason && res[0].reason.message || 'no pages');
  return out;
}

// Dexscreener paid attention: boosts + profiles, enriched with pair data
async function dexPaid() {
  const [b, p] = await Promise.all([
    fetchJson('https://api.dexscreener.com/token-boosts/latest/v1', {}, 8000),
    fetchJson('https://api.dexscreener.com/token-profiles/latest/v1', {}, 8000),
  ]);
  const rows = {}; const push = (x, kind) => { if (x.chainId !== 'solana') return; const k = x.tokenAddress; if (!rows[k]) rows[k] = { mint: k, kind, icon: x.icon || null, header: x.header || null, desc: (x.description || '').slice(0, 220), links: (x.links || []).map(l => ({ type: l.type || l.label || 'link', url: l.url })).slice(0, 6), boost: 0, url: x.url }; if (kind === 'boost') { rows[k].kind = 'boost'; rows[k].boost = Math.max(rows[k].boost, x.totalAmount || x.amount || 0); } };
  (b || []).forEach(x => push(x, 'boost')); (p || []).forEach(x => push(x, 'profile'));
  const addrs = Object.keys(rows).slice(0, 60);
  for (let i = 0; i < addrs.length; i += 30) {
    try {
      const pairs = await fetchJson('https://api.dexscreener.com/tokens/v1/solana/' + addrs.slice(i, i + 30).join(','), {}, 8000);
      const best = {};
      for (const pr of (pairs || [])) { const k = pr.baseToken && pr.baseToken.address; if (!k) continue; if (!best[k] || (pr.liquidity && pr.liquidity.usd || 0) > (best[k].liquidity && best[k].liquidity.usd || 0)) best[k] = pr; }
      for (const k in best) if (rows[k]) { const pr = best[k]; rows[k].name = pr.baseToken.name; rows[k].symbol = pr.baseToken.symbol; rows[k].mc = Math.round(pr.marketCap || pr.fdv || 0); rows[k].v24 = Math.round(pr.volume && pr.volume.h24 || 0); rows[k].ch1h = pr.priceChange && pr.priceChange.h1 != null ? pr.priceChange.h1 : null; rows[k].ch5 = pr.priceChange && pr.priceChange.m5 != null ? pr.priceChange.m5 : null; rows[k].created = pr.pairCreatedAt || null; rows[k].dex = pr.dexId; if (!rows[k].icon && pr.info && pr.info.imageUrl) rows[k].icon = pr.info.imageUrl; }
    } catch (e) { /* enrichment is optional */ }
  }
  return Object.values(rows);
}

// Google Trends realtime RSS (pictures + news links)
function tag(s, t) { const m = s.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''; }
async function googleTrends(geo = 'US') {
  const xml = await fetchText(`https://trends.google.com/trending/rss?geo=${geo}`, {}, 9000);
  const items = xml.split('<item>').slice(1).map(x => {
    const news = x.split('<ht:news_item>').slice(1).map(n => ({ title: tag(n, 'ht:news_item_title'), url: tag(n, 'ht:news_item_url'), img: tag(n, 'ht:news_item_picture') || null, src: tag(n, 'ht:news_item_source') }));
    const traffic = tag(x, 'ht:approx_traffic'); const tn = parseInt(traffic.replace(/[^0-9]/g, ''), 10) || 0;
    return { title: tag(x, 'title'), traffic, tn, t: Date.parse(tag(x, 'pubDate')) || null, img: tag(x, 'ht:picture') || null, imgSrc: tag(x, 'ht:picture_source'), news, geo, url: 'https://trends.google.com/trending?geo=' + geo + '&q=' + encodeURIComponent(tag(x, 'title')) };
  }).filter(i => i.title);
  return items;
}

// X trends via trends24 (HTML, no auth). Optional source.
async function xTrends(slug = 'united-states') {
  const html = await fetchText(`https://trends24.in/${slug}/`, {}, 9000);
  const m = html.match(/<ol class="trend-card__list">([\s\S]*?)<\/ol>/); if (!m) throw new Error('no trend list');
  const out = []; const re = /<li[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?<span class="tweet-count"[^>]*>([^<]*)<\/span>)?[\s\S]*?<\/li>/g; let x;
  while ((x = re.exec(m[1])) && out.length < 40) { const name = x[2].replace(/<[^>]+>/g, '').trim(); if (name) out.push({ name, count: (x[3] || '').trim(), url: x[1].startsWith('http') ? x[1] : 'https://x.com/search?q=' + encodeURIComponent(name) + '&f=live' }); }
  return out;
}

// Polymarket (gamma): hottest by 24h volume + newest
async function polymarket() {
  const [hot, fresh] = await Promise.all([
    fetchJson('https://gamma-api.polymarket.com/markets?limit=40&active=true&closed=false&order=volume24hr&ascending=false', {}, 8000),
    fetchJson('https://gamma-api.polymarket.com/markets?limit=40&active=true&closed=false&order=createdAt&ascending=false', {}, 8000),
  ]);
  const slim = (m, kind) => { let yes = null; try { const p = JSON.parse(m.outcomePrices || '[]'); yes = p.length ? Math.round(Number(p[0]) * 100) : null; } catch { } return { id: m.id, kind, q: m.question, img: m.image || m.icon || null, v24: Math.round(Number(m.volume24hr || 0)), vol: Math.round(Number(m.volumeNum || m.volume || 0)), yes, created: m.createdAt, end: m.endDate, url: 'https://polymarket.com/market/' + m.slug }; };
  const seen = new Set(); const out = [];
  for (const m of (hot || [])) if (!seen.has(m.id)) { seen.add(m.id); out.push(slim(m, 'hot')); }
  for (const m of (fresh || [])) if (!seen.has(m.id)) { seen.add(m.id); out.push(slim(m, 'new')); }
  return out;
}

// Fresh internet objects: Product Hunt newest, GitHub trending, Hacker News show/new. All optional.
function unesc(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim(); }
async function productHunt() {
  const xml = await fetchText('https://www.producthunt.com/feed', {}, 9000);
  const entries = xml.split('<entry>').slice(1).map(e => { const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''; const content = tag(e, 'content'); const img = (content.match(/<img[^>]*src="([^"]+)"/) || [])[1] || null; return { kind: 'producthunt', title: unesc(tag(e, 'title')), url: link, t: Date.parse(tag(e, 'published') || tag(e, 'updated')) || null, desc: unesc(content).slice(0, 160), img }; }).filter(x => x.title);
  if (!entries.length) { // RSS 2.0 fallback
    return xml.split('<item>').slice(1).map(i => ({ kind: 'producthunt', title: unesc(tag(i, 'title')), url: tag(i, 'link'), t: Date.parse(tag(i, 'pubDate')) || null, desc: unesc(tag(i, 'description')).slice(0, 160), img: null })).filter(x => x.title);
  }
  return entries.slice(0, 40);
}
async function githubTrending() {
  const html = await fetchText('https://github.com/trending?since=daily', {}, 9000);
  const out = []; const re = /<h2 class="h3 lh-condensed">[\s\S]*?<a[^>]*href="\/([^"]+)"[\s\S]*?<\/h2>([\s\S]*?)(?=<h2 class="h3 lh-condensed">|<\/main>)/g; let m;
  while ((m = re.exec(html)) && out.length < 30) { const repo = m[1]; const block = m[2]; const desc = unesc((block.match(/<p class="col-9[^"]*">([\s\S]*?)<\/p>/) || [])[1] || ''); const stars = unesc((block.match(/<span class="d-inline-block float-sm-right">([\s\S]*?)<\/span>/) || [])[1] || '').replace(/\s+/g, ' '); const lang = unesc((block.match(/itemprop="programmingLanguage">([^<]*)</) || [])[1] || ''); out.push({ kind: 'github', title: repo, url: 'https://github.com/' + repo, desc: desc.slice(0, 160), stars, lang, img: null, t: null }); }
  if (!out.length) throw new Error('no repos parsed');
  return out;
}
async function hackerNews() {
  const [show, top] = await Promise.all([fetchJson('https://hacker-news.firebaseio.com/v0/showstories.json', {}, 6000), fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json', {}, 6000)]);
  const ids = [...new Set([...(show || []).slice(0, 18), ...(top || []).slice(0, 18)])];
  const items = await Promise.all(ids.map(id => fetchJson('https://hacker-news.firebaseio.com/v0/item/' + id + '.json', {}, 6000).catch(() => null)));
  return items.filter(i => i && i.title).map(i => ({ kind: 'hn', title: i.title, url: i.url || 'https://news.ycombinator.com/item?id=' + i.id, hn: 'https://news.ycombinator.com/item?id=' + i.id, t: (i.time || 0) * 1000, score: i.score || 0, comments: i.descendants || 0, img: null }));
}

// Reddit rising (viral animal stories, new internet things). Optional; reddit sometimes refuses cloud IPs.
async function reddit(subs, kind) {
  const j = await fetchJson(`https://www.reddit.com/r/${subs}/rising.json?limit=40&raw_json=1`, { headers: { 'user-agent': 'radar-scan/1.0 (narrative board)' } }, 9000);
  return ((j.data && j.data.children) || []).map(c => c.data).filter(d => d && d.title && !d.over_18).map(d => {
    let img = null; try { img = d.preview && d.preview.images && d.preview.images[0] && d.preview.images[0].source && d.preview.images[0].source.url || null; } catch { }
    if (!img && d.thumbnail && /^https?:/.test(d.thumbnail)) img = d.thumbnail;
    return { kind, title: d.title, url: 'https://www.reddit.com' + d.permalink, out: d.url_overridden_by_dest || d.url || null, sub: d.subreddit, score: d.score || 0, comments: d.num_comments || 0, t: (d.created_utc || 0) * 1000, img };
  });
}

// fxtwitter tweet preview
async function tweet(id) {
  const j = await fetchJson('https://api.fxtwitter.com/i/status/' + id, {}, 7000);
  const t = j.tweet || {}; const a = t.author || {}; const med = t.media || {};
  const photos = (med.photos || []).map(p => p.url).slice(0, 4); const videos = (med.videos || []).map(v => v.thumbnail_url).filter(Boolean).slice(0, 2);
  return { id, url: t.url || 'https://x.com/i/status/' + id, text: (t.text || '').slice(0, 400), name: a.name || '', handle: a.screen_name || '', avatar: a.avatar_url || null, followers: a.followers || null, imgs: photos.concat(videos), views: t.views || null, likes: t.likes || null, rts: t.retweets || null, at: t.created_timestamp ? t.created_timestamp * 1000 : null };
}

module.exports = { fetchText, fetchJson, timed, pumpNew, pumpByCreator, pumpUser, gtTrending, gtNewPools, dexPaid, googleTrends, xTrends, polymarket, tweet, slimCoin, productHunt, githubTrending, hackerNews, reddit };
