---
name: spectra
description: Spectra Finance yield trading. Split yield-bearing tokens (sFLR, stXRP) into PT (principal) and YT (yield). Triggers on "/spectra", "spectra finance", "yield trading", "principal token", "pt token".
---

# Spectra Skill

Yield trading on Spectra Finance - split yield-bearing tokens into PT (Principal) and YT (Yield).
- `/spectra`, "yield trading", "principal token", "pt stxrp"

## Quick Command

```bash
node skills/spectra/scripts/spectra.js <command> [options]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `status` | Pool stats, APY, TVL |
| `balance [address]` | Check PT/YT/LP balances |
| `pools` | List all Spectra pools on Flare |
| `deposit <amount> <pool>` | Deposit IBT → get PT + YT |
| `swap <from> <to> <amount>` | Swap PT ↔ IBT in pool |
| `lp add <amount> <pool>` | Add liquidity |
| `lp remove <amount> <pool>` | Remove liquidity |

## Pools on Flare

### stXRP Pool (Maturity: Mar 05, 2026)
| Token | Address |
|-------|---------|
| Pool (LP) | `0xa65a736bcf1f4af7a8f353027218f2d54b3048eb` |
| PT | `0x097Dd93Bf92bf9018fF194195dDfCFB2c359335e` |
| YT | `0x46f0C7b81128e031604eCb3e8A7E28dd3F8A50C9` |
| IBT (stXRP) | `0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3` |
| Underlying | FXRP |

### sFLR Pool (Maturity: May 17, 2026)
| Token | Address |
|-------|---------|
| Pool (LP) | `0x5d31ef52e2571294c91f01a3d12bf664d2951666` |
| PT | `0x14613BFc52F98af194F4e0b1D23fE538B54628f3` |
| IBT (sw-sFLR) | `0xB9003d5bEd06afD570139d21c64817298DD47eC1` |
| Underlying | WFLR |

## Yield Trading Concepts

- **PT (Principal Token)**: Redeemable 1:1 for underlying at maturity. Trades at discount = fixed yield.
- **YT (Yield Token)**: Receives all yield until maturity. High leverage on yield.
- **IBT (Interest Bearing Token)**: The yield-bearing asset (stXRP, sFLR).
- **Pool**: Curve-style AMM for PT ↔ IBT swaps.

## Key Interfaces

### PT Token (ERC-4626 style)
```solidity
function depositIBT(uint256 ibts, address ptReceiver, address ytReceiver) returns (uint256)
function redeemForIBT(uint256 shares, address receiver, address owner) returns (uint256)
function previewDepositIBT(uint256 ibts) view returns (uint256)
```

### Pool (Curve-style)
```solidity
function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)
function add_liquidity(uint256[2] amounts, uint256 min_mint) returns (uint256)
function remove_liquidity_one_coin(uint256 amount, int128 i, uint256 min) returns (uint256)
function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)
// coins: [0] = stXRP (IBT), [1] = PT
```

## Usage Examples

```bash
# Check pool stats
/spectra status

# Check your balances
/spectra balance

# Deposit 10 stXRP → get PT + YT
/spectra deposit 10 stxrp

# Swap 5 PT for stXRP
/spectra swap pt stxrp 5

# Add 10 stXRP to LP
/spectra lp add 10 stxrp
```


---

## Routing Guide

### Don't use when...
- Staking FLR for sFLR (use `/sflr`)
- Managing LP positions (use `/lp`)
- Simple token swaps (use `/swap`)

### Use when...
- Trading yield on Spectra Finance (PT/YT tokens)
- Splitting yield-bearing tokens into principal and yield
- Checking Spectra pool APY and TVL

### Edge Cases
- stXRP pool maturity: Mar 05, 2026 — PT redeemable 1:1 after
- sFLR pool maturity: May 17, 2026
- PT trades at discount before maturity (discount = fixed yield)
- YT value decays to 0 at maturity — time-sensitive

### Success Criteria
- Status shows pool APY, TVL, and maturity countdown
- Deposit returns PT + YT token amounts
- Swap executes in Curve-style AMM with expected slippage
