import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Use RAILWAY_VOLUME_MOUNT_PATH if available, otherwise fallback to local data folder
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'azuro.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initializeSchema();
  }
  return db;
}

function initializeSchema() {
  const database = db!;

  // Wallet info table
  database.exec(`
    CREATE TABLE IF NOT EXISTS wallet (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      private_key TEXT,
      address TEXT,
      chain TEXT DEFAULT 'polygon',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Bets table
  database.exec(`
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bet_id TEXT UNIQUE,
      tx_hash TEXT,
      game_id TEXT NOT NULL,
      game_title TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      outcome_name TEXT NOT NULL,
      odds REAL NOT NULL,
      amount REAL NOT NULL,
      potential_payout REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      result TEXT,
      payout REAL,
      placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      settled_at DATETIME
    )
  `);

  // Bet slip table (for persisting selections)
  database.exec(`
    CREATE TABLE IF NOT EXISTS bet_slip (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      game_title TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      outcome_id TEXT NOT NULL,
      outcome_name TEXT NOT NULL,
      odds REAL NOT NULL,
      market_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(condition_id, outcome_id)
    )
  `);

  // Settings table
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Initialize default settings
  const insertSetting = database.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);
  insertSetting.run('chain', 'polygon');
  insertSetting.run('auto_withdraw', 'false');
  insertSetting.run('slippage', '10');
}

// Wallet functions
export function getWallet() {
  const db = getDb();
  return db.prepare('SELECT * FROM wallet WHERE id = 1').get() as {
    private_key: string;
    address: string;
    chain: string;
  } | undefined;
}

export function saveWallet(privateKey: string, address: string, chain: string = 'polygon') {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO wallet (id, private_key, address, chain, updated_at)
    VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(privateKey, address, chain);
}

export function clearWallet() {
  const db = getDb();
  db.prepare('DELETE FROM wallet WHERE id = 1').run();
}

// Bet slip functions
export function getSlipSelections() {
  const db = getDb();
  return db.prepare('SELECT * FROM bet_slip ORDER BY created_at DESC').all() as SlipSelection[];
}

export function addSlipSelection(selection: Omit<SlipSelection, 'id' | 'created_at'>) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO bet_slip (game_id, game_title, condition_id, outcome_id, outcome_name, odds, market_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    selection.game_id,
    selection.game_title,
    selection.condition_id,
    selection.outcome_id,
    selection.outcome_name,
    selection.odds,
    selection.market_name
  );
}

export function removeSlipSelection(conditionId: string, outcomeId: string) {
  const db = getDb();
  db.prepare('DELETE FROM bet_slip WHERE condition_id = ? AND outcome_id = ?').run(conditionId, outcomeId);
}

export function clearSlip() {
  const db = getDb();
  db.prepare('DELETE FROM bet_slip').run();
}

export function updateSlipOdds(conditionId: string, outcomeId: string, newOdds: number) {
  const db = getDb();
  db.prepare('UPDATE bet_slip SET odds = ? WHERE condition_id = ? AND outcome_id = ?').run(newOdds, conditionId, outcomeId);
}

// Bets history functions
export interface SaveBetParams {
  bet_id: string | null;
  tx_hash: string | null;
  game_id: string;
  game_title: string;
  condition_id: string;
  outcome_id: string;
  outcome_name: string;
  odds: number;
  amount: number;
  potential_payout: number;
  status?: string;
}

export function saveBet(bet: SaveBetParams) {
  const db = getDb();
  db.prepare(`
    INSERT INTO bets (bet_id, tx_hash, game_id, game_title, condition_id, outcome_id, outcome_name, odds, amount, potential_payout, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    bet.bet_id,
    bet.tx_hash,
    bet.game_id,
    bet.game_title,
    bet.condition_id,
    bet.outcome_id,
    bet.outcome_name,
    bet.odds,
    bet.amount,
    bet.potential_payout,
    bet.status || 'pending'
  );
}

// Valid bet statuses:
// - 'pending': Just submitted, waiting for API confirmation
// - 'accepted': API confirmed the bet was accepted
// - 'processing': Being processed by relayer
// - 'settled': Bet has been resolved (won/lost)
// - 'canceled': Bet was canceled
// - 'rejected': Bet was rejected by API/relayer
// - 'failed': Bet failed (timeout, ghost bet cleanup)

