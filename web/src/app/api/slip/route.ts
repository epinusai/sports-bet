import { NextRequest, NextResponse } from 'next/server';
import {
  getSlipSelections,
  addSlipSelection,
  removeSlipSelection,
  clearSlip,
  updateSlipOdds,
} from '@/lib/db';
import { getChainConfig } from '@/lib/config';
import { GraphQLClient } from 'graphql-request';

// GET - Get bet slip
export async function GET() {
  try {
    const selections = getSlipSelections();

    // Calculate totals
    const totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);

    return NextResponse.json({
      selections: selections.map((s) => ({
        id: s.id,
        gameId: s.game_id,
        gameTitle: s.game_title,
        conditionId: s.condition_id,
        outcomeId: s.outcome_id,
        outcomeName: s.outcome_name,
        odds: s.odds,
        marketName: s.market_name,
      })),
      totalOdds: Math.round(totalOdds * 100) / 100,
      count: selections.length,
    });
  } catch (error) {
    console.error('Error getting slip:', error);
    return NextResponse.json(
      { error: 'Failed to get bet slip' },
      { status: 500 }
    );
  }
}

// POST - Add to slip
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, gameTitle, conditionId, outcomeId, outcomeName, odds, marketName } = body;

    if (!gameId || !conditionId || !outcomeId || !outcomeName || !odds) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    addSlipSelection({
      game_id: gameId,
      game_title: gameTitle,
      condition_id: conditionId,
      outcome_id: outcomeId,
      outcome_name: outcomeName,
      odds: parseFloat(odds),
      market_name: marketName || null,
    });

    // Return updated slip
    const selections = getSlipSelections();
    const totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);

    return NextResponse.json({
      selections: selections.map((s) => ({
        id: s.id,
        gameId: s.game_id,
        gameTitle: s.game_title,
        conditionId: s.condition_id,
        outcomeId: s.outcome_id,
        outcomeName: s.outcome_name,
        odds: s.odds,
        marketName: s.market_name,
      })),
      totalOdds: Math.round(totalOdds * 100) / 100,
      count: selections.length,
    });
  } catch (error) {
    console.error('Error adding to slip:', error);
    return NextResponse.json(
      { error: 'Failed to add to slip' },
      { status: 500 }
    );
  }
}

// DELETE - Remove from slip or clear
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conditionId = searchParams.get('conditionId');
    const outcomeId = searchParams.get('outcomeId');
    const clearAll = searchParams.get('clearAll');

    if (clearAll === 'true') {
      clearSlip();
    } else if (conditionId && outcomeId) {
      removeSlipSelection(conditionId, outcomeId);
    } else {
      return NextResponse.json(
        { error: 'Missing conditionId and outcomeId, or clearAll flag' },
        { status: 400 }
      );
    }

    // Return updated slip
    const selections = getSlipSelections();
    const totalOdds = selections.length > 0 ? selections.reduce((acc, s) => acc * s.odds, 1) : 0;

    return NextResponse.json({
      selections: selections.map((s) => ({
        id: s.id,
        gameId: s.game_id,
        gameTitle: s.game_title,
        conditionId: s.condition_id,
        outcomeId: s.outcome_id,
        outcomeName: s.outcome_name,
        odds: s.odds,
        marketName: s.market_name,
      })),
      totalOdds: Math.round(totalOdds * 100) / 100,
      count: selections.length,
    });
  } catch (error) {
    console.error('Error removing from slip:', error);
    return NextResponse.json(
      { error: 'Failed to remove from slip' },
      { status: 500 }
    );
  }
}

