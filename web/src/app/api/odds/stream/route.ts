import { NextRequest } from 'next/server';
import WebSocket from 'ws';
import { getChainConfig } from '@/lib/config';

// Store for active WebSocket connections
const wsConnections = new Map<string, WebSocket>();
const oddsCache = new Map<string, Map<string, { odds: number; timestamp: number }>>();

function getOrCreateConnection(environment: string): WebSocket {
  let ws = wsConnections.get(environment);

  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }

  const config = getChainConfig();
  ws = new WebSocket(config.websocket.url);

  ws.on('open', () => {
    console.log(`WebSocket connected to ${environment}`);
    // Start ping interval
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
      if (message.event === 'ConditionUpdated' && message.data?.outcomes) {
        const conditionId = message.id || message.data.id;
        if (!oddsCache.has(conditionId)) {
          oddsCache.set(conditionId, new Map());
        }
        const conditionOdds = oddsCache.get(conditionId)!;

        for (const outcome of message.data.outcomes) {
          const newOdds = parseFloat(outcome.currentOdds);

          conditionOdds.set(outcome.outcomeId, {
            odds: newOdds,
            timestamp: Date.now(),
          });
        }
      }
    } catch {
      // Ignore parse errors
    }
  });

  ws.on('close', () => {
    console.log(`WebSocket disconnected from ${environment}`);
    wsConnections.delete(environment);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error:`, error);
  });

  wsConnections.set(environment, ws);
  return ws;
}

function subscribeToConditions(ws: WebSocket, conditionIds: string[], environment: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        action: 'subscribe',
        conditionIds,
        environment,
      })
    );
  }
}

// Server-Sent Events endpoint for live odds
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const conditionIds = searchParams.get('conditions')?.split(',').filter(Boolean) || [];

  if (conditionIds.length === 0) {
    return new Response(JSON.stringify({ error: 'No condition IDs provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = getChainConfig();
  const environment = config.websocket.environment;

  // Get or create WebSocket connection
  const ws = getOrCreateConnection(environment);

  // Subscribe after connection is open
  if (ws.readyState === WebSocket.OPEN) {
    subscribeToConditions(ws, conditionIds, environment);
  } else {
    ws.once('open', () => {
      subscribeToConditions(ws, conditionIds, environment);
    });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let intervalId: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'connected', conditionIds })}\n\n`)
      );

      // Poll odds cache and send updates
      const previousOdds = new Map<string, number>();

      intervalId = setInterval(() => {
        const updates: Array<{
          conditionId: string;
          outcomeId: string;
          odds: number;
          direction: 'up' | 'down' | 'same';
        }> = [];

        for (const conditionId of conditionIds) {
          const conditionOdds = oddsCache.get(conditionId);
          if (!conditionOdds) continue;

          for (const [outcomeId, entry] of conditionOdds) {
            const key = `${conditionId}-${outcomeId}`;
            const prevOdds = previousOdds.get(key);
            const newOdds = Math.round(entry.odds * 100) / 100;

            if (prevOdds !== newOdds) {
              const direction =
                prevOdds === undefined
                  ? 'same'
                  : newOdds > prevOdds
                    ? 'up'
                    : newOdds < prevOdds
                      ? 'down'
                      : 'same';

              updates.push({
                conditionId,
                outcomeId,
                odds: newOdds,
                direction,
              });

              previousOdds.set(key, newOdds);
            }
          }
        }

        if (updates.length > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'odds_update', updates })}\n\n`)
          );
        }
      }, 500); // Poll every 500ms
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
