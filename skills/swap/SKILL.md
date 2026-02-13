---
name: swap
description: Token swaps on Flare DEXs. Execute swaps, get quotes, wrap/unwrap FLR. Triggers on "/swap", "swap tokens", "trade", "exchange".
---

# Swap Skill

Unified interface for token swaps on Flare network DEXs.

## Quick Command

```bash
node skills/swap/scripts/swap.js <from> <to> <amount>
```

## Subcommands

| Command | Description |
|---------|-------------|
| `(default)` | Enosys V3 swap (most liquidity) |
| `agg` | Aggregator - compares DEXs, routes to best |
| `spark` | SparkDex V3.1 swap |
| `v2` | V2 swap (for BANK token) |
| `quote` | Get quote without executing |
| `wrap` | Wrap FLR to WFLR |
| `unwrap` | Unwrap WFLR to FLR |

## Aggregator (Best Rates)

The aggregator compares quotes from Enosys V3 and SparkDex V3.1, then routes to the best venue:

```bash
# Get aggregated quote
node skills/swap/scripts/aggregator.js quote WFLR FXRP 100

# Execute via best route
node skills/swap/scripts/aggregator.js swap WFLR FXRP 100 --slippage 2
```
| `pools` | List available V3 pools |

## Usage Examples

```bash
# Basic V3 swap (Enosys - default)
/swap WFLR FXRP 100

# Use specific fee tier
/swap WFLR SFLR 50 --fee 500

# SparkDex swap
/swap spark WFLR USDT0 100

# V2 swap for BANK
/swap v2 WFLR BANK 10
/swap v2 BANK WFLR 1

# Get quote only (no execution)
/swap quote WFLR FXRP 100

# Wrap/unwrap FLR
/swap wrap 100
/swap unwrap 100

# With slippage tolerance
/swap WFLR FXRP 100 --slippage 2
```

## Supported Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| WFLR | `0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d` | 18 |
| sFLR | `0x12e605bc104e93B45e1aD99F9e555f659051c2BB` | 18 |
| FXRP | `0xad552a648c74d49e10027ab8a618a3ad4901c5be` | 6 |
| BANK | `0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059` | 18 |
| USD₮0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 |
| USDC.e | `0xfbda5f676cb37624f28265a144a48b0d6e87d3b6` | 6 |
| CDP | `0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F` | 18 |

## Fee Tiers

| Tier | Percentage | Best For |
|------|------------|----------|
| 500 | 0.05% | Stable pairs (WFLR/sFLR, stablecoins) |
| 3000 | 0.3% | Standard pairs (default) |
| 10000 | 1% | Volatile pairs |

## DEX Comparison

| DEX | Best For | Router |
|-----|----------|--------|
| Enosys V3 | Most pairs, highest liquidity | `0x5FD34090E9b195d8482Ad3CC63dB078534F1b113` |
| SparkDex V3.1 | WFLR/USDT0, some exclusive pairs | `0x7a57DF6665B5b4B9f8C555e19502333D0B89aD59` |
| Enosys V2 | BANK token only | Direct pair swap |

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--fee` | Pool fee tier (500, 3000, 10000) | 3000 |
| `--slippage` | Slippage tolerance % | 1 |
| `--dry-run` | Simulate without executing | false |

## Common Workflows

### Buy BANK
```bash
# 1. Wrap FLR if needed
/swap wrap 100

# 2. Swap via V2 (BANK only on V2)
/swap v2 WFLR BANK 100
```

### Sell BANK
```bash
# 1. Swap BANK to WFLR
/swap v2 BANK WFLR 10

# 2. Unwrap if needed
/swap unwrap 100
```

### Stake FLR as sFLR
```bash
/swap WFLR SFLR 100 --fee 500
```

## Keystore

Default: `./keystore.json`
Agent wallet: `YOUR_WALLET_ADDRESS`

---


## Routing Guide

### Don't use when...
- Bridging cross-chain (use `/bridge`)
- Sending tokens without trading (use `/send`)

### Use when...
- Swapping tokens on Flare DEXs (Enosys, SparkDex, Blazeswap)
- Getting best-route quotes across Flare DEXs
- Wrapping/unwrapping FLR ↔ WFLR
- Trading BANK token (V2 pools)

### Edge Cases
- Default is Enosys V3 — use `agg` for best-route comparison
- BANK only trades on V2 pools (`/swap v2 WFLR BANK`)
- Slippage default varies by pool — set explicitly for volatile pairs
- Wrap/unwrap is gasless conversion (no DEX needed)

### Success Criteria
- Quote shows expected output and price impact
- Swap returns tx hash with actual amounts received
- Aggregator compares at least 2 DEXs
