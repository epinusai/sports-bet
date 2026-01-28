'use client';

import { useEffect, useState, useCallback } from 'react';
import { useHistoryStore, useWalletStore } from '@/lib/store';
import { useLanguage } from '@/lib/LanguageContext';

interface CashoutInfo {
  betId: string;
  fullBetId?: string;
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
  const { wallet } = useWalletStore();
  const { t } = useLanguage();
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [cashingOut, setCashingOut] = useState<string | null>(null);
  const [redeemable, setRedeemable] = useState<{ betId: string; payout: string }[]>([]);
  const [cashouts, setCashouts] = useState<CashoutInfo[]>([]);

  // Fetch redeemable bets and cashout info
  useEffect(() => {
    if (!wallet?.address) return;

    const privateKey = useWalletStore.getState().getPrivateKey();
    if (!privateKey) return;

    // Fetch redeemable (won, not withdrawn)
    fetch('/api/withdraw', {
      method: 'GET',
      headers: { 'x-wallet-address': wallet.address },
    })
      .then((res) => res.json())
      .then((data) => {
        console.log('[History] Redeemable bets:', data.redeemable);
        setRedeemable(data.redeemable || []);
      })
      .catch((err) => console.error('[History] Error fetching redeemable:', err));

    // Fetch cashout info for pending bets
    fetch('/api/cashout', {
      headers: { 'x-wallet-address': wallet.address },
    })
      .then((res) => res.json())
      .then((data) => {
        console.log('[History] Cashout info:', data.cashouts);
        setCashouts(data.cashouts || []);
      })
      .catch((err) => console.error('[History] Error fetching cashouts:', err));
  }, [bets, wallet?.address]);

  const handleWithdraw = async (betId: string) => {
    const privateKey = useWalletStore.getState().getPrivateKey();
    if (!privateKey) {
      alert('Wallet not connected');
      return;
    }

    setWithdrawing(betId);
    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betId, privateKey }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Withdrawn! Payout: ${data.payout} USDT\nTx: ${data.polygonscan}`);
        fetchHistory();
        useWalletStore.getState().refreshBalance();
      } else {
        alert(data.error || 'Withdrawal failed');
      }
    } catch {
      alert('Withdrawal failed');
    }
    setWithdrawing(null);
  };

  const isRedeemable = (betId: string) => redeemable.some((r) => r.betId === betId);

  const getCashoutInfo = useCallback((bet: { betId?: string; selections?: Array<{ conditionId: string }> }) => {
    if (bet.betId) {
      const byId = cashouts.find((c) => c.betId === bet.betId);
      if (byId) return byId;
    }
    if (bet.selections && bet.selections.length > 0) {
      return cashouts.find((c) => c.conditionIds?.includes(bet.selections![0].conditionId));
    }
    return undefined;
  }, [cashouts]);

  const handleCashout = async (betId: string, fullBetId?: string) => {
    const privateKey = useWalletStore.getState().getPrivateKey();
    if (!privateKey) {
      alert('Wallet not connected');
      return;
    }

    setCashingOut(betId);
    try {
      // Step 1: Get calculation
      const calcRes = await fetch('/api/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betId, fullBetId, action: 'calculate', privateKey }),
      });
      const calcData = await calcRes.json();

      if (calcData.error) {
        alert(`Cashout calculation failed: ${calcData.error}${calcData.reason ? `\n${calcData.reason}` : ''}`);
        setCashingOut(null);
        return;
      }

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
          privateKey,
        }),
      });
      const execData = await execRes.json();

      if (execData.success) {
        alert(`Cashout successful! Order ID: ${execData.orderId}`);
        fetchHistory();
        useWalletStore.getState().refreshBalance();
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

  if (!wallet) {
    return (
      <div className="p-6">
        <h1 className="text-xl mb-6">{t.history.title}</h1>
        <div className="empty">Connect wallet to view betting history</div>
      </div>
    );
  }

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
                <th className="min-w-[150px]">Type</th>
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
                    {new Date(bet.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td>
                    {bet.isCombo ? (
                      <span className="badge badge-combo">COMBO ({bet.selections.length})</span>
                    ) : (
                      <span className="text-[var(--foreground-secondary)]">Single</span>
                    )}
                  </td>
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
                        const hoursOld = (Date.now() - new Date(bet.createdAt).getTime()) / (1000 * 60 * 60);
                        const isAwaitingSettlement = bet.status === 'accepted' && !bet.result && hoursOld > 3;

                        return (
                          <span
                            className={`badge ${
                              bet.result === 'won'
                                ? 'badge-won'
                                : bet.result === 'lost'
                                  ? 'badge-lost'
                                  : isAwaitingSettlement
                                    ? 'badge-settling'
                                    : bet.status === 'accepted'
                                      ? 'badge-accepted'
                                      : 'badge-pending'
                            }`}
                          >
                            {bet.result === 'won' ? t.history.won : bet.result === 'lost' ? t.history.lost : (isAwaitingSettlement ? t.history.settling : bet.status === 'accepted' ? t.history.accepted : bet.status)}
                          </span>
                        );
                      })()}
                      {/* Withdraw button for won bets */}
                      {bet.result === 'won' && bet.betId && isRedeemable(bet.betId) && (
                        <button
                          onClick={() => handleWithdraw(bet.betId)}
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
                        if (bet.result || bet.status !== 'accepted') return null;
                        if (!bet.betId) return null;

                        const cashoutInfo = getCashoutInfo({ betId: bet.betId, selections: bet.selections });

                        const isAvailable = cashoutInfo?.isAvailable || false;
                        const cashoutBetId = bet.betId;
                        const fullBetId = cashoutInfo?.fullBetId;
                        const displayAmount = cashoutInfo?.cashoutAmount
                          ? parseFloat(cashoutInfo.cashoutAmount).toFixed(2)
                          : 'N/A';

                        return (
                          <button
                            onClick={() => isAvailable && handleCashout(cashoutBetId, fullBetId)}
                            disabled={!isAvailable || cashingOut === cashoutBetId}
                            className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                              isAvailable
                                ? 'bg-yellow-600 text-white hover:bg-yellow-700 disabled:opacity-50'
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}
                          >
                            {cashingOut === cashoutBetId ? '...' : isAvailable ? `💰 ${displayAmount}` : '💰 --'}
                          </button>
                        );
                      })()}
                      {/* Transaction link */}
                      {bet.txHash && (
                        <a
                          href={`https://polygonscan.com/tx/${bet.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Tx
                        </a>
                      )}
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
