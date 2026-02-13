#!/usr/bin/env node
/**
 * FlareBank Protocol Dashboard
 * Pulls TVL, token data, and DAO treasury info from Flare RPC
 */

const https = require('https');
const http = require('http');

const RPC = 'https://flare-api.flare.network/ext/C/rpc';

// Contract addresses
const CONTRACTS = {
  WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
  BANK: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059',
  IBDP: '0x90679234fe693b39bfdf5642060cb10571adc59b',
  DAO: '0xaa68bc4bab9a63958466f49f5a58c54a412d4906',
  sFLR: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
  rFLR: '0x26d460c3Cf931Fb2014FA436a49e3Af08619810e',
  FXRP: '0xad552a648c74d49e10027ab8a618a3ad4901c5be',
  APS: '0xff56eb5b1a7faa972291117e5e9565da29bc808d',
  ENOSYS_V2_LP: '0x5f29c8d049e47dd180c2b83e3560e8e271110335',
  SPARK_V2_LP: '0x0f574fc895c1abf82aeff334fa9d8ba43f866111',
  V3_POSITION_MANAGER: '0xd9770b1c7a6ccd33c75b5bcb1c0078f46be46657',
  V3_POOL_STXRP_FXRP: '0xa4ce7dafc6fb5aceedd0070620b72ab8f09b0770',
  // CDP Earn Pools (Stability Pools)
  CDP_EARN_FXRP: '0x2c817F7159c08d94f09764086330c96Bb3265A2f',
  CDP_EARN_WFLR: '0x0Dd6daab4cB9A0ba6707Cf59DBfbc28cc33CA24A',
  // Price pools (Enosys V3)
  PRICE_POOL_FXRP_WFLR: '0xb4cb11a84cfbd8f6336dc9417ac45c1f8e5b59e7',
  PRICE_POOL_SFLR_WFLR: '0x25b4f3930934f0a3cbb885c624ecee75a2917144',
  PRICE_POOL_USDT_WFLR: '0xd0ff204b0bc91c45987568dbf12fa24445a93453',
  // FlareDrop Distribution
  FLAREDROP: '0x9c7A4C83842B29bB4A082b0E689CB9474BD938d0',
  // FTSOv2 RewardManager (for delegation rewards)
  REWARD_MANAGER: '0xc8f55c5aa2c752ee285bd872855c749f4ee6239b',
  // APS Staking (Enosys gov staking)
  APS_STAKING: '0x7eb8ceb0f64d934a31835b98eb4cbab3ca56df28'
};

const V3_POSITION_ID = 28509; // DAO's V3 position
const FOUNDER_WALLET = '0x3c1c84132dfdef572e74672917700c065581871d';

// FlareBank Infrastructure
const FTSO_ADDRESS = '0xfa9368CFbee3b070d8552d8e75Cdc0fF72eFAC50';
const VALIDATOR_NODES = [
  'NodeID-GoVQ17h7kU1H3pKBZHF3cu2NyTBichnfg',
  'NodeID-Mhm29H5a3Xq1jG9UpVoqo5mFXqqL3WpUV'
];
const P_CHAIN_RPC = 'https://flare-api.flare.network/ext/bc/P';

// Reward estimation parameters (from Catenalytica epoch 366)
const REWARD_PARAMS = {
  delegationAPY: 0.0783,    // 7.83% - FTSO delegation APY
  stakingAPY: 0.1531,       // 15.31% - Validator staking APY
  providerFee: 0.095,       // 9.5% fee
  epochsPerYear: 104        // ~3.5 days per epoch
};

// Function selectors
const SELECTORS = {
  balanceOf: '0x70a08231',
  totalSupply: '0x18160ddd',
  buyPrice: '0x8620410b',
  sellPrice: '0x4b750334',
  getReserves: '0x0902f1ac',
  positions: '0x99fbab88',
  slot0: '0x3850c7bd',
  ownerOf: '0x6352211e',
  // CDP Earn (Stability Pool) selectors
  getCompoundedBoldDeposit: '0x065f566d',
  getDepositorYieldGain: '0xdaed0a9b',
  getDepositorCollGain: '0x47ea8354',
  // rFLR vesting
  getBalancesOf: '0xd6ab3b7f'
};

// Helpers
const padAddress = (addr) => '000000000000000000000000' + addr.slice(2).toLowerCase();
const padUint256 = (n) => n.toString(16).padStart(64, '0');
const toDecimal = (hex, decimals = 18) => Number(BigInt(hex)) / Math.pow(10, decimals);
const fmt = (n, d = 2) => n.toLocaleString('en-US', { maximumFractionDigits: d });

// RPC call helper
async function rpcCall(to, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
      id: 1
    });

    const url = new URL(RPC);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Query functions
async function getBalance(token, holder) {
  const data = SELECTORS.balanceOf + padAddress(holder);
  return rpcCall(token, data);
}

async function getTotalSupply(token) {
  return rpcCall(token, SELECTORS.totalSupply);
}

async function getBuyPrice() {
  return rpcCall(CONTRACTS.BANK, SELECTORS.buyPrice);
}

async function getReserves(lpToken) {
  return rpcCall(lpToken, SELECTORS.getReserves);
}

async function getV3Position(tokenId) {
  const data = SELECTORS.positions + padUint256(tokenId);
  return rpcCall(CONTRACTS.V3_POSITION_MANAGER, data);
}

async function getV3Slot0() {
  return rpcCall(CONTRACTS.V3_POOL_STXRP_FXRP, SELECTORS.slot0);
}

async function getPricePoolSlot0(pool) {
  return rpcCall(pool, SELECTORS.slot0);
}

// Calculate price from V3 sqrtPriceX96
// Returns token1/token0 price adjusted for decimals
function calcV3Price(sqrtPriceX96Hex, decimals0, decimals1) {
  const sqrtPrice = BigInt(sqrtPriceX96Hex);
  const Q96 = BigInt(2) ** BigInt(96);
  const priceRaw = Number(sqrtPrice * sqrtPrice) / Number(Q96 * Q96);
  // Adjust for decimal difference
  return priceRaw * Math.pow(10, decimals0 - decimals1);
}

// CDP Earn pool queries
async function getCDPDeposit(pool, holder) {
  const data = SELECTORS.getCompoundedBoldDeposit + padAddress(holder);
  return rpcCall(pool, data);
}

async function getCDPYieldGain(pool, holder) {
  const data = SELECTORS.getDepositorYieldGain + padAddress(holder);
  return rpcCall(pool, data);
}

async function getCDPCollGain(pool, holder) {
  const data = SELECTORS.getDepositorCollGain + padAddress(holder);
  return rpcCall(pool, data);
}

// FTSO vote power query
async function getFTSOVotePower() {
  const data = '0x142d1018' + padAddress(FTSO_ADDRESS); // votePowerOf(address)
  return rpcCall(CONTRACTS.WFLR, data);
}

// rFLR vesting query - returns { total, vested, unvested }
async function getRflrBalances(holder) {
  const data = SELECTORS.getBalancesOf + padAddress(holder);
  const result = await rpcCall(CONTRACTS.rFLR, data);
  if (!result || result === '0x') return { total: 0, vested: 0, unvested: 0 };
  
  const hex = result.slice(2);
  const rNatBalance = BigInt('0x' + hex.slice(64, 128));
  const lockedBalance = BigInt('0x' + hex.slice(128, 192));
  
  return {
    total: Number(rNatBalance) / 1e18,
    vested: Number(rNatBalance - lockedBalance) / 1e18,
    unvested: Number(lockedBalance) / 1e18
  };
}

// Mint/Burn/Transfer history from Routescan API
const MINT_EVENT_TOPIC = '0x623b3804fa71d67900d064613da8f94b9617215ee90799290593e1745087ad18';
const BURN_EVENT_TOPIC = '0xdd73686403cf2d37d399d32aa0be7cc16f739561af09f5ddf2ccdc238a794e98';
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ROUTESCAN_API = 'https://api.routescan.io/v2/network/mainnet/evm/14/etherscan/api';

