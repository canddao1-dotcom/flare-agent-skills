# Enosys V3 — Uniswap V3 DEX on Flare

Swap tokens and manage concentrated liquidity positions on Enosys V3 (standard Uniswap V3) on Flare Network.

## Commands

### Swap & Quote
```bash
# Get a quote (default 0.3% fee tier)
node scripts/swap.js quote --from WFLR --to FXRP --amount 100

# Best quote across all fee tiers
node scripts/swap.js best --from WFLR --to FXRP --amount 100

# Execute swap
node scripts/swap.js swap --from WFLR --to FXRP --amount 100 --slippage 1 --fee 3000

# Pool info (all fee tiers)
node scripts/swap.js pool --from WFLR --to FXRP
```

### LP Management
```bash
# List positions
node scripts/lp.js positions --address 0xYOUR_WALLET

# Health check
node scripts/lp.js check --address 0xYOUR_WALLET

# Mint new position
node scripts/lp.js mint --token0 WFLR --token1 FXRP --amount0 1000 --amount1 100 --fee 3000 --range 10

# Add liquidity
node scripts/lp.js add --tokenId 123 --amount0 100 --amount1 10

# Collect fees
node scripts/lp.js collect --tokenId 123

# Remove liquidity
node scripts/lp.js remove --tokenId 123 --percent 50
```

## Key Contracts

| Contract | Address |
|----------|---------|
| SwapRouter | `0x5FD34090E9b195d8482Ad3CC63dB078534F1b113` |
| QuoterV2 | `0xE505Bf33e84dDA2183cd0E4a6E8B084b85BC4269` |
| Factory | `0x17AA157AC8C54034381b840Cb8f6bf7Fc355f0de` |
| NonfungiblePositionManager | `0xd9770b1c7a6ccd33c75b5bcb1c0078f46be46657` |

## Fee Tiers

| Fee | Tick Spacing | Use Case |
|-----|-------------|----------|
| 500 (0.05%) | 10 | Stable pairs |
| 3000 (0.3%) | 60 | Standard pairs |
| 10000 (1%) | 200 | Exotic pairs |

## Notes

- Standard Uniswap V3 interface (NOT Algebra — that's SparkDex V4)
- Fixed fee tiers unlike SparkDex V4's dynamic fees
- Tokens: WFLR, FXRP, sFLR, USDT0, CDP, rFLR, stXRP

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_WALLET` | Your wallet address (for read-only queries) |
| `AGENT_KEYSTORE` | Path to encrypted keystore JSON (default: `./keystore.json`) |
| `AGENT_KEYSTORE_PASSWORD` | Path to keystore password file |
| `KEYSTORE_PASSWORD_PATH` | Alternative password path |
| `FLARE_RPC` | Custom RPC URL (default: public Flare RPC) |
