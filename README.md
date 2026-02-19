# Flare Agent Skills

A collection of DeFi skills for AI agents operating on Flare Network. Built for use with [OpenClaw](https://openclaw.ai) and [FlareBank]([flrbank.com](https://www.flrbank.com/)).

## Install

```bash
curl -sL https://raw.githubusercontent.com/canddao1-dotcom/flare-agent-skills/main/install.sh | bash
```

That's it. All skills are installed into your agent's workspace and ready to use.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| cdp | `/cdp` | Enosys Loans — stability pool deposits, withdrawals, rewards |
| fb | `/fb` | FlareBank — dashboard, mint/burn BANK, claim/compound dividends, price checker |
| ftso | `/price` | FTSO oracle price queries (real-time) |
| spectra | `/spectra` | Spectra Finance yield trading (PT/YT) |
| swap | `/swap` | Token swaps on Flare DEXs (Enosys, SparkDex, Blazeswap) |
| upshift | `/upshift` | Upshift Finance yield vaults (earnXRP) |
| wallet | `/wallet`, `/send` | Balances, send (with safety checks), wrap/unwrap, approvals |
| sparkdex-v4 | `/sparkdex` | SparkDex V4 (Algebra Integral) — swap, quote, LP management |
| enosys-v3 | `/enosys` | Enosys V3 (Uniswap V3) — swap, quote, LP management |

## Setup

### Environment Variables

```bash
export AGENT_WALLET="0xYourWalletAddress"
export AGENT_KEYSTORE="./keystore.json"
export KEYSTORE_PASSWORD_PATH="./keystore-password"
```

| Variable | Description | Required |
|----------|-------------|----------|
| `AGENT_WALLET` | Your wallet address | For balance checks |
| `AGENT_KEYSTORE` | Path to encrypted keystore JSON | For transactions |
| `KEYSTORE_PASSWORD_PATH` | Path to keystore password file | For transactions |

### Requirements

- Node.js 18+
- Flare RPC access (public RPCs work)
- ethers.js v6 (auto-installed)

## Usage

Each skill has a `SKILL.md` with full instructions. Skills work with OpenClaw agents or standalone:

```bash
# Check FTSO prices
node skills/ftso/scripts/price.js FLR

# Check wallet balance
AGENT_WALLET=0x... node skills/wallet/scripts/balance.js

# FlareBank dashboard
node skills/fb/scripts/fb.js dashboard

# Swap tokens
node skills/swap/scripts/aggregator.js quote WFLR FXRP 100

# Safe send with confirmation
node skills/wallet/scripts/send.js --to 0x... --amount 100 --token WFLR --confirm --keystore ./keystore.json
```

## License

MIT

Built by [@cand_dao](https://x.com/cand_dao) 🤖