export function updateBetStatus(betId: string, status: string, result?: string, payout?: number) {
  const db = getDb();
  db.prepare(`
    UPDATE bets SET status = ?, result = ?, payout = ?, settled_at = CURRENT_TIMESTAMP
    WHERE bet_id = ?
  `).run(status, result || null, payout || null, betId);
}

// Clean up ghost bets - bets older than 5 minutes with status 'pending' but no bet_id or tx_hash
// IMPORTANT: This is now a sync function that just returns potential ghosts
// Use cleanupGhostBetsAsync() to verify on blockchain before marking as failed
export function getPotentialGhostBets(): BetRecord[] {
  const db = getDb();

  // Find ghost bets: pending for > 5 minutes with no bet_id AND no tx_hash
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const potentialGhosts = db.prepare(`
    SELECT * FROM bets
    WHERE status IN ('pending', 'processing')
      AND (bet_id IS NULL OR bet_id = '')
      AND (tx_hash IS NULL OR tx_hash = '')
      AND placed_at < ?
  `).all(fiveMinutesAgo) as BetRecord[];

  return potentialGhosts;
}

// Async cleanup that verifies on blockchain before marking as failed
export async function cleanupGhostBetsAsync(walletAddress: string): Promise<{ recovered: number; failed: number }> {
  const potentialGhosts = getPotentialGhostBets();

  if (potentialGhosts.length === 0) {
    return { recovered: 0, failed: 0 };
  }

  console.log(`[CleanupGhostBets] Found ${potentialGhosts.length} potential ghost bets, verifying on blockchain...`);
  console.log(`[CleanupGhostBets] Wallet address: ${walletAddress}`);

  const CLIENT_API = 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3';
  const addr = walletAddress.toLowerCase();

  let recovered = 0;
  let failed = 0;

  // Query recent bets from blockchain (last 24 hours to catch older ghosts)
  const oneDayAgoTimestamp = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

  try {
    const query = `{
      v3Bets(
        first: 100,
        where: {
          actor: "${addr}",
          createdBlockTimestamp_gte: "${oneDayAgoTimestamp}"
        },
        orderBy: createdBlockTimestamp,
        orderDirection: desc
      ) {
        betId
        amount
        odds
        status
        createdTxHash
        createdBlockTimestamp
        selections {
          outcome {
            outcomeId
            condition {
              conditionId
            }
          }
        }
      }
    }`;

    console.log(`[CleanupGhostBets] Query timestamp >= ${oneDayAgoTimestamp} (${new Date(oneDayAgoTimestamp * 1000).toISOString()})`);

    const response = await fetch(CLIENT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error('[CleanupGhostBets] GraphQL errors:', data.errors);
      return { recovered: 0, failed: 0 };
    }

    const chainBets = data.data?.v3Bets || [];
    console.log(`[CleanupGhostBets] Found ${chainBets.length} recent bets on blockchain for ${addr}`);

    // Debug: Log first few chain bets
    if (chainBets.length > 0) {
      console.log('[CleanupGhostBets] Sample chain bets:');
      chainBets.slice(0, 5).forEach((bet: { betId: string; amount: string; selections: { outcome: { outcomeId: string; condition: { conditionId: string } } }[] }) => {
        const condIds = bet.selections?.map((s: { outcome: { condition: { conditionId: string } } }) => s.outcome.condition.conditionId) || [];
        console.log(`  - betId: ${bet.betId}, amount: ${bet.amount}, conditions: [${condIds.join(', ')}]`);
      });
    }

    // For each potential ghost, try to find matching bet on chain
    for (const ghost of potentialGhosts) {
      const ghostAmount = ghost.amount; // Already in USDT (e.g., 1.0)
      const ghostConditionId = ghost.condition_id;
      const ghostOutcomeId = ghost.outcome_id;
      const isCombo = ghost.outcome_name?.startsWith('COMBO:');

      console.log(`[CleanupGhostBets] Checking ghost #${ghost.id}: "${ghost.outcome_name}" amount=${ghostAmount} USDT, conditionId=${ghostConditionId}, outcomeId=${ghostOutcomeId}, isCombo=${isCombo}`);

      // Find matching bet on chain
      let matchedBet = null;

      for (const chainBet of chainBets) {
        // IMPORTANT: chainBet.amount is already in USDT (not wei) in V3 subgraph
        // The subgraph returns normalized amounts, not raw wei
        const chainAmount = parseFloat(chainBet.amount);

        // Get condition IDs and outcome IDs from chain bet
        const chainConditionIds = chainBet.selections?.map(
          (s: { outcome: { condition: { conditionId: string } } }) => s.outcome.condition.conditionId
        ) || [];
        const chainOutcomeIds = chainBet.selections?.map(
          (s: { outcome: { outcomeId: string } }) => s.outcome.outcomeId
        ) || [];

        // Debug logging for amount comparison
        const amountDiff = Math.abs(chainAmount - ghostAmount);
        const amountMatches = amountDiff <= ghostAmount * 0.05; // 5% tolerance

        // Check condition match
        const conditionMatches = chainConditionIds.includes(ghostConditionId);

        // Check outcome match
        const outcomeMatches = chainOutcomeIds.includes(ghostOutcomeId);

        // Log candidates that match at least one criterion
        if (amountMatches || conditionMatches) {
          console.log(`[CleanupGhostBets]   Candidate betId=${chainBet.betId}: amount=${chainAmount} (diff=${amountDiff.toFixed(4)}), conditions=[${chainConditionIds.join(',')}], outcomes=[${chainOutcomeIds.join(',')}]`);
          console.log(`[CleanupGhostBets]     amountMatch=${amountMatches}, conditionMatch=${conditionMatches}, outcomeMatch=${outcomeMatches}`);
        }

        // Match criteria:
        // 1. Amount must be within 5% (to handle rounding differences)
        // 2. Condition ID must match (for single) or be included (for combo)
        // 3. Outcome ID should match (for single bets)
        if (!amountMatches) {
          continue;
        }

        if (isCombo) {
          // For combo: ANY condition match + multiple selections
          if (conditionMatches && chainBet.selections.length > 1) {
            console.log(`[CleanupGhostBets]   MATCH! (combo)`);
            matchedBet = chainBet;
            break;
          }
        } else {
          // For single: condition AND outcome must match
          if (conditionMatches && outcomeMatches) {
            console.log(`[CleanupGhostBets]   MATCH! (single)`);
            matchedBet = chainBet;
            break;
          }
          // Fallback: If condition matches and it's the only selection, accept it
          if (conditionMatches && chainBet.selections.length === 1) {
            console.log(`[CleanupGhostBets]   MATCH! (single, condition only)`);
            matchedBet = chainBet;
            break;
          }
        }
      }

      if (matchedBet) {
        // RECOVERED: Update local bet with blockchain data
        console.log(`[CleanupGhostBets] RECOVERED ghost bet #${ghost.id} -> betId: ${matchedBet.betId}, txHash: ${matchedBet.createdTxHash}, status: ${matchedBet.status}`);

        updateBetById(ghost.id, {
          bet_id: matchedBet.betId,
          tx_hash: matchedBet.createdTxHash,
          status: matchedBet.status === 'Accepted' ? 'accepted' : 'pending',
        });
        recovered++;
      } else {
        // TRUE GHOST: Not found on blockchain, mark as failed
        console.log(`[CleanupGhostBets] TRUE GHOST bet #${ghost.id} - no matching bet found on blockchain`);

        updateBetById(ghost.id, {
          status: 'failed',
          result: 'ghost_bet_cleanup',
        });
        failed++;
      }
    }

    console.log(`[CleanupGhostBets] Complete: ${recovered} recovered, ${failed} marked as failed`);
  } catch (error) {
    console.error('[CleanupGhostBets] Error querying blockchain:', error);
    // On error, don't mark anything as failed - leave for next sync
  }

  return { recovered, failed };
}

