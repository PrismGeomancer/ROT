// Transaction builders shared by the site and the devnet test. W is the @solana/web3.js namespace.
// A burn transaction contains ONLY: SPL burnChecked + closeAccount per token account, and one Memo.
import { MEMO_PROGRAM, MEMO_TEXT, BURN_PAIRS_PER_TX, CLOSE_PER_TX, chunk } from './rot-core.mjs';

const u64 = n => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };

/** a: { account, mint, amount, decimals, program }. The bin key is a read-only non-signer extra account. */
export function ixBurn(W, a, owner, bin) {
  const data = new Uint8Array(10); data[0] = 15; data.set(u64(a.amount), 1); data[9] = a.decimals; // burnChecked
  const keys = [
    { pubkey: new W.PublicKey(a.account), isSigner: false, isWritable: true },
    { pubkey: new W.PublicKey(a.mint), isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false }
  ];
  if (bin) keys.push({ pubkey: bin, isSigner: false, isWritable: false });
  return new W.TransactionInstruction({ programId: new W.PublicKey(a.program), keys, data: toBuf(data) });
}
export function ixClose(W, a, owner) {
  return new W.TransactionInstruction({
    programId: new W.PublicKey(a.program),
    keys: [
      { pubkey: new W.PublicKey(a.account), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data: toBuf(new Uint8Array([9]))
  });
}
export function ixMemo(W, owner) {
  return new W.TransactionInstruction({
    programId: new W.PublicKey(MEMO_PROGRAM),
    keys: [{ pubkey: owner, isSigner: true, isWritable: false }],
    data: toBuf(new TextEncoder().encode(MEMO_TEXT))
  });
}
// web3.js expects a Buffer; the browser IIFE exposes it only through its own polyfill, so convert defensively.
const toBuf = u8 => (typeof Buffer !== 'undefined' ? Buffer.from(u8) : u8);

/** Returns [{ tx, group }]; splits a group in half when its serialized size would exceed the packet limit. */
export function buildTxs(W, owner, items, kind, blockhash, binAddress) {
  const bin = kind === 'burn' ? new W.PublicKey(binAddress) : null;
  const per = kind === 'burn' ? BURN_PAIRS_PER_TX : CLOSE_PER_TX;
  const make = group => {
    const tx = new W.Transaction({ feePayer: owner, recentBlockhash: blockhash });
    for (const a of group) { if (kind === 'burn' && BigInt(a.amount) > 0n) tx.add(ixBurn(W, a, owner, bin)); tx.add(ixClose(W, a, owner)); }
    if (kind === 'burn') tx.add(ixMemo(W, owner));
    return tx;
  };
  const out = [];
  const place = group => {
    const tx = make(group);
    let len; try { len = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length; } catch { len = 99999; }
    if (len > 1232 && group.length > 1) { const m = group.length >> 1; place(group.slice(0, m)); place(group.slice(m)); } else out.push({ tx, group });
  };
  for (const g of chunk(items, per)) place(g);
  return out;
}
