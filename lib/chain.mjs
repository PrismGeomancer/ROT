// Node-side helpers for the operator scripts: config loading, RPC with backoff, DexScreener batches.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Read window.ROT_CONFIG out of index.html so the site and the scripts share one source of truth. */
export function loadConfig(htmlPath = path.join(ROOT, 'index.html')) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/window\.ROT_CONFIG\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) throw new Error('Could not find window.ROT_CONFIG in ' + htmlPath);
  return vm.runInNewContext('(' + m[1] + ')', Object.create(null), { timeout: 1000 });
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (fallback !== undefined && e.code === 'ENOENT') return fallback; throw e; }
}
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** Minimal arg parser: --flag, --key value, positionals. */
export function parseArgs(argv, spec = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (spec[k] === 'bool') out[k] = true;
      else out[k] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

/** JSON-RPC with retry on 429/5xx and a gentle rate limit. fetchImpl is injectable for tests. */
export function makeRpc(url, { fetchImpl = fetch, minGapMs = 120, retries = 6 } = {}) {
  let last = 0;
  return async function rpc(method, params = []) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let r;
      try {
        r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      } catch (e) {
        if (attempt >= retries) throw e;
        await sleep(500 * 2 ** attempt); continue;
      }
      if (r.status === 429 || r.status >= 500) {
        if (attempt >= retries) throw new Error(`RPC ${method}: HTTP ${r.status}`);
        await sleep(600 * 2 ** attempt); continue;
      }
      const j = await r.json();
      if (j.error) {
        if (/rate|too many/i.test(j.error.message || '') && attempt < retries) { await sleep(600 * 2 ** attempt); continue; }
        const err = new Error(`RPC ${method}: ${j.error.message}`); err.code = j.error.code; throw err;
      }
      return j.result;
    }
  };
}

/** DexScreener pairs by mint. Returns Map(mint -> pairs[]) ; mints whose batch failed map to null. */
export async function dexPairs(mints, { fetchImpl = fetch, batch = 30, gapMs = 400 } = {}) {
  const out = new Map();
  const list = [...new Set(mints)];
  for (let i = 0; i < list.length; i += batch) {
    const slice = list.slice(i, i + batch);
    let pairs = null;
    for (let attempt = 0; attempt < 5 && pairs == null; attempt++) {
      try {
        const r = await fetchImpl('https://api.dexscreener.com/tokens/v1/solana/' + slice.join(','));
        if (r.status === 429) { await sleep(1000 * 2 ** attempt); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        pairs = Array.isArray(j) ? j : (j.pairs || []);
      } catch { await sleep(500 * 2 ** attempt); }
    }
    for (const m of slice) out.set(m, pairs == null ? null : pairs.filter(p => p.baseToken?.address === m || p.quoteToken?.address === m));
    if (i + batch < list.length) await sleep(gapMs);
  }
  return out;
}
