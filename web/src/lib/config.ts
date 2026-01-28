import { ChainConfig } from './types';

export const CHAINS: Record<string, ChainConfig> = {
  polygon: {
    id: 137,
    name: 'Polygon',
    rpc: 'https://polygon-rpc.com',
    token: {
      symbol: 'USDT',
      decimals: 6,
      address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    },
    contracts: {
      // V3 contracts - NOW ACTIVE (data feed provides V3 games)
      lp: '0x0FA7FB5407eA971694652E6E16C12A52625DE1b8',      // V3 LP
      core: '0xF9548Be470A4e130c90ceA8b179FCD66D2972AC7',    // V3 ClientCore
      // V2 contracts (legacy - kept for reference)
      v2Lp: '0x7043E4e1c4045424858ECBCED80989FeAfC11B36',
      v2Core: '0xA40F8D69D412b79b49EAbdD5cf1b5706395bfCf7', // V2 PrematchCore
      relayer: '0x8dA05c0021e6b35865FDC959c54dCeF3A4AbBa9d',
      azuroBet: '0x7A1c3FEf712753374C4DCe34254B96faF2B7265B',
      cashout: '0x4a2BB4211cCF9b9eA6eF01D0a61448154ED19095',
      betExpress: '0x92a4e8Bc6B92a2e1ced411f41013B5FE6BE07613',
    },
    graphql: {
      // V3: Feed data (games, conditions, odds) from data-feed graph
      dataFeed: 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-polygon',
      // V3: Client data (bets, history) from client API graph
      client: 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3',
    },
    websocket: {
      url: 'wss://streams.onchainfeed.org/v1/streams/feed',
      environment: 'PolygonUSDT',
    },
  },
  gnosis: {
    id: 100,
    name: 'Gnosis',
    rpc: 'https://rpc.gnosischain.com',
    token: {
      symbol: 'WXDAI',
      decimals: 18,
      address: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
    },
    contracts: {
      lp: '0xac004b512c33D029cf23ABf04513f1f380B3FD0a',
      core: '0x7f3f3F19c4E4015fD9Db2F22e653571571b0e6a4', // V2 PrematchCore used as core
      prematchCore: '0x7f3f3F19c4E4015fD9Db2F22e653571571b0e6a4',
    },
    graphql: {
      dataFeed: 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-gnosis',
      client: 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-gnosis-v3',
    },
    websocket: {
      url: 'wss://streams.onchainfeed.org/v1/streams/feed',
      environment: 'GnosisXDAI',
    },
  },
  polygonAmoy: {
    id: 80002,
    name: 'Polygon Amoy (Testnet)',
    rpc: 'https://rpc-amoy.polygon.technology',
    token: {
      symbol: 'AZUSD',
      decimals: 6,
      address: '0x8b7B8a1D8f8B8c5b6c7d8e9f0a1b2c3d4e5f6a7b',
    },
    contracts: {
      lp: '0x...',
      core: '0x...', // Testnet core address
      prematchCore: '0x...',
    },
    graphql: {
      dataFeed: 'https://thegraph.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-api-polygon-amoy-v3',
      client: 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-amoy-v3',
    },
    websocket: {
      url: 'wss://streams.onchainfeed.org/v1/streams/feed',
      environment: 'PolygonAmoyAZUSD',
    },
  },
};

export const DEFAULT_CHAIN = 'polygon';

export function getChainConfig(chain: string = DEFAULT_CHAIN): ChainConfig {
  return CHAINS[chain] || CHAINS[DEFAULT_CHAIN];
}

