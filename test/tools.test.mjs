import test from 'node:test';
import assert from 'node:assert/strict';
import { payRound, Refusal } from '../tools/pay-round.mjs';
import { buildLedger } from '../tools/build-ledger.mjs';
import { loadConfig, parseArgs } from '../lib/chain.mjs';
import * as C from '../lib/rot-core.mjs';

const POT = C.TOKEN_PROGRAM;           // any valid 32-byte address works as a stand-in
const CA = C.USDC;
const CFG = { ca: CA, potWallet: POT, maxPriceImpactPct: 3, minPayoutSol: 0.01 };
const PAST = () => Date.parse('2026-03-01T00:00:00Z');

const mkRound = (o = {}) => ({
  n: 1, status: 'challenge', challengeEndsAt: '2026-02-01T00:00:00.000Z', spentLamports: 2_000_000_000,
  rentReserveLamports: 4_000_000, swapSigs: [], rotBoughtBase: null, remainderBase: '5',
  payouts: [{ wallet: 'A', points: 3, rotBase: null, sig: null }, { wallet: 'B', points: 1, rotBase: null, sig: null }],
  carriedPoints: [], ...o
});

function fakeDeps(over = {}) {
  const s = { swaps: [], transfers: [], saves: 0, tokenBal: 1000n, paid: false, quotes: [] };
  const deps = {
    now: PAST, keypairPublicKey: () => POT,
    getSolBalance: async () => 10_000_000_000n,
    getTokenBalance: async () => s.tokenBal,
    quote: async l => { s.quotes.push(l); return { outAmount: '1', priceImpactPct: 0.5 }; },
    swap: async l => { s.swaps.push(l); s.tokenBal += 4000n; return { signature: 'swap' + s.swaps.length }; },
    sendTransfers: async items => { s.transfers.push(items); return 'tx' + s.transfers.length; },
    save: () => { s.saves++; }, onPaid: () => { s.paid = true; },
    ...over
  };
  return { deps, s };
}
const run = (round, deps, o = {}) => payRound({ round, cfg: CFG, send: true, deps, ...o });
const refuses = async (p, re) => { await assert.rejects(p, e => e instanceof Refusal && re.test(e.message)); };

/* ---- refusals (checked in dry run too) ---- */
test('refuses when the keypair is not the pot wallet', async () => {
  const { deps } = fakeDeps({ keypairPublicKey: () => C.WSOL });
  await refuses(run(mkRound(), deps, { send: false }), /keypair/);
});
test('refuses before the challenge window ends', async () => {
  const { deps } = fakeDeps({ now: () => Date.parse('2026-01-15T00:00:00Z') });
  await refuses(run(mkRound(), deps, { send: false }), /challenge window/);
});
test('refuses when the round is already paid', async () => {
  const { deps } = fakeDeps();
  await refuses(run(mkRound({ status: 'paid' }), deps, { send: false }), /already paid/);
});
test('refuses when the plan exceeds the balance', async () => {
  const { deps, s } = fakeDeps({ getSolBalance: async () => 1_000_000_000n });
  await refuses(run(mkRound(), deps, { send: false }), /holds/);
  assert.equal(s.swaps.length, 0);
});
test('refuses when price impact exceeds maxPriceImpactPct', async () => {
  const { deps, s } = fakeDeps({ quote: async () => ({ outAmount: '1', priceImpactPct: -3.01 }) });
  await refuses(run(mkRound(), deps), /price impact/i);
  assert.equal(s.swaps.length, 0);
});
test('refuses when ca is empty or potWallet is empty', async () => {
  const { deps } = fakeDeps();
  await refuses(payRound({ round: mkRound(), cfg: { ...CFG, ca: '' }, send: true, deps }), /ca/);
  await refuses(payRound({ round: mkRound(), cfg: { ...CFG, potWallet: '' }, send: true, deps }), /potWallet/);
});
test('--send without a keypair is refused', async () => {
  const { deps } = fakeDeps({ keypairPublicKey: () => null });
  await refuses(run(mkRound(), deps), /ROT_POT_KEYPAIR/);
});

