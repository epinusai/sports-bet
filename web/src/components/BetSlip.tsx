'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSlipStore, useWalletStore } from '@/lib/store';
import { useOddsWebSocket } from '@/lib/useOddsWebSocket';
import { useLanguage } from '@/lib/LanguageContext';

export default function BetSlip() {
  const { t } = useLanguage();
  const { selections, totalOdds, stake, slippage, loading, maxBet, maxBetError, maxBetLoading, fetchSlip, removeSelection, clearSlip, setStake, setSlippage, placeBet, updateSelectionOdds, fetchMaxBet } = useSlipStore();
  const { wallet } = useWalletStore();
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [refreshingOdds, setRefreshingOdds] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Get condition IDs from slip selections for WebSocket subscription
  const slipConditionIds = useMemo(() => {
    return selections.map(s => s.conditionId);
  }, [selections]);

  // Subscribe to live odds for slip selections via WebSocket
  const { getOdds: getLiveOdds } = useOddsWebSocket(slipConditionIds);

  // Sync slip odds with live WebSocket data
  useEffect(() => {
    if (selections.length === 0) return;

    // Check each selection against live WebSocket odds
    for (const selection of selections) {
      const liveOddsData = getLiveOdds(selection.conditionId, selection.outcomeId);
      if (liveOddsData?.odds && Math.abs(liveOddsData.odds - selection.odds) > 0.01) {
        // Update selection with live odds
        updateSelectionOdds(selection.conditionId, selection.outcomeId, liveOddsData.odds);
      }
    }
  }, [selections, getLiveOdds, updateSelectionOdds]);

  // Fetch max bet when selections change
  useEffect(() => {
    if (selections.length > 0) {
      fetchMaxBet();
    }
  }, [selections, fetchMaxBet]);

  // Initial fetch and auto-refresh every 10 seconds when there are selections
  useEffect(() => {
    fetchSlip();

    // Auto-refresh odds every 10 seconds if there are selections (backup for WebSocket)
    const interval = setInterval(() => {
      if (selections.length > 0 && !showConfirmation && !loading) {
        fetchSlip();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchSlip, selections.length, showConfirmation, loading]);

  const potentialPayout = stake && parseFloat(stake) > 0
    ? (parseFloat(stake) * totalOdds).toFixed(2)
    : '0.00';

  const handleOpenConfirmation = async () => {
    if (!wallet) {
      setMessage({ type: 'error', text: 'Please connect your wallet first' });
      return;
    }
    if (!stake || parseFloat(stake) <= 0) {
      setMessage({ type: 'error', text: 'Please enter a valid stake amount' });
      setTimeout(() => setMessage(null), 3000);
      return;
    }
    // Check if stake exceeds max bet
    if (maxBet && parseFloat(stake) > parseFloat(maxBet)) {
      setMessage({ type: 'error', text: `Stake exceeds max bet (${maxBet} ${wallet?.tokenSymbol || 'USDT'}). Transaction will fail.` });
      setTimeout(() => setMessage(null), 5000);
      return;
    }
    // Auto-refresh odds before showing confirmation
    setRefreshingOdds(true);
    await fetchSlip();
    setRefreshingOdds(false);
    setShowConfirmation(true);
  };

  const handleRefreshOdds = useCallback(async () => {
    setRefreshingOdds(true);
    await fetchSlip();
    setRefreshingOdds(false);
  }, [fetchSlip]);

  const handleConfirmBet = async () => {
    setShowConfirmation(false);
    const result = await placeBet();
    setMessage({
      type: result.success ? 'success' : 'error',
      text: result.message,
    });
    setTimeout(() => setMessage(null), 5000);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="section-header flex items-center justify-between">
        <span>{t.betting.betSlip} ({selections.length})</span>
        <div className="flex items-center gap-3">
          {selections.length > 0 && (
            <>
              <button
                className="text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground)] flex items-center gap-1"
                onClick={() => setShowSettings(!showSettings)}
                title="Slippage settings"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
                </svg>
                {slippage}%
              </button>
              <button
                className="text-xs text-[var(--foreground-muted)] hover:text-[var(--error)]"
                onClick={() => clearSlip()}
              >
                {t.betting.clearSlip}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Slippage Settings Dropdown */}
      {showSettings && selections.length > 0 && (
        <div className="slippage-dropdown">
          <div className="text-xs text-[var(--foreground-secondary)] mb-2">Slippage Tolerance</div>
          <div className="flex gap-2">
            {[3, 4, 5].map((val) => (
              <button
                key={val}
                onClick={() => { setSlippage(val); setShowSettings(false); }}
                className={`flex-1 py-1.5 text-xs mono border ${
                  slippage === val
                    ? 'bg-[var(--foreground)] text-white border-[var(--foreground)]'
                    : 'bg-transparent border-[var(--border-light)] text-[var(--foreground-secondary)] hover:border-[var(--foreground)]'
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {selections.length === 0 ? (
          <div className="empty">
            <p>{t.betting.emptySlip}</p>
            <p className="text-xs mt-2">{t.betting.addSelections}</p>
          </div>
        ) : (
          <div className={selections.length > 1 ? 'combo-slip-container' : ''}>
            {selections.length > 1 && (
              <div className="combo-header">
                <span className="combo-badge">COMBO</span>
                <span className="text-xs text-[var(--foreground-secondary)]">
                  {selections.length} selections
                </span>
              </div>
            )}
            {selections.map((selection, index) => (
              <div
                key={`${selection.conditionId}-${selection.outcomeId}`}
                className={`slip-selection ${selections.length > 1 ? 'combo-selection' : ''} ${index === selections.length - 1 ? 'last-selection' : ''}`}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[var(--foreground-secondary)] truncate">
                      {selection.gameTitle}
                    </div>
                    <div className="font-medium">{selection.outcomeName}</div>
                    {selection.marketName && (
                      <div className="text-xs text-[var(--foreground-muted)]">
                        {selection.marketName}
                      </div>
                    )}
                  </div>
                  <button
                    className="slip-remove ml-2"
                    onClick={() => removeSelection(selection.conditionId, selection.outcomeId)}
                  >
                    ×
                  </button>
                </div>
                <div className="mono text-right">{selection.odds.toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selections.length > 0 && (
        <div className="slip-total-compact">
          {/* Totals - inline */}
          <div className="flex justify-between text-xs mb-2">
            <span className="text-[var(--foreground-secondary)]">
              {selections.length > 1 ? t.betting.totalOdds : t.betting.odds}
            </span>
            <span className="mono">{totalOdds.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs mb-3">
            <span className="text-[var(--foreground-secondary)]">{t.betting.potentialWin}</span>
            <span className="mono font-medium">{potentialPayout}</span>
          </div>

          {/* Max bet display */}
          <div className="flex justify-between text-xs mb-2">
            <span className="text-[var(--foreground-muted)]">{t.betting.maxBet}</span>
            <span className="mono text-[var(--foreground-secondary)]">
              {maxBetLoading ? '...' : maxBet ? `${maxBet} ${wallet?.tokenSymbol || 'USDT'}` : maxBetError ? <span className="text-[var(--warning)]">{maxBetError}</span> : '—'}
            </span>
          </div>

          {/* Stake input - compact */}
          <div className="flex gap-2 items-center mb-3">
            <input
              type="number"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              className={`mono flex-1 text-sm ${maxBet && stake && parseFloat(stake) > parseFloat(maxBet) ? 'border-[var(--error)] text-[var(--error)]' : ''}`}
            />
            {maxBet && (
              <button
                onClick={() => setStake(maxBet)}
                className="px-2 py-1 text-xs bg-[var(--background-tertiary)] hover:bg-[var(--border)] border border-[var(--border-light)] text-[var(--foreground-secondary)]"
                title={`Set stake to max: ${maxBet}`}
              >
                MAX
              </button>
            )}
            <span className="text-xs text-[var(--foreground-secondary)] w-12">{wallet?.tokenSymbol || 'USDT'}</span>
          </div>
          {/* Warning when stake exceeds max */}
          {maxBet && stake && parseFloat(stake) > parseFloat(maxBet) && (
            <div className="text-xs text-[var(--error)] mb-2">
              Exceeds max bet - transaction will fail
            </div>
          )}

          {/* Message */}
          {message && (
            <div
              className={`mb-3 p-2 text-xs ${
                message.type === 'success'
                  ? 'bg-[var(--success)] text-white'
                  : 'bg-[var(--error)] text-white'
              }`}
            >
              {message.text}
            </div>
          )}

          {/* Place Bet button */}
          <button
            className="btn w-full"
            onClick={handleOpenConfirmation}
            disabled={loading || !stake || parseFloat(stake) <= 0 || !wallet}
          >
            {loading ? (
              <span className="spinner" />
            ) : wallet ? (
              t.betting.placeBet
            ) : (
              t.wallet.connect
            )}
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--background-secondary)] border border-[var(--border)] max-w-md w-full">
            <div className="section-header flex items-center justify-between">
              <span>{t.common.confirm}</span>
              <button
                onClick={() => setShowConfirmation(false)}
                className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              {/* Selections Summary */}
              <div className={`mb-4 ${selections.length > 1 ? 'combo-modal-container' : ''}`}>
                {selections.length > 1 && (
                  <div className="combo-modal-header">
                    <span className="combo-badge">COMBO BET</span>
                    <span className="text-xs">{selections.length} legs</span>
                  </div>
                )}
                <div>
                  {selections.map((selection, idx) => (
                    <div
                      key={`${selection.conditionId}-${selection.outcomeId}`}
                      className={`flex justify-between items-center py-3 px-3 ${idx < selections.length - 1 ? 'border-b border-[var(--border-light)]' : ''}`}
                    >
                      <div>
                        <div className="text-xs text-[var(--foreground-secondary)]">
                          {selection.gameTitle}
                        </div>
                        <div className="font-medium">{selection.outcomeName}</div>
                      </div>
                      <div className="mono font-medium">{selection.odds.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bet Details */}
              <div className="space-y-2 py-4 border-t border-[var(--border)]">
                <div className="flex justify-between">
                  <span className="text-[var(--foreground-secondary)]">{t.betting.stake}</span>
                  <span className="mono font-medium">{stake} {wallet?.tokenSymbol || 'USDT'}</span>
                </div>
                {selections.length > 1 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--foreground-secondary)]">{t.betting.totalOdds}</span>
                    <span className="mono">{totalOdds.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg pt-2">
                  <span className="text-[var(--foreground-secondary)]">{t.betting.potentialWin}</span>
                  <span className="mono font-bold text-[var(--success)]">{potentialPayout} {wallet?.tokenSymbol || 'USDT'}</span>
                </div>
              </div>

              {/* Warning */}
              <div className="text-xs text-[var(--foreground-muted)] py-3 border-t border-[var(--border)]">
                By confirming, you agree that odds may change before the transaction is confirmed on the blockchain. The bet will use a <span className="mono font-medium">{slippage}%</span> slippage tolerance.
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-3">
                <button
                  onClick={handleRefreshOdds}
                  disabled={refreshingOdds}
                  className="btn-secondary flex-1"
                >
                  {refreshingOdds ? (
                    <span className="spinner" />
                  ) : (
                    t.common.refresh
                  )}
                </button>
                <button
                  onClick={handleConfirmBet}
                  disabled={loading}
                  className="btn flex-1"
                >
                  {loading ? (
                    <span className="spinner" />
                  ) : (
                    t.common.confirm
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
