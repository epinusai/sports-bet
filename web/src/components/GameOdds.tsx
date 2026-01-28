'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useGamesStore, useSlipStore, useLiveScoresStore } from '@/lib/store';
import { getOutcomeName, guessMarketType, Condition } from '@/lib/types';
import { formatOdds, isLive, formatTimestamp, formatMatchTime, getGameStatus } from '@/lib/azuro-api';
import { useOddsWebSocket } from '@/lib/useOddsWebSocket';
import { useLanguage } from '@/lib/LanguageContext';
import { translateMarket, translateOutcome } from '@/lib/translations';

// Filter conditions to only include those that are active and enabled for betting
function filterBettableConditions(conditions: Condition[], isLiveGame: boolean): Condition[] {
  return conditions.filter((condition) => {
    // Must be in Created or Active state (not Paused, Resolved, Canceled, or Stopped)
    const isActiveState = condition.state === 'Created' || condition.state === 'Active';
    if (!isActiveState) return false;

    // Check if betting type is enabled for this condition
    if (isLiveGame) {
      return condition.isLiveEnabled;
    } else {
      return condition.isPrematchEnabled;
    }
  });
}

// Hook for local clock incrementing when game is running
function useLocalClock(wsClockData: { m?: number; s?: number; t?: string; p?: number } | undefined) {
  const [localClock, setLocalClock] = useState<{ m: number; s: number; p?: number } | null>(null);
  const lastSyncRef = useRef<number>(0);

  // Sync local clock with WebSocket data
  useEffect(() => {
    if (wsClockData?.m !== undefined) {
      setLocalClock({
        m: wsClockData.m,
        s: wsClockData.s ?? 0,
        p: wsClockData.p,
      });
      lastSyncRef.current = Date.now();
    }
  }, [wsClockData?.m, wsClockData?.s, wsClockData?.p]);

  // Increment clock every second when running
  useEffect(() => {
    if (!localClock) return;
    // Only increment if clock status is 'running'
    const isRunning = wsClockData?.t === 'running' || !wsClockData?.t;
    if (!isRunning) return;

    const interval = setInterval(() => {
      setLocalClock((prev) => {
        if (!prev) return prev;
        let newS = prev.s + 1;
        let newM = prev.m;
        if (newS >= 60) {
          newS = 0;
          newM += 1;
        }
        return { ...prev, m: newM, s: newS };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [localClock !== null, wsClockData?.t]);

  return localClock;
}

// Team logo component with fallback to initials
function TeamLogo({ name, imageUrl, size = 48 }: { name: string; imageUrl?: string; size?: number }) {
  const [imgStatus, setImgStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const initial = name?.charAt(0)?.toUpperCase() || '?';

  // Reset status when imageUrl changes
  useEffect(() => {
    if (imageUrl) {
      setImgStatus('loading');
    }
  }, [imageUrl]);

  // Show placeholder if no URL or error
  if (!imageUrl || imgStatus === 'error') {
    return (
      <span className="team-logo-placeholder" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initial}</span>
    );
  }

  return (
    <>
      {imgStatus === 'loading' && (
        <span className="team-logo-placeholder" style={{ opacity: 0.5, width: size, height: size, fontSize: size * 0.4 }}>{initial}</span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={name}
        width={size}
        height={size}
        onLoad={() => setImgStatus('loaded')}
        onError={() => setImgStatus('error')}
        style={{
          objectFit: 'contain',
          display: imgStatus === 'loaded' ? 'block' : 'none',
        }}
      />
    </>
  );
}

// Statistics row component - always shows weighing bar when there's data
function StatRow({ label, home, away }: { label: string; home: number; away: number }) {
  const total = home + away;
  const homePercent = total > 0 ? (home / total) * 100 : 50;
  const hasData = total > 0;

  return (
    <div className="stat-row">
      <span className="stat-value home">{home}</span>
      <div className="stat-bar-container">
        <span className="stat-label">{label}</span>
        {hasData && (
          <div className="stat-bar">
            <div className="stat-bar-home" style={{ width: `${homePercent}%` }} />
            <div className="stat-bar-away" style={{ width: `${100 - homePercent}%` }} />
          </div>
        )}
      </div>
      <span className="stat-value away">{away}</span>
    </div>
  );
}

export default function GameOdds() {
  const { selectedGame, fetchGame } = useGamesStore();
  const { selections, addSelection, removeSelection } = useSlipStore();
  const { scores, updateScores, setConnected: setScoresConnected } = useLiveScoresStore();
  const { language, t } = useLanguage();
  const statsEventSourceRef = useRef<EventSource | null>(null);
  const [scoreTimedOut, setScoreTimedOut] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Get live score data early (before any early returns) so we can use hooks properly
  const liveData = selectedGame ? scores.get(selectedGame.gameId) : undefined;

  // Periodically refresh game data for live games to get updated condition states
  // This ensures settled markets (1st half, etc.) are removed when their conditions become Stopped/Resolved
  useEffect(() => {
    if (!selectedGame) return;
    const live = isLive(selectedGame.startsAt);
    if (!live) return;

    // Refresh game data every 30 seconds for live games
    const refreshInterval = setInterval(() => {
      console.log('[GameOdds] Refreshing game data for live game:', selectedGame.id);
      fetchGame(selectedGame.id);
    }, 30000);

    return () => clearInterval(refreshInterval);
  }, [selectedGame?.id, selectedGame?.startsAt, fetchGame]);

  // Use local clock that increments every second (must be called before early returns)
  const localClock = useLocalClock(liveData?.clock);

  // Get condition IDs for WebSocket subscription
  const conditionIds = useMemo(() => {
    if (!selectedGame || selectedGame.conditions.length === 0) return [];
    return selectedGame.conditions.map((c) => c.conditionId);
  }, [selectedGame]);

  // Connect to live odds via WebSocket
  const { connected: wsConnected, getOdds: getLiveOdds } = useOddsWebSocket(conditionIds);

  // Simple guaranteed timeout for score data - independent of SSE connection
  useEffect(() => {
    if (!selectedGame) return;

    const live = isLive(selectedGame.startsAt);
    if (!live) return;

    // Reset timeout state when game changes
    setScoreTimedOut(false);

    // Guaranteed 5-second timeout - will fire regardless of SSE state
    const timeoutId = setTimeout(() => {
      const currentScores = useLiveScoresStore.getState().scores;
      const scoreData = currentScores.get(selectedGame.gameId);
      if (!scoreData?.scoreBoard) {
        setScoreTimedOut(true);
      }
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [selectedGame?.gameId]);

  // Connect to live scores stream for live games
  useEffect(() => {
    if (!selectedGame) return;

    const live = isLive(selectedGame.startsAt);
    if (!live) return;

    // Close existing connection
    if (statsEventSourceRef.current) {
      statsEventSourceRef.current.close();
    }

    // Use gameId for statistics subscription
    const gameId = selectedGame.gameId;

    // Create new SSE connection for statistics
    const statsEventSource = new EventSource(
      `/api/stats/stream?gameIds=${gameId}`
    );

    statsEventSource.onopen = () => {
      setScoresConnected(true);
    };

    statsEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'stats_update' && data.updates) {
          updateScores(data.updates);
          // If we receive score data, clear the timed out state
          const hasScoreBoard = data.updates.some((u: { scoreBoard?: unknown }) => u.scoreBoard !== undefined);
          if (hasScoreBoard) {
            setScoreTimedOut(false);
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    statsEventSource.onerror = () => {
      setScoresConnected(false);
    };

    statsEventSourceRef.current = statsEventSource;

    return () => {
      statsEventSource.close();
      setScoresConnected(false);
    };
  }, [selectedGame, setScoresConnected, updateScores]);

  const isInSlip = useCallback(
    (conditionId: string, outcomeId: string) => {
      return selections.some(
        (s) => s.conditionId === conditionId && s.outcomeId === outcomeId
      );
    },
    [selections]
  );

  const handleOutcomeClick = useCallback(
    (conditionId: string, outcomeId: string, outcomeName: string, currentOdds: number, marketName: string) => {
      if (!selectedGame) return;

      if (isInSlip(conditionId, outcomeId)) {
        removeSelection(conditionId, outcomeId);
      } else {
        addSelection({
          gameId: selectedGame.id,
          gameTitle: selectedGame.title,
          conditionId,
          outcomeId,
          outcomeName,
          odds: currentOdds,
          marketName,
        });
      }
    },
    [selectedGame, isInSlip, addSelection, removeSelection]
  );

  const getDisplayOdds = useCallback(
    (conditionId: string, outcomeId: string, fallbackOdds: string) => {
      const liveOdds = getLiveOdds(conditionId, outcomeId);
      return liveOdds?.odds || formatOdds(fallbackOdds);
    },
    [getLiveOdds]
  );

  const getDirection = useCallback(
    (conditionId: string, outcomeId: string) => {
      const liveOdds = getLiveOdds(conditionId, outcomeId);
      return liveOdds?.direction || 'same';
    },
    [getLiveOdds]
  );

  if (!selectedGame) {
    return (
      <div className="empty">
        <p>{t.games.selectGame}</p>
      </div>
    );
  }

  const live = isLive(selectedGame.startsAt);
  const matchTime = live ? formatMatchTime(selectedGame.startsAt, selectedGame.sport.slug) : null;
  const gameStatus = getGameStatus(selectedGame.startsAt, selectedGame.status, selectedGame.sport.slug);

  // Get live score data for this game (liveData already fetched at top)
  const hasLiveScore = liveData?.scoreBoard !== undefined;
  const hasStats = liveData?.stats !== undefined;

  // Format clock as MM:SS
  const getClockDisplay = () => {
    // Use local clock (which increments) instead of raw WebSocket data
    const clock = localClock || liveData?.clock;
    if (!clock) return null;

    // Build MM:SS format
    const minutes = clock.m !== undefined ? clock.m : 0;
    const seconds = clock.s !== undefined ? clock.s : 0;
    const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

    // Determine period
    let period = '';
    const p = clock.p ?? liveData?.clock?.p;
    if (p !== undefined) {
      if (selectedGame.sport.slug === 'football' || selectedGame.sport.slug === 'soccer') {
        period = p === 1 ? t.games.firstHalf : p === 2 ? t.games.secondHalf : p === 0 ? t.games.halfTime : `Period ${p}`;
      } else if (selectedGame.sport.slug === 'basketball') {
        period = `Q${p}`;
      } else {
        period = `P${p}`;
      }
    }

    return { time: timeStr, period };
  };

  const clockDisplay = getClockDisplay();

  // Get team info
  const homeTeam = selectedGame.participants[0];
  const awayTeam = selectedGame.participants[1];

  // Filter conditions to only include bettable ones (active state + enabled for live/prematch)
  const bettableConditions = filterBettableConditions(selectedGame.conditions, live);

  // Group conditions by market type
  // Note: Azuro should mark settled conditions as Resolved/Paused/Stopped automatically
  const markets = bettableConditions.reduce(
    (acc, condition) => {
      const marketType = guessMarketType(condition.conditionId, condition.outcomes);
      if (!acc[marketType]) {
        acc[marketType] = [];
      }
      acc[marketType].push(condition);
      return acc;
    },
    {} as Record<string, typeof bettableConditions>
  );

  return (
    <div className="game-odds-container">
      {/* Hero Header - New Layout */}
      <div className="hero-header">
        {/* League Info */}
        <div className="hero-league">
          {selectedGame.league.country && (
            <span className="league-country">{selectedGame.league.country.name}</span>
          )}
          <span className="league-separator">·</span>
          <span className="league-name">{selectedGame.league.name}</span>
        </div>

        {/* Main Hero Content */}
        <div className="hero-content">
          {/* Home Team */}
          <div className="hero-team">
            <div className="hero-team-logo">
              <TeamLogo name={homeTeam?.name || 'Home'} imageUrl={homeTeam?.image} size={72} />
            </div>
          </div>

          {/* Score / Time Center */}
          <div className="hero-center">
            {live ? (
              <>
                {hasLiveScore ? (
                  <div className="hero-score">
                    <span className="hero-score-num">{liveData.scoreBoard!.s1}</span>
                    <span className="hero-score-sep">:</span>
                    <span className="hero-score-num">{liveData.scoreBoard!.s2}</span>
                  </div>
                ) : scoreTimedOut ? (
                  <div className="hero-no-score">
                    <span>-</span>
                    <span>:</span>
                    <span>-</span>
                  </div>
                ) : (
                  <div className="hero-loading">
                    <div className="spinner-small" />
                  </div>
                )}

                {clockDisplay ? (
                  <div className="hero-time">
                    <span className="hero-time-clock">{clockDisplay.time}</span>
                    <span className="hero-time-period">{clockDisplay.period}</span>
                  </div>
                ) : matchTime ? (
                  <div className="hero-time">
                    <span className="hero-time-clock">{matchTime.minute}&apos;</span>
                    <span className="hero-time-period">{matchTime.period}</span>
                  </div>
                ) : null}

                {scoreTimedOut && (
                  <span className="hero-no-stats">{t.games.noStatsCoverage}</span>
                )}
              </>
            ) : (
              <>
                <div className="hero-vs">VS</div>
                <div className="hero-kickoff">
                  <span>{formatTimestamp(selectedGame.startsAt)}</span>
                  <span className="hero-status">{gameStatus}</span>
                </div>
              </>
            )}
          </div>

          {/* Away Team */}
          <div className="hero-team">
            <div className="hero-team-logo">
              <TeamLogo name={awayTeam?.name || 'Away'} imageUrl={awayTeam?.image} size={72} />
            </div>
          </div>
        </div>

        {/* Team Names */}
        <div className="hero-team-names">
          <span className="hero-team-name home">{homeTeam?.name || 'Home'}</span>
          <span className="hero-team-divider">–</span>
          <span className="hero-team-name away">{awayTeam?.name || 'Away'}</span>
        </div>

        {/* Live Badge */}
        {live && (
          <div className="hero-badges">
            <span className="badge badge-live">LIVE</span>
            {wsConnected && (
              <span className="badge badge-streaming">
                <span className="pulse-dot" />
                {t.games.streaming}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Statistics Toggle & Panel */}
      {live && hasLiveScore && (
        <div className="stats-section">
          <button
            className={`stats-toggle ${showStats ? 'active' : ''}`}
            onClick={() => setShowStats(!showStats)}
          >
            <span>{t.games.matchStats}</span>
            <span className="toggle-icon">{showStats ? '▲' : '▼'}</span>
          </button>

          {showStats && hasStats && liveData.stats && (
            <div className="stats-panel">
              {liveData.scoreBoard && (
                <StatRow label={t.stats.goals} home={liveData.scoreBoard.s1} away={liveData.scoreBoard.s2} />
              )}
              {liveData.stats.corners && (
                <StatRow label={t.stats.corners} home={liveData.stats.corners.h} away={liveData.stats.corners.a} />
              )}
              {liveData.stats.yellowCards && (
                <StatRow label={t.stats.yellowCards} home={liveData.stats.yellowCards.h} away={liveData.stats.yellowCards.a} />
              )}
              {liveData.stats.redCards && (
                <StatRow label={t.stats.redCards} home={liveData.stats.redCards.h} away={liveData.stats.redCards.a} />
              )}
              {liveData.stats.shots && (
                <StatRow label={t.stats.totalShots} home={liveData.stats.shots.h} away={liveData.stats.shots.a} />
              )}
              {liveData.stats.shotsOnTarget && (
                <StatRow label={t.stats.shotsOnTarget} home={liveData.stats.shotsOnTarget.h} away={liveData.stats.shotsOnTarget.a} />
              )}
              {liveData.stats.possession && (
                <StatRow label={t.stats.possession} home={liveData.stats.possession.h} away={liveData.stats.possession.a} />
              )}
              {liveData.stats.fouls && (
                <StatRow label={t.stats.fouls} home={liveData.stats.fouls.h} away={liveData.stats.fouls.a} />
              )}
            </div>
          )}

          {showStats && !hasStats && (
            <div className="stats-panel stats-empty">
              <p>{t.games.statsNotAvailable}</p>
            </div>
          )}
        </div>
      )}

      {/* Markets */}
      <div className="markets-section">
        {Object.entries(markets).map(([marketType, conditions]) => (
          <div key={marketType} className="market-group">
            <h2 className="market-title">{translateMarket(marketType, language)}</h2>

            {conditions.map((condition) => (
              <div key={condition.conditionId} className="market-outcomes">
                <div className="outcomes-grid">
                  {condition.outcomes.map((outcome) => {
                    const rawOutcomeName = getOutcomeName(outcome.outcomeId, selectedGame.participants, outcome.title);
                    const outcomeName = translateOutcome(rawOutcomeName, language);
                    const displayOdds = getDisplayOdds(
                      condition.conditionId,
                      outcome.outcomeId,
                      outcome.currentOdds
                    );
                    const direction = getDirection(condition.conditionId, outcome.outcomeId);
                    const selected = isInSlip(condition.conditionId, outcome.outcomeId);

                    return (
                      <div
                        key={outcome.outcomeId}
                        className={`outcome-btn ${selected ? 'selected' : ''}`}
                        onClick={() =>
                          handleOutcomeClick(
                            condition.conditionId,
                            outcome.outcomeId,
                            outcomeName,
                            displayOdds,
                            marketType
                          )
                        }
                      >
                        <span className="outcome-name">{outcomeName}</span>
                        <span
                          className={`outcome-odds ${
                            direction === 'up'
                              ? 'odds-up'
                              : direction === 'down'
                                ? 'odds-down'
                                : ''
                          }`}
                        >
                          {displayOdds.toFixed(2)}
                          {direction === 'up' && <span className="odds-arrow">↑</span>}
                          {direction === 'down' && <span className="odds-arrow">↓</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}

        {bettableConditions.length === 0 && (
          <div className="empty">{t.games.noMarkets}</div>
        )}
      </div>
    </div>
  );
}
