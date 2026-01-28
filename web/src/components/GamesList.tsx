'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useGamesStore, useLiveScoresStore } from '@/lib/store';
import { formatTimestamp, isLive, formatMatchTime } from '@/lib/azuro-api';
import { Game, LiveGameData } from '@/lib/types';

// Hook to subscribe to stats stream for multiple game IDs
function useLiveStatsStream(gameIds: string[]) {
  const { updateScores } = useLiveScoresStore();
  const eventSourceRef = useRef<EventSource | null>(null);
  const currentGameIdsRef = useRef<string>('');

  useEffect(() => {
    // Only subscribe if we have game IDs
    if (gameIds.length === 0) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    // Create a string key from sorted game IDs to detect changes
    const gameIdsKey = [...gameIds].sort().join(',');

    // Don't reconnect if game IDs haven't changed
    if (gameIdsKey === currentGameIdsRef.current && eventSourceRef.current) {
      return;
    }
    currentGameIdsRef.current = gameIdsKey;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    console.log('[GamesList] Subscribing to stats stream for', gameIds.length, 'games');

    // Create new SSE connection for all live games
    const eventSource = new EventSource(`/api/stats/stream?gameIds=${gameIds.join(',')}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'stats_update' && data.updates) {
          updateScores(data.updates);
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      console.log('[GamesList] Stats stream error, will reconnect');
    };

    eventSourceRef.current = eventSource;

    return () => {
      eventSource.close();
    };
  }, [gameIds, updateScores]);
}

// Group games by league
interface LeagueGroup {
  leagueName: string;
  leagueCountry: string;
  countrySlug: string;
  games: Game[];
}

// Country slug to flag emoji mapping
const countryFlags: Record<string, string> = {
  'england': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'spain': '🇪🇸',
  'germany': '🇩🇪',
  'italy': '🇮🇹',
  'france': '🇫🇷',
  'netherlands': '🇳🇱',
  'portugal': '🇵🇹',
  'brazil': '🇧🇷',
  'argentina': '🇦🇷',
  'mexico': '🇲🇽',
  'usa': '🇺🇸',
  'japan': '🇯🇵',
  'south-korea': '🇰🇷',
  'australia': '🇦🇺',
  'belgium': '🇧🇪',
  'turkey': '🇹🇷',
  'russia': '🇷🇺',
  'ukraine': '🇺🇦',
  'poland': '🇵🇱',
  'scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'wales': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  'ireland': '🇮🇪',
  'austria': '🇦🇹',
  'switzerland': '🇨🇭',
  'greece': '🇬🇷',
  'czech-republic': '🇨🇿',
  'croatia': '🇭🇷',
  'serbia': '🇷🇸',
  'denmark': '🇩🇰',
  'sweden': '🇸🇪',
  'norway': '🇳🇴',
  'finland': '🇫🇮',
  'romania': '🇷🇴',
  'hungary': '🇭🇺',
  'bulgaria': '🇧🇬',
  'colombia': '🇨🇴',
  'chile': '🇨🇱',
  'peru': '🇵🇪',
  'ecuador': '🇪🇨',
  'uruguay': '🇺🇾',
  'paraguay': '🇵🇾',
  'venezuela': '🇻🇪',
  'bolivia': '🇧🇴',
  'china': '🇨🇳',
  'india': '🇮🇳',
  'saudi-arabia': '🇸🇦',
  'uae': '🇦🇪',
  'qatar': '🇶🇦',
  'egypt': '🇪🇬',
  'south-africa': '🇿🇦',
  'morocco': '🇲🇦',
  'tunisia': '🇹🇳',
  'nigeria': '🇳🇬',
  'algeria': '🇩🇿',
  'israel': '🇮🇱',
  'cyprus': '🇨🇾',
  'slovakia': '🇸🇰',
  'slovenia': '🇸🇮',
  'iceland': '🇮🇸',
  'estonia': '🇪🇪',
  'latvia': '🇱🇻',
  'lithuania': '🇱🇹',
  'kazakhstan': '🇰🇿',
  'world': '🌍',
  'europe': '🇪🇺',
  'international': '🌐',
};

function getCountryFlag(countrySlug: string): string {
  if (!countrySlug) return '';
  const slug = countrySlug.toLowerCase();
  return countryFlags[slug] || '';
}

// Hook for local clock incrementing per game
function useGameClocks(liveScores: Map<string, LiveGameData>, liveGameIds: string[]) {
  const [localClocks, setLocalClocks] = useState<Map<string, { m: number; s: number; p?: number }>>(new Map());
  const lastSyncRef = useRef<Map<string, number>>(new Map());

  // Sync local clocks with WebSocket data
  useEffect(() => {
    setLocalClocks((prev) => {
      const newClocks = new Map(prev);
      for (const gameId of liveGameIds) {
        const wsData = liveScores.get(gameId);
        if (wsData?.clock?.m !== undefined) {
          // Only update if WS data is newer or doesn't exist locally
          const lastSync = lastSyncRef.current.get(gameId) || 0;
          const wsTime = wsData.updatedAt || Date.now();
          if (wsTime > lastSync) {
            newClocks.set(gameId, {
              m: wsData.clock.m,
              s: wsData.clock.s ?? 0,
              p: wsData.clock.p,
            });
            lastSyncRef.current.set(gameId, wsTime);
          }
        }
      }
      return newClocks;
    });
  }, [liveScores, liveGameIds]);

  // Increment all clocks every second
  useEffect(() => {
    if (liveGameIds.length === 0) return;

    const interval = setInterval(() => {
      setLocalClocks((prev) => {
        const newClocks = new Map(prev);
        for (const gameId of liveGameIds) {
          const clock = newClocks.get(gameId);
          if (clock) {
            let newS = clock.s + 1;
            let newM = clock.m;
            if (newS >= 60) {
              newS = 0;
              newM += 1;
            }
            newClocks.set(gameId, { ...clock, m: newM, s: newS });
          }
        }
        return newClocks;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [liveGameIds.length]);

  return localClocks;
}

// Fixed to football only
const FOOTBALL_SPORT_SLUG = 'football';

// Deduplicate games - removes matches with same teams (regardless of home/away order)
function deduplicateGames(games: Game[]): Game[] {
  const seen = new Set<string>();
  return games.filter((game) => {
    // Create a unique key based on sorted team names + start time
    const teams = game.participants.map(p => p.name).sort();
    const key = `${teams.join('|')}|${game.startsAt}`;

    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// Group games by league (using country + league name as unique key)
function groupGamesByLeague(games: Game[]): LeagueGroup[] {
  const leagueMap = new Map<string, LeagueGroup>();

  for (const game of games) {
    // Use country + league name as key to avoid merging same-named leagues from different countries
    const country = game.league.country?.name || '';
    const leagueKey = `${country}|${game.league.name}`;
    if (!leagueMap.has(leagueKey)) {
      leagueMap.set(leagueKey, {
        leagueName: game.league.name,
        leagueCountry: country,
        countrySlug: game.league.country?.slug || '',
        games: [],
      });
    }
    leagueMap.get(leagueKey)!.games.push(game);
  }

  // Sort leagues alphabetically by country name, then by league name
  return Array.from(leagueMap.values()).sort((a, b) => {
    const countryCompare = a.leagueCountry.localeCompare(b.leagueCountry);
    if (countryCompare !== 0) return countryCompare;
    return a.leagueName.localeCompare(b.leagueName);
  });
}

export default function GamesList() {
  const [rawGames, setRawGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [gameType, setGameType] = useState<'upcoming' | 'live'>('upcoming');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Auto-expand all leagues on Live tab, collapse on Upcoming
  const [manuallyToggled, setManuallyToggled] = useState<Set<string>>(new Set());

  const requestIdRef = useRef<number>(0); // Track request ID to ignore stale responses

  const { selectGame: selectGameInStore } = useGamesStore();
  const { scores: liveScores } = useLiveScoresStore();

  // Deduplicate games
  const deduplicatedGames = useMemo(() => deduplicateGames(rawGames), [rawGames]);

  // Client-side filtering by country, league, or team name
  const games = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      return deduplicatedGames;
    }
    const query = searchQuery.toLowerCase().trim();
    return deduplicatedGames.filter((game) => {
      // Search in country name
      const country = game.league.country?.name?.toLowerCase() || '';
      if (country.includes(query)) return true;

      // Search in league name
      const league = game.league.name?.toLowerCase() || '';
      if (league.includes(query)) return true;

      // Search in team names
      const title = game.title?.toLowerCase() || '';
      if (title.includes(query)) return true;

      // Search in individual participant names
      for (const p of game.participants) {
        if (p.name?.toLowerCase().includes(query)) return true;
      }

      return false;
    });
  }, [deduplicatedGames, searchQuery]);

  // Group games by league for both tabs
  const leagueGroups = useMemo(() => groupGamesByLeague(games), [games]);

  // For live games: default expanded; for upcoming: default collapsed
  const expandedLeagues = useMemo(() => {
    if (gameType === 'live') {
      // All leagues expanded by default, unless manually toggled closed
      const allLeagueKeys = new Set(leagueGroups.map(lg => `${lg.leagueCountry}|${lg.leagueName}`));
      const expanded = new Set<string>();
      for (const key of allLeagueKeys) {
        if (!manuallyToggled.has(key)) {
          expanded.add(key);
        }
      }
      return expanded;
    } else {
      // Upcoming: all collapsed by default, manually toggled ones are expanded
      return manuallyToggled;
    }
  }, [gameType, leagueGroups, manuallyToggled]);

  // Toggle league expansion (using country|league as unique key)
  const toggleLeague = (leagueKey: string) => {
    setManuallyToggled((prev) => {
      const next = new Set(prev);
      if (next.has(leagueKey)) {
        next.delete(leagueKey);
      } else {
        next.add(leagueKey);
      }
      return next;
    });
  };

  // Get IDs of live games for clock management
  const liveGameIds = useMemo(() => {
    return games.filter((g) => isLive(g.startsAt)).map((g) => g.gameId);
  }, [games]);

  // Subscribe to stats stream for all live games (provides real-time clock data)
  useLiveStatsStream(gameType === 'live' ? liveGameIds : []);

  // Use local clocks that increment every second
  const localClocks = useGameClocks(liveScores, liveGameIds);

  const fetchGames = useCallback(async (type: 'upcoming' | 'live' = 'upcoming') => {
    // Increment request ID to track this specific request
    const currentRequestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('sport', FOOTBALL_SPORT_SLUG);
      params.set('type', type);
      params.set('limit', '1000'); // Max allowed by GraphQL API

      const res = await fetch(`/api/games?${params}`);
      const data = await res.json();

      // Ignore response if a newer request has been made
      if (currentRequestId !== requestIdRef.current) {
        console.log(`Ignoring stale response for ${type} (request ${currentRequestId}, current ${requestIdRef.current})`);
        return;
      }

      if (data.error) throw new Error(data.error);
      setRawGames(data.games || []);
    } catch (err) {
      // Only update error if this is still the current request
      if (currentRequestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch games');
        setRawGames([]);
      }
    } finally {
      // Only clear loading if this is still the current request
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch on mount and when gameType changes
  useEffect(() => {
    fetchGames(gameType);
  }, [gameType, fetchGames]);

  // Client-side search - just update the query, filtering happens in useMemo
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    // No need to fetch from API - client-side filtering handles it
  }, []);

  const handleTypeChange = (type: 'upcoming' | 'live') => {
    if (type === gameType) return; // Already on this tab

    // Clear search when switching tabs
    setSearchQuery('');

    // Reset manually toggled leagues when switching tabs
    setManuallyToggled(new Set());

    // Clear games immediately to show loading state
    setRawGames([]);
    setGameType(type);
    // fetchGames will be called by the useEffect when gameType changes
  };

  const handleSelectGame = (game: Game) => {
    setSelectedGame(game);
    selectGameInStore(game);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search Bar */}
      <div className="search-container">
        <input
          type="text"
          className="search-input"
          placeholder="Search teams..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {searchQuery && (
          <button
            className="search-clear"
            onClick={() => handleSearchChange('')}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div className="tabs">
        <div
          className={`tab ${gameType === 'upcoming' ? 'active' : ''}`}
          onClick={() => handleTypeChange('upcoming')}
        >
          Upcoming
        </div>
        <div
          className={`tab ${gameType === 'live' ? 'active' : ''}`}
          onClick={() => handleTypeChange('live')}
        >
          Live
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {error ? (
          <div className="empty">
            <p className="text-[var(--error)]">Error: {error}</p>
          </div>
        ) : loading ? (
          <div className="empty">
            <div className="spinner mx-auto" />
            <p className="mt-2 text-xs">Loading games...</p>
          </div>
        ) : games.length === 0 ? (
          <div className="empty">
            <p>No games available</p>
            <p className="text-xs mt-2">Type: {gameType}</p>
          </div>
        ) : (
          // Collapsible leagues for both upcoming and live games
          leagueGroups.map((league) => {
            const leagueKey = `${league.leagueCountry}|${league.leagueName}`;
            const isExpanded = expandedLeagues.has(leagueKey);
            const isLiveTab = gameType === 'live';

            return (
              <div key={leagueKey} className="league-group">
                <div
                  className="league-header"
                  onClick={() => toggleLeague(leagueKey)}
                >
                  <div className="league-header-left">
                    <span className="league-expand-icon">{isExpanded ? '−' : '+'}</span>
                    {league.countrySlug && (
                      <span className="league-flag">{getCountryFlag(league.countrySlug)}</span>
                    )}
                    <div className="league-info">
                      {league.leagueCountry && (
                        <span className="league-country-name">{league.leagueCountry}</span>
                      )}
                      <span className="league-name">{league.leagueName}</span>
                    </div>
                  </div>
                  <div className="league-header-right">
                    {isLiveTab && <span className="badge badge-live badge-small">Live</span>}
                    <span className="league-count">{league.games.length}</span>
                  </div>
                </div>
                {isExpanded && (
                  <div className="league-games">
                    {league.games.map((game) => {
                      const homeTeam = game.participants[0];
                      const awayTeam = game.participants[1];

                      // Get live clock data for live games
                      let clockDisplay: { minute: string; period: string } | null = null;
                      if (isLiveTab) {
                        const localClock = localClocks.get(game.gameId);
                        const liveData = liveScores.get(game.gameId);
                        const clockData = localClock || liveData?.clock;
                        const hasLiveClock = clockData?.m !== undefined;

                        if (hasLiveClock && clockData) {
                          const mins = Math.floor(clockData.m || 0);
                          const secs = Math.floor(clockData.s || 0);
                          const p = clockData.p ?? liveData?.clock?.p;
                          const period = p === 1 ? '1st' : p === 2 ? '2nd' : p === 0 ? 'HT' : '';
                          clockDisplay = {
                            minute: `${mins}:${secs.toString().padStart(2, '0')}`,
                            period: period
                          };
                        } else {
                          const matchTime = formatMatchTime(game.startsAt, game.sport.slug);
                          if (matchTime) {
                            clockDisplay = {
                              minute: matchTime.minute + "'",
                              period: matchTime.period === '1st Half' ? '1st' : matchTime.period === '2nd Half' ? '2nd' : matchTime.period
                            };
                          }
                        }
                      }

                      return (
                        <div
                          key={game.id}
                          className={`game-item ${selectedGame?.id === game.id ? 'active' : ''}`}
                          onClick={() => handleSelectGame(game)}
                        >
                          <div className="game-teams-row">
                            <span className="game-team-name">{homeTeam?.name || 'Home'}</span>
                            <span className="game-vs">vs</span>
                            <span className="game-team-name">{awayTeam?.name || 'Away'}</span>
                          </div>
                          <div className="game-meta">
                            {isLiveTab && clockDisplay ? (
                              <span className="game-clock">
                                {clockDisplay.minute} {clockDisplay.period}
                              </span>
                            ) : (
                              <span className="game-time mono">
                                {formatTimestamp(game.startsAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
