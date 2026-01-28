export type Language = 'en' | 'sq';

export const translations = {
  en: {
    // Navigation
    nav: {
      games: 'Games',
      live: 'Live',
      betSlip: 'Bet Slip',
      history: 'History',
      wallet: 'Wallet',
    },

    // Common
    common: {
      loading: 'Loading...',
      error: 'Error',
      success: 'Success',
      cancel: 'Cancel',
      confirm: 'Confirm',
      close: 'Close',
      save: 'Save',
      delete: 'Delete',
      edit: 'Edit',
      back: 'Back',
      next: 'Next',
      submit: 'Submit',
      refresh: 'Refresh',
      search: 'Search',
      filter: 'Filter',
      all: 'All',
      none: 'None',
      yes: 'Yes',
      no: 'No',
      or: 'or',
      and: 'and',
    },

    // Sports
    sports: {
      football: 'Football',
      basketball: 'Basketball',
      tennis: 'Tennis',
      hockey: 'Hockey',
      baseball: 'Baseball',
      mma: 'MMA',
      boxing: 'Boxing',
      esports: 'Esports',
      cricket: 'Cricket',
      rugby: 'Rugby',
    },

    // Games page
    games: {
      title: 'Games',
      upcoming: 'Upcoming',
      live: 'Live',
      today: 'Today',
      tomorrow: 'Tomorrow',
      noGames: 'No games available',
      startsIn: 'Starts in',
      started: 'Started',
      selectSport: 'Select Sport',
      selectLeague: 'Select League',
      allLeagues: 'All Leagues',
      selectGame: 'Select a game to view odds',
      noMarkets: 'No bettable markets available for this game',
      matchStats: 'Match Statistics',
      noStatsCoverage: 'No stats coverage',
      statsNotAvailable: 'Detailed statistics not available for this match',
      streaming: 'Streaming',
      halfTime: 'Half Time',
      firstHalf: '1st Half',
      secondHalf: '2nd Half',
    },

    // Stats labels
    stats: {
      goals: 'Goals',
      corners: 'Corners',
      yellowCards: 'Yellow Cards',
      redCards: 'Red Cards',
      totalShots: 'Total Shots',
      shotsOnTarget: 'Shots on Target',
      possession: 'Possession %',
      fouls: 'Fouls',
    },

    // Betting
    betting: {
      betSlip: 'Bet Slip',
      stake: 'Stake',
      potentialWin: 'Potential Win',
      totalOdds: 'Total Odds',
      placeBet: 'Place Bet',
      clearSlip: 'Clear Slip',
      emptySlip: 'Your bet slip is empty',
      addSelections: 'Add selections to place a bet',
      single: 'Single',
      combo: 'Combo',
      maxBet: 'Max Bet',
      minBet: 'Min Bet',
      insufficientBalance: 'Insufficient balance',
      betPlaced: 'Bet placed successfully!',
      betFailed: 'Bet placement failed',
      odds: 'Odds',
      selection: 'Selection',
      remove: 'Remove',
      cashout: 'Cashout',
      cashoutAvailable: 'Cashout Available',
    },

    // Markets - market type names (from Azuro dictionaries)
    markets: {
      // Market types
      winner: 'Winner',
      matchResult: 'Match Result',
      fullTimeResult: 'Full Time Result',
      halfTimeResult: 'Half Time Result',
      firstHalfResult: '1st Half Result',
      secondHalfResult: '2nd Half Result',
      firstHalfWinner: '1st Half - Winner',
      secondHalfWinner: '2nd Half - Winner',
      overUnder: 'Over/Under',
      bothTeamsScore: 'Both Teams to Score',
      bothTeamsToScore: 'Both Teams To Score',
      handicap: 'Handicap',
      correctScore: 'Correct Score',
      firstGoal: 'First Goal',
      lastGoal: 'Last Goal',
      totalGoals: 'Total Goals',
      firstHalfTotalGoals: '1st Half - Total Goals',
      secondHalfTotalGoals: '2nd Half - Total Goals',
      doubleChance: 'Double Chance',
      market: 'Market',

      // Outcome names
      homeWin: 'Home Win',
      draw: 'Draw',
      awayWin: 'Away Win',
      home: 'Home',
      away: 'Away',
      over: 'Over',
      under: 'Under',
      yes: 'Yes',
      no: 'No',
      homeOrDraw: 'Home or Draw',
      awayOrDraw: 'Away or Draw',
      homeOrAway: 'Home or Away',
    },

    // History
    history: {
      title: 'Bet History',
      totalBets: 'Total Bets',
      totalStaked: 'Total Staked',
      winRate: 'Win Rate',
      netPL: 'Net P/L',
      won: 'Won',
      lost: 'Lost',
      pending: 'Pending',
      accepted: 'Accepted',
      settled: 'Settled',
      settling: 'Settling...',
      canceled: 'Canceled',
      rejected: 'Rejected',
      failed: 'Failed',
      withdraw: 'Withdraw',
      withdrawn: 'Withdrawn',
      noBets: 'No bets yet',
      date: 'Date',
      game: 'Game',
      payout: 'Payout',
      status: 'Status',
    },

    // Wallet
    wallet: {
      title: 'Wallet',
      balance: 'Balance',
      address: 'Address',
      connect: 'Connect Wallet',
      disconnect: 'Disconnect',
      connected: 'Connected',
      notConnected: 'Not Connected',
      deposit: 'Deposit',
      withdraw: 'Withdraw',
      import: 'Import Wallet',
      export: 'Export',
      copied: 'Copied!',
      privateKey: 'Private Key',
      enterPrivateKey: 'Enter private key',
      importSuccess: 'Wallet imported successfully',
      importError: 'Failed to import wallet',
      transactions: 'Transactions',
    },

    // Errors
    errors: {
      somethingWrong: 'Something went wrong',
      tryAgain: 'Try again',
      connectionFailed: 'Connection failed',
      networkError: 'Network error',
      invalidInput: 'Invalid input',
      unauthorized: 'Unauthorized',
      notFound: 'Not found',
    },

    // Time
    time: {
      now: 'Now',
      today: 'Today',
      tomorrow: 'Tomorrow',
      yesterday: 'Yesterday',
      minutes: 'minutes',
      hours: 'hours',
      days: 'days',
      ago: 'ago',
      in: 'in',
    },
  },

  sq: {
    // Navigation
    nav: {
      games: 'Ndeshjet',
      live: 'Live',
      betSlip: 'Kuponi',
      history: 'Historiku',
      wallet: 'Portofoli',
    },

    // Common
    common: {
      loading: 'Duke ngarkuar...',
      error: 'Gabim',
      success: 'Sukses',
      cancel: 'Anulo',
      confirm: 'Konfirmo',
      close: 'Mbyll',
      save: 'Ruaj',
      delete: 'Fshi',
      edit: 'Ndrysho',
      back: 'Kthehu',
      next: 'Vazhdo',
      submit: 'Dergo',
      refresh: 'Rifresko',
      search: 'Kerko',
      filter: 'Filtro',
      all: 'Te gjitha',
      none: 'Asnje',
      yes: 'Po',
      no: 'Jo',
      or: 'ose',
      and: 'dhe',
    },

    // Sports
    sports: {
      football: 'Futboll',
      basketball: 'Basketboll',
      tennis: 'Tenis',
      hockey: 'Hokej',
      baseball: 'Bejsboll',
      mma: 'MMA',
      boxing: 'Boks',
      esports: 'Esports',
      cricket: 'Kriket',
      rugby: 'Ragbi',
    },

    // Games page
    games: {
      title: 'Ndeshjet',
      upcoming: 'Të ardhshme',
      live: 'Live',
      today: 'Sot',
      tomorrow: 'Nesër',
      noGames: 'Nuk ka ndeshje',
      startsIn: 'Fillon për',
      started: 'Filloi',
      selectSport: 'Zgjidh Sportin',
      selectLeague: 'Zgjidh Ligën',
      allLeagues: 'Të gjitha Ligat',
      selectGame: 'Zgjidh një ndeshje për të parë kuotat',
      noMarkets: 'Nuk ka tregje të disponueshme për këtë ndeshje',
      matchStats: 'Statistikat e Ndeshjes',
      noStatsCoverage: 'Nuk ka mbulim statistikash',
      statsNotAvailable: 'Statistikat e detajuara nuk janë të disponueshme',
      streaming: 'Transmetim',
      halfTime: 'Pushim',
      firstHalf: 'Pjesa 1',
      secondHalf: 'Pjesa 2',
    },

    // Stats labels
    stats: {
      goals: 'Gola',
      corners: 'Kornera',
      yellowCards: 'Kartona të Verdhë',
      redCards: 'Kartona të Kuq',
      totalShots: 'Gjuajtje Totale',
      shotsOnTarget: 'Gjuajtje në Portë',
      possession: 'Posedim %',
      fouls: 'Faule',
    },

    // Betting
    betting: {
      betSlip: 'Kuponi',
      stake: 'Shuma',
      potentialWin: 'Fitimi Potencial',
      totalOdds: 'Kuota Totale',
      placeBet: 'Vendos Bastin',
      clearSlip: 'Pastro Kuponin',
      emptySlip: 'Kuponi eshte bosh',
      addSelections: 'Shto zgjedhje per te vendosur bast',
      single: 'Teke',
      combo: 'Kombo',
      maxBet: 'Bast Maksimal',
      minBet: 'Bast Minimal',
      insufficientBalance: 'Balanca e pamjaftueshme',
      betPlaced: 'Basti u vendos me sukses!',
      betFailed: 'Basti deshtoi',
      odds: 'Kuota',
      selection: 'Zgjedhja',
      remove: 'Hiq',
      cashout: 'Terheq',
      cashoutAvailable: 'Terheqje e mundshme',
    },

    // Markets - market type names
    markets: {
      // Market types
      winner: 'Fituesi',
      matchResult: 'Rezultati',
      fullTimeResult: 'Rezultati Final',
      halfTimeResult: 'Rezultati i Pjesës së Parë',
      firstHalfResult: 'Rezultati Pjesa 1',
      secondHalfResult: 'Rezultati Pjesa 2',
      firstHalfWinner: 'Pjesa 1 - Fituesi',
      secondHalfWinner: 'Pjesa 2 - Fituesi',
      overUnder: 'Mbi/Nën',
      bothTeamsScore: 'Të dyja skuadrat shënojnë',
      bothTeamsToScore: 'Të dyja skuadrat shënojnë',
      handicap: 'Hendikep',
      correctScore: 'Rezultati i Saktë',
      firstGoal: 'Goli i Parë',
      lastGoal: 'Goli i Fundit',
      totalGoals: 'Totali i Golave',
      firstHalfTotalGoals: 'Pjesa 1 - Totali Golave',
      secondHalfTotalGoals: 'Pjesa 2 - Totali Golave',
      doubleChance: 'Shans i Dyfishtë',
      market: 'Tregu',

      // Outcome names
      homeWin: 'Fitore Vendase',
      draw: 'Barazim',
      awayWin: 'Fitore Mysafire',
      home: 'Vendas',
      away: 'Mysafir',
      over: 'Mbi',
      under: 'Nën',
      yes: 'Po',
      no: 'Jo',
      homeOrDraw: 'Vendas ose Barazim',
      awayOrDraw: 'Mysafir ose Barazim',
      homeOrAway: 'Vendas ose Mysafir',
    },

    // History
    history: {
      title: 'Historiku i Basteve',
      totalBets: 'Totali Basteve',
      totalStaked: 'Totali i Luajtur',
      winRate: 'Perqindja Fitimeve',
      netPL: 'Fitimi/Humbja Neto',
      won: 'Fituar',
      lost: 'Humbur',
      pending: 'Ne pritje',
      accepted: 'Pranuar',
      settled: 'Perfunduar',
      settling: 'Duke u perfunduar...',
      canceled: 'Anuluar',
      rejected: 'Refuzuar',
      failed: 'Deshtuar',
      withdraw: 'Terheq',
      withdrawn: 'Terhequr',
      noBets: 'Nuk ka baste ende',
      date: 'Data',
      game: 'Ndeshja',
      payout: 'Pagesa',
      status: 'Statusi',
    },

    // Wallet
    wallet: {
      title: 'Portofoli',
      balance: 'Balanca',
      address: 'Adresa',
      connect: 'Lidh Portofolin',
      disconnect: 'Shkeput',
      connected: 'I lidhur',
      notConnected: 'I pa lidhur',
      deposit: 'Depozito',
      withdraw: 'Terheq',
      import: 'Importo Portofolin',
      export: 'Eksporto',
      copied: 'U kopjua!',
      privateKey: 'Celesi Privat',
      enterPrivateKey: 'Vendos celesin privat',
      importSuccess: 'Portofoli u importua me sukses',
      importError: 'Importimi deshtoi',
      transactions: 'Transaksionet',
    },

    // Errors
    errors: {
      somethingWrong: 'Dicka shkoi keq',
      tryAgain: 'Provo perseri',
      connectionFailed: 'Lidhja deshtoi',
      networkError: 'Gabim rrjeti',
      invalidInput: 'Input i pavlefshem',
      unauthorized: 'I paautorizuar',
      notFound: 'Nuk u gjet',
    },

    // Time
    time: {
      now: 'Tani',
      today: 'Sot',
      tomorrow: 'Neser',
      yesterday: 'Dje',
      minutes: 'minuta',
      hours: 'ore',
      days: 'dite',
      ago: 'me pare',
      in: 'per',
    },
  },
};

