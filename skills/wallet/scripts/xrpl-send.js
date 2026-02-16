#!/usr/bin/env node
'use strict';

/**
 * XRPL Send — Send XRP on the XRP Ledger
 * 
 * Usage:
 *   node xrpl-send.js send --to <address> --amount <XRP> [--memo <text>] [--tag <destinationTag>]
 *   node xrpl-send.js balance
 *   node xrpl-send.js history [--limit <n>]
 */

const xrpl = require('xrpl');
const fs = require('fs');
const path = require('path');

const WALLET_PATH = path.join(process.env.HOME, '.openclaw/workspace/.secrets/xrpl-wallet.json');
const XRPL_WS = 'wss://xrplcluster.com';
const MIN_RESERVE = 1; // 1 XRP base reserve

function parseArgs() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      opts[key] = args[i + 1] || true;
      i++;
    }
  }
  return { cmd, ...opts };
}

function loadWallet() {
  if (!fs.existsSync(WALLET_PATH)) {
    throw new Error(`Wallet not found at ${WALLET_PATH}. Create one with: node skills/wallet/scripts/create-xrpl-wallet.js`);
  }
  const data = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
  return xrpl.Wallet.fromSeed(data.secret || data.seed);
}

async function getBalance(client, address) {
  try {
    const resp = await client.request({ command: 'account_info', account: address });
    return parseFloat(xrpl.dropsToXrp(resp.result.account_data.Balance));
  } catch (e) {
    if (e.data?.error === 'actNotFound') return 0;
    throw e;
  }
}

async function cmdBalance() {
  const wallet = loadWallet();
  const client = new xrpl.Client(XRPL_WS);
  await client.connect();

  const balance = await getBalance(client, wallet.address);
  const available = Math.max(0, balance - MIN_RESERVE);

  console.log(`💰 XRPL Wallet Balance`);
  console.log(`═══════════════════════`);
  console.log(`  Address:   ${wallet.address}`);
  console.log(`  Balance:   ${balance.toFixed(6)} XRP`);
  console.log(`  Reserve:   ${MIN_RESERVE} XRP`);
  console.log(`  Available: ${available.toFixed(6)} XRP`);

  await client.disconnect();
}

async function cmdHistory(opts) {
  const wallet = loadWallet();
  const client = new xrpl.Client(XRPL_WS);
  await client.connect();

  const limit = parseInt(opts.limit || '10');
  const resp = await client.request({
    command: 'account_tx',
    account: wallet.address,
    limit,
  });

  console.log(`📜 XRPL Transaction History (last ${limit})`);
  console.log(`═══════════════════════════════════════════`);

  for (const t of resp.result.transactions) {
    const tx = t.tx_json || t.tx;
    const meta = t.meta;
    const result = meta?.TransactionResult || '?';
    const isOutgoing = tx.Account === wallet.address;
    const direction = isOutgoing ? '📤 SENT' : '📥 RECV';
    const counterparty = isOutgoing ? tx.Destination : tx.Account;

    // Get delivered amount
    let amount = '?';
    const nodes = meta?.AffectedNodes || [];
    const walletNode = nodes.find(n => {
      const f = (n.ModifiedNode || n.CreatedNode)?.FinalFields;
      return f?.Account === (isOutgoing ? tx.Destination : wallet.address);
    });
    if (walletNode?.ModifiedNode) {
      const prev = BigInt(walletNode.ModifiedNode.PreviousFields?.Balance || '0');
      const final = BigInt(walletNode.ModifiedNode.FinalFields?.Balance || '0');
      amount = xrpl.dropsToXrp(Math.abs(Number(final - prev)).toString());
    }

    console.log(`  ${direction} ${amount} XRP ${isOutgoing ? '→' : '←'} ${counterparty?.slice(0, 20)}...`);
    console.log(`    TX: ${t.hash || tx.hash}`);
    console.log(`    Status: ${result} | ${t.close_time_iso || ''}`);
    console.log('');
  }

  await client.disconnect();
}

async function cmdSend(opts) {
  // Validate inputs
  if (!opts.to) throw new Error('--to <address> required');
  if (!opts.amount) throw new Error('--amount <XRP> required');

  const destination = opts.to;
  const amount = parseFloat(opts.amount);

  if (isNaN(amount) || amount <= 0) throw new Error(`Invalid amount: ${opts.amount}`);
  if (!destination.startsWith('r') || destination.length < 25 || destination.length > 35) {
    throw new Error(`Invalid XRPL address: ${destination}`);
  }

  const wallet = loadWallet();
  const client = new xrpl.Client(XRPL_WS);
  await client.connect();

  // Check balance
  const balance = await getBalance(client, wallet.address);
  const available = balance - MIN_RESERVE;
  console.log(`💰 XRPL Send`);
  console.log(`═══════════════════════`);
  console.log(`  From:      ${wallet.address}`);
  console.log(`  To:        ${destination}`);
  console.log(`  Amount:    ${amount} XRP`);
  console.log(`  Balance:   ${balance.toFixed(6)} XRP`);
  console.log(`  Available: ${available.toFixed(6)} XRP`);

  if (amount > available) {
    await client.disconnect();
    throw new Error(`Insufficient funds. Need ${amount} XRP, only ${available.toFixed(6)} available (after ${MIN_RESERVE} XRP reserve)`);
  }

  // Check if destination exists
  const destBalance = await getBalance(client, destination);
  if (destBalance === 0 && amount < 1) {
    console.log(`\n  ⚠️  Destination not activated. Need ≥1 XRP to activate a new account.`);
    await client.disconnect();
    throw new Error('Destination account not activated. Send at least 1 XRP.');
  }

  // Build payment
  const payment = {
    TransactionType: 'Payment',
    Account: wallet.address,
    Destination: destination,
    Amount: xrpl.xrpToDrops(amount.toString()),
  };

  // Optional destination tag
  if (opts.tag) {
    payment.DestinationTag = parseInt(opts.tag);
    console.log(`  Dest Tag:  ${payment.DestinationTag}`);
  }

  // Optional memo
  if (opts.memo) {
    payment.Memos = [{
      Memo: {
        MemoData: Buffer.from(opts.memo).toString('hex').toUpperCase(),
        MemoType: Buffer.from('text/plain').toString('hex').toUpperCase(),
      }
    }];
    console.log(`  Memo:      ${opts.memo}`);
  }

  console.log(`\n💸 Sending...`);

  const prepared = await client.autofill(payment);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const txResult = result.result.meta?.TransactionResult;
  console.log(`\n  TX:     ${result.result.hash}`);
  console.log(`  Result: ${txResult}`);

  if (txResult !== 'tesSUCCESS') {
    await client.disconnect();
    throw new Error(`Payment failed: ${txResult}`);
  }

  const remaining = await getBalance(client, wallet.address);
  console.log(`  Remaining: ${remaining.toFixed(6)} XRP`);
  console.log(`\n✅ Sent ${amount} XRP to ${destination}`);

  await client.disconnect();
}

async function main() {
  const args = parseArgs();

  try {
    switch (args.cmd) {
      case 'send':
        await cmdSend(args);
        break;
      case 'balance':
      case 'bal':
        await cmdBalance();
        break;
      case 'history':
      case 'txs':
        await cmdHistory(args);
        break;
      default:
        console.log('Usage:');
        console.log('  node xrpl-send.js send --to <address> --amount <XRP> [--memo <text>] [--tag <num>]');
        console.log('  node xrpl-send.js balance');
        console.log('  node xrpl-send.js history [--limit <n>]');
        process.exit(1);
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

main();
