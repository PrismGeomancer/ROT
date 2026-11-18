# ROT copy deck

Ticker: **$ROT** (exact spelling, three letters, capitals). Name on the site: `rot` (lowercase wordmark) or ROT in running text.
Voice: dry, specific, a little gross in a funny way. Short sentences. No hype words, no price talk, no promises.
Italic accent phrases are marked with *asterisks*. Every string below must be set in the page, including strings set from JS.

**The one rule:** 100% of $ROT's creator fees go to one public pot wallet. Every round, the pot buys $ROT on the market and sends it to the wallets that burned dead tokens, by ledger points. The rule is set at launch and locked. The fee does one job: it buys $ROT for the burners.

Placeholders in `{{double braces}}` come from the config object or from data files. If the value is empty or missing, the element that uses it is hidden or shows its pre-launch text.

**Truth gates for copy:**
- The rule card (section 6) shows only when `CFG.feeRuleLocked` is `true`. The owner sets it after checking the lock on the launch platform.
- Pot balances come from the chain. Round results come from `rounds/*.json`. Nothing is typed by hand.
- Never show a USD value, an APY, an expected payout, a "you could earn" line or any claim about what the $ROT you receive will be worth.

---

## 1. Meta

| Field | Text |
|---|---|
| `<title>` | `ROT: Dead bags rot. Rot feeds the next.` |
| meta description | `Burn the dead coins in your wallet. Every round, the fee pot buys $ROT and sends it to the wallets that burned. Every burn and payout is public.` |
| og:title | `ROT: Dead bags rot.` |
| og:description | `Rot feeds the next.` |
| twitter:title | `ROT` |
| h1 (screen reader) | `ROT: dead bags rot, and the rot feeds the next.` |

---

## 2. Loader

| Element | Text |
|---|---|
| Loader line | `Warming the greenhouse…` |
| Loader skip (appears after 4 s) | `Skip` |
| Reduced-motion loader | `Loading…` |

---

## 3. Nav and chrome

| Element | Text |
|---|---|
| Wordmark | `rot` |
| Nav links | `How` · `Bin` · `Ledger` |
| Connect button (idle) | `Connect` |
| Connect button (connected) | `{{short address}}` |
| X link | `X` |
| Sound toggle (off by default) | `Sound off` / `Sound on` |
| Skip link | `Skip to content` |

---

## 4. Home (hero)

| Element | Text |
|---|---|
| Eyebrow | `A compost heap for dead coins` |
| Headline | `Dead bags rot.`<br>`*Rot feeds the next.*` |
| Lede | `Burn the dead coins in your wallet. Every burn goes on a public ledger, and every round the fee pot buys $ROT and sends it to the wallets that burned.` |
| Primary CTA | `Open the bin` |
| Secondary CTA | `How it works` |
| Scroll hint | `Scroll to age the coin` |
| Counter label (left) | `Bags rotted` |
| Counter label (right) | `$ROT paid out` |
| Counter values | `bags rotted` from the ledger (burns with `counted: true`). `$ROT paid out` is the sum of `rotBase` in paid round files, shown with the token's decimals read from the chain. Both are `0` until the first round is paid. |
| Counter note (small) | `Counted from the public ledger and round files.` |
| Round chip (shown when `roundStart` is set) | `Round {{n}}  ·  ends in {{time}}` |

### Coin stage captions (appear as the coin ages with scroll or burn)

| Stage | Caption |
|---|---|
| 0 | `Fresh. Somebody paid full price for this.` |
| 1 | `Tarnished. The chart stopped answering.` |
| 2 | `Cracked. Nobody posts about it anymore.` |
| 3 | `Dust. Gone from every watchlist.` |
| 4 | `Sprout. Something has to grow from this.` |

### Home strip (four short facts, below the hero)

| Heading | Body |
|---|---|
| `Find` | `Connect a wallet and ROT lists every token in it that looks dead.` |
| `Burn` | `You burn them from your own wallet. Closing the emptied account also refunds its rent.` |
| `Count` | `Every burn through the bin goes on a public ledger. One point for each distinct token.` |
| `Pay` | `Every round the fee pot buys $ROT and sends it to the wallets that burned, by points.` |

---

## 5. Bin page (tool)

### 5.1 Header

