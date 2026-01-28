import { NextRequest, NextResponse } from 'next/server';
import { getGame, isLive } from '@/lib/azuro-api';

// Validate conditions using the cashout API (more accurate than data feed for live games)
// The data feed sometimes shows conditions as "Active" when they're actually stopped
async function validateConditionsForLiveGame(conditionIds: string[]): Promise<Set<string>> {
  const stoppedConditions = new Set<string>();

  if (conditionIds.length === 0) return stoppedConditions;

  try {
    const response = await fetch('https://api.onchainfeed.org/api/v1/public/cashout/get-available', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionIds }),
    });

    if (!response.ok) return stoppedConditions;

    const data = await response.json();

    // Mark conditions that are stopped or unavailable
    for (const avail of data.availables || []) {
      if (avail.gameState === 'Stopped' || avail.gameState === 'Finished' || !avail.available) {
        // Only mark as stopped if gameState indicates it's truly stopped
        // available=false with Live gameState might just be temporary pause
        if (avail.gameState === 'Stopped' || avail.gameState === 'Finished') {
          stoppedConditions.add(avail.conditionId);
        }
      }
    }

    console.log('[GameAPI] Validated conditions: found', stoppedConditions.size, 'stopped out of', conditionIds.length);
  } catch (error) {
    console.error('[GameAPI] Error validating conditions:', error);
  }

  return stoppedConditions;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await getGame(id);

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    // For live games, validate conditions using the cashout API
    // This catches cases where data feed shows Active but market is actually stopped
    if (isLive(game.startsAt) && game.conditions && game.conditions.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditionIds = game.conditions.map((c: any) => c.conditionId);
      const stoppedConditions = await validateConditionsForLiveGame(conditionIds);

      // Update condition states based on validation
      if (stoppedConditions.size > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        game.conditions = game.conditions.map((c: any) => {
          if (stoppedConditions.has(c.conditionId)) {
            return { ...c, state: 'Stopped' };
          }
          return c;
        });
        console.log('[GameAPI] Updated', stoppedConditions.size, 'conditions to Stopped state');
      }
    }

    return NextResponse.json({ game });
  } catch (error) {
    console.error('Error fetching game:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}
