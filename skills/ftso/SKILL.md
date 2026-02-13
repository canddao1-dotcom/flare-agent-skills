---
name: price
description: Get real-time token prices from Flare FTSO oracle. Query current prices, historical data, list supported symbols. Triggers on "/price", "ftso price", "token price", "what's the price of".
---

# Price Skill (FTSO)

Unified interface for FTSO price feeds on Flare network.

## Quick Command

```bash
node skills/ftso/scripts/ftso.js <symbol>
```

## Subcommands

| Command | Description |
|---------|-------------|
| `<symbol>` | Get current price for symbol |
| `<sym1> <sym2>...` | Get multiple prices at once |
| `history <sym> [period]` | Historical price data |
| `list` | List all supported symbols |

## Usage Examples

```bash
# Single price
/price FLR

# Multiple prices
/price FLR XRP ETH BTC

# JSON output
/price FLR --json

# Historical data
/price history FLR 7d
/price history XRP 30d

# List all symbols
/price list
```

## Symbol Aliases

These aliases are automatically resolved:

| Alias | Resolves To |
|-------|-------------|
| WFLR | FLR |
| SFLR | FLR |
| FXRP | XRP |
| USD₮0 | USDT |
| USDT0 | USDT |

## Supported Symbols

### Crypto
- FLR, XRP, ETH, BTC, LTC
- XLM, DOGE, ADA, ALGO
- ARB, AVAX, BNB, FIL
- LINK, MATIC, SOL
- USDC, USDT

## Data Source

- **On-chain only** - no external APIs
- **FtsoV2 Contract** - official Flare oracle
- **~3 second updates** - near real-time prices

## Historical Data

The history daemon polls FTSO every 5 minutes and stores locally:

```bash
# Start daemon (if not running)
skills/ftso-history/scripts/ensure-daemon.sh

# Query history
/price history FLR 7d
/price history XRP 30d
```

Periods: `1d`, `7d`, `14d`, `30d`, `90d`

## Integration

Use in other scripts:

```javascript
const { getPrice, getPrices } = require('skills/ftso/scripts/price.js');

const flrPrice = await getPrice('FLR');
const prices = await getPrices(['FLR', 'XRP', 'ETH']);
```

## Contract Reference

| Contract | Address |
|----------|---------|
| FlareContractRegistry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| FtsoV2 | Resolved dynamically from registry |


---

## Routing Guide

### Don't use when...
- Need historical price charts (use `/price history` or external charting)
- Want to execute trades (use `/swap`)
- Checking portfolio value (use `/portfolio`)

### Use when...
- Getting current token price from FTSO oracle
- Querying multiple prices at once
- Listing supported FTSO feed symbols

### Edge Cases
- Symbol aliases auto-resolve: WFLR→FLR, FXRP→XRP, USDT0→USDT
- FTSO updates every ~90 seconds — prices may lag vs CEX
- Some symbols may not have feeds (check `/price list`)

### Success Criteria
- Returns price with timestamp and voting round
- Multiple symbols return in single response
- JSON mode outputs parseable data
