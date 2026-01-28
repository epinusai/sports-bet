// Azuro WebSocket Live Odds Streaming
import WebSocket from 'ws';
import { EventEmitter } from 'events';

const AZURO_WS_URL = 'wss://streams.onchainfeed.org/v1/streams/feed';

// Environment mapping for Azuro WebSocket
const CHAIN_TO_ENVIRONMENT: Record<string, string> = {
  polygon: 'PolygonUSDT',
  gnosis: 'GnosisXDAI',
  polygonAmoy: 'PolygonAmoyAZUSD',
};

export interface OddsUpdate {
  conditionId: string;
  outcomeId: string;
  newOdds: number;
  previousOdds: number;
  direction: 'up' | 'down' | 'same';
}

export interface WebSocketMessage {
  event: string;
  // ConditionUpdated message has id at root level
  id?: string;
  data?: {
    id?: string;
    environment?: string;
    // Outcomes are directly in data for ConditionUpdated events
    outcomes?: {
      outcomeId: number | string;
      title?: string;
      currentOdds: string;
    }[];
    // Nested data for other event types
    data?: {
      gameId?: string;
      state?: string;
      outcomes?: {
        outcomeId: number | string;
        title?: string;
        currentOdds: string;
      }[];
    };
  };
  // Legacy format fields (kept for compatibility)
  type?: string;
  conditionId?: string;
  outcomes?: {
    outcomeId: string;
    odds: number;
  }[];
}

