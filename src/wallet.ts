// Wallet Management for Azuro CLI
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { CHAINS, ERC20_ABI, ChainKey } from './config.js';

export interface WalletInfo {
  address: string;
  usdtBalance: string;
  nativeBalance: string;
  nativeSymbol: string;
  tokenSymbol: string;
  chainName: string;
  chainId: number;
}

export class WalletManager {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | null = null;
  private chain: (typeof CHAINS)[ChainKey];
  private chainKey: ChainKey;

  constructor(chain: ChainKey = 'polygon') {
    this.chainKey = chain;
    this.chain = CHAINS[chain];
    this.provider = new ethers.JsonRpcProvider(this.chain.rpc);
  }

  /**
   * Load wallet from private key
   */
  loadWallet(privateKey: string): void {
    // Ensure private key has 0x prefix
    const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.wallet = new ethers.Wallet(key, this.provider);
  }

  /**
   * Get the connected wallet address
   */
  getAddress(): string {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }
    return this.wallet.address;
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.wallet !== null;
  }

  /**
   * Get full wallet info including balances
   */
  async getWalletInfo(): Promise<WalletInfo> {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }

    // Get LP contract to find the token address
    const lpAbi = ['function token() external view returns (address)'];
    const lpContract = new ethers.Contract(
      this.chain.contracts.lp,
      lpAbi,
      this.provider
    );

    const tokenAddress = await lpContract.token();

    // Create token contract
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      this.provider
    );

    // Fetch balances in parallel
    const [tokenBalance, nativeBalance, tokenSymbol] = await Promise.all([
      tokenContract.balanceOf(this.wallet.address),
      this.provider.getBalance(this.wallet.address),
      tokenContract.symbol(),
    ]);

    const nativeSymbol = this.chainKey === 'gnosis' ? 'xDAI' : 'MATIC';

    return {
      address: this.wallet.address,
      usdtBalance: ethers.formatUnits(tokenBalance, this.chain.tokenDecimals),
      nativeBalance: ethers.formatEther(nativeBalance),
      nativeSymbol,
      tokenSymbol,
      chainName: this.chain.name,
      chainId: this.chain.id,
    };
  }

  /**
   * Get just the token balance (USDT on Polygon)
   */
  async getTokenBalance(): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }

    const lpAbi = ['function token() external view returns (address)'];
    const lpContract = new ethers.Contract(
      this.chain.contracts.lp,
      lpAbi,
      this.provider
    );

    const tokenAddress = await lpContract.token();
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ERC20_ABI,
      this.provider
    );

    const balance = await tokenContract.balanceOf(this.wallet.address);
    return ethers.formatUnits(balance, this.chain.tokenDecimals);
  }

  /**
   * Get native balance (MATIC/xDAI)
   */
  async getNativeBalance(): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }

    const balance = await this.provider.getBalance(this.wallet.address);
    return ethers.formatEther(balance);
  }

  /**
   * Load private key from .env file
   */
  static getPrivateKeyFromEnv(): string | null {
    return process.env.PRIVATE_KEY || null;
  }

  /**
   * Save private key to .env file
   * Note: This should be used carefully - the key will be stored in plaintext
   */
  static savePrivateKeyToEnv(privateKey: string): void {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    // Read existing content if file exists
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');

      // Check if PRIVATE_KEY already exists
      if (envContent.includes('PRIVATE_KEY=')) {
        // Replace existing key
        envContent = envContent.replace(
          /PRIVATE_KEY=.*/,
          `PRIVATE_KEY=${privateKey}`
        );
      } else {
        // Add new key
        envContent += `\nPRIVATE_KEY=${privateKey}\n`;
      }
    } else {
      envContent = `PRIVATE_KEY=${privateKey}\n`;
    }

    fs.writeFileSync(envPath, envContent);
  }

  /**
   * Validate a private key format
   */
  static isValidPrivateKey(key: string): boolean {
    try {
      const formattedKey = key.startsWith('0x') ? key : `0x${key}`;
      // This will throw if the key is invalid
      new ethers.Wallet(formattedKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a new wallet (for testing purposes)
   */
  static generateWallet(): { address: string; privateKey: string } {
    const wallet = ethers.Wallet.createRandom();
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  }

  /**
   * Derive address from private key without connecting
   */
  static getAddressFromPrivateKey(privateKey: string): string {
    const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const wallet = new ethers.Wallet(key);
    return wallet.address;
  }
}

/**
 * Format balance for display with proper decimals
 */
export function formatBalance(balance: string, maxDecimals: number = 4): string {
  const num = parseFloat(balance);
  if (num === 0) return '0.00';

  if (num < 0.0001) {
    return '<0.0001';
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  });
}

/**
 * Mask wallet address for display (show first 6 and last 4 characters)
 */
export function maskAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
