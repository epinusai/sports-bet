import { GraphQLClient } from 'graphql-request';
import { getChainConfig, QUERIES, DEFAULT_CHAIN } from './config';
import { Sport, Game, ApiBet, Condition } from './types';

// Filter conditions based on betting type (prematch or live)
function filterActiveConditions(game: Game, isLive: boolean): Game {
  if (!game.conditions) return game;

  const filteredConditions = game.conditions.filter((condition: Condition) => {
    // Must be in Created or Active state
    const isActiveState = condition.state === 'Created' || condition.state === 'Active';
    if (!isActiveState) return false;

    // Check if betting type is enabled
    if (isLive) {
      return condition.isLiveEnabled;
    } else {
      return condition.isPrematchEnabled;
    }
  });

  return { ...game, conditions: filteredConditions };
}

// Filter games to only include those with active bettable conditions
// For live games, we keep ALL games but mark suspended ones
function filterGamesWithActiveConditions(games: Game[], isLive: boolean): Game[] {
  // For live games, filter out finished/canceled/resolved games
  // Valid live game states: "Live" - game is still in progress
  // Invalid states: "Resolved", "Canceled", "Finished" - game is over
  const filteredGames = isLive
    ? games.filter(game => {
        const gameState = (game as { state?: string }).state;
        const gameStatus = (game as { status?: string }).status;

        // Debug logging
        console.log(`[filterGamesWithActiveConditions] Game: ${game.title}, state: ${gameState}, status: ${gameStatus}`);

        // Keep only games with "Live" state - filter out any other state
        if (gameState && gameState !== 'Live') {
          console.log(`[filterGamesWithActiveConditions] Filtering out ${game.title} - state is ${gameState}`);
          return false;
        }

        // Also filter by status if available (Azuro uses different status field)
        // Common finished statuses: "Resolved", "Canceled"
        if (gameStatus === 'Resolved' || gameStatus === 'Canceled') {
          console.log(`[filterGamesWithActiveConditions] Filtering out ${game.title} - status is ${gameStatus}`);
          return false;
        }

        return true;
      })
    : games;

  return filteredGames
    .map(game => {
      const filtered = filterActiveConditions(game, isLive);
      // For live games, if no active conditions but game is still live, mark as suspended
      if (isLive && (!filtered.conditions || filtered.conditions.length === 0)) {
        // Include suspended live games so users can still see them
        return {
          ...game,
          conditions: [], // No active conditions
          isSuspended: true, // Flag for UI
        };
      }
      return filtered;
    })
    .filter(game => {
      // For prematch: require active conditions
      // For live: show all games (including suspended)
      if (isLive) return true;
      return game.conditions && game.conditions.length > 0;
    });
}

let dataFeedClient: GraphQLClient | null = null;
let clientApiClient: GraphQLClient | null = null;
let currentChain = DEFAULT_CHAIN;

function getDataFeedClient(): GraphQLClient {
  const config = getChainConfig(currentChain);
  if (!dataFeedClient) {
    dataFeedClient = new GraphQLClient(config.graphql.dataFeed);
  }
  return dataFeedClient;
}

function getClientApiClient(): GraphQLClient {
  const config = getChainConfig(currentChain);
  if (!clientApiClient) {
    clientApiClient = new GraphQLClient(config.graphql.client);
  }
  return clientApiClient;
}

export function setChain(chain: string) {
  currentChain = chain;
  dataFeedClient = null;
  clientApiClient = null;
}

export async function getSports(): Promise<Sport[]> {
  const client = getDataFeedClient();
  const data = await client.request<{ sports: Sport[] }>(QUERIES.sports);
  return data.sports;
}

