import { NextRequest, NextResponse } from 'next/server';
import { getChainConfig } from '@/lib/config';

interface BetSelection {
  conditionId: string;
  outcomeId: string;
}

interface MaxBetResponse {
  maxBet: string;
  maxPayout: string;
  odds: string;
  selections?: Record<string, {
    maxBetByConditionLiquidity: string;
    maxBetOutcomeLimit: string;
    maxOutcomePotentialLoss: string;
    maxConditionPotentialLoss: string;
  }>;
}

// POST - Get max bet for selections
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { selections } = body as { selections: BetSelection[] };

    if (!selections || selections.length === 0) {
      return NextResponse.json({ error: 'selections is required' }, { status: 400 });
    }

    const config = getChainConfig();

    // Convert selections to Azuro API format (outcomeId must be number)
    const bets = selections.map(s => ({
      conditionId: s.conditionId,
      outcomeId: parseInt(s.outcomeId, 10),
    }));

    // Call Azuro bet calculation API
    const response = await fetch('https://api.onchainfeed.org/api/v1/public/bet/calculation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environment: config.websocket.environment,
        bets,
      }),
    });

    if (!response.ok) {
      console.error('[MaxBet] API error:', response.status);
      return NextResponse.json({ error: 'Failed to fetch max bet' }, { status: 500 });
    }

    const data = await response.json();

    if (data.response?.error) {
      console.error('[MaxBet] API returned error:', data.response.error);
      return NextResponse.json({ error: data.response.error }, { status: 400 });
    }

    const result: MaxBetResponse = {
      maxBet: data.response.maxBet,
      maxPayout: data.response.maxPayout,
      odds: data.response.odds,
      selections: data.response.selections,
    };

    console.log('[MaxBet] Max bet:', result.maxBet, 'USDT for', selections.length, 'selection(s)');

    return NextResponse.json(result);
  } catch (error) {
    console.error('[MaxBet] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get max bet' },
      { status: 500 }
    );
  }
}
