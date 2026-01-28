'use client';

import { create } from 'zustand';
import { Sport, Game, WalletInfo, BetSlipSelection, OddsUpdate, LiveGameData } from './types';
import { ethers } from 'ethers';

// Constants
const POLYGON_RPC = 'https://polygon-rpc.com';
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const USDT_ABI = ['function balanceOf(address) view returns (uint256)'];

// Sports store
interface SportsState {
  sports: Sport[];
  selectedSport: string | null;
  loading: boolean;
  error: string | null;
  fetchSports: () => Promise<void>;
  selectSport: (slug: string | null) => void;
}

export const useSportsStore = create<SportsState>((set) => ({
  sports: [],
  selectedSport: null,
  loading: false,
  error: null,

  fetchSports: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/sports');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ sports: data.sports || [], loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch sports', loading: false });
    }
  },

  selectSport: (slug) => set({ selectedSport: slug }),
}));

// Games store
interface GamesState {
  games: Game[];
  selectedGame: Game | null;
  gameType: 'upcoming' | 'live';
  loading: boolean;
  error: string | null;
  fetchGames: (sportSlug?: string, type?: 'upcoming' | 'live') => Promise<void>;
  selectGame: (game: Game | null) => void;
  setGameType: (type: 'upcoming' | 'live') => void;
  fetchGame: (gameId: string) => Promise<void>;
}

