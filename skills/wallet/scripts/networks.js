/**
 * Network Configuration — Flare Only
 */

const NETWORKS = {
  flare: {
    name: 'Flare',
    chainId: 14,
    rpc: 'https://flare-api.flare.network/ext/C/rpc',
    explorer: 'https://flarescan.com',
    nativeSymbol: 'FLR',
    wrappedNative: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
    tokens: {
      WFLR: { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
      BANK: { address: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059', decimals: 18 },
      FXRP: { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', decimals: 6 },
      sFLR: { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
      rFLR: { address: '0x26d460c3Cf931Fb2014FA436a49e3Af08619810e', decimals: 18 },
      USDT0: { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
      'USDC.e': { address: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', decimals: 6 },
      CDP: { address: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F', decimals: 18 },
      stXRP: { address: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', decimals: 6 },
      earnXRP: { address: '0xe533e447fd7720b2f8654da2b1953efa06b60bfa', decimals: 6 },
    }
  }
};

const NETWORK_ALIASES = {
  flr: 'flare',
};

function getNetwork(nameOrAlias) {
  const key = NETWORK_ALIASES[nameOrAlias?.toLowerCase()] || nameOrAlias?.toLowerCase();
  return NETWORKS[key] || null;
}

function getNetworkByChainId(chainId) {
  return Object.values(NETWORKS).find(n => n.chainId === chainId) || null;
}

function listNetworks() {
  return Object.entries(NETWORKS).map(([key, net]) => ({
    key,
    name: net.name,
    chainId: net.chainId,
    nativeSymbol: net.nativeSymbol
  }));
}

function resolveToken(symbol, network) {
  const net = typeof network === 'string' ? getNetwork(network) : network;
  if (!net) return null;
  
  const upperSymbol = symbol.toUpperCase();
  for (const [name, token] of Object.entries(net.tokens)) {
    if (name.toUpperCase() === upperSymbol) {
      return { ...token, symbol: name };
    }
  }
  
  if (symbol.startsWith('0x')) {
    return { address: symbol, decimals: 18, symbol: 'UNKNOWN' };
  }
  
  return null;
}

module.exports = {
  NETWORKS,
  NETWORK_ALIASES,
  getNetwork,
  getNetworkByChainId,
  listNetworks,
  resolveToken,
  DEFAULT_NETWORK: 'flare'
};
