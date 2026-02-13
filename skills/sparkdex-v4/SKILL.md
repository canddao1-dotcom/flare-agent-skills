# SparkDex V4 — Algebra Integral on Flare

## Triggers
- `/sparkdex`
- `v4 swap`, `v4 lp`
- `sparkdex v4`, `algebra swap`
- `sparkdex quote`, `sparkdex pool`

## Overview
SparkDex V4 is an Algebra Integral deployment on Flare — concentrated liquidity AMM with **dynamic fees** and **one pool per token pair** (no fee tiers).

### Key differences from Uniswap V3
- **`deployer` field** in all structs (QuoterV2, SwapRouter, NFPM). Use `address(0)` for default pool deployer.
- **Path encoding:** `token(20) + deployer(20) + token(20)` — NOT just packed addresses. Deployer = `address(0)` between each pair.
- **`positions()` returns 12 fields** (not 11) — includes `tickSpacing` at index 4:
  `(nonce, operator, token0, token1, tickSpacing, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1)`
- **QuoterV2 returns tuple** — use positional access: `result[0]` for amountOut, `result[1]` for fee, `result[4]` for gasEstimate.
- **No fee bytes** in path encoding, no fee parameter in mint.

## Scripts

### Swap & Quote (`scripts/swap.js`)
```bash
# Get a quote (shows dynamic fee)
node skills/sparkdex-v4/scripts/swap.js quote --from WFLR --to FXRP --amount 100

# Multi-hop quote
node skills/sparkdex-v4/scripts/swap.js quote --from WFLR --to USDT0 --amount 100 --via FXRP

# Execute swap
node skills/sparkdex-v4/scripts/swap.js swap --from WFLR --to FXRP --amount 100 --slippage 1

# Pool info
node skills/sparkdex-v4/scripts/swap.js pool --from WFLR --to FXRP
```

### LP Management (`scripts/lp.js`)
```bash
# List positions
node skills/sparkdex-v4/scripts/lp.js positions --address 0x...

# Health check (in range / near edge / out of range)
node skills/sparkdex-v4/scripts/lp.js check --address 0x...

# Mint new position (±10% range default)
node skills/sparkdex-v4/scripts/lp.js mint --token0 WFLR --token1 FXRP --amount0 1000 --amount1 100 --range 10

# Mint with exact ticks
node skills/sparkdex-v4/scripts/lp.js mint --token0 WFLR --token1 FXRP --amount0 1000 --amount1 100 --tickLower -5000 --tickUpper 5000

# Add liquidity
node skills/sparkdex-v4/scripts/lp.js add --tokenId 123 --amount0 100 --amount1 10

# Remove liquidity (partial or full)
node skills/sparkdex-v4/scripts/lp.js remove --tokenId 123 --percent 50
node skills/sparkdex-v4/scripts/lp.js remove --tokenId 123 --percent 100

# Collect fees
node skills/sparkdex-v4/scripts/lp.js collect --tokenId 123
```

## Supported Tokens
WFLR, FXRP, sFLR, USDT0, CDP, stXRP (case-insensitive lookup)

## Contracts
| Contract | Address |
|----------|---------|
| SwapRouter | `0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F` |
| QuoterV2 | `0x6AD6A4f233F1E33613e996CCc17409B93fF8bf5f` |
| NonfungiblePositionManager | `0x49BE8AA6c684b15e0C5450e8Fa0b16Bec1435596` |
| Factory | `0x805488DaA81c1b9e7C5cE3f1DCeA28F21448EC6A` |
| TickLens | `0x04ACde7811F23B69fB1759A3F2fc98bD18D60894` |

## ABI Notes (Algebra Integral)

### QuoterV2
```
quoteExactInputSingle((address tokenIn, address tokenOut, address deployer, uint256 amountIn, uint160 limitSqrtPrice))
  returns (uint256 amountOut, uint16 fee, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
```

### SwapRouter
```
exactInputSingle((address tokenIn, address tokenOut, address deployer, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice))
  returns (uint256 amountOut)
```

### NFPM mint
```
mint((address token0, address token1, address deployer, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline))
  returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
```

### NFPM positions (12 fields!)
```
positions(uint256) returns (uint88 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)
```

## Environment
- `AGENT_KEYSTORE` — path to encrypted keystore (default: `./keystore.json`)
- `AGENT_KEYSTORE_PASSWORD` — path to password file

## Routing Guide
- **"quote WFLR to FXRP"** → `swap.js quote`
- **"swap 100 WFLR for FXRP"** → `swap.js swap`
- **"check my V4 positions"** → `lp.js check`
- **"add liquidity on sparkdex"** → `lp.js mint`
- **"collect fees"** → `lp.js collect`
- **"remove LP"** → `lp.js remove`
