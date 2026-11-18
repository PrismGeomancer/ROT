import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../lib/rot-core.mjs';

const CFG = {
  roundStart: '2026-01-05T00:00:00Z', roundLengthDays: 7, challengeHours: 48,
  minLiquidityUsd: 500, minPairAgeDays: 7, maxMintsPerRound: 2, minPayoutSol: 0.01
};
const D = C.DAY_MS, T0 = Date.parse(CFG.roundStart);
const W1 = 'Fh3kQ9ZpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const deadPairs = created => [{ chainId: 'solana', pairCreatedAt: created, liquidity: { usd: 10 }, txns: { h24: { buys: 0, sells: 0 } }, volume: { h24: 0 } }];
const livePair = created => [{ chainId: 'solana', pairCreatedAt: created, liquidity: { usd: 90000 }, txns: { h24: { buys: 5, sells: 3 } }, volume: { h24: 1000 } }];
const goodAuth = { mintAuthority: null, freezeAuthority: null, earliestFeePayer: 'someoneElse' };

/* ---- addresses ---- */
test('isAddress accepts real addresses and rejects junk', () => {
  assert.ok(C.isAddress(C.WSOL));
  assert.ok(C.isAddress(C.USDC));
  assert.ok(C.isAddress(C.TOKEN_PROGRAM));
  assert.ok(!C.isAddress(''));
  assert.ok(!C.isAddress('hello'));
  assert.ok(!C.isAddress(C.WSOL + 'x'));
  assert.ok(!C.isAddress(C.WSOL.slice(0, 31)));
  assert.ok(!C.isAddress('0OIl' + C.WSOL.slice(4))); // 0, O, I, l are not base58
  assert.ok(!C.isAddress(null));
});

/* ---- classification ---- */
test('classify: no pair is dead', () => assert.deepEqual(C.classifyToken([], CFG), { status: 'dead', why: 'no-pair' }));
test('classify: low liquidity is dead', () => assert.equal(C.classifyToken(deadPairs(1), CFG).why, 'low-liquidity'));
test('classify: liquid but no trades in 24h is dead', () => {
  const p = livePair(1); p[0].txns.h24 = { buys: 0, sells: 0 }; p[0].volume.h24 = 0;
  assert.deepEqual(C.classifyToken(p, CFG), { status: 'dead', why: 'no-trades' });
});
test('classify: liquid and trading is alive', () => assert.equal(C.classifyToken(livePair(1), CFG).status, 'alive'));
test('classify: failed request is unknown', () => assert.equal(C.classifyToken(null, CFG).status, 'unknown'));
test('classify: ignores non-Solana pairs', () => {
  assert.equal(C.classifyToken([{ chainId: 'ethereum', liquidity: { usd: 1e6 }, volume: { h24: 9 } }], CFG).why, 'no-pair');
});
test('classify: needs one pair that is both liquid and trading', () => {
  const liquidIdle = { chainId: 'solana', liquidity: { usd: 9000 }, txns: { h24: { buys: 0, sells: 0 } }, volume: { h24: 0 } };
  const busyThin = { chainId: 'solana', liquidity: { usd: 20 }, txns: { h24: { buys: 9, sells: 9 } }, volume: { h24: 99 } };
  assert.equal(C.classifyToken([liquidIdle, busyThin], CFG).why, 'no-trades');
});

/* ---- rounds ---- */
test('round boundaries', () => {
  assert.deepEqual(C.roundBounds(1, CFG.roundStart, 7), { start: T0, end: T0 + 7 * D });
  assert.deepEqual(C.roundBounds(3, CFG.roundStart, 7), { start: T0 + 14 * D, end: T0 + 21 * D });
  assert.equal(C.roundBounds(0, CFG.roundStart, 7), null);
  assert.equal(C.roundBounds(1, '', 7), null);
  assert.equal(C.roundNumberAt(T0 - 1, CFG.roundStart, 7), 0);
  assert.equal(C.roundNumberAt(T0, CFG.roundStart, 7), 1);
  assert.equal(C.roundNumberAt(T0 + 7 * D - 1, CFG.roundStart, 7), 1);
  assert.equal(C.roundNumberAt(T0 + 7 * D, CFG.roundStart, 7), 2);
  assert.equal(C.roundNumberAt(T0, '', 7), 0);
});

/* ---- eligibility: every rule one by one ---- */
const mk = (o = {}) => ({ wallet: W1, mint: 'MintA', time: T0 + 30 * D, fullBurn: true, sig: 's' + Math.random(), ...o });
const fresh = () => ({ everCounted: new Set(), roundCounts: new Map() });
const okInfo = { pairs: deadPairs(T0), auth: goodAuth };

