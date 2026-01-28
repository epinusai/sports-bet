// Use Azuro dictionaries for outcome name resolution
import { getSelectionName as getSelectionNameRaw, getMarketName, dictionaries } from '@azuro-org/dictionaries';

// Get the point value for an outcome (e.g., "2.5" for Total Goals Over 2.5)
function getPointValue(outcomeId: string | number): string | null {
  try {
    const outcome = dictionaries.outcomes[String(outcomeId)];
    if (outcome?.pointsId) {
      const pointValue = dictionaries.points[String(outcome.pointsId)];
      return pointValue || null;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Sport type
export interface Sport {
  sportId: string;
  name: string;
  slug: string;
  games?: { id: string }[];
}

// Participant type
export interface Participant {
  name: string;
  image?: string;
}

// Outcome type
export interface Outcome {
  outcomeId: string;
  currentOdds: string;
  title?: string; // Full outcome title including parameters (e.g., "Over 2.5")
}

// Condition type
export interface Condition {
  conditionId: string;
  state: string; // Created, Active, Paused, Resolved, Canceled
  isPrematchEnabled: boolean;
  isLiveEnabled: boolean;
  outcomes: Outcome[];
}

// League type
export interface League {
  name: string;
  slug: string;
  country?: {
    name: string;
    slug: string;
  };
}

// Game type
export interface Game {
  id: string;
  gameId: string;
  slug: string;
  title: string;
  startsAt: string;
  status: string;
  sport: {
    sportId: string;
    name: string;
    slug: string;
  };
  league: League;
  participants: Participant[];
  conditions: Condition[];
  isSuspended?: boolean; // True if game is live but all betting markets are suspended
}

// Bet type from API
export interface ApiBet {
  id: string;
  betId: string;
  amount: string;
  odds: string;
  settledOdds: string;
  status: 'Accepted' | 'Resolved' | 'Canceled';
  result: 'Won' | 'Lost' | null;
  isRedeemed: boolean;
  payout: string;
  potentialPayout: string;
  createdAt: string;
  outcome: {
    outcomeId: string;
    condition: {
      conditionId: string;
      game: {
        title: string;
        gameId: string;
        participants: { name: string }[];
      };
    };
  };
}

// Wallet info type
export interface WalletInfo {
  address: string;
  usdtBalance: string;
  nativeBalance: string;
  nativeSymbol: string;
  tokenSymbol: string;
  chainName: string;
  chainId: number;
  connected: boolean;
}

// Bet slip selection
export interface BetSlipSelection {
  id?: number;
  gameId: string;
  gameTitle: string;
  conditionId: string;
  outcomeId: string;
  outcomeName: string;
  odds: number;
  marketName?: string;
}

// Live odds update
export interface OddsUpdate {
  conditionId: string;
  outcomeId: string;
  newOdds: number;
  previousOdds: number;
  direction: 'up' | 'down' | 'same';
}

// Live scores types
export interface ScoreBoard {
  s1: number; // Home score
  s2: number; // Away score
  ps?: Array<{ // Period scores
    s1: number;
    s2: number;
    n?: number; // Period number
  }>;
}

export interface LiveClock {
  p?: number; // Period
  m?: number; // Minutes
  s?: number; // Seconds
  t?: string; // Time string
}

export interface LiveStats {
  possession?: { h: number; a: number };
  shots?: { h: number; a: number };
  shotsOnTarget?: { h: number; a: number };
  corners?: { h: number; a: number };
  fouls?: { h: number; a: number };
  yellowCards?: { h: number; a: number };
  redCards?: { h: number; a: number };
}

export interface LiveGameData {
  gameId: string;
  scoreBoard?: ScoreBoard;
  clock?: LiveClock;
  stats?: LiveStats;
  updatedAt: number;
}

// Bet placement params
export interface PlaceBetParams {
  conditionId: string;
  outcomeId: string;
  amount: string;
  odds: string;
  slippage?: number;
}

// Chain config
export interface ChainConfig {
  id: number;
  name: string;
  rpc: string;
  token: {
    symbol: string;
    decimals: number;
    address: string;
  };
  contracts: {
    lp: string;
    core: string; // V3 unified core
    relayer?: string;
    azuroBet?: string;
    cashout?: string;
    // Legacy V2 (deprecated)
    prematchCore?: string;
    betExpress?: string;
    v2Lp?: string;
    v2Core?: string;
  };
  graphql: {
    dataFeed: string;
    client: string;
  };
  websocket: {
    url: string;
    environment: string;
  };
}

// Friendly name mappings for common betting selections (converts shorthand to full names)
const FRIENDLY_SELECTIONS: Record<string, string> = {
  '1': 'Home',
  '2': 'Away',
  'X': 'Draw',
  '1X': 'Home or Draw',
  '12': 'Home or Away',
  'X2': 'Draw or Away',
  '2X': 'Away or Draw',
  'Team 1': 'Home',
  'Team 2': 'Away',
  'H1': 'Home',
  'H2': 'Away',
  'HX': 'Draw',
};

export function getOutcomeName(outcomeId: string, participants?: Participant[], title?: string): string {
  // If title is provided (from API), use it - it includes parameters like "Over 2.5"
  if (title) {
    // Replace generic Home/Away with team names
    if (participants && participants.length >= 2) {
      if (title === 'Home' || title === 'W1' || title === 'Home Win') return participants[0].name;
      if (title === 'Away' || title === 'W2' || title === 'Away Win') return participants[1].name;
      if (title === '1X' || title === 'Home or Draw') return `${participants[0].name} or Draw`;
      if (title === 'X2' || title === 'Away or Draw' || title === 'Draw or Away') return `Draw or ${participants[1].name}`;
      if (title === '12' || title === 'Home or Away') return `${participants[0].name} or ${participants[1].name}`;
      if (title === 'X' || title === 'Draw') return 'Draw';
    }
    return title;
  }

  // Try to get the name from Azuro dictionaries with parameter value
  try {
    const rawName = getSelectionNameRaw({ outcomeId });
    if (rawName) {
      // Get the point value (e.g., 2.5 for Total Goals Over 2.5)
      const pointValue = getPointValue(outcomeId);

      // Build the full name with parameter if available
      let fullName = rawName;
      if (pointValue) {
        fullName = `${rawName} ${pointValue}`;
      }

      // Replace generic Home/Away with team names (for non-parameterized selections)
      if (participants && participants.length >= 2 && !pointValue) {
        if (rawName === 'Home' || rawName === 'W1' || rawName === 'Home Win' || rawName === '1') return participants[0].name;
        if (rawName === 'Away' || rawName === 'W2' || rawName === 'Away Win' || rawName === '2') return participants[1].name;
        if (rawName === '1X' || rawName === 'Home or Draw') return `${participants[0].name} or Draw`;
        if (rawName === 'X2' || rawName === 'Away or Draw' || rawName === 'Draw or Away') return `Draw or ${participants[1].name}`;
        if (rawName === '12' || rawName === 'Home or Away') return `${participants[0].name} or ${participants[1].name}`;
        if (rawName === 'X' || rawName === 'Draw') return 'Draw';
      }

      // Apply friendly name mapping if no parameters
      if (!pointValue) {
        return FRIENDLY_SELECTIONS[rawName] || rawName;
      }

      return fullName;
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: show outcome ID
  return `Outcome ${outcomeId}`;
}

// Market type detection using Azuro dictionaries
export function guessMarketType(conditionId: string, outcomes: Outcome[]): string {
  // Try to get market name from the first outcome using Azuro dictionaries
  if (outcomes.length > 0) {
    try {
      const marketName = getMarketName({ outcomeId: outcomes[0].outcomeId });
      if (marketName) {
        return marketName;
      }
    } catch {
      // Fall through to manual detection
    }
  }

  // Fallback: Manual detection based on known outcome IDs
  const outcomeIds = outcomes.map(o => o.outcomeId);

  // Full Time Result (1X2)
  if (outcomeIds.includes('29') && outcomeIds.includes('30') && outcomeIds.includes('31')) {
    return 'Full Time Result';
  }
  if (outcomeIds.includes('33') && outcomeIds.includes('34') && outcomeIds.includes('35')) {
    return 'Half Time Result';
  }

  // Both Teams to Score
  if (outcomeIds.includes('21') && outcomeIds.includes('22')) {
    return 'Both Teams to Score';
  }

  // Over/Under
  if (outcomeIds.includes('27') && outcomeIds.includes('28')) {
    return 'Over/Under';
  }
  if (outcomeIds.includes('6') && outcomeIds.includes('7')) {
    return 'Total Goals';
  }

  // Double Chance
  if (outcomeIds.includes('37') || outcomeIds.includes('38') || outcomeIds.includes('39')) {
    return 'Double Chance';
  }

  // Correct Score
  if (outcomeIds.some(id => parseInt(id) >= 44 && parseInt(id) <= 68)) {
    return 'Correct Score';
  }

  // Money Line (2-way)
  if (outcomeIds.includes('1') && outcomeIds.includes('2') && !outcomeIds.includes('3')) {
    return 'Winner';
  }

  return 'Market';
}
