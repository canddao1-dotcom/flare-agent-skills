#!/usr/bin/env node
/**
 * FTSO Price Feed
 * Get real-time token prices from Flare's FTSO v2 oracle
 * 
 * Usage:
 *   node price.js FLR
 *   node price.js FLR XRP ETH --json
 *   node price.js FLR --block 12345678
 */

const { ethers } = require('ethers');

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';
const FLARE_CONTRACT_REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';

// Symbol equivalents - map wrapped/staked versions to base symbols
const SYMBOL_EQUIVALENTS = {
  'WFLR': 'FLR',
  'SFLR': 'FLR',
  'FXRP': 'XRP',
  'STXRP': 'XRP',
  'EETH': 'ETH',
  'WETH': 'ETH',
  'EUSDT': 'USDT',
  'USDT0': 'USDT',
  'USD₮0': 'USDT',
  'USDCE': 'USDC',
  'USDC.E': 'USDC',
  'CDP': 'USD', // CDP is ~$1
};

// Cache
let provider = null;
let ftsoV2Address = null;
let ftsoV2Contract = null;

function getProvider() {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return provider;
}

function getFeedId(feedName, category = '01') {
  // Convert feed name to hex and pad
  // e.g., "FLR/USD" -> 0x01464c522f55534400000000000000000000000000
  const hexFeedName = Buffer.from(feedName).toString('hex');
  const paddedHex = (category + hexFeedName).padEnd(42, '0');
  return '0x' + paddedHex;
}

async function getFtsoV2Contract() {
  if (ftsoV2Contract) return ftsoV2Contract;
  
  const p = getProvider();
  
  // Get FtsoV2 address from registry
  const registryAbi = ['function getContractAddressByName(string _name) view returns (address)'];
  const registry = new ethers.Contract(FLARE_CONTRACT_REGISTRY, registryAbi, p);
  ftsoV2Address = await registry.getContractAddressByName('FtsoV2');
  
  // FtsoV2 ABI
  const ftsoV2Abi = [
    'function getFeedById(bytes21 _feedId) view returns (uint256 value, int8 decimals, uint64 timestamp)'
  ];
  ftsoV2Contract = new ethers.Contract(ftsoV2Address, ftsoV2Abi, p);
  
  return ftsoV2Contract;
}

async function getPrice(symbol, blockTag = 'latest') {
  // Normalize symbol
  const upperSymbol = symbol.toUpperCase();
  const normalizedSymbol = SYMBOL_EQUIVALENTS[upperSymbol] || upperSymbol;
  const feedId = getFeedId(`${normalizedSymbol}/USD`);
  
  try {
    const ftsoV2 = await getFtsoV2Contract();
    const [value, decimals, timestamp] = await ftsoV2.getFeedById(feedId, { blockTag });
    
    const price = Number(value) / Math.pow(10, Number(decimals));
    
    return {
      symbol: upperSymbol,
      normalizedSymbol,
      price,
      decimals: Number(decimals),
      timestamp: Number(timestamp),
      timestampISO: new Date(Number(timestamp) * 1000).toISOString(),
      feedId
    };
  } catch (e) {
    return {
      symbol: upperSymbol,
      normalizedSymbol,
      price: null,
      error: e.message.includes('execution reverted') ? 'Feed not available' : e.message
    };
  }
}

async function getPrices(symbols, blockTag = 'latest') {
  const results = await Promise.all(symbols.map(s => getPrice(s, blockTag)));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node price.js <symbol> [symbol2 ...] [--block <num>] [--json]');
    console.log('Example: node price.js FLR XRP ETH BTC');
    console.log('\nSupported: FLR, XRP, ETH, BTC, USDT, USDC, LTC, DOGE, ADA, etc.');
    process.exit(1);
  }
  
  // Parse arguments
  const symbols = [];
  let block = 'latest';
  let jsonOutput = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--block' && args[i + 1]) {
      block = parseInt(args[++i]);
    } else if (args[i] === '--json') {
      jsonOutput = true;
    } else if (!args[i].startsWith('--')) {
      symbols.push(args[i]);
    }
  }
  
  if (symbols.length === 0) {
    console.error('No symbols provided');
    process.exit(1);
  }
  
  const prices = await getPrices(symbols, block);
  
  if (jsonOutput) {
    console.log(JSON.stringify(prices, null, 2));
  } else {
    console.log('📊 FTSO Prices (Flare Oracle)\n');
    for (const p of prices) {
      if (p.price !== null) {
        console.log(`${p.symbol.padEnd(6)} $${p.price.toFixed(6).padStart(12)} | ${p.timestampISO}`);
      } else {
        console.log(`${p.symbol.padEnd(6)} Error: ${p.error}`);
      }
    }
    console.log(`\nSource: FtsoV2 (${ftsoV2Address})`);
  }
}

// Export for use as module
module.exports = { getPrice, getPrices, getFeedId, SYMBOL_EQUIVALENTS };

// Run if called directly
if (require.main === module) {
  main().catch(e => { console.error('Error:', e.message); process.exit(1); });
}