test('rule 1 full burn', () => {
  assert.equal(C.evaluateBurn(mk({ fullBurn: false }), okInfo, fresh(), CFG).reason, 'not-full-burn');
  assert.equal(C.evaluateBurn(mk(), okInfo, fresh(), CFG).counted, true);
});
test('rule 2 listed before', () => {
  assert.equal(C.evaluateBurn(mk(), { pairs: [], auth: goodAuth }, fresh(), CFG).reason, 'never-listed');
  assert.equal(C.evaluateBurn(mk(), { pairs: [{ chainId: 'solana', liquidity: { usd: 1 } }], auth: goodAuth }, fresh(), CFG).reason, 'never-listed');
  assert.equal(C.evaluateBurn(mk(), { pairs: null, auth: goodAuth }, fresh(), CFG).reason, 'never-listed');
});
test('rule 3 old enough', () => {
  const t = T0 + 30 * D;
  assert.equal(C.evaluateBurn(mk({ time: t }), { pairs: deadPairs(t - 6 * D), auth: goodAuth }, fresh(), CFG).reason, 'pair-too-new');
  assert.equal(C.evaluateBurn(mk({ time: t }), { pairs: deadPairs(t - 7 * D), auth: goodAuth }, fresh(), CFG).counted, true);
  // earliest pair decides, not the newest
  const two = [...deadPairs(t - 1 * D), ...deadPairs(t - 40 * D)];
  assert.equal(C.evaluateBurn(mk({ time: t }), { pairs: two, auth: goodAuth }, fresh(), CFG).counted, true);
});
test('rule 4 looks dead now', () => {
  assert.equal(C.evaluateBurn(mk(), { pairs: livePair(T0), auth: goodAuth }, fresh(), CFG).reason, 'looks-alive');
});
test('rule 5 not created by the burner', () => {
  for (const k of ['mintAuthority', 'freezeAuthority', 'earliestFeePayer']) {
    const auth = { ...goodAuth, [k]: W1 };
    assert.equal(C.evaluateBurn(mk(), { pairs: deadPairs(T0), auth }, fresh(), CFG).reason, 'created-by-wallet', k);
  }
  // unknown authorities (lookup failed) must not count
  assert.equal(C.evaluateBurn(mk(), { pairs: deadPairs(T0), auth: null }, fresh(), CFG).reason, 'created-by-wallet');
  // long-history mints: authorities only, fee payer unknown (undefined) is fine
  assert.equal(C.evaluateBurn(mk(), { pairs: deadPairs(T0), auth: { mintAuthority: null, freezeAuthority: null } }, fresh(), CFG).counted, true);
});
test('rule 6 not excluded', () => {
  assert.equal(C.evaluateBurn(mk(), okInfo, fresh(), CFG, { blocklist: { mints: ['MintA'], wallets: [] } }).reason, 'blocklisted');
  assert.equal(C.evaluateBurn(mk(), okInfo, fresh(), CFG, { blocklist: { mints: [], wallets: [W1] } }).reason, 'blocklisted');
  assert.equal(C.evaluateBurn(mk(), okInfo, fresh(), CFG, { excludeMints: ['MintA'] }).reason, 'blocklisted');
});
test('rule 7 one point per distinct mint per wallet, ever', () => {
  const b = [mk({ time: T0 + 30 * D, sig: 'a' }), mk({ time: T0 + 60 * D, sig: 'b' }), mk({ time: T0 + 31 * D, wallet: 'W2', sig: 'c' })];
  const out = C.applyEligibility(b, () => okInfo, CFG);
  assert.deepEqual(out.map(x => [x.sig, x.counted, x.reason]), [['a', true, ''], ['c', true, ''], ['b', false, 'already-counted']]);
});
test('rule 8 round cap, extras stay listed', () => {
  const b = ['M1', 'M2', 'M3', 'M4'].map((m, i) => mk({ mint: m, time: T0 + 30 * D + i * 1000, sig: 's' + i }));
  const out = C.applyEligibility(b, () => okInfo, CFG); // cap is 2
  assert.deepEqual(out.map(x => x.reason), ['', '', 'over-round-cap', 'over-round-cap']);
  // next round the wallet may count again
  const later = C.applyEligibility([...b, mk({ mint: 'M5', time: T0 + 37 * D, sig: 'late' })], () => okInfo, CFG);
  assert.equal(later.find(x => x.sig === 'late').counted, true);
});
test('applyEligibility does not mutate input and is order independent', () => {
  const b = [mk({ time: T0 + 40 * D, sig: 'z' }), mk({ time: T0 + 30 * D, sig: 'y', mint: 'M9' })];
  const copy = JSON.stringify(b);
  const a = C.applyEligibility(b, () => okInfo, CFG);
  assert.equal(JSON.stringify(b), copy);
  assert.deepEqual(a, C.applyEligibility([...b].reverse(), () => okInfo, CFG));
});

