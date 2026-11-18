#!/usr/bin/env node
// Operator script: buys $ROT with the round's SOL and sends it to the payable wallets.
// DRY RUN BY DEFAULT. Reads a keypair only with --send, from the file named in ROT_POT_KEYPAIR.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, readJson, writeJson, parseArgs, makeRpc } from '../lib/chain.mjs';
import { splitRot, isAddress, formatUnits, lamportsToSol } from '../lib/rot-core.mjs';

const HELP = `pay-round: buy $ROT for round <n> and pay the burners

Usage: node tools/pay-round.mjs <n> [options]
  --send                 actually send. Without it nothing is sent (dry run: prints the plan).
  --chunks <N>           split the buy into N swaps (default 1)
  --slippage-bps <x>     slippage for the swap (default 100)
  --batch <k>            transfers per transaction (default 4)
  --rpc <url>            RPC endpoint (default: ROT_CONFIG.rpc)
  --help

Environment:
  ROT_POT_KEYPAIR        path to the pot wallet keypair JSON, OUTSIDE the repo. Never a literal key.
  JUPITER_API_KEY        optional; sent as x-api-key (keyless access is rate limited)

Refuses to run if: the keypair's public key is not potWallet, ca is empty, the round is not past its challenge
window, the round is already paid, the plan's spend exceeds the balance, or the quoted price impact exceeds
maxPriceImpactPct. Resumable: swaps already in swapSigs are never repeated, and only transfers without a sig are sent.`;

export class Refusal extends Error {}
const pad = n => String(n).padStart(3, '0');

/**
 * Pure orchestration, every side effect comes in through deps so tests can run it with fakes.
 * deps: {
 *   now(): ms, keypairPublicKey(): string|null,
 *   getSolBalance(addr): bigint, getTokenBalance(owner, mint): bigint,
 *   quote(lamports): { outAmount: string, priceImpactPct: number },
 *   swap(lamports): { signature }, sendTransfers(batch:[{wallet, amount:bigint}]): signature,
 *   save(round), onPaid(round)
 * }
 */
