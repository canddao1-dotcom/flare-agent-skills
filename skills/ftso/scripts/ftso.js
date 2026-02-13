#!/usr/bin/env node
/**
 * FTSO Prices - Unified Entry Point
 * 
 * Subcommands:
 *   (symbol)    - Get price for symbol (default)
 *   history     - Historical prices
 *   list        - List supported symbols
 * 
 * Usage:
 *   /price FLR
 *   /price FLR XRP ETH
 *   /price history FLR 7d
 */

const { spawn } = require('child_process');
const path = require('path');

// Script paths
const SCRIPTS = {
  price: path.join(__dirname, 'price.js'),
  history: path.join(__dirname, '../../ftso-history/scripts/query.js'),
};

// Common symbol aliases
const SYMBOL_MAP = {
  WFLR: 'FLR',
  SFLR: 'FLR',
  FXRP: 'XRP',
  'USD₮0': 'USDT',
  USDT0: 'USDT',
};

function showHelp() {
  console.log(`
FTSO Prices - Unified Command

Usage: /price <symbol> [symbol2] [symbol3] ...
       /price history <symbol> [period]
       /price list

Commands:
  <symbol>              Get current FTSO price for symbol
  <symbol> <symbol>...  Get multiple prices at once
  history <sym> [days]  Historical price data
  list                  List all supported FTSO symbols

Examples:
  /price FLR                    # FLR/USD price
  /price FLR XRP ETH            # Multiple prices
  /price BTC --json             # JSON output
  /price history FLR 7d         # 7-day history
  /price history XRP 30d        # 30-day history
  /price list                   # All symbols

Symbol Aliases:
  WFLR → FLR
  SFLR → FLR  
  FXRP → XRP
  USD₮0 → USDT

Data Source: Flare FTSO v2 (on-chain oracle)
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

function mapSymbol(sym) {
  const upper = sym.toUpperCase();
  return SYMBOL_MAP[upper] || upper;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }
  
  const cmd = args[0]?.toLowerCase();
  const restArgs = args.slice(1);
  
  try {
    // Handle history command
    if (cmd === 'history' || cmd === 'hist') {
      const symbol = restArgs[0];
      if (!symbol) {
        console.error('Error: Symbol required');
        console.log('Usage: /price history <symbol> [period]');
        process.exit(1);
      }
      const period = restArgs[1] || '7d';
      await runScript(SCRIPTS.history, [mapSymbol(symbol), '--period', period, ...restArgs.slice(2)]);
      return;
    }
    
    // Handle list command
    if (cmd === 'list' || cmd === 'symbols') {
      console.log(`
Supported FTSO Symbols:

Crypto:
  FLR    - Flare (WFLR, sFLR)
  XRP    - Ripple (FXRP)
  ETH    - Ethereum
  BTC    - Bitcoin
  LTC    - Litecoin
  XLM    - Stellar
  DOGE   - Dogecoin
  ADA    - Cardano
  ALGO   - Algorand
  ARB    - Arbitrum
  AVAX   - Avalanche
  BNB    - Binance Coin
  FIL    - Filecoin
  LINK   - Chainlink
  MATIC  - Polygon
  USDC   - USD Coin
  USDT   - Tether

Note: Symbol aliases (WFLR→FLR, FXRP→XRP) handled automatically.
`);
      return;
    }
    
    // Default: price lookup for one or more symbols
    const symbols = args.map(mapSymbol).filter(s => !s.startsWith('--'));
    const flags = args.filter(a => a.startsWith('--'));
    
    if (symbols.length === 0) {
      console.error('Error: At least one symbol required');
      showHelp();
      process.exit(1);
    }
    
    await runScript(SCRIPTS.price, [...symbols, ...flags]);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
