import { ethers } from 'ethers';
import { getChainConfig, LP_ABI, ERC20_ABI, DEFAULT_CHAIN } from './config';
import { WalletInfo, PlaceBetParams } from './types';

// V3 API base URL
const V3_API_BASE = 'https://api.onchainfeed.org/api/v1/public/bet';

// Order status polling configuration
const ORDER_POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
const ORDER_MAX_WAIT_MS = 30000; // Max 30 seconds wait

// Order states from V3 API
type OrderState = 'Processing' | 'Pending' | 'Accepted' | 'Rejected';

interface OrderStatusResponse {
  id: string;
  state: OrderState;
  betId?: string;
  txHash?: string;
  error?: string;
  errorMessage?: string;
}

// Poll order status until accepted or rejected
async function pollOrderStatus(orderId: string): Promise<{
  status: 'accepted' | 'rejected' | 'timeout';
  betId?: string;
  txHash?: string;
  error?: string;
}> {
  const startTime = Date.now();
  console.log(`[PollOrder] Starting poll for order ${orderId}...`);

  while (Date.now() - startTime < ORDER_MAX_WAIT_MS) {
    try {
      const response = await fetch(`${V3_API_BASE}/orders/${orderId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        console.log(`[PollOrder] API returned ${response.status}, retrying...`);
        await sleep(ORDER_POLL_INTERVAL_MS);
        continue;
      }

      const data: OrderStatusResponse = await response.json();
      console.log(`[PollOrder] Order ${orderId} state: ${data.state}`);

      if (data.state === 'Accepted') {
        console.log(`[PollOrder] Order ACCEPTED! betId: ${data.betId}, txHash: ${data.txHash}`);
        return {
          status: 'accepted',
          betId: data.betId,
          txHash: data.txHash,
        };
      }

      if (data.state === 'Rejected') {
        const errorMsg = data.errorMessage || data.error || 'Order rejected by relayer';
        console.log(`[PollOrder] Order REJECTED: ${errorMsg}`);
        return {
          status: 'rejected',
          error: errorMsg,
        };
      }

      // Still processing/pending, wait and retry
      await sleep(ORDER_POLL_INTERVAL_MS);
    } catch (error) {
      console.log(`[PollOrder] Error polling order:`, error);
      await sleep(ORDER_POLL_INTERVAL_MS);
    }
  }

  console.log(`[PollOrder] Timeout waiting for order ${orderId}`);
  return {
    status: 'timeout',
    error: `Order status unknown after ${ORDER_MAX_WAIT_MS / 1000}s. Check manually.`,
  };
}

// EIP-712 typed data for V3 betting
const TYPED_DATA_DOMAIN_NAME = 'Live Betting';
const TYPED_DATA_DOMAIN_VERSION = '1.0.0';

const BET_DATA_TYPES = {
  ClientBetData: [
    { name: 'clientData', type: 'ClientData' },
    { name: 'bets', type: 'SubBet[]' },
  ],
  ClientData: [
    { name: 'attention', type: 'string' },
    { name: 'affiliate', type: 'address' },
    { name: 'core', type: 'address' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'chainId', type: 'uint256' },
    { name: 'relayerFeeAmount', type: 'uint256' },
    { name: 'isFeeSponsored', type: 'bool' },
    { name: 'isBetSponsored', type: 'bool' },
    { name: 'isSponsoredBetReturnable', type: 'bool' },
  ],
  SubBet: [
    { name: 'conditionId', type: 'uint256' },
    { name: 'outcomeId', type: 'uint128' },
    { name: 'minOdds', type: 'uint64' },
    { name: 'amount', type: 'uint128' },
    { name: 'nonce', type: 'uint256' },
  ],
};

let provider: ethers.JsonRpcProvider | null = null;
let wallet: ethers.Wallet | null = null;
let lpContract: ethers.Contract | null = null;
let tokenContract: ethers.Contract | null = null;
let currentChain = DEFAULT_CHAIN;

// Multiple RPC endpoints for failover (free, no API key required)
const RPC_ENDPOINTS = [
  'https://polygon-rpc.com',  // Official Polygon RPC
  'https://polygon-bor-rpc.publicnode.com',  // PublicNode
  'https://polygon.drpc.org',  // DRPC free tier
  'https://rpc-mainnet.matic.quiknode.pro',  // QuikNode public
  'https://1rpc.io/matic',  // 1RPC (privacy-focused)
];

let currentRpcIndex = 0;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    const config = getChainConfig(currentChain);
    const rpcUrl = currentChain === 'polygon' ? RPC_ENDPOINTS[currentRpcIndex] : config.rpc;
    // Use static network to avoid auto-detection retries
    const network = ethers.Network.from(config.id);
    provider = new ethers.JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
    console.log('[RPC] Using endpoint:', rpcUrl);
  }
  return provider;
}

async function switchRpc(): Promise<void> {
  if (currentChain !== 'polygon') return;

  const prevIndex = currentRpcIndex;
  currentRpcIndex = (currentRpcIndex + 1) % RPC_ENDPOINTS.length;

  const config = getChainConfig(currentChain);
  const network = ethers.Network.from(config.id);
  const newRpcUrl = RPC_ENDPOINTS[currentRpcIndex];
  console.log('[RPC] Switching from', RPC_ENDPOINTS[prevIndex], 'to', newRpcUrl);

  provider = new ethers.JsonRpcProvider(newRpcUrl, network, { staticNetwork: network });

  if (wallet) {
    const privateKey = wallet.privateKey;
    wallet = new ethers.Wallet(privateKey, provider);
    initContracts();
  }
}

// Check if error is rate limit related
function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('rate limit') ||
         msg.includes('Too many requests') ||
         msg.includes('429') ||
         msg.includes('throttle') ||
         msg.includes('exceeded') ||
         msg.includes('CALL_EXCEPTION');
}

// Check if error is insufficient funds (shouldn't retry)
function isInsufficientFundsError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('insufficient funds') ||
         msg.includes('INSUFFICIENT_FUNDS') ||
         msg.includes('queued cost');
}

// Verify transaction was actually broadcast by querying it
async function verifyTxBroadcast(txHash: string, maxAttempts: number = 3): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const tx = await provider!.getTransaction(txHash);
      if (tx) {
        console.log(`[VerifyTx] Transaction ${txHash} found on attempt ${attempt + 1}`);
        return true;
      }
    } catch (error) {
      console.log(`[VerifyTx] Error checking tx on attempt ${attempt + 1}:`, error);
    }

    // Try different RPC on each attempt
    if (attempt < maxAttempts - 1) {
      await switchRpc();
      await sleep(1000);
    }
  }

  console.log(`[VerifyTx] Transaction ${txHash} NOT FOUND after ${maxAttempts} attempts`);
  return false;
}

// Get actual network gas price with buffer for priority
async function getNetworkGasPrice(): Promise<{ maxFee: bigint; priorityFee: bigint }> {
  // Default fallback values for Polygon
  const defaultGas = ethers.parseUnits('50', 'gwei');
  const defaultPriority = ethers.parseUnits('35', 'gwei');

  try {
    const feeData = await provider!.getFeeData();
    const gasPrice = feeData.gasPrice || defaultGas;

    // Use actual network price + 30% buffer
    const maxFee = (gasPrice * BigInt(130)) / BigInt(100);
    const priorityFee = (gasPrice * BigInt(15)) / BigInt(100);

    // Ensure minimum priority fee of 30 Gwei
    const minPriority = ethers.parseUnits('30', 'gwei');
    const finalPriority = priorityFee > minPriority ? priorityFee : minPriority;

    console.log('[Gas] Network:', ethers.formatUnits(gasPrice, 'gwei'), 'Gwei, MaxFee:', ethers.formatUnits(maxFee, 'gwei'), 'Gwei, Priority:', ethers.formatUnits(finalPriority, 'gwei'), 'Gwei');

    return { maxFee, priorityFee: finalPriority };
  } catch (error) {
    console.log('[Gas] Failed to get network gas, using fallback:', error instanceof Error ? error.message : error);
    return { maxFee: ethers.parseUnits('80', 'gwei'), priorityFee: defaultPriority };
  }
}

// Force switch to a fresh RPC endpoint to avoid stale mempool data
export async function forceSwitchRpc(): Promise<string> {
  await switchRpc();
  return RPC_ENDPOINTS[currentRpcIndex];
}

// Sleep helper
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Wait for transaction with polling (more reliable than tx.wait())
async function waitForTx(tx: ethers.ContractTransactionResponse, timeoutMs: number = 90000): Promise<ethers.TransactionReceipt> {
  const txHash = tx.hash;
  const startTime = Date.now();
  const pollInterval = 3000; // Poll every 3 seconds

  console.log(`[WaitTx] Polling for ${txHash}...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const receipt = await provider!.getTransactionReceipt(txHash);
      if (receipt) {
        if (receipt.status === 0) {
          throw new Error(`Transaction reverted. TxHash: ${txHash}`);
        }
        console.log(`[WaitTx] Confirmed in block ${receipt.blockNumber}`);
        return receipt;
      }
    } catch (error) {
      // Ignore polling errors, will retry
      if (error instanceof Error && error.message.includes('reverted')) {
        throw error;
      }
    }

    // Wait before next poll
    await sleep(pollInterval);
  }

  // Final check after timeout
  const finalReceipt = await provider!.getTransactionReceipt(txHash);
  if (finalReceipt) {
    if (finalReceipt.status === 0) {
      throw new Error(`Transaction reverted. TxHash: ${txHash}`);
    }
    return finalReceipt;
  }

  throw new Error(`Transaction confirmation timed out after ${timeoutMs/1000}s. TxHash: ${txHash}. Check https://polygonscan.com/tx/${txHash}`);
}

// Retry with exponential backoff and RPC switching
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  operation: string = 'operation'
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`[Retry] ${operation} attempt ${attempt + 1} failed:`, lastError.message);

      // Don't retry on insufficient funds - it won't help
      if (isInsufficientFundsError(error)) {
        console.log(`[Retry] Not retrying - insufficient funds error`);
        throw new Error('Insufficient MATIC for gas fees. Please add more MATIC to your wallet (at least 0.15 MATIC recommended) and try again.');
      }

      if (attempt < maxRetries) {
        // Switch RPC on rate limit errors
        if (isRateLimitError(error)) {
          await switchRpc();
        }

        // Exponential backoff: 2s, 4s, 8s
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        console.log(`[Retry] Waiting ${backoffMs}ms before retry...`);
        await sleep(backoffMs);
      }
    }
  }

  throw lastError || new Error(`${operation} failed after ${maxRetries} retries`);
}

