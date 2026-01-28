// Market helpers using @azuro-org/dictionaries
import {
  getMarketKey,
  getMarketName,
  getSelectionName as getSelectionNameRaw,
} from '@azuro-org/dictionaries';

export { getMarketKey, getMarketName };

// Friendly name mappings for common betting selections
const FRIENDLY_SELECTIONS: Record<string, string> = {
  '1': 'Home',
  '2': 'Away',
  'X': 'Draw',
  '1X': 'Home or Draw',
  '12': 'Home or Away',
  'X2': 'Draw or Away',
  'Team 1': 'Home',
  'Team 2': 'Away',
};

/**
 * Get selection name with friendlier alternatives for common terms
 */
export function getSelectionName(props: { outcomeId: string | number; withPoint?: boolean }): string {
  const raw = getSelectionNameRaw(props);
  if (!raw) return `Outcome ${props.outcomeId}`;

  // Check if we have a friendlier name
  return FRIENDLY_SELECTIONS[raw] || raw;
}

// Outcome type from API
export interface Outcome {
  outcomeId: string;
  currentOdds: string;
}

// Condition type from API
export interface Condition {
  conditionId: string;
  status?: string;
  outcomes: Outcome[];
}

// Grouped market type for display
export interface GroupedMarket {
  marketKey: string;
  marketName: string;
  outcomes: Array<{
    outcomeId: string;
    selectionName: string;
    odds: number;
    conditionId: string;
  }>;
}

/**
 * Groups conditions/outcomes by their market type
 * Returns markets grouped with proper names from the dictionaries
 * The formatOdds callback receives conditionId and outcomeId for live odds lookup
 */
export function groupOutcomesByMarket(
  conditions: Condition[],
  formatOdds: (rawOdds: string, conditionId?: string, outcomeId?: string) => number
): GroupedMarket[] {
  const marketMap = new Map<string, GroupedMarket>();

  for (const condition of conditions) {
    for (const outcome of condition.outcomes) {
      const marketKey = getMarketKey(outcome.outcomeId);
      const marketName = getMarketName({ outcomeId: outcome.outcomeId }) || marketKey;
      const selectionName = getSelectionName({ outcomeId: outcome.outcomeId }) || `Outcome ${outcome.outcomeId}`;
      const odds = formatOdds(outcome.currentOdds, condition.conditionId, outcome.outcomeId);

      if (!marketMap.has(marketKey)) {
        marketMap.set(marketKey, {
          marketKey,
          marketName,
          outcomes: [],
        });
      }

      marketMap.get(marketKey)!.outcomes.push({
        outcomeId: outcome.outcomeId,
        selectionName,
        odds,
        conditionId: condition.conditionId,
      });
    }
  }

  // Convert to array and sort by market name
  return Array.from(marketMap.values()).sort((a, b) => {
    // Prioritize common markets
    const priority = [
      'Full Time Result',
      'Double Chance',
      'Both Teams To Score',
      'Total',
      'Handicap',
    ];

    const aIndex = priority.findIndex(p => a.marketName.includes(p));
    const bIndex = priority.findIndex(p => b.marketName.includes(p));

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.marketName.localeCompare(b.marketName);
  });
}