| Element | Text |
|---|---|
| Route label | `The bin` |
| Heading | `Drop a dead bag in.` |
| Lede | `Connect a wallet or paste an address. ROT reads the tokens in it and marks the ones that look dead. Reading costs nothing and moves nothing.` |
| Address field placeholder | `Paste a Solana address` |
| Read button | `Read wallet` |
| Trust row (three ticks) | `Reading never moves funds` · `Burning is always your signature` · `You see every mint before you sign` |

### 5.2 Scan states

| State | Text |
|---|---|
| Idle | `Connect a wallet or paste an address to start.` |
| Scanning | `Reading your tokens…` |
| Checking market data | `Checking {{n}} of {{total}} tokens…` |
| Empty wallet | `No tokens in this wallet. Nothing to rot.` |
| No dead bags | `Nothing here looks dead. Your bags are all still breathing.` |
| Summary line | `{{dead}} look dead, {{alive}} look alive, {{unknown}} unclear.` |

### 5.3 Table columns and status labels

Columns: `Token` · `Balance` · `Status` · `Counts?`

| Status | Label | Why text |
|---|---|---|
| dead | `Looks dead` | `No pair found.` / `Liquidity under {{minLiquidityUsd}} USD.` / `No trades in the last 24 hours.` |
| alive | `Looks alive` | `Has a pair with liquidity and recent trades.` |
| unknown | `Unclear` | `Market data didn't load. Check it yourself.` |

| Counts? | Label | Reason text |
|---|---|---|
| yes | `Should count` | `Listed before, old enough, looks dead.` |
| no | `Won't count` | `Never had a pair.` / `Pair is under {{minPairAgeDays}} days old.` / `Over the {{maxMintsPerRound}} token cap for this round.` / `Already burned from this wallet.` / `Looks alive.` |
| unsure | `We'll see` | `Can't tell yet. Final checks run when the round is built.` |

Small print under the table: `"Looks dead" and "Should count" are guesses from public market data. The final check runs when the round is built. Burning is permanent, so check each token first.`

### 5.4 Selecting and burning

| Element | Text |
|---|---|
| Select all that should count | `Select all that should count` |
| Selected count | `{{n}} selected` |
| Burn button | `Burn {{n}} bags` |
| Burn button (nothing selected) | `Pick a bag to burn` |
| Burn disabled (config off) | `Burning opens at launch` |
| Preview heading | `You're about to burn` |
| Preview line | `{{amount}} {{symbol}}  ·  {{mintShort}}` |
| Preview note 1 | `This transaction only burns the tokens above and closes their empty accounts.` |
| Preview note 2 | `Closing an account refunds its rent to you, about 0.002 SOL for a standard token account.` |
| Preview note 3 | `Burned tokens can't be recovered.` |
| Preview note 4 | `The transaction also carries the public bin address and a short note, so your burn shows up on the ledger.` |
| Preview note 5 | `Points are decided when the round is built. A burn that doesn't pass the checks stays on the ledger with a reason, and gets no points.` |
| Confirm | `Sign in your wallet` |
| Cancel | `Back` |
| Waiting for wallet | `Waiting for your wallet…` |
| Sent | `Burn sent. Waiting for confirmation…` |
| Confirmed | `Burned. It's rotting now.` |
| Result card heading | `Rot report` |
| Result card line | `{{n}} bags rotted by {{short address}}` |
| Result card footer | `It shows up on the ledger once the next update is published.` |
| Share button | `Share the report` |
| Download button | `Download card` |
| Copy link | `Copy link` |

### 5.5 Close empty accounts

| Element | Text |
|---|---|
| Heading | `Empty accounts still hold rent.` |
| Lede | `Every token account you opened keeps a small deposit, even at zero balance. Close the empty ones and it comes back to you.` |
| Summary line | `{{n}} empty accounts  ·  {{sol}} SOL refundable` |
| Summary note | `Counted from the lamports those accounts actually hold.` |
| Button | `Close {{n}} accounts` |
| Button (none) | `No empty accounts` |
| None state | `No empty accounts. Your wallet is already tidy.` |
| Button (config off) | `Closing opens at launch` |
| Preview heading | `You're about to close` |
| Preview line | `{{symbol}}  ·  {{mintShort}}  ·  {{sol}} SOL` |
| Preview note | `This transaction only closes the empty accounts listed. Nothing is burned. The rent refund goes to your wallet.` |
| Waiting for wallet | `Waiting for your wallet…` |
| Sent | `Sent. Waiting for confirmation…` |
| Confirmed | `Closed {{n}} accounts. {{sol}} SOL refunded.` |
| Points note | `Closing empty accounts doesn't add points. The refund is yours to keep.` |

