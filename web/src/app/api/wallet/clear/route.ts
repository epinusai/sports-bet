import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getWallet } from '@/lib/db';

const RPC_URL = 'https://polygon-rpc.com';

// Make raw RPC call
async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// POST - Clear stuck pending transactions by replacing them with 0-value self-transfers
export async function POST() {
  console.log('[ClearTx] Starting to clear stuck transactions...');

  try {
    const storedWallet = getWallet();
    if (!storedWallet?.private_key) {
      return NextResponse.json({ error: 'Wallet not connected' }, { status: 400 });
    }

    const wallet = new ethers.Wallet(storedWallet.private_key);
    console.log('[ClearTx] Wallet:', wallet.address);

    // Get nonces via raw RPC
    const confirmedNonceHex = await rpcCall('eth_getTransactionCount', [wallet.address, 'latest']) as string;
    const pendingNonceHex = await rpcCall('eth_getTransactionCount', [wallet.address, 'pending']) as string;
    const confirmedNonce = parseInt(confirmedNonceHex, 16);
    const pendingNonce = parseInt(pendingNonceHex, 16);

    console.log('[ClearTx] Confirmed nonce:', confirmedNonce, 'Pending nonce:', pendingNonce);

    // Get balance
    const balanceHex = await rpcCall('eth_getBalance', [wallet.address, 'latest']) as string;
    const balance = BigInt(balanceHex);
    console.log('[ClearTx] Balance:', ethers.formatEther(balance), 'MATIC');

    // Get gas price
    const gasPriceHex = await rpcCall('eth_gasPrice', []) as string;
    const networkGas = BigInt(gasPriceHex);
    console.log('[ClearTx] Network gas:', ethers.formatUnits(networkGas, 'gwei'), 'Gwei');

    // Use VERY high gas - 1000 Gwei to replace stuck txs
    const maxFeePerGas = ethers.parseUnits('1000', 'gwei');
    const maxPriorityFeePerGas = ethers.parseUnits('500', 'gwei');
    console.log('[ClearTx] Using maxFee:', ethers.formatUnits(maxFeePerGas, 'gwei'), 'Gwei');

    // If no pending, nothing to do
    if (pendingNonce <= confirmedNonce) {
      return NextResponse.json({
        success: true,
        message: 'No pending transactions to clear',
        confirmedNonce,
        pendingNonce,
      });
    }

    const results: Array<{ nonce: number; txHash?: string; error?: string; status: string }> = [];

    // Clear each pending nonce
    for (let nonce = confirmedNonce; nonce < pendingNonce; nonce++) {
      try {
        console.log(`[ClearTx] Clearing nonce ${nonce}...`);

        // Build raw transaction
        const tx = {
          to: wallet.address,
          value: BigInt(0),
          nonce: nonce,
          gasLimit: BigInt(21000),
          maxFeePerGas,
          maxPriorityFeePerGas,
          chainId: BigInt(137),
          type: 2, // EIP-1559
        };

        // Sign transaction
        const signedTx = await wallet.signTransaction(tx);

        // Send via raw RPC
        const txHash = await rpcCall('eth_sendRawTransaction', [signedTx]) as string;
        console.log(`[ClearTx] Nonce ${nonce} sent: ${txHash}`);
        results.push({ nonce, txHash, status: 'sent' });

        // Delay to avoid rate limiting (1 second between txs)
        await new Promise(r => setTimeout(r, 1000));
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`[ClearTx] Nonce ${nonce} error:`, errorMsg);

        if (errorMsg.includes('nonce') || errorMsg.includes('already known') || errorMsg.includes('replacement')) {
          results.push({ nonce, status: 'skipped', error: errorMsg });
        } else {
          results.push({ nonce, status: 'error', error: errorMsg });
        }
      }
    }

    // Wait a bit then get final state
    await new Promise(r => setTimeout(r, 2000));

    const finalConfirmedHex = await rpcCall('eth_getTransactionCount', [wallet.address, 'latest']) as string;
    const finalPendingHex = await rpcCall('eth_getTransactionCount', [wallet.address, 'pending']) as string;
    const finalBalanceHex = await rpcCall('eth_getBalance', [wallet.address, 'latest']) as string;

    return NextResponse.json({
      success: true,
      wallet: wallet.address,
      before: {
        confirmedNonce,
        pendingNonce,
        balance: ethers.formatEther(balance),
      },
      after: {
        confirmedNonce: parseInt(finalConfirmedHex, 16),
        pendingNonce: parseInt(finalPendingHex, 16),
        balance: ethers.formatEther(BigInt(finalBalanceHex)),
      },
      gasUsed: ethers.formatUnits(maxFeePerGas, 'gwei') + ' Gwei',
      results,
    });
  } catch (error) {
    console.error('[ClearTx] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear transactions' },
      { status: 500 }
    );
  }
}
