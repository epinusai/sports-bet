// Bet Slip Management System
import fs from 'fs';
import path from 'path';
import os from 'os';

// Selection in the bet slip
export interface SlipSelection {
  id: string;  // Unique identifier
  conditionId: string;
  outcomeId: string;
  odds: number;
  selectionName: string;
  marketName: string;
  gameTitle: string;
  gameId: string;
  startsAt: string;
  addedAt: number;  // timestamp
}

// Bet slip state
export interface BetSlip {
  selections: SlipSelection[];
  stake: number;
  chain: string;
}

// Settings for auto-withdraw, etc.
export interface Settings {
  autoWithdraw: boolean;
  defaultStake: number;
  defaultSlippage: number;
}

// Bet history entry
export interface BetHistoryEntry {
  betId: string;
  txHash: string;
  timestamp: number;
  chain: string;
  selections: SlipSelection[];
  stake: number;
  totalOdds: number;
  potentialPayout: number;
  status: 'pending' | 'won' | 'lost' | 'claimed';
  payout?: number;
}

// The data file path
const DATA_DIR = path.join(os.homedir(), '.azuro-cli');
const SLIP_FILE = path.join(DATA_DIR, 'slip.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Default values
const DEFAULT_SLIP: BetSlip = {
  selections: [],
  stake: 1,
  chain: 'polygon',
};

const DEFAULT_SETTINGS: Settings = {
  autoWithdraw: false,
  defaultStake: 1,
  defaultSlippage: 5,
};

// === Bet Slip Functions ===

export function loadSlip(): BetSlip {
  ensureDataDir();
  try {
    if (fs.existsSync(SLIP_FILE)) {
      const data = fs.readFileSync(SLIP_FILE, 'utf-8');
      return { ...DEFAULT_SLIP, ...JSON.parse(data) };
    }
  } catch {
    // If file is corrupted, return default
  }
  return { ...DEFAULT_SLIP };
}

export function saveSlip(slip: BetSlip): void {
  ensureDataDir();
  fs.writeFileSync(SLIP_FILE, JSON.stringify(slip, null, 2));
}

export function addToSlip(selection: Omit<SlipSelection, 'id' | 'addedAt'>): SlipSelection {
  const slip = loadSlip();

  // Check if already in slip (same condition and outcome)
  const existing = slip.selections.find(
    s => s.conditionId === selection.conditionId && s.outcomeId === selection.outcomeId
  );

  if (existing) {
    throw new Error('This selection is already in your slip');
  }

  // Check for conflicting selection from same game/market
  const conflict = slip.selections.find(
    s => s.conditionId === selection.conditionId
  );

  if (conflict) {
    throw new Error('You already have a selection from this market. Remove it first.');
  }

  const newSelection: SlipSelection = {
    ...selection,
    id: `${selection.conditionId}-${selection.outcomeId}-${Date.now()}`,
    addedAt: Date.now(),
  };

  slip.selections.push(newSelection);
  saveSlip(slip);

  return newSelection;
}

export function removeFromSlip(selectionId: string): void {
  const slip = loadSlip();
  slip.selections = slip.selections.filter(s => s.id !== selectionId);
  saveSlip(slip);
}

export function clearSlip(): void {
  saveSlip(DEFAULT_SLIP);
}

export function getSlipSummary(): {
  selections: SlipSelection[];
  totalOdds: number;
  potentialPayout: number;
  stake: number;
  isSingle: boolean;
  isCombo: boolean;
} {
  const slip = loadSlip();
  const selections = slip.selections;

  // Calculate combined odds (multiply for parlay/accumulator)
  const totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  const stake = slip.stake;
  const potentialPayout = stake * totalOdds;

  return {
    selections,
    totalOdds,
    potentialPayout,
    stake,
    isSingle: selections.length === 1,
    isCombo: selections.length > 1,
  };
}

export function setSlipStake(stake: number): void {
  const slip = loadSlip();
  slip.stake = stake;
  saveSlip(slip);
}

export function setSlipChain(chain: string): void {
  const slip = loadSlip();
  slip.chain = chain;
  saveSlip(slip);
}

// === Settings Functions ===

export function loadSettings(): Settings {
  ensureDataDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch {
    // If file is corrupted, return default
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export function setAutoWithdraw(enabled: boolean): void {
  const settings = loadSettings();
  settings.autoWithdraw = enabled;
  saveSettings(settings);
}

export function getAutoWithdraw(): boolean {
  return loadSettings().autoWithdraw;
}

// === History Functions ===

export function loadHistory(): BetHistoryEntry[] {
  ensureDataDir();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // If file is corrupted, return empty
  }
  return [];
}

export function saveHistory(history: BetHistoryEntry[]): void {
  ensureDataDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

export function addBetToHistory(bet: Omit<BetHistoryEntry, 'timestamp'>): void {
  const history = loadHistory();
  history.unshift({
    ...bet,
    timestamp: Date.now(),
  });

  // Keep only last 100 bets
  if (history.length > 100) {
    history.pop();
  }

  saveHistory(history);
}

export function updateBetStatus(
  betId: string,
  status: 'won' | 'lost' | 'claimed',
  payout?: number
): void {
  const history = loadHistory();
  const bet = history.find(b => b.betId === betId);

  if (bet) {
    bet.status = status;
    if (payout !== undefined) {
      bet.payout = payout;
    }
    saveHistory(history);
  }
}

export function getProfitLoss(): {
  totalStaked: number;
  totalWon: number;
  totalLost: number;
  netPL: number;
  winRate: number;
  pendingCount: number;
  wonCount: number;
  lostCount: number;
} {
  const history = loadHistory();

  let totalStaked = 0;
  let totalWon = 0;
  let wonCount = 0;
  let lostCount = 0;
  let pendingCount = 0;

  for (const bet of history) {
    totalStaked += bet.stake;

    if (bet.status === 'won' || bet.status === 'claimed') {
      totalWon += bet.payout || bet.potentialPayout;
      wonCount++;
    } else if (bet.status === 'lost') {
      lostCount++;
    } else if (bet.status === 'pending') {
      pendingCount++;
    }
  }

  const totalLost = lostCount > 0 ? history
    .filter(b => b.status === 'lost')
    .reduce((acc, b) => acc + b.stake, 0) : 0;

  const resolvedBets = wonCount + lostCount;
  const winRate = resolvedBets > 0 ? (wonCount / resolvedBets) * 100 : 0;

  return {
    totalStaked,
    totalWon,
    totalLost,
    netPL: totalWon - totalStaked,
    winRate,
    pendingCount,
    wonCount,
    lostCount,
  };
}
