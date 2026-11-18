// ROT site logic. Static, no build step. Every string that comes from the chain, DexScreener,
// data files or the user goes through esc() before it touches the DOM.
import * as C from '../lib/rot-core.mjs';
import { buildTxs } from '../lib/rot-tx.mjs';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CFG = window.ROT_CONFIG || {};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => (a && a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : (a || ''));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage can be blocked */ } }
};
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200); }
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isHttp = u => /^https?:\/\/[^\s]+$/i.test(u || '');
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const explorerTx = s => 'https://explorer.solana.com/tx/' + s;
const explorerAddr = a => 'https://explorer.solana.com/address/' + a;
const me = () => (wallet?.addr || state.addr || '');
const rowMe = w => (w && w === me() ? ' class="me"' : '');
const walletLink = w => (C.isAddress(w) ? `<a class="wl" href="${esc(explorerAddr(w))}" target="_blank" rel="noopener" title="${esc(w)}">${esc(short(w))}</a>` : esc(short(w)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- config driven bits ---------------- */
for (const el of $$('[data-cfg]')) el.textContent = String(CFG[el.dataset.cfg] ?? '');
for (const el of $$('[data-href]')) { const v = CFG[el.dataset.href]; if (isHttp(v)) { el.href = v; el.hidden = false; } else el.hidden = true; }
const live = !!C.isAddress(CFG.ca);
$('#ruleCard').hidden = !(CFG.feeRuleLocked === true && C.isAddress(CFG.potWallet));
$('#rulePre').hidden = !$('#ruleCard').hidden;
if (!$('#ruleCard').hidden) $('#ruleLink').href = explorerAddr(CFG.potWallet);

/* ---------------- sound (off by default) ---------------- */
const Sound = (() => {
  let ctx, on = false;
  const ensure = () => { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  const tone = (f, d, v, slide) => {
    if (!on) return; ensure();
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d + .02);
  };
  return { get on() { return on; }, set(v) { on = v; if (v) ensure(); }, rot() { tone(220, .5, .06, 90); tone(660, .3, .03); }, tick() { tone(520, .06, .03, 640); } };
})();
$('#sound').addEventListener('click', () => {
  const v = !Sound.on; Sound.set(v);
  $('#sound').textContent = v ? 'Sound on' : 'Sound off'; $('#sound').setAttribute('aria-pressed', v);
  if (v) { toast('Sound on'); Sound.tick(); }
});

/* ---------------- modals (focus trap) ---------------- */
let modalOpener = null;
function openModal(el) {
  modalOpener = document.activeElement; el.classList.add('on');
  const f = el.querySelector('button,a[href],input'); setTimeout(() => f?.focus(), 30);
}
function closeModal(el) { el.classList.remove('on'); modalOpener?.focus?.(); }
addEventListener('keydown', e => {
  const m = $('.modal.on'); if (!m) return;
  if (e.key === 'Escape') { m.id === 'wm' ? closeWalletModal() : pvCancel(); return; }
  if (e.key !== 'Tab') return;
  const f = [...m.querySelectorAll('button:not([disabled]),a[href],input')].filter(x => x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ---------------- time + numbers ---------------- */
function dur(ms) {
  ms = Math.max(0, ms); const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}
const when = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const day = ms => new Date(ms).toISOString().slice(0, 10);
const pct = (a, b) => (b ? (a / b * 100).toFixed(a / b >= .1 ? 0 : 1) + '%' : '0%');

/* ---------------- chain + market reads ---------------- */
let lastRpc = 0;
async function rpc(method, params = []) {
  if (!navigator.onLine) { const e = new Error('offline'); e.offline = true; throw e; }
  for (let attempt = 0; ; attempt++) {
    const wait = lastRpc + 140 - Date.now(); if (wait > 0) await sleep(wait); lastRpc = Date.now();
    let r;
    try { r = await fetch(CFG.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); }
    catch (e) { if (attempt < 2) { await sleep(500 * 2 ** attempt); continue; } throw e; }
    if (r.status === 429) { if (attempt < 3) { await sleep(900 * 2 ** attempt); continue; } const e = new Error('rate'); e.rate = true; throw e; }
    if (r.status === 403) { const e = new Error('refused'); e.refused = true; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j.error && /blocked|forbidden|not allowed|api key/i.test(j.error.message || '')) { const e = new Error('refused'); e.refused = true; throw e; }
    if (j.error) { if (/rate|too many/i.test(j.error.message || '') && attempt < 3) { await sleep(900 * 2 ** attempt); continue; } throw new Error(j.error.message || 'rpc'); }
    return j.result;
  }
}
const mintCache = new Map();
async function readMint(mint) {
  if (mintCache.has(mint)) return mintCache.get(mint);
  const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  const i = r?.value?.data?.parsed?.info; if (!i) throw new Error('no mint');
  const out = { decimals: i.decimals, mintAuthority: i.mintAuthority ?? null, freezeAuthority: i.freezeAuthority ?? null };
  mintCache.set(mint, out); return out;
}
let rotDecimals = null;
async function getRotDecimals() {
  if (rotDecimals != null) return rotDecimals;
  if (!live) return 6;
  try { rotDecimals = (await readMint(CFG.ca)).decimals; } catch { rotDecimals = null; }
  return rotDecimals ?? 0;
}
const dexCache = new Map();
async function dexBatch(mints) {
  const key = mints.join(',');
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch('https://api.dexscreener.com/tokens/v1/solana/' + key);
      if (r.status === 429) { await sleep(900 * 2 ** attempt); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); return Array.isArray(j) ? j : (j.pairs || []);
    } catch { await sleep(500 * 2 ** attempt); }
  }
  return null;
}
async function marketFor(mints, onProgress) {
  const need = mints.filter(m => !dexCache.has(m));
  let done = mints.length - need.length;
  for (const slice of C.chunk(need, 30)) {
    onProgress?.(done, mints.length);
    const pairs = await dexBatch(slice);
    for (const m of slice) dexCache.set(m, pairs == null ? null : pairs.filter(p => p.baseToken?.address === m || p.quoteToken?.address === m));
    done += slice.length; onProgress?.(done, mints.length);
    if (done < mints.length) await sleep(350);
  }
  return new Map(mints.map(m => [m, dexCache.get(m) ?? null]));
}

/* ---------------- data files ---------------- */
let ledgerP = null, roundsP = null, blockP = null;
const jsonOrThrow = async url => { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const loadLedger = () => (ledgerP ||= jsonOrThrow(CFG.ledgerUrl).then(l => ({ burns: [], ...l, burns: Array.isArray(l.burns) ? l.burns : [] })));
const loadBlock = () => (blockP ||= jsonOrThrow('./blocklist.json').catch(() => ({ wallets: [], mints: [] })));
function loadRounds() {
  return (roundsP ||= (async () => {
    const index = await jsonOrThrow(CFG.roundsUrl);
    const base = new URL(CFG.roundsUrl, location.href);
    const rounds = new Map();
    for (const e of index.rounds || []) {
      if (!/^[\w.-]+\.json$/.test(e.file || '')) continue;
      try { rounds.set(e.n, await jsonOrThrow(new URL(e.file, base).href)); } catch { /* missing file shows as unavailable */ }
    }
    return { index, rounds };
  })());
}
const currentRound = () => (CFG.roundStart ? C.roundNumberAt(Date.now(), CFG.roundStart, CFG.roundLengthDays) : 0);
const paidSum = (rounds, wallet) => { let s = 0n; for (const r of rounds.values()) if (r.status === 'paid') for (const p of r.payouts || []) if (p.rotBase != null && (!wallet || p.wallet === wallet)) s += BigInt(p.rotBase); return s; };

/* ---------------- scene wiring ---------------- */
const CAPS = ['Fresh. Somebody paid full price for this.', 'Tarnished. The chart stopped answering.', 'Cracked. Nobody posts about it anymore.', 'Dust. Gone from every watchlist.', 'Sprout. Something has to grow from this.'];
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
const useGL = !REDUCED && webglOK();
let sceneModP = null;
const sceneMod = () => (useGL ? (sceneModP ||= import('./scene.js').catch(() => null)) : null);
const svgMod = import('./coinsvg.js');
const scenes = {};
async function initScene(key, canvasSel, wrapSel, svgSel) {
  const wrap = $(wrapSel), svg = $(svgSel);
  const { coinSvg } = await svgMod;
  const svgStage = s => { svg.innerHTML = coinSvg(s); };
  const fallback = () => { wrap.classList.add('nogl'); svgStage(0); scenes[key] = { svgStage, set() {}, tween() {}, pause() {} }; return scenes[key]; };
  const mod = useGL ? await sceneMod() : null;
  if (!mod) {
    const sc = fallback();
    if (!REDUCED && !wrap.querySelector('.glnote')) { const p = document.createElement('p'); p.className = 'glnote'; p.textContent = "Your browser can't draw the coin. The rest of ROT still works."; wrap.append(p); }
    return sc;
  }
  try {
    const sc = mod.createScene($(canvasSel));
    scenes[key] = { set: (u, snap) => sc.setRot(u, snap), tween: (u, ms) => sc.tweenTo(u, ms), pause: p => sc.setPaused(p), svgStage() {} };
  } catch { return fallback(); }
  return scenes[key];
}
function paintStage(stage) {
  $('#homeCap').textContent = CAPS[stage];
  $('#soil').classList.toggle('sprout', stage === 4);
}
let homeStage = -1;
function onScroll() {
  if (REDUCED || route.cur !== 'rot') return;
  const run = $('#homeRun'); const den = Math.max(innerHeight * .8, run.offsetHeight - innerHeight);
  const u = Math.min(1, Math.max(0, scrollY / den));
  scenes.home?.set?.(u);
  $('#soil').style.setProperty('--u', u.toFixed(3));
  const s = u >= .95 ? 4 : u >= .75 ? 3 : u >= .5 ? 2 : u >= .25 ? 1 : 0;
  if (s !== homeStage) { homeStage = s; paintStage(s); scenes.home?.svgStage?.(s); }
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);

/* ---------------- router ---------------- */
const PAGES = ['rot', 'bin', 'how', 'ledger', '404'];
function route() {
  const seg = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  let page = seg[0] || 'rot';
  if (!['rot', 'bin', 'how', 'ledger'].includes(page)) page = '404';
  const changed = route.cur !== page;
  route.cur = page; route.seg = seg;
  document.title = ({ rot: 'ROT: Dead bags rot. Rot feeds the next.', bin: 'The bin · ROT', how: 'How it works · ROT', ledger: 'Ledger · ROT', 404: 'Nothing to see here · ROT' })[page];
  $$('.page').forEach(p => p.classList.toggle('on', p.dataset.page === page));
  $$('#nav a').forEach(x => { if (x.dataset.r === page) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
  if (changed) scrollTo(0, 0);
  scenes.home?.pause?.(page !== 'rot'); scenes.bin?.pause?.(page !== 'bin');
  if (page === 'rot') { homeStage = -1; initHome(); onScroll(); if (homeStage < 0) { homeStage = 0; paintStage(0); } }
  if (page === 'bin') initBin();
  if (page === 'ledger') renderLedger();
  if (page === 'how') observeReveals();
}
addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href^="#"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  const h = a.getAttribute('href'); e.preventDefault();
  if (location.hash === h || (h === '#/' && !location.hash)) route(); else location.hash = h;
});

/* ---------------- wallet ---------------- */
const WALLETS = [
  { id: 'phantom', name: 'Phantom', url: 'https://phantom.app/download', get: () => (window.phantom?.solana?.isPhantom ? window.phantom.solana : (window.solana?.isPhantom ? window.solana : null)) },
  { id: 'solflare', name: 'Solflare', url: 'https://solflare.com/download', get: () => (window.solflare?.isSolflare ? window.solflare : null) },
  { id: 'backpack', name: 'Backpack', url: 'https://backpack.app/downloads', get: () => (window.backpack?.isBackpack ? window.backpack : (window.xnft?.solana || null)) }
];
let wallet = store.get('rot-wallet', null); // { addr, id }
let wProv = null;
const walletDef = id => WALLETS.find(w => w.id === id);
const state = { addr: '', pasted: false };
function paintWallet() { const b = $('#walletBtn'); b.textContent = wallet ? short(wallet.addr) : 'Connect'; b.classList.toggle('on', !!wallet); b.setAttribute('aria-label', wallet ? `Wallet ${wallet.addr}. Disconnect` : 'Connect a wallet'); }
function bindProvider(prov) {
  if (prov.__rotBound) return; prov.__rotBound = true;
  prov.on?.('accountChanged', pk => { wallet = pk ? { ...wallet, addr: pk.toString() } : null; store.set('rot-wallet', wallet); paintWallet(); if (wallet) useAddress(wallet.addr, false); });
  prov.on?.('disconnect', () => { wallet = null; wProv = null; store.set('rot-wallet', null); paintWallet(); });
}
async function connectWith(def) {
  const prov = def.get();
  if (!prov) { window.open(def.url, '_blank', 'noopener'); return null; }
  try {
    const r = await prov.connect(); const pk = r?.publicKey || prov.publicKey; if (!pk) throw new Error('no key');
    wallet = { addr: pk.toString(), id: def.id }; wProv = prov; bindProvider(prov);
    store.set('rot-wallet', wallet); paintWallet(); closeWalletModal(); toast('Wallet connected');
    if (route.cur === 'bin') useAddress(wallet.addr, false);
    return wallet;
  } catch (e) { toast(e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || '') ? 'You closed the request. Nothing was sent.' : "Couldn't connect " + def.name + '.'); return null; }
}
function openWalletModal() {
  const any = WALLETS.some(w => w.get());
  $('#wmList').innerHTML = (any ? '' : '<p class="small">No wallet found. Paste an address instead.</p>') + WALLETS.map(w => w.get()
    ? `<button class="wopt" type="button" data-w="${w.id}"><span>${esc(w.name)}</span></button>`
    : `<a class="wopt" href="${esc(w.url)}" target="_blank" rel="noopener"><span>${esc(w.name)} isn't installed. Get it</span></a>`).join('');
  openModal($('#wm'));
}
function closeWalletModal() { closeModal($('#wm')); }
$('#wmList').addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (b) connectWith(walletDef(b.dataset.w)); });
$('#wmClose').addEventListener('click', closeWalletModal);
$('#wm').addEventListener('click', e => { if (e.target.id === 'wm') closeWalletModal(); });
async function activeProvider() {
  if (wProv) return wProv;
  const def = wallet && walletDef(wallet.id); const prov = def?.get();
  if (prov) { try { await prov.connect({ onlyIfTrusted: true }); } catch { /* user may need to reconnect */ } wProv = prov; bindProvider(prov); }
  return wProv;
}
$('#walletBtn').addEventListener('click', async () => {
  if (wallet) { try { await (await activeProvider())?.disconnect?.(); } catch { /* ignore */ } wallet = null; wProv = null; store.set('rot-wallet', null); paintWallet(); toast('Disconnected'); updateBurnBtn(); return; }
  openWalletModal();
});
addEventListener('load', async () => {
  if (!wallet) return paintWallet();
  const def = walletDef(wallet.id); const prov = def?.get();
  if (!prov) { wallet = null; store.set('rot-wallet', null); return paintWallet(); }
  try { const r = await prov.connect({ onlyIfTrusted: true }); wallet = { addr: (r?.publicKey || prov.publicKey).toString(), id: def.id }; wProv = prov; bindProvider(prov); }
  catch { wallet = null; store.set('rot-wallet', null); }
  paintWallet(); updateBurnBtn();
});
paintWallet();

/* ---------------- home ---------------- */
let homeInit = false, chipT;
const timeAgo = ms => { const d = Date.now() - ms; const m = Math.floor(d / 6e4); if (m < 60) return `${Math.max(1, m)}m ago`; const h = Math.floor(m / 60); if (h < 48) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; };
function countUp(el, to, fmt = v => String(Math.round(v))) {
  if (REDUCED || !isFinite(to)) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 1600;
  const step = now => { const t = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - t, 4); el.textContent = fmt(to * e); if (t < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
let revealIO = null;
function observeReveals() {
  const els = $$('.page.on .reveal:not(.in)');
  if (REDUCED || !('IntersectionObserver' in window)) { els.forEach(e => { e.classList.add('in'); e.dispatchEvent(new Event('revealed')); }); return; }
  revealIO ||= new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); e.target.dispatchEvent(new Event('revealed')); } }), { threshold: .12, rootMargin: '0px 0px -6% 0px' });
  els.forEach(e => revealIO.observe(e));
}
async function initHome() {
  observeReveals();
  if (homeInit) return;
  homeInit = true;
  initScene('home', '#homeCanvas', '#homeScene', '#homeSvg').then(() => { onScroll(); paintStage(Math.max(homeStage, 0)); scenes.home?.svgStage?.(Math.max(homeStage, 0)); });
  Promise.all([loadLedger(), loadRounds().catch(() => ({ rounds: new Map(), index: { rounds: [] } }))]).then(async ([ledger, { rounds }]) => {
    const d = await getRotDecimals();
    const counted = ledger.burns.filter(b => b.counted);
    const bags = counted.length, wallets = new Set(counted.map(b => b.wallet)).size;
    const paidRounds = [...rounds.values()].filter(r => r.status === 'paid').length;
    const paid = paidSum(rounds);
    const paidFmt = v => C.formatUnits(BigInt(Math.round(Number(v))), 0, 0);
    $('#cntBags').textContent = String(bags);
    if (paid > 0n) { $('#cntPaidWrap').hidden = false; $('#cntPaid').textContent = C.formatUnits(paid, d, 0); }
    // ticker
    const recent = ledger.burns.filter(b => b.counted).slice(0, 14);
    if (recent.length) {
      const item = b => `<span><b>${esc(b.symbol || short(b.mint))}</b><u>${esc(C.formatUnits(b.amount, b.decimals ?? 0, 0))}</u><i>${esc(short(b.wallet))}</i></span>`;
      const html = recent.map(item).join('');
      $('#tickerTr').innerHTML = html + html; $('#ticker').hidden = false;
    }
    // stats (count up when scrolled into view)
    if (bags) {
      $('#stats').hidden = false;
      const vals = { bags, wallets, rounds: paidRounds, paid: Number(C.formatUnits(paid, d, 0).replace(/,/g, '')) };
      const stats = $$('.stat');
      stats.forEach(st => { const b = st.querySelector('b'); b.textContent = '0'; st.addEventListener('revealed', () => countUp(b, vals[b.dataset.count], b.dataset.count === 'paid' ? (v => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)) : (v => Math.round(v).toLocaleString('en-US'))), { once: true }); });
      observeReveals();
      stats.forEach(st => { if (st.classList.contains('in')) st.dispatchEvent(new Event('revealed')); });
      if (!paidRounds) $('.stat:nth-child(3), .stat:nth-child(4)')?.setAttribute('hidden', '');
    }
    // feed
    const latest = ledger.burns.filter(b => b.counted).slice(0, 6);
    if (latest.length) {
      $('#feed').innerHTML = latest.map((b, i) => `<a class="fc reveal" style="--d:${i * 0.07}s" href="#/ledger/burns"><b>${esc(b.symbol || short(b.mint))}</b><span class="am">${esc(C.formatUnits(b.amount, b.decimals ?? 0, 0))}</span><div class="meta"><span class="st ${b.counted ? '' : 'no'}">${b.counted ? 'Counted' : esc(REASON_LABEL[b.reason] || 'Not counted')}</span><span class="num">${esc(short(b.wallet))}  ·  ${esc(timeAgo(b.time))}</span></div></a>`).join('');
      $('#feedSec').hidden = false; observeReveals();
    }
  }).catch(() => {});
  if (CFG.roundStart) {
    const tick = () => { const n = currentRound(); const b = n && C.roundBounds(n, CFG.roundStart, CFG.roundLengthDays); const chip = $('#roundChip'); if (!b) { chip.hidden = true; return; } chip.hidden = false; chip.textContent = `Round ${n}  ·  ends in ${dur(b.end - Date.now())}`; };
    tick(); chipT = setInterval(tick, 30000);
  }
  if (live) tokenFacts();
}
async function tokenFacts() {
  $('#tokenFacts').hidden = false;
  $('#tfCa').textContent = 'Contract  ·  ' + short(CFG.ca);
  $('#tfChart').href = 'https://dexscreener.com/solana/' + CFG.ca; $('#tfExp').href = explorerAddr(CFG.ca);
  $('#tfCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(CFG.ca); toast('Contract copied'); } catch { toast('Link copied'.replace('Link', 'Contract')); } });
  const row = (id, label, v) => { $(id).textContent = `${label}  ·  ${v}`; };
  try { const m = await readMint(CFG.ca); row('#tfMint', 'Mint authority', m.mintAuthority === null ? 'Renounced' : 'Active'); row('#tfFreeze', 'Freeze authority', m.freezeAuthority === null ? 'Renounced' : 'Active'); }
  catch { row('#tfMint', 'Mint authority', "Couldn't read"); row('#tfFreeze', 'Freeze authority', "Couldn't read"); }
}

/* ---------------- bin: scan ---------------- */
const STATUS_LABEL = { dead: 'Looks dead', alive: 'Looks alive', unknown: 'Unclear' };
const whyText = c => ({ 'no-pair': 'No pair found.', 'low-liquidity': `Liquidity under ${CFG.minLiquidityUsd} USD.`, 'no-trades': 'No trades in the last 24 hours.', alive: 'Has a pair with liquidity and recent trades.', failed: "Market data didn't load. Check it yourself." }[c] || '');
const COUNT_LABEL = { yes: 'Should count', no: "Won't count", unsure: "We'll see" };
const countText = (v, r) => v === 'yes' ? 'Listed before, old enough, looks dead.' : v === 'unsure' ? "Can't tell yet. Final checks run when the round is built." : ({
  'never-listed': 'Never had a pair.', 'pair-too-new': `Pair is under ${CFG.minPairAgeDays} days old.`, 'over-round-cap': `Over the ${CFG.maxMintsPerRound} token cap for this round.`,
  'already-counted': 'Already burned from this wallet.', 'looks-alive': 'Looks alive.', blocklisted: 'Excluded from counting.', 'created-by-wallet': 'Created or controlled by this wallet.'
}[r] || '');
let scan = null; // { addr, tokens: [...], empties: [...] }
let scanning = false;
function setStatus(t) { $('#scanStatus').textContent = t; }
function rpcToast(e) {
  toast(e?.offline ? "You're offline. Reconnect and try again." : e?.rate ? 'The network is busy. Wait a few seconds and try again.' : "Couldn't read that wallet. Try again.");
  // Free public RPCs often refuse browser origins or the token-account call. Say so instead of guessing.
  if (e?.refused) setTimeout(() => setStatus('This RPC endpoint refuses wallet reads. Set a different one in ROT_CONFIG.rpc.'), 50);
}

function useAddress(addr, pasted) {
  state.addr = addr; state.pasted = pasted;
  $('#addr').value = addr;
  if (route.cur === 'bin') runScan(addr);
}
$('#readForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#addr').value.trim();
  if (!C.isAddress(v)) { toast("That doesn't look like a Solana address."); return; }
  useAddress(v, !(wallet && wallet.addr === v));
});

