// ROT core: pure functions shared by the site and the operator scripts.
// No network, no fs, no globals. Everything here is covered by test/*.test.mjs.

export const DAY_MS = 86400000;
export const HOUR_MS = 3600000;
export const REASONS = [
  'never-listed', 'pair-too-new', 'created-by-wallet', 'over-round-cap',
  'looks-alive', 'blocklisted', 'not-full-burn', 'already-counted'
];
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_TEXT = 'rot:v1';
export const WSOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

/* ---------- addresses ---------- */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Decode(s) {
  if (typeof s !== 'string' || !s.length) return null;
  const bytes = [0];
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < s.length && s[i] === '1'; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}
/** A Solana address is base58 and decodes to exactly 32 bytes. */
export function isAddress(s) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  const b = base58Decode(s);
  return !!b && b.length === 32;
}

/* ---------- number formatting (no floats for token amounts) ---------- */
export function formatUnits(base, decimals = 0, maxFrac = 4) {
  let n;
  try { n = BigInt(base ?? 0); } catch { return '0'; }
  const neg = n < 0n; if (neg) n = -n;
  const d = BigInt(10) ** BigInt(Math.max(0, decimals));
  const whole = n / d;
  let frac = (n % d).toString().padStart(Math.max(0, decimals), '0');
  frac = frac.slice(0, maxFrac).replace(/0+$/, '');
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + w + (frac ? '.' + frac : '');
}
export function lamportsToSol(l, maxFrac = 4) {
  return formatUnits(BigInt(Math.trunc(Number(l) || 0)), 9, maxFrac);
}
export const solToLamports = sol => BigInt(Math.round(Number(sol) * 1e9));

/* ---------- classification (site and ledger share the thresholds) ---------- */
function solPairs(pairs) {
  return (pairs || []).filter(p => !p.chainId || p.chainId === 'solana');
}
const liq = p => Number(p?.liquidity?.usd) || 0;
function traded24h(p) {
  const t = p?.txns?.h24;
  const tx = t ? (Number(t.buys) || 0) + (Number(t.sells) || 0) : 0;
  return tx > 0 || (Number(p?.volume?.h24) || 0) > 0;
}
/**
 * pairs: array of DexScreener pairs for this mint, [] when none exist,
 * or null when the market-data request failed.
 * Returns { status: 'dead'|'alive'|'unknown', why: 'no-pair'|'low-liquidity'|'no-trades'|'alive'|'failed' }.
 */
export function classifyToken(pairs, cfg) {
  if (pairs == null) return { status: 'unknown', why: 'failed' };
  const ps = solPairs(pairs);
  if (!ps.length) return { status: 'dead', why: 'no-pair' };
  const best = ps.reduce((a, b) => (liq(b) > liq(a) ? b : a));
  if (liq(best) < cfg.minLiquidityUsd) return { status: 'dead', why: 'low-liquidity' };
  if (!ps.some(p => liq(p) >= cfg.minLiquidityUsd && traded24h(p))) return { status: 'dead', why: 'no-trades' };
  return { status: 'alive', why: 'alive' };
}
export function earliestPairCreatedAt(pairs) {
  const ts = solPairs(pairs).map(p => Number(p.pairCreatedAt)).filter(n => n > 0);
  return ts.length ? Math.min(...ts) : null;
}

/* ---------- rounds ---------- */
export function roundBounds(n, roundStart, lengthDays) {
  const s0 = Date.parse(roundStart);
  if (!isFinite(s0) || n < 1) return null;
  const start = s0 + (n - 1) * lengthDays * DAY_MS;
  return { start, end: start + lengthDays * DAY_MS };
}
/** Round number containing ms, or 0 before round 1 or without a start date. */
export function roundNumberAt(ms, roundStart, lengthDays) {
  const s0 = Date.parse(roundStart);
  if (!isFinite(s0) || ms < s0) return 0;
  return Math.floor((ms - s0) / (lengthDays * DAY_MS)) + 1;
}