export const useGamesStore = create<GamesState>((set) => ({
  games: [],
  selectedGame: null,
  gameType: 'upcoming',
  loading: false,
  error: null,

  fetchGames: async (sportSlug, type = 'upcoming') => {
    set({ loading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (sportSlug) params.set('sport', sportSlug);
      params.set('type', type);

      const res = await fetch(`/api/games?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ games: data.games || [], loading: false, gameType: type });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch games', loading: false, games: [] });
    }
  },

  selectGame: (game) => set({ selectedGame: game }),

  setGameType: (type) => set({ gameType: type }),

  fetchGame: async (gameId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/game/${gameId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ selectedGame: data.game, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch game', loading: false });
    }
  },
}));

// Wallet store - CLIENT-SIDE ONLY (localStorage)
interface WalletState {
  wallet: WalletInfo | null;
  loading: boolean;
  error: string | null;
  fetchWallet: () => Promise<void>;
  connectWallet: (privateKey: string) => Promise<void>;
  disconnectWallet: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  getPrivateKey: () => string | null;
}

const WALLET_STORAGE_KEY = 'sports_bet_wallet';

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  loading: false,
  error: null,

  // Load wallet from localStorage
  fetchWallet: async () => {
    set({ loading: true, error: null });
    try {
      // Check localStorage for saved wallet
      const stored = typeof window !== 'undefined' ? localStorage.getItem(WALLET_STORAGE_KEY) : null;

      if (!stored) {
        set({ wallet: null, loading: false });
        return;
      }

      const { privateKey } = JSON.parse(stored);
      if (!privateKey) {
        set({ wallet: null, loading: false });
        return;
      }

      // Derive address and fetch balance
      const ethersWallet = new ethers.Wallet(privateKey);
      const address = ethersWallet.address;

      // Fetch USDT balance
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const balance = await usdtContract.balanceOf(address);
      const usdtBalance = ethers.formatUnits(balance, 6);

      set({
        wallet: {
          connected: true,
          address,
          usdtBalance,
          chain: 'polygon',
          tokenSymbol: 'USDT',
        },
        loading: false,
      });
    } catch (error) {
      console.error('[Wallet] Error loading wallet:', error);
      set({ error: error instanceof Error ? error.message : 'Failed to load wallet', loading: false });
    }
  },

  // Connect wallet - store in localStorage only
  connectWallet: async (privateKey) => {
    set({ loading: true, error: null });
    try {
      // Validate and derive address
      let cleanKey = privateKey.trim();
      if (!cleanKey.startsWith('0x')) {
        cleanKey = '0x' + cleanKey;
      }

      const ethersWallet = new ethers.Wallet(cleanKey);
      const address = ethersWallet.address;

      // Fetch USDT balance
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const balance = await usdtContract.balanceOf(address);
      const usdtBalance = ethers.formatUnits(balance, 6);

      // Store in localStorage (client-side only)
      if (typeof window !== 'undefined') {
        localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ privateKey: cleanKey }));
      }

      set({
        wallet: {
          connected: true,
          address,
          usdtBalance,
          chain: 'polygon',
          tokenSymbol: 'USDT',
        },
        loading: false,
      });
    } catch (error) {
      console.error('[Wallet] Error connecting:', error);
      set({ error: error instanceof Error ? error.message : 'Invalid private key', loading: false });
    }
  },

  // Disconnect - remove from localStorage
  disconnectWallet: async () => {
    set({ loading: true, error: null });
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(WALLET_STORAGE_KEY);
      }
      set({ wallet: null, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to disconnect', loading: false });
    }
  },

  // Refresh balance only
  refreshBalance: async () => {
    const { wallet } = get();
    if (!wallet?.connected) return;

    try {
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const balance = await usdtContract.balanceOf(wallet.address);
      const usdtBalance = ethers.formatUnits(balance, 6);

      set({
        wallet: {
          ...wallet,
          usdtBalance,
        },
      });
    } catch (error) {
      console.error('[Wallet] Error refreshing balance:', error);
    }
  },

  // Get private key for signing (used by bet placement)
  getPrivateKey: () => {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!stored) return null;
    try {
      const { privateKey } = JSON.parse(stored);
      return privateKey || null;
    } catch {
      return null;
    }
  },
}));

// Bet slip store
interface SlipState {
  selections: BetSlipSelection[];
  totalOdds: number;
  stake: string;
  slippage: number;
  loading: boolean;
  error: string | null;
  maxBet: string | null;
  maxBetError: string | null;
  maxBetLoading: boolean;
  fetchSlip: () => Promise<void>;
  addSelection: (selection: Omit<BetSlipSelection, 'id'>) => Promise<void>;
  removeSelection: (conditionId: string, outcomeId: string) => Promise<void>;
  clearSlip: () => Promise<void>;
  setStake: (stake: string) => void;
  setSlippage: (slippage: number) => void;
  placeBet: () => Promise<{ success: boolean; message: string }>;
  updateSelectionOdds: (conditionId: string, outcomeId: string, newOdds: number) => void;
  fetchMaxBet: () => Promise<void>;
}

export const useSlipStore = create<SlipState>((set, get) => ({
  selections: [],
  totalOdds: 0,
  stake: '',
  slippage: 10,
  loading: false,
  error: null,
  maxBet: null,
  maxBetError: null,
  maxBetLoading: false,

  fetchSlip: async () => {
    try {
      // Use PATCH to refresh odds from API
      const res = await fetch('/api/slip', { method: 'PATCH' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ selections: data.selections, totalOdds: data.totalOdds });
      if (data.updatedCount > 0) {
        console.log('[Slip] Refreshed', data.updatedCount, 'odds from API');
      }
    } catch (error) {
      // Fallback to GET if PATCH fails
      try {
        const res = await fetch('/api/slip');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        set({ selections: data.selections, totalOdds: data.totalOdds });
      } catch {
        set({ error: error instanceof Error ? error.message : 'Failed to fetch slip' });
      }
    }
  },

  addSelection: async (selection) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selection),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ selections: data.selections, totalOdds: data.totalOdds, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to add selection', loading: false });
    }
  },

  removeSelection: async (conditionId, outcomeId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/slip?conditionId=${conditionId}&outcomeId=${outcomeId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ selections: data.selections, totalOdds: data.totalOdds, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to remove selection', loading: false });
    }
  },

  clearSlip: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/slip?clearAll=true', { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ selections: [], totalOdds: 0, stake: '', maxBet: null, maxBetError: null, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to clear slip', loading: false });
    }
  },

  setStake: (stake) => set({ stake }),

  setSlippage: (slippage) => set({ slippage }),

  placeBet: async () => {
    const { stake, selections, slippage } = get();
    if (!stake || parseFloat(stake) <= 0) {
      return { success: false, message: 'Invalid stake amount' };
    }
    if (selections.length === 0) {
      return { success: false, message: 'Bet slip is empty' };
    }

    // Get private key from localStorage
    const privateKey = useWalletStore.getState().getPrivateKey();
    if (!privateKey) {
      return { success: false, message: 'Wallet not connected' };
    }

    set({ loading: true, error: null });
    try {
      // Create abort controller for timeout (2 minutes for blockchain tx)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      console.log('[PlaceBet] Starting bet placement with slippage:', slippage);
      const res = await fetch('/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: stake, slippage, privateKey }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log('[PlaceBet] Response received:', res.status);

      const data = await res.json();
      console.log('[PlaceBet] Response data:', data);

      if (data.error) throw new Error(data.error);

      // Clear slip on success
      if (data.success) {
        set({ selections: [], totalOdds: 0, stake: '', loading: false });
        // Refresh wallet balance
        useWalletStore.getState().refreshBalance();
      } else {
        set({ loading: false });
      }

      return { success: data.success, message: data.message };
    } catch (error) {
      let message = 'Failed to place bet';
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          message = 'Request timed out. The transaction may still be processing - check your wallet.';
        } else {
          message = error.message;
        }
      }
      console.error('[PlaceBet] Error:', message);
      set({ error: message, loading: false });
      return { success: false, message };
    }
  },

  // Update odds for a selection locally (from WebSocket)
  updateSelectionOdds: (conditionId, outcomeId, newOdds) => {
    set((state) => {
      const updatedSelections = state.selections.map((s) => {
        if (s.conditionId === conditionId && s.outcomeId === outcomeId) {
          return { ...s, odds: newOdds };
        }
        return s;
      });
      const totalOdds = updatedSelections.reduce((acc, s) => acc * s.odds, 1);
      return {
        selections: updatedSelections,
        totalOdds: Math.round(totalOdds * 100) / 100,
      };
    });
  },

  // Fetch max bet from Azuro API
  fetchMaxBet: async () => {
    const { selections } = get();
    if (selections.length === 0) {
      set({ maxBet: null, maxBetError: null });
      return;
    }

    set({ maxBetLoading: true, maxBetError: null });
    try {
      const res = await fetch('/api/bet/max', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: selections.map(s => ({
            conditionId: s.conditionId,
            outcomeId: s.outcomeId,
          })),
        }),
      });

      const data = await res.json();
      if (data.error) {
        console.error('[MaxBet] Error:', data.error);
        // Show user-friendly error message
        let errorMsg = data.error;
        if (errorMsg.includes('duplicate games')) {
          errorMsg = 'Same game combo not allowed';
        } else if (errorMsg.includes('duplicate conditions')) {
          errorMsg = 'Duplicate selections';
        }
        set({ maxBet: null, maxBetError: errorMsg, maxBetLoading: false });
        return;
      }

      // Round max bet to 2 decimal places
      const maxBet = parseFloat(data.maxBet).toFixed(2);
      console.log('[MaxBet] Fetched max bet:', maxBet);
      set({ maxBet, maxBetError: null, maxBetLoading: false });
    } catch (error) {
      console.error('[MaxBet] Fetch error:', error);
      set({ maxBet: null, maxBetError: 'Failed to fetch', maxBetLoading: false });
    }
  },
}));

// Live odds store
interface OddsState {
  odds: Map<string, Map<string, { odds: number; direction: 'up' | 'down' | 'same' }>>;
  connected: boolean;
  updateOdds: (updates: OddsUpdate[]) => void;
  setConnected: (connected: boolean) => void;
  getOdds: (conditionId: string, outcomeId: string) => { odds: number; direction: 'up' | 'down' | 'same' } | null;
}

export const useOddsStore = create<OddsState>((set, get) => ({
  odds: new Map(),
  connected: false,

  updateOdds: (updates) => {
    set((state) => {
      const newOdds = new Map(state.odds);
      for (const update of updates) {
        if (!newOdds.has(update.conditionId)) {
          newOdds.set(update.conditionId, new Map());
        }
        newOdds.get(update.conditionId)!.set(update.outcomeId, {
          odds: update.newOdds,
          direction: update.direction,
        });
      }
      return { odds: newOdds };
    });
  },

  setConnected: (connected) => set({ connected }),

  getOdds: (conditionId, outcomeId) => {
    const state = get();
    const conditionOdds = state.odds.get(conditionId);
    if (!conditionOdds) return null;
    return conditionOdds.get(outcomeId) || null;
  },
}));

// History store
interface HistoryState {
  bets: Array<{
    id: number;
    betId: string | null;
    txHash: string | null;
    gameId: string;
    gameTitle: string;
    conditionId: string;
    outcomeId: string;
    outcomeName: string;
    odds: number;
    amount: number;
    potentialPayout: number;
    status: string;
    result: string | null;
    payout: number | null;
    placedAt: string;
  }>;
  stats: {
    totalBets: number;
    totalStaked: number;
    totalWon: number;
    totalLost: number;
    netPL: number;
    pendingCount: number;
    wonCount: number;
    lostCount: number;
    winRate: number;
  };
  loading: boolean;
  error: string | null;
  fetchHistory: () => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  bets: [],
  stats: {
    totalBets: 0,
    totalStaked: 0,
    totalWon: 0,
    totalLost: 0,
    netPL: 0,
    pendingCount: 0,
    wonCount: 0,
    lostCount: 0,
    winRate: 0,
  },
  loading: false,
  error: null,

  fetchHistory: async () => {
    set({ loading: true, error: null });
    try {
      // Get wallet address from localStorage
      const wallet = useWalletStore.getState().wallet;
      if (!wallet?.address) {
        set({ bets: [], loading: false });
        return;
      }

      const res = await fetch(`/api/bets?address=${wallet.address}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      set({ bets: data.bets, stats: data.stats, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to fetch history', loading: false });
    }
  },
}));

// Live scores store
interface LiveScoresState {
  scores: Map<string, LiveGameData>;
  connected: boolean;
  updateScores: (updates: LiveGameData[]) => void;
  setConnected: (connected: boolean) => void;
  getScore: (gameId: string) => LiveGameData | null;
  clearScores: () => void;
}

export const useLiveScoresStore = create<LiveScoresState>((set, get) => ({
  scores: new Map(),
  connected: false,

  updateScores: (updates) => {
    set((state) => {
      const newScores = new Map(state.scores);
      for (const update of updates) {
        newScores.set(update.gameId, update);
      }
      return { scores: newScores };
    });
  },

  setConnected: (connected) => set({ connected }),

  getScore: (gameId) => {
    const state = get();
    return state.scores.get(gameId) || null;
  },

  clearScores: () => set({ scores: new Map() }),
}));
