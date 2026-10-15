// Solana RPC reader for pump.fun creates. pump.fun's own API refuses servers (Cloudflare), so the chain is the source:
// every create touches the pump.fun mint authority, and the CreateEvent in the logs carries name / symbol / uri / mint / creator.
const { fetchJson } = require('./_lib');

const RPCS = [process.env.RPC_URL, 'https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'].filter(Boolean);
const MINT_AUTH = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const CREATE_DISC = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]); // sha256("event:CreateEvent")[0..8]

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(buf) {
  const digits = [];
  for (const byte of buf) { let carry = byte; for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; } while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; } }
  let s = ''; for (const byte of buf) { if (byte) break; s += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
  return s;
}

async function rpc(method, params, ms = 9000) {
  let last;
  for (const url of RPCS) {
    try { const j = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, ms); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result; }
    catch (e) { last = e; }
  }
  throw last || new Error('no rpc');
}
async function rpcBatch(calls, ms = 12000) {
  let last;
  for (const url of RPCS) {
    try { const j = await fetchJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c[0], params: c[1] }))) }, ms); if (!Array.isArray(j)) throw new Error('batch not supported'); return j.sort((a, b) => a.id - b.id).map(x => x.result || null); }
    catch (e) { last = e; }
  }
  throw last || new Error('no rpc');
}

function parseCreate(tx) {
  if (!tx || !tx.meta || tx.meta.err) return null;
  for (const line of (tx.meta.logMessages || [])) {
    if (!line.startsWith('Program data: ')) continue;
    let buf; try { buf = Buffer.from(line.slice(14), 'base64'); } catch { continue; }
    if (buf.length < 8 + 12 + 32 * 3 || !buf.subarray(0, 8).equals(CREATE_DISC)) continue;
    let o = 8; const str = () => { const n = buf.readUInt32LE(o); o += 4; const s = buf.subarray(o, o + n).toString('utf8'); o += n; return s; };
    try {
      const name = str(), symbol = str(), uri = str();
      const mint = b58(buf.subarray(o, o + 32)); o += 32; const bondingCurve = b58(buf.subarray(o, o + 32)); o += 32; const user = b58(buf.subarray(o, o + 32)); o += 32;
      let creator = user; if (buf.length >= o + 32) { creator = b58(buf.subarray(o, o + 32)); o += 32; }
      let ts = null; if (buf.length >= o + 8) { ts = Number(buf.readBigInt64LE(o)) * 1000; }
      return { mint, name, symbol, uri, creator, user, t: ts || (tx.blockTime ? tx.blockTime * 1000 : null), sig: tx.transaction && tx.transaction.signatures && tx.transaction.signatures[0], url: 'https://pump.fun/coin/' + mint };
    } catch { return null; }
  }
  return null;
}

