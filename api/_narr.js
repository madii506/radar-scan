// Narrative engine: clusters the newest pump.fun coins by shared tweet / shared words,
// then matches clusters against what is trending off-chain and what is getting bids on-chain.

const STOP = new Set(('the of and a an to in is it for on at by from with as or be are was were has have had not no yes just all out up go get one two three new my your our this that these those we i you me he she they do does did its his her their coin coins token tokens meme memes pump fun sol solana official real true dev launch launched launches pumpfun bonk letsbonk cto community sends send sent live now today here there only ever first last best top big little mini micro mega giga super ultra very much more most many some any every each other another same still back again over under into onto than then when what who why how will would can could should shall may might must let lets make makes made like love want need day days week weeks month year years time times').split(' '));
// words that are on the board every hour of every day; they get down-weighted, not hidden
const CHRONIC = new Set('cat dog ai trump elon musk pepe bitcoin btc eth doge shib baby moon rocket chad wojak frog bonk wif pnut fart fartcoin inu kitty puppy coin1 100x 1000x gm gn based giga sigma alpha beta retard retardio brainrot ohio rizz skibidi gyat sus'.split(' '));

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9À-ɏЀ-ӿ぀-ヿ一-鿿 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function words(s) { return norm(s).split(' ').filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)); }
function tweetId(u) { const m = String(u || '').match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i) || String(u || '').match(/\/i\/status\/(\d+)/); return m ? m[1] : null; }
function trendingId(u) { const m = String(u || '').match(/x\.com\/i\/trending\/(\d+)/); return m ? m[1] : null; }

function keysFor(c) {
  const ks = new Set();
  const tid = tweetId(c.tw) || tweetId(c.web) || tweetId(c.tg); if (tid) ks.add('tw:' + tid);
  const trid = trendingId(c.web) || trendingId(c.tw); if (trid) ks.add('xt:' + trid);
  const nw = words(c.name); const sw = words(c.symbol);
  for (const w of nw) ks.add('w:' + w);
  for (const w of sw) if (!nw.includes(w)) ks.add('w:' + w);
  for (let i = 0; i + 1 < nw.length; i++) ks.add('b:' + nw[i] + ' ' + nw[i + 1]);
  // a non-social source link (news article, github repo) is a narrative key too
  for (const u of [c.web, c.tw]) { try { const url = new URL(u); const h = url.hostname.replace(/^www\./, ''); if (!/^(x\.com|twitter\.com|t\.me|pump\.fun|instagram\.com|tiktok\.com|youtube\.com|youtu\.be)$/.test(h) && !/^vm\.tiktok/.test(h)) ks.add('u:' + h + url.pathname.replace(/\/$/, '').slice(0, 60)); } catch { } }
  return [...ks];
}

function buildClusters(coins, now) {
  const byKey = new Map();
  for (const c of coins) for (const k of keysFor(c)) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(c); }
  const list = [];
  for (const [key, cs] of byKey) {
    if (cs.length < 2) continue;
    const kind = key.slice(0, key.indexOf(':')); const label = key.slice(key.indexOf(':') + 1);
    if (kind === 'w' && CHRONIC.has(label) && cs.length < 4) continue;
    const ts = cs.map(c => c.t || 0).filter(Boolean); const first = Math.min(...ts), last = Math.max(...ts);
    const spanMin = Math.max(1, (last - first) / 60000); const ageMin = (now - last) / 60000;
    const maxMc = Math.max(...cs.map(c => c.mc || 0)); const sumMc = cs.reduce((s, c) => s + (c.mc || 0), 0);
    const creators = new Set(cs.map(c => c.creator)).size;
    let score = cs.length * (1 + Math.log1p(maxMc / 1000)) * (ageMin < 10 ? 1.6 : ageMin < 30 ? 1.2 : 1) * (creators > 1 ? 1 + Math.min(creators, 8) / 8 : 0.6);
    if (kind === 'w' && CHRONIC.has(label)) score *= 0.3;
    if (kind === 'tw' || kind === 'xt' || kind === 'u') score *= 1.4; if (kind === 'b') score *= 1.25;
    list.push({ key, kind, label, count: cs.length, creators, first, last, ageMin: Math.round(ageMin), perTenMin: +(cs.length / spanMin * 10).toFixed(1), maxMc, sumMc, score: +score.toFixed(1), coins: cs.slice().sort((a, b) => (b.mc || 0) - (a.mc || 0)).slice(0, 8), mints: cs.map(c => c.mint) });
  }
  list.sort((a, b) => b.score - a.score);
  // greedy de-dup: skip a cluster when most of its coins are already covered by a stronger one
  const covered = new Set(); const out = [];
  for (const cl of list) { const overlap = cl.mints.filter(m => covered.has(m)).length; if (overlap / cl.mints.length >= 0.6) continue; cl.mints.forEach(m => covered.add(m)); out.push(cl); }
  return out;
}

// match a trend title against coin names in the window → how many coins already ride it
function matchTrend(title, coins) {
  const tw = words(title).filter(w => w.length >= 4 && !CHRONIC.has(w)); if (!tw.length) return { n: 0, coins: [] };
  const full = norm(title);
  const hits = coins.filter(c => { const n = norm(c.name + ' ' + c.symbol); if (full.length >= 6 && n.includes(full)) return true; const cw = words(c.name + ' ' + c.symbol); return tw.length >= 2 ? tw.filter(w => cw.includes(w)).length >= 2 : cw.includes(tw[0]); });
  return { n: hits.length, coins: hits.slice().sort((a, b) => (b.mc || 0) - (a.mc || 0)).slice(0, 4) };
}

module.exports = { buildClusters, matchTrend, words, norm, tweetId, CHRONIC };