function initContracts() {
  if (!wallet) return;

  const config = getChainConfig(currentChain);
  lpContract = new ethers.Contract(config.contracts.lp, LP_ABI, wallet);
  tokenContract = new ethers.Contract(config.token.address, ERC20_ABI, wallet);
}

export function setChain(chain: string) {
  currentChain = chain;
  provider = null;
  wallet = null;
  lpContract = null;
  tokenContract = null;
}

export function loadWallet(privateKey: string): string {
  provider = getProvider();
  wallet = new ethers.Wallet(privateKey, provider);
  initContracts();
  return wallet.address;
}

export function isWalletConnected(): boolean {
  return wallet !== null;
}

export function getWalletAddress(): string | null {
  return wallet?.address || null;
}

export async function getWalletInfo(): Promise<WalletInfo | null> {
  if (!wallet || !tokenContract) return null;

  const config = getChainConfig(currentChain);

  return withRetry(async () => {
    const [tokenBalance, nativeBalance] = await Promise.all([
      tokenContract!.balanceOf(wallet!.address),
      provider!.getBalance(wallet!.address),
    ]);

    return {
      address: wallet!.address,
      usdtBalance: ethers.formatUnits(tokenBalance, config.token.decimals),
      nativeBalance: ethers.formatEther(nativeBalance),
      nativeSymbol: currentChain === 'polygon' ? 'MATIC' : 'xDAI',
      tokenSymbol: config.token.symbol,
      chainName: config.name,
      chainId: config.id,
      connected: true,
    };
  }, 3, 'getWalletInfo');
}