// Contract ABIs (minimal versions for web)
// BetData struct: { address affiliate, uint64 minOdds, bytes data }
export const LP_ABI = [
  'function token() view returns (address)',
  'function bet(address core, uint128 amount, uint64 expiresAt, tuple(address affiliate, uint64 minOdds, bytes data) betData) returns (uint256)',
  'function withdrawPayout(address core, uint256 tokenId) returns (uint256)',
  'function withdrawPayouts(address core, uint256[] tokenIds) returns (uint256)',
  'function viewPayout(address core, uint256 tokenId) view returns (uint256)',
];

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// GraphQL queries
export const QUERIES = {
  sports: `
    query GetSports {
      sports {
        sportId
        name
        slug
      }
    }
  `,

  games: `
    query GetGames($startsAt_gt: BigInt!, $startsAt_lt: BigInt!, $first: Int!) {
      games(
        where: {
          startsAt_gt: $startsAt_gt
          startsAt_lt: $startsAt_lt
        }
        first: $first
        orderBy: startsAt
        orderDirection: asc
      ) {
        id
        gameId
        slug
        title
        startsAt
        sport {
          sportId
          name
          slug
        }
        league {
          name
          slug
          country {
            name
            slug
          }
        }
        participants {
          name
          image
        }
        conditions {
          conditionId
          state
          isPrematchEnabled
          isLiveEnabled
          outcomes {
            outcomeId
            currentOdds
            title
          }
        }
      }
    }
  `,

  gamesBySport: `
    query GetGamesBySport($sportSlug: String!, $startsAt_gt: BigInt!, $startsAt_lt: BigInt!, $first: Int!) {
      games(
        where: {
          sport_: { slug: $sportSlug }
          startsAt_gt: $startsAt_gt
          startsAt_lt: $startsAt_lt
        }
        first: $first
        orderBy: startsAt
        orderDirection: asc
      ) {
        id
        gameId
        slug
        title
        startsAt
        sport {
          sportId
          name
          slug
        }
        league {
          name
          slug
          country {
            name
            slug
          }
        }
        participants {
          name
          image
        }
        conditions {
          conditionId
          state
          isPrematchEnabled
          isLiveEnabled
          outcomes {
            outcomeId
            currentOdds
            title
          }
        }
      }
    }
  `,

  liveGames: `
    query GetLiveGames($startsAt_lt: BigInt!, $startsAt_gt: BigInt!, $first: Int!) {
      games(
        where: {
          startsAt_lt: $startsAt_lt
          startsAt_gt: $startsAt_gt
          state: Live
        }
        first: $first
        orderBy: startsAt
        orderDirection: desc
      ) {
        id
        gameId
        slug
        title
        startsAt
        state
        sport {
          sportId
          name
          slug
        }
        league {
          name
          slug
          country {
            name
            slug
          }
        }
        participants {
          name
          image
        }
        conditions {
          conditionId
          state
          isPrematchEnabled
          isLiveEnabled
          outcomes {
            outcomeId
            currentOdds
            title
          }
        }
      }
    }
  `,

  liveGamesBySport: `
    query GetLiveGamesBySport($sportSlug: String!, $startsAt_lt: BigInt!, $startsAt_gt: BigInt!, $first: Int!) {
      games(
        where: {
          sport_: { slug: $sportSlug }
          startsAt_lt: $startsAt_lt
          startsAt_gt: $startsAt_gt
          state: Live
        }
        first: $first
        orderBy: startsAt
        orderDirection: desc
      ) {
        id
        gameId
        slug
        title
        startsAt
        state
        sport {
          sportId
          name
          slug
        }
        league {
          name
          slug
          country {
            name
            slug
          }
        }
        participants {
          name
          image
        }
        conditions {
          conditionId
          state
          isPrematchEnabled
          isLiveEnabled
          outcomes {
            outcomeId
            currentOdds
            title
          }
        }
      }
    }
  `,

  // Search games by team/title name
  searchGames: `
    query SearchGames($sportSlug: String!, $search: String!, $startsAt_gt: BigInt!, $startsAt_lt: BigInt!, $first: Int!) {
      games(
        where: {
          sport_: { slug: $sportSlug }
          startsAt_gt: $startsAt_gt
          startsAt_lt: $startsAt_lt
          title_contains_nocase: $search
        }
        first: $first
        orderBy: startsAt
        orderDirection: asc
      ) {
        id
        gameId
        slug
        title
        startsAt
        sport {
          sportId
          name
          slug
        }
        league {
          name
          slug
          country {
            name
            slug
          }
        }
        participants {
          name
          image
        }
        conditions {
          conditionId
          state
          isPrematchEnabled
          isLiveEnabled
          outcomes {
            outcomeId
            currentOdds
            title
          }
        }
      }
    }
  `,

  searchLiveGames: `
    query SearchLiveGames($sportSlug: String!, $search: String!, $startsAt_lt: BigInt!, $startsAt_gt: BigInt!, $first: Int!) {
      games(
        where: {
          sport_: { slug: $sportSlug }
          startsAt_lt: $startsAt_lt
          startsAt_gt: $startsAt_gt
          title_contains_nocase: $search
          state: Live
        }
        first: $first
        orderBy: startsAt
        orderDirection: desc
      ) {
        id
        gameId
        slug
        title
        startsAt
        state
        sport {
          sportId
          name
          slug
        }
        league {
          name
          slug
          country {
            name
            slug
          }
        }
        participants {
          name
          image
        }
        conditions {
          conditionId
          state
          isPrematchEnabled
          isLiveEnabled
          outcomes {
            outcomeId
            currentOdds
            title
          }
        }
      }
    }
  `,

  game: `
    query GetGame($gameId: ID!) {
      game(id: $gameId) {
        id
        gameId
        slug
        title
        startsAt
        state
        sport {
          sportId
          name
          slug
        }
        league {
          name
          slug
          country {
            name
            slug
          }
        }
        participants {
          name
          image
        }
        conditions {
          conditionId
          state
          isPrematchEnabled
          isLiveEnabled
          outcomes {
            outcomeId
            currentOdds
            title
          }
        }
      }
    }
  `,

  bets: `
    query GetBets($bettor: String!, $status: BetStatus, $first: Int) {
      bets(
        where: {
          actor: $bettor
          status: $status
        }
        first: $first
        orderBy: createdBlockTimestamp
        orderDirection: desc
      ) {
        id
        betId
        amount
        odds
        settledOdds
        status
        result
        isRedeemed
        payout
        potentialPayout
        createdBlockTimestamp
        selections {
          outcome {
            outcomeId
            condition {
              conditionId
              game {
                title
                gameId
                participants {
                  name
                }
              }
            }
          }
        }
      }
    }
  `,
};
