import { NextRequest, NextResponse } from 'next/server';
import { getGames, getLiveGames } from '@/lib/azuro-api';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sportSlug = searchParams.get('sport') || undefined;
    const type = searchParams.get('type') || 'upcoming';
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = parseInt(searchParams.get('skip') || '0');
    const search = searchParams.get('search') || undefined;

    console.log('[GamesAPI] Fetching games:', { type, sportSlug, limit, skip, search });

    let games;
    if (type === 'live') {
      games = await getLiveGames({ sportSlug, limit, search });
    } else {
      games = await getGames({ sportSlug, limit, skip, search });
    }

    console.log('[GamesAPI] Fetched', games?.length || 0, 'games');

    const response = NextResponse.json({ games: games || [] });
    // Prevent caching to ensure fresh data
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    return response;
  } catch (error) {
    // Log the full error details
    console.error('[GamesAPI] Error fetching games:', error);

    // Extract useful error info
    let errorMessage = 'Failed to fetch games';
    let errorDetails = '';

    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || '';

      // Check for GraphQL/network errors
      if (errorMessage.includes('<!DOCTYPE') || errorMessage.includes('<html')) {
        errorMessage = 'GraphQL endpoint returned HTML instead of JSON (possibly down or rate limited)';
      }
    }

    // Check if error object has response property (from graphql-request)
    const gqlError = error as { response?: { status?: number; errors?: unknown[] } };
    if (gqlError.response) {
      console.error('[GamesAPI] GraphQL response error:', JSON.stringify(gqlError.response, null, 2));
      if (gqlError.response.errors) {
        errorDetails = JSON.stringify(gqlError.response.errors);
      }
    }

    return NextResponse.json(
      {
        error: errorMessage,
        details: errorDetails,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