export async function checkBalances(betAmount: string): Promise<{ hasEnoughMatic: boolean; hasEnoughUsdt: boolean; maticBalance: string; usdtBalance: string }> {
  if (!wallet || !tokenContract || !provider) throw new Error('Wallet not connected');

  const config = getChainConfig(currentChain);
  const amountWei = ethers.parseUnits(betAmount, config.token.decimals);

  return withRetry(async () => {
    const [maticBalance, usdtBalance] = await Promise.all([
      provider!.getBalance(wallet!.address),
      tokenContract!.balanceOf(wallet!.address),
    ]);

    return {
      hasEnoughMatic: maticBalance >= ethers.parseEther('0.01'),
      hasEnoughUsdt: usdtBalance >= amountWei,
      maticBalance: ethers.formatEther(maticBalance),
      usdtBalance: ethers.formatUnits(usdtBalance, config.token.decimals),
    };
  }, 3, 'checkBalances');
}

export async function approveToken(): Promise<string> {
  if (!wallet || !tokenContract) throw new Error('Wallet not connected');

  const config = getChainConfig(currentChain);
  // V3 uses relayer contract for approvals
  const spender = config.contracts.relayer || config.contracts.lp;

  return withRetry(async () => {
    // Check if we already have high enough allowance (unlimited or very high)
    const currentAllowance = await tokenContract!.allowance(wallet!.address, spender);
    const unlimitedThreshold = ethers.parseUnits('1000000', config.token.decimals); // 1M USDT threshold

    console.log('[Approve] Current allowance:', ethers.formatUnits(currentAllowance, config.token.decimals), 'USDT');

    if (currentAllowance >= unlimitedThreshold) {
      console.log('[Approve] Already have unlimited allowance for relayer - skipping approval');
      return 'already-approved';
    }

    // Check for stuck pending transactions
    const latestNonce = await provider!.getTransactionCount(wallet!.address, 'latest');
    const pendingNonce = await provider!.getTransactionCount(wallet!.address, 'pending');
    const stuckCount = pendingNonce - latestNonce;

    if (stuckCount > 0) {
      console.log(`[Approve] WARNING: ${stuckCount} stuck pending transactions (nonces ${latestNonce} to ${pendingNonce - 1})`);
      console.log('[Approve] Using pending nonce to queue after stuck transactions');
    }

    // Approve UNLIMITED amount so user only needs to approve once
    const approvalAmount = ethers.MaxUint256;
    console.log('[Approve] Approving UNLIMITED USDT for relayer (one-time approval)');

    // Get actual network gas price - use higher gas if stuck transactions exist
    let { maxFee, priorityFee } = await getNetworkGasPrice();

    // If stuck transactions, use higher gas to help clear them
    if (stuckCount > 0) {
      const highGas = ethers.parseUnits('500', 'gwei');
      const highPriority = ethers.parseUnits('100', 'gwei');
      if (maxFee < highGas) maxFee = highGas;
      if (priorityFee < highPriority) priorityFee = highPriority;
      console.log('[Approve] Using elevated gas due to stuck transactions:', ethers.formatUnits(maxFee, 'gwei'), 'gwei');
    }

    // Use PENDING nonce to queue after any stuck transactions
    const nonce = pendingNonce;
    console.log('[Approve] Using nonce:', nonce, 'Spender (relayer):', spender);
    console.log('[Approve] Sending unlimited approval transaction...');

    const tx = await tokenContract!.approve(spender, approvalAmount, {
      gasLimit: BigInt(150000),
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priorityFee,
      nonce: nonce,
    });

    console.log('[Approve] Transaction sent, txHash:', tx.hash);

    // Verify transaction was actually broadcast
    const wasBroadcast = await verifyTxBroadcast(tx.hash);
    if (!wasBroadcast) {
      throw new Error(`Transaction ${tx.hash} was NOT broadcast by RPC. Retrying...`);
    }

    console.log('[Approve] Waiting for confirmation...');
    await waitForTx(tx, 90000); // 90 second timeout with polling
    console.log('[Approve] Confirmed!');
    return tx.hash;
  }, 3, 'approveToken');
}

export async function checkAllowance(): Promise<string> {
  if (!wallet || !tokenContract) throw new Error('Wallet not connected');

  const config = getChainConfig(currentChain);
  // V3 uses relayer contract for approvals
  const spender = config.contracts.relayer || config.contracts.lp;

  return withRetry(async () => {
    const allowance = await tokenContract!.allowance(wallet!.address, spender);
    // Check if allowance is "unlimited" (>= 1M USDT)
    const unlimitedThreshold = ethers.parseUnits('1000000', config.token.decimals);
    if (allowance >= unlimitedThreshold) {
      // Return a very large number to indicate unlimited
      return '999999999';
    }
    return ethers.formatUnits(allowance, config.token.decimals);
  }, 3, 'checkAllowance');
}

