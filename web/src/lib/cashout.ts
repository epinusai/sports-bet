import { ethers } from 'ethers';
import { getChainConfig, DEFAULT_CHAIN } from './config';

// Cashout API base URL
const CASHOUT_API_BASE = 'https://api.onchainfeed.org/api/v1/public/cashout';

// Polling configuration
const ORDER_POLL_INTERVAL_MS = 2000;
const ORDER_MAX_WAIT_MS = 30000;

// EIP-712 domain for cashout
const CASHOUT_DOMAIN_NAME = 'Cash Out';
const CASHOUT_DOMAIN_VERSION = '1.0.0';

// EIP-712 types for cashout
const CASHOUT_DATA_TYPES = {
  CashOutOrder: [
    { name: 'attention', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'items', type: 'CashOutItem[]' },
    { name: 'expiresAt', type: 'uint64' },
  ],
  CashOutItem: [
    { name: 'betId', type: 'uint256' },
    { name: 'bettingContract', type: 'address' },
    { name: 'minOdds', type: 'uint64' },
  ],
};

// Types
export interface CashoutAvailableOutcome {
  outcomeId: number;
  price: string;
}

export interface CashoutAvailableCondition {
  conditionId: string;
  gameStartAt: number;
  gameState: string;
  available: boolean;
  outcomes: CashoutAvailableOutcome[];
}

export interface CashoutAvailableResponse {
  margin: string;
  marginMin: string;
  availables: CashoutAvailableCondition[];
}

export interface CashoutCalculationResponse {
  calculationId: string;
  owner: string;
  environment: string;
  betId: string;
  cashoutAmount: string;
  cashoutOdds: string;
  expiredAt: number;
  approveExpiredAt: number;
  isLive: boolean;
}

export interface CashoutOrderResponse {
  id: string;
  state: 'Processing' | 'Pending' | 'Accepted' | 'Rejected';
  txHash?: string;
  error?: string;
  errorMessage?: string;
}

export interface CashoutResult {
  success: boolean;
  orderId?: string;
  txHash?: string;
  cashoutAmount?: string;
  error?: string;
}

/**
 * Check if cashout is available for given condition IDs
 * For combo bets, pass ALL condition IDs from the bet's selections
 */
export async function checkCashoutAvailable(conditionIds: string[]): Promise<{
  available: boolean;
  margin?: string;
  marginMin?: string;
  conditions: CashoutAvailableCondition[];
  unavailableConditions: string[];
}> {
  console.log('[Cashout] Checking availability for', conditionIds.length, 'conditions');

  try {
    const response = await fetch(`${CASHOUT_API_BASE}/get-available`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionIds }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Cashout] API error:', error);
      return {
        available: false,
        conditions: [],
        unavailableConditions: conditionIds,
      };
    }

    const data: CashoutAvailableResponse = await response.json();
    console.log('[Cashout] Available response:', JSON.stringify(data, null, 2));

    // Check which conditions are available
    const unavailableConditions: string[] = [];
    for (const condId of conditionIds) {
      const condData = data.availables.find(a => a.conditionId === condId);
      if (!condData || !condData.available) {
        unavailableConditions.push(condId);
      }
    }

    // For combo bets, ALL conditions must be available
    const allAvailable = unavailableConditions.length === 0 && data.availables.length > 0;

    return {
      available: allAvailable,
      margin: data.margin,
      marginMin: data.marginMin,
      conditions: data.availables,
      unavailableConditions,
    };
  } catch (error) {
    console.error('[Cashout] Error checking availability:', error);
    return {
      available: false,
      conditions: [],
      unavailableConditions: conditionIds,
    };
  }
}

/**
 * Get cashout calculation for a bet
 * Works for both single bets and combo bets
 */