async function runScan(addr) {
  if (scanning) return; scanning = true;
  $('#scanOut').hidden = true; scan = null; renderClose(); renderYourRot(addr);
  try {
    setStatus('Reading your tokens…');
    let accts = [];
    for (const prog of [C.TOKEN_PROGRAM, C.TOKEN_2022_PROGRAM]) {
      const r = await rpc('getTokenAccountsByOwner', [addr, { programId: prog }, { encoding: 'jsonParsed' }]);
      accts = accts.concat(C.parseTokenAccounts(r.value, prog));
    }
    const empties = C.emptyAccounts(accts);
    const full = accts.filter(a => BigInt(a.amount) > 0n);
    const byMint = new Map();
    for (const a of full) { const t = byMint.get(a.mint) || { mint: a.mint, decimals: a.decimals, accounts: [], total: 0n }; t.accounts.push(a); t.total += BigInt(a.amount); byMint.set(a.mint, t); }
    const tokens = [...byMint.values()];
    scan = { addr, tokens, empties, accts };
    renderClose();
    if (!tokens.length) { setStatus('No tokens in this wallet. Nothing to rot.'); return; }
    let failed = false;
    const market = await marketFor(tokens.map(t => t.mint), (d, n) => setStatus(`Checking ${d} of ${n} tokens…`));
    const [ledger, block] = await Promise.all([loadLedger().catch(() => ({ burns: [] })), loadBlock()]);
    const n = currentRound();
    const everCounted = new Set(ledger.burns.filter(b => b.counted && b.wallet === addr).map(b => b.mint));
    const roundUsed = n ? ledger.burns.filter(b => b.counted && b.wallet === addr && C.roundNumberAt(b.time, CFG.roundStart, CFG.roundLengthDays) === n).length : 0;
    const exclude = [C.WSOL, C.USDC, C.USDT, CFG.ca].filter(Boolean);
    let used = roundUsed;
    for (const t of tokens) {
      t.pairs = market.get(t.mint); if (t.pairs == null) failed = true;
      t.cls = C.classifyToken(t.pairs, CFG);
      const bp = (t.pairs || []).find(p => p.baseToken?.address === t.mint)?.baseToken;
      t.symbol = bp?.symbol || ''; t.name = bp?.name || '';
    }
    // authorities for tokens that would otherwise count (created-by-wallet rule), batched
    const cand = tokens.filter(t => t.cls.status === 'dead');
    const auth = new Map();
    try {
      for (const ch of C.chunk(cand.map(t => t.mint), 100)) {
        const r = await rpc('getMultipleAccounts', [ch, { encoding: 'jsonParsed' }]);
        r.value.forEach((v, i) => { const inf = v?.data?.parsed?.info; if (inf) auth.set(ch[i], { mintAuthority: inf.mintAuthority ?? null, freezeAuthority: inf.freezeAuthority ?? null }); });
      }
    } catch { /* prediction falls back to "final checks run when the round is built" */ }
    const ordered = [...tokens].sort((a, b) => ({ dead: 0, unknown: 1, alive: 2 }[a.cls.status] - { dead: 0, unknown: 1, alive: 2 }[b.cls.status]) || (a.symbol || 'zzz').localeCompare(b.symbol || 'zzz'));
    for (const t of ordered) {
      let p = C.predictCount(t, { wallet: addr, now: Date.now(), everCounted, roundUsed: used, blocklist: block, excludeMints: exclude }, CFG);
      const a = auth.get(t.mint);
      if (p.verdict === 'yes' && a && (a.mintAuthority === addr || a.freezeAuthority === addr)) p = { verdict: 'no', reason: 'created-by-wallet' };
      if (p.verdict === 'yes') used++;
      t.pred = p;
    }
    scan.tokens = ordered;
    renderTokens();
    const dead = ordered.filter(t => t.cls.status === 'dead').length, alive = ordered.filter(t => t.cls.status === 'alive').length, unk = ordered.length - dead - alive;
    setStatus(dead === 0 && unk === 0 ? 'Nothing here looks dead. Your bags are all still breathing.' : `${dead} look dead, ${alive} look alive, ${unk} unclear.`);
    if (failed) toast("Market data didn't load. Statuses may be unclear.");
  } catch (e) { setStatus('Connect a wallet or paste an address to start.'); rpcToast(e); }
  finally { scanning = false; }
}

