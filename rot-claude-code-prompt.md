# ROT: Claude Code build prompt

You are building **ROT** (ticker **$ROT**), a static website, a small set of operator scripts and a ledger for a Solana meme-coin project. Tagline: **Dead bags rot. Rot feeds the next.**

**The one rule:** 100% of $ROT's creator fees go to one public pot wallet. Every round, the pot buys $ROT on the market and sends it to the wallets that burned dead tokens, by ledger points. The rule is set at launch and locked. The fee does one job: it buys $ROT for the burners.

The site is a rebuild of an earlier project called Absorb. Absorb lives next to this folder at `../Absorb/index.html`. Treat it as a donor for plumbing only. **Do not edit anything in `../Absorb`.** Work only inside this `ROT` folder.

Read these files in this folder first, in this order:
1. `rot-copy-deck.md`: every string on the site, section by section. Use it verbatim. Italic accent phrases are marked with `*asterisks*`.
2. `rot-logo.svg`: the mark and palette source.
3. `rot-image-prompts.md`: reference only, for image placeholders.

Then read `../Absorb/index.html` end to end before you write anything. Summarise to yourself what it does: stack, page router, config object, wallet flow, data fetchers, helpers.

---

## Part 1: Structure rules (what you keep, what you replace)

### Keep from Absorb (copy the plumbing, then rename)
- Single static `index.html`, no server, no database, no build step required to deploy. Hosting is GitHub Pages under a **subpath** (for example `/rot/`), so every URL must be relative.
- The page-switching router (`data-page` sections) and the shell around it: nav, toast, wallet modal, sound toggle (off by default).
- The config-object pattern. Rename `window.ABSORB_CONFIG` to `window.ROT_CONFIG` with the fields in section 14 of the copy deck.
- Helper functions: `$`, `$$`, `esc`, `short`, the `store` wrapper around localStorage (try/catch), `toast`.
- Read-only data sources: DexScreener API for market data and the Solana public RPC for balances and transactions.
- The trust model for connecting: read address and balances freely, never ask for a signature except for an explicit user action.

### Replace completely
- **The whole 3D scene.** Remove the `MarchingCubes` import and every metaball, meadow, grass, flower and seed object. Nothing in the new scene may be a blob or metaball. This is a hard requirement.
- Theme, colors, fonts, layout, all copy, the logo, the favicon, the page titles and meta tags.
- Page mapping. Rename the old pages and ids consistently (no leftovers):
  - `absorb` becomes `rot` (home)
  - `vote` becomes `bin` (scan, select, burn, close empty accounts)
  - `how` stays `how`
  - `board` becomes `ledger` (tabs: This round, Burns, Wallets, Past rounds)
  - `p` is deleted (ROT has four pages, not five)
- The Absorb mechanic (two coins, holder votes, swap discount, vesting, size gate) is **gone**. Do not carry any voting code across.

### Allowed to change
Section ids, class names and the router paths may be renamed as long as the rename is consistent. After finishing, `grep -inE "absorb|vote|meadow|marching|metaball|seed|flower|grass|host coin|target coin" index.html` must return nothing, or each hit must be justified in your summary.

---

## Part 2: The product

### One-sentence mechanic
You burn dead tokens from your own wallet. Every burn carries a public bin address, so ROT can find it on-chain and list it on a public ledger. Each eligible distinct token is one point. Every round, the pot wallet's SOL buys $ROT on the market and the $ROT is sent to the burners, divided by points.

### The four functions (this is the whole product; do not add others)
1. **Scan.** Read a wallet and mark which tokens look dead and whether they should count.
2. **Burn.** Burn selected dead tokens and close their accounts in one transaction. The transaction carries the bin address.
3. **Rounds and payouts.** Rounds, the pot, points, the challenge window and the payouts are shown on the site from public files and the chain. The buy and the transfers are made by operator scripts.
4. **Close empty accounts.** Close every zero-balance token account and refund the rent to the owner. No burn, no points.

Anything outside these four (specimen pages, a verify-a-signature box, streaks, badges) is out of scope. Do not build it.

