import { NextRequest, NextResponse } from 'next/server';
import { getWallet } from '@/lib/db';
import { getChainConfig } from '@/lib/config';
import { ethers } from 'ethers';
import {
  checkCashoutAvailable,
  getCashoutCalculation,
  executeCashout,
  getBetDetails,
  fullCashout,
} from '@/lib/cashout';

// Check if conditions have cashout enabled at the protocol level
// This is set by Azuro's liquidity providers - not all markets support cashout
async function checkConditionsCashoutEnabled(conditionIds: string[], dataFeedUrl: string): Promise<{
  enabledCount: number;
  disabledCount: number;
  conditions: Array<{ conditionId: string; isCashoutEnabled: boolean }>;
}> {
  try {
    const query = `{
      conditions(where: { conditionId_in: [${conditionIds.map(id => `"${id}"`).join(', ')}] }) {
        conditionId
        isCashoutEnabled
      }
    }`;

    const response = await fetch(dataFeedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    const conditions = data.data?.conditions || [];

    let enabledCount = 0;
    let disabledCount = 0;

    for (const cond of conditions) {
      if (cond.isCashoutEnabled) {
        enabledCount++;
      } else {
        disabledCount++;
      }
    }

    // Also count any conditions not found (assume disabled)
    const foundIds = new Set(conditions.map((c: { conditionId: string }) => c.conditionId));
    for (const id of conditionIds) {
      if (!foundIds.has(id)) {
        disabledCount++;
      }
    }

    return { enabledCount, disabledCount, conditions };
  } catch (error) {
    console.error('[Cashout] Error checking isCashoutEnabled:', error);
    // On error, assume all enabled to let the API decide
    return { enabledCount: conditionIds.length, disabledCount: 0, conditions: [] };
  }
}

// GET - Get available cashouts for pending bets (single AND combo)
export async function GET(request: NextRequest) {
  try {
    const storedWallet = getWallet();
    if (!storedWallet?.address) {
      return NextResponse.json({ cashouts: [] });
    }

    // Check if specific betId requested
    const betId = request.nextUrl.searchParams.get('betId');

    const config = getChainConfig();
    const addr = storedWallet.address.toLowerCase();

    // Query pending/accepted bets that might be cashout-eligible
    // V3 schema: selections contain conditionId directly
    // Note: 'id' field contains full betId format (contract_betId) needed for cashout API
    let query: string;
    if (betId) {
      query = `{
        v3Bet(id: "${betId}") {
          id
          betId
          amount
          odds
          potentialPayout
          status
          isCashedOut
          type
          createdTxHash
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
    } else {
      query = `{
        v3Bets(first: 50, where: { actor: "${addr}", status_in: [Accepted], isCashedOut: false }) {
          id
          betId
          amount
          odds
          potentialPayout
          status
          isCashedOut
          type
          createdTxHash
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
    }

    const response = await fetch(config.graphql.client, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    let pendingBets;
    if (betId) {
      pendingBets = data.data?.v3Bet ? [data.data.v3Bet] : [];
    } else {
      pendingBets = data.data?.v3Bets || [];
    }

    console.log('[Cashout] Found', pendingBets.length, 'eligible bets');

    if (pendingBets.length === 0) {
      return NextResponse.json({ cashouts: [] });
    }

    // Build cashout info for each bet
    const cashouts = [];

    for (const bet of pendingBets) {
      // Skip already cashed out bets
      if (bet.isCashedOut) continue;

      // Get all condition IDs for this bet (handles both single and combo)
      const conditionIds = bet.selections?.map(
        (s: { outcome: { condition: { conditionId: string } } }) => s.outcome.condition.conditionId
      ) || [];

      if (conditionIds.length === 0) continue;

      const isCombo = bet.type === 'Express' || conditionIds.length > 1;
      // Use full bet ID (contract_betId format) for cashout API
      const fullBetId = bet.id || bet.betId;
      console.log('[Cashout] Checking bet', fullBetId, isCombo ? '(COMBO)' : '(SINGLE)', 'with', conditionIds.length, 'conditions');

      // First check if conditions have cashout enabled at the protocol level
      // This is set by Azuro's liquidity providers - not all markets support cashout
      const conditionsWithCashout = await checkConditionsCashoutEnabled(conditionIds, config.graphql.dataFeed);

      if (conditionsWithCashout.disabledCount > 0) {
        console.log('[Cashout] Bet', fullBetId, 'NOT available: isCashoutEnabled=false for', conditionsWithCashout.disabledCount, 'of', conditionIds.length, 'conditions');
        continue;
      }

      // Try to get cashout calculation directly
      const calculation = await getCashoutCalculation(
        fullBetId,
        storedWallet.address,
        config.websocket.environment
      );

      if (calculation) {
        // Cashout is available - we got a calculation
        console.log('[Cashout] Bet', fullBetId, 'HAS cashout available:', calculation.cashoutAmount);

        cashouts.push({
          betId: bet.betId,
          fullBetId: fullBetId,
          amount: bet.amount,
          originalOdds: bet.odds,
          potentialPayout: bet.potentialPayout,
          type: isCombo ? 'combo' : 'single',
          selectionCount: conditionIds.length,
          conditionIds,
          isAvailable: true,
          cashoutAmount: calculation.cashoutAmount,
          cashoutOdds: calculation.cashoutOdds,
          calculationId: calculation.calculationId,
          expiredAt: calculation.expiredAt,
          approveExpiredAt: calculation.approveExpiredAt,
        });
      } else {
        // Cashout calculation failed - check availability for more details
        const availability = await checkCashoutAvailable(conditionIds);
        console.log('[Cashout] Bet', fullBetId, 'NOT available. Reason:',
          availability.unavailableConditions.length > 0
            ? `Unavailable conditions: ${availability.unavailableConditions.join(', ')}`
            : 'Cashout multiplier not available (live game or market paused)');
      }
    }

    return NextResponse.json({
      cashouts,
      totalEligible: pendingBets.length,
      totalAvailable: cashouts.length,
    });
  } catch (error) {
    console.error('[Cashout] Error:', error);
    return NextResponse.json({ cashouts: [], error: 'Failed to get cashout info' });
  }
}

// POST - Calculate or execute cashout
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { betId, fullBetId, action, slippage } = body;

    // Use fullBetId if provided, otherwise use betId
    // fullBetId is in format: contractAddress_betId
    const queryBetId = fullBetId || betId;

    if (!queryBetId) {
      return NextResponse.json({ error: 'betId is required' }, { status: 400 });
    }

    const storedWallet = getWallet();
    if (!storedWallet?.private_key) {
      return NextResponse.json({ error: 'Wallet not connected' }, { status: 400 });
    }

    const config = getChainConfig();
    const wallet = new ethers.Wallet(storedWallet.private_key);
    const environment = config.websocket.environment;

    // Action: calculate - Get cashout calculation
    if (action === 'calculate') {
      console.log('[Cashout] Getting calculation for bet:', queryBetId);

      // First get bet details to check conditions
      // Try with full betId format first, fallback to numeric betId
      let betDetails = await getBetDetails(queryBetId);
      if (!betDetails && betId && betId !== queryBetId) {
        betDetails = await getBetDetails(betId);
      }
      if (!betDetails) {
        return NextResponse.json({ error: 'Bet not found' }, { status: 404 });
      }

      if (betDetails.isCashedOut) {
        return NextResponse.json({ error: 'Bet already cashed out' }, { status: 400 });
      }

      if (betDetails.status !== 'Accepted') {
        return NextResponse.json({ error: `Bet status is ${betDetails.status}, cannot cash out` }, { status: 400 });
      }

      const isCombo = betDetails.selections.length > 1;
      const conditionIds = betDetails.selections.map(s => s.conditionId);

      // Get calculation using the full betId format
      const calculation = await getCashoutCalculation(queryBetId, storedWallet.address, environment);
      if (!calculation) {
        // Check availability for more details
        const availability = await checkCashoutAvailable(conditionIds);
        return NextResponse.json({
          error: 'Cashout not available',
          reason: availability.unavailableConditions.length > 0
            ? `Unavailable conditions: ${availability.unavailableConditions.join(', ')}`
            : 'Cashout multiplier not available (market paused or game in progress)',
          unavailableConditions: availability.unavailableConditions,
        }, { status: 400 });
      }

      return NextResponse.json({
        betId,
        fullBetId: queryBetId,
        type: isCombo ? 'combo' : 'single',
        selectionCount: conditionIds.length,
        originalAmount: betDetails.amount,
        originalOdds: betDetails.odds,
        calculationId: calculation.calculationId,
        cashoutAmount: calculation.cashoutAmount,
        cashoutOdds: calculation.cashoutOdds,
        expiredAt: calculation.expiredAt,
        approveExpiredAt: calculation.approveExpiredAt,
      });
    }

    // Action: execute - Execute the cashout
    if (action === 'execute') {
      const { calculationId, cashoutOdds } = body;
      const slippagePercent = slippage || 5;

      // Extract numeric betId if full format provided (contract_betId -> betId)
      const numericBetId = queryBetId.includes('_') ? queryBetId.split('_')[1] : queryBetId;

      // If calculationId provided, use it; otherwise do full flow
      if (calculationId) {
        console.log('[Cashout] Executing with existing calculation:', calculationId, 'for bet:', numericBetId);

        // Calculate minOdds with slippage
        const currentOdds = parseFloat(cashoutOdds || '1');
        const minOdds = currentOdds * (1 - slippagePercent / 100);
        const expiresAt = body.expiredAt || Math.floor(Date.now() / 1000) + 300;

        const result = await executeCashout(
          wallet,
          numericBetId,
          calculationId,
          minOdds.toString(),
          expiresAt
        );

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          orderId: result.orderId,
          txHash: result.txHash,
          cashoutAmount: result.cashoutAmount,
        });
      } else {
        // Full cashout flow (check, calculate, execute)
        console.log('[Cashout] Executing full cashout flow for bet:', queryBetId);

        const result = await fullCashout(wallet, queryBetId, slippagePercent);

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }

        return NextResponse.json({
          success: true,
          orderId: result.orderId,
          txHash: result.txHash,
          cashoutAmount: result.cashoutAmount,
        });
      }
    }

    // Action: check - Just check availability
    if (action === 'check') {
      const betDetails = await getBetDetails(betId);
      if (!betDetails) {
        return NextResponse.json({ error: 'Bet not found' }, { status: 404 });
      }

      const conditionIds = betDetails.selections.map(s => s.conditionId);
      const availability = await checkCashoutAvailable(conditionIds);

      return NextResponse.json({
        betId,
        type: betDetails.selections.length > 1 ? 'combo' : 'single',
        selectionCount: betDetails.selections.length,
        available: availability.available,
        margin: availability.margin,
        marginMin: availability.marginMin,
        unavailableConditions: availability.unavailableConditions,
        conditions: availability.conditions,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use: calculate, execute, or check' }, { status: 400 });
  } catch (error) {
    console.error('[Cashout] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cashout failed' },
      { status: 500 }
    );
  }
}
