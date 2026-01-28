// Azuro Protocol Configuration

// RPC endpoints with fallbacks for reliability
export const POLYGON_RPC_ENDPOINTS = [
  'https://polygon-rpc.com',
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
];

export const CHAINS = {
  polygon: {
    id: 137,
    name: 'Polygon',
    rpc: POLYGON_RPC_ENDPOINTS[0], // Primary: polygon-rpc.com
    graphql: 'https://thegraph.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3',
    dataFeed: 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-polygon',
    token: 'USDT',
    tokenDecimals: 6,
    contracts: {
      lp: '0x7043E4e1c4045424858ECBCED80989FeAfC11B36',
      prematchCore: '0x7f3F3f19c4e4015fd9Db2f22e653571571B0E6A4',
      azuroBet: '0xA5A925E17cB1E2494893f38A9a9E39a643dCaEa4',
    }
  },
  gnosis: {
    id: 100,
    name: 'Gnosis',
    rpc: 'https://rpc.gnosischain.com',
    graphql: 'https://thegraph.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-api-gnosis-v3',
    dataFeed: 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-gnosis',
    token: 'WXDAI',
    tokenDecimals: 18,
    contracts: {
      lp: '0xac004b512c33d029cf23abf04513f1f380b3fd0a',
      prematchCore: '0xA40F8D69D412b79b49EAbdD5cf1b5706395bfCf7',
      azuroBet: '0xfD539a63e3b87e723D90fCFd6Ab41e0BB4D9C6F9',
    }
  },
  polygonAmoy: {
    id: 80002,
    name: 'Polygon Amoy (Testnet)',
    rpc: 'https://rpc-amoy.polygon.technology',
    graphql: 'https://thegraph.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-api-polygon-amoy-dev-v3',
    dataFeed: 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-polygon',
    token: 'USDT',
    tokenDecimals: 6,
    contracts: {
      lp: '0x6E9A55a686F9C7dDE5C24A22a29EF0074C7e2907',
      prematchCore: '0xE0dF0B6D749058E443aD9FF6C57a1F2F2543DCF8',
      azuroBet: '0x96bE254bE4c0bCE9FC1E28b4E8B8e4C26c514D8e',
    }
  }
} as const;

export type ChainKey = keyof typeof CHAINS;

// LP Contract ABI (key functions)
export const LP_ABI = [
  'function bet(address core, uint128 amount, uint64 expiresAt, tuple(address affiliate, bytes data, uint64 minOdds) betData) external returns (uint256)',
  'function withdrawPayout(address core, uint256 tokenId) external',
  'function viewPayout(address core, uint256 tokenId) external view returns (uint128)',
  'function token() external view returns (address)',
  'event NewBet(address indexed owner, uint256 indexed betId, uint256 indexed conditionId, uint64 outcomeId, uint128 amount, uint64 odds, uint128 fund1, uint128 fund2)',
];

// ERC20 ABI for token approval
export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// AzuroBet NFT ABI for checking bet ownership
export const AZURO_BET_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function getBetInfo(uint256 betId) external view returns (uint128 amount, uint64 odds, uint64 createdAt)',
];

// Core Contract ABI
export const CORE_ABI = [
  'function calcOdds(uint256 conditionId, uint128 amount, uint64 outcomeId) external view returns (uint64)',
  'function getCondition(uint256 conditionId) external view returns (tuple(uint128[2] fundBank, uint128[2] payoutLimit, uint128 reinforcement, uint128 margin, bytes32 ipfsHash, uint64[2] outcomes, uint128 scopeId, uint64 outcomeWin, uint8 state, bool isExpressForbidden))',
];

// GraphQL Queries for Data Feed (games/sports)
export const DATA_FEED_QUERIES = {
  games: `
    query Games($where: Game_filter, $first: Int!, $skip: Int!) {
      games(
        first: $first
        skip: $skip
        where: $where
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
          outcomes {
            outcomeId
            currentOdds
          }
        }
      }
    }
  `,

  // Live games query - fetches games that have already started
  // Orders by startsAt descending to show most recently started games first
  liveGames: `
    query LiveGames($where: Game_filter, $first: Int!, $skip: Int!) {
      games(
        first: $first
        skip: $skip
        where: $where
        orderBy: startsAt
        orderDirection: desc
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
          outcomes {
            outcomeId
            currentOdds
          }
        }
      }
    }
  `,

  sports: `
    query Sports {
      sports(first: 100) {
        sportId
        name
        slug
      }
    }
  `,
};

// GraphQL Queries for Client API (bets/history)
export const QUERIES = {
  games: `
    query Games($where: Game_filter, $first: Int!, $skip: Int!) {
      games(
        first: $first
        skip: $skip
        where: $where
        orderBy: startsAt
        orderDirection: asc
      ) {
        id
        gameId
        slug
        title
        startsAt
        status
        hasActiveConditions
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
        conditions(where: { status: "Created" }) {
          conditionId
          status
          outcomes {
            outcomeId
            currentOdds
          }
        }
      }
    }
  `,

  game: `
    query Game($id: ID!) {
      game(id: $id) {
        id
        gameId
        title
        startsAt
        status
        sport {
          name
        }
        league {
          name
        }
        participants {
          name
        }
        conditions {
          conditionId
          status
          outcomes {
            outcomeId
            currentOdds
          }
        }
      }
    }
  `,

  bets: `
    query Bets($where: Bet_filter!, $first: Int!) {
      bets(
        first: $first
        where: $where
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
        createdBlockTimestamp
        potentialPayout
        outcome {
          outcomeId
          currentOdds
          condition {
            conditionId
            game {
              title
              participants {
                name
              }
            }
          }
        }
      }
    }
  `,
};

