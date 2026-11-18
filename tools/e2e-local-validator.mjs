#!/usr/bin/env node
// End-to-end check of the burn / close flow against a LOCAL validator (solana-test-validator). Not part of `npm test`.
// Proves, for both token programs: (1) the bin reference key is accepted by the token program,
// (2) the address shows up in getSignaturesForAddress(bin), (3) parseBurns reads the burn back,
// (4) closing empty accounts refunds the actual lamports. Uses throwaway keys generated in memory only.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import * as W from '@solana/web3.js';
import * as S from '@solana/spl-token';
import { buildTxs } from '../lib/rot-tx.mjs';
import { parseBurns, parseTokenAccounts, sumRefundable, emptyAccounts, TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from '../lib/rot-core.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rot-validator-'));
const v = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', dir, '--rpc-port', '8899', '--faucet-port', '9900'], { stdio: 'ignore' });
const kill = () => { try { v.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('exit', kill);
const conn = new W.Connection('http://127.0.0.1:8899', 'confirmed');
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond, name, extra]); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

try {
  for (let i = 0; i < 60; i++) { try { await conn.getVersion(); break; } catch { await new Promise(r => setTimeout(r, 1000)); } }
  const owner = W.Keypair.generate(), bin = W.Keypair.generate().publicKey;
  await conn.confirmTransaction(await conn.requestAirdrop(owner.publicKey, 5 * W.LAMPORTS_PER_SOL), 'confirmed');

  for (const [label, programId] of [['Token', S.TOKEN_PROGRAM_ID], ['Token-2022', S.TOKEN_2022_PROGRAM_ID]]) {
    const mint = await S.createMint(conn, owner, owner.publicKey, null, 6, undefined, undefined, programId);
    const ata = await S.createAssociatedTokenAccount(conn, owner, mint, owner.publicKey, undefined, programId);
    await S.mintTo(conn, owner, mint, ata, owner, 5_000_000n, [], undefined, programId);
    const { blockhash } = await conn.getLatestBlockhash();
    const item = { account: ata.toBase58(), mint: mint.toBase58(), amount: '5000000', decimals: 6, program: programId.toBase58() };

    // with the bin reference key
    const [{ tx }] = buildTxs(W, owner.publicKey, [item], 'burn', blockhash, bin.toBase58());
    const sim = await conn.simulateTransaction(tx, [owner]);
    ok(`${label}: simulation accepts the burn with the bin reference key`, !sim.value.err, JSON.stringify(sim.value.err || ''));
    const sig = await W.sendAndConfirmTransaction(conn, tx, [owner], { commitment: 'confirmed' });
    const listed = (await conn.getSignaturesForAddress(bin)).map(s => s.signature);
    ok(`${label}: signature appears in getSignaturesForAddress(bin)`, listed.includes(sig));
    const parsed = await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    // convert web3 parsed shape to the plain JSON the RPC returns, so parseBurns sees what the scripts see
    const raw = await (await fetch('http://127.0.0.1:8899', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }) })).json();
    const burns = parseBurns(raw.result, bin.toBase58());
    if (process.env.ROT_DEBUG) console.log(JSON.stringify({ ixs: raw.result.transaction.message.instructions, keys: raw.result.transaction.message.accountKeys.map(k => [k.pubkey, k.signer]), pre: raw.result.meta.preTokenBalances, post: raw.result.meta.postTokenBalances, bin: bin.toBase58() }, null, 1));
    ok(`${label}: parseBurns reads it back (full burn, right wallet and mint)`, burns.length === 1 && burns[0].fullBurn && burns[0].wallet === owner.publicKey.toBase58() && burns[0].mint === mint.toBase58(), JSON.stringify(burns[0] || null));
    ok(`${label}: the account was closed in the same transaction`, (await conn.getAccountInfo(ata)) === null);
    ok(`${label}: the transaction has only burn, closeAccount and memo`, parsed.transaction.message.instructions.map(i => i.parsed?.type || i.program).join(',') === 'burnChecked,closeAccount,spl-memo', parsed.transaction.message.instructions.map(i => i.parsed?.type || i.program).join(','));

    // without the key: parseBurns must reject
    const mint2 = await S.createMint(conn, owner, owner.publicKey, null, 6, undefined, undefined, programId);
    const ata2 = await S.createAssociatedTokenAccount(conn, owner, mint2, owner.publicKey, undefined, programId);
    await S.mintTo(conn, owner, mint2, ata2, owner, 10n, [], undefined, programId);
    const bh2 = (await conn.getLatestBlockhash()).blockhash;
    const [{ tx: tx2 }] = buildTxs(W, owner.publicKey, [{ ...item, account: ata2.toBase58(), mint: mint2.toBase58(), amount: '10' }], 'burn', bh2, bin.toBase58());
    // strip the bin key from the burn instruction to simulate a user who skipped it
    tx2.instructions[0].keys = tx2.instructions[0].keys.slice(0, 3);
    const sig2 = await W.sendAndConfirmTransaction(conn, tx2, [owner], { commitment: 'confirmed' });
    const raw2 = await (await fetch('http://127.0.0.1:8899', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig2, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }) })).json();
    ok(`${label}: a burn without the bin key is not found by the bin address and parseBurns rejects it`, !(await conn.getSignaturesForAddress(bin)).some(s => s.signature === sig2) && parseBurns(raw2.result, bin.toBase58()).length === 0);
  }

  // close empty accounts: refund equals the lamports the accounts actually held
  const mintE = await S.createMint(conn, owner, owner.publicKey, null, 0);
  const ataE = await S.createAssociatedTokenAccount(conn, owner, mintE, owner.publicKey);
  const mintE2 = await S.createMint(conn, owner, owner.publicKey, null, 0, undefined, undefined, S.TOKEN_2022_PROGRAM_ID);
  const ataE2 = await S.createAssociatedTokenAccount(conn, owner, mintE2, owner.publicKey, undefined, S.TOKEN_2022_PROGRAM_ID);
  let accts = [];
  for (const p of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const r = await conn.getParsedTokenAccountsByOwner(owner.publicKey, { programId: new W.PublicKey(p) });
    accts = accts.concat(parseTokenAccounts(r.value.map(x => ({ pubkey: x.pubkey.toBase58(), account: { lamports: x.account.lamports, owner: x.account.owner.toBase58(), data: { parsed: x.account.data.parsed } } })), p));
  }
  const empties = emptyAccounts(accts);
  const expected = sumRefundable(accts);
  const before = BigInt(await conn.getBalance(owner.publicKey));
  const { blockhash } = await conn.getLatestBlockhash();
  const txs = buildTxs(W, owner.publicKey, empties, 'close', blockhash);
  const closeSig = await W.sendAndConfirmTransaction(conn, txs[0].tx, [owner], { commitment: 'confirmed' });
  const fee = BigInt((await conn.getTransaction(closeSig, { maxSupportedTransactionVersion: 0 })).meta.fee);
  const after = BigInt(await conn.getBalance(owner.publicKey));
  ok('close: both token programs, refund == sum of actual lamports (minus the fee)', empties.length === 2 && after - before + fee === expected, `${after - before + fee} vs ${expected}`);
  ok('close: both accounts are gone', (await conn.getAccountInfo(ataE)) === null && (await conn.getAccountInfo(ataE2)) === null);
} catch (e) {
  console.error('ERROR', e);
  results.push([false, 'unexpected error', String(e.message || e)]);
} finally {
  kill(); fs.rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter(r => !r[0]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