function renderTokens() {
  const rows = scan.tokens.map((t, i) => {
    const bal = C.formatUnits(t.total, t.decimals, 4);
    return `<tr>
      <td data-l="Select"><input type="checkbox" data-i="${i}" aria-label="Select ${esc(t.symbol || short(t.mint))}"></td>
      <td data-l="Token" class="tok"><b>${esc(t.symbol || short(t.mint))}</b><i>${esc(t.name)}${t.name ? '  ·  ' : ''}${esc(short(t.mint))}</i></td>
      <td data-l="Balance">${esc(bal)}</td>
      <td data-l="Status"><span class="st ${t.cls.status === 'dead' ? '' : 'no'}">${STATUS_LABEL[t.cls.status]}</span><span class="why">${esc(whyText(t.cls.why))}</span></td>
      <td data-l="Counts?"><span class="st ${t.pred.verdict === 'yes' ? '' : 'no'}">${COUNT_LABEL[t.pred.verdict]}</span><span class="why">${esc(countText(t.pred.verdict, t.pred.reason))}</span></td></tr>`;
  }).join('');
  $('#tokBody').innerHTML = rows;
  $('#scanOut').hidden = false; updateSel();
}
$('#tokBody').addEventListener('change', () => { Sound.tick(); updateSel(); });
$('#selAll').addEventListener('click', () => { $$('#tokBody input').forEach(cb => { cb.checked = scan.tokens[+cb.dataset.i].pred.verdict === 'yes'; }); updateSel(); });
const selected = () => (scan ? $$('#tokBody input:checked').map(cb => scan.tokens[+cb.dataset.i]) : []);
function updateSel() { $('#selCount').textContent = `${selected().length} selected`; updateBurnBtn(); }
function updateBurnBtn() {
  const b = $('#burnBtn'), n = selected().length;
  const owned = scan && wallet && wallet.addr === scan.addr;
  if (!CFG.burnEnabled) { b.disabled = true; b.textContent = 'Burning opens at launch'; return; }
  b.disabled = false;
  b.textContent = !n ? 'Pick a bag to burn' : (!owned ? 'Connect this wallet to burn' : `Burn ${C.plural(n, 'bag')}`);
  b.setAttribute('aria-disabled', !n);
}

