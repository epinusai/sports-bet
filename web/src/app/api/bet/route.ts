import { NextRequest, NextResponse } from 'next/server';
import { getWallet, saveBet, clearSlip, getSlipSelections, removeSlipSelection } from '@/lib/db';
import {
  loadWallet,
  placeBet,
  placeCombo,
  approveToken,
  checkAllowance,
  checkBalances,
  isWalletConnected,
  forceSwitchRpc,
} from '@/lib/betting';
import { getChainConfig } from '@/lib/config';

// Validate that a condition is still active and accepting bets
async function validateCondition(conditionId: string): Promise<{ valid: boolean; error?: string; isLive?: boolean }> {
  const config = getChainConfig();
  const now = Math.floor(Date.now() / 1000);

  // Query the condition and game from the data feed
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

    // Check state
    if (condition.state !== 'Created' && condition.state !== 'Active') {
      return { valid: false, error: `Condition is ${condition.state} - betting not allowed` };
    }

    // For live games, check if live betting is enabled
    if (isLive) {
      if (!condition.isLiveEnabled) {
        return { valid: false, error: `Live betting is not enabled for this condition` };
      }
      return { valid: true, isLive: true };
    }

    // For prematch games, check if prematch betting is enabled
    if (!condition.isPrematchEnabled) {
      return { valid: false, error: `Prematch betting is disabled for this condition` };
    }

    return { valid: true, isLive: false };
  } catch (error) {
    console.error('[ValidateCondition] Error:', error);
    // Don't block bet on validation error - let the contract decide
    return { valid: true };
  }
}

// POST - Place bet
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[BetAPI] Starting bet placement...');

  try {
    const body = await request.json();
    const { amount, slippage } = body;
    console.log('[BetAPI] Amount:', amount, 'Slippage:', slippage);

    if (!amount || parseFloat(amount) <= 0) {
      return NextResponse.json(
        { error: 'Invalid amount' },
        { status: 400 }
      );
    }

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
      console.log('[BetAPI] Loading wallet...');
      loadWallet(storedWallet.private_key);
    }

    // Switch to fresh RPC to avoid stale mempool data
    console.log('[BetAPI] Switching to fresh RPC...');
    const newRpc = await forceSwitchRpc();
    console.log('[BetAPI] Using RPC:', newRpc);

    // Get slip selections
    const selections = getSlipSelections();
    console.log('[BetAPI] Selections:', selections.length);
    if (selections.length === 0) {
      return NextResponse.json(
        { error: 'Bet slip is empty' },
        { status: 400 }
      );
    }

    // Calculate total amount needed
    // For combo bets (2+ selections), we only need the single stake amount
    // For single bets, we also only need the single stake amount
    const totalNeeded = parseFloat(amount);

    // Check balances before proceeding
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

    // Check allowance and approve if needed (unlimited approval - one time only)
    console.log('[BetAPI] Checking allowance...');
    let allowance = await checkAllowance();
    const allowanceNum = parseFloat(allowance);
    const isUnlimited = allowanceNum >= 999999999;
    console.log('[BetAPI] Current allowance:', isUnlimited ? 'UNLIMITED' : allowance);

    if (allowanceNum < totalNeeded) {
      console.log('[BetAPI] Need to approve UNLIMITED USDT (one-time)...');
      try {
        const approveResult = await approveToken(); // approveToken internally uses MaxUint256
        if (approveResult === 'already-approved') {
          console.log('[BetAPI] Already approved, skipping');
        } else {
          console.log('[BetAPI] Unlimited approval tx:', approveResult, 'took', Date.now() - startTime, 'ms');
        }
      } catch (approveError) {
        console.error('[BetAPI] Approval failed:', approveError);
        throw approveError;
      }

      // Verify allowance after approval
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
    const validSelections = [];
    const removedSelections: string[] = [];
    for (const selection of selections) {
      console.log('[BetAPI] Validating condition:', selection.condition_id);
      const validation = await validateCondition(selection.condition_id);
      if (!validation.valid) {
        console.log('[BetAPI] Condition validation failed:', validation.error);
        // Auto-remove stale selection from the slip
        console.log('[BetAPI] Removing stale selection from slip:', selection.outcome_name);
        removeSlipSelection(selection.condition_id, selection.outcome_id);
        removedSelections.push(selection.outcome_name);
        errors.push({
          selection: selection.outcome_name,
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
      // COMBO/PARLAY BET - single stake for all selections combined
      console.log('[BetAPI] Placing COMBO bet with', validSelections.length, 'selections...');
      try {
        const comboSelections = validSelections.map((sel) => ({
          conditionId: sel.condition_id,
          outcomeId: sel.outcome_id,
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

        // Handle rejected bets - don't save, report error
        if (result.status === 'rejected') {
          errors.push({
            selection: `COMBO (${validSelections.length} legs)`,
            error: result.error || 'Bet rejected by relayer',
          });
        } else {
          // Save combo bet - use first selection's game info but note it's a combo
          const gameIds = validSelections.map((s) => s.game_id).join(',');
          const gameTitles = validSelections.map((s) => s.game_title).join(' | ');
          const outcomeNames = validSelections.map((s) => s.outcome_name).join(' + ');

          // Map API status to DB status
          const dbStatus = result.status === 'accepted' ? 'accepted' : 'pending';

          saveBet({
            bet_id: result.betId || null,
            tx_hash: result.txHash || null,
            game_id: gameIds,
            game_title: gameTitles,
            condition_id: validSelections[0].condition_id, // First condition
            outcome_id: validSelections[0].outcome_id,
            outcome_name: `COMBO: ${outcomeNames}`,
            odds: totalOdds,
            amount: parseFloat(amount),
            potential_payout: parseFloat(amount) * totalOdds,
            status: dbStatus,
          });

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
      // SINGLE BET - only one selection
      const selection = validSelections[0];
      try {
        console.log('[BetAPI] Placing SINGLE bet for:', selection.outcome_name);
        const result = await placeBet({
          conditionId: selection.condition_id,
          outcomeId: selection.outcome_id,
          amount,
          odds: selection.odds.toString(),
          slippage: slippage || 5,
          skipConfirmation: true,
        });
        console.log('[BetAPI] Bet result:', result.status, 'txHash:', result.txHash, 'error:', result.error);

        // Handle rejected bets - don't save, report error
        if (result.status === 'rejected') {
          errors.push({
            selection: selection.outcome_name,
            error: result.error || 'Bet rejected by relayer',
          });
        } else {
          // Map API status to DB status
          const dbStatus = result.status === 'accepted' ? 'accepted' : 'pending';

          saveBet({
            bet_id: result.betId || null,
            tx_hash: result.txHash || null,
            game_id: selection.game_id,
            game_title: selection.game_title,
            condition_id: selection.condition_id,
            outcome_id: selection.outcome_id,
            outcome_name: selection.outcome_name,
            odds: selection.odds,
            amount: parseFloat(amount),
            potential_payout: parseFloat(amount) * selection.odds,
            status: dbStatus,
          });

          results.push({
            selection: selection.outcome_name,
            txHash: result.txHash,
            betId: result.betId,
            status: result.status,
            polygonscan: result.txHash ? `https://polygonscan.com/tx/${result.txHash}` : undefined,
          });
        }
      } catch (error) {
        errors.push({
          selection: selection.outcome_name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Clear slip if at least one bet succeeded
    if (results.length > 0) {
      clearSlip();
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
            (removedSelections.length > 0 ? ` (${removedSelections.length} stale selections removed from slip)` : '')
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