test('predictCount mirrors the ledger rules', () => {
  const ctx = { wallet: W1, now: T0 + 30 * D, everCounted: new Set(['Burned']), roundUsed: 0 };
  const p = (pairs, mint = 'MintA', c = ctx) => C.predictCount({ mint, pairs }, c, CFG);
  assert.equal(p(null).verdict, 'unsure');
  assert.deepEqual(p([]), { verdict: 'no', reason: 'never-listed' });
  assert.equal(p(deadPairs(ctx.now - D)).reason, 'pair-too-new');
  assert.equal(p(livePair(T0)).reason, 'looks-alive');
  assert.equal(p(deadPairs(T0), 'Burned').reason, 'already-counted');
  assert.equal(p(deadPairs(T0), 'MintA', { ...ctx, roundUsed: 2 }).reason, 'over-round-cap');
  assert.equal(p(deadPairs(T0), 'MintA', { ...ctx, excludeMints: ['MintA'] }).reason, 'blocklisted');
  assert.equal(p(deadPairs(T0)).verdict, 'yes');
});

/* ---- points ---- */
test('roundPoints: counted burns in the round plus carried', () => {
  const ledger = { burns: [
    { wallet: 'A', counted: true, time: T0 + D }, { wallet: 'A', counted: true, time: T0 + 2 * D },
    { wallet: 'B', counted: false, time: T0 + D }, { wallet: 'B', counted: true, time: T0 + 8 * D }
  ] };
  assert.deepEqual([...C.roundPoints(ledger, 1, CFG)], [['A', 2]]);
  assert.deepEqual([...C.roundPoints(ledger, 2, CFG, [{ wallet: 'A', points: 3 }])], [['A', 3], ['B', 1]]);
  assert.deepEqual([...C.allTimePoints(ledger)].sort(), [['A', 2], ['B', 1]]);
});

/* ---- round build ---- */
const SOL = 1_000_000_000n;
const base = (o = {}) => ({
  n: 1, ledger: { burns: [] }, prevRound: null, balanceLamports: 10n * SOL, networkReserveLamports: SOL / 10n,
  rentLamports: 2_039_280, hasTokenAccount: new Set(), now: '2026-01-13T00:00:00.000Z', ...o
});
const burnsFor = (wallet, k, round = 1) => Array.from({ length: k }, (_, i) => ({ wallet, counted: true, time: T0 + (round - 1) * 7 * D + (i + 1) * 1000, mint: wallet + i }));

