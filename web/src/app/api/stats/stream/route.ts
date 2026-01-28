import { NextRequest } from 'next/server';
import WebSocket from 'ws';
import { getChainConfig } from '@/lib/config';
import { LiveGameData, LiveStats } from '@/lib/types';

// Store for active statistics WebSocket connections
const statsWsConnections = new Map<string, WebSocket>();
const statsCache = new Map<string, LiveGameData>();

// Statistics WebSocket endpoint (different from odds feed)
const STATS_WS_URL = 'wss://streams.onchainfeed.org/v1/streams/statistics/games';

// Helper to safely get stat value (returns undefined for -1 which means "not available")
function getStatValue(val: number | undefined): number | undefined {
  if (val === undefined || val === -1) return undefined;
  return val;
}

// Parse the actual data format from Azuro statistics WebSocket
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGameData(gameData: any): LiveGameData | null {
  const gameId = gameData.id;
  if (!gameId) return null;

  // If no live data, game is not in progress
  if (!gameData.live) {
    return null;
  }

  const live = gameData.live;
  const liveGameData: LiveGameData = {
    gameId,
    updatedAt: Date.now(),
  };

  // Parse scoreBoard - different sports use different score fields
  if (live.scoreBoard) {
    const sb = live.scoreBoard;

    // Determine score based on sport type:
    // - Football/Soccer: goals
    // - Basketball: points
    // - Tennis: sets/games
    // - Esports: games (best of series)
    // - Default fallback: try multiple fields
    let homeScore = 0;
    let awayScore = 0;

    if (sb.goals && sb.goals.h !== undefined && sb.goals.h !== -1) {
      // Football/Soccer
      homeScore = sb.goals.h;
      awayScore = sb.goals.g;
    } else if (sb.points && sb.points.h !== undefined && sb.points.h !== -1) {
      // Basketball
      homeScore = sb.points.h;
      awayScore = sb.points.g;
    } else if (sb.games && sb.games.h !== undefined && sb.games.h !== -1) {
      // Esports (LoL, CS2, Dota, etc.) - games won in series
      homeScore = sb.games.h;
      awayScore = sb.games.g;
    } else if (sb.sets && sb.sets.h !== undefined && sb.sets.h !== -1) {
      // Tennis/Volleyball
      homeScore = sb.sets.h;
      awayScore = sb.sets.g;
    } else if (sb.runs && sb.runs.h !== undefined && sb.runs.h !== -1) {
      // Baseball/Cricket
      homeScore = sb.runs.h;
      awayScore = sb.runs.g;
    }

    liveGameData.scoreBoard = {
      s1: homeScore,
      s2: awayScore,
    };

    // Parse period scores if available (half, half2 for football)
    const periods = [];
    if (sb.half && sb.half.h !== -1) {
      periods.push({ s1: sb.half.h, s2: sb.half.g, n: 1 });
    }
    if (sb.half2 && sb.half2.h !== -1) {
      periods.push({ s1: sb.half2.h, s2: sb.half2.g, n: 2 });
    }
    // Also check for quarters (basketball)
    for (let q = 1; q <= 4; q++) {
      const qKey = `q${q}`;
      if (sb[qKey] && sb[qKey].h !== -1) {
        periods.push({ s1: sb[qKey].h, s2: sb[qKey].g, n: q });
      }
    }
    // Check for game scores in esports (g1, g2, g3, etc.)
    for (let g = 1; g <= 7; g++) {
      const gKey = `g${g}`;
      if (sb[gKey] && sb[gKey].h !== -1) {
        periods.push({ s1: sb[gKey].h, s2: sb[gKey].g, n: g });
      }
    }
    if (periods.length > 0) {
      liveGameData.scoreBoard.ps = periods;
    }
  }

  // Parse clock - format is { clock_status, clock_direction, clock_seconds, clock_tm }
  if (live.clock) {
    const clock = live.clock;
    const totalSeconds = clock.clock_seconds ?? 0;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    liveGameData.clock = {
      m: minutes,
      s: seconds,
      t: clock.clock_status === 'running' ? 'running' : 'stopped',
    };
  }

  // Parse status for period info (e.g., "H1" = 1st half, "H2" = 2nd half)
  if (live.scoreBoard?.state) {
    const state = live.scoreBoard.state;
    let period: number | undefined;
    if (state === 'H1' || state === '1H') period = 1;
    else if (state === 'H2' || state === '2H') period = 2;
    else if (state === 'HT') period = 0; // Halftime
    else if (state === 'FT') period = -1; // Full time
    else if (state.startsWith('Q')) period = parseInt(state.slice(1)); // Quarters
    else if (state.startsWith('P')) period = parseInt(state.slice(1)); // Periods

    if (period !== undefined && liveGameData.clock) {
      liveGameData.clock.p = period;
    }
  }

  // Also check status.info for display text
  if (live.status?.info && liveGameData.clock) {
    liveGameData.clock.t = live.status.info;
  }

  // Parse stats - format uses { h, g } for home/guest (away)
  if (live.stats) {
    liveGameData.stats = parseStatsFromLive(live.stats);
  }

  return liveGameData;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseStatsFromLive(stats: any): LiveStats {
  const result: LiveStats = {};

  if (stats.possession && getStatValue(stats.possession.h) !== undefined) {
    result.possession = { h: stats.possession.h, a: stats.possession.g };
  }
  if (stats.totalShots && getStatValue(stats.totalShots.h) !== undefined) {
    result.shots = { h: stats.totalShots.h, a: stats.totalShots.g };
  }
  if (stats.shotsOnTarget && getStatValue(stats.shotsOnTarget.h) !== undefined) {
    result.shotsOnTarget = { h: stats.shotsOnTarget.h, a: stats.shotsOnTarget.g };
  }
  if (stats.corners && getStatValue(stats.corners.h) !== undefined) {
    result.corners = { h: stats.corners.h, a: stats.corners.g };
  }
  if (stats.fouls && getStatValue(stats.fouls.h) !== undefined) {
    result.fouls = { h: stats.fouls.h, a: stats.fouls.g };
  }
  if (stats.yellowCards && getStatValue(stats.yellowCards.h) !== undefined) {
    result.yellowCards = { h: stats.yellowCards.h, a: stats.yellowCards.g };
  }
  if (stats.redCards && getStatValue(stats.redCards.h) !== undefined) {
    result.redCards = { h: stats.redCards.h, a: stats.redCards.g };
  }

  return result;
}

function getOrCreateStatsConnection(environment: string): WebSocket {
  let ws = statsWsConnections.get(environment);

  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }

  ws = new WebSocket(STATS_WS_URL);

  ws.on('open', () => {
    console.log(`[Stats WS] Connected for ${environment}`);
    // Start ping interval to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // The statistics WebSocket returns an array of game data directly
      // Format: [{ id, fixture, live: { scoreBoard, stats, clock, status, ... } }, ...]
      if (Array.isArray(message)) {
        for (const gameData of message) {
          const parsed = parseGameData(gameData);
          if (parsed) {
            statsCache.set(parsed.gameId, parsed);
          }
        }
      }
    } catch (err) {
      console.error('[Stats WS] Parse error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[Stats WS] Disconnected from ${environment}`);
    statsWsConnections.delete(environment);
  });

  ws.on('error', (error) => {
    console.error(`[Stats WS] Error:`, error);
  });

  statsWsConnections.set(environment, ws);
  return ws;
}

function subscribeToGames(ws: WebSocket, gameIds: string[]) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'subscribe',
      gameIds,
    }));
  }
}