export async function payRound({ round, cfg, send, chunks = 1, batch = 4, deps, log = () => {} }) {
  if (!isAddress(cfg.ca)) throw new Refusal('ROT_CONFIG.ca is empty or invalid. Nothing to buy.');
  if (!isAddress(cfg.potWallet)) throw new Refusal('ROT_CONFIG.potWallet is empty or invalid.');
  if (round.status === 'paid') throw new Refusal(`Round ${round.n} is already paid.`);
  if (deps.now() < Date.parse(round.challengeEndsAt)) throw new Refusal(`Round ${round.n} is still in its challenge window (ends ${round.challengeEndsAt}).`);
  const kp = deps.keypairPublicKey();
  if (kp != null && kp !== cfg.potWallet) throw new Refusal('The keypair does not belong to potWallet. Refusing.');
  if (send && kp == null) throw new Refusal('--send needs ROT_POT_KEYPAIR pointing at the pot wallet keypair file.');

  const resumed = round.swapSigs.length > 0 || round.rotBeforeBase != null;
  const swapLamports = BigInt(round.spentLamports) - BigInt(round.rentReserveLamports || 0);
  const nChunks = round.swapPlan?.chunks ?? Math.max(1, chunks);
  const per = swapLamports / BigInt(nChunks);
  const amounts = Array.from({ length: nChunks }, (_, i) => (i === nChunks - 1 ? swapLamports - per * BigInt(nChunks - 1) : per));

  if (!resumed) {
    const bal = await deps.getSolBalance(cfg.potWallet);
    if (BigInt(round.spentLamports) > bal) throw new Refusal(`Plan spends ${lamportsToSol(round.spentLamports)} SOL but the pot wallet holds ${lamportsToSol(bal)} SOL.`);
  }
  // price impact check on every chunk that has not been swapped yet
  const todo = amounts.slice(round.swapSigs.length);
  for (const [i, a] of todo.entries()) {
    if (a <= 0n) continue;
    const q = await deps.quote(a);
    log(`quote chunk ${round.swapSigs.length + i + 1}/${nChunks}: ${lamportsToSol(a)} SOL -> ${q.outAmount} base units, price impact ${q.priceImpactPct}%`);
    if (Math.abs(q.priceImpactPct) > cfg.maxPriceImpactPct) throw new Refusal(`Price impact ${q.priceImpactPct}% exceeds maxPriceImpactPct (${cfg.maxPriceImpactPct}%).`);
  }

  const plan = { swapLamports: swapLamports.toString(), chunks: nChunks, payouts: round.payouts.length, remainingSwaps: todo.length, remainingTransfers: round.payouts.filter(p => !p.sig).length };
  if (!send) { log('DRY RUN. Nothing sent. Plan: ' + JSON.stringify(plan)); return { dryRun: true, plan, round }; }

  // 1. buy (resumable)
  if (round.rotBoughtBase == null) {
    if (round.rotBeforeBase == null) {
      round.rotBeforeBase = (await deps.getTokenBalance(cfg.potWallet, cfg.ca)).toString();
      round.swapPlan = { chunks: nChunks, lamports: amounts.map(String) };
      deps.save(round);
    }
    for (let i = round.swapSigs.length; i < nChunks; i++) {
      if (amounts[i] <= 0n) continue;
      const { signature } = await deps.swap(amounts[i]);
      round.swapSigs.push(signature); deps.save(round); // recorded right after each swap
      log(`swap ${i + 1}/${nChunks}: ${signature}`);
    }
    // 2. measure: balance after minus before, never the quote
    const after = await deps.getTokenBalance(cfg.potWallet, cfg.ca);
    round.rotBoughtBase = (after - BigInt(round.rotBeforeBase)).toString();
    deps.save(round);
  }
  // 3. split (carried remainder joins the pot of $ROT; the leftover is carried on)
  if (round.payouts.some(p => p.rotBase == null)) {
    const total = BigInt(round.rotBoughtBase) + BigInt(round.remainderBase || '0');
    const { amounts: parts, remainder } = splitRot(total, round.payouts);
    round.payouts.forEach((p, i) => { p.rotBase = parts[i].toString(); });
    round.remainderBase = remainder.toString();
    deps.save(round);
  }
  // 4. send
  const pending = round.payouts.filter(p => !p.sig && BigInt(p.rotBase) > 0n);
  for (let i = 0; i < pending.length; i += batch) {
    const group = pending.slice(i, i + batch);
    const signature = await deps.sendTransfers(group.map(p => ({ wallet: p.wallet, amount: BigInt(p.rotBase) })));
    group.forEach(p => { p.sig = signature; });
    deps.save(round);
    log(`sent ${group.length} transfers: ${signature}`);
  }
  if (round.payouts.every(p => p.sig || BigInt(p.rotBase) === 0n)) { round.status = 'paid'; deps.save(round); deps.onPaid?.(round); }
  return { dryRun: false, plan, round };
}

/* ---------------- real side effects (web3.js, spl-token, Jupiter) ---------------- */
const JUP = 'https://api.jup.ag/swap/v2';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