test('round: zero points buys nothing, carries nothing, is paid at once', () => {
  const r = C.buildRoundData(base(), CFG);
  assert.equal(r.status, 'paid'); assert.equal(r.spentLamports, 0); assert.deepEqual(r.payouts, []); assert.deepEqual(r.carriedPoints, []);
  assert.equal(r.totalPoints, 0);
});
test('round: invariants, payable wallets and the minimum payout', () => {
  const ledger = { burns: [...burnsFor('A', 3), ...burnsFor('B', 1), ...burnsFor('Tiny', 1)] };
  // A=3, B=1, Tiny=1 -> total 5. Pot = 9.9 SOL. rentAll = 3 accounts.
  const r = C.buildRoundData(base({ ledger, hasTokenAccount: new Set(['B']) }), CFG);
  const a = r._audit;
  assert.ok(BigInt(r.spentLamports) <= BigInt(r.potLamports), 'spent <= pot');
  assert.equal(a.sharesSum + a.remainder, a.distributable, 'shares + remainder == distributable');
  assert.ok(a.remainder >= 0n && a.remainder < 5n, 'floor remainder is under one lamport per point-holder');
  assert.equal(a.distributable + a.rentAll, a.pot);
  assert.equal(r.status, 'challenge');
  assert.deepEqual(r.payouts.map(p => p.wallet).sort(), ['A', 'B', 'Tiny']);
  assert.equal(r.challengeEndsAt, new Date(T0 + 7 * D + 48 * C.HOUR_MS).toISOString());
  for (const p of r.payouts) { assert.equal(p.rotBase, null); assert.equal(p.sig, null); }
});
test('round: wallets under the minimum carry their points and keep their share in the pot', () => {
  const ledger = { burns: [...burnsFor('Big', 9), ...burnsFor('Small', 1)] };
  const cfg = { ...CFG, minPayoutSol: 0.5 };
  // pot 1 SOL - 0.1 reserve = 0.9; rent for 2 accounts ~0.004; Small share ~0.0896 < 0.5
  const r = C.buildRoundData(base({ ledger, balanceLamports: SOL }), cfg);
  assert.deepEqual(r.payouts.map(p => p.wallet), ['Big']);
  assert.deepEqual(r.carriedPoints, [{ wallet: 'Small', points: 1 }]);
  const a = r._audit;
  const bigShare = (a.distributable * 9n) / 10n;
  assert.equal(BigInt(r.spentLamports), bigShare + 2_039_280n, 'spent = payable shares + rent for payable wallets without an account');
  assert.ok(BigInt(r.spentLamports) < BigInt(r.potLamports) - (a.distributable / 10n) + 1n, 'the small wallet share stays unspent');
});
test('round: rent is only reserved for payable wallets that lack a token account', () => {
  const ledger = { burns: burnsFor('A', 1) };
  const have = C.buildRoundData(base({ ledger, hasTokenAccount: new Set(['A']) }), CFG);
  const lack = C.buildRoundData(base({ ledger }), CFG);
  assert.equal(have.rentReserveLamports, 0);
  assert.equal(lack.rentReserveLamports, 2_039_280);
  assert.equal(have.spentLamports, Number(have._audit.distributable));
  assert.equal(lack.spentLamports, lack.potLamports); // one wallet takes the whole distributable share, plus its rent
});
test('round: carried points and remainder come from the previous round', () => {
  const prev = { carriedPoints: [{ wallet: 'Old', points: 2 }], remainderBase: '17' };
  const r = C.buildRoundData(base({ n: 2, prevRound: prev, ledger: { burns: burnsFor('New', 1, 2) } }), CFG);
  assert.equal(r.totalPoints, 3);
  assert.equal(r.remainderBase, '17');
  assert.deepEqual(r.payouts.map(p => [p.wallet, p.points]), [['Old', 2], ['New', 1]]);
});
test('round: pot below the network reserve is zero', () => {
  const r = C.buildRoundData(base({ ledger: { burns: burnsFor('A', 1) }, balanceLamports: SOL / 100n }), CFG);
  assert.equal(r.potLamports, 0);
  assert.equal(r.status, 'paid');
  assert.equal(r.spentLamports, 0);
});
test('round: a burn outside the round is not counted in it', () => {
  const r = C.buildRoundData(base({ n: 2, ledger: { burns: burnsFor('A', 2, 1) } }), CFG);
  assert.equal(r.totalPoints, 0);
});

/* ---- $ROT split ---- */
test('splitRot divides by points in integer base units and returns the remainder', () => {
  const { amounts, remainder } = C.splitRot('1000', [{ points: 1 }, { points: 1 }, { points: 1 }]);
  assert.deepEqual(amounts, [333n, 333n, 333n]); assert.equal(remainder, 1n);
  const r2 = C.splitRot(12345678901234567890n, [{ points: 7 }, { points: 3 }]);
  assert.equal(r2.amounts[0] + r2.amounts[1] + r2.remainder, 12345678901234567890n);
  assert.deepEqual(C.splitRot('5', []), { amounts: [], remainder: 5n });
});