/* ---------------- bin: close empty accounts panel ---------------- */
function renderClose() {
  const b = $('#closeBtn'), n = scan ? scan.empties.length : 0;
  const lam = scan ? C.sumRefundable(scan.accts) : 0n;
  $('#closeNote').hidden = !n;
  if (!scan) { $('#closeSum').textContent = ''; b.textContent = 'No empty accounts'; b.disabled = true; return; }
  if (!n) { $('#closeSum').textContent = 'No empty accounts. Your wallet is already tidy.'; b.textContent = 'No empty accounts'; b.disabled = true; return; }
  $('#closeSum').textContent = `${C.plural(n, 'empty account')}  ·  ${C.formatUnits(lam, 9, 6)} SOL refundable`;
  if (!CFG.burnEnabled) { b.textContent = 'Closing opens at launch'; b.disabled = true; } else { b.textContent = `Close ${C.plural(n, 'account')}`; b.disabled = false; }
}

/* ---------------- bin: your rot ---------------- */
async function renderYourRot(addr) {
  const box = $('#rotPanel'); box.hidden = !addr; if (!addr) return;
  try {
    const [ledger, { rounds }] = await Promise.all([loadLedger(), loadRounds()]);
    const n = currentRound();
    const prev = n > 1 ? rounds.get(n - 1) : null;
    const pts = n ? C.roundPoints(ledger, n, CFG, prev?.carriedPoints || []) : new Map();
    const mine = pts.get(addr) || 0, total = [...pts.values()].reduce((a, b) => a + b, 0);
    const all = C.allTimePoints(ledger).get(addr) || 0;
    const empty = !mine && !all;
    $('#rotEmpty').hidden = !empty; $('#rotL1').hidden = empty; $('#rotL2').hidden = empty;
    if (!empty) {
      const d = await getRotDecimals();
      $('#rotL1').textContent = `${C.plural(mine, 'point')} this round  ·  ${pct(mine, total)} of all points`;
      $('#rotL2').textContent = `${C.plural(all, 'point')} all time  ·  ${C.formatUnits(paidSum(rounds, addr), d)} $ROT received in past rounds`;
    }
  } catch { $('#rotEmpty').hidden = false; $('#rotL1').hidden = true; $('#rotL2').hidden = true; }
}

