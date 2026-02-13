---
name: cdp
description: Enosys Loans (CDP) protocol. Check stability pool deposits, deposit/withdraw CDP, view collateral rewards. Triggers on "/cdp", "enosys loans", "stability pool", "cdp earn", "liquity".
---

# CDP Skill (Enosys Loans)

Interact with Enosys Loans protocol - a Liquity V2 fork on Flare.

## Quick Command

```bash
node skills/cdp/scripts/cdp.js <command> [options]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `status` | Protocol stats, pool TVL, your positions |
| `balance [address]` | Check CDP balance and SP deposits |
| `deposit <amount> <pool>` | Deposit CDP to earn pool (fxrp/wflr) |
| `withdraw <amount> <pool>` | Withdraw from earn pool |
| `claim <pool>` | Claim yield + liquidation collateral |
| `pools` | Show stability pool stats |

## Usage Examples

```bash
# Check protocol status
/cdp status

# Check your position
/cdp balance

# Deposit 100 CDP to FXRP earn pool
/cdp deposit 100 fxrp

# Withdraw 50 CDP from WFLR pool
/cdp withdraw 50 wflr

# Claim all rewards from FXRP pool
/cdp claim fxrp
```

## Contract Addresses

### CDP Token
| Contract | Address |
|----------|---------|
| CDP Dollar | `0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F` |

### FXRP Branch
| Contract | Address |
|----------|---------|
| BorrowerOperations | `0x18139E09Fb9a683Dd2c2df5D0edAD942c19CE912` |
| TroveManager | `0xc46e7d0538494FEb82b460b9723dAba0508C8Fb1` |
| StabilityPool | `0x2c817F7159c08d94f09764086330c96Bb3265A2f` |
| PriceFeed | `0xFc35d431Ce1445B9c79ff38594EF454618D2Ec49` |

### WFLR Branch
| Contract | Address |
|----------|---------|
| BorrowerOperations | `0x19b154D5d20126a77309ae01931645a135E4E252` |
| TroveManager | `0xB6cB0c5301D4E6e227Ba490cee7b92EB954ac06D` |
| StabilityPool | `0x0Dd6daab4cB9A0ba6707Cf59DBfbc28cc33CA24A` |

## Protocol Parameters
- MCR (Min Collateral Ratio): 110%
- CCR (Critical Collateral Ratio): 150%
- CDP Decimals: 18

## Stability Pool Interface

```solidity
// Deposit CDP to earn
function provideToSP(uint256 _topUp, bool _doClaim)

// Withdraw CDP
function withdrawFromSP(uint256 _amount, bool _doClaim)

// View functions
function getCompoundedBoldDeposit(address) → current deposit
function getDepositorYieldGain(address) → pending CDP yield
function getDepositorCollGain(address) → pending collateral
```

## Rewards
- **Yield**: CDP interest from borrowers
- **Collateral**: Liquidated collateral (FXRP or WFLR) at discount


---

## Routing Guide

### Don't use when...
- Opening/managing CDP borrowing troves (this focuses on stability pool deposits only)
- Checking general token prices (use `/price` for broad pricing data)
- Managing LP positions (use `/lp` for concentrated liquidity positions)
- Need CDP borrowing rates (check Enosys Loans directly for borrowing)
- Expecting guaranteed yields (liquidation gains vary with market conditions)
- Unfamiliar with Liquity V2 mechanics (complex collateral/borrowing interactions)

### Use when...
- Depositing CDP tokens to stability pools for yield + liquidation collateral gains
- Checking stability pool positions and pending reward balances
- Claiming CDP yield and FXRP/WFLR liquidation rewards from protocol
- Earning passive income while maintaining CDP token exposure
- Immediate liquidity needs with CDP tokens (redeemable near-instantly)

### Edge Cases
- **Pool specificity**: Two distinct pools (FXRP and WFLR) require explicit selection
- **Claim mechanics**: Single claim operation triggers BOTH yield + collateral withdrawal
- **Liquidation volatility**: Collateral gains fluctuate dramatically during liquidation events
- **Protocol parameters**: MCR 110%, CCR 150% - understanding for comprehensive context
- **Yield delay**: Rewards may not compound immediately after deposit
- **Pool liquidity**: TVL changes impact individual deposit proportions

### Success Criteria
- **Status confirmation**: Shows accurate pool TVL and precise individual deposit amounts
- **Transaction verification**: Deposit/withdraw operations return confirmed tx hashes
- **Reward execution**: Claim operations display exact CDP yield + collateral amounts received
- **Balance accuracy**: Position tracking matches on-chain stability pool state

## Input/Output Schema

### Input Requirements
- **Pool selection**: FXRP | WFLR pool specification required
- **Amount precision**: Decimal values respecting CDP token 18-decimal precision
- **Command specificity**: deposit|withdraw|claim|balance subcommand required
- **Address context**: Default from agent wallet, accepts optional address override

### Output Data Types
- **Pool metrics**: Total pool TVL, individual deposit amounts, current yield rates
- **Reward breakdown**: Separate CDP yield vs FXRP/WFLR collateral gain components
- **Transaction records**: Confirmed on-chain transaction hashes for all operations
- **Error specificity**: Pool selection, insufficient balance, invalid amounts

### Risk Parameters
- **Liquidation exposure**: Rewards tied to FXRP/WFLR collateral liquidations
- **Yield variability**: 110% minimum collateralization ratios affect stability pool earnings
- **Pool concentration**: FXRP vs WFLR selection impacts reward source diversification