/* ---------- eligibility (the anti-farming rules, one function per rule) ---------- */
export const rules = {
  fullBurn: b => b.fullBurn === true,
  notExcluded: (mint, wallet, ctx) =>
    !(ctx.blocklist?.mints || []).includes(mint) &&
    !(ctx.blocklist?.wallets || []).includes(wallet) &&
    !(ctx.excludeMints || []).includes(mint),
  listedBefore: pairs => earliestPairCreatedAt(pairs) != null,
  oldEnough: (pairs, burnTime, minPairAgeDays) => {
    const c = earliestPairCreatedAt(pairs);
    return c != null && c <= burnTime - minPairAgeDays * DAY_MS;
  },
  looksDeadNow: (pairs, cfg) => classifyToken(pairs, cfg).status === 'dead',
  notCreatedByBurner: (wallet, auth) =>
    !!auth && auth.mintAuthority !== wallet && auth.freezeAuthority !== wallet && auth.earliestFeePayer !== wallet
};

/**
 * Decide whether one burn counts. Pure.
 * burn: { wallet, mint, time(ms), fullBurn }
 * info: { pairs: [] | null, auth: { mintAuthority, freezeAuthority, earliestFeePayer } | null }
 * state: { everCounted: Set("wallet:mint"), roundCounts: Map("wallet:round" -> n) }  (mutated only by applyEligibility)
 * Order of reasons: not-full-burn, blocklisted, never-listed, pair-too-new, looks-alive,
 * created-by-wallet, already-counted, over-round-cap.
 */
export function evaluateBurn(burn, info, state, cfg, ctx = {}) {
  const no = reason => ({ counted: false, reason });
  if (!rules.fullBurn(burn)) return no('not-full-burn');
  if (!rules.notExcluded(burn.mint, burn.wallet, ctx)) return no('blocklisted');
  if (!rules.listedBefore(info.pairs)) return no('never-listed');
  if (!rules.oldEnough(info.pairs, burn.time, cfg.minPairAgeDays)) return no('pair-too-new');
  if (!rules.looksDeadNow(info.pairs, cfg)) return no('looks-alive');
  if (!rules.notCreatedByBurner(burn.wallet, info.auth)) return no('created-by-wallet');
  if (state.everCounted.has(burn.wallet + ':' + burn.mint)) return no('already-counted');
  const n = roundNumberAt(burn.time, cfg.roundStart, cfg.roundLengthDays);
  const key = burn.wallet + ':' + n;
  if ((state.roundCounts.get(key) || 0) >= cfg.maxMintsPerRound) return no('over-round-cap');
  return { counted: true, reason: '' };
}

/** Walk burns oldest first; each gets counted/reason. Returns new array (input untouched). */
export function applyEligibility(burns, lookup, cfg, ctx = {}) {
  const state = { everCounted: new Set(), roundCounts: new Map() };
  const sorted = [...burns].sort((a, b) => a.time - b.time || String(a.sig).localeCompare(String(b.sig)));
  const out = sorted.map(b => {
    const info = lookup(b.mint) || { pairs: null, auth: null };
    const r = evaluateBurn(b, info, state, cfg, ctx);
    if (r.counted) {
      state.everCounted.add(b.wallet + ':' + b.mint);
      const k = b.wallet + ':' + roundNumberAt(b.time, cfg.roundStart, cfg.roundLengthDays);
      state.roundCounts.set(k, (state.roundCounts.get(k) || 0) + 1);
    }
    return { ...b, counted: r.counted, reason: r.reason };
  });
  return out;
}

/** What the site tells a user before they burn. Same rules, with unknowns marked. */
export function predictCount(token, ctx, cfg) {
  // token: { mint, pairs|null, cls }, ctx: { wallet, now, everCounted:Set(mint), roundUsed:number, blocklist, excludeMints }
  if (token.pairs == null) return { verdict: 'unsure', reason: 'unsure' };
  const mint = token.mint;
  if (!rules.notExcluded(mint, ctx.wallet, ctx)) return { verdict: 'no', reason: 'blocklisted' };
  if (!rules.listedBefore(token.pairs)) return { verdict: 'no', reason: 'never-listed' };
  if (!rules.oldEnough(token.pairs, ctx.now, cfg.minPairAgeDays)) return { verdict: 'no', reason: 'pair-too-new' };
  if (!rules.looksDeadNow(token.pairs, cfg)) return { verdict: 'no', reason: 'looks-alive' };
  if (ctx.everCounted?.has(mint)) return { verdict: 'no', reason: 'already-counted' };
  if ((ctx.roundUsed || 0) >= cfg.maxMintsPerRound) return { verdict: 'no', reason: 'over-round-cap' };
  return { verdict: 'yes', reason: 'ok' };
}