export async function getGames(options: {
  sportSlug?: string;
  limit?: number;
  skip?: number;
  search?: string;
}): Promise<Game[]> {
  const client = getDataFeedClient();
  const now = Math.floor(Date.now() / 1000);
  const nowStr = now.toString();
  // 5 days from now (5 * 24 * 60 * 60 = 432000 seconds)
  const fiveDaysLater = (now + 5 * 24 * 60 * 60).toString();

  let games: Game[];
  const limit = Math.min(options.limit || 1000, 1000); // GraphQL API max is 1000

  try {
    console.log('[getGames] Fetching games with options:', JSON.stringify(options));

    // Use search query if search term is provided
    if (options.search && options.sportSlug) {
      console.log('[getGames] Using searchGames query');
      const data = await client.request<{ games: Game[] }>(QUERIES.searchGames, {
        sportSlug: options.sportSlug,
        search: options.search,
        startsAt_gt: nowStr,
        startsAt_lt: fiveDaysLater,
        first: limit,
      });
      games = data.games || [];
    } else if (options.sportSlug) {
      // Use sport-specific query if sport is specified
      console.log('[getGames] Using gamesBySport query for sport:', options.sportSlug);
      const data = await client.request<{ games: Game[] }>(QUERIES.gamesBySport, {
        sportSlug: options.sportSlug,
        startsAt_gt: nowStr,
        startsAt_lt: fiveDaysLater,
        first: limit,
      });
      games = data.games || [];
    } else {
      // Get all upcoming games
      console.log('[getGames] Using general games query');
      const data = await client.request<{ games: Game[] }>(QUERIES.games, {
        startsAt_gt: nowStr,
        startsAt_lt: fiveDaysLater,
        first: limit,
      });
      games = data.games || [];
    }

    console.log('[getGames] Raw response has', games.length, 'games');

    // Filter to only include games with active prematch conditions
    const filtered = filterGamesWithActiveConditions(games, false);
    console.log('[getGames] After filtering:', filtered.length, 'games');

    return filtered;
  } catch (error) {
    console.error('[getGames] GraphQL error:', error);

    // Check if the error contains HTML (indicates GraphQL endpoint issue)
    const errorStr = String(error);
    if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html') || errorStr.includes('Unexpected token')) {
      console.error('[getGames] GraphQL endpoint returned HTML instead of JSON!');
      throw new Error('Azuro GraphQL API is temporarily unavailable. Please try again later.');
    }

    // Re-throw with better error message
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch games from Azuro API: ${message}`);
  }
}

export async function getLiveGames(options: {
  sportSlug?: string;
  limit?: number;
  search?: string;
}): Promise<Game[]> {
  const client = getDataFeedClient();
  const now = Math.floor(Date.now() / 1000);
  // Only show games that started within the last 6 hours (360 min - covers long games, delays, and extended time)
  const maxGameDuration = (now - 360 * 60).toString();
  const nowStr = now.toString();

  let games: Game[];

  try {
    console.log('[getLiveGames] Fetching live games with options:', JSON.stringify(options));

    // Use search query if search term is provided
    if (options.search && options.sportSlug) {
      console.log('[getLiveGames] Using searchLiveGames query');
      const data = await client.request<{ games: Game[] }>(QUERIES.searchLiveGames, {
        sportSlug: options.sportSlug,
        search: options.search,
        startsAt_lt: nowStr,
        startsAt_gt: maxGameDuration,
        first: options.limit || 1000,
      });
      games = data.games || [];
    } else if (options.sportSlug) {
      // Use sport-specific query if sport is specified
      console.log('[getLiveGames] Using liveGamesBySport query for sport:', options.sportSlug);
      const data = await client.request<{ games: Game[] }>(QUERIES.liveGamesBySport, {
        sportSlug: options.sportSlug,
        startsAt_lt: nowStr,
        startsAt_gt: maxGameDuration,
        first: options.limit || 1000,
      });
      games = data.games || [];
    } else {
      // Get all live games
      console.log('[getLiveGames] Using general liveGames query');
      const data = await client.request<{ games: Game[] }>(QUERIES.liveGames, {
        startsAt_lt: nowStr,
        startsAt_gt: maxGameDuration,
        first: options.limit || 1000,
      });
      games = data.games || [];
    }

    console.log('[getLiveGames] Raw response has', games.length, 'games');

    // Filter to only include games with active live conditions
    const filtered = filterGamesWithActiveConditions(games, true);
    console.log('[getLiveGames] After filtering:', filtered.length, 'games');

    return filtered;
  } catch (error) {
    console.error('[getLiveGames] GraphQL error:', error);

    // Check if the error contains HTML (indicates GraphQL endpoint issue)
    const errorStr = String(error);
    if (errorStr.includes('<!DOCTYPE') || errorStr.includes('<html') || errorStr.includes('Unexpected token')) {
      console.error('[getLiveGames] GraphQL endpoint returned HTML instead of JSON!');
      throw new Error('Azuro GraphQL API is temporarily unavailable. Please try again later.');
    }

    // Re-throw with better error message
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to fetch live games from Azuro API: ${message}`);
  }
}