export class AzuroWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private conditionIds: string[] = [];
  private environment: string;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private currentOdds: Map<string, Map<string, number>> = new Map(); // conditionId -> outcomeId -> odds
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(chain: string = 'polygon') {
    super();
    this.environment = CHAIN_TO_ENVIRONMENT[chain] || 'PolygonUSDT';
  }

  /**
   * Connect to the Azuro WebSocket feed
   */
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(AZURO_WS_URL);

        this.ws.on('open', () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          if (process.env.DEBUG) {
            console.log('[WS] Connected to', AZURO_WS_URL);
          }
          this.emit('connected');

          // Start ping interval to keep connection alive
          this.startPing();

          // Resubscribe if we have conditions
          if (this.conditionIds.length > 0) {
            this.subscribe(this.conditionIds);
          }

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const rawData = data.toString();
            if (process.env.DEBUG) {
              console.log('[WS] Raw message received:', rawData.slice(0, 200));
            }
            const message = JSON.parse(rawData) as WebSocketMessage;
            if (process.env.DEBUG) {
              console.log('[WS] Parsed message:', JSON.stringify(message, null, 2).slice(0, 500));
            }
            this.handleMessage(message);
          } catch (err) {
            if (process.env.DEBUG) {
              console.log('[WS] Parse error:', (err as Error).message, 'Raw:', data.toString().slice(0, 100));
            }
          }
        });

        this.ws.on('close', () => {
          this.isConnecting = false;
          this.stopPing();
          this.emit('disconnected');

          if (this.shouldReconnect) {
            this.attemptReconnect();
          }
        });

        this.ws.on('error', (err) => {
          this.isConnecting = false;
          this.emit('error', err);

          if (this.reconnectAttempts === 0) {
            reject(err);
          }
        });

      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop ping interval
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Attempt to reconnect after disconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect_failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    setTimeout(() => {
      this.connect().catch(() => {
        // Error handled in connect()
      });
    }, delay);
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: WebSocketMessage): void {
    if (process.env.DEBUG) {
      console.log('[WS] handleMessage event:', message.event);
    }

    // Handle the ConditionUpdated event format
    if (message.event === 'ConditionUpdated') {
      // Get conditionId from root id or data.id
      const conditionId = message.id || (message.data as any)?.id;

      // Get outcomes - try multiple locations
      let outcomes = (message.data as any)?.outcomes;
      if (!outcomes && (message.data as any)?.data?.outcomes) {
        outcomes = (message.data as any).data.outcomes;
      }

      if (process.env.DEBUG) {
        console.log('[WS] ConditionUpdated - conditionId:', conditionId?.slice(0,20), 'outcomes:', outcomes ? outcomes.length : 'NONE', 'keys:', message.data ? Object.keys(message.data) : 'no data');
      }

      if (!conditionId || !outcomes || outcomes.length === 0) {
        if (process.env.DEBUG) {
          console.log('[WS] SKIPPING - no conditionId or outcomes');
        }
        return;
      }

      if (process.env.DEBUG) {
        console.log(`[WS] Emitting odds_update for condition ${conditionId} with ${outcomes.length} outcomes`);
      }

      if (!this.currentOdds.has(conditionId)) {
        this.currentOdds.set(conditionId, new Map());
      }
      const conditionOdds = this.currentOdds.get(conditionId)!;

      for (const outcome of outcomes) {
        const outcomeId = String(outcome.outcomeId);
        const newOdds = parseFloat(outcome.currentOdds);
        const previousOdds = conditionOdds.get(outcomeId) || newOdds;

        let direction: 'up' | 'down' | 'same' = 'same';
        if (newOdds > previousOdds + 0.001) {
          direction = 'up';
        } else if (newOdds < previousOdds - 0.001) {
          direction = 'down';
        }

        conditionOdds.set(outcomeId, newOdds);

        const update: OddsUpdate = {
          conditionId,
          outcomeId,
          newOdds,
          previousOdds,
          direction,
        };

        if (process.env.DEBUG) {
          console.log('[WS] Emitting odds_update:', conditionId.slice(0,15), outcomeId, direction, previousOdds.toFixed(3), '->', newOdds.toFixed(3));
          console.log('[WS] Listener count for odds_update:', this.listenerCount('odds_update'));
        }
        this.emit('odds_update', update);
      }
      return;
    }

    // Handle legacy format (kept for compatibility)
    if (message.conditionId && message.outcomes) {
      const conditionId = message.conditionId;

      if (!this.currentOdds.has(conditionId)) {
        this.currentOdds.set(conditionId, new Map());
      }
      const conditionOdds = this.currentOdds.get(conditionId)!;

      for (const outcome of message.outcomes) {
        const outcomeId = outcome.outcomeId;
        const newOdds = outcome.odds;
        const previousOdds = conditionOdds.get(outcomeId) || newOdds;

        let direction: 'up' | 'down' | 'same' = 'same';
        if (newOdds > previousOdds + 0.001) {
          direction = 'up';
        } else if (newOdds < previousOdds - 0.001) {
          direction = 'down';
        }

        conditionOdds.set(outcomeId, newOdds);

        const update: OddsUpdate = {
          conditionId,
          outcomeId,
          newOdds,
          previousOdds,
          direction,
        };

        if (process.env.DEBUG) {
          console.log('[WS] Emitting odds_update:', conditionId, outcomeId, direction, previousOdds, '->', newOdds);
        }
        this.emit('odds_update', update);
      }
    }
  }

  /**
   * Subscribe to condition IDs for odds updates
   */
  subscribe(conditionIds: string[]): void {
    if (!conditionIds || conditionIds.length === 0) {
      return;
    }

    // Store condition IDs for resubscription on reconnect
    this.conditionIds = [...new Set([...this.conditionIds, ...conditionIds])];

    // Initialize current odds tracking
    for (const conditionId of conditionIds) {
      if (!this.currentOdds.has(conditionId)) {
        this.currentOdds.set(conditionId, new Map());
      }
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const subscribeMessage = {
      event: 'SubscribeConditions',
      data: {
        conditionIds,
        environment: this.environment,
      },
    };

    if (process.env.DEBUG) {
      console.log('[WS] Sending subscribe:', JSON.stringify(subscribeMessage));
    }
    this.ws.send(JSON.stringify(subscribeMessage));
    this.emit('subscribed', conditionIds);
  }

  /**
   * Unsubscribe from condition IDs
   */
  unsubscribe(conditionIds?: string[]): void {
    if (conditionIds) {
      this.conditionIds = this.conditionIds.filter(id => !conditionIds.includes(id));

      // Clean up odds tracking
      for (const conditionId of conditionIds) {
        this.currentOdds.delete(conditionId);
      }
    } else {
      this.conditionIds = [];
      this.currentOdds.clear();
    }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const unsubscribeMessage = {
      event: 'UnsubscribeConditions',
      data: {
        conditionIds: conditionIds || [],
        environment: this.environment,
      },
    };

    this.ws.send(JSON.stringify(unsubscribeMessage));
    this.emit('unsubscribed', conditionIds);
  }

  /**
   * Set initial odds for a condition (used to detect direction changes)
   */
  setInitialOdds(conditionId: string, outcomes: { outcomeId: string; odds: number }[]): void {
    if (!this.currentOdds.has(conditionId)) {
      this.currentOdds.set(conditionId, new Map());
    }
    const conditionOdds = this.currentOdds.get(conditionId)!;

    for (const outcome of outcomes) {
      conditionOdds.set(outcome.outcomeId, outcome.odds);
    }
  }

  /**
   * Get current odds for a condition/outcome
   */
  getCurrentOdds(conditionId: string, outcomeId: string): number | undefined {
    return this.currentOdds.get(conditionId)?.get(outcomeId);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPing();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.conditionIds = [];
    this.currentOdds.clear();
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance for global access
let wsInstance: AzuroWebSocket | null = null;

export function getWebSocketInstance(chain?: string): AzuroWebSocket {
  if (!wsInstance || (chain && wsInstance)) {
    wsInstance = new AzuroWebSocket(chain);
  }
  return wsInstance;
}

export function closeWebSocket(): void {
  if (wsInstance) {
    wsInstance.disconnect();
    wsInstance = null;
  }
}