// Sync wrapper for backward compatibility (doesn't verify blockchain - use async version)
export function cleanupGhostBets(): number {
  // Just return 0 - use cleanupGhostBetsAsync instead
  console.log('[CleanupGhostBets] DEPRECATED: Use cleanupGhostBetsAsync() for blockchain verification');
  return 0;
}

// Recover wrongly-failed bets - check blockchain and update if found
export async function recoverFailedBets(walletAddress: string): Promise<{ recovered: number; checked: number; debug?: object }> {
  const db = getDb();

  console.log('='.repeat(80));
  console.log('[RecoverFailed] STARTING RECOVERY');
  console.log('[RecoverFailed] Wallet address provided:', walletAddress);
  console.log('='.repeat(80));

  // Get bets marked as failed with ghost_bet_cleanup result
  const failedBets = db.prepare(`
    SELECT * FROM bets
    WHERE status = 'failed'
      AND result = 'ghost_bet_cleanup'
    ORDER BY placed_at DESC
  `).all() as BetRecord[];

  if (failedBets.length === 0) {
    console.log('[RecoverFailed] No failed ghost bets to check');
    return { recovered: 0, checked: 0 };
  }

  console.log(`[RecoverFailed] Found ${failedBets.length} failed ghost bets in local DB:`);
  failedBets.forEach((bet, i) => {
    console.log(`  [${i + 1}] id=${bet.id}, outcome="${bet.outcome_name}", amount=${bet.amount}, condition_id="${bet.condition_id}", outcome_id="${bet.outcome_id}"`);
  });

  const CLIENT_API = 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3';
  const addr = walletAddress.toLowerCase();

  console.log(`[RecoverFailed] Querying subgraph for wallet: ${addr}`);

  // Query ALL bets for this wallet (not just recent)
  const query = `{
    v3Bets(
      first: 200,
      where: { actor: "${addr}" },
      orderBy: createdBlockTimestamp,
      orderDirection: desc
    ) {
      betId
      amount
      odds
      status
      createdTxHash
      createdBlockTimestamp
      selections {
        outcome {
          outcomeId
          condition {
            conditionId
          }
        }
      }
    }
  }`;

  try {
    const response = await fetch(CLIENT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error('[RecoverFailed] GraphQL errors:', JSON.stringify(data.errors, null, 2));
      return { recovered: 0, checked: failedBets.length };
    }

    const chainBets = data.data?.v3Bets || [];
    console.log(`[RecoverFailed] Found ${chainBets.length} total bets on blockchain for ${addr}`);

    if (chainBets.length === 0) {
      console.log('[RecoverFailed] WARNING: No bets found on blockchain! Check wallet address.');
      return { recovered: 0, checked: failedBets.length, debug: { walletQueried: addr, chainBetsFound: 0 } };
    }

    // Get all existing bet_ids from database to avoid duplicates
    const existingBetIds = new Set<string>();
    const allBets = db.prepare('SELECT bet_id FROM bets WHERE bet_id IS NOT NULL').all() as { bet_id: string }[];
    for (const bet of allBets) {
      if (bet.bet_id) {
        existingBetIds.add(bet.bet_id);
      }
    }
    console.log(`[RecoverFailed] Found ${existingBetIds.size} existing bet_ids in database`);

    // Log ALL chain bets for debugging
    console.log('[RecoverFailed] Chain bets from subgraph:');
    chainBets.forEach((bet: { betId: string; amount: string; status: string; selections: { outcome: { outcomeId: string; condition: { conditionId: string } } }[] }, i: number) => {
      const condIds = bet.selections?.map((s) => s.outcome.condition.conditionId) || [];
      const outcomeIds = bet.selections?.map((s) => s.outcome.outcomeId) || [];
      const alreadyInDb = existingBetIds.has(bet.betId) ? ' [ALREADY IN DB]' : '';
      console.log(`  [${i + 1}] betId=${bet.betId}, amount=${bet.amount}, status=${bet.status}${alreadyInDb}`);
      console.log(`       conditions=[${condIds.join(', ')}]`);
      console.log(`       outcomes=[${outcomeIds.join(', ')}]`);
    });

    let recovered = 0;

    for (const failedBet of failedBets) {
      const localAmount = failedBet.amount;
      const localConditionId = failedBet.condition_id;
      const localOutcomeId = failedBet.outcome_id;
      const isCombo = failedBet.outcome_name?.startsWith('COMBO:');

      console.log('-'.repeat(60));
      console.log(`[RecoverFailed] Trying to match local bet #${failedBet.id}:`);
      console.log(`  outcome_name: "${failedBet.outcome_name}"`);
      console.log(`  amount: ${localAmount}`);
      console.log(`  condition_id: "${localConditionId}" (type: ${typeof localConditionId}, length: ${localConditionId?.length})`);
      console.log(`  outcome_id: "${localOutcomeId}" (type: ${typeof localOutcomeId}, length: ${localOutcomeId?.length})`);
      console.log(`  isCombo: ${isCombo}`);

      let foundMatch = false;

      // Normalize local values - trim and ensure strings
      const localCondStr = String(localConditionId || '').trim();
      const localOutStr = String(localOutcomeId || '').trim();

      console.log(`  Normalized: conditionId="${localCondStr}", outcomeId="${localOutStr}"`);

      for (const chainBet of chainBets) {
        // Skip chain bets that are already assigned to another local bet
        if (existingBetIds.has(chainBet.betId)) {
          continue;
        }

        const chainAmount = parseFloat(chainBet.amount);
        const chainConditionIds: string[] = (chainBet.selections?.map(
          (s: { outcome: { condition: { conditionId: string } } }) => String(s.outcome.condition.conditionId).trim()
        ) || []);
        const chainOutcomeIds: string[] = (chainBet.selections?.map(
          (s: { outcome: { outcomeId: string } }) => String(s.outcome.outcomeId).trim()
        ) || []);

        // Check amount match (10% tolerance to be more lenient)
        const amountDiff = Math.abs(chainAmount - localAmount);
        const amountMatches = amountDiff <= localAmount * 0.10;

        // Check condition match - normalize and compare
        const conditionMatches = chainConditionIds.some((cid: string) => {
          const exactMatch = cid === localCondStr;
          const partialMatch = cid.includes(localCondStr) || localCondStr.includes(cid);
          return exactMatch || partialMatch;
        });

        // Check outcome match - normalize and compare
        const outcomeMatches = chainOutcomeIds.some((oid: string) => oid === localOutStr);

        // Log comparison (only if potentially matching)
        if (amountMatches || conditionMatches) {
          console.log(`  [chainBet ${chainBet.betId}]:`);
          console.log(`    amount: chain=${chainAmount} local=${localAmount} diff=${amountDiff.toFixed(4)} match=${amountMatches}`);
          console.log(`    conditions: chain=[${chainConditionIds.join(',')}] local="${localCondStr}" match=${conditionMatches}`);
          console.log(`    outcomes: chain=[${chainOutcomeIds.join(',')}] local="${localOutStr}" match=${outcomeMatches}`);
        }

        // Require BOTH amount AND condition AND outcome to match for single bets
        // For combo bets, we could be more lenient but start strict
        if (amountMatches && conditionMatches && outcomeMatches) {
          console.log(`  >>> MATCH FOUND! betId=${chainBet.betId}`);

          // Clear the result by setting to null (not undefined)
          db.prepare(`
            UPDATE bets
            SET bet_id = ?, tx_hash = ?, status = ?, result = NULL
            WHERE id = ?
          `).run(chainBet.betId, chainBet.createdTxHash, chainBet.status === 'Accepted' ? 'accepted' : 'pending', failedBet.id);

          // Add to existing set to prevent double assignment
          existingBetIds.add(chainBet.betId);

          console.log(`  >>> Updated bet #${failedBet.id} with betId=${chainBet.betId}, status=${chainBet.status}`);
          recovered++;
          foundMatch = true;
          break;
        }
      }

      if (!foundMatch) {
        console.log(`  >>> NO MATCH for bet #${failedBet.id}`);
      }
    }

    console.log('='.repeat(80));
    console.log(`[RecoverFailed] COMPLETE: ${recovered}/${failedBets.length} bets recovered`);
    console.log('='.repeat(80));

    return {
      recovered,
      checked: failedBets.length,
      debug: {
        walletQueried: addr,
        chainBetsFound: chainBets.length,
        failedBetsChecked: failedBets.length,
      }
    };
  } catch (error) {
    console.error('[RecoverFailed] Error:', error);
    return { recovered: 0, checked: failedBets.length };
  }
}