// PATCH - Refresh odds from API
export async function PATCH() {
  try {
    const selections = getSlipSelections();

    if (selections.length === 0) {
      return NextResponse.json({
        selections: [],
        totalOdds: 0,
        count: 0,
        refreshed: true,
      });
    }

    const config = getChainConfig();
    const client = new GraphQLClient(config.graphql.dataFeed);

    // Fetch fresh odds for all conditions
    const conditionIds = selections.map(s => s.condition_id);

    // DEBUG: Log all condition IDs being queried
    console.log('[RefreshOdds] ========== DEBUG START ==========');
    console.log('[RefreshOdds] Querying conditionIds:', JSON.stringify(conditionIds));
    console.log('[RefreshOdds] Selections in slip:');
    for (const s of selections) {
      console.log(`  - ${s.outcome_name}: conditionId=${s.condition_id}, outcomeId=${s.outcome_id}, currentOdds=${s.odds}`);
    }

    // Query includes state to check for stale conditions
    const query = `
      query GetConditions($conditionIds: [String!]!) {
        conditions(where: { conditionId_in: $conditionIds }) {
          conditionId
          state
          outcomes {
            outcomeId
            currentOdds
          }
        }
      }
    `;

    console.log('[RefreshOdds] Fetching fresh odds for', conditionIds.length, 'conditions from:', config.graphql.dataFeed);

    const data = await client.request<{
      conditions: Array<{
        conditionId: string;
        state: string;
        outcomes: Array<{ outcomeId: string; currentOdds: string }>;
      }>;
    }>(query, { conditionIds });

    // DEBUG: Log raw GraphQL response
    console.log('[RefreshOdds] GraphQL returned', data.conditions?.length || 0, 'conditions');
    console.log('[RefreshOdds] Raw response:', JSON.stringify(data, null, 2));

    // Create maps for quick lookup
    const oddsMap = new Map<string, number>();
    const stateMap = new Map<string, string>();
    const foundConditions = new Set<string>();

    for (const condition of data.conditions || []) {
      foundConditions.add(condition.conditionId);
      stateMap.set(condition.conditionId, condition.state);
      console.log(`[RefreshOdds] Condition ${condition.conditionId}: state=${condition.state}, outcomes=${condition.outcomes.length}`);
      for (const outcome of condition.outcomes) {
        const key = `${condition.conditionId}:${outcome.outcomeId}`;
        oddsMap.set(key, parseFloat(outcome.currentOdds));
        console.log(`  -> Outcome ${outcome.outcomeId}: currentOdds=${outcome.currentOdds}`);
      }
    }

    // DEBUG: Check for conditions NOT found in GraphQL response
    const notFoundConditions: string[] = [];
    for (const selection of selections) {
      if (!foundConditions.has(selection.condition_id)) {
        console.log(`[RefreshOdds] ⚠️ CONDITION NOT FOUND: ${selection.condition_id} for "${selection.outcome_name}"`);
        console.log(`  This could mean: condition was replaced, expired, or uses different ID format`);
        notFoundConditions.push(selection.condition_id);
      }
    }

    if (notFoundConditions.length > 0) {
      console.log('[RefreshOdds] Missing conditions summary:', notFoundConditions.join(', '));
    }

    // Remove stale selections (Stopped, Resolved, Canceled conditions)
    const removedSelections: string[] = [];
    for (const selection of selections) {
      const state = stateMap.get(selection.condition_id);
      // Active states are: Created, Active
      // Inactive states are: Stopped, Resolved, Canceled, Paused
      if (state && state !== 'Created' && state !== 'Active') {
        console.log('[RefreshOdds] Removing stale selection:', selection.outcome_name, '- condition is', state);
        removeSlipSelection(selection.condition_id, selection.outcome_id);
        removedSelections.push(selection.outcome_name);
      } else if (!state) {
        // Condition not found in GraphQL - might be stale too
        console.log('[RefreshOdds] ⚠️ Condition not found for:', selection.outcome_name, '- conditionId:', selection.condition_id);
        console.log('[RefreshOdds] NOT removing (condition might still be valid but not indexed yet)');
      }
    }

    if (removedSelections.length > 0) {
      console.log('[RefreshOdds] Removed', removedSelections.length, 'stale selections:', removedSelections.join(', '));
    }

    // Update odds in database for remaining selections
    let updatedCount = 0;
    let notFoundCount = 0;
    const activeSelections = getSlipSelections(); // Get fresh list after removals

    console.log('[RefreshOdds] Processing', activeSelections.length, 'active selections for odds update:');

    for (const selection of activeSelections) {
      const key = `${selection.condition_id}:${selection.outcome_id}`;
      const freshOdds = oddsMap.get(key);

      console.log(`[RefreshOdds] Checking "${selection.outcome_name}": key=${key}`);

      if (freshOdds === undefined) {
        console.log(`  -> ❌ NO FRESH ODDS FOUND for key ${key}`);
        console.log(`     Possible reasons: outcomeId mismatch, condition not in response, or GraphQL indexing delay`);
        notFoundCount++;
      } else if (Math.abs(freshOdds - selection.odds) > 0.001) {
        console.log(`  -> ✅ Updating odds from ${selection.odds} to ${freshOdds}`);
        updateSlipOdds(selection.condition_id, selection.outcome_id, freshOdds);
        updatedCount++;
      } else {
        console.log(`  -> ✓ Odds unchanged (${selection.odds})`);
      }
    }

    console.log('[RefreshOdds] Summary: Updated', updatedCount, 'odds,', notFoundCount, 'not found');
    console.log('[RefreshOdds] ========== DEBUG END ==========');

    // Return updated slip
    const updatedSelections = getSlipSelections();
    const totalOdds = updatedSelections.reduce((acc, s) => acc * s.odds, 1);

    return NextResponse.json({
      selections: updatedSelections.map((s) => ({
        id: s.id,
        gameId: s.game_id,
        gameTitle: s.game_title,
        conditionId: s.condition_id,
        outcomeId: s.outcome_id,
        outcomeName: s.outcome_name,
        odds: s.odds,
        marketName: s.market_name,
      })),
      totalOdds: Math.round(totalOdds * 100) / 100,
      count: updatedSelections.length,
      refreshed: true,
      updatedCount,
      removedSelections: removedSelections.length > 0 ? removedSelections : undefined,
      removedCount: removedSelections.length > 0 ? removedSelections.length : undefined,
    });
  } catch (error) {
    console.error('Error refreshing odds:', error);
    return NextResponse.json(
      { error: 'Failed to refresh odds' },
      { status: 500 }
    );
  }
}
