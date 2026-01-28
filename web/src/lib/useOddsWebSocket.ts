'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { OddsUpdate } from './types';

const AZURO_WS_URL = 'wss://streams.onchainfeed.org/v1/streams/feed';
const ENVIRONMENT = 'PolygonUSDT';

interface WebSocketMessage {
  event: string;
  id?: string;
  data?: {
    id?: string;
    outcomes?: {
      outcomeId: number | string;
      currentOdds: string;
    }[];
  };
}

interface OddsState {
  [key: string]: {
    odds: number;
    direction: 'up' | 'down' | 'same';
    timestamp: number;
  };
}

export function useOddsWebSocket(conditionIds: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const previousOddsRef = useRef<Map<string, number>>(new Map());
  const conditionIdsRef = useRef<string[]>(conditionIds);

  const [connected, setConnected] = useState(false);
  const [oddsState, setOddsState] = useState<OddsState>({});

  // Stable condition IDs - only update ref when content actually changes
  const stableConditionIds = useMemo(() => {
    const sorted = [...conditionIds].sort();
    const prevSorted = [...conditionIdsRef.current].sort();
    if (sorted.length === prevSorted.length && sorted.every((id, i) => id === prevSorted[i])) {
      return conditionIdsRef.current;
    }
    conditionIdsRef.current = conditionIds;
    return conditionIds;
  }, [conditionIds]);

  // Clear direction after animation
  const clearDirection = useCallback((key: string) => {
    setTimeout(() => {
      setOddsState(prev => {
        if (!prev[key]) return prev;
        return {
          ...prev,
          [key]: { ...prev[key], direction: 'same' as const }
        };
      });
    }, 2000); // Keep arrow visible for 2 seconds
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);

      if (message.event === 'ConditionUpdated') {
        const conditionId = message.id || message.data?.id;
        const outcomes = message.data?.outcomes;

        if (!conditionId || !outcomes || outcomes.length === 0) return;

        // Only process if we're subscribed to this condition
        if (!conditionIdsRef.current.includes(conditionId)) return;

        const updates: OddsUpdate[] = [];

        for (const outcome of outcomes) {
          const outcomeId = String(outcome.outcomeId);
          const newOdds = parseFloat(outcome.currentOdds);
          const key = `${conditionId}-${outcomeId}`;

          const previousOdds = previousOddsRef.current.get(key) || newOdds;

          let direction: 'up' | 'down' | 'same' = 'same';
          if (newOdds > previousOdds + 0.001) {
            direction = 'up';
          } else if (newOdds < previousOdds - 0.001) {
            direction = 'down';
          }

          previousOddsRef.current.set(key, newOdds);

          updates.push({
            conditionId,
            outcomeId,
            newOdds,
            previousOdds,
            direction,
          });
        }

        if (updates.length > 0) {
          setOddsState(prev => {
            const newState = { ...prev };
            for (const update of updates) {
              const key = `${update.conditionId}-${update.outcomeId}`;
              newState[key] = {
                odds: update.newOdds,
                direction: update.direction,
                timestamp: Date.now(),
              };

              // Clear direction after animation if there was a change
              if (update.direction !== 'same') {
                clearDirection(key);
              }
            }
            return newState;
          });
        }
      }
    } catch (err) {
      // Ignore parse errors
      console.debug('[WS] Parse error:', err);
    }
  }, [clearDirection]);

  const subscribe = useCallback((ws: WebSocket, ids: string[]) => {
    if (ws.readyState !== WebSocket.OPEN || ids.length === 0) return;

    const subscribeMessage = {
      event: 'SubscribeConditions',
      data: {
        conditionIds: ids,
        environment: ENVIRONMENT,
      },
    };

    console.log('[WS] Subscribing to conditions:', ids.length);
    ws.send(JSON.stringify(subscribeMessage));
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (conditionIdsRef.current.length === 0) return;

    console.log('[WS] Connecting to', AZURO_WS_URL);
    const ws = new WebSocket(AZURO_WS_URL);

    ws.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);

      // Subscribe to conditions
      subscribe(ws, conditionIdsRef.current);

      // Start ping interval to keep connection alive
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          // Send a ping - Azuro WebSocket may not need this but good practice
          try {
            ws.send(JSON.stringify({ event: 'ping' }));
          } catch {
            // Ignore ping errors
          }
        }
      }, 30000);
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setConnected(false);

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // Attempt reconnect after 2 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('[WS] Reconnecting...');
        connect();
      }, 2000);
    };

    ws.onerror = (error) => {
      console.log('[WS] Error:', error);
    };

    wsRef.current = ws;
  }, [handleMessage, subscribe]);

  // Connect when condition IDs change
  useEffect(() => {
    if (stableConditionIds.length === 0) {
      // No conditions to subscribe to, close connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    // Initialize previous odds from any existing state
    // This prevents false "direction" signals on reconnect

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, stableConditionIds]);

  // Re-subscribe when condition IDs change while connected
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && stableConditionIds.length > 0) {
      subscribe(wsRef.current, stableConditionIds);
    }
  }, [stableConditionIds, subscribe]);

  // Helper function to get odds for a specific outcome
  const getOdds = useCallback((conditionId: string, outcomeId: string) => {
    const key = `${conditionId}-${outcomeId}`;
    return oddsState[key] || null;
  }, [oddsState]);

  return {
    connected,
    oddsState,
    getOdds,
  };
}