### 5.6 Your points (shown when an address is connected or pasted)

| Element | Text |
|---|---|
| Heading | `Your rot` |
| Line 1 | `{{points}} points this round  ·  {{share}} of all points` |
| Line 2 | `{{totalPoints}} points all time  ·  {{paid}} $ROT received in past rounds` |
| Empty | `No burns from this wallet yet.` |
| Note | `Your share of a round is your points divided by all points in that round. What it's worth depends on the fees the pot collected and on the price of $ROT when the pot buys, and both can be low or zero.` |

---

## 6. How it works

| Element | Text |
|---|---|
| Route label | `How it works` |
| Heading | `Five steps.`<br>`*One pot.*` |
| Lede | `ROT burns dead coins, counts them in public and splits one fee pot by those counts. This is what it does and what it doesn't.` |

| Step | Title | Body |
|---|---|---|
| 1 | `Find your dead bags` | `ROT reads the token accounts in your wallet and checks each token against public market data. Tokens with no pair, almost no liquidity or no recent trades are marked as looking dead.` |
| 2 | `Burn them` | `You burn the ones you choose from your own wallet. ROT builds the transaction and shows every mint first. It contains burn and close-account instructions and nothing else.` |
| 3 | `The ledger finds it` | `Every burn through the bin carries the public bin address. ROT reads that address, checks each burn on-chain and lists it with the reason it counted or didn't.` |
| 4 | `The round closes` | `Each round lasts {{roundLengthDays}} days. When it ends, ROT publishes the points table. For {{challengeHours}} hours anyone can point at a burn that shouldn't count.` |
| 5 | `The pot buys $ROT` | `The pot wallet holds the fees $ROT's trading creates. After the challenge window, it buys $ROT on the market and sends it to the wallets that burned, divided by points. Every buy and every transfer is a public transaction on the ledger.` |

### The rule (card, shown only when `feeRuleLocked` is true)

| Element | Text |
|---|---|
| Heading | `One rule` |
| Body | `100% of $ROT's creator fees go to the pot wallet. Nobody takes a cut. It was set at launch and locked, so nobody can change it, us included. Every round the pot buys $ROT and sends it to the wallets that burned.` |
| Link | `Check the pot wallet` |

Pre-launch, instead of the rule card:
`The rule will be written here before the first round, not after.`

### Rules cards

| Heading | Body |
|---|---|
| `One point per token` | `Burning ten of the same token is still one point. Ten different dead tokens is ten.` |
| `Looks dead` | `A token counts only if the market data says it's dead: no pair, liquidity under {{minLiquidityUsd}} USD, or no trades in 24 hours.` |
| `Had to exist` | `The token must have had a trading pair at least {{minPairAgeDays}} days before you burned it. Tokens that were never listed don't count.` |
| `Not your own` | `Tokens your wallet created or controls don't count.` |
| `Round cap` | `At most {{maxMintsPerRound}} tokens per wallet in each round. This keeps one wallet from flooding the heap.` |
| `Paid in $ROT` | `Payouts are $ROT, bought on the market with the pot. The site shows what was paid, not what it will be worth.` |
| `Minimum payout` | `A wallet is paid only when its share is worth at least {{minPayoutSol}} SOL. Smaller shares aren't sent, and their points carry into the next round.` |
| `Account costs` | `If your wallet has never held $ROT, the project opens the token account. That cost comes out of the pot, not your share.` |
| `Published, not hidden` | `The ledger, the rounds and the rules for counting are public files in the repo. If a rule changes, it changes in public.` |

### Risk box

`Be honest about the risks.` A token that looks dead can come back, and burning it is permanent. Someone can also mint a worthless token and burn it for points. The listing check, the age check, the creator check, the round cap and a public blocklist are the defenses, and none of them is perfect. Payouts are $ROT, and what it's worth can fall after you receive it. The pot buys on a public market, so the buy has slippage and is itself market activity. The project runs the buy and the transfers from the pot wallet. They aren't automatic, and you're trusting us to run them. Every one is a public transaction you can check. Fees can be small or zero, and ROT isn't a promise that anything pays out or financial advice.

