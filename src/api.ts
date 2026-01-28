import { GraphQLClient } from 'graphql-request';
import { CHAINS, QUERIES, DATA_FEED_QUERIES, ChainKey } from './config.js';

export interface Game {
  id: string;
  gameId: string;
  slug: string;
  title: string;
  startsAt: string;
  status?: string;
  sport: {
    sportId: string;
    name: string;
    slug: string;
  };
  league: {
    name: string;
    slug: string;
    country: {
      name: string;
      slug: string;
    };
  };
  participants: {
    name: string;
    image: string;
  }[];
  conditions: {
    conditionId: string;
    status?: string;
    outcomes: {
      outcomeId: string;
      currentOdds: string;
    }[];
  }[];
}

export interface Bet {
  id: string;
  betId: string;
  amount: string;
  odds: string;
  settledOdds: string;
  status: string;
  result: string;
  isRedeemed: boolean;
  payout: string;
  potentialPayout: string;
  createdBlockTimestamp: string;
  outcome: {
    outcomeId: string;
    currentOdds: string;
    condition: {
      conditionId: string;
      game: {
        title: string;
        participants: { name: string }[];
      };
    };
  };
}

export interface Sport {
  sportId: string;
  name: string;
  slug: string;
}

export class AzuroAPI {
  private client: GraphQLClient;
  private dataFeedClient: GraphQLClient;
  private chain: ChainKey;

  constructor(chain: ChainKey = 'polygon') {
    this.chain = chain;
    this.client = new GraphQLClient(CHAINS[chain].graphql);
    this.dataFeedClient = new GraphQLClient(CHAINS[chain].dataFeed);
  }

  getChain() {
    return CHAINS[this.chain];
  }

  async getSports(): Promise<Sport[]> {
    const data = await this.dataFeedClient.request<{ sports: Sport[] }>(DATA_FEED_QUERIES.sports);
    return data.sports;
  }

  async getGames(options: {
    sportSlug?: string;
    limit?: number;
    skip?: number;
  } = {}): Promise<Game[]> {
    const { sportSlug, limit = 50, skip = 0 } = options;

    // Data feed doesn't have 'status' or 'hasActiveConditions' filters
    // Use startsAt_gt with current timestamp to only show future games
    const currentTimestamp = Math.floor(Date.now() / 1000).toString();
    const where: Record<string, unknown> = {
      startsAt_gt: currentTimestamp,
    };

    if (sportSlug) {
      where.sport_ = { slug: sportSlug };
    }

    const data = await this.dataFeedClient.request<{ games: Game[] }>(DATA_FEED_QUERIES.games, {
      where,
      first: limit,
      skip,
    });

    return data.games;
  }

  async getLiveGames(options: {
    sportSlug?: string;
    limit?: number;
    skip?: number;
  } = {}): Promise<Game[]> {
    const { sportSlug, limit = 50, skip = 0 } = options;

    // Live games have already started (startsAt in the past)
    // and have active conditions for betting
    const currentTimestamp = Math.floor(Date.now() / 1000).toString();
    const where: Record<string, unknown> = {
      startsAt_lt: currentTimestamp, // Games that have started
    };

    if (sportSlug) {
      where.sport_ = { slug: sportSlug };
    }

    const data = await this.dataFeedClient.request<{ games: Game[] }>(DATA_FEED_QUERIES.liveGames, {
      where,
      first: limit,
      skip,
    });

    // Filter out games with no active conditions (already finished)
    return data.games.filter(game => game.conditions && game.conditions.length > 0);
  }

  async getGame(gameId: string): Promise<Game | null> {
    const data = await this.client.request<{ game: Game }>(QUERIES.game, {
      id: gameId,
    });
    return data.game;
  }

  async getBets(bettor: string, options: {
    limit?: number;
    status?: string;
  } = {}): Promise<Bet[]> {
    const { limit = 50, status } = options;

    const where: Record<string, unknown> = {
      actor: bettor.toLowerCase(),
    };

    if (status) {
      where.status = status;
    }

    const data = await this.client.request<{ bets: Bet[] }>(QUERIES.bets, {
      where,
      first: limit,
    });

    return data.bets;
  }

  async getWinnableBets(bettor: string): Promise<Bet[]> {
    const bets = await this.getBets(bettor, { status: 'Resolved' });
    return bets.filter(bet => bet.result === 'Won' && !bet.isRedeemed);
  }

  formatOdds(rawOdds: string): number {
    // currentOdds from the API is already a decimal string (e.g., "1.387433335309")
    // representing the actual decimal odds, no conversion needed
    return parseFloat(rawOdds);
  }

  formatAmount(rawAmount: string, decimals: number): number {
    return parseFloat(rawAmount) / Math.pow(10, decimals);
  }
}