/* ---------- points ---------- */
/** Points per wallet for round n: counted burns in that round plus carried points. */
export function roundPoints(ledger, n, cfg, carried = []) {
  const m = new Map();
  for (const c of carried) m.set(c.wallet, (m.get(c.wallet) || 0) + c.points);
  for (const b of ledger.burns || []) {
    if (!b.counted) continue;
    if (roundNumberAt(b.time, cfg.roundStart, cfg.roundLengthDays) !== n) continue;
    m.set(b.wallet, (m.get(b.wallet) || 0) + 1);
  }
  return m;
}
export function allTimePoints(ledger) {
  const m = new Map();
  for (const b of ledger.burns || []) if (b.counted) m.set(b.wallet, (m.get(b.wallet) || 0) + 1);
  return m;
}

/* ---------- round build (money math in BigInt lamports) ---------- */
/**
 * input: { n, ledger, prevRound|null, balanceLamports, networkReserveLamports, rentLamports,
 *          hasTokenAccount: Set(wallet), now(ISO string for snapshotAt) }
 * Shares are floor(distributable * points / totalPoints) where distributable = pot - rentReserveAll,
 * and rentReserveAll covers one new token account for every wallet that holds points and has none.
 * That keeps spent <= pot even if everyone is payable.
 */
export function buildRoundData(input, cfg) {
  const { n, ledger, prevRound, balanceLamports, networkReserveLamports, rentLamports, hasTokenAccount, now } = input;
  const bounds = roundBounds(n, cfg.roundStart, cfg.roundLengthDays);
  const pts = roundPoints(ledger, n, cfg, prevRound?.carriedPoints || []);
  const total = [...pts.values()].reduce((a, b) => a + b, 0);
  const bal = BigInt(balanceLamports);
  const pot = bal > BigInt(networkReserveLamports) ? bal - BigInt(networkReserveLamports) : 0n;
  const challengeEndsAt = new Date(bounds.end + cfg.challengeHours * HOUR_MS).toISOString();
  const base = {
    n,
    start: new Date(bounds.start).toISOString(),
    end: new Date(bounds.end).toISOString(),
    snapshotAt: now,
    challengeEndsAt,
    potLamports: Number(pot),
    spentLamports: 0,
    rentReserveLamports: 0,
    swapSigs: [],
    rotBoughtBase: null,
    remainderBase: prevRound?.remainderBase ?? '0',
    totalPoints: total,
    payouts: [],
    carriedPoints: [],
    removed: [],
    status: 'challenge'
  };
  if (total === 0) return { ...base, remainderBase: base.remainderBase, status: 'paid', challengeEndsAt: base.end };

  const sorted = [...pts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const needAcct = w => !hasTokenAccount.has(w);
  const rentAll = BigInt(rentLamports) * BigInt(sorted.filter(([w]) => needAcct(w)).length);
  const distributable = pot > rentAll ? pot - rentAll : 0n;
  const min = solToLamports(cfg.minPayoutSol);
  const payouts = [], carried = [];
  let spent = 0n, rentUsed = 0n, sharesSum = 0n;
  for (const [wallet, points] of sorted) {
    const share = (distributable * BigInt(points)) / BigInt(total);
    sharesSum += share;
    if (share >= min && share > 0n) {
      payouts.push({ wallet, points, rotBase: null, sig: null });
      spent += share;
      if (needAcct(wallet)) rentUsed += BigInt(rentLamports);
    } else carried.push({ wallet, points });
  }
  const spentTotal = spent + rentUsed;
  const out = {
    ...base,
    spentLamports: Number(spentTotal),
    rentReserveLamports: Number(rentUsed),
    payouts,
    carriedPoints: carried
  };
  if (!payouts.length) { out.status = 'paid'; out.challengeEndsAt = base.end; out.spentLamports = 0; out.rentReserveLamports = 0; }
  // exposed for tests and the operator printout; not written to the round file
  Object.defineProperty(out, '_audit', {
    enumerable: false,
    value: { distributable, sharesSum, remainder: distributable - sharesSum, pot, rentAll }
  });
  return out;
}

/** Split bought $ROT among payable wallets by points. Integer base units, floor. */
export function splitRot(totalBase, payouts) {
  const total = BigInt(totalBase);
  const pts = payouts.reduce((a, p) => a + p.points, 0);
  if (!pts) return { amounts: [], remainder: total };
  const amounts = payouts.map(p => (total * BigInt(p.points)) / BigInt(pts));
  const remainder = total - amounts.reduce((a, b) => a + b, 0n);
  return { amounts, remainder };
}

/* ---------- burn parsing (jsonParsed getTransaction result) ---------- */
/**
 * Returns the real SPL burns in tx that reference binAddress, or [] if the tx failed or has none.
 * The token programs accept extra non-signer accounts on a single-owner burn. RPC jsonParsed then
 * labels the 3rd account "multisigAuthority" and lists the extras under "signers", so both shapes are read.
 */
export function parseBurns(tx, binAddress) {
  if (!tx || tx.meta?.err || !binAddress) return [];
  const msg = tx.transaction?.message; if (!msg) return [];
  const keys = (msg.accountKeys || []).map(k => (typeof k === 'string' ? { pubkey: k, signer: false } : k));
  const keyIdx = pk => keys.findIndex(k => k.pubkey === pk);
  const binKey = keys.find(k => k.pubkey === binAddress);
  if (!binKey || binKey.signer) return [];
  const inner = (tx.meta?.innerInstructions || []).flatMap(i => i.instructions);
  const all = [...(msg.instructions || []), ...inner];
  const out = [];
  for (const ix of all) {
    if (ix.program !== 'spl-token' && ix.program !== 'spl-token-2022') continue;
    const p = ix.parsed; if (!p || (p.type !== 'burn' && p.type !== 'burnChecked')) continue;
    const info = p.info || {};
    const signers = info.signers || [];
    if (!signers.includes(binAddress)) continue; // the burn itself must carry the bin reference
    const wallet = info.authority || info.multisigAuthority;
    const w = keys.find(k => k.pubkey === wallet);
    if (!w?.signer) continue;
    const idx = keyIdx(info.account);
    const post = (tx.meta?.postTokenBalances || []).find(b => b.accountIndex === idx);
    const pre = (tx.meta?.preTokenBalances || []).find(b => b.accountIndex === idx);
    const amount = info.amount ?? info.tokenAmount?.amount ?? pre?.uiTokenAmount?.amount ?? '0';
    // closed accounts have no post balance entry; a missing entry after a close means zero.
    const closed = all.some(c => c.parsed?.type === 'closeAccount' && c.parsed.info?.account === info.account);
    const fullBurn = post ? post.uiTokenAmount?.amount === '0' : closed;
    out.push({
      wallet, mint: info.mint, account: info.account, amount: String(amount),
      decimals: pre?.uiTokenAmount?.decimals ?? post?.uiTokenAmount?.decimals ?? info.tokenAmount?.decimals ?? null,
      program: ix.programId, fullBurn
    });
  }
  return out;
}

/* ---------- accounts from getTokenAccountsByOwner (jsonParsed) ---------- */
export function parseTokenAccounts(value, program) {
  return (value || []).map(v => {
    const i = v.account?.data?.parsed?.info; if (!i) return null;
    return {
      account: v.pubkey, mint: i.mint, program: program || v.account.owner,
      amount: i.tokenAmount?.amount ?? '0', decimals: i.tokenAmount?.decimals ?? 0,
      lamports: Number(v.account.lamports) || 0
    };
  }).filter(Boolean);
}
export function emptyAccounts(accts) { return accts.filter(a => BigInt(a.amount) === 0n); }
export function sumRefundable(accts) { return emptyAccounts(accts).reduce((s, a) => s + BigInt(a.lamports), 0n); }

/* ---------- misc ---------- */
/** "1 point", "2 points". */
export const plural = (n, one, many = one + 's') => `${n} ${Number(n) === 1 ? one : many}`;
export const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
export const BURN_PAIRS_PER_TX = 8;
export const CLOSE_PER_TX = 20;
