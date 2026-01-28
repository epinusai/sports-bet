import { NextRequest, NextResponse } from 'next/server';
import {
  loadWallet,
  placeBet,
  placeCombo,
  approveToken,
  checkAllowance,
  checkBalances,
  forceSwitchRpc,
} from '@/lib/betting';
import { getChainConfig } from '@/lib/config';

interface Selection {
  conditionId: string;
  outcomeId: string;
  odds: number;
  gameId: string;
  gameTitle: string;
  outcomeName: string;
  marketName?: string;
}

// Validate that a condition is still active and accepting bets
async function validateCondition(conditionId: string): Promise<{ valid: boolean; error?: string; isLive?: boolean }> {
  const config = getChainConfig();
  const now = Math.floor(Date.now() / 1000);

  try {
    const response = await fetch(config.graphql.dataFeed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ condition(id: "${conditionId}") { conditionId state isPrematchEnabled isLiveEnabled game { startsAt state } } }`,
      }),
    });
    const data = await response.json();

    if (!data.data?.condition) {
      return { valid: false, error: `Condition ${conditionId} not found` };
    }

    const condition = data.data.condition;
    const gameStartsAt = parseInt(condition.game?.startsAt || '0');
    const gameHasStarted = gameStartsAt > 0 && gameStartsAt <= now;
    const isLive = gameHasStarted || condition.game?.state === 'Live';

    if (condition.state !== 'Created' && condition.state !== 'Active') {
      return { valid: false, error: `Condition is ${condition.state} - betting not allowed` };
    }

    if (isLive) {
      if (!condition.isLiveEnabled) {
        return { valid: false, error: `Live betting is not enabled for this condition` };
      }
      return { valid: true, isLive: true };
    }

    if (!condition.isPrematchEnabled) {
      return { valid: false, error: `Prematch betting is disabled for this condition` };
    }

    return { valid: true, isLive: false };
  } catch (error) {
    console.error('[ValidateCondition] Error:', error);
    return { valid: true };
  }
}

// POST - Place bet
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[BetAPI] Starting bet placement...');

  try {
    const body = await request.json();
    const { amount, slippage, privateKey, selections } = body as {
      amount: string;
      slippage: number;
      privateKey: string;
      selections: Selection[];
    };
    console.log('[BetAPI] Amount:', amount, 'Slippage:', slippage, 'Selections:', selections?.length);

    if (!amount || parseFloat(amount) <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      );
    }

    if (!privateKey) {
      return NextResponse.json(
        { error: 'Wallet not connected' },
        { status: 400 }
      );
    }

    if (!selections || selections.length === 0) {
      return NextResponse.json(
        { error: 'Bet slip is empty' },
        { status: 400 }
      );
    }

    // Load wallet from provided private key
    console.log('[BetAPI] Loading wallet from request...');
    loadWallet(privateKey);

    // Switch to fresh RPC
    console.log('[BetAPI] Switching to fresh RPC...');
    const newRpc = await forceSwitchRpc();
    console.log('[BetAPI] Using RPC:', newRpc);

    const totalNeeded = parseFloat(amount);

    // Check balances
    console.log('[BetAPI] Checking balances...');
    const balances = await checkBalances(totalNeeded.toString());
    console.log('[BetAPI] MATIC:', balances.maticBalance, 'USDT:', balances.usdtBalance);

    if (!balances.hasEnoughMatic) {
      return NextResponse.json(
        { error: `Insufficient MATIC for gas. You have ${parseFloat(balances.maticBalance).toFixed(4)} MATIC but need at least 0.01 MATIC.` },
        { status: 400 }
      );
    }

    if (!balances.hasEnoughUsdt) {
      return NextResponse.json(
        { error: `Insufficient USDT balance. You have ${parseFloat(balances.usdtBalance).toFixed(2)} USDT but need ${totalNeeded.toFixed(2)} USDT.` },
        { status: 400 }
      );
    }

    // Check allowance and approve if needed
    console.log('[BetAPI] Checking allowance...');
    let allowance = await checkAllowance();
    const allowanceNum = parseFloat(allowance);
    const isUnlimited = allowanceNum >= 999999999;
    console.log('[BetAPI] Current allowance:', isUnlimited ? 'UNLIMITED' : allowance);

    if (allowanceNum < totalNeeded) {
      console.log('[BetAPI] Need to approve UNLIMITED USDT (one-time)...');
      try {
        const approveResult = await approveToken();
        if (approveResult === 'already-approved') {
          console.log('[BetAPI] Already approved, skipping');
        } else {
          console.log('[BetAPI] Unlimited approval tx:', approveResult, 'took', Date.now() - startTime, 'ms');
        }
      } catch (approveError) {
        console.error('[BetAPI] Approval failed:', approveError);
        throw approveError;
      }

      allowance = await checkAllowance();
      console.log('[BetAPI] Verified allowance after approval:', parseFloat(allowance) >= 999999999 ? 'UNLIMITED' : allowance);
      if (parseFloat(allowance) < totalNeeded) {
        throw new Error(`Approval failed. Allowance is ${allowance} but need ${totalNeeded}`);
      }
    } else {
      console.log('[BetAPI] Allowance sufficient, skipping approval');
    }

    const results = [];
    const errors = [];

    // Validate all conditions first
    console.log('[BetAPI] Validating conditions...');
    const validSelections: Selection[] = [];
    const removedSelections: string[] = [];

    for (const selection of selections) {
      console.log('[BetAPI] Validating condition:', selection.conditionId);
      const validation = await validateCondition(selection.conditionId);
      if (!validation.valid) {
        console.log('[BetAPI] Condition validation failed:', validation.error);
        removedSelections.push(selection.outcomeName);
        errors.push({
          selection: selection.outcomeName,
          error: validation.error || 'Condition not valid for betting',
        });
      } else {
        validSelections.push(selection);
      }
    }

    if (removedSelections.length > 0) {
      console.log('[BetAPI] Removed', removedSelections.length, 'stale selections:', removedSelections.join(', '));
    }

    if (validSelections.length === 0) {
      return NextResponse.json(
        { error: 'No valid selections to bet on', errors },
        { status: 400 }
      );
    }

    // Use combo bet for multiple selections, single bet for one
    if (validSelections.length >= 2) {
      // COMBO/PARLAY BET
      console.log('[BetAPI] Placing COMBO bet with', validSelections.length, 'selections...');
      try {
        const comboSelections = validSelections.map((sel) => ({
          conditionId: sel.conditionId,
          outcomeId: sel.outcomeId,
          odds: sel.odds,
        }));

        const totalOdds = comboSelections.reduce((acc, s) => acc * s.odds, 1);
        console.log('[BetAPI] Combo odds:', totalOdds.toFixed(2));

        const result = await placeCombo({
          selections: comboSelections,
          amount,
          slippage: slippage || 5,
        });

        console.log('[BetAPI] Combo bet result:', result.status, 'txHash:', result.txHash, 'error:', result.error);

        if (result.status === 'rejected') {
          errors.push({
            selection: `COMBO (${validSelections.length} legs)`,
            error: result.error || 'Bet rejected by relayer',
          });
        } else {
          const outcomeNames = validSelections.map((s) => s.outcomeName).join(' + ');

          results.push({
            selection: `COMBO (${validSelections.length} legs): ${outcomeNames}`,
            txHash: result.txHash,
            betId: result.betId,
            status: result.status,
            totalOdds: totalOdds.toFixed(2),
            potentialPayout: (parseFloat(amount) * totalOdds).toFixed(2),
            polygonscan: result.txHash ? `https://polygonscan.com/tx/${result.txHash}` : undefined,
          });
        }
      } catch (error) {
        console.error('[BetAPI] Combo bet failed:', error);
        errors.push({
          selection: `COMBO (${validSelections.length} legs)`,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    } else {
      // SINGLE BET
      const selection = validSelections[0];
      try {
        console.log('[BetAPI] Placing SINGLE bet for:', selection.outcomeName);
        const result = await placeBet({
          conditionId: selection.conditionId,
          outcomeId: selection.outcomeId,
          amount,
          odds: selection.odds.toString(),
          slippage: slippage || 5,
          skipConfirmation: true,
        });
        console.log('[BetAPI] Bet result:', result.status, 'txHash:', result.txHash, 'error:', result.error);

        if (result.status === 'rejected') {
          errors.push({
            selection: selection.outcomeName,
            error: result.error || 'Bet rejected by relayer',
          });
        } else {
          results.push({
            selection: selection.outcomeName,
            txHash: result.txHash,
            betId: result.betId,
            status: result.status,
            polygonscan: result.txHash ? `https://polygonscan.com/tx/${result.txHash}` : undefined,
          });
        }
      } catch (error) {
        errors.push({
          selection: selection.outcomeName,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const totalTime = Date.now() - startTime;
    console.log('[BetAPI] Complete! Results:', results.length, 'Errors:', errors.length, 'Time:', totalTime, 'ms');

    return NextResponse.json({
      success: results.length > 0,
      results,
      errors,
      removedSelections: removedSelections.length > 0 ? removedSelections : undefined,
      removedCount: removedSelections.length > 0 ? removedSelections.length : undefined,
      message:
        errors.length > 0
          ? `${results.length} bets placed, ${errors.length} failed` +
            (removedSelections.length > 0 ? ` (${removedSelections.length} stale selections removed)` : '')
          : `${results.length} bet(s) sent! Check Polygonscan for confirmation.`,
    });
  } catch (error) {
    console.error('[BetAPI] Error placing bet:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to place bet' },
      { status: 500 }
    );
  }
}