async function fetchMintPage(page) {
  return new Promise((resolve, reject) => {
    const url = `${ROUTESCAN_API}?module=logs&action=getLogs&address=${CONTRACTS.BANK}&topic0=${MINT_EVENT_TOPIC}&fromBlock=0&toBlock=latest&page=${page}&offset=1000`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getMintHistory() {
  const allEvents = [];
  let page = 1;
  
  while (true) {
    const data = await fetchMintPage(page);
    if (!data.result || data.result.length === 0) break;
    allEvents.push(...data.result);
    if (data.result.length < 1000) break;
    page++;
    if (page > 20) break; // safety limit
  }
  
  const now = Math.floor(Date.now() / 1000);
  const oneDay = now - 86400;
  const sevenDays = now - 86400 * 7;
  const thirtyDays = now - 86400 * 30;
  
  const stats = {
    allTime: { count: 0, wflr: 0n, bank: 0n },
    month: { count: 0, wflr: 0n, bank: 0n },
    week: { count: 0, wflr: 0n, bank: 0n },
    day: { count: 0, wflr: 0n, bank: 0n }
  };
  
  allEvents.forEach(log => {
    const timestamp = parseInt(log.timeStamp, 16);
    const wflr = BigInt(log.data.slice(0, 66));
    const bank = BigInt('0x' + log.data.slice(66, 130));
    
    stats.allTime.count++;
    stats.allTime.wflr += wflr;
    stats.allTime.bank += bank;
    
    if (timestamp >= thirtyDays) {
      stats.month.count++;
      stats.month.wflr += wflr;
      stats.month.bank += bank;
    }
    if (timestamp >= sevenDays) {
      stats.week.count++;
      stats.week.wflr += wflr;
      stats.week.bank += bank;
    }
    if (timestamp >= oneDay) {
      stats.day.count++;
      stats.day.wflr += wflr;
      stats.day.bank += bank;
    }
  });
  
  return stats;
}

async function fetchBurnPage(page) {
  return new Promise((resolve, reject) => {
    const url = `${ROUTESCAN_API}?module=logs&action=getLogs&address=${CONTRACTS.BANK}&topic0=${BURN_EVENT_TOPIC}&fromBlock=0&toBlock=latest&page=${page}&offset=1000`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getBurnHistory() {
  const allEvents = [];
  let page = 1;
  
  while (true) {
    const data = await fetchBurnPage(page);
    if (!data.result || data.result.length === 0) break;
    allEvents.push(...data.result);
    if (data.result.length < 1000) break;
    page++;
    if (page > 20) break;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const oneDay = now - 86400;
  const sevenDays = now - 86400 * 7;
  const thirtyDays = now - 86400 * 30;
  
  const stats = {
    allTime: { count: 0, bank: 0n, wflr: 0n },
    month: { count: 0, bank: 0n, wflr: 0n },
    week: { count: 0, bank: 0n, wflr: 0n },
    day: { count: 0, bank: 0n, wflr: 0n }
  };
  
  allEvents.forEach(log => {
    const timestamp = parseInt(log.timeStamp, 16);
    const bank = BigInt('0x' + log.data.slice(2, 66));
    const wflr = BigInt('0x' + log.data.slice(66, 130));
    
    // Skip burns over 50k WFLR (failed transactions)
    if (Number(wflr) / 1e18 > 50000) return;
    
    stats.allTime.count++;
    stats.allTime.bank += bank;
    stats.allTime.wflr += wflr;
    
    if (timestamp >= thirtyDays) {
      stats.month.count++;
      stats.month.bank += bank;
      stats.month.wflr += wflr;
    }
    if (timestamp >= sevenDays) {
      stats.week.count++;
      stats.week.bank += bank;
      stats.week.wflr += wflr;
    }
    if (timestamp >= oneDay) {
      stats.day.count++;
      stats.day.bank += bank;
      stats.day.wflr += wflr;
    }
  });
  
  return stats;
}

async function fetchTransferPage(page) {
  return new Promise((resolve, reject) => {
    const url = `${ROUTESCAN_API}?module=logs&action=getLogs&address=${CONTRACTS.BANK}&topic0=${TRANSFER_EVENT_TOPIC}&fromBlock=0&toBlock=latest&page=${page}&offset=1000`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getTransferHistory() {
  const allEvents = [];
  let page = 1;
  
  while (true) {
    const data = await fetchTransferPage(page);
    if (!data.result || data.result.length === 0) break;
    allEvents.push(...data.result);
    if (data.result.length < 1000) break;
    page++;
    if (page > 30) break;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const oneDay = now - 86400;
  const sevenDays = now - 86400 * 7;
  const thirtyDays = now - 86400 * 30;
  
  const stats = {
    allTime: { count: 0, bank: 0n },
    month: { count: 0, bank: 0n },
    week: { count: 0, bank: 0n },
    day: { count: 0, bank: 0n }
  };
  
  // LP swap stats
  const lpAddresses = [CONTRACTS.ENOSYS_V2_LP.toLowerCase(), CONTRACTS.SPARK_V2_LP.toLowerCase()];
  const swapStats = {
    buys: { allTime: { count: 0, bank: 0n }, month: { count: 0, bank: 0n }, week: { count: 0, bank: 0n }, day: { count: 0, bank: 0n } },
    sells: { allTime: { count: 0, bank: 0n }, month: { count: 0, bank: 0n }, week: { count: 0, bank: 0n }, day: { count: 0, bank: 0n } }
  };
  
  const bankLower = CONTRACTS.BANK.toLowerCase();
  
  allEvents.forEach(log => {
    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const to = '0x' + log.topics[2].slice(26).toLowerCase();
    const timestamp = parseInt(log.timeStamp, 16);
    const bank = BigInt(log.data);
    
    // Check for LP swaps
    const isFromLP = lpAddresses.includes(from);
    const isToLP = lpAddresses.includes(to);
    
    if (isFromLP || isToLP) {
      const target = isFromLP ? swapStats.buys : swapStats.sells;
      target.allTime.count++;
      target.allTime.bank += bank;
      if (timestamp >= thirtyDays) { target.month.count++; target.month.bank += bank; }
      if (timestamp >= sevenDays) { target.week.count++; target.week.bank += bank; }
      if (timestamp >= oneDay) { target.day.count++; target.day.bank += bank; }
    }
    
    // Skip mints, burns, and LP swaps for regular transfer stats
    if (from === '0x0000000000000000000000000000000000000000') return;
    if (to === '0x0000000000000000000000000000000000000000') return;
    if (to === bankLower) return;
    if (isFromLP || isToLP) return; // LP swaps tracked separately
    
    stats.allTime.count++;
    stats.allTime.bank += bank;
    
    if (timestamp >= thirtyDays) {
      stats.month.count++;
      stats.month.bank += bank;
    }
    if (timestamp >= sevenDays) {
      stats.week.count++;
      stats.week.bank += bank;
    }
    if (timestamp >= oneDay) {
      stats.day.count++;
      stats.day.bank += bank;
    }
  });
  
  return { transfers: stats, swaps: swapStats };
}

// FlareDrop claim history from Routescan API
// Event: AccountClaimed(address indexed whoClaimed, address indexed sentTo, uint256 month, uint256 amount)
// topic1 = whoClaimed (who initiated), topic2 = sentTo (who received)
async function fetchFlareDropPageByTopic(topicIndex, address, page) {
  return new Promise((resolve, reject) => {
    const paddedAddr = '0x000000000000000000000000' + address.slice(2).toLowerCase();
    const topicParam = topicIndex === 1 ? 'topic1' : 'topic2';
    const url = `${ROUTESCAN_API}?module=logs&action=getLogs&address=${CONTRACTS.FLAREDROP}&${topicParam}=${paddedAddr}&fromBlock=0&toBlock=latest&page=${page}&offset=1000`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getFlareDropHistory(address, useReceivedBy = false) {
  const allEvents = [];
  let page = 1;
  const topicIndex = useReceivedBy ? 2 : 1; // topic2 = sentTo (received), topic1 = whoClaimed
  
  while (true) {
    const data = await fetchFlareDropPageByTopic(topicIndex, address, page);
    if (!data.result || data.result.length === 0) break;
    allEvents.push(...data.result);
    if (data.result.length < 1000) break;
    page++;
    if (page > 20) break;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const oneDay = now - 86400;
  const sevenDays = now - 86400 * 7;
  const thirtyDays = now - 86400 * 30;
  
  const stats = {
    allTime: { count: 0, flr: 0n },
    month: { count: 0, flr: 0n },
    week: { count: 0, flr: 0n },
    day: { count: 0, flr: 0n }
  };
  
  allEvents.forEach(log => {
    const timestamp = parseInt(log.timeStamp, 16);
    // Data: month (uint256) + amount (uint256)
    const amount = BigInt('0x' + log.data.slice(66, 130));
    
    stats.allTime.count++;
    stats.allTime.flr += amount;
    
    if (timestamp >= thirtyDays) {
      stats.month.count++;
      stats.month.flr += amount;
    }
    if (timestamp >= sevenDays) {
      stats.week.count++;
      stats.week.flr += amount;
    }
    if (timestamp >= oneDay) {
      stats.day.count++;
      stats.day.flr += amount;
    }
  });
  
  return stats;
}

// FTSOv2 Reward Claims (Delegation + Provider Fees)
// Event: RewardClaimed(address indexed provider, address indexed beneficiary, address indexed recipient, uint24 epoch, uint8 claimType, uint120 amount)
// Topic0: 0x06f77960d1401cc7d724b5c2b5ad672b9dbf08d8b11516a38c21697c23fbb0d2
// ClaimType 1 = Provider fees (provider = Identity contract collects FTSO provider fees)
// ClaimType 2 = Delegation rewards (provider = FTSO)
const REWARD_CLAIMED_TOPIC = '0x06f77960d1401cc7d724b5c2b5ad672b9dbf08d8b11516a38c21697c23fbb0d2';
const IDENTITY_CONTRACT = '0x59b1ab4ad053de8f9c9a0660f6a995f37d40f03d'; // FTSO provider fees collector

async function fetchRewardClaimsPage(recipientAddress, page) {
  return new Promise((resolve, reject) => {
    const paddedAddr = '0x000000000000000000000000' + recipientAddress.slice(2).toLowerCase();
    // topic3 = recipient (who received the rewards)
    const url = `${ROUTESCAN_API}?module=logs&action=getLogs&address=${CONTRACTS.REWARD_MANAGER}&topic0=${REWARD_CLAIMED_TOPIC}&topic3=${paddedAddr}&fromBlock=0&toBlock=latest&page=${page}&offset=1000`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getRewardClaimHistory(address) {
  const allEvents = [];
  let page = 1;
  
  while (true) {
    const data = await fetchRewardClaimsPage(address, page);
    if (!data.result || data.result.length === 0) break;
    allEvents.push(...data.result);
    if (data.result.length < 1000) break;
    page++;
    if (page > 20) break;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const oneDay = now - 86400;
  const sevenDays = now - 86400 * 7;
  const thirtyDays = now - 86400 * 30;
  
  // Separate delegation (type 2) from staking (type 1)
  const delegation = {
    allTime: { count: 0, flr: 0n, epochs: new Set() },
    month: { count: 0, flr: 0n },
    week: { count: 0, flr: 0n },
    day: { count: 0, flr: 0n }
  };
  
  const staking = {
    allTime: { count: 0, flr: 0n, epochs: new Set() },
    month: { count: 0, flr: 0n },
    week: { count: 0, flr: 0n },
    day: { count: 0, flr: 0n }
  };
  
  allEvents.forEach(log => {
    const timestamp = parseInt(log.timeStamp, 16);
    const provider = '0x' + log.topics[1].slice(26).toLowerCase();
    const dataHex = log.data.slice(2);
    const epoch = parseInt(dataHex.slice(0, 64), 16);
    const claimType = parseInt(dataHex.slice(64, 128), 16);
    const amount = BigInt('0x' + dataHex.slice(128, 192));
    
    // Type 1 = Provider fees (from Identity contract), Type 2 = Delegation (from FTSO)
    const isProviderFees = claimType === 1 || provider === IDENTITY_CONTRACT;
    const target = isProviderFees ? staking : delegation;
    
    target.allTime.count++;
    target.allTime.flr += amount;
    target.allTime.epochs.add(epoch);
    
    if (timestamp >= thirtyDays) {
      target.month.count++;
      target.month.flr += amount;
    }
    if (timestamp >= sevenDays) {
      target.week.count++;
      target.week.flr += amount;
    }
    if (timestamp >= oneDay) {
      target.day.count++;
      target.day.flr += amount;
    }
  });
  
  return { delegation, staking };
}

// Validator Fees - WFLR transfers from Founder to DAO
// These are self-bond staking rewards + validator operation fees
async function fetchValidatorFeesPage(page) {
  return new Promise((resolve, reject) => {
    const paddedFrom = '0x000000000000000000000000' + FOUNDER_WALLET.slice(2).toLowerCase();
    const paddedTo = '0x000000000000000000000000' + CONTRACTS.DAO.slice(2).toLowerCase();
    const url = `${ROUTESCAN_API}?module=logs&action=getLogs&address=${CONTRACTS.WFLR}&topic0=${TRANSFER_EVENT_TOPIC}&topic1=${paddedFrom}&topic2=${paddedTo}&fromBlock=0&toBlock=latest&page=${page}&offset=1000`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function getValidatorFeesHistory() {
  const allEvents = [];
  let page = 1;
  
  while (true) {
    const data = await fetchValidatorFeesPage(page);
    if (!data.result || data.result.length === 0) break;
    allEvents.push(...data.result);
    if (data.result.length < 1000) break;
    page++;
    if (page > 20) break;
  }
  
  const now = Math.floor(Date.now() / 1000);
  const oneDay = now - 86400;
  const sevenDays = now - 86400 * 7;
  const thirtyDays = now - 86400 * 30;
  
  const stats = {
    allTime: { count: 0, wflr: 0n },
    month: { count: 0, wflr: 0n },
    week: { count: 0, wflr: 0n },
    day: { count: 0, wflr: 0n }
  };
  
  allEvents.forEach(log => {
    const timestamp = parseInt(log.timeStamp, 16);
    const amount = BigInt(log.data);
    
    stats.allTime.count++;
    stats.allTime.wflr += amount;
    
    if (timestamp >= thirtyDays) {
      stats.month.count++;
      stats.month.wflr += amount;
    }
    if (timestamp >= sevenDays) {
      stats.week.count++;
      stats.week.wflr += amount;
    }
    if (timestamp >= oneDay) {
      stats.day.count++;
      stats.day.wflr += amount;
    }
  });
  
  return stats;
}

// P-chain validator query
async function getValidators() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'platform.getCurrentValidators',
      params: {},
      id: 1
    });

    const url = new URL(P_CHAIN_RPC);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result?.validators || []);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// V3 amount calculation
function calculateV3Amounts(liquidity, tickLower, tickUpper, currentTick) {
  const tickToSqrtPrice = (tick) => Math.sqrt(Math.pow(1.0001, tick));
  
  const sqrtPriceLower = tickToSqrtPrice(tickLower);
  const sqrtPriceUpper = tickToSqrtPrice(tickUpper);
  const sqrtPriceCurrent = tickToSqrtPrice(currentTick);
  
  const L = Number(liquidity);
  
  let amount0 = 0, amount1 = 0;
  
  if (currentTick < tickLower) {
    // Position entirely in token0
    amount0 = L * (sqrtPriceUpper - sqrtPriceLower) / (sqrtPriceLower * sqrtPriceUpper);
  } else if (currentTick > tickUpper) {
    // Position entirely in token1
    amount1 = L * (sqrtPriceUpper - sqrtPriceLower);
  } else {
    // In range
    amount0 = L * (sqrtPriceUpper - sqrtPriceCurrent) / (sqrtPriceCurrent * sqrtPriceUpper);
    amount1 = L * (sqrtPriceCurrent - sqrtPriceLower);
  }
  
  return { amount0, amount1 };
}

// Parse V3 position data
function parseV3Position(result) {
  // positions() returns: nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, ...
  const data = result.slice(2); // remove 0x
  
  // Each slot is 64 hex chars (32 bytes)
  const tickLowerHex = data.slice(320, 384);
  const tickUpperHex = data.slice(384, 448);
  const liquidityHex = data.slice(448, 512);
  
  // Parse ticks as signed int256 (check high bit of full 256-bit value)
  let tickLower = BigInt('0x' + tickLowerHex);
  if (tickLower > BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
    tickLower = tickLower - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000');
  }
  
  let tickUpper = BigInt('0x' + tickUpperHex);
  if (tickUpper > BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
    tickUpper = tickUpper - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000');
  }
  
  const liquidity = BigInt('0x' + liquidityHex);
  
  return { tickLower: Number(tickLower), tickUpper: Number(tickUpper), liquidity };
}

// Parse slot0 for current tick
function parseSlot0(result) {
  const data = result.slice(2);
  // slot0 returns: sqrtPriceX96 (slot 0), tick (slot 1), ...
  const tickHex = data.slice(64, 128);
  let tick = BigInt('0x' + tickHex);
  if (tick > BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
    tick = tick - BigInt('0x10000000000000000000000000000000000000000000000000000000000000000');
  }
  return Number(tick);
}

// Main dashboard
async function main() {
  console.log('Fetching FlareBank protocol data...\n');
  
  // Parallel queries
  const [
    fbMainWflr,
    ibdpWflr,
    bankSupply,
    bankPrice,
    daoWflr,
    daoSflr,
    daoFxrp,
    daoAps,
    daoBank,
    daoEnosysLP,
    daoSparkLP,
    enosysReserves,
    enosysSupply,
    sparkReserves,
    sparkSupply,
    v3Position,
    v3Slot0,
    // CDP Earn pools
    cdpFxrpDeposit,
    cdpFxrpYield,
    cdpFxrpColl,
    cdpWflrDeposit,
    cdpWflrYield,
    cdpWflrColl,
    // Price pools
    priceFxrpWflr,
    priceSflrWflr,
    priceUsdtWflr,
    priceStxrpFxrp,
    // Founder holdings
    founderBank,
    founderEnosysLP,
    // FTSO
    ftsoVotePower,
    // APS Staking
    daoApsStaked
  ] = await Promise.all([
    getBalance(CONTRACTS.WFLR, CONTRACTS.BANK),
    getBalance(CONTRACTS.WFLR, CONTRACTS.IBDP),
    getTotalSupply(CONTRACTS.BANK),
    getBuyPrice(),
    getBalance(CONTRACTS.WFLR, CONTRACTS.DAO),
    getBalance(CONTRACTS.sFLR, CONTRACTS.DAO),
    getBalance(CONTRACTS.FXRP, CONTRACTS.DAO),
    getBalance(CONTRACTS.APS, CONTRACTS.DAO),
    getBalance(CONTRACTS.BANK, CONTRACTS.DAO),
    getBalance(CONTRACTS.ENOSYS_V2_LP, CONTRACTS.DAO),
    getBalance(CONTRACTS.SPARK_V2_LP, CONTRACTS.DAO),
    getReserves(CONTRACTS.ENOSYS_V2_LP),
    getTotalSupply(CONTRACTS.ENOSYS_V2_LP),
    getReserves(CONTRACTS.SPARK_V2_LP),
    getTotalSupply(CONTRACTS.SPARK_V2_LP),
    getV3Position(V3_POSITION_ID),
    getV3Slot0(),
    // CDP Earn pools
    getCDPDeposit(CONTRACTS.CDP_EARN_FXRP, CONTRACTS.DAO),
    getCDPYieldGain(CONTRACTS.CDP_EARN_FXRP, CONTRACTS.DAO),
    getCDPCollGain(CONTRACTS.CDP_EARN_FXRP, CONTRACTS.DAO),
    getCDPDeposit(CONTRACTS.CDP_EARN_WFLR, CONTRACTS.DAO),
    getCDPYieldGain(CONTRACTS.CDP_EARN_WFLR, CONTRACTS.DAO),
    getCDPCollGain(CONTRACTS.CDP_EARN_WFLR, CONTRACTS.DAO),
    // Price pools
    getPricePoolSlot0(CONTRACTS.PRICE_POOL_FXRP_WFLR),
    getPricePoolSlot0(CONTRACTS.PRICE_POOL_SFLR_WFLR),
    getPricePoolSlot0(CONTRACTS.PRICE_POOL_USDT_WFLR),
    getPricePoolSlot0(CONTRACTS.V3_POOL_STXRP_FXRP),
    // Founder holdings
    getBalance(CONTRACTS.BANK, FOUNDER_WALLET),
    getBalance(CONTRACTS.ENOSYS_V2_LP, FOUNDER_WALLET),
    // FTSO
    getFTSOVotePower(),
    // APS Staking
    getBalance(CONTRACTS.APS_STAKING, CONTRACTS.DAO)  // staked APS balance
  ]);
  
  // Get rFLR vesting data (separate call for structured response)
  const rflrData = await getRflrBalances(CONTRACTS.DAO);
  
  // Get mint/burn/transfer history from indexer
  const mintStats = await getMintHistory();
  const burnStats = await getBurnHistory();
  const transferData = await getTransferHistory();
  const transferStats = transferData.transfers;
  const swapStats = transferData.swaps;
  
  // Get FlareDrop claim history for all addresses
  // Track by "claimed by" (who initiated) and "received by" (where it went)
  const [
    flareDropDAO,       // DAO claims and receives
    flareDropIBDP,      // IBDP claims (but sends to FB Main)
    flareDropFBMainClaimed,  // FB Main claims itself
    flareDropFBMainReceived  // FB Main receives (from self + IBDP)
  ] = await Promise.all([
    getFlareDropHistory(CONTRACTS.DAO, false),           // claimed by DAO
    getFlareDropHistory(CONTRACTS.IBDP, false),          // claimed by IBDP
    getFlareDropHistory(CONTRACTS.BANK, false),          // claimed by FB Main
    getFlareDropHistory(CONTRACTS.BANK, true)            // received by FB Main
  ]);
  
  // Get reward claims (FTSOv2 RewardManager) - separated into delegation and provider fees
  const [rewardsDAO, rewardsIBDP, rewardsFBMain] = await Promise.all([
    getRewardClaimHistory(CONTRACTS.DAO),
    getRewardClaimHistory(CONTRACTS.IBDP),
    getRewardClaimHistory(CONTRACTS.BANK)
  ]);
  
  // Get validator fees (WFLR transfers from founder to DAO)
  const validatorFees = await getValidatorFeesHistory();
  
  // Get validator data separately (P-chain)
  const allValidators = await getValidators();
  const fbValidators = allValidators.filter(v => VALIDATOR_NODES.includes(v.nodeID));
  
  // Parse price pool data (extract sqrtPriceX96 from slot0)
  const extractSqrtPrice = (slot0) => '0x' + slot0.slice(2, 66);
  
  // FXRP/WFLR: token0=WFLR(18), token1=FXRP(6) → price = FXRP/WFLR
  const fxrpWflrPrice = calcV3Price(extractSqrtPrice(priceFxrpWflr), 18, 6);
  const wflrPerFxrp = 1 / fxrpWflrPrice;
  
  // sFLR/WFLR: token0=sFLR(18), token1=WFLR(18) → price = WFLR/sFLR  
  const wflrPerSflr = calcV3Price(extractSqrtPrice(priceSflrWflr), 18, 18);
  
  // USDT/WFLR: token0=WFLR(18), token1=USDT(6) → price = USDT/WFLR
  const usdtWflrPrice = calcV3Price(extractSqrtPrice(priceUsdtWflr), 18, 6);
  const wflrPerUsd = 1 / usdtWflrPrice; // CDP = $1
  
  // stXRP/FXRP: token0=stXRP(6), token1=FXRP(6) → price = FXRP/stXRP
  const fxrpPerStxrp = calcV3Price(extractSqrtPrice(priceStxrpFxrp), 6, 6);
  const wflrPerStxrp = wflrPerFxrp * fxrpPerStxrp;
  
  // Parse values
  const tvl = toDecimal(fbMainWflr);
  const ibdp = toDecimal(ibdpWflr);
  const supply = toDecimal(bankSupply);
  const price = toDecimal(bankPrice);
  const mintPrice = price * 1.10;
  const burnPrice = price * 0.90;
  // Note: backing calculated after DAO totals are computed
  
  // DAO tokens
  const dao = {
    wflr: toDecimal(daoWflr),
    sflr: toDecimal(daoSflr),
    fxrp: toDecimal(daoFxrp, 6),
    aps: toDecimal(daoAps),
    apsStaked: toDecimal(daoApsStaked),
    bank: toDecimal(daoBank)
  };
  
  // Enosys V2 LP
  const enosysLPBal = toDecimal(daoEnosysLP);
  const enosysTotalSupply = toDecimal(enosysSupply);
  const enosysRes0 = toDecimal('0x' + enosysReserves.slice(2, 66)); // BANK
  const enosysRes1 = toDecimal('0x' + enosysReserves.slice(66, 130)); // WFLR
  const enosysShare = enosysLPBal / enosysTotalSupply;
  const enosysBANK = enosysRes0 * enosysShare;
  const enosysWFLR = enosysRes1 * enosysShare;
  
  // SparkDex V2 LP
  const sparkLPBal = toDecimal(daoSparkLP);
  const sparkTotalSupply = toDecimal(sparkSupply);
  const sparkRes0 = toDecimal('0x' + sparkReserves.slice(2, 66)); // BANK
  const sparkRes1 = toDecimal('0x' + sparkReserves.slice(66, 130)); // WFLR
  const sparkShare = sparkLPBal / sparkTotalSupply;
  const sparkBANK = sparkRes0 * sparkShare;
  const sparkWFLR = sparkRes1 * sparkShare;
  
  // V3 Position
  const v3 = parseV3Position(v3Position);
  const currentTick = parseSlot0(v3Slot0);
  const v3Amounts = calculateV3Amounts(v3.liquidity, v3.tickLower, v3.tickUpper, currentTick);
  const v3stXRP = v3Amounts.amount0 / 1e6;
  const v3FXRP = v3Amounts.amount1 / 1e6;
  const v3InRange = currentTick >= v3.tickLower && currentTick <= v3.tickUpper;
  
  // CDP Earn pools (CDP has 18 decimals, collateral varies)
  const cdpEarn = {
    fxrp: {
      deposit: toDecimal(cdpFxrpDeposit),      // CDP deposited
      yieldGain: toDecimal(cdpFxrpYield),      // CDP yield pending
      collGain: toDecimal(cdpFxrpColl, 6)      // FXRP collateral pending (6 decimals)
    },
    wflr: {
      deposit: toDecimal(cdpWflrDeposit),      // CDP deposited
      yieldGain: toDecimal(cdpWflrYield),      // CDP yield pending
      collGain: toDecimal(cdpWflrColl)         // WFLR collateral pending (18 decimals)
    }
  };
  
  // Founder holdings
  const founderBankDirect = toDecimal(founderBank);
  const founderLPBal = toDecimal(founderEnosysLP);
  const founderLPShare = founderLPBal / enosysTotalSupply;
  const founderBankInLP = enosysRes0 * founderLPShare;
  const founderTotalBank = founderBankDirect + founderBankInLP;
  
  // Totals (raw amounts)
  const totalBANK = dao.bank + enosysBANK + sparkBANK;
  const totalSFLR = dao.sflr;
  const totalWFLRDirect = dao.wflr + enosysWFLR + sparkWFLR + cdpEarn.wflr.collGain;
  const totalCDP = cdpEarn.fxrp.deposit + cdpEarn.fxrp.yieldGain + cdpEarn.wflr.deposit + cdpEarn.wflr.yieldGain;
  const totalFXRP = dao.fxrp + v3FXRP + cdpEarn.fxrp.collGain;
  const totalStXRP = v3stXRP;
  
  // DAO value in WFLR (for backing calculation - uses bonding curve BANK price)
  const bankValueWFLR = totalBANK * price;
  const sflrValueWFLR = totalSFLR * wflrPerSflr;
  const daoTotalValue = bankValueWFLR + sflrValueWFLR + totalWFLRDirect;
  
  // Circulating supply = Total - DAO BANK - Founder BANK (both considered unsellable)
  const lockedBANK = totalBANK + founderTotalBank;
  const circulatingSupply = supply - lockedBANK;
  
  // LP WFLR (secondary liquidity layer)
  // Total LP reserves minus DAO's share (already counted in daoTotalValue)
  const totalLPWflr = enosysRes1 + sparkRes1;
  const daoLPWflr = enosysWFLR + sparkWFLR;
  const otherLPWflr = totalLPWflr - daoLPWflr;
  
  // Backing = (FB Main TVL + DAO Total Value + Other LP WFLR) / Circulating Supply
  // Excludes IBDP (yield queue not yet deposited)
  const totalTVL = tvl + daoTotalValue + otherLPWflr;
  const backing = totalTVL / circulatingSupply;
  
  // DAPP TVL = ALL protocol assets valued in WFLR (includes IBDP)
  const fxrpValueWFLR = totalFXRP * wflrPerFxrp;
  const stxrpValueWFLR = totalStXRP * wflrPerStxrp;
  const cdpValueWFLR = totalCDP * wflrPerUsd;
  const dappTVL = tvl + ibdp + daoTotalValue + fxrpValueWFLR + stxrpValueWFLR + cdpValueWFLR;
  
  // Infrastructure data
  const ftsoVP = toDecimal(ftsoVotePower);
  const now = Date.now() / 1000;
  
  // Parse validator data
  const validatorData = fbValidators.map(v => {
    const stake = parseInt(v.stakeAmount || '0') / 1e9;
    const delegated = parseInt(v.delegatorWeight || '0') / 1e9;
    const endTime = parseInt(v.endTime || '0');
    const daysRemaining = Math.floor((endTime - now) / 86400);
    const hoursRemaining = Math.floor(((endTime - now) % 86400) / 3600);
    return {
      nodeID: v.nodeID,
      stake,
      delegated,
      uptime: v.uptime,
      fee: v.delegationFee,
      delegators: v.delegatorCount,
      expires: new Date(endTime * 1000).toISOString().split('T')[0],
      daysRemaining,
      hoursRemaining
    };
  });
  
  const totalValidatorStake = validatorData.reduce((a, v) => a + v.stake, 0);
  const totalValidatorDelegated = validatorData.reduce((a, v) => a + v.delegated, 0);
  
  // Estimate provider earnings per epoch
  // FTSO: delegation rewards from vote power
  const ftsoRewardsPerEpoch = (ftsoVP * REWARD_PARAMS.delegationAPY / REWARD_PARAMS.epochsPerYear);
  const ftsoProviderEarnings = ftsoRewardsPerEpoch * REWARD_PARAMS.providerFee;
  
  // Validators: staking rewards from delegated amount
  const stakingRewardsPerEpoch = (totalValidatorDelegated * REWARD_PARAMS.stakingAPY / REWARD_PARAMS.epochsPerYear);
  const validatorProviderEarnings = stakingRewardsPerEpoch * REWARD_PARAMS.providerFee;
  
  // Total provider earnings
  const totalProviderEarningsPerEpoch = ftsoProviderEarnings + validatorProviderEarnings;
  const totalProviderEarningsPerMonth = totalProviderEarningsPerEpoch * (REWARD_PARAMS.epochsPerYear / 12);
  const totalProviderEarningsPerYear = totalProviderEarningsPerEpoch * REWARD_PARAMS.epochsPerYear;
  
  // Markdown table helper (renders nicely in Telegram)
  const table = (headers, rows) => {
    const header = '| ' + headers.join(' | ') + ' |';
    const divider = '|' + headers.map(() => '---').join('|') + '|';
    const body = rows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
    return [header, divider, body].join('\n');
  };
  
  // Output
  console.log('');
  console.log('📊 FLAREBANK PROTOCOL DASHBOARD');
  console.log('================================');
  console.log('');
  
  // TVL Table
  console.log('📈 PROTOCOL TVL');
  console.log(table(
    ['Source', 'WFLR'],
    [
      ['FB Main', fmt(tvl)],
      ['DAO Treasury', fmt(daoTotalValue)],
      ['Other LP WFLR', fmt(otherLPWflr)],
      ['TOTAL TVL', fmt(totalTVL)],
      ['IBDP (Queue)', fmt(ibdp) + ' *']
    ]
  ));
  console.log('* IBDP not in backing');
  console.log('');
  
  // BANK Token Table
  console.log('🏦 BANK TOKEN');
  console.log(table(
    ['Metric', 'Value'],
    [
      ['Total Supply', fmt(supply) + ' BANK'],
      ['- DAO Holdings', fmt(totalBANK) + ' BANK'],
      ['- Founder Holdings', fmt(founderTotalBank) + ' BANK'],
      ['= Circulating', fmt(circulatingSupply) + ' BANK'],
      ['Current Price', price.toFixed(4) + ' WFLR'],
      ['Mint (+10%)', mintPrice.toFixed(4) + ' WFLR'],
      ['Burn (-10%)', burnPrice.toFixed(4) + ' WFLR'],
      ['Backing/BANK', backing.toFixed(4) + ' WFLR']
    ]
  ));
  console.log('');
  
  // DAO Treasury Table
  console.log('🏛️ DAO TREASURY');
  console.log(table(
    ['Asset', 'Amount', 'Value (WFLR)'],
    [
      ['WFLR', fmt(dao.wflr), fmt(dao.wflr)],
      ['sFLR', fmt(dao.sflr), fmt(sflrValueWFLR)],
      ['BANK', fmt(totalBANK), fmt(bankValueWFLR)],
      ['FXRP', fmt(totalFXRP), fmt(fxrpValueWFLR)],
      ['stXRP', fmt(totalStXRP), fmt(stxrpValueWFLR)],
      ['CDP', fmt(totalCDP), fmt(cdpValueWFLR)],
      ['TOTAL', '-', fmt(daoTotalValue)]
    ]
  ));
  console.log('');
  
  // LP Positions Table
  console.log('💧 LP POSITIONS');
  console.log(table(
    ['Pool', 'Share', 'BANK', 'WFLR'],
    [
      ['Enosys V2', (enosysShare * 100).toFixed(1) + '%', fmt(enosysBANK), fmt(enosysWFLR)],
      ['SparkDex V2', (sparkShare * 100).toFixed(1) + '%', fmt(sparkBANK), fmt(sparkWFLR)]
    ]
  ));
  console.log('');
  console.log(`V3 #${V3_POSITION_ID}: ${fmt(v3stXRP)} stXRP + ${fmt(v3FXRP)} FXRP [${v3InRange ? 'IN RANGE ✓' : 'OUT OF RANGE'}]`);
  console.log('');
  
  // CDP Earn Table
  console.log('🌾 CDP EARN POOLS');
  console.log(table(
    ['Pool', 'Deposited', 'Yield', 'Collateral'],
    [
      ['FXRP', fmt(cdpEarn.fxrp.deposit) + ' CDP', fmt(cdpEarn.fxrp.yieldGain) + ' CDP', fmt(cdpEarn.fxrp.collGain) + ' FXRP'],
      ['WFLR', fmt(cdpEarn.wflr.deposit) + ' CDP', fmt(cdpEarn.wflr.yieldGain) + ' CDP', fmt(cdpEarn.wflr.collGain) + ' WFLR']
    ]
  ));
  console.log('');
  
  // Pending Rewards Summary
  const totalPendingCDP = cdpEarn.fxrp.yieldGain + cdpEarn.wflr.yieldGain;
  const pendingCollWFLR = cdpEarn.wflr.collGain;
  const pendingCollFXRP = cdpEarn.fxrp.collGain;
  
  console.log('🎁 PENDING REWARDS');
  console.log(table(
    ['Source', 'Asset', 'Amount', 'Value (WFLR)'],
    [
      ['CDP Yield', 'CDP', fmt(totalPendingCDP), fmt(totalPendingCDP * wflrPerUsd)],
      ['CDP Coll', 'WFLR', fmt(pendingCollWFLR), fmt(pendingCollWFLR)],
      ['CDP Coll', 'FXRP', fmt(pendingCollFXRP), fmt(pendingCollFXRP * wflrPerFxrp)]
    ]
  ));
  console.log('');
  
  // APS Staking
  console.log('🥩 APS STAKING');
  console.log(table(
    ['Metric', 'Value'],
    [
      ['DAO Staked', fmt(dao.apsStaked, 4) + ' APS'],
      ['APS Held', fmt(dao.aps, 4) + ' APS'],
      ['Total APS', fmt(dao.aps + dao.apsStaked, 4) + ' APS']
    ]
  ));
  console.log('* Staking rewards claimed via gov.enosys.global');
  console.log('');
  
  // rFLR Vesting breakdown
  console.log('🔒 rFLR VESTING');
  console.log(table(
    ['Status', 'rFLR', 'Value (WFLR)'],
    [
      ['Vested', fmt(rflrData.vested), fmt(rflrData.vested)],
      ['Unvested', fmt(rflrData.unvested), fmt(rflrData.unvested)],
      ['TOTAL', fmt(rflrData.total), fmt(rflrData.total)]
    ]
  ));
  console.log('* Vested rFLR can be withdrawn as WFLR');
  console.log('');
  
  // FlareDrop Claims History
  const fmtFlr = (n) => (Number(n) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 0 });
  
  // Total claimed by protocol (DAO keeps its own, IBDP+FBMain claims go to FB Main backing)
  const totalClaimedAllTime = flareDropDAO.allTime.flr + flareDropIBDP.allTime.flr + flareDropFBMainClaimed.allTime.flr;
  const totalClaimedMonth = flareDropDAO.month.flr + flareDropIBDP.month.flr + flareDropFBMainClaimed.month.flr;
  const totalClaimedWeek = flareDropDAO.week.flr + flareDropIBDP.week.flr + flareDropFBMainClaimed.week.flr;
  const totalClaimedDay = flareDropDAO.day.flr + flareDropIBDP.day.flr + flareDropFBMainClaimed.day.flr;
  
  console.log('🪂 FLAREDROP CLAIMS');
  console.log(table(
    ['Claimer', 'All Time', '30 Days', '7 Days', '24 Hours'],
    [
      ['DAO', fmtFlr(flareDropDAO.allTime.flr) + ' FLR', fmtFlr(flareDropDAO.month.flr) + ' FLR', fmtFlr(flareDropDAO.week.flr) + ' FLR', fmtFlr(flareDropDAO.day.flr) + ' FLR'],
      ['IBDP → FB Main', fmtFlr(flareDropIBDP.allTime.flr) + ' FLR', fmtFlr(flareDropIBDP.month.flr) + ' FLR', fmtFlr(flareDropIBDP.week.flr) + ' FLR', fmtFlr(flareDropIBDP.day.flr) + ' FLR'],
      ['FB Main', fmtFlr(flareDropFBMainClaimed.allTime.flr) + ' FLR', fmtFlr(flareDropFBMainClaimed.month.flr) + ' FLR', fmtFlr(flareDropFBMainClaimed.week.flr) + ' FLR', fmtFlr(flareDropFBMainClaimed.day.flr) + ' FLR'],
      ['TOTAL', fmtFlr(totalClaimedAllTime) + ' FLR', fmtFlr(totalClaimedMonth) + ' FLR', fmtFlr(totalClaimedWeek) + ' FLR', fmtFlr(totalClaimedDay) + ' FLR']
    ]
  ));
  console.log(`* FB Main backing: ${fmtFlr(flareDropFBMainReceived.allTime.flr)} FLR from FlareDrop`);
  console.log('');
  
  // FTSO Delegation Rewards (Type 2)
  const delDAO = rewardsDAO.delegation;
  const delIBDP = rewardsIBDP.delegation;
  const delFBMain = rewardsFBMain.delegation;
  const totalDelAllTime = delDAO.allTime.flr + delIBDP.allTime.flr + delFBMain.allTime.flr;
  const totalDelMonth = delDAO.month.flr + delIBDP.month.flr + delFBMain.month.flr;
  const totalDelWeek = delDAO.week.flr + delIBDP.week.flr + delFBMain.week.flr;
  const totalDelDay = delDAO.day.flr + delIBDP.day.flr + delFBMain.day.flr;
  
  console.log('📊 FTSO DELEGATION REWARDS');
  console.log(table(
    ['Recipient', 'All Time', '30 Days', '7 Days', '24 Hours'],
    [
      ['DAO', fmtFlr(delDAO.allTime.flr) + ' FLR', fmtFlr(delDAO.month.flr) + ' FLR', fmtFlr(delDAO.week.flr) + ' FLR', fmtFlr(delDAO.day.flr) + ' FLR'],
      ['IBDP', fmtFlr(delIBDP.allTime.flr) + ' FLR', fmtFlr(delIBDP.month.flr) + ' FLR', fmtFlr(delIBDP.week.flr) + ' FLR', fmtFlr(delIBDP.day.flr) + ' FLR'],
      ['FB Main', fmtFlr(delFBMain.allTime.flr) + ' FLR', fmtFlr(delFBMain.month.flr) + ' FLR', fmtFlr(delFBMain.week.flr) + ' FLR', fmtFlr(delFBMain.day.flr) + ' FLR'],
      ['TOTAL', fmtFlr(totalDelAllTime) + ' FLR', fmtFlr(totalDelMonth) + ' FLR', fmtFlr(totalDelWeek) + ' FLR', fmtFlr(totalDelDay) + ' FLR']
    ]
  ));
  console.log('');
  
  // FTSO Provider Fees (Type 1 - from Identity contract)
  const stakDAO = rewardsDAO.staking;
  const stakIBDP = rewardsIBDP.staking;
  const stakFBMain = rewardsFBMain.staking;
  const totalStakAllTime = stakDAO.allTime.flr + stakIBDP.allTime.flr + stakFBMain.allTime.flr;
  const totalStakMonth = stakDAO.month.flr + stakIBDP.month.flr + stakFBMain.month.flr;
  const totalStakWeek = stakDAO.week.flr + stakIBDP.week.flr + stakFBMain.week.flr;
  const totalStakDay = stakDAO.day.flr + stakIBDP.day.flr + stakFBMain.day.flr;
  
  console.log('🏛️ FTSO PROVIDER FEES');
  console.log(table(
    ['Recipient', 'All Time', '30 Days', '7 Days', '24 Hours'],
    [
      ['DAO', fmtFlr(stakDAO.allTime.flr) + ' FLR', fmtFlr(stakDAO.month.flr) + ' FLR', fmtFlr(stakDAO.week.flr) + ' FLR', fmtFlr(stakDAO.day.flr) + ' FLR'],
      ['IBDP', fmtFlr(stakIBDP.allTime.flr) + ' FLR', fmtFlr(stakIBDP.month.flr) + ' FLR', fmtFlr(stakIBDP.week.flr) + ' FLR', fmtFlr(stakIBDP.day.flr) + ' FLR'],
      ['FB Main', fmtFlr(stakFBMain.allTime.flr) + ' FLR', fmtFlr(stakFBMain.month.flr) + ' FLR', fmtFlr(stakFBMain.week.flr) + ' FLR', fmtFlr(stakFBMain.day.flr) + ' FLR'],
      ['TOTAL', fmtFlr(totalStakAllTime) + ' FLR', fmtFlr(totalStakMonth) + ' FLR', fmtFlr(totalStakWeek) + ' FLR', fmtFlr(totalStakDay) + ' FLR']
    ]
  ));
  console.log('');
  
  // Validator Fees Claimed (WFLR transfers to DAO)
  console.log('🔐 VALIDATOR FEES CLAIMED');
  console.log(table(
    ['Recipient', 'All Time', '30 Days', '7 Days', '24 Hours'],
    [
      ['DAO', fmtFlr(validatorFees.allTime.wflr) + ' FLR', fmtFlr(validatorFees.month.wflr) + ' FLR', fmtFlr(validatorFees.week.wflr) + ' FLR', fmtFlr(validatorFees.day.wflr) + ' FLR']
    ]
  ));
  console.log(`* Self-bond staking rewards + validator operation fees (${validatorFees.allTime.count} claims)`);
  console.log('');
  
  // Dapp TVL Table
  console.log('🌐 DAPP TOTAL TVL');
  console.log(table(
    ['Source', 'WFLR'],
    [
      ['FB Main', fmt(tvl)],
      ['IBDP', fmt(ibdp)],
      ['DAO Assets', fmt(daoTotalValue)],
      ['DAPP TVL', fmt(dappTVL)]
    ]
  ));
  console.log('');
  
  // Infrastructure - FTSO
  console.log('🌐 FTSO');
  console.log(table(
    ['Metric', 'Value'],
    [
      ['Address', FTSO_ADDRESS.slice(0,10) + '...' + FTSO_ADDRESS.slice(-8)],
      ['Total Delegated', fmt(ftsoVP) + ' WFLR']
    ]
  ));
  console.log('');
  
  // Infrastructure - Validators
  console.log('🔐 VALIDATORS');
  console.log(table(
    ['Node', 'Stake', 'Delegated', 'Uptime', 'Fee', 'Expires'],
    validatorData.map(v => [
      v.nodeID.slice(7, 15) + '...',
      fmt(v.stake, 0) + ' FLR',
      fmt(v.delegated, 0) + ' FLR',
      v.uptime + '%',
      v.fee + '%',
      v.expires + ` (${v.daysRemaining}d)`
    ])
  ));
  console.log(table(
    ['Total Stake', 'Total Delegated', 'Combined'],
    [[fmt(totalValidatorStake, 0) + ' FLR', fmt(totalValidatorDelegated, 0) + ' FLR', fmt(totalValidatorStake + totalValidatorDelegated, 0) + ' FLR']]
  ));
  console.log('');
  
  // Provider Earnings Estimate
  console.log('💰 PROVIDER EARNINGS (Estimated)');
  console.log(table(
    ['Source', 'Vote Power', 'APY', 'Per Epoch', 'Per Month'],
    [
      ['FTSO', fmt(ftsoVP, 0) + ' FLR', (REWARD_PARAMS.delegationAPY * 100).toFixed(2) + '%', fmt(ftsoProviderEarnings, 0) + ' FLR', fmt(ftsoProviderEarnings * REWARD_PARAMS.epochsPerYear / 12, 0) + ' FLR'],
      ['Validators', fmt(totalValidatorDelegated, 0) + ' FLR', (REWARD_PARAMS.stakingAPY * 100).toFixed(2) + '%', fmt(validatorProviderEarnings, 0) + ' FLR', fmt(validatorProviderEarnings * REWARD_PARAMS.epochsPerYear / 12, 0) + ' FLR'],
      ['TOTAL', '-', '-', fmt(totalProviderEarningsPerEpoch, 0) + ' FLR', fmt(totalProviderEarningsPerMonth, 0) + ' FLR']
    ]
  ));
  console.log(`Fee: ${(REWARD_PARAMS.providerFee * 100).toFixed(1)}% | Est. Annual: ${fmt(totalProviderEarningsPerYear, 0)} FLR`);
  console.log('');
  
  // Prices Table
  console.log('💱 PRICES (Enosys V3)');
  console.log(table(
    ['Asset', 'WFLR'],
    [
      ['FXRP', wflrPerFxrp.toFixed(2)],
      ['stXRP', wflrPerStxrp.toFixed(2)],
      ['sFLR', wflrPerSflr.toFixed(4)],
      ['CDP ($1)', wflrPerUsd.toFixed(2)],
      ['FLR/USD', '$' + (1/wflrPerUsd).toFixed(4)]
    ]
  ));
  console.log('');
  
  // Mint Statistics
  const fmtBigInt = (n) => (Number(n) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 2 });
  
  console.log('🏭 MINT STATISTICS');
  console.log(table(
    ['Period', 'Mints', 'WFLR Deposited', 'BANK Minted', 'Fees (10%)'],
    [
      ['All Time', mintStats.allTime.count.toString(), fmtBigInt(mintStats.allTime.wflr), fmtBigInt(mintStats.allTime.bank), fmtBigInt(mintStats.allTime.wflr / 10n)],
      ['30 Days', mintStats.month.count.toString(), fmtBigInt(mintStats.month.wflr), fmtBigInt(mintStats.month.bank), fmtBigInt(mintStats.month.wflr / 10n)],
      ['7 Days', mintStats.week.count.toString(), fmtBigInt(mintStats.week.wflr), fmtBigInt(mintStats.week.bank), fmtBigInt(mintStats.week.wflr / 10n)],
      ['24 Hours', mintStats.day.count.toString(), fmtBigInt(mintStats.day.wflr), fmtBigInt(mintStats.day.bank), fmtBigInt(mintStats.day.wflr / 10n)]
    ]
  ));
  console.log('');
  
  // Mint Fee Distribution
  console.log('💸 MINT FEE DISTRIBUTION (10% of deposits)');
  console.log(table(
    ['Period', 'Total Fees', 'Holders (80%)', 'Team (15%)', 'DAO (5%)'],
    [
      ['All Time', fmtBigInt(mintStats.allTime.wflr / 10n), fmtBigInt(mintStats.allTime.wflr * 8n / 100n), fmtBigInt(mintStats.allTime.wflr * 15n / 1000n), fmtBigInt(mintStats.allTime.wflr / 200n)],
      ['30 Days', fmtBigInt(mintStats.month.wflr / 10n), fmtBigInt(mintStats.month.wflr * 8n / 100n), fmtBigInt(mintStats.month.wflr * 15n / 1000n), fmtBigInt(mintStats.month.wflr / 200n)],
      ['7 Days', fmtBigInt(mintStats.week.wflr / 10n), fmtBigInt(mintStats.week.wflr * 8n / 100n), fmtBigInt(mintStats.week.wflr * 15n / 1000n), fmtBigInt(mintStats.week.wflr / 200n)],
      ['24 Hours', fmtBigInt(mintStats.day.wflr / 10n), fmtBigInt(mintStats.day.wflr * 8n / 100n), fmtBigInt(mintStats.day.wflr * 15n / 1000n), fmtBigInt(mintStats.day.wflr / 200n)]
    ]
  ));
  console.log('');
  
  // Burn Statistics
  console.log('🔥 BURN STATISTICS');
  console.log(table(
    ['Period', 'Burns', 'BANK Burned', 'WFLR Withdrawn', 'Fees (10%)'],
    [
      ['All Time', burnStats.allTime.count.toString(), fmtBigInt(burnStats.allTime.bank), fmtBigInt(burnStats.allTime.wflr), fmtBigInt(burnStats.allTime.wflr / 10n)],
      ['30 Days', burnStats.month.count.toString(), fmtBigInt(burnStats.month.bank), fmtBigInt(burnStats.month.wflr), fmtBigInt(burnStats.month.wflr / 10n)],
      ['7 Days', burnStats.week.count.toString(), fmtBigInt(burnStats.week.bank), fmtBigInt(burnStats.week.wflr), fmtBigInt(burnStats.week.wflr / 10n)],
      ['24 Hours', burnStats.day.count.toString(), fmtBigInt(burnStats.day.bank), fmtBigInt(burnStats.day.wflr), fmtBigInt(burnStats.day.wflr / 10n)]
    ]
  ));
  console.log('');
  
  // Burn Fee Distribution
  console.log('💸 BURN FEE DISTRIBUTION (10% of withdrawals)');
  console.log(table(
    ['Period', 'Total Fees', 'Holders (80%)', 'Team (15%)', 'DAO (5%)'],
    [
      ['All Time', fmtBigInt(burnStats.allTime.wflr / 10n), fmtBigInt(burnStats.allTime.wflr * 8n / 100n), fmtBigInt(burnStats.allTime.wflr * 15n / 1000n), fmtBigInt(burnStats.allTime.wflr / 200n)],
      ['30 Days', fmtBigInt(burnStats.month.wflr / 10n), fmtBigInt(burnStats.month.wflr * 8n / 100n), fmtBigInt(burnStats.month.wflr * 15n / 1000n), fmtBigInt(burnStats.month.wflr / 200n)],
      ['7 Days', fmtBigInt(burnStats.week.wflr / 10n), fmtBigInt(burnStats.week.wflr * 8n / 100n), fmtBigInt(burnStats.week.wflr * 15n / 1000n), fmtBigInt(burnStats.week.wflr / 200n)],
      ['24 Hours', fmtBigInt(burnStats.day.wflr / 10n), fmtBigInt(burnStats.day.wflr * 8n / 100n), fmtBigInt(burnStats.day.wflr * 15n / 1000n), fmtBigInt(burnStats.day.wflr / 200n)]
    ]
  ));
  console.log('');
  
  // Transfer Statistics
  // For transfers: received = 98% of sent (1% burn + 1% fee)
  // So: sent = received / 0.98, burned = sent * 1%, fee = sent * 1%
  const calcTransferStats = (s) => {
    const received = s.bank;
    const sent = received * 100n / 98n;
    const burned = sent / 100n;
    const fee = sent / 100n;
    return { count: s.count, received, sent, burned, fee };
  };
  
  const txAllTime = calcTransferStats(transferStats.allTime);
  const txMonth = calcTransferStats(transferStats.month);
  const txWeek = calcTransferStats(transferStats.week);
  const txDay = calcTransferStats(transferStats.day);
  
  console.log('📤 TRANSFER STATISTICS (1% burn + 1% fee)');
  console.log(table(
    ['Period', 'Transfers', 'BANK Sent', 'BANK Burned', 'Fee (BANK)'],
    [
      ['All Time', txAllTime.count.toString(), fmtBigInt(txAllTime.sent), fmtBigInt(txAllTime.burned), fmtBigInt(txAllTime.fee)],
      ['30 Days', txMonth.count.toString(), fmtBigInt(txMonth.sent), fmtBigInt(txMonth.burned), fmtBigInt(txMonth.fee)],
      ['7 Days', txWeek.count.toString(), fmtBigInt(txWeek.sent), fmtBigInt(txWeek.burned), fmtBigInt(txWeek.fee)],
      ['24 Hours', txDay.count.toString(), fmtBigInt(txDay.sent), fmtBigInt(txDay.burned), fmtBigInt(txDay.fee)]
    ]
  ));
  console.log('');
  
  // Transfer Fee Distribution
  console.log('💸 TRANSFER FEE DISTRIBUTION (1% as WFLR)');
  console.log(table(
    ['Period', 'Total Fee', 'Holders (80%)', 'Team (15%)', 'DAO (5%)'],
    [
      ['All Time', fmtBigInt(txAllTime.fee), fmtBigInt(txAllTime.fee * 80n / 100n), fmtBigInt(txAllTime.fee * 15n / 100n), fmtBigInt(txAllTime.fee * 5n / 100n)],
      ['30 Days', fmtBigInt(txMonth.fee), fmtBigInt(txMonth.fee * 80n / 100n), fmtBigInt(txMonth.fee * 15n / 100n), fmtBigInt(txMonth.fee * 5n / 100n)],
      ['7 Days', fmtBigInt(txWeek.fee), fmtBigInt(txWeek.fee * 80n / 100n), fmtBigInt(txWeek.fee * 15n / 100n), fmtBigInt(txWeek.fee * 5n / 100n)],
      ['24 Hours', fmtBigInt(txDay.fee), fmtBigInt(txDay.fee * 80n / 100n), fmtBigInt(txDay.fee * 15n / 100n), fmtBigInt(txDay.fee * 5n / 100n)]
    ]
  ));
  console.log('');
  
  // LP Swap Statistics
  console.log('🔄 LP SWAP STATISTICS (V2 Pools)');
  const swapBuysAll = swapStats.buys.allTime;
  const swapSellsAll = swapStats.sells.allTime;
  const swapBuysMonth = swapStats.buys.month;
  const swapSellsMonth = swapStats.sells.month;
  const swapBuysWeek = swapStats.buys.week;
  const swapSellsWeek = swapStats.sells.week;
  const swapBuysDay = swapStats.buys.day;
  const swapSellsDay = swapStats.sells.day;
  
  console.log(table(
    ['Period', 'Buys', 'BANK Bought', 'Sells', 'BANK Sold'],
    [
      ['All Time', swapBuysAll.count.toString(), fmtBigInt(swapBuysAll.bank), swapSellsAll.count.toString(), fmtBigInt(swapSellsAll.bank)],
      ['30 Days', swapBuysMonth.count.toString(), fmtBigInt(swapBuysMonth.bank), swapSellsMonth.count.toString(), fmtBigInt(swapSellsMonth.bank)],
      ['7 Days', swapBuysWeek.count.toString(), fmtBigInt(swapBuysWeek.bank), swapSellsWeek.count.toString(), fmtBigInt(swapSellsWeek.bank)],
      ['24 Hours', swapBuysDay.count.toString(), fmtBigInt(swapBuysDay.bank), swapSellsDay.count.toString(), fmtBigInt(swapSellsDay.bank)]
    ]
  ));
  console.log('');
  
  // LP Swap Volume & Fees
  const swapVolAll = swapBuysAll.bank + swapSellsAll.bank;
  const swapVolMonth = swapBuysMonth.bank + swapSellsMonth.bank;
  const swapVolWeek = swapBuysWeek.bank + swapSellsWeek.bank;
  const swapVolDay = swapBuysDay.bank + swapSellsDay.bank;
  const swapCountAll = swapBuysAll.count + swapSellsAll.count;
  const swapCountMonth = swapBuysMonth.count + swapSellsMonth.count;
  const swapCountWeek = swapBuysWeek.count + swapSellsWeek.count;
  const swapCountDay = swapBuysDay.count + swapSellsDay.count;
  
  console.log('📊 SWAP VOLUME & FEES');
  console.log(table(
    ['Period', 'Total Swaps', 'Volume (BANK)', 'Fee (1%)'],
    [
      ['All Time', swapCountAll.toString(), fmtBigInt(swapVolAll), fmtBigInt(swapVolAll / 100n)],
      ['30 Days', swapCountMonth.toString(), fmtBigInt(swapVolMonth), fmtBigInt(swapVolMonth / 100n)],
      ['7 Days', swapCountWeek.toString(), fmtBigInt(swapVolWeek), fmtBigInt(swapVolWeek / 100n)],
      ['24 Hours', swapCountDay.toString(), fmtBigInt(swapVolDay), fmtBigInt(swapVolDay / 100n)]
    ]
  ));
  console.log('');
  
  // Swap Fee Distribution
  console.log('💸 SWAP FEE DISTRIBUTION (1% as WFLR)');
  console.log(table(
    ['Period', 'Total Fee', 'Holders (80%)', 'Team (15%)', 'DAO (5%)'],
    [
      ['All Time', fmtBigInt(swapVolAll / 100n), fmtBigInt(swapVolAll * 80n / 10000n), fmtBigInt(swapVolAll * 15n / 10000n), fmtBigInt(swapVolAll * 5n / 10000n)],
      ['30 Days', fmtBigInt(swapVolMonth / 100n), fmtBigInt(swapVolMonth * 80n / 10000n), fmtBigInt(swapVolMonth * 15n / 10000n), fmtBigInt(swapVolMonth * 5n / 10000n)],
      ['7 Days', fmtBigInt(swapVolWeek / 100n), fmtBigInt(swapVolWeek * 80n / 10000n), fmtBigInt(swapVolWeek * 15n / 10000n), fmtBigInt(swapVolWeek * 5n / 10000n)],
      ['24 Hours', fmtBigInt(swapVolDay / 100n), fmtBigInt(swapVolDay * 80n / 10000n), fmtBigInt(swapVolDay * 15n / 10000n), fmtBigInt(swapVolDay * 5n / 10000n)]
    ]
  ));
  console.log('');
  
  // Total Supply Summary
  const totalMintedEvents = mintStats.allTime.bank;
  const totalBurnedSells = burnStats.allTime.bank;  // From sell/burn events
  const totalBurnedTransfer = txAllTime.burned;     // From transfer tax (1%)
  const totalBurnedSwaps = swapVolAll / 100n;       // From swap tax (1%)
  const totalBurned = totalBurnedSells + totalBurnedTransfer + totalBurnedSwaps;
  
  // Calculate untracked mints (supply + burns - minted events)
  const supplyBigInt = BigInt(Math.round(supply * 1e18));
  const untrackedMints = supplyBigInt + totalBurned - totalMintedEvents;
  
  console.log('📋 SUPPLY SUMMARY');
  console.log(table(
    ['Metric', 'BANK'],
    [
      ['Current Supply', fmt(supply)],
      ['Minted (Events)', fmtBigInt(totalMintedEvents)],
      ['Minted (Untracked)*', fmtBigInt(untrackedMints)],
      ['Total Burned', fmtBigInt(totalBurned)]
    ]
  ));
  console.log('* Untracked: mints not captured by indexer');
  console.log('');
}

main().catch(console.error);
