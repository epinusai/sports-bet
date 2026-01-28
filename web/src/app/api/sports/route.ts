import { NextResponse } from 'next/server';
import { getSports } from '@/lib/azuro-api';

export async function GET() {
  try {
    const sports = await getSports();
    return NextResponse.json({ sports });
  } catch (error) {
    console.error('Error fetching sports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sports' },
      { status: 500 }
    );
  }
}
