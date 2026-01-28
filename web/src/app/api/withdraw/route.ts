import { NextRequest, NextResponse } from 'next/server';
import { loadWallet, withdrawPayout, cancelPendingTransactions } from '@/lib/betting';
import { getChainConfig } from '@/lib/config';

// POST - Withdraw payout for a won bet OR cancel pending transactions
export async function POST(request: NextRequest) {
  console.log('[Withdraw] POST request received');
  try {
    const body = await request.json();
    console.log('[Withdraw] Request body:', JSON.stringify(body));
    const { betId, action, force, privateKey } = body;

    if (!privateKey) {
      return NextResponse.json({ error: 'Wallet not connected' }, { status: 400 });
    }

    // Load wallet from provided private key
    loadWallet(privateKey);

    // Handle cancel pending transactions action
    if (action === 'cancel-pending') {
      console.log('[Withdraw] Cancelling pending transactions...');
      const result = await cancelPendingTransactions();

      return NextResponse.json({
        success: true,
        cancelled: result.cancelled,
        txHashes: result.txHashes,
        message: result.cancelled > 0
          ? `Cancelled ${result.cancelled} pending transaction(s). Try withdraw again.`
          : 'No pending transactions found or all already processed.',
      });
    }

    // Allow betId to be a single ID or comma-separated list
    const betIds = betId ? String(betId).split(',').map((id: string) => id.trim()) : [];

    if (betIds.length === 0) {
      console.log('[Withdraw] Error: betId is required');
      return NextResponse.json(
        { error: 'betId is required' },
        { status: 400 }
      );
    }

    console.log('[Withdraw] Processing betIds:', betIds);

    const forceHighGas = force === true;
    console.log('[Withdraw] Wallet loaded, calling withdrawPayout for betIds:', betIds, forceHighGas ? '(FORCE MODE)' : '');

    // Withdraw payout with retry - pass all betIds at once
    let result;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`[Withdraw] Starting attempt ${attempt + 1}...`);
        result = await withdrawPayout(betIds, forceHighGas);
        console.log(`[Withdraw] Attempt ${attempt + 1} succeeded:`, result);
        break;
      } catch (err) {
        lastError = err;
        console.error(`[Withdraw] Attempt ${attempt + 1} failed:`, err);
        if (attempt < 2) {
          console.log('[Withdraw] Waiting 2 seconds before retry...');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (!result) {
      throw lastError || new Error('Withdrawal failed');
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      payout: result.payout,
      polygonscan: `https://polygonscan.com/tx/${result.txHash}`,
    });
  } catch (error) {
    console.error('[Withdraw] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to withdraw' },
      { status: 500 }
    );
  }
}

interface RedeemableBet {
  betId: string;
  amount: string;
  payout: string;
  potentialPayout: string;
  status: string;
  result: string;
  isRedeemed: boolean;
}

// GET - Check redeemable bets
export async function GET(request: NextRequest) {
  try {
    // Get wallet address from header
    const walletAddress = request.headers.get('x-wallet-address');
    if (!walletAddress) {
      console.log('[Withdraw] No wallet address provided');
      return NextResponse.json({ redeemable: [] });
    }

    const config = getChainConfig();
    const addr = walletAddress.toLowerCase();
    console.log('[Withdraw] Checking redeemable bets for:', addr);

    // Query redeemable bets from Azuro V3 API
    const query = `{
      v3Bets(first: 50, where: { actor: "${addr}", status: Resolved, result: Won, isRedeemed: false }) {
        betId
        amount
        payout
        potentialPayout
        status
        result
        isRedeemed
      }
    }`;

    const response = await fetch(config.graphql.client, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    console.log('[Withdraw] GraphQL response:', JSON.stringify(data, null, 2));

    if (data.errors) {
      console.error('[Withdraw] GraphQL errors:', data.errors);
    }

    const redeemableBets = data.data?.v3Bets || [];
    console.log('[Withdraw] Found', redeemableBets.length, 'redeemable bets');

    return NextResponse.json({
      redeemable: (redeemableBets as RedeemableBet[]).map((bet) => ({
        betId: bet.betId,
        amount: bet.amount,
        payout: bet.payout,
      })),
      totalPayout: (redeemableBets as RedeemableBet[]).reduce((sum: number, bet) => sum + parseFloat(bet.payout || '0'), 0),
    });
  } catch (error) {
    console.error('[Withdraw] Error checking redeemable:', error);
    return NextResponse.json({ redeemable: [], error: 'Failed to check redeemable bets' });
  }
}