// V3 betting via API with EIP-712 signature
export async function placeBet(params: PlaceBetParams & { skipConfirmation?: boolean }): Promise<{
  txHash: string;
  betId?: string;
  orderId?: string;
  status: 'accepted' | 'rejected' | 'pending' | 'processing';
  error?: string;
}> {
  if (!wallet) throw new Error('Wallet not connected');

  const config = getChainConfig(currentChain);

  console.log('[PlaceBetV3] Starting V3 bet placement...');
  console.log('[PlaceBetV3] conditionId:', params.conditionId, 'outcomeId:', params.outcomeId);

  // Calculate amounts - V3 uses raw token units
  const amountWei = ethers.parseUnits(params.amount, config.token.decimals);

  // Calculate minOdds - V3 uses 12 decimal places
  const currentOdds = parseFloat(params.odds);
  const slippage = params.slippage || 10; // Increased default from 5% to 10%
  const minOddsDecimal = 1 + (currentOdds - 1) * (100 - slippage) / 100;
  const minOddsWei = BigInt(Math.floor(minOddsDecimal * 1e12));

  console.log('[PlaceBetV3] Slippage calculation:');
  console.log(`  currentOdds: ${currentOdds}`);
  console.log(`  slippage: ${slippage}%`);
  console.log(`  minOddsDecimal: ${minOddsDecimal.toFixed(4)} (accepts odds down to this value)`);
  console.log(`  minOddsWei: ${minOddsWei.toString()}`);

  // Expiration (5 minutes from now)
  const expiresAt = Math.floor(Date.now() / 1000) + 300;

  // Generate unique nonce (timestamp + random)
  const nonce = BigInt(Date.now()) * BigInt(1000000) + BigInt(Math.floor(Math.random() * 1000000));

  console.log('[PlaceBetV3] amount:', params.amount, 'minOdds:', minOddsDecimal.toFixed(4));
  console.log('[PlaceBetV3] expiresAt:', expiresAt, 'nonce:', nonce.toString());

  // Build EIP-712 typed data for signing
  // Core address must be lowercase for EIP-712
  const coreAddress = config.contracts.core.toLowerCase();

  const domain = {
    name: TYPED_DATA_DOMAIN_NAME,
    version: TYPED_DATA_DOMAIN_VERSION,
    chainId: config.id,
    verifyingContract: coreAddress,
  };

  // The attention string must be empty string for standard bets
  const message = {
    clientData: {
      attention: '',
      affiliate: ethers.ZeroAddress.toLowerCase(),
      core: coreAddress,
      expiresAt: BigInt(expiresAt),
      chainId: BigInt(config.id),
      relayerFeeAmount: BigInt(0),
      isFeeSponsored: false,
      isBetSponsored: false,
      isSponsoredBetReturnable: false,
    },
    bets: [{
      conditionId: BigInt(params.conditionId),
      outcomeId: BigInt(params.outcomeId),
      minOdds: minOddsWei,
      amount: amountWei,
      nonce: nonce,
    }],
  };

  console.log('[PlaceBetV3] Signing EIP-712 typed data...');
  console.log('[PlaceBetV3] Domain:', JSON.stringify(domain, (k, v) => typeof v === 'bigint' ? v.toString() : v));
  console.log('[PlaceBetV3] Message:', JSON.stringify(message, (k, v) => typeof v === 'bigint' ? v.toString() : v));

  // Sign the typed data
  const signature = await wallet.signTypedData(
    domain,
    BET_DATA_TYPES,
    message
  );

  console.log('[PlaceBetV3] Signature:', signature.slice(0, 20) + '...');

  // Build API request body - must match signed data exactly
  const requestBody = {
    environment: 'PolygonUSDT',
    bettor: wallet.address.toLowerCase(),
    betOwner: wallet.address.toLowerCase(),
    clientBetData: {
      clientData: {
        attention: '',
        affiliate: ethers.ZeroAddress.toLowerCase(),
        core: coreAddress,
        expiresAt: expiresAt,
        chainId: config.id,
        relayerFeeAmount: '0',
        isFeeSponsored: false,
        isBetSponsored: false,
        isSponsoredBetReturnable: false,
      },
      bet: {
        conditionId: params.conditionId,
        outcomeId: parseInt(params.outcomeId),
        minOdds: minOddsWei.toString(),
        amount: amountWei.toString(),
        nonce: nonce.toString(),
      },
    },
    bettorSignature: signature,
  };

  console.log('[PlaceBetV3] Request body:', JSON.stringify(requestBody, null, 2));
  console.log('[PlaceBetV3] Submitting to V3 API...');

  // Submit to V3 API
  const response = await fetch(`${V3_API_BASE}/orders/ordinar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('[PlaceBetV3] API error:', result);
    throw new Error(result.message?.join(', ') || result.error || 'V3 API error');
  }

  console.log('[PlaceBetV3] API response:', result);

  // Get order ID for polling
  const orderId = result.id?.toString();
  if (!orderId) {
    throw new Error('No order ID returned from API');
  }

  // Poll for order status until accepted or rejected
  const pollResult = await pollOrderStatus(orderId);

  if (pollResult.status === 'rejected') {
    return {
      txHash: '',
      orderId,
      status: 'rejected',
      error: pollResult.error,
    };
  }

  if (pollResult.status === 'timeout') {
    // Return pending status - bet may still be processed
    return {
      txHash: '',
      orderId,
      status: 'pending',
      error: pollResult.error,
    };
  }

  // Accepted - return confirmed bet info
  return {
    txHash: pollResult.txHash || '',
    betId: pollResult.betId,
    orderId,
    status: 'accepted',
  };
}

// Combo/Parlay bet interface
export interface ComboBetSelection {
  conditionId: string;
  outcomeId: string;
  odds: number;
}

// V3 Combo/Parlay betting via API
export async function placeCombo(params: {
  selections: ComboBetSelection[];
  amount: string;
  slippage?: number;
}): Promise<{
  txHash: string;
  betId?: string;
  orderId?: string;
  status: 'accepted' | 'rejected' | 'pending' | 'processing';
  error?: string;
}> {
  if (!wallet) throw new Error('Wallet not connected');
  if (params.selections.length < 2) throw new Error('Combo bet requires at least 2 selections');

  const config = getChainConfig(currentChain);

  console.log('[PlaceCombo] Starting combo bet placement...');
  console.log('[PlaceCombo] Selections:', params.selections.length);

  // Calculate total odds (multiplied)
  const totalOdds = params.selections.reduce((acc, sel) => acc * sel.odds, 1);
  console.log('[PlaceCombo] Total odds:', totalOdds.toFixed(2));

  // Calculate amounts - V3 uses raw token units
  const amountWei = ethers.parseUnits(params.amount, config.token.decimals);

  // Calculate combined minOdds with slippage
  const slippage = params.slippage || 10; // Increased default from 5% to 10%
  const minOddsDecimal = 1 + (totalOdds - 1) * (100 - slippage) / 100;
  const minOddsWei = BigInt(Math.floor(minOddsDecimal * 1e12));

  console.log('[PlaceCombo] Slippage calculation:');
  console.log(`  totalOdds: ${totalOdds.toFixed(2)}`);
  console.log(`  slippage: ${slippage}%`);
  console.log(`  minOddsDecimal: ${minOddsDecimal.toFixed(4)} (accepts odds down to this value)`);

  // Expiration (5 minutes from now)
  const expiresAt = Math.floor(Date.now() / 1000) + 300;

  // Generate single nonce for combo bet
  const nonce = BigInt(Date.now()) * BigInt(1000000) + BigInt(Math.floor(Math.random() * 1000000));

  // Core address must be lowercase for EIP-712
  const coreAddress = config.contracts.core.toLowerCase();

  // Build bets array - for combo, just conditionId and outcomeId per selection
  const bets = params.selections.map((selection) => ({
    conditionId: BigInt(selection.conditionId),
    outcomeId: BigInt(selection.outcomeId),
  }));

  // EIP-712 types for combo bet (different structure than single bet)
  // IMPORTANT: Primary type is ClientComboBetData, array is ComboPart[]
  // Field order: clientData, minOdds, amount, nonce, bets
  const COMBO_BET_DATA_TYPES = {
    ClientComboBetData: [
      { name: 'clientData', type: 'ClientData' },
      { name: 'minOdds', type: 'uint64' },
      { name: 'amount', type: 'uint128' },
      { name: 'nonce', type: 'uint256' },
      { name: 'bets', type: 'ComboPart[]' },
    ],
    ClientData: [
      { name: 'attention', type: 'string' },
      { name: 'affiliate', type: 'address' },
      { name: 'core', type: 'address' },
      { name: 'expiresAt', type: 'uint256' },
      { name: 'chainId', type: 'uint256' },
      { name: 'relayerFeeAmount', type: 'uint256' },
      { name: 'isFeeSponsored', type: 'bool' },
      { name: 'isBetSponsored', type: 'bool' },
      { name: 'isSponsoredBetReturnable', type: 'bool' },
    ],
    ComboPart: [
      { name: 'conditionId', type: 'uint256' },
      { name: 'outcomeId', type: 'uint128' },
    ],
  };

  const domain = {
    name: TYPED_DATA_DOMAIN_NAME,
    version: TYPED_DATA_DOMAIN_VERSION,
    chainId: config.id,
    verifyingContract: coreAddress,
  };

  // Message structure must match type order: clientData, minOdds, amount, nonce, bets
  const message = {
    clientData: {
      attention: '',
      affiliate: ethers.ZeroAddress.toLowerCase(),
      core: coreAddress,
      expiresAt: BigInt(expiresAt),
      chainId: BigInt(config.id),
      relayerFeeAmount: BigInt(0),
      isFeeSponsored: false,
      isBetSponsored: false,
      isSponsoredBetReturnable: false,
    },
    minOdds: minOddsWei,
    amount: amountWei,
    nonce: nonce,
    bets: bets,
  };

  console.log('[PlaceCombo] Signing EIP-712 typed data for combo...');
  console.log('[PlaceCombo] minOdds:', minOddsDecimal.toFixed(4), 'amount:', params.amount, 'nonce:', nonce.toString());

  // Sign the typed data - must specify primaryType as ClientComboBetData
  const signature = await wallet.signTypedData(
    domain,
    COMBO_BET_DATA_TYPES,
    message
  );

  console.log('[PlaceCombo] Signature:', signature.slice(0, 20) + '...');

  // Build API request body for combo bet
  // Structure matches EIP-712 type order: clientData, minOdds, amount, nonce, bets
  const requestBody = {
    environment: 'PolygonUSDT',
    bettor: wallet.address.toLowerCase(),
    betOwner: wallet.address.toLowerCase(),
    clientBetData: {
      clientData: {
        attention: '',
        affiliate: ethers.ZeroAddress.toLowerCase(),
        core: coreAddress,
        expiresAt: expiresAt,
        chainId: config.id,
        relayerFeeAmount: '0',
        isFeeSponsored: false,
        isBetSponsored: false,
        isSponsoredBetReturnable: false,
      },
      minOdds: minOddsWei.toString(),
      amount: amountWei.toString(),
      nonce: nonce.toString(),
      bets: params.selections.map((sel) => ({
        conditionId: sel.conditionId,
        outcomeId: parseInt(sel.outcomeId),
      })),
    },
    bettorSignature: signature,
  };

  console.log('[PlaceCombo] Request body:', JSON.stringify(requestBody, null, 2));
  console.log('[PlaceCombo] Submitting combo to V3 API...');

  // Submit to V3 API combo endpoint
  const response = await fetch(`${V3_API_BASE}/orders/combo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('[PlaceCombo] API error:', result);
    throw new Error(result.message?.join(', ') || result.error || 'Combo bet API error');
  }

  console.log('[PlaceCombo] API response:', result);

  // Get order ID for polling
  const orderId = result.id?.toString();
  if (!orderId) {
    throw new Error('No order ID returned from combo API');
  }

  // Poll for order status until accepted or rejected
  const pollResult = await pollOrderStatus(orderId);

  if (pollResult.status === 'rejected') {
    return {
      txHash: '',
      orderId,
      status: 'rejected',
      error: pollResult.error,
    };
  }

  if (pollResult.status === 'timeout') {
    // Return pending status - bet may still be processed
    return {
      txHash: '',
      orderId,
      status: 'pending',
      error: pollResult.error,
    };
  }

  // Accepted - return confirmed bet info
  return {
    txHash: pollResult.txHash || '',
    betId: pollResult.betId,
    orderId,
    status: 'accepted',
  };
}