---

## 7. Ledger

| Element | Text |
|---|---|
| Route label | `Ledger` |
| Heading | `Everything that`<br>`*has rotted.*` |
| Lede | `Every burn that passed through the bin, newest first. Each row says whether it counted and why.` |
| Source note | `Found by reading the public bin address {{binShort}}.` |
| Tabs | `This round` · `Burns` · `Wallets` · `Past rounds` |

### 7.1 This round

| Element | Text |
|---|---|
| Heading | `Round {{n}}` |
| Ends line | `Ends in {{time}}` |
| Pot line | `Pot wallet  ·  {{sol}} SOL` |
| Pot note | `Fees collect here. When the round is paid, the pot buys $ROT.` |
| Points line | `{{totalPoints}} points from {{walletCount}} wallets` |
| Top wallets heading | `Most rot this round` |
| Top wallets columns | `Rank` · `Wallet` · `Points` · `Share` |
| Pre-launch | `The first round starts when the token is live.` |
| Between rounds | `Round {{n}} is closed. Challenge window ends in {{time}}.` |
| No points yet | `No points yet. The first bag decides the whole round.` |

### 7.2 Burns

| Element | Text |
|---|---|
| Columns | `When` · `Wallet` · `Token` · `Amount` · `Counted` · `Transaction` |
| Counted | `Counted` / `Not counted` |
| Reasons | `Never had a pair` · `Pair too new` · `Created by this wallet` · `Over the round cap` · `Looks alive` · `Blocklisted` · `Not a full burn` |
| Row action | `View transaction` |
| Empty state heading | `Nothing has rotted yet.` |
| Empty state body | `The first bag goes in here.` |
| Empty state CTA | `Open the bin` |
| Updated line | `Ledger updated {{time}}.` |
| Load error | `Couldn't load the ledger. Try again in a minute.` |

### 7.3 Wallets

| Element | Text |
|---|---|
| Columns | `Rank` · `Wallet` · `Tokens rotted` · `Points` · `Received` |
| Note | `Points are all-time. Received is the $ROT sent to the wallet in completed rounds.` |

### 7.4 Past rounds

| Element | Text |
|---|---|
| Columns | `Round` · `Dates` · `Pot spent` · `Wallets paid` · `Points` · `Details` |
| Detail link | `View round` |
| Round page heading | `Round {{n}}` |
| Round facts | `Pot spent: {{sol}} SOL` · `$ROT bought: {{tokens}}` · `Total points: {{points}}` · `Wallets paid: {{n}}` · `Carried to the next round: {{n}} wallets` |
| Payout row | `{{walletShort}}  ·  {{points}} points  ·  {{tokens}} $ROT  ·  View transaction` |
| Buy row | `Bought {{tokens}} $ROT for {{sol}} SOL  ·  View transaction` |
| Status labels | `Open` · `Closed` · `In challenge window` · `Paid` |
| Empty state | `No rounds have been paid yet.` |
| Removal note | `Removed after the challenge window: {{reason}}` |

---

## 8. Reserved

No specimen page in this version.

---

## 9. Token facts strip (shown only when `CFG.ca` is set)

| Element | Text |
|---|---|
| Label | `$ROT` |
| Contract line | `Contract  ·  {{short ca}}` |
| Copy button | `Copy contract` |
| Copied toast | `Contract copied` |
| Mint authority row | `Mint authority  ·  Renounced` or `Mint authority  ·  Active` |
| Freeze authority row | `Freeze authority  ·  Renounced` or `Freeze authority  ·  Active` |
| Authority note | `Read live from the chain.` |
| Links | `Chart` · `Explorer` |

Show `Renounced` only when the chain returns null for that authority. If the read fails, show `Couldn't read`.

---

## 9b. Pre-launch states (when `CFG.ca` is empty)

| Element | Text |
|---|---|
| Contract strip | hidden |
| Home note under the CTA | `Token not live yet. The bin works with any wallet.` |
| Round chip and counter `Paid out so far` | hidden |
| Rule card | replaced by the pre-launch line in section 6 |
| Footer line | `$ROT isn't live yet.` |

