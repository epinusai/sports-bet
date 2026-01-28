import { NextResponse } from 'next/server';
import { getWallet } from '@/lib/db';
import {
  loadWallet,
  isWalletConnected,
  cancelPendingTransactions,
} from '@/lib/betting';

// POST - Cancel ALL pending transactions
export async function POST() {
  try {
    // Get stored wallet
    const storedWallet = getWallet();
    if (!storedWallet?.private_key) {
      return NextResponse.json(
        { error: 'Wallet not connected' },
        { status: 400 }
      );
    }

    // Load wallet if not loaded
    if (!isWalletConnected()) {
      loadWallet(storedWallet.private_key);
    }

    const result = await cancelPendingTransactions();

    if (result.cancelled === 0 && result.txHashes.length === 0) {
      return NextResponse.json({
        success: true,
        message: result.error || 'No pending transactions to cancel',
        cancelled: 0,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Cancelled ${result.cancelled} pending transaction(s)`,
      cancelled: result.cancelled,
      hashes: result.txHashes,
      polygonscan: result.txHashes.map(h => `https://polygonscan.com/tx/${h}`),
    });
  } catch (error) {
    console.error('[CancelAPI] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel transactions' },
      { status: 500 }
    );
  }
}
