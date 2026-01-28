// Test script to investigate Azuro condition IDs and fields
import { GraphQLClient, gql } from 'graphql-request';
import { getMarketKey, getMarketName, getSelectionName, dictionaries } from '@azuro-org/dictionaries';

const ENDPOINT = 'https://thegraph.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3';

// Query with ALL available condition fields
const FULL_CONDITION_QUERY = gql`
  query GetGameWithFullConditions($gameId: ID!) {
    game(id: $gameId) {
      id
      gameId
      title
      startsAt
      status
      sport {
        sportId
        name
        slug
      }
      league {
        leagueId
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
      conditions(first: 10) {
        id
        conditionId
        status
        gameId
        margin
        reinforcement
        provider
        isExpressForbidden
        wonOutcomeIds
        outcomes {
          id
          outcomeId
          fund
          currentOdds
          sortOrder
          isWinning
        }
      }
    }
  }
`;

// Try to find markets/marketName field - query the schema
const INTROSPECTION_CONDITION = gql`
  query {
    __type(name: "Condition") {
      name
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
  }
`;

const INTROSPECTION_GAME = gql`
  query {
    __type(name: "Game") {
      name
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
  }
`;

async function main() {
  const client = new GraphQLClient(ENDPOINT);

  console.log('=== 1. INTROSPECTING CONDITION TYPE ===\n');
  try {
    const conditionSchema = await client.request(INTROSPECTION_CONDITION);
    console.log('Condition fields:');
    conditionSchema.__type.fields.forEach(f => {
      const typeName = f.type.name || (f.type.ofType ? f.type.ofType.name : f.type.kind);
      console.log(`  - ${f.name}: ${typeName}`);
    });
  } catch (e) {
    console.log('Error introspecting:', e.message);
  }

  console.log('\n=== 2. INTROSPECTING GAME TYPE ===\n');
  try {
    const gameSchema = await client.request(INTROSPECTION_GAME);
    console.log('Game fields:');
    gameSchema.__type.fields.forEach(f => {
      const typeName = f.type.name || (f.type.ofType ? f.type.ofType.name : f.type.kind);
      console.log(`  - ${f.name}: ${typeName}`);
    });
  } catch (e) {
    console.log('Error introspecting:', e.message);
  }

  // First, get a recent game
  console.log('\n=== 3. FETCHING A LIVE GAME ===\n');

  const gamesQuery = gql`
    query {
      games(first: 1, where: { status: "Created", hasActiveConditions: true }) {
        id
        gameId
        title
      }
    }
  `;

  const gamesResult = await client.request(gamesQuery);
  if (!gamesResult.games || gamesResult.games.length === 0) {
    console.log('No active games found');
    return;
  }

  const gameId = gamesResult.games[0].id;
  console.log(`Found game: ${gamesResult.games[0].title} (ID: ${gameId})`);

  console.log('\n=== 4. FETCHING FULL CONDITION DATA ===\n');

  try {
    const gameData = await client.request(FULL_CONDITION_QUERY, { gameId });
    console.log('Game:', gameData.game.title);
    console.log('Sport:', gameData.game.sport?.name);
    console.log('League:', gameData.game.league?.name);
    console.log('\nConditions (first 10):');

    gameData.game.conditions.forEach((condition, idx) => {
      console.log(`\n--- Condition ${idx + 1} ---`);
      console.log('Raw condition object:');
      console.log(JSON.stringify(condition, null, 2));
    });
  } catch (e) {
    console.log('Error fetching game:', e.message);
  }

  console.log('\n=== 5. TESTING @azuro-org/dictionaries ===\n');

  // Test decoding the long condition ID
  const testConditionId = '300610060000000000797342120000000000001569928465';
  console.log(`Testing condition ID: ${testConditionId}`);

  // The condition ID itself doesn't decode - it's the outcomeId that matters
  // Let's test with some known outcomeIds
  const testOutcomeIds = ['29', '30', '31', '27', '28', '21', '22', '1', '2', '3'];

  console.log('\nOutcome ID -> Market Name mapping:');
  testOutcomeIds.forEach(outcomeId => {
    try {
      const marketKey = getMarketKey(outcomeId);
      const marketName = getMarketName({ outcomeId });
      const selectionName = getSelectionName({ outcomeId });
      console.log(`  OutcomeId ${outcomeId}: Market="${marketName}" (Key=${marketKey}), Selection="${selectionName}"`);
    } catch (e) {
      console.log(`  OutcomeId ${outcomeId}: Error - ${e.message}`);
    }
  });

  console.log('\n=== 6. AVAILABLE DICTIONARIES ===\n');

  console.log('Market Names (first 20):');
  const marketNameEntries = Object.entries(dictionaries.marketNames).slice(0, 20);
  marketNameEntries.forEach(([key, name]) => {
    console.log(`  ${key}: ${name}`);
  });

  console.log('\nSelections (first 20):');
  const selectionEntries = Object.entries(dictionaries.selections).slice(0, 20);
  selectionEntries.forEach(([key, name]) => {
    console.log(`  ${key}: ${name}`);
  });

  console.log('\nGame Types:');
  Object.entries(dictionaries.gameTypes).forEach(([key, name]) => {
    console.log(`  ${key}: ${name}`);
  });

  console.log('\nGame Periods:');
  Object.entries(dictionaries.gamePeriods).forEach(([key, name]) => {
    console.log(`  ${key}: ${name}`);
  });

  console.log('\n=== 7. OUTCOME STRUCTURE EXAMPLE ===\n');
  const outcomeEntries = Object.entries(dictionaries.outcomes).slice(0, 10);
  outcomeEntries.forEach(([outcomeId, data]) => {
    console.log(`OutcomeId ${outcomeId}:`, data);
  });
}

main().catch(console.error);