export async function getCashoutCalculation(
  betId: string,
  ownerAddress: string,
  environment: string = 'PolygonUSDT'
): Promise<CashoutCalculationResponse | null> {
  console.log('[Cashout] Getting calculation for bet', betId, 'owner', ownerAddress);

  try {
    const response = await fetch(`${CASHOUT_API_BASE}/get-calculation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        environment,
        owner: ownerAddress.toLowerCase(),
        betId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[Cashout] Calculation API error:', error);
      return null;
    }

    const data: CashoutCalculationResponse = await response.json();
    console.log('[Cashout] Calculation response:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('[Cashout] Error getting calculation:', error);
    return null;
  }
}

/**
 * Pre-calculate cashout amount locally (before calling API)
 * Formula: betAmount × (originalOdds / currentOdds) × margin
 */
export function precalculateCashout(
  betAmount: number,
  originalOdds: number,
  currentOdds: number,
  margin: number,
  marginMin: number
): number {
  // If odds haven't changed significantly, use minimum margin
  if (Math.abs(originalOdds - currentOdds) < 0.001) {
    return betAmount * marginMin;
  }

  // Standard calculation
  return betAmount * (originalOdds / currentOdds) * margin;
}

/**
 * Execute cashout for a bet
 * @param wallet - ethers Wallet instance (with signer)
 * @param betId - Bet ID from Azuro subgraph
 * @param calculationId - From getCashoutCalculation
 * @param minOdds - Minimum acceptable odds (for slippage protection)
 * @param expiresAt - Expiration timestamp from calculation
 * @param chain - Chain name (default: polygon)
 */
export async function executeCashout(
  wallet: ethers.Wallet,
  betId: string,
  calculationId: string,
  minOdds: string,
  expiresAt: number,
  chain: string = DEFAULT_CHAIN
): Promise<CashoutResult> {
  const config = getChainConfig(chain);

  if (!config.contracts.cashout) {
    return { success: false, error: 'Cashout contract not configured for this chain' };
  }

  if (!config.contracts.azuroBet) {
    return { success: false, error: 'AzuroBet contract not configured for this chain' };
  }

  console.log('[Cashout] Executing cashout for bet', betId);
  console.log('[Cashout] calculationId:', calculationId);
  console.log('[Cashout] minOdds:', minOdds, 'expiresAt:', expiresAt);

  try {
    // Build EIP-712 domain
    const domain = {
      name: CASHOUT_DOMAIN_NAME,
      version: CASHOUT_DOMAIN_VERSION,
      chainId: config.id,
      verifyingContract: config.contracts.cashout.toLowerCase(),
    };

    // Convert minOdds to 12 decimal format
    const minOddsValue = parseFloat(minOdds);
    const minOddsWei = BigInt(Math.floor(minOddsValue * 1e12));

    // Build message
    const message = {
      attention: 'By signing, I agree to cash out my bet on Azuro Protocol.',
      chainId: BigInt(config.id),
      items: [{
        betId: BigInt(betId),
        bettingContract: config.contracts.azuroBet.toLowerCase(),
        minOdds: minOddsWei,
      }],
      expiresAt: BigInt(expiresAt),
    };

    console.log('[Cashout] Signing EIP-712 typed data...');
    console.log('[Cashout] Domain:', JSON.stringify(domain, (k, v) => typeof v === 'bigint' ? v.toString() : v));
    console.log('[Cashout] Message:', JSON.stringify(message, (k, v) => typeof v === 'bigint' ? v.toString() : v));

    // Sign the typed data
    const signature = await wallet.signTypedData(domain, CASHOUT_DATA_TYPES, message);
    console.log('[Cashout] Signature:', signature.slice(0, 20) + '...');

    // Build create request
    const createRequest = {
      calculationId,
      signature: {
        verifyingContract: config.contracts.cashout.toLowerCase(),
        bettingContract: config.contracts.azuroBet.toLowerCase(),
        attention: message.attention,
        chainId: config.id,
        ownerSignature: signature,
      },
    };

    console.log('[Cashout] Submitting cashout order...');

    // Submit to API
    const response = await fetch(`${CASHOUT_API_BASE}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createRequest),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[Cashout] Create API error:', error);
      return {
        success: false,
        error: error.errorMessage || error.error || 'Failed to create cashout order',
      };
    }

    const orderResult: CashoutOrderResponse = await response.json();
    console.log('[Cashout] Order created:', orderResult);

    if (orderResult.state === 'Rejected') {
      return {
        success: false,
        orderId: orderResult.id,
        error: orderResult.errorMessage || orderResult.error || 'Cashout rejected',
      };
    }

    // Poll for order completion
    const finalResult = await pollCashoutOrder(orderResult.id);
    return finalResult;
  } catch (error) {
    console.error('[Cashout] Error executing cashout:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Poll cashout order status until accepted or rejected
 */
async function pollCashoutOrder(orderId: string): Promise<CashoutResult> {
  const startTime = Date.now();
  console.log('[Cashout] Polling order', orderId, '...');

  while (Date.now() - startTime < ORDER_MAX_WAIT_MS) {
    try {
      const response = await fetch(`${CASHOUT_API_BASE}/${orderId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        console.log('[Cashout] Poll API returned', response.status, ', retrying...');
        await sleep(ORDER_POLL_INTERVAL_MS);
        continue;
      }

      const data: CashoutOrderResponse = await response.json();
      console.log('[Cashout] Order', orderId, 'state:', data.state);

      if (data.state === 'Accepted') {
        console.log('[Cashout] Order ACCEPTED! txHash:', data.txHash);
        return {
          success: true,
          orderId,
          txHash: data.txHash,
        };
      }

      if (data.state === 'Rejected') {
        const errorMsg = data.errorMessage || data.error || 'Cashout rejected by relayer';
        console.log('[Cashout] Order REJECTED:', errorMsg);
        return {
          success: false,
          orderId,
          error: errorMsg,
        };
      }

      // Still processing, wait and retry
      await sleep(ORDER_POLL_INTERVAL_MS);
    } catch (error) {
      console.log('[Cashout] Error polling order:', error);
      await sleep(ORDER_POLL_INTERVAL_MS);
    }
  }

  console.log('[Cashout] Timeout waiting for order', orderId);
  return {
    success: false,
    orderId,
    error: `Cashout order timeout after ${ORDER_MAX_WAIT_MS / 1000}s. Order ID: ${orderId}`,
  };
}

/**
 * Get bet details from Azuro subgraph (needed for cashout)
 * betId can be numeric ("205291") or full format ("contract_205291")
 */
export async function getBetDetails(betId: string, chain: string = DEFAULT_CHAIN): Promise<{
  id: string;  // Full format: contract_betId
  betId: string;  // Numeric betId
  amount: string;
  odds: string;
  status: string;
  isCashedOut: boolean;
  selections: Array<{
    conditionId: string;
    outcomeId: string;
  }>;
} | null> {
  const config = getChainConfig(chain);

  try {
    // If betId is already in full format (contains underscore), use it directly
    // Otherwise, we need to search for the bet
    const isFullFormat = betId.includes('_');
    const queryId = isFullFormat ? betId : betId;

    const query = `{
      v3Bet(id: "${queryId}") {
        id
        betId
        amount
        odds
        status
        isCashedOut
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

    const response = await fetch(config.graphql.client, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();
    if (!data.data?.v3Bet) {
      return null;
    }

    const bet = data.data.v3Bet;
    return {
      id: bet.id,  // Full format for cashout API
      betId: bet.betId,
      amount: bet.amount,
      odds: bet.odds,
      status: bet.status,
      isCashedOut: bet.isCashedOut,
      selections: bet.selections.map((s: { outcome: { outcomeId: string; condition: { conditionId: string } } }) => ({
        conditionId: s.outcome.condition.conditionId,
        outcomeId: s.outcome.outcomeId,
      })),
    };
  } catch (error) {
    console.error('[Cashout] Error getting bet details:', error);
    return null;
  }
}

/**
 * Full cashout flow - check availability, calculate, and execute
 * Works for both single bets and combo bets
 */
export async function fullCashout(
  wallet: ethers.Wallet,
  betId: string,
  slippagePercent: number = 5,
  chain: string = DEFAULT_CHAIN
): Promise<CashoutResult> {
  const config = getChainConfig(chain);
  const environment = config.websocket.environment;

  console.log('[Cashout] Starting full cashout flow for bet', betId);

  // Step 1: Get bet details
  const betDetails = await getBetDetails(betId, chain);
  if (!betDetails) {
    return { success: false, error: 'Bet not found' };
  }

  if (betDetails.isCashedOut) {
    return { success: false, error: 'Bet already cashed out' };
  }

  if (betDetails.status !== 'Accepted') {
    return { success: false, error: `Bet status is ${betDetails.status}, cannot cash out` };
  }

  console.log('[Cashout] Bet has', betDetails.selections.length, 'selection(s)');

  // Step 2: Check availability for ALL conditions
  const conditionIds = betDetails.selections.map(s => s.conditionId);
  const availability = await checkCashoutAvailable(conditionIds);

  if (!availability.available) {
    const unavailable = availability.unavailableConditions.join(', ');
    return {
      success: false,
      error: `Cashout not available. Unavailable conditions: ${unavailable}`,
    };
  }

  // Step 3: Get calculation
  const calculation = await getCashoutCalculation(betId, wallet.address, environment);
  if (!calculation) {
    return { success: false, error: 'Failed to calculate cashout amount' };
  }

  console.log('[Cashout] Cashout amount:', calculation.cashoutAmount);
  console.log('[Cashout] Cashout odds:', calculation.cashoutOdds);

  // Step 4: Calculate minOdds with slippage
  const currentOdds = parseFloat(calculation.cashoutOdds);
  const minOdds = currentOdds * (1 - slippagePercent / 100);
  console.log('[Cashout] Min odds with', slippagePercent, '% slippage:', minOdds.toFixed(4));

  // Step 5: Execute cashout
  const result = await executeCashout(
    wallet,
    betId,
    calculation.calculationId,
    minOdds.toString(),
    calculation.expiredAt,
    chain
  );

  if (result.success) {
    result.cashoutAmount = calculation.cashoutAmount;
  }

  return result;
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
