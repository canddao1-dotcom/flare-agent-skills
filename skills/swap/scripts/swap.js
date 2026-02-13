#!/usr/bin/env node
/**
 * Token Swaps - Unified Entry Point
 * 
 * Subcommands:
 *   (default)    - Enosys V3 swap (most liquidity)
 *   spark        - SparkDex V3.1 swap
 *   blaze        - Blazeswap V2 swap
 *   v2           - Enosys V2 swap (for BANK)
 *   quote        - Get quote without swapping
 *   wrap         - Wrap FLR to WFLR
 *   unwrap       - Unwrap WFLR to FLR
 *   pools        - List available pools
 * 
 * Usage:
 *   /swap WFLR FXRP 10              # V3 swap 10 WFLR to FXRP
 *   /swap spark WFLR FXRP 10        # SparkDex swap
 *   /swap blaze WFLR FXRP 10        # Blazeswap V2 swap
 *   /swap v2 WFLR BANK 10           # V2 swap for BANK
 *   /swap quote WFLR FXRP 10        # Quote only
 *   /swap wrap 100                  # Wrap 100 FLR
 *   /swap unwrap 100                # Unwrap 100 WFLR
 */

const { spawn } = require('child_process');
const path = require('path');

// Script paths
const SCRIPTS = {
  v3: path.join(__dirname, '../../wallet/scripts/swap-v3.js'),
  spark: path.join(__dirname, '../../wallet/scripts/swap-sparkdex.js'),
  blaze: path.join(__dirname, '../../wallet/scripts/swap-blazeswap.js'),
  v2: path.join(__dirname, '../../wallet/scripts/swap-v2-helper.js'),
  wrap: path.join(__dirname, '../../wallet/scripts/wrap-flr.js'),
  openocean: path.join(__dirname, '../../wallet/scripts/swap-openocean.js'),
};

const KEYSTORE = process.env.AGENT_KEYSTORE || './keystore.json';

// Common tokens
const TOKENS = {
  WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
  SFLR: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
  FXRP: '0xad552a648c74d49e10027ab8a618a3ad4901c5be',
  BANK: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059',
  USDT0: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
  'USD₮0': '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
  USDC: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6',
  CDP: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F',
};