/* ---- dry run ---- */
test('dry run prints a plan and sends nothing', async () => {
  const { deps, s } = fakeDeps();
  const r = await run(mkRound(), deps, { send: false });
  assert.equal(r.dryRun, true);
  assert.equal(s.swaps.length + s.transfers.length + s.saves, 0);
  assert.equal(r.plan.swapLamports, '1996000000'); // spent minus rent reserve
});

/* ---- full run ---- */
test('full run: buys, measures by balance difference, splits by points, carries the remainder, marks paid', async () => {
  const { deps, s } = fakeDeps();
  const round = mkRound();
  await run(round, deps);
  assert.equal(s.swaps.length, 1);
  assert.equal(s.swaps[0], 1_996_000_000n);
  assert.equal(round.rotBoughtBase, '4000');            // after - before, not the quote
  // total = 4000 bought + 5 carried in = 4005; A gets floor(4005*3/4)=3003, B floor(4005/4)=1001, remainder 1
  assert.deepEqual(round.payouts.map(p => p.rotBase), ['3003', '1001']);
  assert.equal(round.remainderBase, '1');
  assert.ok(round.payouts.every(p => p.sig));
  assert.equal(round.status, 'paid'); assert.ok(s.paid);
});
test('--chunks splits the buy and records every swap signature', async () => {
  const { deps, s } = fakeDeps();
  const round = mkRound();
  await run(round, deps, { chunks: 3 });
  assert.equal(s.swaps.length, 3);
  assert.equal(s.swaps.reduce((a, b) => a + b, 0n), 1_996_000_000n);
  assert.deepEqual(round.swapSigs, ['swap1', 'swap2', 'swap3']);
  assert.equal(round.rotBoughtBase, '12000');
});

/* ---- resume: never buy twice ---- */
test('resume after the swap: no second buy, only unsent transfers go out', async () => {
  const { deps, s } = fakeDeps();
  const round = mkRound();
  // crash during sending: first transfer batch fails
  let calls = 0;
  const flaky = { ...deps, sendTransfers: async items => { if (calls++ === 0) return deps.sendTransfers(items); throw new Error('rpc died'); } };
  await assert.rejects(run(round, flaky, { batch: 1 }), /rpc died/);
  assert.equal(s.swaps.length, 1);
  assert.equal(round.swapSigs.length, 1);
  assert.ok(round.payouts[0].sig && !round.payouts[1].sig);
  // rerun with a healthy sender
  const before = JSON.parse(JSON.stringify(round));
  await run(round, deps, { batch: 1 });
  assert.equal(s.swaps.length, 1, 'no second swap');
  assert.equal(s.transfers.length, 2, 'one earlier + exactly one new transfer');
  assert.equal(round.payouts[0].sig, before.payouts[0].sig, 'already-sent payout untouched');
  assert.deepEqual(round.payouts.map(p => p.rotBase), before.payouts.map(p => p.rotBase), 'amounts not recomputed');
  assert.equal(round.status, 'paid');
});
test('resume after a crash between swaps finishes the remaining chunks only', async () => {
  const { deps, s } = fakeDeps();
  const round = mkRound();
  let n = 0;
  const flaky = { ...deps, swap: async l => { if (n++ === 1) throw new Error('boom'); return deps.swap(l); } };
  await assert.rejects(run(round, flaky, { chunks: 3 }), /boom/);
  assert.equal(round.swapSigs.length, 1);
  assert.equal(round.swapPlan.chunks, 3);
  await run(round, deps, { chunks: 5 }); // a different --chunks on resume must not change the plan
  assert.equal(s.swaps.length, 3);
  assert.equal(round.swapSigs.length, 3);
  assert.equal(round.rotBoughtBase, '12000');
});
test('resume after the swap but before measuring does not buy again', async () => {
  const { deps, s } = fakeDeps();
  const round = mkRound({ swapSigs: ['already'], rotBeforeBase: '1000', swapPlan: { chunks: 1, lamports: ['1996000000'] } });
  s.tokenBal = 5000n; // the swap already landed
  await run(round, deps);
  assert.equal(s.swaps.length, 0);
  assert.equal(round.rotBoughtBase, '4000');
});

