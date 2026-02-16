---
name: fassets
description: FAssets mint and redeem on Flare. Mint FXRP by sending XRP to an agent, redeem FXRP back to XRP on XRPL. Triggers on "/fassets", "mint fxrp", "redeem fxrp", "fassets redeem", "fassets mint".
---

# FAssets Skill

Mint and redeem FAssets (FXRP) on Flare Network. FAssets are trustless, over-collateralized wrapped tokens backed by real XRP on the XRPL.

## Quick Commands

```bash
# Check redemption info (lot size, fees, available agents)
node skills/fassets/scripts/fassets.js info

# Redeem FXRP → XRP (sends XRP to your XRPL address)
node skills/fassets/scripts/fassets.js redeem --lots 1 --xrpl-address rXXXXX... --keystore <path>

# Check redemption status
node skills/fassets/scripts/fassets.js status --xrpl-address rXXXXX...

# Create an XRPL wallet (needed for redemption)
node skills/wallet/scripts/create-xrpl-wallet.js --save ~/.secrets/xrpl-wallet.json
```

## Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| FXRP Token | `0xAd552A648C74D49E10027AB8a618A3ad4901c5bE` | ERC-20 FAsset token (6 decimals) |
| AssetManager | `0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8` | Mint/redeem controller |
| AssetManagerController | `0x097B93eEBe9b76f2611e1E7D9665a9d7Ff5280B3` | System controller |

## Key Parameters

| Parameter | Value |
|-----------|-------|
| Lot Size | 10 FXRP (10 XRP) |
| Decimals | 6 |
| Redemption Fee | ~0.2% (deducted from XRP received) |
| Redemption Time | Usually < 5 minutes |

## Redemption Flow

1. **Approve** FXRP to AssetManager contract
2. **Call** `redeem(lots, xrplAddress, executor)` on AssetManager
3. **Wait** for agent to send XRP to your XRPL address
4. XRP arrives automatically (agent handles underlying payment)

## Notes

- Redemptions are in **lots** (1 lot = 10 FXRP = 10 XRP)
- Your XRPL address does NOT need to be pre-activated — the incoming XRP payment activates it (if ≥ 10 XRP reserve)
- The executor parameter can be `address(0)` for self-service redemption
- Agents typically pay within minutes
- Minting requires sending XRP on XRPL to an agent's address (use the dApp at https://fassets.au.cc/mint)

## Minting Flow (via dApp)

1. Go to https://fassets.au.cc/mint
2. Connect Flare wallet + XRPL wallet
3. Select amount and agent
4. Send XRP to agent's XRPL address
5. FDC verifies payment → FXRP minted to your Flare address

## Dependencies

```bash
npm install ethers xrpl
```