/* ---------------- bin init ---------------- */
let binInit = false;
async function initBin() {
  if (!binInit) {
    binInit = true;
    initScene('bin', '#binCanvas', '#binScene', '#binSvg').then(s => { binShowStage(); });
  }
  const seg = route.seg;
  if (seg[1] === 'report') {
    const n = Number(seg[2]), a = seg[3];
    if (Number.isInteger(n) && n > 0 && n < 100000 && C.isAddress(a)) showReport(n, a, false);
  }
  if (!scan && !scanning) {
    if (wallet) useAddress(wallet.addr, false);
    else if (state.addr) runScan(state.addr);
  }
}
let binStage = 0;
function binShowStage() { const s = scenes.bin; if (s?.svgStage) s.svgStage(binStage); }
function binJump() {
  binStage = Math.min(4, binStage + 1);
  const to = [0, .27, .52, .77, .985][binStage];
  scenes.bin?.tween?.(to, 1600); scenes.bin?.svgStage?.(binStage); binShowStage();
}

/* ---------------- burn + close transactions ---------------- */
let W3 = null;
async function loadWeb3() {
  if (W3) return W3;
  if (!window.solanaWeb3) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = './vendor/web3.iife.min.js'; s.onload = res; s.onerror = () => rej(new Error('web3 load')); document.head.appendChild(s); });
  return (W3 = window.solanaWeb3);
}
let pvCtx = null;
function pvCancel() { if (!pvCtx || pvCtx.busy) return; closeModal($('#pv')); pvCtx = null; }
$('#pvBack').addEventListener('click', pvCancel);
$('#pv').addEventListener('click', e => { if (e.target.id === 'pv') pvCancel(); });

