---
name: wallet
description: Multi-chain wallet operations (Flare, HyperEVM, Base, XRPL, Solana). Check balances, send tokens, wrap/unwrap, approve spending, create wallets. Triggers on "/wallet", "check balance", "send tokens", "/send", "transfer tokens to", "send XRP", "XRP balance".
---

# Wallet Skill

Unified interface for wallet operations across EVM chains (Flare, HyperEVM, Base), XRPL, and Solana.

## Quick Commands

```bash
# EVM wallet operations
node skills/wallet/scripts/wallet.js <command> [options]

# XRPL operations
node skills/wallet/scripts/xrpl-send.js <command> [options]

# Cross-chain balance overview
node skills/wallet/scripts/balance-all.js
```

## Supported Networks

### EVM Chains

| Network | Chain ID | Native | Explorer |
|---------|----------|--------|----------|
| Flare | 14 | FLR | flarescan.com |
| HyperEVM | 999 | HYPE | purrsec.com |
| Base | 8453 | ETH | basescan.org |

Use `--network <name>` to specify (default: flare)

### XRPL

| Network | Native | Explorer |
|---------|--------|----------|
| XRP Ledger | XRP | xrpscan.com |

Wallet: Configure your own XRPL wallet
Keyfile: `~/.openclaw/workspace/.secrets/xrpl-wallet.json`

### Solana

| Network | Native | Explorer |
|---------|--------|----------|
| Solana | SOL | solscan.io |

Wallet: Configure your own Solana wallet
Keyfile: `~/.config/solana/id.json`

## EVM Subcommands

| Command | Description |
|---------|-------------|
| `balance [address]` | Check native and token balances |
| `send <amount> <token> to <address>` | Send native or ERC-20 tokens |
| `wrap <amount>` | Wrap native to wrapped token |
| `unwrap <amount>` | Unwrap to native |
| `approve <token> <spender>` | Approve token spending |
| `allowance <token> <spender>` | Check current allowance |
| `gas` | Current gas prices |
| `info <token>` | Token info lookup |
| `generate` | Generate new EVM wallet |
| `networks` | List supported networks |

## XRPL Subcommands

```bash
# Check XRP balance
node skills/wallet/scripts/xrpl-send.js balance

# Send XRP
node skills/wallet/scripts/xrpl-send.js send --to <address> --amount <XRP>

# Send with destination tag (for exchanges)
node skills/wallet/scripts/xrpl-send.js send --to <address> --amount <XRP> --tag <number>

# Send with memo
node skills/wallet/scripts/xrpl-send.js send --to <address> --amount <XRP> --memo "text"

# Transaction history
node skills/wallet/scripts/xrpl-send.js history --limit 10
```

### XRPL Safety
- 1 XRP base reserve always maintained
- Validates destination address format (must start with `r`, 25-35 chars)
- Warns if sending <1 XRP to unactivated account
- Confirms balance before sending

## XRPL Wallet Creation

```bash
# Create a new XRPL wallet
node skills/wallet/scripts/create-xrpl-wallet.js
```

Generates keypair and saves to `.secrets/xrpl-wallet.json`. Account must receive ≥1 XRP to activate on the ledger.

## Cross-Chain Balance Overview

```bash
# Check all wallets across all chains
node skills/wallet/scripts/balance-all.js
```

Shows balances for Flare, HyperEVM, Base, Solana, and XRPL in one view.

## Safe Send (EVM — with confirmation)

For EVM transfers requiring extra safety checks:

```bash
# Dry run (default — no tx sent)
node skills/wallet/scripts/send.js \
  --to 0xRecipient --amount 100 --token WFLR

# Execute with confirmation
node skills/wallet/scripts/send.js \
  --to 0xRecipient --amount 100 --token WFLR --confirm --keystore <path>

# Skip interactive prompt
node skills/wallet/scripts/send.js \
  --to 0xRecipient --amount 100 --token WFLR --confirm --keystore <path> --yes
```