export async function withdrawPayout(tokenIds: string | string[], forceHighGas: boolean = false): Promise<{
  txHash: string;
  payout: string;
}> {
  if (!wallet || !lpContract) throw new Error('Wallet not connected');

  const config = getChainConfig(currentChain);

  // Normalize to array
  const tokenIdArray = Array.isArray(tokenIds) ? tokenIds : [tokenIds];

  if (forceHighGas) {
    console.log('[Withdraw] FORCE MODE: Using very high gas to replace stuck transactions');
  }

  console.log('[Withdraw] Withdrawing payout for tokenIds:', tokenIdArray);

  // First, check and set NFT approval for LP contract to burn/transfer bet NFTs
  const azuroBetAddress = config.contracts.azuroBet;
  if (azuroBetAddress) {
    const azuroBetContract = new ethers.Contract(azuroBetAddress, [
      'function isApprovedForAll(address owner, address operator) view returns (bool)',
      'function setApprovalForAll(address operator, bool approved)',
    ], wallet);

    // Retry approval check with RPC switching
    let isApproved = false;
    for (let i = 0; i < 3; i++) {
      try {
        isApproved = await azuroBetContract.isApprovedForAll(wallet.address, config.contracts.lp);
        console.log('[Withdraw] AzuroBet NFT approved for LP:', isApproved);
        break;
      } catch {
        console.log('[Withdraw] Approval check failed, retrying...', i + 1);
        await switchRpc();
        await sleep(1000);
      }
    }

    if (!isApproved) {
      console.log('[Withdraw] Approving AzuroBet NFTs for LP contract...');
      // Use high gas for approval
      const approveMaxFee = ethers.parseUnits('500', 'gwei');
      const approvePriorityFee = ethers.parseUnits('50', 'gwei');

      const approveTx = await azuroBetContract.setApprovalForAll(config.contracts.lp, true, {
        gasLimit: BigInt(150000), // Increased from 100k for safety
        maxFeePerGas: approveMaxFee,
        maxPriorityFeePerGas: approvePriorityFee,
      });
      console.log('[Withdraw] Approval tx sent:', approveTx.hash);

      // Wait with longer timeout and poll for receipt
      let approvalConfirmed = false;
      for (let i = 0; i < 30; i++) { // Try for 90 seconds
        await sleep(3000);
        try {
          const receipt = await provider!.getTransactionReceipt(approveTx.hash);
          if (receipt) {
            if (receipt.status === 0) {
              throw new Error('NFT approval transaction failed');
            }
            console.log('[Withdraw] NFT approval confirmed in block:', receipt.blockNumber);
            approvalConfirmed = true;
            break;
          }
        } catch {
          // Switch RPC and retry
          if (i % 5 === 4) await switchRpc();
        }
      }

      if (!approvalConfirmed) {
        throw new Error('NFT approval timed out - please try again');
      }

      // Wait a bit for state to propagate
      await sleep(2000);
    }
  }

  // Try to check if bets have payout available (may fail for some bets)
  let totalPayout = 0;
  for (const tokenId of tokenIdArray) {
    try {
      const payout = await lpContract.viewPayout(config.contracts.core, tokenId);
      const payoutAmount = parseFloat(ethers.formatUnits(payout, config.token.decimals));
      console.log('[Withdraw] Payout for', tokenId, ':', payoutAmount, config.token.symbol);
      totalPayout += payoutAmount;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Skip bets that fail viewPayout check - they may be Express bets or already redeemed
      console.log('[Withdraw] viewPayout check skipped for', tokenId, ':', errMsg.slice(0, 50));
    }
  }
  console.log('[Withdraw] Total expected payout:', totalPayout, config.token.symbol);

  // Check POL balance (with retries on different RPCs)
  let polBalanceFormatted = 0;

  for (let rpcTry = 0; rpcTry < 3; rpcTry++) {
    try {
      const polBalance = await provider!.getBalance(wallet.address);
      polBalanceFormatted = parseFloat(ethers.formatEther(polBalance));
      console.log('[Withdraw] POL balance:', polBalanceFormatted.toFixed(4), 'POL');
      break;
    } catch (rpcError) {
      console.log('[Withdraw] RPC error checking balance, trying another RPC:', rpcError instanceof Error ? rpcError.message : String(rpcError));
      if (rpcTry < 2) {
        await switchRpc();
        await sleep(1000);
      }
    }
  }

  // Minimum POL needed (0.02 POL should be enough for most gas prices)
  const minPolNeeded = 0.02;
  if (polBalanceFormatted < minPolNeeded && polBalanceFormatted > 0) {
    throw new Error(`Insufficient POL for gas. Have ${polBalanceFormatted.toFixed(4)} POL, need at least ${minPolNeeded} POL. Please add POL to your wallet.`);
  }

  // Try to get gas price
  let maxFee: bigint;
  let priorityFee: bigint;

  if (forceHighGas) {
    // Use very high gas to replace stuck pending transactions
    // At 150k gas limit, 2000 Gwei = 0.30 POL max cost
    maxFee = ethers.parseUnits('2000', 'gwei');
    priorityFee = ethers.parseUnits('800', 'gwei');
    console.log('[Withdraw] FORCE MODE gas price:', ethers.formatUnits(maxFee, 'gwei'), 'Gwei (max cost ~0.30 POL)');
  } else {
    // For withdrawals, use very high gas to ensure fast confirmation
    // Minimum 1500 Gwei as per user request
    try {
      const feeData = await provider!.getFeeData();
      const networkGas = feeData.gasPrice || ethers.parseUnits('100', 'gwei');
      const minGas = ethers.parseUnits('1500', 'gwei'); // Minimum 1500 Gwei for withdrawals

      // Use 50% above network price, but at least 1500 Gwei
      const suggestedGas = (networkGas * BigInt(150)) / BigInt(100);
      maxFee = suggestedGas > minGas ? suggestedGas : minGas;
      priorityFee = ethers.parseUnits('100', 'gwei');
      console.log('[Withdraw] Gas price:', ethers.formatUnits(maxFee, 'gwei'), 'Gwei (min 1500 Gwei for fast confirmation)');
    } catch (gasError) {
      console.log('[Withdraw] Gas price fetch failed, using 1500 Gwei fallback:', gasError);
      maxFee = ethers.parseUnits('1500', 'gwei');
      priorityFee = ethers.parseUnits('100', 'gwei');
    }
  }

  // Retry with different RPC if needed
  let lastError: Error | null = null;
  let pendingTxHash: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      console.log('[Withdraw] Attempt', attempt + 1, 'to withdraw...');

      // Get fresh nonce from blockchain to avoid stale local nonce
      const freshNonce = await provider!.getTransactionCount(wallet.address, 'latest');
      console.log('[Withdraw] Using nonce:', freshNonce);

      // Use withdrawPayouts (plural) with array - works for both single and Express bets
      // Build raw transaction to avoid any ethers.js issues
      const iface = new ethers.Interface([
        'function withdrawPayouts(address core, uint256[] tokenIds) returns (uint256)',
      ]);
      const tokenIdsBigInt = tokenIdArray.map(id => BigInt(id));
      const callData = iface.encodeFunctionData('withdrawPayouts', [config.contracts.core, tokenIdsBigInt]);

      console.log('[Withdraw] Sending raw tx with', tokenIdArray.length, 'tokenIds:', tokenIdArray.join(', '));
      console.log('[Withdraw] Call data:', callData.slice(0, 100) + '...');

      const tx = await wallet.sendTransaction({
        to: config.contracts.lp,
        data: callData,
        gasLimit: BigInt(1000000), // Express bets need ~800k gas
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priorityFee,
        nonce: freshNonce,
      });

      pendingTxHash = tx.hash;
      console.log('[Withdraw] Transaction sent:', tx.hash);

      const receipt = await tx.wait(1, 60000); // Wait up to 60 seconds
      console.log('[Withdraw] Transaction confirmed in block:', receipt?.blockNumber, 'status:', receipt?.status);

      // Check if transaction succeeded (status 1) or failed (status 0)
      if (receipt?.status === 0) {
        throw new Error('Transaction reverted on chain - bet may already be redeemed or NFT approval required');
      }

      // Parse Transfer event to get actual payout amount
      let payout = '0';
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          // ERC20 Transfer event topic
          if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            // Check if transfer is to our wallet
            const to = '0x' + log.topics[2]?.slice(26);
            if (to.toLowerCase() === wallet!.address.toLowerCase()) {
              const amount = BigInt(log.data);
              payout = ethers.formatUnits(amount, config.token.decimals);
              console.log('[Withdraw] Received payout:', payout, config.token.symbol);
              break;
            }
          }
        }
      }

      if (payout === '0') {
        throw new Error('Transaction succeeded but no USDT received - check if already redeemed');
      }

      return { txHash: tx.hash, payout };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errMsg = lastError.message;
      console.error('[Withdraw] Attempt', attempt + 1, 'failed:', errMsg);

      // Handle "already known" - transaction was sent, just wait for it
      if (errMsg.includes('already known') && pendingTxHash) {
        console.log('[Withdraw] Transaction already submitted, waiting for confirmation...');
        try {
          const receipt = await provider!.waitForTransaction(pendingTxHash, 1, 60000);
          if (receipt) {
            console.log('[Withdraw] Transaction confirmed:', receipt.hash, 'status:', receipt.status);
            if (receipt.status === 0) {
              throw new Error('Transaction reverted on chain - NFT approval may be required');
            }
            // Try to parse payout from logs
            let payout = '0';
            for (const log of receipt.logs) {
              if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
                const to = '0x' + log.topics[2]?.slice(26);
                if (to.toLowerCase() === wallet!.address.toLowerCase()) {
                  const amount = BigInt(log.data);
                  payout = ethers.formatUnits(amount, config.token.decimals);
                  break;
                }
              }
            }
            return { txHash: receipt.hash, payout };
          }
        } catch (waitError) {
          console.error('[Withdraw] Error waiting for tx:', waitError);
        }
      }

      // Handle "nonce too low" - transaction already confirmed
      if (errMsg.includes('nonce') && errMsg.includes('low')) {
        console.log('[Withdraw] Nonce too low - transaction may have already confirmed');
        throw new Error('Transaction may have already been processed. Check your wallet balance.');
      }

      // Handle execution reverted - bet might already be redeemed
      if (errMsg.includes('execution reverted') || errMsg.includes('revert')) {
        console.log('[Withdraw] Transaction reverted - bet may already be redeemed');
        throw new Error('Withdrawal failed - bet may already be redeemed or not won');
      }

      // Handle insufficient funds for gas - extract details from error
      if (errMsg.includes('insufficient funds') || errMsg.includes('INSUFFICIENT_FUNDS')) {
        // Try to parse the balance and costs from error message
        const balanceMatch = errMsg.match(/balance[:\s]+(\d+)/);
        const queuedMatch = errMsg.match(/queued cost[:\s]+(\d+)/);

        if (balanceMatch && queuedMatch) {
          const balance = parseFloat(ethers.formatEther(BigInt(balanceMatch[1])));
          const queued = parseFloat(ethers.formatEther(BigInt(queuedMatch[1])));

          console.log(`[Withdraw] Balance: ${balance.toFixed(4)} POL, Queued: ${queued.toFixed(4)} POL`);

          // If queued cost is almost all the balance, user must wait
          if (queued > balance * 0.8) {
            throw new Error(`Stuck transactions (${queued.toFixed(2)} POL) are blocking your wallet. WAIT 1-2 HOURS for them to expire, then try again. Or add ${(queued - balance + 0.5).toFixed(1)} POL to your wallet.`);
          }
        }

        // Try switching RPC before giving up
        if (attempt < 2) {
          console.log('[Withdraw] Insufficient funds, trying different RPC...');
          await switchRpc();
          await sleep(500);
          continue;
        }

        console.log('[Withdraw] Insufficient POL for gas');
        throw new Error(`Insufficient POL for gas fees. Balance: ${polBalanceFormatted.toFixed(4)} POL.`);
      }

      // Handle replacement underpriced - stuck tx has higher gas
      if (errMsg.includes('replacement') && errMsg.includes('underpriced')) {
        throw new Error('Stuck transactions blocking wallet. WAIT 1-2 HOURS for them to expire, then try again.');
      }

      // Switch RPC and retry for rate limit errors
      if (attempt < 2 && (errMsg.includes('rate limit') || errMsg.includes('Too many requests'))) {
        console.log('[Withdraw] Rate limited, switching RPC...');
        await switchRpc();
        // Re-initialize contract with new provider
        if (lpContract) {
          lpContract = new ethers.Contract(config.contracts.lp, LP_ABI, wallet);
        }
        await sleep(2000); // Wait longer for rate limit
      } else if (attempt < 2) {
        await switchRpc();
        if (lpContract) {
          lpContract = new ethers.Contract(config.contracts.lp, LP_ABI, wallet);
        }
        await sleep(1000);
      }
    }
  }

  throw lastError || new Error('Withdrawal failed after 3 attempts');
}

