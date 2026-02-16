#!/usr/bin/env node
/**
 * XRPL Wallet Generator
 * 
 * Creates a new XRPL (XRP Ledger) wallet with address and secret.
 * The wallet needs 10 XRP reserve to activate on mainnet.
 * 
 * Usage:
 *   node create-xrpl-wallet.js                    # Generate and print
 *   node create-xrpl-wallet.js --save wallet.json  # Generate and save to file
 *   node create-xrpl-wallet.js --json              # JSON output only
 * 
 * Dependencies: npm install xrpl
 * 
 * ⚠️  SECURITY: Never commit wallet secrets to git!
 *     Save to a secure location with restricted permissions (chmod 600).
 */

const fs = require('fs');
const path = require('path');

async function main() {
  let xrpl;
  try {
    xrpl = require('xrpl');
  } catch (e) {
    console.error('❌ Missing dependency: xrpl');
    console.error('   Run: npm install xrpl');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const saveIdx = args.indexOf('--save');
  const savePath = saveIdx !== -1 ? args[saveIdx + 1] : null;

  // Generate wallet
  const wallet = xrpl.Wallet.generate();

  const walletData = {
    address: wallet.classicAddress,
    secret: wallet.seed,
    publicKey: wallet.publicKey,
    privateKey: wallet.privateKey,
    created: new Date().toISOString(),
    network: 'XRPL Mainnet',
    note: 'Needs 10 XRP reserve to activate on mainnet'
  };

  if (jsonOnly) {
    console.log(JSON.stringify(walletData, null, 2));
  } else {
    console.log('');
    console.log('🔑 XRPL Wallet Generated');
    console.log('════════════════════════════════════════');
    console.log(`  Address:     ${walletData.address}`);
    console.log(`  Secret:      ${walletData.secret}`);
    console.log(`  Public Key:  ${walletData.publicKey}`);
    console.log('════════════════════════════════════════');
    console.log('');
    console.log('⚠️  IMPORTANT:');
    console.log('  • Save your secret securely — it cannot be recovered!');
    console.log('  • Send at least 10 XRP to activate the address on mainnet');
    console.log('  • Never share your secret or private key');
    console.log('  • Use --save <file> to save to an encrypted file');
  }

  if (savePath) {
    const resolved = path.resolve(savePath);
    fs.writeFileSync(resolved, JSON.stringify(walletData, null, 2) + '\n', { mode: 0o600 });
    if (!jsonOnly) {
      console.log(`\n✅ Saved to ${resolved} (chmod 600)`);
    }
  }

  if (!savePath && !jsonOnly) {
    console.log('\n💡 To save: node create-xrpl-wallet.js --save ~/.secrets/xrpl-wallet.json');
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
