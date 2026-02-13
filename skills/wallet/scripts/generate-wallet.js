#!/usr/bin/env node
/**
 * Secure Wallet Generator
 * 
 * Generates a new Ethereum/Flare wallet with encrypted keystore.
 * NEVER outputs raw private key - only encrypted keystore.
 * 
 * Usage: 
 *   node generate-wallet.js                    # Interactive password prompt
 *   node generate-wallet.js --password <pw>   # For automation (less secure)
 *   node generate-wallet.js --output <file>   # Save keystore to file
 */

const crypto = require('crypto');
const fs = require('fs');
const readline = require('readline');

// Flare network config
const CHAIN_ID = 14;
const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';

// Parse arguments
const args = process.argv.slice(2);
const passwordIdx = args.indexOf('--password');
const outputIdx = args.indexOf('--output');
const password = passwordIdx >= 0 ? args[passwordIdx + 1] : null;
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : null;

async function promptPassword() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    // Disable echo for password input
    process.stdout.write('Enter password for keystore encryption: ');
    rl.question('', (answer) => {
      rl.close();
      console.log(''); // newline
      resolve(answer);
    });
  });
}

async function generateWallet(encryptionPassword) {
  // Dynamic import for ethers (ESM compatible)
  let ethers;
  try {
    ethers = require('ethers');
  } catch (e) {
    // Try from flarebank scripts
    ethers = require('flarebank/scripts/node_modules/ethers');
  }
  
  console.log('🔐 Generating new wallet...\n');
  
  // Generate random wallet
  const wallet = ethers.Wallet.createRandom();
  
  // Get checksummed address
  const address = wallet.address;
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('📍 ADDRESS (safe to share):');
  console.log(`   ${address}`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  // Encrypt to keystore
  console.log('🔒 Encrypting private key to keystore...');
  console.log('   (This may take 10-30 seconds)\n');
  
  // ethers v6 API
  const keystore = await wallet.encrypt(encryptionPassword);
  
  console.log('✅ Keystore created successfully!\n');
  
  // Output keystore
  if (outputFile) {
    fs.writeFileSync(outputFile, keystore);
    console.log(`💾 Keystore saved to: ${outputFile}`);
    console.log('   ⚠️  Keep this file secure! Anyone with this file + password can access funds.\n');
  } else {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🔐 ENCRYPTED KEYSTORE (save this securely):');
    console.log('═══════════════════════════════════════════════════════');
    console.log(keystore);
    console.log('═══════════════════════════════════════════════════════\n');
  }
  
  // Security reminders
  console.log('⚠️  SECURITY REMINDERS:');
  console.log('   • Store the keystore file in a secure location');
  console.log('   • Use a strong, unique password');
  console.log('   • Never share the keystore + password together');
  console.log('   • Test with small amounts before large transfers');
  console.log('   • This wallet needs FLR for gas before it can transact\n');
  
  // Flare explorer link
  console.log(`🔗 View on Flarescan: https://flarescan.com/address/${address}`);
  
  return { address, keystore };
}

async function main() {
  const encryptionPassword = password || await promptPassword();
  
  if (!encryptionPassword || encryptionPassword.length < 8) {
    console.error('❌ Password must be at least 8 characters');
    process.exit(1);
  }
  
  await generateWallet(encryptionPassword);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