// Update bet by internal ID (for ghost bet recovery)
export function updateBetById(id: number, updates: { status?: string; bet_id?: string; tx_hash?: string; result?: string }) {
  const db = getDb();
  const setClauses = [];
  const values = [];

  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    values.push(updates.status);
  }
  if (updates.bet_id !== undefined) {
    setClauses.push('bet_id = ?');
    values.push(updates.bet_id);
  }
  if (updates.tx_hash !== undefined) {
    setClauses.push('tx_hash = ?');
    values.push(updates.tx_hash);
  }
  if (updates.result !== undefined) {
    setClauses.push('result = ?');
    values.push(updates.result);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE bets SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

export function getBets(status?: string, limit: number = 100) {
  const db = getDb();
  if (status) {
    return db.prepare('SELECT * FROM bets WHERE status = ? ORDER BY placed_at DESC LIMIT ?').all(status, limit) as BetRecord[];
  }
  return db.prepare('SELECT * FROM bets ORDER BY placed_at DESC LIMIT ?').all(limit) as BetRecord[];
}

export function getBetByTxHash(txHash: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM bets WHERE tx_hash = ?').get(txHash) as BetRecord | undefined;
}

export function getProfitLoss() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_bets,
      SUM(amount) as total_staked,
      SUM(CASE WHEN result = 'won' THEN payout ELSE 0 END) as total_won,
      SUM(CASE WHEN result = 'lost' THEN amount ELSE 0 END) as total_lost,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      SUM(CASE WHEN result = 'won' THEN 1 ELSE 0 END) as won_count,
      SUM(CASE WHEN result = 'lost' THEN 1 ELSE 0 END) as lost_count
    FROM bets
  `).get() as {
    total_bets: number;
    total_staked: number;
    total_won: number;
    total_lost: number;
    pending_count: number;
    won_count: number;
    lost_count: number;
  };

  return {
    totalBets: stats.total_bets || 0,
    totalStaked: stats.total_staked || 0,
    totalWon: stats.total_won || 0,
    totalLost: stats.total_lost || 0,
    netPL: (stats.total_won || 0) - (stats.total_lost || 0),
    pendingCount: stats.pending_count || 0,
    wonCount: stats.won_count || 0,
    lostCount: stats.lost_count || 0,
    winRate: stats.won_count && (stats.won_count + stats.lost_count) > 0
      ? (stats.won_count / (stats.won_count + stats.lost_count)) * 100
      : 0
  };
}

// Settings functions
export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(key, value);
}

// Types
export interface SlipSelection {
  id: number;
  game_id: string;
  game_title: string;
  condition_id: string;
  outcome_id: string;
  outcome_name: string;
  odds: number;
  market_name: string | null;
  created_at: string;
}

export interface BetRecord {
  id: number;
  bet_id: string | null;
  tx_hash: string | null;
  game_id: string;
  game_title: string;
  condition_id: string;
  outcome_id: string;
  outcome_name: string;
  odds: number;
  amount: number;
  potential_payout: number;
  status: string;
  result: string | null;
  payout: number | null;
  placed_at: string;
  settled_at: string | null;
}

// Sync bet status from Azuro V3 subgraph
export async function syncBetStatus(walletAddress: string): Promise<void> {
  if (!walletAddress) return;

  // First, clean up any ghost bets with blockchain verification
  const ghostResult = await cleanupGhostBetsAsync(walletAddress);
  if (ghostResult.recovered > 0 || ghostResult.failed > 0) {
    console.log(`[SyncBets] Ghost cleanup: ${ghostResult.recovered} recovered, ${ghostResult.failed} failed`);
  }

  const CLIENT_API = 'https://thegraph.azuro.org/subgraphs/name/azuro-protocol/azuro-api-polygon-v3';
  const addr = walletAddress.toLowerCase();

  try {
    // Query V3 bets for this wallet - use compact query format
    const query = `{ v3Bets(first: 100, where: { actor: "${addr}" }, orderBy: createdBlockTimestamp, orderDirection: desc) { id betId amount odds status result isRedeemed payout potentialPayout createdTxHash createdBlockTimestamp selections { outcome { outcomeId condition { conditionId } } } } }`;

    const response = await fetch(CLIENT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error('[SyncBets] GraphQL errors:', data.errors);
      return;
    }

    const azuroBets = data.data?.v3Bets || [];
    console.log(`[SyncBets] Found ${azuroBets.length} V3 bets for wallet ${addr}`);

    if (azuroBets.length === 0) return;

    const db = getDb();

    // Get local pending/accepted bets to help with matching
    const unsettledBets = db.prepare(`SELECT * FROM bets WHERE status IN ('pending', 'processing', 'accepted')`).all() as BetRecord[];
    console.log(`[SyncBets] Local unsettled bets: ${unsettledBets.length}`);

    // Update local database with Azuro status
    let updatedCount = 0;
    for (const azuroBet of azuroBets) {
      // Map Azuro status to our status
      let status = 'pending';
      let result: string | null = null;

      if (azuroBet.status === 'Resolved') {
        status = 'settled';
        result = azuroBet.result === 'Won' ? 'won' : 'lost';
      } else if (azuroBet.status === 'Canceled') {
        status = 'canceled';
        result = 'canceled';
      } else if (azuroBet.status === 'Accepted') {
        status = 'accepted';
      }

      const payout = azuroBet.payout ? parseFloat(azuroBet.payout) : null;
      const isCombo = azuroBet.selections && azuroBet.selections.length > 1;
      const azuroAmount = parseFloat(azuroBet.amount || '0'); // Already in USDT (not wei)

      // First try to update by bet_id (exact match)
      let updated = db.prepare(`
        UPDATE bets
        SET status = ?, result = ?, payout = ?, settled_at = CASE WHEN ? IN ('settled', 'canceled') THEN CURRENT_TIMESTAMP ELSE settled_at END
        WHERE bet_id = ?
      `).run(status, result, payout, status, azuroBet.betId);

      if (updated.changes > 0) {
        if (status === 'settled') {
          console.log(`[SyncBets] Updated bet ${azuroBet.betId} to ${status}/${result} (matched by bet_id)`);
        }
        updatedCount++;
        continue;
      }

      // Also try by bet_id as string (in case stored with different format)
      updated = db.prepare(`
        UPDATE bets
        SET status = ?, result = ?, payout = ?, settled_at = CASE WHEN ? IN ('settled', 'canceled') THEN CURRENT_TIMESTAMP ELSE settled_at END
        WHERE CAST(bet_id AS TEXT) = CAST(? AS TEXT)
      `).run(status, result, payout, status, azuroBet.betId);

      if (updated.changes > 0) {
        if (status === 'settled') {
          console.log(`[SyncBets] Updated bet ${azuroBet.betId} to ${status}/${result} (matched by bet_id as text)`);
        }
        updatedCount++;
        continue;
      }

      // Try by tx_hash
      if (azuroBet.createdTxHash) {
        updated = db.prepare(`
          UPDATE bets
          SET status = ?, result = ?, payout = ?, bet_id = ?, settled_at = CASE WHEN ? IN ('settled', 'canceled') THEN CURRENT_TIMESTAMP ELSE settled_at END
          WHERE tx_hash = ?
        `).run(status, result, payout, azuroBet.betId, status, azuroBet.createdTxHash);

        if (updated.changes > 0) {
          if (status === 'settled') {
            console.log(`[SyncBets] Updated bet ${azuroBet.betId} to ${status}/${result} (matched by tx_hash)`);
          }
          updatedCount++;
          continue;
        }
      }

      // For combo bets, match by checking if ANY condition matches AND number of selections match
      if (isCombo) {
        const numSelections = azuroBet.selections.length;
        // Get all condition IDs from the combo
        const comboConditionIds = azuroBet.selections.map((s: { outcome: { condition: { conditionId: string } } }) =>
          s.outcome.condition.conditionId
        );

        // Count "+" in outcome_name to determine number of selections in local bet
        // COMBO: A + B + C has 2 "+" signs = 3 selections

        // Try to match COMBO bets by checking if stored condition_id is ANY of the combo's conditions
        // Include 'accepted' status to catch bets that were accepted but bet_id wasn't stored
        for (const condId of comboConditionIds) {
          // First check if bet_id is already used
          const existingBetId = db.prepare(`SELECT id FROM bets WHERE bet_id = ?`).get(azuroBet.betId);
          if (existingBetId) {
            // This bet_id already exists, skip
            break;
          }

          // Match by condition_id, amount, and selection count
          // IMPORTANT: Include 'accepted' status so resolved bets can update accepted bets
          updated = db.prepare(`
            UPDATE bets
            SET status = ?, result = ?, payout = ?, bet_id = ?, settled_at = CASE WHEN ? IN ('settled', 'canceled') THEN CURRENT_TIMESTAMP ELSE settled_at END
            WHERE outcome_name LIKE 'COMBO:%'
              AND status IN ('pending', 'processing', 'accepted')
              AND ABS(amount - ?) < 0.01
              AND condition_id = ?
              AND (bet_id IS NULL OR bet_id = '' OR bet_id = ?)
              AND (LENGTH(outcome_name) - LENGTH(REPLACE(outcome_name, '+', ''))) = ?
          `).run(status, result, payout, azuroBet.betId, status, azuroAmount, condId, azuroBet.betId, numSelections - 1);

          if (updated.changes > 0) {
            console.log(`[SyncBets] Updated COMBO bet ${azuroBet.betId} to ${status}/${result} (matched condition ${condId}, ${numSelections} legs)`);
            updatedCount++;
            break;
          }
        }

        if (updated.changes > 0) continue;
      }

      // For single bets, try by condition_id
      // IMPORTANT: Include 'accepted' status so resolved bets can update accepted bets
      const selection = azuroBet.selections?.[0];
      if (selection && !isCombo) {
        const conditionId = selection.outcome.condition.conditionId;
        updated = db.prepare(`
          UPDATE bets
          SET status = ?, result = ?, payout = ?, bet_id = ?, settled_at = CASE WHEN ? IN ('settled', 'canceled') THEN CURRENT_TIMESTAMP ELSE settled_at END
          WHERE condition_id = ? AND status IN ('pending', 'processing', 'accepted')
        `).run(status, result, payout, azuroBet.betId, status, conditionId);

        if (updated.changes > 0) {
          console.log(`[SyncBets] Updated single bet ${azuroBet.betId} to ${status}/${result} (matched condition ${conditionId})`);
          updatedCount++;
        }
      }
    }

    console.log(`[SyncBets] Synced ${azuroBets.length} bets from Azuro, updated ${updatedCount} local bets`);

    // ENHANCEMENT: For bets still "Accepted" on V3 API, check the data-feed for resolved conditions
    // This provides faster status updates when the V3 API is slow to process resolutions
    const stillAccepted = db.prepare(`SELECT id, bet_id, condition_id, outcome_id, outcome_name, amount FROM bets WHERE status = 'accepted'`).all() as { id: number; bet_id: string; condition_id: string; outcome_id: string; outcome_name: string; amount: number }[];

    if (stillAccepted.length > 0) {
      console.log(`[SyncBets] Checking ${stillAccepted.length} accepted bets against data-feed for faster resolution...`);

      // Collect all condition IDs
      const conditionIds = stillAccepted.map(b => b.condition_id).filter(Boolean);
      if (conditionIds.length > 0) {
        try {
          const DATA_FEED_API = 'https://thegraph-1.onchainfeed.org/subgraphs/name/azuro-protocol/azuro-data-feed-polygon';
          const condQuery = `{ conditions(where: { conditionId_in: [${conditionIds.map(c => `"${c}"`).join(',')}] }) { conditionId state wonOutcomeIds } }`;

          const condResponse = await fetch(DATA_FEED_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: condQuery }),
          });
          const condData = await condResponse.json();

          if (!condData.errors && condData.data?.conditions) {
            const conditionsMap = new Map<string, { state: string; wonOutcomeIds: string[] }>();
            for (const cond of condData.data.conditions) {
              conditionsMap.set(cond.conditionId, { state: cond.state, wonOutcomeIds: cond.wonOutcomeIds || [] });
            }

            // Check each accepted bet
            for (const bet of stillAccepted) {
              const isCombo = bet.outcome_name?.startsWith('COMBO:');
              const condition = conditionsMap.get(bet.condition_id);

              // For single bets: check if condition is resolved
              if (!isCombo && condition) {
                if (condition.state === 'Resolved') {
                  const won = condition.wonOutcomeIds.includes(bet.outcome_id);
                  const result = won ? 'won' : 'lost';
                  console.log(`[SyncBets] DATA-FEED: Bet ${bet.bet_id} condition resolved -> ${result} (outcome ${bet.outcome_id}, winners: [${condition.wonOutcomeIds.join(',')}])`);

                  db.prepare(`
                    UPDATE bets
                    SET status = 'settled', result = ?, settled_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                  `).run(result, bet.id);
                  updatedCount++;
                } else if (condition.state === 'Canceled') {
                  console.log(`[SyncBets] DATA-FEED: Bet ${bet.bet_id} condition canceled`);
                  db.prepare(`
                    UPDATE bets
                    SET status = 'canceled', result = 'canceled', settled_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                  `).run(bet.id);
                  updatedCount++;
                }
              }

              // For combo bets: would need to check ALL conditions in the combo
              // For now, just log for debugging
              if (isCombo && condition) {
                console.log(`[SyncBets] DATA-FEED: COMBO bet ${bet.bet_id} first condition state: ${condition.state}`);
              }
            }
          }
        } catch (dataFeedError) {
          console.error('[SyncBets] Data-feed check error:', dataFeedError);
        }
      }
    }
  } catch (error) {
    console.error('[SyncBets] Error syncing bets:', error);
  }
}
