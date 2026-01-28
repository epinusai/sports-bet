import { ethers } from 'ethers';
import { CHAINS, LP_ABI, ERC20_ABI, CORE_ABI, ChainKey, POLYGON_RPC_ENDPOINTS } from './config.js';

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  betPlacementDelayMs: 500, // Delay between multiple bets
};

// Helper to check if error is rate limit related
function isRateLimitError(error: unknown): boolean {
  const errorStr = String(error).toLowerCase();
  return (
    errorStr.includes('rate limit') ||
    errorStr.includes('too many requests') ||
    errorStr.includes('429') ||
    errorStr.includes('batch size too large') ||
    errorStr.includes('exhausted')
  );
}

// Helper for delay
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = RETRY_CONFIG.maxRetries,
    baseDelayMs = RETRY_CONFIG.baseDelayMs,
    maxDelayMs = RETRY_CONFIG.maxDelayMs,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 500;
      const delayMs = Math.min(exponentialDelay + jitter, maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      await delay(delayMs);
    }
  }

  throw lastError;
}

export class AzuroBetting {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private chain: (typeof CHAINS)[ChainKey];
  private chainKey: ChainKey;
  private lpContract: ethers.Contract;
  private tokenContract: ethers.Contract;
  private currentRpcIndex: number = 0;
  private lastBetTimestamp: number = 0;

  constructor(privateKey: string, chain: ChainKey = 'polygon') {
    this.chain = CHAINS[chain];
    this.chainKey = chain;
    this.provider = new ethers.JsonRpcProvider(this.chain.rpc);
    this.wallet = new ethers.Wallet(privateKey, this.provider);

    this.lpContract = new ethers.Contract(
      this.chain.contracts.lp,
      LP_ABI,
      this.wallet
    );

    // Token contract will be initialized after getting token address
    this.tokenContract = null as unknown as ethers.Contract;
  }

  // Switch to next available RPC endpoint (for Polygon)
  private switchRpc(): boolean {
    if (this.chainKey !== 'polygon') {
      return false; // Only Polygon has multiple RPC endpoints
    }

    this.currentRpcIndex = (this.currentRpcIndex + 1) % POLYGON_RPC_ENDPOINTS.length;
    const newRpc = POLYGON_RPC_ENDPOINTS[this.currentRpcIndex];

    this.provider = new ethers.JsonRpcProvider(newRpc);
    this.wallet = this.wallet.connect(this.provider);

    this.lpContract = new ethers.Contract(
      this.chain.contracts.lp,
      LP_ABI,
      this.wallet
    );

    if (this.tokenContract) {
      const tokenAddress = (this.tokenContract as ethers.Contract).target;
      this.tokenContract = new ethers.Contract(
        tokenAddress as string,
        ERC20_ABI,
        this.wallet
      );
    }

    console.log(`Switched to RPC: ${newRpc}`);
    return true;
  }

  // Retry operation with RPC fallback
  private async retryWithRpcFallback<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const startRpcIndex = this.currentRpcIndex;
    let rpcAttempts = 0;
    const maxRpcAttempts = this.chainKey === 'polygon' ? POLYGON_RPC_ENDPOINTS.length : 1;

    while (rpcAttempts < maxRpcAttempts) {
      try {
        return await retryWithBackoff(operation, {
          onRetry: (attempt, error) => {
            console.log(`${operationName} - Retry attempt ${attempt}: ${String(error).slice(0, 100)}`);
          },
        });
      } catch (error) {
        if (isRateLimitError(error) && this.switchRpc()) {
          rpcAttempts++;
          console.log(`Rate limit hit, trying next RPC endpoint (attempt ${rpcAttempts}/${maxRpcAttempts})`);
          continue;
        }
        throw error;
      }
    }

    // Reset to original RPC if all failed
    while (this.currentRpcIndex !== startRpcIndex) {
      this.switchRpc();
    }

