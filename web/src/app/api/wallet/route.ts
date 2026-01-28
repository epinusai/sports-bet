import { NextRequest, NextResponse } from 'next/server';
import {
  getWallet,
  saveWallet,
  clearWallet,
} from '@/lib/db';
import {
  loadWallet,
  getWalletInfo,
  isValidPrivateKey,
  getAddressFromPrivateKey,
  generateWallet,
  isWalletConnected,
  getWalletAddress,
} from '@/lib/betting';

// GET - Get wallet info
export async function GET() {
  try {
    // Check if we have a stored wallet
    const storedWallet = getWallet();

    if (!storedWallet?.private_key) {
      return NextResponse.json({
        connected: false,
        address: null,
      });
    }

    // Load wallet if not already loaded
    if (!isWalletConnected()) {
      loadWallet(storedWallet.private_key);
    }

    // Get wallet info
    try {
      const info = await getWalletInfo();
      return NextResponse.json(info);
    } catch {
      // Return basic info if balance fetch fails
      return NextResponse.json({
        connected: true,
        address: getWalletAddress(),
        usdtBalance: '0',
        nativeBalance: '0',
        tokenSymbol: 'USDT',
        nativeSymbol: 'MATIC',
        chainName: 'Polygon',
        chainId: 137,
      });
    }
  } catch (error) {
    console.error('Error getting wallet info:', error);
    return NextResponse.json(
      { error: 'Failed to get wallet info' },
      { status: 500 }
    );
  }
}

// POST - Connect wallet with private key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { privateKey, action } = body;

    // Generate new wallet
    if (action === 'generate') {
      const newWallet = generateWallet();
      return NextResponse.json({
        address: newWallet.address,
        privateKey: newWallet.privateKey,
        message: 'New wallet generated. Save the private key securely!',
      });
    }

    // Connect with private key
    if (!privateKey) {
      return NextResponse.json(
        { error: 'Private key is required' },
        { status: 400 }
      );
    }

    if (!isValidPrivateKey(privateKey)) {
      return NextResponse.json(
        { error: 'Invalid private key' },
        { status: 400 }
      );
    }

    const address = getAddressFromPrivateKey(privateKey);

    // Save to database
    saveWallet(privateKey, address);

    // Load wallet
    loadWallet(privateKey);

    // Get full wallet info
    try {
      const info = await getWalletInfo();
      return NextResponse.json(info);
    } catch {
      return NextResponse.json({
        connected: true,
        address,
        usdtBalance: '0',
        nativeBalance: '0',
        tokenSymbol: 'USDT',
        nativeSymbol: 'MATIC',
        chainName: 'Polygon',
        chainId: 137,
      });
    }
  } catch (error) {
    console.error('Error connecting wallet:', error);
    return NextResponse.json(
      { error: 'Failed to connect wallet' },
      { status: 500 }
    );
  }
}

// DELETE - Disconnect wallet
export async function DELETE() {
  try {
    clearWallet();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting wallet:', error);
    return NextResponse.json(
      { error: 'Failed to disconnect wallet' },
      { status: 500 }
    );
  }
}
