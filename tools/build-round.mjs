#!/usr/bin/env node
// Builds rounds/round-NNN.json for a finished round. Read-only: never touches a key.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, readJson, writeJson, parseArgs, makeRpc } from '../lib/chain.mjs';
import { buildRoundData, roundBounds, solToLamports, isAddress } from '../lib/rot-core.mjs';

const HELP = `build-round: compute the points table and plan for round <n>

Usage: node tools/build-round.mjs <n> [options]
  --rpc <url>                 RPC endpoint (default: ROT_CONFIG.rpc)
  --network-reserve-sol <x>   SOL left in the pot wallet for fees (default 0.01)
  --now <ISO>                 snapshot time (default: current time)
  --dry                       print the round, write nothing
  --allow-open                build before the round has ended (testing only)
  --help

Reads ledger.json, rounds/ (previous round: carried points and carried $ROT remainder) and the pot wallet's SOL
balance. Round pot = balance - network reserve. A wallet is payable only if its share is at least minPayoutSol;
the rest carry their points. Writes rounds/round-NNN.json with status "challenge" (or "paid" when there is nothing
to buy) and updates rounds/index.json. Refuses to overwrite a round that has swaps or payouts recorded.`;

const pad = n => String(n).padStart(3, '0');

export async function buildRound({ n, cfg, rpc, ledger, prevRound, blocklist, now, networkReserveLamports }) {
  if (!isAddress(cfg.potWallet)) throw new Error('ROT_CONFIG.potWallet is empty or invalid.');
  if (!cfg.roundStart) throw new Error('ROT_CONFIG.roundStart is empty.');
  const balance = (await rpc('getBalance', [cfg.potWallet])).value;
  const rent = await rpc('getMinimumBalanceForRentExemption', [165]); // read from the chain, never a constant
  const hasTokenAccount = new Set();
  if (isAddress(cfg.ca)) {
    const wallets = new Set(ledger.burns.filter(b => b.counted).map(b => b.wallet));
    for (const c of prevRound?.carriedPoints || []) wallets.add(c.wallet);
    for (const w of wallets) {
      const r = await rpc('getTokenAccountsByOwner', [w, { mint: cfg.ca }, { encoding: 'jsonParsed' }]);
      if ((r.value || []).length) hasTokenAccount.add(w);
    }
  }
  const round = buildRoundData({
    n, ledger, prevRound, balanceLamports: BigInt(balance), networkReserveLamports,
    rentLamports: rent, hasTokenAccount, now
  }, cfg);
  const ends = Date.parse(round.end), chEnds = Date.parse(round.challengeEndsAt);
  round.removed = (blocklist?.log || []).filter(l => l.time * (l.time < 1e12 ? 1000 : 1) >= ends && l.time * (l.time < 1e12 ? 1000 : 1) <= chEnds)
    .map(l => ({ target: l.target, reason: l.reason, time: l.time }));
  return round;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2), { help: 'bool', dry: 'bool', 'allow-open': 'bool' });
  if (a.help || !a._.length) { console.log(HELP); process.exit(a.help ? 0 : 1); }
  const n = Number(a._[0]);
  if (!Number.isInteger(n) || n < 1) { console.error('Round number must be a positive integer.'); process.exit(1); }
  const cfg = loadConfig();
  const bounds = roundBounds(n, cfg.roundStart, cfg.roundLengthDays);
  const nowIso = a.now || new Date().toISOString();
  if (!bounds) { console.error('roundStart is not set.'); process.exit(1); }
  if (Date.parse(nowIso) < bounds.end && !a['allow-open']) { console.error(`Round ${n} has not ended yet (ends ${new Date(bounds.end).toISOString()}).`); process.exit(1); }
  const dir = path.join(ROOT, 'rounds');
  const file = path.join(dir, `round-${pad(n)}.json`);
  const existing = readJson(file, null);
  if (existing && (existing.swapSigs?.length || existing.payouts?.some(p => p.sig) || existing.status === 'paid') && !a.dry) {
    console.error(`rounds/round-${pad(n)}.json already has swaps or payouts recorded (status ${existing.status}). Refusing to overwrite.`); process.exit(1);
  }
  const ledger = readJson(path.join(ROOT, 'ledger.json'), { burns: [] });
  const prevRound = n > 1 ? readJson(path.join(dir, `round-${pad(n - 1)}.json`), null) : null;
  if (n > 1 && !prevRound) console.error(`Warning: rounds/round-${pad(n - 1)}.json is missing, so no carried points or remainder are applied.`);
  const blocklist = readJson(path.join(ROOT, 'blocklist.json'), { wallets: [], mints: [], log: [] });
  const rpc = makeRpc(a.rpc || cfg.rpc);
  const reserve = solToLamports(a['network-reserve-sol'] ?? 0.01);
  const round = await buildRound({ n, cfg, rpc, ledger, prevRound, blocklist, now: nowIso, networkReserveLamports: reserve });
  console.log(JSON.stringify(round, null, 2));
  if (!a.dry) {
    writeJson(file, round);
    const idxFile = path.join(dir, 'index.json');
    const idx = readJson(idxFile, { rounds: [] });
    idx.rounds = idx.rounds.filter(r => r.n !== n);
    idx.rounds.push({ n, start: round.start, end: round.end, status: round.status, file: path.basename(file) });
    idx.rounds.sort((x, y) => x.n - y.n);
    writeJson(idxFile, idx);
    console.error(`wrote ${file} and rounds/index.json`);
  }
}
