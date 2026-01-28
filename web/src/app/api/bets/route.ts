import { NextRequest, NextResponse } from 'next/server';
import { getBets, getProfitLoss, getWallet, syncBetStatus, recoverFailedBets } from '@/lib/db';

// GET - Get bet history
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const limit = parseInt(searchParams.get('limit') || '100');
    const sync = searchParams.get('sync') !== 'false'; // Sync by default

    // Sync bet status from Azuro before returning
    if (sync) {
      const wallet = getWallet();
      if (wallet?.address) {
        await syncBetStatus(wallet.address);
      }
    }

    const bets = getBets(status, limit);
    const stats = getProfitLoss();

    return NextResponse.json({
      bets: bets.map((b) => ({
        id: b.id,
        betId: b.bet_id,
        txHash: b.tx_hash,
        gameId: b.game_id,
        gameTitle: b.game_title,
        conditionId: b.condition_id,
        outcomeId: b.outcome_id,
        outcomeName: b.outcome_name,
        odds: b.odds,
        amount: b.amount,
        potentialPayout: b.potential_payout,
        status: b.status,
        result: b.result,
        payout: b.payout,
        placedAt: b.placed_at,
        settledAt: b.settled_at,
      })),
      stats,
    });
  } catch (error) {
    console.error('Error getting bets:', error);
    return NextResponse.json(
      { error: 'Failed to get bets' },
      { status: 500 }
    );
  }
}

// POST - Recover failed ghost bets or debug
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    const wallet = getWallet();
    if (!wallet?.address) {
      return NextResponse.json({ error: 'Wallet not connected' }, { status: 400 });
    }

    if (action === 'recover') {
      console.log('[BetsAPI] Starting recovery of failed ghost bets...');
      console.log('[BetsAPI] Wallet address:', wallet.address);
      const result = await recoverFailedBets(wallet.address);

      return NextResponse.json({
        success: true,
        message: `Recovered ${result.recovered} out of ${result.checked} failed bets`,
        recovered: result.recovered,
        checked: result.checked,
        walletAddress: wallet.address,
        debug: result.debug,
      });
    }

    if (action === 'force-sync') {
      // Force sync with detailed logging
      console.log('[BetsAPI] Starting FORCE SYNC...');
      await syncBetStatus(wallet.address);

      // Get updated bets
      const bets = getBets(undefined, 50);
      const acceptedBets = bets.filter(b => b.status === 'accepted');
      const settledBets = bets.filter(b => b.status === 'settled');

      return NextResponse.json({
        success: true,
        message: 'Force sync completed',
        stats: {
          total: bets.length,
          accepted: acceptedBets.length,
          settled: settledBets.length,
        },
        acceptedBets: acceptedBets.map(b => ({
          id: b.id,
          betId: b.bet_id,
          outcomeName: b.outcome_name,
          amount: b.amount,
          status: b.status,
          result: b.result,
        })),
      });
    }

    if (action === 'debug') {
      // Debug endpoint to show local failed bets and chain bets side by side
      const db = await import('@/lib/db');
      const database = db.getDb();

      const failedBets = database.prepare(`
        SELECT * FROM bets
        WHERE status = 'failed'
          AND result = 'ghost_bet_cleanup'
        ORDER BY placed_at DESC
      `).all();

      // Query chain bets
      const CLIENT_API = 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3';
      const addr = wallet.address.toLowerCase();

      const query = `{
        v3Bets(
          first: 50,
          where: { actor: "${addr}" },
          orderBy: createdBlockTimestamp,
          orderDirection: desc
        ) {
          betId
          amount
          odds
          status
          createdTxHash
          createdBlockTimestamp
          selections {
            outcome {
              outcomeId
              condition {
                conditionId
              }
            }
          }
        }
      }`;

      const response = await fetch(CLIENT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();
      const chainBets = data.data?.v3Bets || [];

      return NextResponse.json({
        walletAddress: wallet.address,
        walletAddressLower: addr,
        failedBets: (failedBets as BetRecord[]).map((b) => ({
          id: b.id,
          outcome_name: b.outcome_name,
          amount: b.amount,
          condition_id: b.condition_id,
          outcome_id: b.outcome_id,
          placed_at: b.placed_at,
        })),
        chainBets: chainBets.map((b: { betId: string; amount: string; status: string; createdTxHash: string; selections: { outcome: { outcomeId: string; condition: { conditionId: string } } }[] }) => ({
          betId: b.betId,
          amount: b.amount,
          status: b.status,
          txHash: b.createdTxHash,
          conditionIds: b.selections?.map((s) => s.outcome.condition.conditionId) || [],
          outcomeIds: b.selections?.map((s) => s.outcome.outcomeId) || [],
        })),
        graphqlErrors: data.errors,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use: recover or debug' }, { status: 400 });
  } catch (error) {
    console.error('Error in bets POST:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}

interface BetRecord {
  id: number;
  outcome_name: string;
  amount: number;
  condition_id: string;
  outcome_id: string;
  placed_at: string;
}