// newest creates on pump.fun: signatures on the mint authority → batched getTransaction → CreateEvents
async function recentCreates(limit = 100, before) {
  const sigs = await rpc('getSignaturesForAddress', [MINT_AUTH, { limit: Math.min(1000, limit), ...(before ? { before } : {}) }]);
  const ok = (sigs || []).filter(s => !s.err).slice(0, limit);
  const out = [];
  for (let i = 0; i < ok.length; i += 25) {
    const chunk = ok.slice(i, i + 25);
    let txs = [];
    try { txs = await rpcBatch(chunk.map(s => ['getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]])); }
    catch (e) { txs = await Promise.all(chunk.map(s => rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null))); }
    txs.forEach((tx, k) => { const c = parseCreate(tx); if (c) { if (!c.t && chunk[k].blockTime) c.t = chunk[k].blockTime * 1000; out.push(c); } });
  }
  out.sort((a, b) => (b.t || 0) - (a.t || 0));
  return { coins: out, last: ok.length ? ok[ok.length - 1].signature : null, sigs: ok.length };
}

// creates by one wallet: its recent signatures, keep the ones that are pump creates
async function creatorCreates(wallet, n = 40) {
  const sigs = await rpc('getSignaturesForAddress', [wallet, { limit: n }]);
  const ok = (sigs || []).filter(s => !s.err);
  const out = [];
  for (let i = 0; i < ok.length; i += 40) {
    const chunk = ok.slice(i, i + 40);
    let txs = [];
    try { txs = await rpcBatch(chunk.map(s => ['getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]])); }
    catch (e) { txs = await Promise.all(chunk.map(s => rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null))); }
    txs.forEach((tx, k) => { const c = parseCreate(tx); if (c && (c.creator === wallet || c.user === wallet)) { if (!c.t && chunk[k].blockTime) c.t = chunk[k].blockTime * 1000; out.push(c); } });
  }
  out.sort((a, b) => (b.t || 0) - (a.t || 0));
  return { coins: out, sigs: ok.length, last: ok.length ? ok[0].blockTime * 1000 : null };
}

// Jupiter: icon, mcap, stats, socials for a set of mints (100 per call)
const jupCache = new Map();
async function jupEnrich(coins) {
  const need = coins.filter(c => c.mint && !(jupCache.has(c.mint) && Date.now() - jupCache.get(c.mint).at < 60000));
  for (let i = 0; i < need.length; i += 100) {
    const ids = need.slice(i, i + 100).map(c => c.mint);
    try {
      const j = await fetchJson('https://lite-api.jup.ag/tokens/v2/search?query=' + ids.join(','), {}, 9000);
      for (const t of (Array.isArray(j) ? j : [])) jupCache.set(t.id, { at: Date.now(), v: t });
    } catch (e) { /* enrichment is optional */ }
  }
  for (const c of coins) {
    const h = jupCache.get(c.mint); if (!h) continue; const t = h.v;
    c.img = c.img || t.icon || null; c.mc = Math.round(t.mcap || t.fdv || 0); c.tw = c.tw || t.twitter || null; c.web = c.web || t.website || null; c.tg = c.tg || t.telegram || null;
    c.organic = t.organicScore != null ? Math.round(t.organicScore) : null; c.holders = t.holderCount || null; c.launchpad = t.launchpad || null;
    const s5 = t.stats5m || {}, s1 = t.stats1h || {}; c.b5 = s5.numBuys || 0; c.s5 = s5.numSells || 0; c.v5 = Math.round((s5.buyVolume || 0) + (s5.sellVolume || 0)); c.v1h = Math.round((s1.buyVolume || 0) + (s1.sellVolume || 0)); c.ch5 = s5.priceChange != null ? +Number(s5.priceChange).toFixed(1) : null; c.ch1h = s1.priceChange != null ? +Number(s1.priceChange).toFixed(1) : null;
    c.dexUrl = 'https://dexscreener.com/solana/' + c.mint;
  }
  return coins;
}

// metadata JSON (image / twitter / website) for coins Jupiter does not know yet — capped, cached
const metaCache = new Map();
async function metaFill(coins, cap = 40) {
  const need = coins.filter(c => !c.img && c.uri && /^https?:/.test(c.uri)).slice(0, cap);
  await Promise.all(need.map(async c => {
    const h = metaCache.get(c.mint); if (h) { Object.assign(c, h); return; }
    try { const u = c.uri.replace('https://ipfs.io/ipfs/', 'https://pump.mypinata.cloud/ipfs/'); const j = await fetchJson(u, {}, 5000); const m = { img: j.image || null, tw: c.tw || j.twitter || null, web: c.web || j.website || null, tg: c.tg || j.telegram || null, desc: (j.description || '').slice(0, 200) }; metaCache.set(c.mint, m); Object.assign(c, m); }
    catch (e) { metaCache.set(c.mint, {}); }
  }));
  return coins;
}

module.exports = { rpc, rpcBatch, parseCreate, recentCreates, creatorCreates, jupEnrich, metaFill, MINT_AUTH, PUMP, b58 };