### Pages
1. **Home (`rot`).** Hero with the corroding-coin scene, headline, lede, CTAs, the two counters, the round chip, the four-fact strip.
2. **Bin (`bin`).** Wallet connect or paste an address, scan, select, preview, burn, rot report card, the "Your rot" panel, and the close-empty-accounts panel.
3. **How (`how`).** Five steps, the rule card, the rules cards, the risk box.
4. **Ledger (`ledger`).** Four tabs: This round, Burns, Wallets, Past rounds (with a round detail view at `#/ledger/round/<n>`).

### Wallet reading (works with no backend)
- Connect Phantom, Solflare or Backpack through the injected providers, or accept a pasted address (read-only mode).
- Read all SPL token accounts for the address with `getTokenAccountsByOwner` for both the Token program and Token-2022 (jsonParsed). Keep zero-balance accounts for the close-empty-accounts panel.
- Fetch market data from DexScreener in batches by mint (comma-separated, respect the per-request limit, retry with backoff). Cache in memory for the session.
- Classify each token:
  - **dead**: no Solana pair found, or best-pair liquidity under `minLiquidityUsd`, or no trades in 24 hours
  - **alive**: has a pair with liquidity at or above the threshold and trades in the last 24 hours
  - **unknown**: the market-data request failed
- Also predict **Counts?** with the same rules the ledger script uses (see "Eligibility"), as `Should count`, `Won't count` (with reason) or `We'll see`.
- The classification and prediction are heuristics. The UI must say so (copy deck 5.3 small print).

### Burning (behind a flag)
`ROT_CONFIG.burnEnabled` is `false` by default. When true:
- Build one transaction (or several if the size limit requires) containing **only**: SPL `burn` (or `burnChecked`) and `closeAccount` instructions for the mints the user selected, plus one Memo program instruction with the text `rot:v1`. No transfers, no other programs. Burn the **full balance** of each account so it can be closed.
- **Bin reference key.** Append `ROT_CONFIG.binAddress` as an extra **read-only, non-signer** account key on each `burn` instruction, the same way Solana Pay appends a reference key to a transfer. The token programs ignore extra non-signer accounts for a single-owner burn, and the address then appears in `getSignaturesForAddress(binAddress)`. If `binAddress` is empty, keep burning closed and show the toast from the copy deck.
- **Test the reference key on devnet before relying on it,** for both the Token program and Token-2022. If either rejects the extra key, report it, keep the memo only, and use the fallback below.
- Before signing, show the preview from copy deck 5.4 listing every mint and amount. Simulate the transaction first and show the user if the simulation fails.
- The user signs in their own wallet. ROT never holds keys and never sends a transaction on its own from the site.
- Use the correct token program per account (Token or Token-2022).
- After confirmation, show the Rot report card (PNG made in the browser with a canvas, downloadable, with a share link as a URL hash).
- Without a bundler, load `@solana/web3.js` and `@solana/spl-token` from a pinned CDN version with SRI. If that proves unreliable, vendor the built files into `./vendor/`. Say which you chose and why.

### Close empty accounts
- From the scanned accounts, list those with zero balance (both token programs). Sum the **actual lamports** each account holds, not a constant. Show the total as `{{sol}} SOL refundable`.
- Build one transaction (split if the size limit requires) containing **only** `closeAccount` instructions with the owner as destination and authority. No memo, no bin key, no points.
- Same safety rules as burning: preview every account, simulate, user signs, gated by `burnEnabled`.

### Fallback if the reference key fails on devnet
Keep the memo, drop the reference key, and make `tools/build-ledger.mjs` accept a text file of transaction signatures (`tools/signatures.txt`) that the operator fills in by hand. Say so in the README. Do not build a verify box into the site.

---

## Part 3: Data files and operator scripts

All scripts are plain Node (ESM, no build step), deterministic, with a `--help`, and they never read a private key except `pay-round.mjs` as described. Anyone can rerun the first two and get the same files.

