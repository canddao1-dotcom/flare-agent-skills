---
name: upshift
description: Upshift Finance yield vaults. Deposit/withdraw from FXRP vault (earnXRP), check yields, monitor positions. Triggers on "/upshift", "upshift finance", "earnxrp", "fxrp vault", "yield vault".
---

# Upshift Skill

Interact with Upshift Finance yield vaults on Flare network.
- `/upshift`, "upshift vault", "earnXRP"

## Quick Command

```bash
node skills/upshift/scripts/upshift.js <command> [options]
```

## Subcommands

| Command | Description |
|---------|-------------|
| `status` | Vault TVL, share price, your balance |
| `deposit <amount>` | Deposit FXRP to vault |
| `redeem <shares>` | Instant redeem earnXRP for FXRP |
| `request <shares>` | Request redemption (queued) |
| `balance [address]` | Check earnXRP balance |

## Usage Examples

```bash
# Check vault status
/upshift status

# Deposit 100 FXRP
/upshift deposit 100

# Redeem 50 earnXRP shares
/upshift redeem 50

# Check balance
/upshift balance
```

## Contract Addresses

| Contract | Address |
|----------|---------|
| Vault (Proxy) | `0x373D7d201C8134D4a2f7b5c63560da217e3dEA28` |
| Implementation | `0xc689cc6441146f7c4986ed4f0e1eb6fc382859b2` |
| Share Token (earnXRP) | `0xe533e447fd7720b2f8654da2b1953efa06b60bfa` |
| Asset (FXRP) | `0xAd552A648C74D49E10027AB8a618A3ad4901c5bE` |

## Interface (Non-standard)

**NOT ERC4626** - Custom interface:

```solidity
// Deposits - requires FXRP approval first
function deposit(address token, uint256 amount, address account)

// Redemptions
function instantRedeem(uint256 wNLPAmount, address to) returns (uint256)
function requestRedeem(uint256 _shares, address _token)
```

## Notes

- Share token is earnXRP (6 decimals)
- FXRP is 6 decimals
- Two-step redemption: instant or request/claim
- Vault uses TransparentUpgradeableProxy pattern


---

## Routing Guide

### Don't use when...
- Swapping FXRP (use `/swap`)
- Managing LP positions (use `/lp`)
- Checking portfolio (use `/portfolio` — includes Upshift)

### Use when...
- Depositing FXRP into Upshift yield vault
- Checking earnXRP balance and vault status
- Redeeming earnXRP back to FXRP

### Edge Cases
- NOT ERC4626 — custom interface, don't use standard vault ABIs
- Deposit fee ~0.3%
- Two redemption paths: instant (if available) or request queue
- Requires FXRP approval before deposit

### Success Criteria
- Status shows vault TVL and share price
- Deposit returns tx hash and earnXRP received
- Redeem returns FXRP amount and tx hash