async function startAction(kind) {
  const isBurn = kind === 'burn';
  if (!CFG.burnEnabled) return;
  if (!wallet) { openWalletModal(); return; }
  if (!scan || wallet.addr !== scan.addr) { toast(isBurn ? 'Connect this wallet to burn' : 'Connect this wallet to burn'); openWalletModal(); return; }
  if (isBurn && !C.isAddress(CFG.binAddress)) { toast("The bin isn't set up yet. Burning stays closed."); return; }
  let items = [], lines = [];
  if (isBurn) {
    const sel = selected(); if (!sel.length) return;
    for (const t of sel) { for (const a of t.accounts) items.push({ ...a, mint: t.mint }); lines.push(`${C.formatUnits(t.total, t.decimals, 6)} ${t.symbol || 'unnamed'}  ·  ${short(t.mint)}`); }
  } else {
    items = scan.empties.map(a => ({ ...a }));
    lines = scan.empties.map(a => `${scan.tokens.find(t => t.mint === a.mint)?.symbol || 'unnamed'}  ·  ${short(a.mint)}  ·  ${C.formatUnits(a.lamports, 9, 6)} SOL`);
  }
  $('#pvH').textContent = isBurn ? "You're about to burn" : "You're about to close";
  $('#pvList').innerHTML = lines.map(l => `<li>${esc(l)}</li>`).join('');
  $('#pvNotes').innerHTML = (isBurn
    ? ['This transaction only burns the tokens above and closes their empty accounts.', 'Closing an account refunds its rent to you, about 0.002 SOL for a standard token account.', "Burned tokens can't be recovered.", 'The transaction also carries the public bin address and a short note, so your burn shows up on the ledger.', "Points are decided when the round is built. A burn that doesn't pass the checks stays on the ledger with a reason, and gets no points."]
    : ['This transaction only closes the empty accounts listed. Nothing is burned. The rent refund goes to your wallet.']).map(n => `<li>${esc(n)}</li>`).join('');
  $('#pvErr').textContent = ''; $('#pvState').textContent = '';
  const ok = $('#pvOk'); ok.disabled = true; ok.textContent = 'Sign in your wallet';
  pvCtx = { kind, items, busy: false }; openModal($('#pv'));
  // simulate before the user can sign
  try {
    const W = await loadWeb3();
    const conn = new W.Connection(CFG.rpc, 'confirmed');
    const owner = new W.PublicKey(scan.addr);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const txs = buildTxs(W, owner, items, kind, blockhash, CFG.binAddress);
    for (const { tx } of txs) {
      const sim = await conn.simulateTransaction(tx);
      if (sim.value.err) throw new Error('simulation: ' + JSON.stringify(sim.value.err));
    }
    pvCtx.txs = txs; pvCtx.conn = conn; pvCtx.W = W; pvCtx.lastValidBlockHeight = lastValidBlockHeight; ok.disabled = false;
  } catch (e) {
    $('#pvErr').textContent = isBurn ? "The burn didn't go through. Your tokens are untouched." : "The close didn't go through. Your accounts are untouched.";
    $('#pvState').textContent = String(e.message || e).slice(0, 200);
  }
}
$('#pvOk').addEventListener('click', async () => {
  const c = pvCtx; if (!c || c.busy || !c.txs) return;
  const isBurn = c.kind === 'burn'; c.busy = true; $('#pvOk').disabled = true; $('#pvBack').disabled = true;
  try {
    const prov = await activeProvider(); if (!prov) throw Object.assign(new Error('no provider'), { code: 4001 });
    $('#pvState').textContent = 'Waiting for your wallet…';
    const raw = c.txs.map(x => x.tx);
    let signed;
    if (prov.signAllTransactions && raw.length > 1) signed = await prov.signAllTransactions(raw);
    else { signed = []; for (const t of raw) signed.push(await prov.signTransaction(t)); }
    $('#pvState').textContent = isBurn ? 'Burn sent. Waiting for confirmation…' : 'Sent. Waiting for confirmation…';
    for (const s of signed) {
      const sig = await c.conn.sendRawTransaction(s.serialize());
      const r = await c.conn.confirmTransaction({ signature: sig, blockhash: raw[0].recentBlockhash, lastValidBlockHeight: c.lastValidBlockHeight }, 'confirmed');
      if (r.value.err) throw new Error('failed on chain');
    }
    closeModal($('#pv'));
    const n = isBurn ? new Set(c.items.map(a => a.mint)).size : c.items.length;
    if (isBurn) { toast("Burned. It's rotting now."); Sound.rot(); binJump(); showReport(n, scan.addr, true); }
    else toast(`Closed ${C.plural(n, 'account')}. ${C.formatUnits(c.items.reduce((s, a) => s + BigInt(a.lamports), 0n), 9, 6)} SOL refunded.`);
    pvCtx = null;
    setTimeout(() => runScan(scan.addr), 2500); scan = null;
  } catch (e) {
    c.busy = false; $('#pvBack').disabled = false;
    const rejected = e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || '');
    closeModal($('#pv')); pvCtx = null;
    toast(rejected ? (isBurn ? 'Burn cancelled. Nothing was sent.' : 'Cancelled. Nothing was sent.') : (isBurn ? "The burn didn't go through. Your tokens are untouched." : "The close didn't go through. Your accounts are untouched."));
  }
});
$('#burnBtn').addEventListener('click', () => {
  if (!CFG.burnEnabled) return;
  if (!selected().length) return;
  if (!C.isAddress(CFG.binAddress)) { toast("The bin isn't set up yet. Burning stays closed."); return; }
  startAction('burn');
});
$('#closeBtn').addEventListener('click', () => startAction('close'));

