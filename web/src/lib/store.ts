'use client';

import { create } from 'zustand';
import { Sport, Game, WalletInfo, OddsUpdate, LiveGameData } from './types';
import { ethers } from 'ethers';

// Constants
const POLYGON_RPC = 'https://polygon-rpc.com';
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const USDT_ABI = ['function balanceOf(address) view returns (uint256)'];
const AZURO_SUBGRAPH = 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3';

// LocalStorage keys
const WALLET_STORAGE_KEY = 'sports_bet_wallet';
const SLIP_STORAGE_KEY = 'sports_bet_slip';

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

export const useWalletStore = create<WalletState>((set, get) => ({
  wallet: null,
  loading: false,
  error: null,

  fetchWallet: async () => {
    set({ loading: true, error: null });
    try {
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

      const ethersWallet = new ethers.Wallet(privateKey);
      const address = ethersWallet.address;

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

  connectWallet: async (privateKey) => {
    set({ loading: true, error: null });
    try {
      let cleanKey = privateKey.trim();
      if (!cleanKey.startsWith('0x')) {
        cleanKey = '0x' + cleanKey;
      }

      const ethersWallet = new ethers.Wallet(cleanKey);
      const address = ethersWallet.address;

      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      const usdtContract = new ethers.Contract(USDT_ADDRESS, USDT_ABI, provider);
      const balance = await usdtContract.balanceOf(address);
      const usdtBalance = ethers.formatUnits(balance, 6);

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

// Bet slip store - CLIENT-SIDE ONLY (localStorage)
interface SlipSelection {
  id: string;
  gameId: string;
  gameTitle: string;
  conditionId: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  marketName?: string;
}

interface SlipState {
  selections: SlipSelection[];
  totalOdds: number;
  stake: string;
  slippage: number;
  loading: boolean;
  error: string | null;
  maxBet: string | null;
  maxBetError: string | null;
  maxBetLoading: boolean;
  fetchSlip: () => void;
  addSelection: (selection: Omit<SlipSelection, 'id'>) => void;
  removeSelection: (conditionId: string, outcomeId: string) => void;
  clearSlip: () => void;
  setStake: (stake: string) => void;
  setSlippage: (slippage: number) => void;
  placeBet: () => Promise<{ success: boolean; message: string }>;
  updateSelectionOdds: (conditionId: string, outcomeId: string, newOdds: number) => void;
  fetchMaxBet: () => Promise<void>;
}

function loadSlipFromStorage(): SlipSelection[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SLIP_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveSlipToStorage(selections: SlipSelection[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SLIP_STORAGE_KEY, JSON.stringify(selections));
}

function calculateTotalOdds(selections: SlipSelection[]): number {
  if (selections.length === 0) return 0;
  return Math.round(selections.reduce((acc, s) => acc * s.odds, 1) * 100) / 100;
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

  fetchSlip: () => {
    const selections = loadSlipFromStorage();
    set({ selections, totalOdds: calculateTotalOdds(selections) });
  },

  addSelection: (selection) => {
    const { selections } = get();

    // Check if already exists
    const exists = selections.some(
      s => s.conditionId === selection.conditionId && s.outcomeId === selection.outcomeId
    );
    if (exists) return;

    // Check if same condition but different outcome (replace)
    const sameCondition = selections.find(s => s.conditionId === selection.conditionId);
    let newSelections: SlipSelection[];

    if (sameCondition) {
      // Replace the outcome for this condition
      newSelections = selections.map(s =>
        s.conditionId === selection.conditionId
          ? { ...selection, id: `${selection.conditionId}-${selection.outcomeId}` }
          : s
      );
    } else {
      // Add new selection
      newSelections = [
        ...selections,
        { ...selection, id: `${selection.conditionId}-${selection.outcomeId}` }
      ];
    }

    saveSlipToStorage(newSelections);
    set({ selections: newSelections, totalOdds: calculateTotalOdds(newSelections) });
  },

  removeSelection: (conditionId, outcomeId) => {
    const { selections } = get();
    const newSelections = selections.filter(
      s => !(s.conditionId === conditionId && s.outcomeId === outcomeId)
    );
    saveSlipToStorage(newSelections);
    set({ selections: newSelections, totalOdds: calculateTotalOdds(newSelections), maxBet: null, maxBetError: null });
  },

  clearSlip: () => {
    saveSlipToStorage([]);
    set({ selections: [], totalOdds: 0, stake: '', maxBet: null, maxBetError: null });
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

    const privateKey = useWalletStore.getState().getPrivateKey();
    if (!privateKey) {
      return { success: false, message: 'Wallet not connected' };
    }

    set({ loading: true, error: null });
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      console.log('[PlaceBet] Starting bet placement with slippage:', slippage);
      const res = await fetch('/api/bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: stake,
          slippage,
          privateKey,
          selections: selections.map(s => ({
            conditionId: s.conditionId,
            outcomeId: s.outcomeId,
            odds: s.odds,
            gameId: s.gameId,
            gameTitle: s.gameTitle,
            outcomeName: s.outcomeName,
            marketName: s.marketName,
          }))
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log('[PlaceBet] Response received:', res.status);

      const data = await res.json();
      console.log('[PlaceBet] Response data:', data);

      if (data.error) throw new Error(data.error);

      if (data.success) {
        // Clear slip on success
        saveSlipToStorage([]);
        set({ selections: [], totalOdds: 0, stake: '', loading: false });
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

  updateSelectionOdds: (conditionId, outcomeId, newOdds) => {
    const { selections } = get();
    const newSelections = selections.map(s => {
      if (s.conditionId === conditionId && s.outcomeId === outcomeId) {
        return { ...s, odds: newOdds };
      }
      return s;
    });
    saveSlipToStorage(newSelections);
    set({ selections: newSelections, totalOdds: calculateTotalOdds(newSelections) });
  },

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
        let errorMsg = data.error;
        if (errorMsg.includes('duplicate games')) {
          errorMsg = 'Same game combo not allowed';
        } else if (errorMsg.includes('duplicate conditions')) {
          errorMsg = 'Duplicate selections';
        }
        set({ maxBet: null, maxBetError: errorMsg, maxBetLoading: false });
        return;
      }

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

// History store - Fetches from Azuro subgraph by wallet address
interface HistoryBet {
  id: string;
  betId: string;
  txHash: string;
  amount: number;
  odds: number;
  potentialPayout: number;
  status: string;
  result: string | null;
  payout: number | null;
  createdAt: string;
  isCombo: boolean;
  selections: Array<{
    outcomeId: string;
    conditionId: string;
  }>;
}

interface HistoryState {
  bets: HistoryBet[];
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
      const wallet = useWalletStore.getState().wallet;
      if (!wallet?.address) {
        set({ bets: [], loading: false });
        return;
      }

      const addr = wallet.address.toLowerCase();

      // Query Azuro V3 subgraph for bets
      const query = `{
        v3Bets(
          first: 100,
          where: { actor: "${addr}" },
          orderBy: createdBlockTimestamp,
          orderDirection: desc
        ) {
          id
          betId
          amount
          odds
          status
          result
          payout
          potentialPayout
          createdTxHash
          createdBlockTimestamp
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

      const response = await fetch(AZURO_SUBGRAPH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'GraphQL error');
      }

      const azuroBets = data.data?.v3Bets || [];

      // Transform to our format
      const bets: HistoryBet[] = azuroBets.map((bet: {
        id: string;
        betId: string;
        amount: string;
        odds: string;
        status: string;
        result: string | null;
        payout: string | null;
        potentialPayout: string;
        createdTxHash: string;
        createdBlockTimestamp: string;
        selections: Array<{ outcome: { outcomeId: string; condition: { conditionId: string } } }>;
      }) => ({
        id: bet.id,
        betId: bet.betId,
        txHash: bet.createdTxHash,
        amount: parseFloat(bet.amount),
        odds: parseFloat(bet.odds),
        potentialPayout: parseFloat(bet.potentialPayout),
        status: bet.status.toLowerCase(),
        result: bet.result ? bet.result.toLowerCase() : null,
        payout: bet.payout ? parseFloat(bet.payout) : null,
        createdAt: new Date(parseInt(bet.createdBlockTimestamp) * 1000).toISOString(),
        isCombo: bet.selections.length > 1,
        selections: bet.selections.map((s: { outcome: { outcomeId: string; condition: { conditionId: string } } }) => ({
          outcomeId: s.outcome.outcomeId,
          conditionId: s.outcome.condition.conditionId,
        })),
      }));

      // Calculate stats
      let totalStaked = 0;
      let totalWon = 0;
      let totalLost = 0;
      let pendingCount = 0;
      let wonCount = 0;
      let lostCount = 0;

      for (const bet of bets) {
        totalStaked += bet.amount;
        if (bet.status === 'resolved') {
          if (bet.result === 'won') {
            wonCount++;
            totalWon += bet.payout || 0;
          } else if (bet.result === 'lost') {
            lostCount++;
            totalLost += bet.amount;
          }
        } else if (bet.status === 'accepted') {
          pendingCount++;
        }
      }

      const stats = {
        totalBets: bets.length,
        totalStaked,
        totalWon,
        totalLost,
        netPL: totalWon - totalLost,
        pendingCount,
        wonCount,
        lostCount,
        winRate: wonCount + lostCount > 0 ? (wonCount / (wonCount + lostCount)) * 100 : 0,
      };

      set({ bets, stats, loading: false });
    } catch (error) {
      console.error('[History] Error fetching:', error);
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