// Comprehensive Azuro outcome ID mappings
// Azuro uses numeric outcome IDs that map to specific betting market outcomes
export const OUTCOME_NAMES: Record<string, string> = {
  // ============================================
  // 1X2 (Match Result / Full Time Result)
  // ============================================
  '29': 'Home Win',
  '30': 'Draw',
  '31': 'Away Win',

  // ============================================
  // Double Chance
  // ============================================
  '1': 'Home or Draw',
  '2': 'Away or Draw',
  '3': 'Home or Away',

  // ============================================
  // Both Teams to Score (BTTS)
  // ============================================
  '21': 'Yes',
  '22': 'No',

  // ============================================
  // Over/Under Total Goals
  // ============================================
  '27': 'Over',
  '28': 'Under',
  // Alternative Over/Under IDs used in some markets
  '153': 'Over',
  '154': 'Under',
  '155': 'Over',
  '156': 'Under',
  '157': 'Over',
  '158': 'Under',
  '159': 'Over',
  '160': 'Under',

  // ============================================
  // Asian Handicap / Handicap
  // ============================================
  '4': 'Home +handicap',
  '5': 'Away +handicap',
  '6': 'Home -handicap',
  '7': 'Away -handicap',
  '8': 'Home Handicap',
  '9': 'Away Handicap',

  // ============================================
  // Odd/Even Total Goals
  // ============================================
  '23': 'Odd',
  '24': 'Even',

  // ============================================
  // Halftime Result
  // ============================================
  '32': 'Home (HT)',
  '33': 'Draw (HT)',
  '34': 'Away (HT)',

  // ============================================
  // Halftime/Fulltime (HT/FT)
  // ============================================
  '35': 'Home/Home',
  '36': 'Home/Draw',
  '37': 'Home/Away',
  '38': 'Draw/Home',
  '39': 'Draw/Draw',
  '40': 'Draw/Away',
  '41': 'Away/Home',
  '42': 'Away/Draw',
  '43': 'Away/Away',

  // ============================================
  // Correct Score (Most Common Scorelines)
  // ============================================
  // Home wins
  '44': '1-0',
  '45': '2-0',
  '46': '2-1',
  '47': '3-0',
  '48': '3-1',
  '49': '3-2',
  '50': '4-0',
  '51': '4-1',
  '52': '4-2',
  '53': '4-3',
  // Draws
  '54': '0-0',
  '55': '1-1',
  '56': '2-2',
  '57': '3-3',
  '58': '4-4',
  // Away wins
  '59': '0-1',
  '60': '0-2',
  '61': '1-2',
  '62': '0-3',
  '63': '1-3',
  '64': '2-3',
  '65': '0-4',
  '66': '1-4',
  '67': '2-4',
  '68': '3-4',
  // Other/Any other score
  '69': 'Any Other Score',

  // ============================================
  // Total Goals Exact
  // ============================================
  '70': '0 Goals',
  '71': '1 Goal',
  '72': '2 Goals',
  '73': '3 Goals',
  '74': '4 Goals',
  '75': '5 Goals',
  '76': '6+ Goals',

  // ============================================
  // Team Total Goals (Home)
  // ============================================
  '77': 'Home Over',
  '78': 'Home Under',

  // ============================================
  // Team Total Goals (Away)
  // ============================================
  '79': 'Away Over',
  '80': 'Away Under',

  // ============================================
  // First/Last Goal Scorer Team
  // ============================================
  '81': 'Home First Goal',
  '82': 'Away First Goal',
  '83': 'No Goal',
  '84': 'Home Last Goal',
  '85': 'Away Last Goal',

  // ============================================
  // Clean Sheet
  // ============================================
  '86': 'Home Clean Sheet Yes',
  '87': 'Home Clean Sheet No',
  '88': 'Away Clean Sheet Yes',
  '89': 'Away Clean Sheet No',

  // ============================================
  // Win to Nil
  // ============================================
  '90': 'Home Win to Nil',
  '91': 'Away Win to Nil',
  '92': 'No Win to Nil',

  // ============================================
  // To Win Either Half
  // ============================================
  '93': 'Home Either Half',
  '94': 'Away Either Half',

  // ============================================
  // To Win Both Halves
  // ============================================
  '95': 'Home Both Halves',
  '96': 'Away Both Halves',

  // ============================================
  // Draw No Bet
  // ============================================
  '97': 'Home (DNB)',
  '98': 'Away (DNB)',

  // ============================================
  // European Handicap
  // ============================================
  '99': 'Home EH',
  '100': 'Draw EH',
  '101': 'Away EH',

  // ============================================
  // Corners - Over/Under
  // ============================================
  '102': 'Corners Over',
  '103': 'Corners Under',

  // ============================================
  // Cards - Over/Under
  // ============================================
  '104': 'Cards Over',
  '105': 'Cards Under',

  // ============================================
  // Winning Margin
  // ============================================
  '106': 'Home by 1',
  '107': 'Home by 2',
  '108': 'Home by 3+',
  '109': 'Draw',
  '110': 'Away by 1',
  '111': 'Away by 2',
  '112': 'Away by 3+',

  // ============================================
  // Goal Scoring Range
  // ============================================
  '113': '0-1 Goals',
  '114': '2-3 Goals',
  '115': '4-5 Goals',
  '116': '6+ Goals',

  // ============================================
  // First Half Goals Over/Under
  // ============================================
  '117': '1H Over',
  '118': '1H Under',

  // ============================================
  // Second Half Goals Over/Under
  // ============================================
  '119': '2H Over',
  '120': '2H Under',

  // ============================================
  // Both Teams Score - First Half
  // ============================================
  '121': 'BTTS 1H Yes',
  '122': 'BTTS 1H No',

  // ============================================
  // Both Teams Score - Second Half
  // ============================================
  '123': 'BTTS 2H Yes',
  '124': 'BTTS 2H No',

  // ============================================
  // Result & Both Teams Score
  // ============================================
  '125': 'Home & BTTS Yes',
  '126': 'Home & BTTS No',
  '127': 'Draw & BTTS Yes',
  '128': 'Draw & BTTS No',
  '129': 'Away & BTTS Yes',
  '130': 'Away & BTTS No',

  // ============================================
  // Result & Over/Under
  // ============================================
  '131': 'Home & Over',
  '132': 'Home & Under',
  '133': 'Draw & Over',
  '134': 'Draw & Under',
  '135': 'Away & Over',
  '136': 'Away & Under',

  // ============================================
  // Highest Scoring Half
  // ============================================
  '137': '1st Half Highest',
  '138': '2nd Half Highest',
  '139': 'Equal Halves',

  // ============================================
  // Multi-Goal / Goal Range
  // ============================================
  '140': '1-2 Goals',
  '141': '1-3 Goals',
  '142': '1-4 Goals',
  '143': '2-4 Goals',
  '144': '2-5 Goals',
  '145': '3-5 Goals',
  '146': '3-6 Goals',

  // ============================================
  // Home Team Score
  // ============================================
  '147': 'Home to Score Yes',
  '148': 'Home to Score No',

  // ============================================
  // Away Team Score
  // ============================================
  '149': 'Away to Score Yes',
  '150': 'Away to Score No',

  // ============================================
  // Team to Score First
  // ============================================
  '151': 'Home Scores First',
  '152': 'Away Scores First',

  // ============================================
  // Total Goals (alternative IDs)
  // ============================================
  '25': 'Over',
  '26': 'Under',

  // ============================================
  // Total Goals Odd/Even
  // ============================================
  '173': 'Even',
  '174': 'Odd',

  // ============================================
  // 1st Half - Double Chance
  // ============================================
  '6266': '1X (1H)',
  '6267': '2X (1H)',
  '6268': '12 (1H)',

  // ============================================
  // 2nd Half - Full Time Result
  // ============================================
  '16243': 'Home (2H)',
  '16244': 'Away (2H)',
  '16245': 'Draw (2H)',

  // ============================================
  // Half with Most Goals
  // ============================================
  '16435': '2nd Half Most',
  '16436': '1st Half Most',
  '16437': 'Equal Halves',
};