### `ledger.json` (ships empty)
`{"updated": null, "bin": "", "burns": [{"sig": "", "wallet": "", "mint": "", "symbol": "", "amount": "", "time": 0, "counted": true, "reason": ""}]}`
Every burn found is listed. `counted: false` entries carry a `reason` from this fixed set: `never-listed`, `pair-too-new`, `created-by-wallet`, `over-round-cap`, `looks-alive`, `blocklisted`, `not-full-burn`.

### `tools/build-ledger.mjs`
Reads `getSignaturesForAddress(binAddress)` to the end, fetches each transaction (jsonParsed, `maxSupportedTransactionVersion: 0`), keeps only successful transactions that contain a real SPL `burn`/`burnChecked` instruction referencing the bin address, and applies the **eligibility** rules below. It writes `ledger.json`.

### Eligibility (the anti-farming rules; implement exactly, as pure functions with tests)
A burn counts as one point for its wallet only if **all** are true:
1. **Full burn:** the token account's post-balance is zero.
2. **Listed before:** DexScreener has or had a Solana pair for the mint (`pairCreatedAt` present).
3. **Old enough:** the earliest pair was created at least `minPairAgeDays` days before the burn.
4. **Looks dead now:** no pair with liquidity at or above `minLiquidityUsd` and recent trades.
5. **Not created by the burner:** the burning wallet is not the mint authority or freeze authority, and is not the fee payer of the mint's earliest transaction. For mints with a very long history, check the authorities only and say so in the README.
6. **Not excluded:** the mint is not on `blocklist.json` and not in `excludeMints` (SOL, major stablecoins, $ROT itself).
7. **One point per distinct mint per wallet, ever.**
8. **Round cap:** at most `maxMintsPerRound` points per wallet per round; extra burns stay listed as `over-round-cap`.

Residual risk, to state plainly in the README: someone can still make a token, list a tiny pair, wait the age period and burn it from a second wallet. These rules raise the cost. They don't make it impossible.

### `blocklist.json`
`{"wallets": [], "mints": [], "log": [{"time": 0, "target": "", "reason": ""}]}`. Ships empty. Removals made during a challenge window are logged here with a reason. The site shows the reason on the round page.

### Rounds
- Round `n` covers `roundStart + (n-1) * roundLengthDays` days to the next boundary (UTC).
- `rounds/index.json`: `{"rounds": [{"n": 1, "start": "", "end": "", "status": "open|closed|challenge|paid", "file": "round-001.json"}]}`. Ships empty.
- `rounds/round-NNN.json`: `{"n": 1, "start": "", "end": "", "snapshotAt": "", "challengeEndsAt": "", "potLamports": 0, "spentLamports": 0, "swapSigs": [], "rotBoughtBase": null, "remainderBase": "0", "totalPoints": 0, "payouts": [{"wallet": "", "points": 0, "rotBase": null, "sig": null}], "carriedPoints": [{"wallet": "", "points": 0}], "removed": []}`. Token amounts are strings in base units. The site formats them with the decimals read from the chain.

### `tools/build-round.mjs <n>`
After a round ends: reads `ledger.json` and the previous round file (for carried points and the carried `remainderBase`), counts points for round `n` (new points plus carried points) and reads the pot wallet's SOL balance. Round pot = `balance - networkReserve`. It computes each wallet's share of the pot in lamports (floor). A wallet is **payable** only if its share is at least `minPayoutSol`. Points of wallets under the minimum go to `carriedPoints`, and their share stays unspent in the pot wallet, so it is part of the next round's balance. `spentLamports` = the sum of payable shares + the rent reserve for token accounts that payable wallets don't have yet (read the rent from the chain, never a constant). It writes `rounds/round-NNN.json` with status `challenge`, `swapSigs: []`, `rotBoughtBase: null` and every payout `rotBase: null, sig: null`. A round with zero points buys nothing, spends nothing, carries nothing and is marked `paid` right away. Invariants, tested: `spentLamports <= potLamports`; sum of all shares + floor remainder == pot; carried wallets are exactly the ones under the minimum.

