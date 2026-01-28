'use client';

import { useEffect, useState, useCallback } from 'react';
import { useHistoryStore } from '@/lib/store';
import { useLanguage } from '@/lib/LanguageContext';

interface CashoutInfo {
  betId: string;
  fullBetId?: string;  // Format: contractAddress_betId
  amount: string;
  cashoutAmount: string | null;
  type: 'single' | 'combo';
  selectionCount: number;
  conditionIds: string[];
  isAvailable: boolean;
  calculationId?: string;
  cashoutOdds?: string;
}

export default function History() {
  const { bets, stats, loading, fetchHistory } = useHistoryStore();
  const { t } = useLanguage();
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [cashingOut, setCashingOut] = useState<string | null>(null);
  const [redeemable, setRedeemable] = useState<{ betId: string; payout: string }[]>([]);
  const [cashouts, setCashouts] = useState<CashoutInfo[]>([]);

  // Fetch redeemable bets and cashout info
  useEffect(() => {
    // Fetch redeemable (won, not withdrawn)
    fetch('/api/withdraw')
      .then((res) => res.json())
      .then((data) => {
        console.log('[History] Redeemable bets:', data.redeemable);
        setRedeemable(data.redeemable || []);
      })
      .catch((err) => console.error('[History] Error fetching redeemable:', err));

    // Fetch cashout info for pending bets
    fetch('/api/cashout')
      .then((res) => res.json())
      .then((data) => {
        console.log('[History] Cashout info:', data.cashouts);
        setCashouts(data.cashouts || []);
      })
      .catch((err) => console.error('[History] Error fetching cashouts:', err));
  }, [bets]);

  const handleWithdraw = async (betId: string) => {
    setWithdrawing(betId);
    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betId }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Withdrawn! Payout: ${data.payout} USDT\nTx: ${data.polygonscan}`);
        fetchHistory();
      } else {
        alert(data.error || 'Withdrawal failed');
      }
    } catch {
      alert('Withdrawal failed');
    }
    setWithdrawing(null);
  };

  const isRedeemable = (betId: string) => redeemable.some((r) => r.betId === betId);

  // Get cashout info - match by betId OR by conditionId for pending bets
  const getCashoutInfo = useCallback((bet: { betId?: string | null; conditionId?: string }) => {
    // First try exact betId match
    if (bet.betId) {
      const byId = cashouts.find((c) => c.betId === bet.betId);
      if (byId) return byId;
    }
    // Fallback: match by conditionId (for pending bets without betId yet)
    if (bet.conditionId) {
      return cashouts.find((c) => c.conditionIds?.includes(bet.conditionId!));
    }
    return undefined;
  }, [cashouts]);

  const handleCashout = async (betId: string, fullBetId?: string) => {
    setCashingOut(betId);
    try {
      // Step 1: Get calculation (use fullBetId if available for Azuro API)
      const calcRes = await fetch('/api/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betId, fullBetId, action: 'calculate' }),
      });
      const calcData = await calcRes.json();

      if (calcData.error) {
        alert(`Cashout calculation failed: ${calcData.error}${calcData.reason ? `\n${calcData.reason}` : ''}`);
        setCashingOut(null);
        return;
      }

      // Confirm with user
      const confirmed = confirm(
        `Cashout amount: ${calcData.cashoutAmount} USDT\n\nProceed with cashout?`
      );

      if (!confirmed) {
        setCashingOut(null);
        return;
      }

      // Step 2: Execute cashout
      const execRes = await fetch('/api/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          betId,
          fullBetId: calcData.fullBetId || fullBetId,
          action: 'execute',
          calculationId: calcData.calculationId,
          cashoutOdds: calcData.cashoutOdds,
        }),
      });
      const execData = await execRes.json();

      if (execData.success) {
        alert(`Cashout successful! Order ID: ${execData.orderId}`);
        fetchHistory();
      } else {
        alert(`Cashout failed: ${execData.error}`);
      }
    } catch {
      alert('Cashout failed');
    }
    setCashingOut(null);
  };

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading && bets.length === 0) {
    return (
      <div className="p-6">
        <div className="spinner mx-auto" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl mb-6">{t.history.title}</h1>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--border-light)] border border-[var(--border-light)] mb-8">
        <div className="bg-white p-4">
          <div className="text-xs text-[var(--foreground-secondary)] uppercase tracking-wide mb-1">
            {t.history.totalBets}
          </div>
          <div className="mono text-lg">{stats.totalBets}</div>
        </div>
        <div className="bg-white p-4">
          <div className="text-xs text-[var(--foreground-secondary)] uppercase tracking-wide mb-1">
            {t.history.totalStaked}
          </div>
          <div className="mono text-lg">{stats.totalStaked.toFixed(2)}</div>
        </div>
        <div className="bg-white p-4">
          <div className="text-xs text-[var(--foreground-secondary)] uppercase tracking-wide mb-1">
            {t.history.winRate}
          </div>
          <div className="mono text-lg">{stats.winRate.toFixed(1)}%</div>
        </div>
        <div className="bg-white p-4">
          <div className="text-xs text-[var(--foreground-secondary)] uppercase tracking-wide mb-1">
            {t.history.netPL}
          </div>
          <div
            className={`mono text-lg ${
              stats.netPL > 0 ? 'pl-positive' : stats.netPL < 0 ? 'pl-negative' : ''
            }`}
          >
            {stats.netPL >= 0 ? '+' : ''}{stats.netPL.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-3 gap-px bg-[var(--border-light)] border border-[var(--border-light)] mb-8">
        <div className="bg-white p-4 text-center">
          <div className="text-2xl mono mb-1">{stats.wonCount}</div>
          <div className="text-xs text-[var(--foreground-secondary)] uppercase">{t.history.won}</div>
        </div>
        <div className="bg-white p-4 text-center">
          <div className="text-2xl mono mb-1">{stats.lostCount}</div>
          <div className="text-xs text-[var(--foreground-secondary)] uppercase">{t.history.lost}</div>
        </div>
        <div className="bg-white p-4 text-center">
          <div className="text-2xl mono mb-1">{stats.pendingCount}</div>
          <div className="text-xs text-[var(--foreground-secondary)] uppercase">{t.history.pending}</div>
        </div>
      </div>

      {/* Withdrawable Funds Alert */}
      {redeemable.length > 0 && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-green-800 font-medium">
                You have {redeemable.length} winning bet(s) to withdraw!
              </div>
              <div className="text-green-600 text-sm">
                Total: {redeemable.reduce((sum, r) => sum + parseFloat(r.payout || '0'), 0).toFixed(2)} USDT
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cashout Available Alert */}
      {cashouts.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-yellow-800 font-medium">
                {cashouts.length} bet(s) eligible for early cashout
              </div>
              <div className="text-yellow-600 text-sm">
                {cashouts.filter(c => c.type === 'combo').length > 0 && (
                  <span>Including {cashouts.filter(c => c.type === 'combo').length} combo bet(s). </span>
                )}
                Total available: ~{cashouts.reduce((sum, c) => sum + parseFloat(c.cashoutAmount || '0'), 0).toFixed(2)} USDT
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bets Table */}
      {bets.length === 0 ? (
        <div className="empty">{t.history.noBets}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead>
              <tr>
                <th className="whitespace-nowrap">{t.history.date}</th>
                <th className="min-w-[280px]">{t.history.game}</th>
                <th className="min-w-[150px]">{t.betting.selection}</th>
                <th className="numeric whitespace-nowrap">{t.betting.odds}</th>
                <th className="numeric whitespace-nowrap">{t.betting.stake}</th>
                <th className="numeric whitespace-nowrap">{t.history.payout}</th>
                <th className="whitespace-nowrap">{t.history.status}</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => (
                <tr key={bet.id} className="history-row">
                  <td className="whitespace-nowrap">
                    {new Date(bet.placedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="game-cell">{bet.gameTitle}</td>
                  <td>{bet.outcomeName}</td>
                  <td className="numeric">{bet.odds.toFixed(2)}</td>
                  <td className="numeric">{bet.amount.toFixed(2)}</td>
                  <td className="numeric">
                    {bet.result === 'won' && bet.payout ? (
                      <span className="pl-positive">+{bet.payout.toFixed(2)}</span>
                    ) : bet.result === 'lost' ? (
                      <span className="pl-negative">-{bet.amount.toFixed(2)}</span>
                    ) : (
                      <span className="text-[var(--foreground-muted)]">
                        {bet.potentialPayout.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(() => {
                        // Check if bet is likely awaiting settlement (accepted for > 3 hours)
                        const hoursOld = (Date.now() - new Date(bet.placedAt).getTime()) / (1000 * 60 * 60);
                        const isAwaitingSettlement = bet.status === 'accepted' && !bet.result && hoursOld > 3;

                        return (
                          <span
                            className={`badge ${
                              bet.result === 'won'
                                ? 'badge-won'
                                : bet.result === 'lost'
                                  ? 'badge-lost'
                                  : bet.status === 'rejected'
                                    ? 'badge-rejected'
                                    : isAwaitingSettlement
                                      ? 'badge-settling'
                                      : bet.status === 'accepted'
                                        ? 'badge-accepted'
                                        : 'badge-pending'
                            }`}
                            title={
                              isAwaitingSettlement
                                ? 'Game finished - awaiting Azuro oracle to settle results (this can take time)'
                                : bet.status === 'accepted' && !bet.result
                                  ? 'Bet accepted - game in progress'
                                  : undefined
                            }
                          >
                            {bet.result === 'won' ? t.history.won : bet.result === 'lost' ? t.history.lost : (isAwaitingSettlement ? t.history.settling : bet.status === 'accepted' ? t.history.accepted : bet.status)}
                          </span>
                        );
                      })()}
                      {/* Withdraw button for won bets */}
                      {bet.result === 'won' && bet.betId && isRedeemable(bet.betId) && (
                        <button
                          onClick={() => handleWithdraw(bet.betId!)}
                          disabled={withdrawing === bet.betId}
                          className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                        >
                          {withdrawing === bet.betId ? '...' : t.history.withdraw}
                        </button>
                      )}
                      {/* Show "Withdrawn" label if won but not redeemable */}
                      {bet.result === 'won' && bet.betId && !isRedeemable(bet.betId) && (
                        <span className="text-xs text-[var(--foreground-muted)]">{t.history.withdrawn}</span>
                      )}
                      {/* Cashout button for pending/accepted bets */}
                      {(() => {
                        // Check if bet is eligible for cashout
                        if (bet.result || (bet.status !== 'pending' && bet.status !== 'accepted')) return null;
                        if (!bet.betId) return null; // Need betId for cashout

                        const cashoutInfo = getCashoutInfo({ betId: bet.betId, conditionId: bet.conditionId });

                        // Show button for any accepted bet, even if cashout not currently available
                        const isAvailable = cashoutInfo?.isAvailable || false;
                        const cashoutBetId = bet.betId;
                        const fullBetId = cashoutInfo?.fullBetId;
                        const displayAmount = cashoutInfo?.cashoutAmount
                          ? parseFloat(cashoutInfo.cashoutAmount).toFixed(2)
                          : 'N/A';
                        const isCombo = cashoutInfo?.type === 'combo';

                        return (
                          <button
                            onClick={() => isAvailable && handleCashout(cashoutBetId, fullBetId)}
                            disabled={!isAvailable || cashingOut === cashoutBetId}
                            className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                              isAvailable
                                ? 'bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}
                            title={
                              !isAvailable
                                ? 'Cashout temporarily unavailable (live game in progress or market paused)'
                                : isCombo
                                  ? `Combo cashout (${cashoutInfo?.selectionCount} legs)`
                                  : 'Cashout this bet'
                            }
                          >
                            {cashingOut === cashoutBetId ? '...' : isAvailable ? `💰 ${displayAmount}` : '💰 --'}
                          </button>
                        );
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Refresh button */}
      <div className="mt-6">
        <button className="btn-text" onClick={() => fetchHistory()}>
          {t.common.refresh}
        </button>
      </div>
    </div>
  );
}