    throw new Error(`${operationName} failed after trying all RPC endpoints`);
  }

  async init(): Promise<void> {
    const tokenAddress = await this.retryWithRpcFallback(
      () => this.lpContract.token(),
      'init'
    );
    this.tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      this.wallet
    );
  }

  async getBalance(): Promise<{ token: string; balance: string; native: string }> {
    return this.retryWithRpcFallback(async () => {
      const [tokenBalance, nativeBalance, symbol] = await Promise.all([
        this.tokenContract.balanceOf(this.wallet.address),
        this.provider.getBalance(this.wallet.address),
        this.tokenContract.symbol(),
      ]);

      return {
        token: symbol,
        balance: ethers.formatUnits(tokenBalance, this.chain.tokenDecimals),
        native: ethers.formatEther(nativeBalance),
      };
    }, 'getBalance');
  }

  async approveToken(amount: bigint): Promise<string> {
    return this.retryWithRpcFallback(async () => {
      const allowance = await this.tokenContract.allowance(
        this.wallet.address,
        this.chain.contracts.lp
      );

      if (allowance >= amount) {
        return 'Already approved';
      }

      // Set manual gas settings to avoid Polygon gas station rate limits
      const gasSettings = {
        maxFeePerGas: ethers.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('30', 'gwei'),
      };

      const tx = await this.tokenContract.approve(
        this.chain.contracts.lp,
        ethers.MaxUint256,
        gasSettings
      );
      await tx.wait();
      return tx.hash;
    }, 'approveToken');
  }

  async placeBet(params: {
    conditionId: string;
    outcomeId: string;
    amount: string;
    minOdds: string;
    affiliate?: string;
  }): Promise<{ txHash: string; betId: string }> {
    const { conditionId, outcomeId, amount, minOdds, affiliate } = params;

    // Add delay between consecutive bets to avoid rate limiting
    const now = Date.now();
    const timeSinceLastBet = now - this.lastBetTimestamp;
    if (this.lastBetTimestamp > 0 && timeSinceLastBet < RETRY_CONFIG.betPlacementDelayMs) {
      await delay(RETRY_CONFIG.betPlacementDelayMs - timeSinceLastBet);
    }

    // Convert amount to proper units
    const amountWei = ethers.parseUnits(amount, this.chain.tokenDecimals);

    // Approve token if needed
    await this.approveToken(amountWei);

    // Encode bet data
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const data = abiCoder.encode(
      ['uint256', 'uint64'],
      [BigInt(conditionId), BigInt(outcomeId)]
    );

    // Convert odds (Azuro uses 12 decimals for odds)
    const minOddsWei = ethers.parseUnits(minOdds, 12);

    // Expiration time (1 hour from now)
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);

    const result = await this.retryWithRpcFallback(async () => {
      // Set manual gas settings to avoid Polygon gas station rate limits
      const gasSettings = {
        maxFeePerGas: ethers.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('30', 'gwei'),
      };

      // Place the bet with manual gas settings
      const tx = await this.lpContract.bet(
        this.chain.contracts.prematchCore,
        amountWei,
        expiresAt,
        {
          affiliate: affiliate || ethers.ZeroAddress,
          data,
          minOdds: minOddsWei,
        },
        gasSettings
      );

      const receipt = await tx.wait();

      // Parse bet ID from events
      let betId = '0';
      for (const log of receipt.logs) {
        try {
          const parsed = this.lpContract.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          if (parsed?.name === 'NewBet') {
            betId = parsed.args.betId.toString();
            break;
          }
        } catch {
          // Not our event, skip
        }
      }

      return {
        txHash: tx.hash,
        betId,
      };
    }, 'placeBet');

    // Update last bet timestamp
    this.lastBetTimestamp = Date.now();

    return result;
  }

  async withdrawPayout(tokenId: string): Promise<string> {
    return this.retryWithRpcFallback(async () => {
      // Check payout amount first
      const payout = await this.lpContract.viewPayout(
        this.chain.contracts.prematchCore,
        BigInt(tokenId)
      );

      if (payout === 0n) {
        throw new Error('No payout available for this bet');
      }

      // Set manual gas settings to avoid Polygon gas station rate limits
      const gasSettings = {
        maxFeePerGas: ethers.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('30', 'gwei'),
      };

      const tx = await this.lpContract.withdrawPayout(
        this.chain.contracts.prematchCore,
        BigInt(tokenId),
        gasSettings
      );

      await tx.wait();
      return tx.hash;
    }, 'withdrawPayout');
  }

  async checkPayout(tokenId: string): Promise<string> {
    return this.retryWithRpcFallback(async () => {
      const payout = await this.lpContract.viewPayout(
        this.chain.contracts.prematchCore,
        BigInt(tokenId)
      );

      return ethers.formatUnits(payout, this.chain.tokenDecimals);
    }, 'checkPayout');
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }
}