### `tools/pay-round.mjs <n>`
Operator-run, **dry run by default** (prints the plan, sends nothing). With `--send`, and only after `challengeEndsAt`, it reads a keypair file from the path in the environment variable `ROT_POT_KEYPAIR` (a path outside the repo; never a literal key, never committed). It must refuse to run if the keypair's public key isn't `potWallet`, if `ca` is empty, if the round isn't past its challenge window, if the round is already `paid`, if the plan's spend exceeds the balance, or if the quoted price impact exceeds `maxPriceImpactPct`. Steps:
1. **Buy.** Swap `spentLamports` minus the rent reserve into $ROT through a public DEX aggregator (use Jupiter; read its **current** docs and verify the API shape; do not guess endpoints). Support `--chunks N` to split the buy into N swaps. Record every `swapSigs` entry in the round file right after each swap.
2. **Measure.** The amount of $ROT bought is the pot wallet's token balance after minus before (plus the previous `remainderBase`), never the quote. Write `rotBoughtBase`.
3. **Split.** Divide the $ROT among payable wallets by points in integer base units (floor). The remaining base units are written to `remainderBase` and carried to the next round.
4. **Send.** Create any missing token accounts for the recipients (idempotent), then send SPL transfers in batched transactions. Write each `sig` as it lands. When all are sent, set the status to `paid`.
The script must be **resumable and never double-spend**: if it stops after the swap, rerunning must not buy again (it sees `swapSigs`) and must send only the transfers that have no `sig`. Add `.gitignore` entries for keypair files.

