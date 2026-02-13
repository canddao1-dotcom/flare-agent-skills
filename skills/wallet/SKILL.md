---
name: wallet
description: Wallet operations for Flare Network. Check balances, send tokens, wrap/unwrap, approve spending. Triggers on "/wallet", "check balance", "send tokens", "/send", "transfer tokens to".
---

# Wallet Skill

Interface for wallet operations on Flare Network.

## Quick Command

```bash
node skills/wallet/scripts/wallet.js <command> [options]
```

## Supported Network

| Network | Chain ID | Native | Explorer |
|---------|----------|--------|----------|
| flare | 14 | FLR | flarescan.com |

## Subcommands

| Command | Description |
|---------|-------------|
| `balance [address]` | Check native and token balances |
| `send <amount> <token> to <address>` | Send native or tokens |
| `wrap <amount>` | Wrap FLR to WFLR |
| `unwrap <amount>` | Unwrap WFLR to FLR |
| `approve <token> <spender>` | Approve token spending |
| `allowance <token> <spender>` | Check current allowance |
| `gas` | Current gas prices |
| `info <token>` | Token info lookup |
| `generate` | Generate new wallet |

## Usage Examples

```bash
/wallet balance
/wallet balance 0x1234...
/wallet balance --tokens
/wallet send 10 FLR to 0xRecipient
/wallet send 100 WFLR to 0xRecipient
/wallet wrap 100
/wallet unwrap 50
```

## Safe Send (with confirmation)

For transfers requiring extra safety checks (address validation, balance verification, dry-run):

```bash
# Dry run (default — no tx sent)
node skills/wallet/scripts/send.js --to 0xRecipient --amount 100 --token WFLR

# Execute with confirmation
node skills/wallet/scripts/send.js --to 0xRecipient --amount 100 --token WFLR --confirm --keystore <path>

# Skip interactive prompt
node skills/wallet/scripts/send.js --to 0xRecipient --amount 100 --token WFLR --confirm --keystore <path> --yes
```

### Safety Features
- **Dry-run by default** — must pass `--confirm` to execute
- **Balance check** — verifies sufficient funds before sending
- **Address book** — configure aliases in `send.js` `KNOWN_ADDRESSES`
- **>90% warning** — alerts when sending most of balance
- **Memory logging** — all sends logged automatically

### Send Options
| Flag | Description |
|------|-------------|
| `--to` | Destination address or alias |
| `--amount` | Amount to send |
| `--token` | Token symbol (default: FLR) |
| `--keystore` | Path to encrypted keystore |
| `--from` | Source address (for dry-run) |
| `--confirm` | Actually execute the transaction |
| `--yes` | Skip interactive confirmation |

## Common Tokens (Flare)

| Token | Address | Decimals |
|-------|---------|----------|
| WFLR | `0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d` | 18 |
| sFLR | `0x12e605bc104e93B45e1aD99F9e555f659051c2BB` | 18 |
| FXRP | `0xad552a648c74d49e10027ab8a618a3ad4901c5be` | 6 |
| USD₮0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 |

## Known Spenders (Flare)

| Name | Address | Purpose |
|------|---------|---------|
| enosys-v3-router | `0x5FD34090E9b195d8482Ad3CC63dB078534F1b113` | V3 swaps |
| enosys-v3-position | `0xd9770b1c7a6ccd33c75b5bcb1c0078f46be46657` | LP positions |
| sparkdex-v3-router | `0x7a57DF6665B5b4B9f8C555e19502333D0B89aD59` | SparkDex swaps |

## Security Notes

⚠️ **NEVER:**
- Store private keys in plain text
- Log private keys to console
- Share private keys in chat

✅ **ALWAYS:**
- Use encrypted keystores
- Verify addresses before sending
- Test with small amounts first

## Keystore

Default: `./keystore.json`
Agent wallet: `YOUR_WALLET_ADDRESS`

---

## Routing Guide

### Don't use when...
- Swapping tokens (use `/swap` — wallet is for transfers and management)
- Checking full portfolio (use `/portfolio`)

### Use when...
- Checking balances on Flare
- Sending native or ERC-20 tokens (including safe send with confirmations)
- Wrapping/unwrapping FLR
- Token approvals and allowance management

### Success Criteria
- Balance shows native + token balances
- Send returns tx hash and explorer link
- Approve confirms allowance set correctly