export type TranslationKeys = typeof translations.en;

export function getTranslation(lang: Language): TranslationKeys {
  return translations[lang];
}

// Market name translation map (English -> translation key)
const marketNameMap: Record<string, keyof TranslationKeys['markets']> = {
  'Winner': 'winner',
  'Match Result': 'matchResult',
  'Full Time Result': 'fullTimeResult',
  'Half Time Result': 'halfTimeResult',
  '1st Half Result': 'firstHalfResult',
  '2nd Half Result': 'secondHalfResult',
  '1st Half - Winner': 'firstHalfWinner',
  '2nd Half - Winner': 'secondHalfWinner',
  'Over/Under': 'overUnder',
  'Both Teams to Score': 'bothTeamsScore',
  'Both Teams To Score': 'bothTeamsToScore',
  'Handicap': 'handicap',
  'Correct Score': 'correctScore',
  'First Goal': 'firstGoal',
  'Last Goal': 'lastGoal',
  'Total Goals': 'totalGoals',
  '1st Half - Total Goals': 'firstHalfTotalGoals',
  '2nd Half - Total Goals': 'secondHalfTotalGoals',
  'Double Chance': 'doubleChance',
  'Market': 'market',
};

// Translate market name from English to current language
export function translateMarket(marketName: string, lang: Language): string {
  // Check if there's a direct translation key
  const key = marketNameMap[marketName];
  if (key && translations[lang].markets[key]) {
    return translations[lang].markets[key];
  }

  // Handle dynamic market names with periods/halves
  // Pattern: "Xth Half - Something" or "Xnd Half - Something"
  const halfMatch = marketName.match(/^(1st|2nd)\s+(Half)\s*[-–]\s*(.+)$/i);
  if (halfMatch) {
    const [, period, , rest] = halfMatch;
    const periodTrans = lang === 'sq'
      ? (period.toLowerCase() === '1st' ? 'Pjesa 1' : 'Pjesa 2')
      : period + ' Half';

    // Translate the rest part
    const restKey = marketNameMap[rest] || marketNameMap[rest.trim()];
    const restTrans = restKey ? translations[lang].markets[restKey] : rest;

    return `${periodTrans} - ${restTrans}`;
  }

  // Return original if no translation found
  return marketName;
}