### Site behavior for rounds
- **This round** tab: round number, countdown, pot wallet SOL balance read live from the chain, points so far (computed from `ledger.json` for the open round, plus carried points), top wallets, per copy deck 7.1. The pot wallet's $ROT balance is not shown as part of the pot.
- **Past rounds** tab and round detail: read `rounds/index.json` and each round file; show the buy (with its `swapSigs` links), the payouts and the carried wallets.
- **Your rot** panel: for a connected or pasted address, show points this round and all time, and the $ROT received (sum of that wallet's `rotBase` in paid rounds).
- Home counters: `bags rotted` is the count of burns with `counted: true`; `$ROT paid out` is the sum of `rotBase` in paid rounds, formatted with the token's decimals read from the chain. Both show `0` when empty.
- All numbers come from the files and the chain. Never type any number by hand and never show a USD value.

### Rule card gating
Show the "One rule" card only when `feeRuleLocked` is `true` **and** `potWallet` is set. Otherwise show the pre-launch line from the copy deck. The site can't check the fee lock itself, so the owner turns this flag on by hand after checking the launch platform. Say so in the README.

### Config
Follow section 14 of the copy deck exactly. **Every link and contract field is a config variable and is hidden when empty**: `ca`, `x`, `telegram`, `repo`, `binAddress`, `potWallet`. Do not hard-code any address.

### Token facts strip (only when `ca` is set)
Read the mint account from the chain and show `Renounced` for mint authority or freeze authority **only if** the parsed value is `null`. If the read fails, show `Couldn't read`. Never type these claims by hand.

### What is not possible on static hosting (say this plainly in the README and in the risk box)
- No shared database, so the ledger and rounds are files the operator rebuilds and commits. They aren't live by themselves.
- The buy and the payouts are made by the project from the pot wallet using `pay-round.mjs`. They aren't trustless or automatic. Holders trust the operator to run them. Every buy and transfer is a public transaction and every round file is public.
- The buy happens on a public market with slippage, and it is itself market activity. Burners receive $ROT, not SOL, and some will sell it.
- The fee lock is set on the launch platform and can't be verified by the site. The owner confirms it.
- A burn proves a wallet destroyed a token. It doesn't prove the token was worth anything or that the wallet is a unique person.

---

## Part 4: Design (direction A, "Greenhouse night")

### Palette (CSS variables)
```
--bg:        #0F1D17   page
--soil:      #16281F   soil strip, cards
--deep:      #2A5E4D   coin body
--mid:       #4FA88A   verdigris patches
--green:     #6FC3A3   accent, links, CTA
--bone:      #E9E5D2   primary text
--muted:     #8FB5A3   secondary text, labels
--pit:       #0B1410   cracks, pits
--danger:    #D98B6A   errors only
```
Text contrast must meet WCAG AA on `--bg` and `--soil`. Check it and adjust a value if one fails.

### Type
- Headlines: a variable serif such as Fraunces (italic for the accent phrase), self-hosted or from Google Fonts with `display=swap`.
- UI and labels: a mono such as JetBrains Mono or IBM Plex Mono.
- Sentence case everywhere except the wordmark.

### Hero layout
Left column: eyebrow, headline, lede, two CTAs, the two counters, the round chip. Right: the coin scene. A soil strip runs along the bottom of the hero with the stage labels (`fresh · tarnished · cracked · dust · sprout`) and a sprout at the right edge. Below the hero: the four-fact strip.

### Signature scene: the corroding coin (Three.js)
- One hard-surface coin: a short cylinder with beveled rim, a raised ring and a raised letter R on both faces. Generate the relief from a canvas (draw ring and R, use it as a height map, derive a normal map). No external model files.
- Rot level `uRot` from 0 to 1 drives a shader (extend `MeshStandardMaterial` with `onBeforeCompile`, or write a `ShaderMaterial`; your call, state it):
  1. **0.0 to 0.25 tarnish**: warm bronze darkens, fine noise.
  2. **0.25 to 0.5 verdigris**: fbm-noise patches of `--mid` and `--green` grow from the rim and the recesses.
  3. **0.5 to 0.75 cracks and pits**: voronoi-edge cracks, dark pits, rim edge erodes with alpha cutout and a dark edge line.
  4. **0.75 to 0.95 dust**: the coin breaks down. Surface erodes away while instanced dust particles fall to a soil plane.
  5. **0.95 to 1.0 sprout**: a small sprout (tube stem, two leaf meshes, scale-in animation) grows from the dust pile.
- `uRot` is driven by scroll position across the home page (scrubbed, reversible), and by a **Drop a bag** interaction on the Bin page: when a burn is confirmed, the coin on that page jumps one stage.
- Lighting: one warm key light, one cool fill, soft ambient. Slow idle rotation and a small parallax on pointer move. Cap pixel ratio at 2.
- Fallback: if WebGL is unavailable or `prefers-reduced-motion` is set, show a static SVG coin at the current stage and no scroll scrubbing. The rest of the site must work in that mode.
- Pause rendering when the tab is hidden or the canvas is off screen.

### Motion language
Slow and organic. Eased fades and small upward drifts (8 to 16 px) on reveal. No bounce, no glitch, no neon. Respect `prefers-reduced-motion` everywhere.

### Logo and favicon
Use `rot-logo.svg` as the mark. Export a 32 px favicon and an `apple-touch-icon` from it. Inline the SVG in the nav at 28 px.

---

## Part 5: Quality rules

### Truth rules (non-negotiable)
- Say only what is verified. Prefer facts read live from the chain, DexScreener or the round files over typed claims.
- No promises of price, returns or profit. No expected payout, no "you could earn", no APY, no USD values. A round's pot can be small or zero; say so where the copy deck does.
- No invented holder counts, partners, listings, dates or deadlines. No fake burns, wallets, rounds, payouts or counters. All data files ship empty.
- The payout wording must stay honest about who sends the money: the project runs the buy and the transfers from the pot wallet.
- Never say the payouts support, lift, defend or protect the price, never promise what a share will be worth, and never say holders "will hold more". The true description: the pot buys $ROT on the market and sends it to the burners, in public transactions. The site shows what was paid, not what it will be worth.
- The refund of rent when closing an empty token account is a real property of the chain. Keep the wording ("about 0.002 SOL for a standard token account") and note in the README that the amount varies by token program.
- The footer risk line from the copy deck appears on every page.

### Engineering
- Config object with the empty-value-hides-element behavior for every link and address.
- Escape every string that comes from the chain, DexScreener, data files or the user with `esc` before putting it in the DOM. Token names and symbols are attacker-controlled.
- Validate addresses (base58, length) before any RPC call.
- Handle the failure modes in copy deck section 12: no wallet, wrong network, offline, RPC rate limit, DexScreener failure, round files missing, WebGL missing, JS disabled (`<noscript>`).
- RPC: default to the public endpoint from config, batch where possible, retry with backoff on 429, never fire more than a few requests per second. Scripts accept an `--rpc` option so the operator can use a private endpoint.
- Keyboard accessible: visible focus, correct roles on tabs and dialogs, focus trap in the wallet modal, `aria-live` for toasts and scan progress.
- Mobile first: usable at **320 px** wide. The coin scene shrinks and sits above the headline on narrow screens. Tables become stacked rows.
- `prefers-reduced-motion` disables scroll scrubbing, parallax and particles.
- Works under a subpath on GitHub Pages: no absolute `/` URLs, hash routing for pages and round views, no server rewrites.
- Performance targets: first paint of the hero text under 1.5 s on a mid phone with the 3D scene loading after; total JS you author under 150 KB before libraries; fonts subsetted.
- No analytics, no third-party trackers.

### Tests
- Write small Node tests (plain `node --test`) for the pure functions: address validation, classification, **every eligibility rule one by one**, point counting with the per-round cap, round boundaries, **payable wallets and the minimum payout, spend equals the sum of payable shares plus the rent reserve, the $ROT split in integer base units with the remainder carried, carried points for wallets under the minimum, zero-point rounds (nothing is bought)**, burn parsing with and without the bin reference key, and summing refundable lamports for empty accounts. Add tests for: parsing a burn that carries the bin reference key, rejecting a burn that doesn't, and resume-after-swap in `pay-round.mjs` (no second buy). Use recorded fixtures, not live network calls.
- Test `pay-round.mjs` in dry run: it must refuse when the keypair doesn't match `potWallet`, before the challenge window ends, when the round is already paid, when the plan exceeds the balance, and when the price impact exceeds `maxPriceImpactPct`.
- Run the site in a headless browser if one is available. At 320 px, 768 px and 1280 px: no horizontal scroll, no overlap, the coin visible, all four pages and the four ledger tabs reachable. Take screenshots of each page at 320 and 1280 and look at them before you report.
- Test the reduced-motion and no-WebGL paths, and the empty-data states (all files empty).
- If the burn, close and payout flows can be tested on devnet or with a local validator, do so and report it. If not, say it is untested.

### Packaging
```
ROT/
  index.html
  ledger.json
  blocklist.json
  rounds/index.json
  assets/        (logo, favicon, og image placeholder)
  vendor/        (only if you vendored libraries)
  tools/build-ledger.mjs
  tools/build-round.mjs
  tools/pay-round.mjs
  test/          (node tests and fixtures)
  .gitignore     (keypairs, node_modules)
  README.md
```
`README.md` states: what ROT is and the one rule, how to configure `ROT_CONFIG`, how to deploy to GitHub Pages under a subpath, the full operator runbook for a round (build ledger, build round, wait out the challenge window, dry run, send), the eligibility rules, and a **Limitations** section that repeats the four points from "What is not possible on static hosting", the residual farming risk, and lists what is untested.

### Final checks before you report
1. Grep for leftover Absorb words (command in Part 1). Zero hits or justified.
2. Grep the whole project for claims: `grep -rinE "moon|100x|guarantee|profit|returns|airdrop|giveaway|reward|passive|apy|earn" --include=*.html --include=*.md --include=*.js --include=*.mjs .` and fix or justify each hit.
3. Check that the ticker is spelled **$ROT** everywhere and nowhere as another form.
4. Confirm every link and address field is read from `ROT_CONFIG`, and that empty values hide their elements.
5. Confirm there is no metaball, `MarchingCubes` or blob geometry anywhere in the scene code.
6. Confirm no private key, keypair or seed phrase is in the repo, in any fixture or in any log.

### End by giving me a short summary
Two lists: **verified live** (what you actually ran against the real chain, DexScreener or a browser) and **mocked or untested** (fixtures, devnet only, not run). Include screenshot paths. Do not claim anything works unless you ran it.
