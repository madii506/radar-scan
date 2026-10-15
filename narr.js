// Narrative engine, shared by the server (api/*.js) and the browser (served as /narr.js — keep the two copies identical).
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.NARR = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const STOP = new Set(('the of and a an to in is it for on at by from with as or be are was were has have had not no yes just all out up go get one two three new my your our this that these those we i you me he she they do does did its his her their coin coins token tokens meme memes pump fun sol solana official real true dev launch launched launches pumpfun bonk letsbonk cto community sends send sent live now today here there only ever first last best top big little mini micro mega giga super ultra very much more most many some any every each other another same still back again over under into onto than then when what who why how will would can could should shall may might must let lets make makes made like love want need day days week weeks month year years time times vs').split(' '));
  // words on the board every hour of every day; down-weighted, not hidden
  const CHRONIC = new Set('cat dog ai trump elon musk pepe bitcoin btc eth doge shib baby moon rocket chad wojak frog bonk wif pnut fart fartcoin inu kitty puppy 100x 1000x gm gn based giga sigma alpha beta retard retardio brainrot ohio rizz skibidi gyat sus test'.split(' '));

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
    for (const u of [c.web, c.tw]) { try { const url = new URL(u); const h = url.hostname.replace(/^www\./, ''); if (!/^(x\.com|twitter\.com|t\.me|pump\.fun|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|usepaid\.app|otcdesks\.cash)$/.test(h) && !/^vm\.tiktok/.test(h)) ks.add('u:' + h + url.pathname.replace(/\/$/, '').slice(0, 60)); } catch (e) { } }
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
      const ts = cs.map(c => c.t || 0).filter(Boolean); const first = Math.min.apply(null, ts), last = Math.max.apply(null, ts);
      const spanMin = Math.max(1, (last - first) / 60000); const ageMin = (now - last) / 60000;
      const maxMc = Math.max.apply(null, cs.map(c => c.mc || 0)); const sumMc = cs.reduce((s, c) => s + (c.mc || 0), 0);
      const creators = new Set(cs.map(c => c.creator)).size;
      let score = cs.length * (1 + Math.log1p(maxMc / 1000)) * (ageMin < 10 ? 1.6 : ageMin < 30 ? 1.2 : ageMin < 90 ? 1 : 0.7) * (creators > 1 ? 1 + Math.min(creators, 8) / 8 : 0.6);
      if (kind === 'w' && CHRONIC.has(label)) score *= 0.3;
      if (kind === 'tw' || kind === 'xt' || kind === 'u') score *= 1.4; if (kind === 'b') score *= 1.25;
      list.push({ key, kind, label, count: cs.length, creators, first, last, ageMin: Math.round(ageMin), perTenMin: +(cs.length / spanMin * 10).toFixed(1), maxMc, sumMc, score: +score.toFixed(1), coins: cs.slice().sort((a, b) => (b.mc || 0) - (a.mc || 0)).slice(0, 8), mints: cs.map(c => c.mint) });
    }
    list.sort((a, b) => b.score - a.score);
    const covered = new Set(); const out = [];
    for (const cl of list) { const overlap = cl.mints.filter(m => covered.has(m)).length; if (overlap / cl.mints.length >= 0.6) continue; cl.mints.forEach(m => covered.add(m)); out.push(cl); }
    return out;
  }

  // how many coins in the window already ride a title
  function matchTrend(title, coins) {
    const tw = words(title).filter(w => w.length >= 4 && !CHRONIC.has(w)); if (!tw.length) return { n: 0, coins: [] };
    const full = norm(title);
    const hits = coins.filter(c => { const n = norm(c.name + ' ' + c.symbol); if (full.length >= 6 && n.includes(full)) return true; const cw = words(c.name + ' ' + c.symbol); return tw.length >= 2 ? tw.filter(w => cw.includes(w)).length >= 2 : cw.includes(tw[0]); });
    return { n: hits.length, coins: hits.slice().sort((a, b) => (b.mc || 0) - (a.mc || 0)).slice(0, 4) };
  }

  // categories the user filters by
  const CATS = {
    animals: /\b(cat|cats|kitten|kitty|dog|dogs|puppy|pup|raccoon|cow|calf|elephant|bird|parrot|owl|eagle|zoo|pet|pets|animal|animals|otter|capybara|penguin|bear|fox|duck|snake|frog|turtle|tortoise|monkey|ape|gorilla|horse|pony|pig|goat|sheep|lamb|rescue|rescued|shelter|wildlife|hamster|bunny|rabbit|deer|moose|whale|dolphin|shark|octopus|squirrel|hedgehog|koala|panda|tiger|lion|wolf|seal|walrus|chicken|rooster|hen|cockatoo|orphan|vet|veterinarian|stray|puppies|kittens|meow|woof|dwarf|possum|opossum|goose|swan|donkey|alpaca|llama|camel|lizard|gecko|iguana|crab|lobster|jellyfish|bat|bats|pigeon|crow|raven|sparrow|hippo|rhino|giraffe|zebra|kangaroo|wombat|platypus|sloth|lemur|ferret|chinchilla|guinea)\b/i,
    ai: /\b(ai|a\.i\.|gpt|chatgpt|llm|llms|openai|anthropic|claude|gemini|mistral|deepseek|grok|xai|copilot|agent|agents|agentic|chatbot|neural|model|models|nvidia|nemotron|llama|robot|robots|robotics|humanoid|sora|midjourney|stable diffusion|diffusion|transformer|machine learning|deep learning|inference|gpu|gpus|datacenter|data center|superintelligence|agi|openclaw|cursor|codex|perplexity|hugging face|huggingface|rag|vibe code|vibecode|vibecoding)\b/i,
    crypto: /\b(crypto|bitcoin|btc|ethereum|eth|solana|sol|token|tokens|memecoin|memecoins|pump\.?fun|pumpfun|binance|coinbase|defi|nft|nfts|airdrop|wallet|blockchain|altcoin|altcoins|stablecoin|usdc|usdt|tether|xrp|ripple|dogecoin|doge|shiba|pepe|bonk|jupiter|raydium|hyperliquid|perps|dex|cex|onchain|on-chain|web3|degen|trenches|rug|rugged|ca|mcap|bags|moonshot|kraken|bybit|okx|satoshi|halving|etf|blackrock|microstrategy|strategy|saylor|vitalik|toly|polymarket|kalshi)\b/i,
    github: /\b(github|repo|repository|open source|open-source|opensource|library|framework|sdk|cli|npm|pypi|rust|python|typescript|javascript|golang|kernel|linux|docker|kubernetes|postgres|sqlite|compiler|self-hosted|selfhosted)\b/i,
    whitehouse: /\b(white house|whitehouse|trump|president|potus|senate|congress|house of representatives|election|elections|governor|biden|vance|kamala|harris|minister|parliament|kremlin|putin|zelensky|zelenskyy|israel|gaza|iran|tariff|tariffs|executive order|pentagon|fbi|cia|supreme court|democrat|democrats|republican|republicans|gop|maga|doge|epstein|shutdown|impeach|impeachment|border|ice|deportation|nato|un|united nations|ceasefire|sanctions|secretary|cabinet|rubio|hegseth|bondi|musk|newsom|aoc|obama|clinton|pelosi|schumer|jeffries|johnson|netanyahu|xi|jinping|modi|starmer|macron|merz|carney|milei|king charles|royal|prince|princess|kate|meghan|coup|protest|protests|riot|strike)\b/i,
    money: /\b(stock|stocks|shares|market|markets|nasdaq|dow|s&p|sp500|fed|rates|rate cut|inflation|cpi|earnings|ipo|billion|billions|million|millions|trillion|bank|banks|jpmorgan|goldman|layoffs|salary|tax|taxes|price|prices|gold|silver|oil|wall street|wallstreetbets|wsb|investor|investors|hedge fund|buyback|dividend|recession|gdp|treasury|bond|bonds|mortgage|housing|rent|debt|bankrupt|bankruptcy|fraud|ponzi|lottery|jackpot|powerball|mega millions|net worth|billionaire|millionaire|rich|money|cash|dollar|dollars|euro|yen|yuan|forex|tesla|tsla|nvda|aapl|amzn|msft|googl|meta|amd|intel|palantir|pltr|coreweave|robinhood|hood|backpack|xstocks)\b/i,
    tech: /\b(apple|iphone|ipad|mac|macbook|ios|android|google|pixel|microsoft|windows|xbox|tesla|spacex|starship|starlink|rocket|launch|app|apps|startup|software|hardware|chip|chips|semiconductor|quantum|browser|chrome|safari|firefox|vr|ar|headset|meta|instagram|tiktok|youtube|twitter|x\.com|reddit|discord|telegram|whatsapp|snapchat|netflix|spotify|amazon|aws|cloud|server|servers|api|update|beta|bug|hack|hacked|hacker|breach|leak|leaked|cyber|cybersecurity|password|privacy|drone|drones|ev|evs|battery|solar|nuclear|fusion|5g|6g|wifi|satellite|telescope|nasa|mars|moon|asteroid|comet|eclipse|science|physics|biotech|crispr|vaccine|fda)\b/i,
    sports: /\b(nfl|nba|mlb|nhl|wnba|ncaa|football|soccer|basketball|baseball|hockey|tennis|golf|f1|formula 1|nascar|ufc|mma|boxing|wrestling|wwe|aew|olympics|world cup|champions league|premier league|la liga|serie a|bundesliga|ligue 1|mls|match|game|games|league|cup|playoffs|finals|coach|quarterback|touchdown|goal|goals|striker|midfielder|transfer|injury|lineup|roster|draft|trade|mvp|rookie|lacrosse|cricket|rugby|marathon|cycling|skiing|lakers|yankees|dodgers|cowboys|chiefs|eagles|celtics|warriors|knicks|heat|bulls|thunder|spurs|liverpool|arsenal|chelsea|barcelona|real madrid|psg|milan|juventus|bayern|dortmund|united|city|sunderland|salzburg|palace|torreense|messi|ronaldo|lebron|curry|mahomes|ohtani|judge|wembanyama|holmgren|collier)\b/i,
    entertainment: /\b(movie|movies|film|films|netflix|hbo|disney|marvel|dc|star wars|trailer|album|song|songs|singer|rapper|rap|concert|tour|grammy|grammys|oscar|oscars|emmy|emmys|actor|actress|celebrity|kardashian|jenner|swift|taylor swift|beyonce|drake|kanye|ye|bieber|rihanna|bad bunny|tv|series|season|episode|anime|manga|pokemon|pokémon|nintendo|playstation|ps5|xbox|game|gaming|gamer|fortnite|minecraft|roblox|gta|twitch|streamer|streamers|kai cenat|mrbeast|ishowspeed|xqc|podcast|rogan|comedian|comedy|snl|late night|bratz|barbie|lego|toy|toys|doll|dolls|wedding|divorce|dating|pregnant|baby|died|dies|death|rip|funeral|tragedy|arrested|arrest|lawsuit|sued|scandal|cheating|affair|viral|meme|memes|tiktoker|influencer|onlyfans)\b/i,
  };
  const CAT_ORDER = ['animals', 'ai', 'crypto', 'github', 'whitehouse', 'money', 'tech', 'sports', 'entertainment'];
  function categorize(text, kind) {
    const t = ' ' + String(text || '').toLowerCase() + ' '; const out = [];
    for (const c of CAT_ORDER) if (CATS[c].test(t)) out.push(c);
    if (kind === 'github' && !out.includes('github')) out.unshift('github');
    if ((kind === 'hn' || kind === 'producthunt') && !out.includes('tech') && !out.includes('ai')) out.push('tech');
    if ((kind === 'dex' || kind === 'gecko' || kind === 'jup' || kind === 'coingecko') && !out.includes('crypto')) out.unshift('crypto');
    if (kind === 'market' && !out.length) out.push('money');
    if (!out.length) out.push('other');
    return out;
  }

  // interactions → one comparable number (roughly "thousands of people")
  function heatOf(o) {
    let h = 0;
    switch (o.kind) {
      case 'gtrend': h = (o.tn || 0) / 100; break;                 // 2000+ searches → 20
      case 'xtrend': h = Math.max(1, 30 - (o.rank || 30)); break;   // rank 1 → 29
      case 'hn': h = (o.score || 0) / 15 + (o.comments || 0) / 15; break;
      case 'github': h = (o.starsToday || 0) / 150; break;
      case 'producthunt': h = 3; break;
      case 'market': h = (o.v24 || 0) / 25000; break;
      case 'coingecko': h = Math.max(1, 16 - (o.rank || 15)); break;
      case 'news': h = 2; break;
      default: h = 1;
    }
    const age = o.t ? (Date.now() - o.t) / 3600000 : 6;
    const rec = age < 1 ? 1.5 : age < 3 ? 1.2 : age < 12 ? 1 : age < 48 ? 0.6 : 0.35;
    return +(h * rec).toFixed(1);
  }

  return { STOP, CHRONIC, norm, words, tweetId, keysFor, buildClusters, matchTrend, CATS, CAT_ORDER, categorize, heatOf };
});
