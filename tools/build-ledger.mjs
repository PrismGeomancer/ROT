#!/usr/bin/env node
// Builds ledger.json from the public bin address. Read-only: never touches a key.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, readJson, writeJson, parseArgs, makeRpc, dexPairs } from '../lib/chain.mjs';
import { parseBurns, applyEligibility, WSOL, USDC, USDT, isAddress } from '../lib/rot-core.mjs';

const HELP = `build-ledger: read the bin address on-chain and write ledger.json

Usage: node tools/build-ledger.mjs [options]
  --rpc <url>          RPC endpoint (default: ROT_CONFIG.rpc). Use a private one for big ledgers.
  --out <file>         output file (default: ledger.json)
  --signatures <file>  text file of extra tx signatures, one per line (default: tools/signatures.txt if present).
                       Use this only if the bin reference key does not work on-chain (see README).
  --now <ISO>          value for "updated" (default: current time)
  --help

Reads getSignaturesForAddress(binAddress) to the end, fetches each transaction (jsonParsed), keeps only successful
transactions with a real SPL burn/burnChecked that references the bin address, and applies the eligibility rules.
Anyone can rerun it. Market-dependent rules (looks dead now) reflect the moment you run it.`;

const HISTORY_LIMIT = 1000; // mints with more signatures than this: check authorities only

export async function getAllSignatures(rpc, address, until) {
  const sigs = []; let before;
  for (;;) {
    const page = await rpc('getSignaturesForAddress', [address, { limit: 1000, ...(before ? { before } : {}), ...(until ? { until } : {}) }]);
    sigs.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  return sigs;
}

export async function mintAuthorities(rpc, mint) {
  const acc = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  const info = acc?.value?.data?.parsed?.info;
  if (!info) return null;
  const auth = { mintAuthority: info.mintAuthority ?? null, freezeAuthority: info.freezeAuthority ?? null };
  const page = await rpc('getSignaturesForAddress', [mint, { limit: HISTORY_LIMIT }]);
  if (page.length < HISTORY_LIMIT && page.length) {
    const oldest = page[page.length - 1].signature;
    const tx = await rpc('getTransaction', [oldest, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    const payer = tx?.transaction?.message?.accountKeys?.[0];
    auth.earliestFeePayer = typeof payer === 'string' ? payer : payer?.pubkey;
    auth.historyChecked = true;
  } else auth.historyChecked = false; // very long history: authorities only (README)
  return auth;
}

export async function buildLedger({ cfg, rpc, dex = dexPairs, blocklist, extraSignatures = [], now, log = () => {} }) {
  const bin = cfg.binAddress;
  if (!isAddress(bin)) throw new Error('ROT_CONFIG.binAddress is empty or not a valid address. Set it first.');
  const sigInfos = await getAllSignatures(rpc, bin);
  const sigs = new Set([...sigInfos.filter(s => !s.err).map(s => s.signature), ...extraSignatures]);
  log(`${sigs.size} candidate transactions`);
  const burns = [];
  for (const sig of sigs) {
    const tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    if (!tx) continue;
    for (const b of parseBurns(tx, bin)) burns.push({ sig, ...b, time: (tx.blockTime || 0) * 1000 });
  }
  log(`${burns.length} burns found`);
  const mints = [...new Set(burns.map(b => b.mint))];
  const pairs = await dex(mints);
  const lookup = new Map();
  for (const m of mints) {
    let auth = null;
    try { auth = await mintAuthorities(rpc, m); } catch (e) { log(`authorities failed for ${m}: ${e.message}`); }
    lookup.set(m, { pairs: pairs.get(m) ?? null, auth });
  }
  const symbols = new Map();
  for (const [m, i] of lookup) {
    const p = (i.pairs || []).find(x => x.baseToken?.address === m);
    symbols.set(m, p?.baseToken?.symbol || '');
  }
  const excludeMints = [...(cfg.excludeMints || []), WSOL, USDC, USDT, cfg.ca].filter(Boolean);
  const judged = applyEligibility(burns, m => lookup.get(m), cfg, { blocklist, excludeMints });
  return {
    updated: now || new Date().toISOString(),
    bin,
    burns: judged
      .map(b => ({ sig: b.sig, wallet: b.wallet, mint: b.mint, symbol: symbols.get(b.mint) || '', amount: b.amount, decimals: b.decimals, time: b.time, counted: b.counted, reason: b.reason }))
      .sort((a, b) => b.time - a.time || a.sig.localeCompare(b.sig))
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2), { help: 'bool' });
  if (a.help) { console.log(HELP); process.exit(0); }
  const cfg = loadConfig();
  const rpc = makeRpc(a.rpc || cfg.rpc);
  const sigFile = a.signatures || path.join(ROOT, 'tools/signatures.txt');
  const extra = fs.existsSync(sigFile) ? fs.readFileSync(sigFile, 'utf8').split(/\s+/).filter(s => s && !s.startsWith('#')) : [];
  const blocklist = readJson(path.join(ROOT, 'blocklist.json'), { wallets: [], mints: [], log: [] });
  const out = await buildLedger({ cfg, rpc, blocklist, extraSignatures: extra, now: a.now, log: m => console.error(m) });
  const file = path.resolve(a.out || path.join(ROOT, 'ledger.json'));
  writeJson(file, out);
  console.error(`wrote ${file}: ${out.burns.length} burns, ${out.burns.filter(b => b.counted).length} counted`);
}