async function realDeps({ cfg, rpcUrl, slippageBps, roundFile, idxFile, send }) {
  const rpc = makeRpc(rpcUrl);
  let kp = null, web3 = null, spl = null;
  const kpPath = process.env.ROT_POT_KEYPAIR;
  if (kpPath) {
    if (!path.isAbsolute(kpPath)) throw new Refusal('ROT_POT_KEYPAIR must be an absolute path outside the repo.');
    if (path.resolve(kpPath).startsWith(ROOT + path.sep)) throw new Refusal('ROT_POT_KEYPAIR points inside the repo. Keep keypairs outside it.');
    web3 = await import('@solana/web3.js'); spl = await import('@solana/spl-token');
    kp = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, 'utf8'))));
  } else if (send) throw new Refusal('--send needs ROT_POT_KEYPAIR.');
  if (!web3) { web3 = await import('@solana/web3.js').catch(() => null); spl = await import('@solana/spl-token').catch(() => null); }
  const headers = process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {};
  const connection = web3 && new web3.Connection(rpcUrl, 'confirmed');
  const tokenBalance = async (owner, mint) => {
    const r = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
    return (r.value || []).reduce((s, v) => s + BigInt(v.account.data.parsed.info.tokenAmount.amount), 0n);
  };
  const orderUrl = (lamports, taker) => `${JUP}/order?inputMint=${WSOL_MINT}&outputMint=${cfg.ca}&amount=${lamports}&slippageBps=${slippageBps}` + (taker ? `&taker=${taker}` : '');
  return {
    now: () => Date.now(),
    keypairPublicKey: () => (kp ? kp.publicKey.toBase58() : null),
    getSolBalance: async a => BigInt((await rpc('getBalance', [a])).value),
    getTokenBalance: tokenBalance,
    async quote(lamports) {
      const r = await fetch(orderUrl(lamports), { headers });
      if (!r.ok) throw new Error(`Jupiter /order: HTTP ${r.status}`);
      const j = await r.json();
      // `priceImpact` is a percent (verified against the live response; `priceImpactPct` is the same number / 100).
      const pi = typeof j.priceImpact === 'number' ? j.priceImpact : Number(j.priceImpactPct) * 100;
      if (!Number.isFinite(pi)) throw new Error('Jupiter quote had no price impact. Refusing to guess.');
      return { outAmount: j.outAmount, priceImpactPct: pi };
    },
    async swap(lamports) {
      const r = await fetch(orderUrl(lamports, kp.publicKey.toBase58()), { headers });
      const o = await r.json();
      if (!r.ok || !o.transaction) throw new Error(`Jupiter /order gave no transaction: ${o.errorMessage || o.error || r.status}`);
      const tx = web3.VersionedTransaction.deserialize(Buffer.from(o.transaction, 'base64'));
      tx.sign([kp]);
      const e = await fetch(`${JUP}/execute`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ signedTransaction: Buffer.from(tx.serialize()).toString('base64'), requestId: o.requestId }) });
      const j = await e.json();
      if (j.status !== 'Success') throw new Error(`Swap failed: ${j.error || j.status} (code ${j.code})`);
      return { signature: j.signature };
    },
    async sendTransfers(items) {
      const mintKey = new web3.PublicKey(cfg.ca);
      const mintInfo = await connection.getAccountInfo(mintKey);
      const programId = mintInfo.owner;
      const from = spl.getAssociatedTokenAddressSync(mintKey, kp.publicKey, true, programId);
      const ixs = [];
      for (const it of items) {
        const owner = new web3.PublicKey(it.wallet);
        const ata = spl.getAssociatedTokenAddressSync(mintKey, owner, true, programId);
        ixs.push(spl.createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, ata, owner, mintKey, programId));
        ixs.push(spl.createTransferInstruction(from, ata, kp.publicKey, it.amount, [], programId));
      }
      const tx = new web3.Transaction().add(...ixs);
      return web3.sendAndConfirmTransaction(connection, tx, [kp], { commitment: 'confirmed' });
    },
    save: round => writeJson(roundFile, round),
    onPaid: round => {
      const idx = readJson(idxFile, { rounds: [] });
      const e = idx.rounds.find(r => r.n === round.n); if (e) e.status = 'paid';
      writeJson(idxFile, idx);
    }
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2), { help: 'bool', send: 'bool' });
  if (a.help || !a._.length) { console.log(HELP); process.exit(a.help ? 0 : 1); }
  const n = Number(a._[0]);
  const cfg = loadConfig();
  const roundFile = path.join(ROOT, 'rounds', `round-${pad(n)}.json`);
  const idxFile = path.join(ROOT, 'rounds', 'index.json');
  try {
    const round = readJson(roundFile, null);
    if (!round) throw new Refusal(`rounds/round-${pad(n)}.json not found. Run build-round first.`);
    const deps = await realDeps({ cfg, rpcUrl: a.rpc || cfg.rpc, slippageBps: Number(a['slippage-bps'] ?? 100), roundFile, idxFile, send: !!a.send });
    const res = await payRound({ round, cfg, send: !!a.send, chunks: Number(a.chunks || 1), batch: Number(a.batch || 4), deps, log: m => console.error(m) });
    if (res.dryRun) console.log(JSON.stringify(res.plan, null, 2));
  } catch (e) {
    if (e instanceof Refusal) { console.error('REFUSED: ' + e.message); process.exit(2); }
    console.error(e); process.exit(1);
  }
}