// Outcome name translation patterns
const outcomePatterns: Array<{
  pattern: RegExp;
  translate: (match: RegExpMatchArray, lang: Language) => string;
}> = [
  // Over X.X
  {
    pattern: /^Over\s+([\d.]+)$/i,
    translate: (match, lang) => `${translations[lang].markets.over} ${match[1]}`,
  },
  // Under X.X
  {
    pattern: /^Under\s+([\d.]+)$/i,
    translate: (match, lang) => `${translations[lang].markets.under} ${match[1]}`,
  },
  // Yes
  {
    pattern: /^Yes$/i,
    translate: (_, lang) => translations[lang].markets.yes,
  },
  // No
  {
    pattern: /^No$/i,
    translate: (_, lang) => translations[lang].markets.no,
  },
  // Draw
  {
    pattern: /^Draw$/i,
    translate: (_, lang) => translations[lang].markets.draw,
  },
  // Home Win
  {
    pattern: /^Home Win$/i,
    translate: (_, lang) => translations[lang].markets.homeWin,
  },
  // Away Win
  {
    pattern: /^Away Win$/i,
    translate: (_, lang) => translations[lang].markets.awayWin,
  },
  // Home
  {
    pattern: /^Home$/i,
    translate: (_, lang) => translations[lang].markets.home,
  },
  // Away
  {
    pattern: /^Away$/i,
    translate: (_, lang) => translations[lang].markets.away,
  },
  // Home or Draw
  {
    pattern: /^Home or Draw$/i,
    translate: (_, lang) => translations[lang].markets.homeOrDraw,
  },
  // Draw or Away / Away or Draw
  {
    pattern: /^(Draw or Away|Away or Draw)$/i,
    translate: (_, lang) => translations[lang].markets.awayOrDraw,
  },
  // Home or Away
  {
    pattern: /^Home or Away$/i,
    translate: (_, lang) => translations[lang].markets.homeOrAway,
  },
];

// Translate outcome name from English to current language
// Note: Team names are not translated, only betting terms
export function translateOutcome(outcomeName: string, lang: Language): string {
  // Try each pattern
  for (const { pattern, translate } of outcomePatterns) {
    const match = outcomeName.match(pattern);
    if (match) {
      return translate(match, lang);
    }
  }

  // Handle team names with "or Draw" suffix (e.g., "Barcelona or Draw")
  const teamOrDrawMatch = outcomeName.match(/^(.+)\s+or\s+Draw$/i);
  if (teamOrDrawMatch) {
    const teamName = teamOrDrawMatch[1];
    const orDraw = lang === 'sq' ? 'ose Barazim' : 'or Draw';
    return `${teamName} ${orDraw}`;
  }

  // Handle "Draw or TeamName"
  const drawOrTeamMatch = outcomeName.match(/^Draw\s+or\s+(.+)$/i);
  if (drawOrTeamMatch) {
    const teamName = drawOrTeamMatch[1];
    const drawOr = lang === 'sq' ? 'Barazim ose' : 'Draw or';
    return `${drawOr} ${teamName}`;
  }

  // Return original if no pattern matches (likely a team name)
  return outcomeName;
}