function showHelp() {
  console.log(`
Token Swaps - Unified Command

Usage: /swap [dex] <from> <to> <amount> [options]

DEX Options:
  (default)      Enosys V3 - best for most pairs
  spark          SparkDex V3.1 - alternative V3
  blaze          Blazeswap V2 - direct pair swaps
  v2             Enosys V2 - for BANK token
  openocean      OpenOcean aggregator (beta)

Commands:
  /swap <from> <to> <amount>           Enosys V3 swap
  /swap spark <from> <to> <amount>     SparkDex swap
  /swap blaze <from> <to> <amount>     Blazeswap V2 swap
  /swap v2 <from> <to> <amount>        V2 swap (BANK)
  /swap quote <from> <to> <amount>     Get quote (no swap)
  /swap wrap <amount>                  Wrap FLR to WFLR
  /swap unwrap <amount>                Unwrap WFLR to FLR
  /swap pools                          List V3 pools

Options:
  --fee <tier>       Fee tier (500=0.05%, 3000=0.3%, 10000=1%)
  --slippage <pct>   Slippage tolerance (default: 1%)
  --dry-run          Simulate without executing

Examples:
  /swap WFLR FXRP 100                  # Swap 100 WFLR to FXRP
  /swap WFLR SFLR 50 --fee 500         # Use 0.05% pool
  /swap spark WFLR USDT0 100           # SparkDex swap
  /swap blaze WFLR FXRP 100            # Blazeswap swap
  /swap v2 WFLR BANK 10                # Buy BANK via V2
  /swap v2 BANK WFLR 1                 # Sell BANK via V2
  /swap quote WFLR FXRP 100            # Get quote
  /swap wrap 100                       # Wrap 100 FLR

Supported Tokens: ${Object.keys(TOKENS).join(', ')}
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

function parseArgs(args) {
  const result = { positional: [], flags: {} };
  let i = 0;
  
  while (i < args.length) {
    if (args[i].startsWith('--')) {
      const flag = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result.flags[flag] = args[i + 1];
        i += 2;
      } else {
        result.flags[flag] = true;
        i++;
      }
    } else {
      result.positional.push(args[i]);
      i++;
    }
  }
  
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }
  
  const { positional, flags } = parseArgs(args);
  let cmd = positional[0]?.toLowerCase();
  
  try {
    // Handle wrap/unwrap
    if (cmd === 'wrap') {
      const amount = positional[1];
      if (!amount) {
        console.error('Error: Amount required');
        console.log('Usage: /swap wrap <amount>');
        process.exit(1);
      }
      await runScript(SCRIPTS.wrap, ['wrap', '--keystore', KEYSTORE, '--amount', amount]);
      return;
    }
    
    if (cmd === 'unwrap') {
      const amount = positional[1];
      if (!amount) {
        console.error('Error: Amount required');
        console.log('Usage: /swap unwrap <amount>');
        process.exit(1);
      }
      await runScript(SCRIPTS.wrap, ['unwrap', '--keystore', KEYSTORE, '--amount', amount]);
      return;
    }
    
    // Handle pools list
    if (cmd === 'pools') {
      await runScript(SCRIPTS.v3, ['pools']);
      return;
    }
    
    // Handle quote
    if (cmd === 'quote') {
      const [_, from, to, amount] = positional;
      if (!from || !to || !amount) {
        console.error('Error: Missing arguments');
        console.log('Usage: /swap quote <from> <to> <amount>');
        process.exit(1);
      }
      const quoteArgs = ['quote', '--from', from.toUpperCase(), '--to', to.toUpperCase(), '--amount', amount];
      if (flags.fee) quoteArgs.push('--fee', flags.fee);
      await runScript(SCRIPTS.v3, quoteArgs);
      return;
    }
    
    // Determine DEX and swap params
    let dex = 'v3';  // default
    let fromToken, toToken, amount;
    
    if (cmd === 'spark' || cmd === 'sparkdex') {
      dex = 'spark';
      [_, fromToken, toToken, amount] = positional;
    } else if (cmd === 'blaze' || cmd === 'blazeswap') {
      dex = 'blaze';
      [_, fromToken, toToken, amount] = positional;
    } else if (cmd === 'v2') {
      dex = 'v2';
      [_, fromToken, toToken, amount] = positional;
    } else if (cmd === 'openocean' || cmd === 'oo') {
      dex = 'openocean';
      [_, fromToken, toToken, amount] = positional;
    } else {
      // Default V3 swap: /swap WFLR FXRP 10
      dex = 'v3';
      [fromToken, toToken, amount] = positional;
    }
    
    if (!fromToken || !toToken || !amount) {
      console.error('Error: Missing arguments');
      console.log('Usage: /swap [dex] <from> <to> <amount>');
      showHelp();
      process.exit(1);
    }
    
    // Build swap args
    const swapArgs = ['swap', '--keystore', KEYSTORE, '--from', fromToken.toUpperCase(), '--to', toToken.toUpperCase(), '--amount', amount];
    
    if (flags.fee) swapArgs.push('--fee', flags.fee);
    if (flags.slippage) swapArgs.push('--slippage', flags.slippage);
    if (flags['dry-run']) swapArgs.push('--dry-run');
    
    // Execute appropriate script
    switch (dex) {
      case 'spark':
        await runScript(SCRIPTS.spark, swapArgs);
        break;
      case 'blaze':
        await runScript(SCRIPTS.blaze, swapArgs);
        break;
      case 'v2':
        // V2 uses different args format
        const v2Args = ['swap', '--keystore', KEYSTORE, '--from', fromToken.toUpperCase(), '--amount', amount];
        if (flags.slippage) v2Args.push('--slippage', flags.slippage);
        await runScript(SCRIPTS.v2, v2Args);
        break;
      case 'openocean':
        await runScript(SCRIPTS.openocean, swapArgs);
        break;
      default:
        await runScript(SCRIPTS.v3, swapArgs);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
