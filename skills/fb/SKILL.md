---
name: fb
description: FlareBank protocol — all-in-one. Dashboard, mint/burn BANK, claim/compound dividends, price checker. Triggers on "/fb", "/fbdashboard", "/bankrate", "flarebank", "bank token", "mint bank", "burn bank", "bank price", "bank rate".
---

# FlareBank Skill (Unified)

All FlareBank operations in one skill.

## Quick Command

```bash
node skills/fb/scripts/fb.js <command> [options]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `dashboard` | Full protocol analytics (TVL, supply, rewards, validators, activity) |
| `status` | Vault status, balances, pending dividends |
| `mint <amount>` | Mint BANK by depositing FLR |
| `burn <amount>` | Burn BANK to withdraw FLR |
| `claim` | Claim pending dividends to wallet |
| `compound` | Compound dividends into more BANK |
| `bankrate` | BANK price comparison — LP market vs contract mint/burn rates |

## Command Aliases

| Trigger | Maps To |
|---------|---------|
| `/fbdashboard` | `/fb dashboard` |
| `/bankrate` | `/fb bankrate` |
| `/fb stats` | `/fb dashboard` |
| `/fb sell` | `/fb burn` |
| `/fb buy` | `/fb mint` |
| `/fb withdraw` | `/fb claim` |
| `/fb reinvest` | `/fb compound` |
| `/fb rate` | `/fb bankrate` |
| `/fb price` | `/fb bankrate` |

## Usage Examples

```bash
/fb dashboard        # Full protocol overview
/fb status           # Vault balances + pending divs
/fb mint 100         # Mint BANK with 100 FLR
/fb burn 10          # Burn 10 BANK for FLR
/fb claim            # Claim dividends
/fb compound         # Compound dividends
/fb bankrate         # LP vs contract price comparison
```

## ⚠️ Dashboard Output Rules

When running `/fb dashboard` or `/fbdashboard`:
1. Run: `node skills/fb/scripts/fb.js dashboard`
2. **Copy-paste the ENTIRE output** — every table, every section
3. Do NOT summarize, truncate, or add commentary

## Dashboard Sections

- **📈 PROTOCOL TVL** — FB Main, DAO Treasury, LP WFLR, IBDP queue
- **🏦 BANK TOKEN** — Supply, circulating, price, mint/burn prices, backing
- **🏛️ DAO TREASURY** — All token holdings with WFLR valuations
- **💧 LP POSITIONS** — Enosys V2, SparkDex V2, V3 details
- **🌾 CDP EARN POOLS** — Deposits, pending yield, liquidation collateral
- **🎁 PENDING REWARDS** — CDP yield and collateral claimable
- **🥩 APS STAKING** — DAO staked APS, held APS
- **🔒 rFLR VESTING** — Vested vs unvested
- **🪂 FLAREDROP CLAIMS** — DAO, IBDP, FB Main (All Time/30d/7d/24h)
- **📊 FTSO DELEGATION REWARDS** — Per source, per period
- **🏛️ FTSO PROVIDER FEES** — Provider fee breakdown
- **🔐 VALIDATOR FEES CLAIMED** — Self-bond + operation fees
- **🌐 FTSO** — Total WFLR delegated
- **🔐 VALIDATORS** — Stake, delegation, uptime, expiry
- **💰 PROVIDER EARNINGS** — Estimated per epoch/month/year
- **🏭 MINT/🔥 BURN/📤 TRANSFER/🔄 SWAP STATISTICS** — Activity + fee distribution
- **📋 SUPPLY SUMMARY** — Current, minted, burned
- **💱 PRICES** — FXRP, stXRP, sFLR, FLR/USD

## Bankrate Output

- **LP Price** — BANK/WFLR from Enosys V2 pool reserves
- **Contract Buy Price** — Mint rate
- **Contract Sell Price** — Burn rate
- **Spread** — Buy vs sell difference
- **LP vs Contract** — Premium/discount analysis

## Protocol Overview

### How BANK Works
1. **Minting:** Send FLR → receive BANK at `buyPrice()` rate
2. **Burning:** Send BANK → receive FLR at `sellPrice()` rate
3. **Spread:** Buy price > sell price (value accrual)
4. **Dividends:** 10% fee on all activity → distributed to holders
5. **Compounding:** `reinvest()` auto-buys BANK with pending divs

### Fee Structure

| Action | Fee | Distribution |
|--------|-----|--------------|
| Mint | 10% of WFLR | 80% holders, 15% team, 5% DAO |
| Burn | 10% of WFLR | 80% holders, 15% team, 5% DAO |
| Transfer | 1% burn + 1% fee | 80% holders, 15% team, 5% DAO |
| LP Swap | 1% burn + 1% fee | 80% holders, 15% team, 5% DAO |

## Contract Reference

| Contract | Address |
|----------|---------|
| BANK Token (FB Main) | `0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059` |
| IBDP | `0x90679234fe693b39bfdf5642060cb10571adc59b` |
| DAO Treasury | `0xaa68bc4bab9a63958466f49f5a58c54a412d4906` |
| Enosys V2 BANK/WFLR | `0x5f29c8d049e47dd180c2b83e3560e8e271110335` |

## Function Selectors

| Function | Selector |
|----------|----------|
| `buy(address)` | `0xf088d547` |
| `sell(uint256)` | `0x35a4f939` |
| `withdraw()` | `0x3ccfd60b` |
| `reinvest()` | `0xfdb5a03e` |
| `buyPrice()` | `0x8620410b` |
| `sellPrice()` | `0x4b750334` |

## Keystore

Default: `./keystore.json` (set via AGENT_KEYSTORE)
Agent wallet: (set via AGENT_WALLET env var)

---

## Routing Guide

### Use when...
- Any FlareBank-related query: dashboard, minting, burning, prices, analytics
- `/fb`, `/fbdashboard`, `/bankrate` commands
- "bank price", "bank rate", "flarebank", "mint bank", "burn bank"

### Don't use when...
- Managing LP positions (use `/lp` or `/fblpmanager`)
- General token prices unrelated to BANK (use `/price`)

### Edge Cases
- Dashboard output is intentionally long — send ALL tables
- Script may take 10-20s due to many RPC calls
- Contract includes 10% mint/burn fee — always account for it
- LP price can diverge from contract during low liquidity