### Safety Features
- **Dry-run by default** — must pass `--confirm` to execute
- **Balance check** — verifies sufficient funds before sending
- **Address book** — configure aliases in `send.js` `KNOWN_ADDRESSES`
- **>90% warning** — alerts when sending most of balance
- **Memory logging** — all sends logged automatically

## Usage Examples

### Flare (default)
```bash
/wallet balance
/wallet balance 0xaa68bc4bab9a63958466f49f5a58c54a412d4906
/wallet send 10 FLR to 0xRecipient
/wallet wrap 100
/wallet unwrap 50
```

### Base
```bash
/wallet balance --network base
/wallet send 0.01 ETH to 0x... --network base
/wallet gas --network base
```

### HyperEVM
```bash
/wallet balance --network hyperevm
/wallet send 100 USDT0 to 0x... --network hyperevm
```

### XRPL
```bash
/wallet xrp balance
/wallet send 10 XRP to rJ2TzgJThNfD9Gzo5UqoSFid6tmgCbCwuP
/wallet xrp history
```

### Solana
```bash
/wallet balance --network solana
```

## Common Tokens

### Flare
| Token | Address | Decimals |
|-------|---------|----------|
| WFLR | `0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d` | 18 |
| BANK | `0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059` | 18 |
| sFLR | `0x12e605bc104e93B45e1aD99F9e555f659051c2BB` | 18 |
| FXRP | `0xad552a648c74d49e10027ab8a618a3ad4901c5be` | 6 |
| USD₮0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 |

### HyperEVM
| Token | Address | Decimals |
|-------|---------|----------|
| fXRP | `0xd70659a6396285bf7214d7ea9673184e7c72e07e` | 6 |
| USD₮0 | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` | 6 |

### Base
| Token | Address | Decimals |
|-------|---------|----------|
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| DAI | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | 18 |
| AERO | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | 18 |

### Solana
| Token | Mint | Decimals |
|-------|------|----------|
| SOL | native | 9 |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 |
| BLOWFISH | `CFB4Ff7W87uN9Gf2DSj63L7prZycJvzQeg1MbGxwBcqC` | 6 |

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `wallet.js` | Main EVM wallet CLI |
| `balance.js` | EVM balance checker |
| `balance-all.js` | Cross-chain balance overview |
| `send.js` | Safe EVM send with confirmation |
| `send-tx.js` | Low-level EVM transaction sender |
| `wrap-flr.js` | Wrap/unwrap FLR ↔ WFLR |
| `approve-token.js` | ERC-20 token approvals |
| `check-allowance.js` | Check ERC-20 allowances |
| `gas-price.js` | Gas price checker |
| `token-info.js` | Token metadata lookup |
| `generate-wallet.js` | Generate new EVM wallet |
| `networks.js` | Network configuration |
| `create-xrpl-wallet.js` | Create new XRPL wallet |
| `xrpl-send.js` | XRPL send/balance/history |
| `swap-*.js` | DEX swap helpers (Blazeswap, SparkDex, OpenOcean, V2, V3) |

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
- Use encrypted keystores (EVM) or `.secrets/` directory (XRPL)
- Verify addresses before sending
- Test with small amounts first

## Agent Wallets

Configure your own wallet addresses and keystores:

| Chain | Keystore Location |
|-------|-------------------|
| EVM (all) | `~/.agent-keystore.json` (encrypted) |
| XRPL | `.secrets/xrpl-wallet.json` |
| Solana | `~/.config/solana/id.json` |

## Routing Guide

### Use this skill when...
- Checking balances on any chain
- Sending tokens (EVM, XRP, SOL)
- Wrapping/unwrapping native tokens
- Token approvals and allowance management
- Creating new wallets

### Don't use when...
- Swapping tokens → use `/swap`
- Checking full DeFi portfolio → use `/portfolio`
- LP position management → use `/lp`