/* ---- burn parsing ---- */
const BIN = 'BinAddr1111111111111111111111111111111111111';
function burnTx({ withBin = true, post = '0', err = null, binSigner = false, closed = true, kind = 'burn' } = {}) {
  const keys = [
    { pubkey: W1, signer: true, writable: true }, { pubkey: 'TokAcct', signer: false, writable: true },
    { pubkey: 'MintA', signer: false, writable: true }, { pubkey: BIN, signer: binSigner, writable: false },
    { pubkey: C.TOKEN_PROGRAM, signer: false, writable: false }, { pubkey: C.MEMO_PROGRAM, signer: false, writable: false }
  ];
  const info = withBin
    ? { account: 'TokAcct', mint: 'MintA', multisigAuthority: W1, signers: [BIN], amount: '5000' }
    : { account: 'TokAcct', mint: 'MintA', authority: W1, amount: '5000' };
  const ixs = [{ program: 'spl-token', programId: C.TOKEN_PROGRAM, parsed: { type: kind, info } }];
  if (closed) ixs.push({ program: 'spl-token', programId: C.TOKEN_PROGRAM, parsed: { type: 'closeAccount', info: { account: 'TokAcct', destination: W1, owner: W1 } } });
  return {
    blockTime: 1,
    meta: { err, preTokenBalances: [{ accountIndex: 1, uiTokenAmount: { amount: '5000', decimals: 6 } }],
      postTokenBalances: post === null ? [] : [{ accountIndex: 1, uiTokenAmount: { amount: post, decimals: 6 } }], innerInstructions: [] },
    transaction: { message: { accountKeys: keys, instructions: ixs } }
  };
}
test('parseBurns reads a burn that carries the bin reference key', () => {
  const r = C.parseBurns(burnTx(), BIN);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { wallet: W1, mint: 'MintA', account: 'TokAcct', amount: '5000', decimals: 6, program: C.TOKEN_PROGRAM, fullBurn: true });
});
test('parseBurns rejects a burn that does not carry the bin key', () => {
  assert.deepEqual(C.parseBurns(burnTx({ withBin: false }), BIN), []);
});
test('parseBurns rejects a plain mention of the bin (no burn instruction references it)', () => {
  const t = burnTx(); t.transaction.message.instructions = [{ program: 'system', parsed: { type: 'transfer', info: { source: W1, destination: BIN, lamports: 1 } } }];
  assert.deepEqual(C.parseBurns(t, BIN), []);
});
test('parseBurns rejects failed transactions and signer bin keys', () => {
  assert.deepEqual(C.parseBurns(burnTx({ err: { InstructionError: [0, 'x'] } }), BIN), []);
  assert.deepEqual(C.parseBurns(burnTx({ binSigner: true }), BIN), []);
  assert.deepEqual(C.parseBurns(burnTx(), ''), []);
});
test('parseBurns flags partial burns and handles burnChecked', () => {
  assert.equal(C.parseBurns(burnTx({ post: '12', closed: false }), BIN)[0].fullBurn, false);
  const t = burnTx({ kind: 'burnChecked' });
  t.transaction.message.instructions[0].parsed.info.tokenAmount = { amount: '5000', decimals: 6 }; delete t.transaction.message.instructions[0].parsed.info.amount;
  assert.equal(C.parseBurns(t, BIN)[0].amount, '5000');
});
test('parseBurns treats a closed account with no post balance as a full burn', () => {
  assert.equal(C.parseBurns(burnTx({ post: null }), BIN)[0].fullBurn, true);
  assert.equal(C.parseBurns(burnTx({ post: null, closed: false }), BIN)[0].fullBurn, false);
});

/* ---- empty accounts ---- */
test('sumRefundable sums the lamports each empty account actually holds', () => {
  const a = [
    { account: 'a', amount: '0', lamports: 2039280 }, { account: 'b', amount: '0', lamports: 2157600 },
    { account: 'c', amount: '1', lamports: 2039280 }
  ];
  assert.equal(C.sumRefundable(a), 4196880n);
  assert.equal(C.emptyAccounts(a).length, 2);
  assert.equal(C.sumRefundable([]), 0n);
});
test('parseTokenAccounts keeps zero balances and lamports', () => {
  const v = [{ pubkey: 'P', account: { lamports: 2039280, owner: C.TOKEN_PROGRAM, data: { parsed: { info: { mint: 'M', tokenAmount: { amount: '0', decimals: 6 } } } } } }];
  assert.deepEqual(C.parseTokenAccounts(v), [{ account: 'P', mint: 'M', program: C.TOKEN_PROGRAM, amount: '0', decimals: 6, lamports: 2039280 }]);
});

/* ---- formatting ---- */
test('formatUnits is exact for big integers', () => {
  assert.equal(C.formatUnits('1234567890123456789', 6), '1,234,567,890,123.4567');
  assert.equal(C.formatUnits('5', 6), '0'); // truncated to 4 places, never rounded up
  assert.equal(C.formatUnits('5', 6, 6), '0.000005');
  assert.equal(C.formatUnits('1500000', 6), '1.5');
  assert.equal(C.formatUnits('0', 6), '0');
  assert.equal(C.lamportsToSol(2039280), '0.002');
});
test('chunk', () => assert.deepEqual(C.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]));

test('plural', () => {
  assert.equal(C.plural(1, 'point'), '1 point');
  assert.equal(C.plural(0, 'point'), '0 points');
  assert.equal(C.plural(2, 'empty account'), '2 empty accounts');
  assert.equal(C.plural(1, 'bag'), '1 bag');
});