export async function getGame(gameId: string): Promise<Game | null> {
  const client = getDataFeedClient();

  try {
    const data = await client.request<{ game: Game | null }>(QUERIES.game, {
      gameId,
    });

    if (!data.game) return null;

    // Determine if game is live based on start time
    const now = Math.floor(Date.now() / 1000);
    const gameIsLive = parseInt(data.game.startsAt) < now;

    // Filter conditions to only include active/bettable ones
    return filterActiveConditions(data.game, gameIsLive);
  } catch {
    return null;
  }
}

export async function getBets(
  bettor: string,
  options: { status?: string; limit?: number }
): Promise<ApiBet[]> {
  const client = getClientApiClient();

  try {
    const data = await client.request<{ bets: ApiBet[] }>(QUERIES.bets, {
      bettor: bettor.toLowerCase(),
      status: options.status,
      first: options.limit || 100,
    });
    return data.bets || [];
  } catch {
    return [];
  }
}

export function formatOdds(rawOdds: string): number {
  const odds = parseFloat(rawOdds);
  return Math.round(odds * 100) / 100;
}

export function formatAmount(rawAmount: string, decimals: number = 6): number {
  const amount = parseFloat(rawAmount) / Math.pow(10, decimals);
  return Math.round(amount * 100) / 100;
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(parseInt(timestamp) * 1000);
  return date.toLocaleString();
}

export function isLive(startsAt: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  return parseInt(startsAt) < now;
}

export function getElapsedMinutes(startsAt: string): number {
  const now = Math.floor(Date.now() / 1000);
  const start = parseInt(startsAt);
  if (start >= now) return 0;
  return Math.floor((now - start) / 60);
}

export function formatMatchTime(startsAt: string, sportSlug?: string): { minute: string; period: string } {
  const elapsed = getElapsedMinutes(startsAt);

  // Football/Soccer specific timing
  if (sportSlug === 'football' || sportSlug === 'soccer') {
    if (elapsed <= 45) {
      return { minute: String(elapsed), period: '1st Half' };
    } else if (elapsed <= 60) {
      // Halftime is typically 15 mins, so 45-60 could be halftime
      return { minute: 'HT', period: 'Halftime' };
    } else if (elapsed <= 105) {
      // Second half: minutes 46-90 (elapsed 61-105 accounting for halftime)
      const secondHalfMinute = Math.min(90, elapsed - 15);
      return { minute: String(secondHalfMinute), period: '2nd Half' };
    } else {
      return { minute: '90+', period: 'Extra Time' };
    }
  }

  // Basketball specific timing (4 x 12 min quarters in NBA, 4 x 10 in FIBA)
  if (sportSlug === 'basketball') {
    const quarterLength = 12; // NBA style
    const quarter = Math.min(4, Math.floor(elapsed / quarterLength) + 1);
    const quarterTime = elapsed % quarterLength;
    return { minute: String(quarterTime), period: `Q${quarter}` };
  }

  // Tennis / eSports - just show elapsed
  if (sportSlug === 'tennis' || sportSlug === 'esports') {
    return { minute: String(elapsed), period: 'In Play' };
  }

  // Default: just show elapsed minutes
  return { minute: String(elapsed), period: 'Live' };
}

export function getGameStatus(startsAt: string, status?: string, sportSlug?: string): string {
  if (!isLive(startsAt)) {
    return 'Upcoming';
  }

  if (status && status !== 'Created') {
    return status;
  }

  const { period } = formatMatchTime(startsAt, sportSlug);
  return period;
}