// Server-Sent Events endpoint for live statistics
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const gameIds = searchParams.get('gameIds')?.split(',').filter(Boolean) || [];

  if (gameIds.length === 0) {
    return new Response(JSON.stringify({ error: 'No game IDs provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = getChainConfig();
  const environment = config.websocket.environment;

  // Get or create statistics WebSocket connection
  const ws = getOrCreateStatsConnection(environment);

  // Subscribe after connection is open
  if (ws.readyState === WebSocket.OPEN) {
    subscribeToGames(ws, gameIds);
  } else {
    ws.once('open', () => {
      subscribeToGames(ws, gameIds);
    });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let intervalId: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', gameIds })}\n\n`)
      );

      // Track previous stats to detect changes
      const previousStats = new Map<string, string>();

      intervalId = setInterval(() => {
        const updates: LiveGameData[] = [];

        for (const gameId of gameIds) {
          const gameData = statsCache.get(gameId);
          if (!gameData) continue;

          // Serialize to detect changes
          const serialized = JSON.stringify(gameData);
          const prev = previousStats.get(gameId);

          if (prev !== serialized) {
            updates.push(gameData);
            previousStats.set(gameId, serialized);
          }
        }

        if (updates.length > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'stats_update', updates })}\n\n`)
          );
        }
      }, 1000); // Poll every 1 second for stats
    },
    cancel() {
      clearInterval(intervalId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