/* ---------------- rot report card ---------------- */
let reportMeta = null;
async function drawReport(n, addr) {
  const cv = $('#reportCanvas'), g = cv.getContext('2d'), W = 1200, H = 630;
  try { await document.fonts.load('600 64px Fraunces'); await document.fonts.load('400 28px "JetBrains Mono"'); } catch { /* fall back to system fonts */ }
  g.fillStyle = '#0F1D17'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#16281F'; g.fillRect(0, H - 110, W, 110);
  g.strokeStyle = 'rgba(143,181,163,.35)'; g.lineWidth = 2; g.strokeRect(24, 24, W - 48, H - 48);
  const img = new Image(); img.src = './assets/mark.png';
  await new Promise(r => { img.onload = r; img.onerror = r; });
  if (img.naturalWidth) {
    const t = document.createElement('canvas'); t.width = t.height = 220; const tg = t.getContext('2d');
    tg.drawImage(img, 0, 0, 220, 220); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#E9E5D2'; tg.fillRect(0, 0, 220, 220);
    g.drawImage(t, W - 300, 70, 220, 220);
  }
  g.fillStyle = '#6FC3A3'; g.font = '400 26px "JetBrains Mono", monospace'; g.fillText('rot', 70, 90);
  g.fillStyle = '#E9E5D2'; g.font = '600 96px Fraunces, Georgia, serif'; g.fillText('Rot report', 70, 230);
  g.font = 'italic 500 50px Fraunces, Georgia, serif'; g.fillStyle = '#6FC3A3';
  g.fillText(`${C.plural(n, 'bag')} rotted by ${short(addr)}`, 70, 340);
  g.fillStyle = '#E9E5D2'; g.font = '400 30px Fraunces, Georgia, serif'; g.fillText('Dead bags rot. Rot feeds the next.', 70, 410);
  g.fillStyle = '#8FB5A3'; g.font = '400 22px "JetBrains Mono", monospace';
  g.fillText('It shows up on the ledger once the next update is published.', 70, H - 52);
}
async function showReport(n, addr, fresh) {
  reportMeta = { n, addr };
  $('#reportBox').hidden = false;
  await drawReport(n, addr);
  if (fresh) $('#reportBox').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
}
const reportLink = () => location.href.split('#')[0] + `#/bin/report/${reportMeta.n}/${reportMeta.addr}`;
$('#repDl').addEventListener('click', () => { const a = document.createElement('a'); a.href = $('#reportCanvas').toDataURL('image/png'); a.download = 'rot-report.png'; a.click(); toast('Card downloaded'); });
$('#repCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(reportLink()); toast('Link copied'); } catch { prompt('Copy this link', reportLink()); } });
$('#repShare').addEventListener('click', async () => {
  if (navigator.share) { try { await navigator.share({ title: 'Rot report', url: reportLink() }); return; } catch { return; } }
  try { await navigator.clipboard.writeText(reportLink()); toast('Link copied'); } catch { /* ignore */ }
});

/* ---------------- ledger ---------------- */
const TABS = ['round', 'burns', 'wallets', 'rounds'];
const REASON_LABEL = { 'never-listed': 'Never had a pair', 'pair-too-new': 'Pair too new', 'created-by-wallet': 'Created by this wallet', 'over-round-cap': 'Over the round cap', 'looks-alive': 'Looks alive', blocklisted: 'Blocklisted', 'not-full-burn': 'Not a full burn', 'already-counted': 'Already counted for this wallet' };
const STATUS_ROUND = { open: 'Open', closed: 'Closed', challenge: 'In challenge window', paid: 'Paid' };
const txLink = s => (SIG_RE.test(s || '') ? `<a href="${esc(explorerTx(s))}" target="_blank" rel="noopener">View transaction</a>` : (s ? `<span class="muted">${esc(short(s))}</span>` : '<span class="muted">Not sent</span>'));
const errBox = msg => `<div class="empty"><b>${esc(msg)}</b><p></p><button class="btn btn--ghost" type="button" id="retryBtn">Retry</button></div>`;
let ledgerToken = 0;
async function renderLedger() {
  const seg = route.seg; const tok = ++ledgerToken;
  const isRound = seg[1] === 'round' && !!seg[2];
  const tab = isRound ? 'rounds' : (TABS.includes(seg[1]) ? seg[1] : 'round');
  $$('#ledgerTabs [role=tab]').forEach(b => { const on = b.dataset.t === tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  $('#lv').setAttribute('aria-labelledby', 'tab-' + tab);
  const out = $('#lv'); out.innerHTML = '<p class="muted">…</p>';
  const set = html => { if (tok === ledgerToken) out.innerHTML = html; };
  try {
    if (isRound) return set(await roundDetail(Number(seg[2])));
    if (tab === 'round') return set(await tabRound());
    if (tab === 'burns') { set(await tabBurns()); if (tok === ledgerToken) wireBurns(); return; }
    if (tab === 'wallets') return set(await tabWallets());
    return set(await tabRounds());
  } catch (e) {
    set(errBox(tab === 'burns' || tab === 'wallets' ? "Couldn't load the ledger. Try again in a minute." : "Couldn't load the round data. Try again in a minute."));
    $('#retryBtn')?.addEventListener('click', () => { ledgerP = roundsP = null; renderLedger(); });
  }
}
$('#ledgerTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) location.hash = '#/ledger/' + b.dataset.t; });
$('#ledgerTabs').addEventListener('keydown', e => {
  const i = TABS.indexOf(document.activeElement?.dataset?.t); if (i < 0 || !/Arrow(Left|Right)/.test(e.key)) return;
  const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]; location.hash = '#/ledger/' + n; setTimeout(() => $('#tab-' + n).focus(), 50);
});

async function tabRound() {
  const n = currentRound();
  if (!CFG.roundStart || !n) return `<p class="card">The first round starts when the token is live.</p>`;
  const [ledger, { rounds }] = await Promise.all([loadLedger(), loadRounds()]);
  const b = C.roundBounds(n, CFG.roundStart, CFG.roundLengthDays);
  const prev = n > 1 ? rounds.get(n - 1) : null;
  const pts = C.roundPoints(ledger, n, CFG, prev?.carriedPoints || []);
  const total = [...pts.values()].reduce((a, c) => a + c, 0);
  const ranked = [...pts.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0])).slice(0, 10);
  let h = `<h3 style="font-size:36px">Round ${n}</h3><div class="kv"><div>Ends in ${esc(dur(b.end - Date.now()))}</div>`;
  if (prev && prev.status === 'challenge' && Date.now() < Date.parse(prev.challengeEndsAt)) h += `<div>Round ${n - 1} is closed. Challenge window ends in ${esc(dur(Date.parse(prev.challengeEndsAt) - Date.now()))}.</div>`;
  h += '</div>';
  const done = Math.min(1, Math.max(0, (Date.now() - b.start) / (b.end - b.start)));
  h += `<div class="prog" role="progressbar" aria-label="Round progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(done * 100)}"><i style="width:${(done * 100).toFixed(1)}%"></i></div>`;
  if (C.isAddress(CFG.potWallet)) {
    let sol = "Couldn't read";
    try { sol = C.lamportsToSol((await rpc('getBalance', [CFG.potWallet])).value, 4) + ' SOL'; } catch { /* shown as unreadable */ }
    h += `<p>Pot wallet  ·  ${esc(sol)}  ·  <a href="${esc(explorerAddr(CFG.potWallet))}" target="_blank" rel="noopener">${esc(short(CFG.potWallet))}</a></p><p class="small">Fees collect here. When the round is paid, the pot buys $ROT.</p>`;
  }
  h += `<p style="margin-top:14px">${C.plural(total, 'point')} from ${C.plural(pts.size, 'wallet')}</p>`;
  if (!total) return h + '<p class="muted">No points yet. The first bag decides the whole round.</p>';
  h += `<h4 style="font-size:24px;margin:24px 0 8px">Most rot this round</h4><div class="tw"><table class="stack"><thead><tr><th>Rank</th><th>Wallet</th><th>Points</th><th>Share</th></tr></thead><tbody>${ranked.map(([w, p], i) => `<tr${rowMe(w)}><td data-l="Rank">${i + 1}</td><td data-l="Wallet">${walletLink(w)}</td><td data-l="Points">${p}</td><td data-l="Share"><span class="sh">${esc(pct(p, total))}</span><span class="sb" style="--w:${(p / total * 100).toFixed(1)}%"></span></td></tr>`).join('')}</tbody></table></div>`;
  return h;
}
async function tabBurns() {
  const l = await loadLedger();
  if (!l.burns.length) return `<div class="empty"><b>Nothing has rotted yet.</b><p>The first bag goes in here.</p><a class="btn" href="#/bin">Open the bin</a></div>`;
  return `<div class="tools"><input id="burnQ" type="search" placeholder="Search wallet or token" aria-label="Search burns" autocomplete="off" spellcheck="false"><label class="chk"><input type="checkbox" id="burnCounted"> Counted only</label><span class="muted" id="burnN" aria-live="polite"></span></div>
  <div class="tw"><table class="stack"><thead><tr><th>When</th><th>Wallet</th><th>Token</th><th>Amount</th><th>Counted</th><th>Transaction</th></tr></thead><tbody id="burnBody"></tbody></table></div>
  <div class="bar"><button class="btn btn--ghost noar" type="button" id="burnMore" hidden>Show more</button></div>`;
}
function wireBurns() {
  loadLedger().then(l => {
    const body = $('#burnBody'); if (!body) return;
    const all = [...l.burns].sort((a, b) => b.time - a.time);
    let shown = 40, q = '', only = false;
    const row = b => `<tr${rowMe(b.wallet)}>
      <td data-l="When">${esc(when(b.time))}</td><td data-l="Wallet">${walletLink(b.wallet)}</td>
      <td data-l="Token">${esc(b.symbol || short(b.mint))}</td><td data-l="Amount">${esc(C.formatUnits(b.amount, b.decimals ?? 0, 4))}</td>
      <td data-l="Counted"><span class="st ${b.counted ? '' : 'no'}">${b.counted ? 'Counted' : 'Not counted'}</span>${b.counted ? '' : `<span class="why">${esc(REASON_LABEL[b.reason] || b.reason || '')}</span>`}</td>
      <td data-l="Transaction">${txLink(b.sig)}</td></tr>`;
    const draw = () => {
      const f = all.filter(b => (!only || b.counted) && (!q || (b.symbol || '').toLowerCase().includes(q) || b.wallet.toLowerCase().includes(q) || b.mint.toLowerCase().includes(q)));
      body.innerHTML = f.length ? f.slice(0, shown).map(row).join('') : '<tr><td colspan="6" class="muted">Nothing matches.</td></tr>';
      $('#burnN').textContent = f.length === all.length ? '' : `${f.length} of ${all.length}`;
      $('#burnMore').hidden = shown >= f.length;
    };
    $('#burnQ').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); shown = 40; draw(); });
    $('#burnCounted').addEventListener('change', e => { only = e.target.checked; shown = 40; draw(); });
    $('#burnMore').addEventListener('click', () => { shown += 60; draw(); });
    draw();
  }).catch(() => {});
}
async function tabWallets() {
  const [l, { rounds }] = await Promise.all([loadLedger(), loadRounds().catch(() => ({ rounds: new Map() }))]);
  const d = await getRotDecimals();
  const m = new Map();
  for (const b of l.burns) { const w = m.get(b.wallet) || { tokens: new Set(), points: 0 }; w.tokens.add(b.mint); if (b.counted) w.points++; m.set(b.wallet, w); }
  if (!m.size) return `<div class="empty"><b>Nothing has rotted yet.</b><p>The first bag goes in here.</p><a class="btn" href="#/bin">Open the bin</a></div>`;
  const rows = [...m.entries()].sort((a, b) => b[1].points - a[1].points || b[1].tokens.size - a[1].tokens.size || a[0].localeCompare(b[0])).slice(0, 500)
    .map(([w, v], i) => `<tr${rowMe(w)}><td data-l="Rank">${i + 1}</td><td data-l="Wallet">${walletLink(w)}</td><td data-l="Tokens rotted">${v.tokens.size}</td><td data-l="Points">${v.points}</td><td data-l="Received">${esc(C.formatUnits(paidSum(rounds, w), d))}</td></tr>`).join('');
  return `<div class="tw"><table class="stack"><thead><tr><th>Rank</th><th>Wallet</th><th>Tokens rotted</th><th>Points</th><th>Received</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small">Points are all-time. Received is the $ROT sent to the wallet in completed rounds.</p>`;
}
async function tabRounds() {
  const { index, rounds } = await loadRounds();
  if (!(index.rounds || []).length) return '<div class="empty"><b>No rounds have been paid yet.</b><p></p></div>';
  const rows = [...index.rounds].sort((a, b) => b.n - a.n).map(e => {
    const r = rounds.get(e.n);
    return `<tr><td data-l="Round">${e.n}  <span class="st">${esc(STATUS_ROUND[e.status] || e.status)}</span></td><td data-l="Dates">${esc(day(Date.parse(e.start)))} to ${esc(day(Date.parse(e.end)))}</td>
      <td data-l="Pot spent">${r ? esc(C.lamportsToSol(r.spentLamports, 4)) + ' SOL' : '—'}</td><td data-l="Wallets paid">${r ? r.payouts.filter(p => p.sig).length : '—'}</td><td data-l="Points">${r ? r.totalPoints : '—'}</td>
      <td data-l="Details"><a href="#/ledger/round/${+e.n}">View round</a></td></tr>`;
  }).join('');
  return `<div class="tw"><table class="stack"><thead><tr><th>Round</th><th>Dates</th><th>Pot spent</th><th>Wallets paid</th><th>Points</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
async function roundDetail(n) {
  const { index, rounds } = await loadRounds();
  const r = rounds.get(n), e = (index.rounds || []).find(x => x.n === n);
  if (!r || !e) return '<p class="muted">Nothing to see here.</p><p><a class="btn" href="#/ledger/rounds">Past rounds</a></p>';
  const d = await getRotDecimals();
  const sol = x => C.lamportsToSol(x, 4);
  let h = `<h3 style="font-size:36px">Round ${n}  <span class="st">${esc(STATUS_ROUND[e.status] || e.status)}</span></h3>
    <div class="kv"><div>Pot spent: ${esc(sol(r.spentLamports))} SOL</div><div>$ROT bought: ${esc(r.rotBoughtBase == null ? '—' : C.formatUnits(r.rotBoughtBase, d))}</div><div>Total points: ${r.totalPoints}</div><div>Wallets paid: ${r.payouts.filter(p => p.sig).length}</div><div>Carried to the next round: ${C.plural(r.carriedPoints.length, 'wallet')}</div></div>`;
  if (r.swapSigs?.length) h += `<ul class="rows"><li>Bought ${esc(C.formatUnits(r.rotBoughtBase ?? 0, d))} $ROT for ${esc(sol(r.spentLamports - (r.rentReserveLamports || 0)))} SOL  ·  ${r.swapSigs.map(txLink).join('  ·  ')}</li></ul>`;
  if (r.payouts.length) h += `<ul class="rows">${r.payouts.map(p => `<li>${walletLink(p.wallet)}  ·  ${C.plural(p.points, 'point')}  ·  ${esc(p.rotBase == null ? '—' : C.formatUnits(p.rotBase, d))} $ROT  ·  ${txLink(p.sig)}</li>`).join('')}</ul>`;
  if (r.carriedPoints.length) h += `<p class="small">Carried: ${r.carriedPoints.map(c => esc(short(c.wallet)) + ' (' + c.points + ')').join(', ')}</p>`;
  for (const x of r.removed || []) h += `<p class="small">Removed after the challenge window: ${esc(x.reason)}</p>`;
  return h + '<p style="margin-top:18px"><a href="#/ledger/rounds">Past rounds</a></p>';
}

/* ---------------- boot ---------------- */
addEventListener('offline', () => toast("You're offline. Reconnect and try again."));
const loader = $('#loader');
if (REDUCED) $('#loaderTxt').textContent = 'Loading…';
const hideLoader = () => loader.classList.add('off');
$('#loaderSkip').addEventListener('click', hideLoader);
setTimeout(() => loader.classList.add('skip-on'), 4000);
setTimeout(hideLoader, 5200);
route();
Promise.race([['rot', 'bin'].includes(route.cur) ? sceneMod() : null, sleep(2500)]).then(() => setTimeout(hideLoader, 350));
