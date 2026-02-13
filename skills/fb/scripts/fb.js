#!/usr/bin/env node
/**
 * FlareBank Protocol - Unified Entry Point
 * 
 * Subcommands:
 *   dashboard   - Full protocol analytics
 *   status      - Vault status and balances
 *   mint        - Mint BANK with FLR
 *   burn        - Burn BANK for FLR
 *   claim       - Claim dividends
 *   compound    - Compound dividends to BANK
 * 
 * Usage:
 *   /fb dashboard
 *   /fb status
 *   /fb mint 100
 *   /fb bankrate
 */

const { spawn } = require('child_process');
const path = require('path');

// Script paths (all local after merge)
const SCRIPTS = {
  dashboard: path.join(__dirname, 'dashboard.js'),
  vault: path.join(__dirname, 'vault.js'),
  bankrate: path.join(__dirname, 'bankrate.js'),
};

const KEYSTORE = process.env.AGENT_KEYSTORE || './keystore.json';

function showHelp() {
  console.log(`
FlareBank Protocol - Unified Command

Usage: /fb <command> [options]

Commands:
  dashboard              Full protocol analytics (TVL, supply, rewards)
  status                 Vault status, balances, pending dividends
  mint <amount>          Mint BANK by depositing FLR
  burn <amount>          Burn BANK to withdraw FLR
  claim                  Claim pending dividends to wallet
  compound               Compound dividends into more BANK
  bankrate               BANK price comparison (LP vs contract)

Examples:
  /fb dashboard                  # Full protocol stats
  /fb status                     # Check vault + balances
  /fb mint 100                   # Mint BANK with 100 FLR
  /fb burn 10                    # Burn 10 BANK for FLR
  /fb claim                      # Claim dividends
  /fb compound                   # Auto-compound divs

Protocol Details:
  Contract: 0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059
  Token: BANK (18 decimals)
  Mint Fee: 10% (80% holders, 15% team, 5% DAO)
  Burn Fee: 10% (80% holders, 15% team, 5% DAO)

Keystore: ${KEYSTORE}
`);
}

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      env: process.env
    });
    
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script exited with code ${code}`));
    });
    
    child.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0]?.toLowerCase();
  const restArgs = args.slice(1);
  
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    showHelp();
    process.exit(0);
  }
  
  try {
    switch (cmd) {
      case 'dashboard':
      case 'dash':
      case 'stats':
        await runScript(SCRIPTS.dashboard, restArgs);
        break;
        
      case 'status':
      case 'stat':
        await runScript(SCRIPTS.vault, ['status', ...restArgs]);
        break;
        
      case 'mint':
      case 'buy':
        if (!restArgs[0]) {
          console.error('Error: Amount required');
          console.log('Usage: /fb mint <amount>');
          process.exit(1);
        }
        await runScript(SCRIPTS.vault, ['mint', '--keystore', KEYSTORE, '--amount', restArgs[0], ...restArgs.slice(1)]);
        break;
        
      case 'burn':
      case 'sell':
        if (!restArgs[0]) {
          console.error('Error: Amount required');
          console.log('Usage: /fb burn <amount>');
          process.exit(1);
        }
        await runScript(SCRIPTS.vault, ['burn', '--keystore', KEYSTORE, '--amount', restArgs[0], ...restArgs.slice(1)]);
        break;
        
      case 'claim':
      case 'withdraw':
        await runScript(SCRIPTS.vault, ['claim', '--keystore', KEYSTORE, ...restArgs]);
        break;
        
      case 'compound':
      case 'reinvest':
        await runScript(SCRIPTS.vault, ['compound', '--keystore', KEYSTORE, ...restArgs]);
        break;
        
      case 'bankrate':
      case 'rate':
      case 'price':
        await runScript(SCRIPTS.bankrate, restArgs);
        break;
        
      default:
        console.error(`Unknown command: ${cmd}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