// Cancel stuck pending transactions by sending 0-value self-transfer
export async function cancelPendingTransactions(): Promise<{
  cancelled: number;
  txHashes: string[];
  error?: string;
}> {
  if (!wallet || !provider) throw new Error('Wallet not connected');

  // Try multiple RPCs to get nonce info
  let latestNonce = 0;
  let pendingNonce = 0;

  for (let rpcTry = 0; rpcTry < 3; rpcTry++) {
    try {
      latestNonce = await provider.getTransactionCount(wallet.address, 'latest');
      pendingNonce = await provider.getTransactionCount(wallet.address, 'pending');
      break;
    } catch (error) {
      console.log(`[CancelPending] RPC error on try ${rpcTry + 1}:`, error);
      if (rpcTry < 2) {
        await switchRpc();
        await sleep(1000);
      } else {
        return { cancelled: 0, txHashes: [], error: 'Could not check pending transactions due to RPC errors. Try again later.' };
      }
    }
  }

  const pendingCount = pendingNonce - latestNonce;
  console.log(`[CancelPending] Latest nonce: ${latestNonce}, Pending nonce: ${pendingNonce}, Stuck: ${pendingCount}`);

  if (pendingCount === 0) {
    return { cancelled: 0, txHashes: [] };
  }

  // Use VERY high gas to replace stuck transactions (user added 5 POL)
  // At 21k gas, 2000 Gwei = 0.042 POL per tx, so 8 txs = 0.336 POL total
  const replacementGas = ethers.parseUnits('2000', 'gwei');
  const priorityFee = ethers.parseUnits('1000', 'gwei');

  console.log(`[CancelPending] Using gas price: ${ethers.formatUnits(replacementGas, 'gwei')} Gwei to cancel ${pendingCount} stuck txs`);

  const txHashes: string[] = [];
  let cancelled = 0;
  const errors: string[] = [];

  // Cancel ALL pending transactions from latestNonce to pendingNonce-1
  for (let nonce = latestNonce; nonce < pendingNonce; nonce++) {
    try {
      console.log(`[CancelPending] Cancelling nonce ${nonce} (${nonce - latestNonce + 1}/${pendingCount})...`);

      const tx = await wallet.sendTransaction({
        to: wallet.address, // Self-transfer
        value: 0,
        nonce: nonce,
        gasLimit: BigInt(21000), // Minimum gas for transfer
        maxFeePerGas: replacementGas,
        maxPriorityFeePerGas: priorityFee,
      });

      console.log(`[CancelPending] Replacement tx sent for nonce ${nonce}: ${tx.hash}`);
      txHashes.push(tx.hash);

      // Wait briefly for confirmation before moving to next
      try {
        const receipt = await tx.wait(1, 30000);
        if (receipt) {
          console.log(`[CancelPending] Nonce ${nonce} cancelled successfully in block ${receipt.blockNumber}`);
          cancelled++;
        }
      } catch {
        console.log(`[CancelPending] Nonce ${nonce} tx sent but wait timed out, continuing...`);
      }

      // Small delay between transactions
      await sleep(500);

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CancelPending] Failed to cancel nonce ${nonce}:`, errMsg);
      errors.push(`Nonce ${nonce}: ${errMsg.slice(0, 100)}`);

      // If nonce too low, this nonce was already processed - continue to next
      if (errMsg.includes('nonce') && errMsg.includes('low')) {
        console.log(`[CancelPending] Nonce ${nonce} already processed, skipping`);
        cancelled++; // Count as success since it's done
        continue;
      }

      // If replacement underpriced, try next nonce anyway
      if (errMsg.includes('replacement') || errMsg.includes('underpriced')) {
        console.log(`[CancelPending] Nonce ${nonce} replacement underpriced, trying next`);
        continue;
      }
    }
  }

  return {
    cancelled,
    txHashes,
    error: errors.length > 0 ? errors.join('; ') : undefined
  };
}

export async function checkPayout(tokenId: string): Promise<string> {
  if (!lpContract) throw new Error('Wallet not connected');

  const config = getChainConfig(currentChain);

  try {
    const payout = await lpContract.viewPayout(config.contracts.core, tokenId);
    return ethers.formatUnits(payout, config.token.decimals);
  } catch {
    return '0';
  }
}

// Utility functions
export function isValidPrivateKey(key: string): boolean {
  try {
    new ethers.Wallet(key);
    return true;
  } catch {
    return false;
  }
}

export function getAddressFromPrivateKey(key: string): string {
  const wallet = new ethers.Wallet(key);
  return wallet.address;
}

export function generateWallet(): { address: string; privateKey: string } {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}