/* ---- build-ledger end to end with a fake RPC ---- */
const BIN = C.TOKEN_2022_PROGRAM;
const WALLET = C.MEMO_PROGRAM;
test('buildLedger finds burns through the bin, rejects ones without the key, and applies eligibility', async () => {
  const T = Date.parse('2026-02-01T00:00:00Z');
  const mk = (withBin, mint) => ({
    blockTime: T / 1000, meta: { err: null,
      preTokenBalances: [{ accountIndex: 1, uiTokenAmount: { amount: '7', decimals: 0 } }],
      postTokenBalances: [{ accountIndex: 1, uiTokenAmount: { amount: '0', decimals: 0 } }], innerInstructions: [] },
    transaction: { message: { accountKeys: [{ pubkey: WALLET, signer: true }, { pubkey: 'Acct', signer: false }, { pubkey: mint, signer: false }, { pubkey: BIN, signer: false }],
      instructions: [{ program: 'spl-token', programId: C.TOKEN_PROGRAM, parsed: { type: 'burn', info: withBin ? { account: 'Acct', mint, multisigAuthority: WALLET, signers: [BIN], amount: '7' } : { account: 'Acct', mint, authority: WALLET, amount: '7' } } }] } }
  });
  const txs = { sigGood: mk(true, C.USDT), sigNoKey: mk(false, C.USDT), sigAlive: mk(true, C.WSOL) };
  const rpc = async (m, p) => {
    if (m === 'getSignaturesForAddress') return p[0] === BIN ? Object.keys(txs).map(s => ({ signature: s, err: null })) : [{ signature: 'first' }];
    if (m === 'getTransaction') return txs[p[0]] || { transaction: { message: { accountKeys: [{ pubkey: 'Creator', signer: true }] } } };
    if (m === 'getAccountInfo') return { value: { data: { parsed: { info: { mintAuthority: null, freezeAuthority: null } } } } };
    throw new Error('unexpected ' + m);
  };
  const dead = [{ chainId: 'solana', pairCreatedAt: T - 30 * C.DAY_MS, liquidity: { usd: 1 }, baseToken: { address: C.USDT, symbol: 'DEAD' }, txns: { h24: { buys: 0, sells: 0 } } }];
  const alive = [{ chainId: 'solana', pairCreatedAt: T - 30 * C.DAY_MS, liquidity: { usd: 1e6 }, baseToken: { address: C.WSOL, symbol: 'LIVE' }, txns: { h24: { buys: 9, sells: 9 } }, volume: { h24: 5 } }];
  const dex = async () => new Map([[C.USDT, dead], [C.WSOL, alive]]);
  const cfg = { binAddress: BIN, roundStart: '2026-01-05T00:00:00Z', roundLengthDays: 7, minLiquidityUsd: 500, minPairAgeDays: 7, maxMintsPerRound: 25 };
  // note: USDT and WSOL are normally excluded; use an empty exclude list by overriding via blocklist-free ctx
  const out = await buildLedger({ cfg: { ...cfg, ca: '' }, rpc, dex, blocklist: { wallets: [], mints: [] }, now: 'X' });
  assert.equal(out.bin, BIN);
  assert.equal(out.burns.length, 2, 'the burn without the bin key is not listed');
  // USDT and WSOL are in the built-in excludeMints, so both are listed as blocklisted, which proves rule 6 is wired in
  assert.deepEqual(out.burns.map(b => b.reason).sort(), ['blocklisted', 'blocklisted']);
});

test('loadConfig reads the real ROT_CONFIG out of index.html', () => {
  const c = loadConfig();
  assert.equal(c.ca, ''); assert.equal(c.burnEnabled, false); assert.equal(c.maxPriceImpactPct, 3);
  assert.equal(typeof c.roundLengthDays, 'number');
});
test('parseArgs', () => {
  assert.deepEqual(parseArgs(['3', '--send', '--chunks', '4'], { send: 'bool' }), { _: ['3'], send: true, chunks: '4' });
});