---

## 10. Wallet connect modal

| Element | Text |
|---|---|
| Heading | `Connect a wallet` |
| Body | `Pick a Solana wallet. ROT reads your address and token balances. It asks for a signature only when you choose to burn or close accounts.` |
| Wallet options | `Phantom` · `Solflare` · `Backpack` |
| Not installed | `{{wallet}} isn't installed. Get it` |
| Close | `Close` |
| Rejected | `You closed the request. Nothing was sent.` |
| Disconnect | `Disconnect` |

---

## 11. Toasts

| Trigger | Text |
|---|---|
| Wallet connected | `Wallet connected` |
| Wallet disconnected | `Disconnected` |
| Address pasted, invalid | `That doesn't look like a Solana address.` |
| Scan failed | `Couldn't read that wallet. Try again.` |
| RPC rate limited | `The network is busy. Wait a few seconds and try again.` |
| Market data failed | `Market data didn't load. Statuses may be unclear.` |
| Burn rejected | `Burn cancelled. Nothing was sent.` |
| Burn failed | `The burn didn't go through. Your tokens are untouched.` |
| Close accounts rejected | `Cancelled. Nothing was sent.` |
| Close accounts failed | `The close didn't go through. Your accounts are untouched.` |
| Bin address missing | `The bin isn't set up yet. Burning stays closed.` |
| Link copied | `Link copied` |
| Card downloaded | `Card downloaded` |
| Sound on | `Sound on` |

---

## 12. Error and edge states

| State | Text |
|---|---|
| No wallet detected (connect) | `No wallet found. Paste an address instead.` |
| Wrong network | `Switch your wallet to Solana mainnet.` |
| Offline | `You're offline. Reconnect and try again.` |
| Round files missing | `Couldn't load the round data. Try again in a minute.` |
| 404 / unknown route | `Nothing to see here.` with link `Back to the heap` |
| JS disabled | `ROT needs JavaScript to read the chain.` |
| WebGL unavailable | `Your browser can't draw the coin. The rest of ROT still works.` (show a static coin image) |

---

## 13. Footer and small print

| Element | Text |
|---|---|
| Footer left | `rot  ·  dead bags rot` |
| Footer links | `X` · `Telegram` · `Repo` (each hidden when its config value is empty) |
| Risk line | `Not financial advice. Meme coins can lose all their value. Verify the contract on the official X.` |
| Data line | `Market data from DexScreener. Chain data from the Solana public RPC.` |
| Copyright | `rot` |

---

## 14. Config object (strings and fields the page reads)

```js
window.ROT_CONFIG = {
  ca: "",                // $ROT contract address. Empty hides the facts strip and the round chip.
  x: "",                 // official X link
  telegram: "",
  repo: "",
  binAddress: "",        // public bin address added to every burn; empty keeps burning closed
  potWallet: "",         // public pot wallet that receives the creator fees; empty hides pot lines
  feeRuleLocked: false,  // owner sets true only after checking the lock on the launch platform
  roundStart: "",        // ISO date (UTC) when round 1 starts; empty shows the pre-launch text
  roundLengthDays: 7,
  challengeHours: 48,
  minLiquidityUsd: 500,
  minPairAgeDays: 7,
  maxMintsPerRound: 25,
  minPayoutSol: 0.01,    // a wallet is paid only if its share is worth at least this much
  maxPriceImpactPct: 3,  // pay-round refuses a swap above this price impact
  rpc: "https://api.mainnet-beta.solana.com",
  ledgerUrl: "./ledger.json",
  roundsUrl: "./rounds/index.json",
  burnEnabled: false     // keeps burn and close buttons closed until tested
};
```

---

## 15. Seed content rules

- `ledger.json` ships **empty**: `{"updated": null, "bin": "", "burns": []}`. `rounds/index.json` ships empty: `{"rounds": []}`. No example wallets, no fake burns, no sample numbers, no sample payouts.
- For design review, use a clearly labelled `?demo=1` URL parameter that fills the ledger and one round with obviously fictional rows marked `Demo`, and show a banner `Demo data. Nothing here is real.` Demo mode never writes to local storage and never runs on the production URL.