// Market type names based on condition patterns
// Used for displaying market categories
export const MARKET_TYPES: Record<string, string> = {
  // Main markets
  'full_time_result': 'Full Time Result',
  'match_result': 'Match Result',
  '1x2': '1X2',
  'double_chance': 'Double Chance',
  'draw_no_bet': 'Draw No Bet',

  // Goals markets
  'over_under': 'Over/Under',
  'total_goals': 'Total Goals',
  'both_teams_to_score': 'Both Teams to Score',
  'btts': 'BTTS',
  'exact_goals': 'Exact Goals',
  'team_total': 'Team Total',
  'home_total': 'Home Team Total',
  'away_total': 'Away Team Total',

  // Score markets
  'correct_score': 'Correct Score',
  'halftime_fulltime': 'Halftime/Fulltime',
  'ht_ft': 'HT/FT',
  'first_half_result': 'First Half Result',
  'second_half_result': 'Second Half Result',

  // Handicap markets
  'handicap': 'Handicap',
  'asian_handicap': 'Asian Handicap',
  'european_handicap': 'European Handicap',

  // Special markets
  'odd_even': 'Odd/Even',
  'winning_margin': 'Winning Margin',
  'clean_sheet': 'Clean Sheet',
  'win_to_nil': 'Win to Nil',
  'first_goal': 'First Goal',
  'last_goal': 'Last Goal',

  // Corners and cards
  'corners': 'Corners',
  'cards': 'Cards',
  'bookings': 'Bookings',
};
