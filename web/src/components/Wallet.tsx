'use client';

import { useEffect, useState } from 'react';
import { useWalletStore } from '@/lib/store';

export default function Wallet() {
  const { wallet, loading, error, fetchWallet, connectWallet, disconnectWallet } = useWalletStore();
  const [showModal, setShowModal] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  const handleConnect = async () => {
    if (!privateKey.trim()) {
      setConnectError('Please enter a private key');
      return;
    }

    setConnectError(null);
    await connectWallet(privateKey);

    if (!error) {
      setShowModal(false);
      setPrivateKey('');
    } else {
      setConnectError(error);
    }
  };

  const handleDisconnect = async () => {
    await disconnectWallet();
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (wallet?.connected) {
    return (
      <div className="wallet-display">
        <div className="flex-1 min-w-0">
          <div className="wallet-address">{formatAddress(wallet.address)}</div>
          <div className="wallet-balance">
            {parseFloat(wallet.usdtBalance).toFixed(2)} {wallet.tokenSymbol}
          </div>
        </div>
        <button
          className="btn-text text-xs"
          onClick={handleDisconnect}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="p-4 border-b border-[var(--border-light)]">
        <button
          className="btn w-full"
          onClick={() => setShowModal(true)}
          disabled={loading}
        >
          {loading ? <span className="spinner" /> : 'Connect Wallet'}
        </button>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg">Connect Wallet</h2>
              <button
                className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                onClick={() => {
                  setShowModal(false);
                  setPrivateKey('');
                  setConnectError(null);
                }}
              >
                ×
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-[var(--foreground-secondary)] mb-2 uppercase tracking-wide">
                Private Key
              </label>
              <input
                type="password"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="0x..."
                className="mono"
              />
              <p className="text-xs text-[var(--foreground-muted)] mt-2">
                Your private key is stored locally and never sent to any server.
              </p>
            </div>

            {connectError && (
              <div className="mb-4 p-3 bg-[var(--error)] text-white text-xs">
                {connectError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                className="btn flex-1"
                onClick={handleConnect}
                disabled={loading}
              >
                {loading ? <span className="spinner" /> : 'Connect'}
              </button>
              <button
                className="btn-text"
                onClick={() => {
                  setShowModal(false);
                  setPrivateKey('');
                  setConnectError(null);
                }}
              >
                Cancel
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-[var(--border-light)]">
              <p className="text-xs text-[var(--foreground-secondary)] mb-3">
                Network: Polygon (USDT)
              </p>
              <p className="text-xs text-[var(--foreground-muted)]">
                Make sure your wallet has MATIC for gas fees and USDT for betting.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
