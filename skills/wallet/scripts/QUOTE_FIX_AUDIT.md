# swap-v3.js Quote Function Audit

## Bug Summary
The `getQuote()` function (line ~70) uses a naive sqrtPriceX96 estimation that can be **90% wrong** for V3 pools, especially with low liquidity.

## Evidence
- Quote said: 10 WFLR → 1.79 HLN
- Actual: 10 WFLR → 0.20 HLN  
- **Error: ~9x overestimate!**

## Root Cause Analysis

### Problem 1: Naive Price Calculation
Current code:
```javascript
const price = Number(sqrtPriceX96) / (2 ** 96);
const priceSquared = price * price;
amountOut = BigInt(Math.floor(Number(amountIn) / priceSquared * 0.997));
```

This calculation **IGNORES**:
1. **Liquidity concentration** - V3 has concentrated liquidity in tick ranges
2. **Tick crossings** - Swaps can cross multiple ticks, each with different liquidity
3. **Price impact** - Large swaps in low liquidity move the price dramatically

### Problem 2: No Multi-Pool Comparison
The script defaults to fee=3000 (0.3%) without checking other pools.

WFLR/HLN pool comparison:
| Fee Tier | Price (1 WFLR) | Liquidity |
|----------|----------------|-----------|
| 0.05%    | 0.01 HLN       | 5.38e17 (LOW) |
| **0.3%** | 0.16 HLN       | 1.91e25 |
| 1%       | 0.17 HLN       | 5.38e17 (LOW) |

### Problem 3: No Liquidity Check
The code doesn't warn when liquidity is insufficient for the swap size.

## Solution: Use On-Chain Quoter

### Recommended Fix
Use the **Enosys QuoterV2** contract which simulates the actual swap:

```javascript
// Enosys QuoterV2 (needs to be found/verified)
const QUOTER_V2 = '0x...'; // TODO: Find address from Enosys docs

const QUOTER_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

async function getQuote(provider, tokenIn, tokenOut, amountIn, fee = 3000) {
  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider);
  
  const params = {
    tokenIn,
    tokenOut,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0, // No limit
  };
  
  try {
    const result = await quoter.quoteExactInputSingle.staticCall(params);
    return {
      amountOut: result[0],
      sqrtPriceX96After: result[1],
      ticksCrossed: result[2],
      gasEstimate: result[3],
      fee,
    };
  } catch (error) {
    // Fall back to naive calculation with warning
    console.warn('⚠️ Quoter call failed, using naive estimate (may be inaccurate!)');
    return naiveQuote(provider, tokenIn, tokenOut, amountIn, fee);
  }
}
```

### Alternative: Multi-Pool Best Route
If QuoterV2 is unavailable, compare all fee tiers:

```javascript
async function getBestQuote(provider, tokenIn, tokenOut, amountIn) {
  const fees = [500, 3000, 10000];
  let bestQuote = null;
  
  for (const fee of fees) {
    const quote = await getQuote(provider, tokenIn, tokenOut, amountIn, fee);
    if (!quote) continue;
    
    // Check liquidity adequacy
    if (quote.liquidity < amountIn * BigInt(10)) {
      console.warn(`⚠️ ${fee/10000}% pool has low liquidity`);
      continue;
    }
    
    if (!bestQuote || quote.amountOut > bestQuote.amountOut) {
      bestQuote = quote;
    }
  }
  
  return bestQuote;
}
```

## Immediate Interim Fix
Add warning when pool liquidity is low relative to swap size:

```javascript
async function getQuote(provider, tokenIn, tokenOut, amountIn, fee = 3000) {
  // ... existing code ...
  
  // ADD THIS WARNING:
  const minLiquidityRatio = 100; // amountIn should be < liquidity/100
  if (amountIn > liquidity / BigInt(minLiquidityRatio)) {
    console.warn('⚠️ WARNING: Low liquidity pool!');
    console.warn('   Quote may be SIGNIFICANTLY inaccurate.');
    console.warn('   Consider using smaller amount or different pool.');
  }
  
  return { amountOut, poolAddress, sqrtPriceX96, liquidity, fee, lowLiquidityWarning: true };
}
```

## Finding Enosys QuoterV2

To find the QuoterV2 address:
1. Check https://enosys.global/docs for deployed contracts
2. Look at Enosys frontend network calls (inspect XHR)
3. Search Flarescan for contracts deployed by Enosys deployer
4. Ask in Enosys Discord/Telegram

Common QuoterV2 selectors to search for:
- `quoteExactInputSingle`: `0xc6a5026a`
- `quoteExactInput`: `0xcdca1753`

## Summary
| Issue | Severity | Fix Required |
|-------|----------|--------------|
| Naive sqrtPrice calculation | **CRITICAL** | Use on-chain Quoter |
| No multi-pool comparison | HIGH | Compare all fee tiers |
| No liquidity warning | MEDIUM | Add warning check |

**Priority: CRITICAL** - The current quote can be 90% wrong, leading to failed transactions or massive unexpected slippage.
