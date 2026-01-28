#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { config } from 'dotenv';
import { AzuroAPI } from './api.js';
import { AzuroBetting } from './betting.js';
import { CHAINS, ChainKey, OUTCOME_NAMES } from './config.js';
import { groupOutcomesByMarket, getSelectionName } from './markets.js';
import { WalletManager, formatBalance, maskAddress } from './wallet.js';
import {
  loadSlip,
  saveSlip,
  addToSlip,
  removeFromSlip,
  clearSlip,
  getSlipSummary,
  setSlipStake,
  loadSettings,
  saveSettings,
  setAutoWithdraw,
  getAutoWithdraw,
  addBetToHistory,
  updateBetStatus,
  loadHistory,
  getProfitLoss,
  SlipSelection,
} from './slip.js';
import { AzuroWebSocket, OddsUpdate, closeWebSocket } from './websocket.js';

config(); // Load .env file

// Global error handlers to catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  // Ignore inquirer prompt cancellation
  if (reason instanceof Error &&
      (reason.message?.includes('closed') || reason.message?.includes('User force closed'))) {
    console.log(chalk.gray('\nGoodbye!'));
    process.exit(0);
  }
  console.error(chalk.red('\nUnhandled Promise Rejection:'));
  console.error(reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  // Ignore inquirer prompt cancellation
  if (error.message?.includes('closed') || error.message?.includes('User force closed')) {
    console.log(chalk.gray('\nGoodbye!'));
    process.exit(0);
  }
  console.error(chalk.red('\nUncaught Exception:'));
  console.error(error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

// Handle SIGINT gracefully
process.on('SIGINT', () => {
  closeWebSocket();
  console.log(chalk.gray('\nGoodbye!'));
  process.exit(0);
});

// Helper to check if error is a prompt cancellation
function isPromptCancelled(error: unknown): boolean {
  const errMsg = (error as Error).message || '';
  return errMsg.includes('closed') ||
    errMsg.includes('force closed') ||
    errMsg.includes('User force closed') ||
    (error as any).isTtyError ||
    errMsg.includes('readline') ||
    errMsg.includes('SIGINT');
}

const program = new Command();

program
  .name('azuro')
  .description('CLI tool for Azuro betting protocol')
  .version('1.0.0');

// Helper to get chain from options
function getChain(options: { chain?: string }): ChainKey {
  return (options.chain as ChainKey) || 'polygon';
}

// Sports command
program
  .command('sports')
  .description('List available sports')
  .option('-c, --chain <chain>', 'Chain to use (polygon, gnosis, polygonAmoy)', 'polygon')
  .action(async (options) => {
    const spinner = ora('Fetching sports...').start();
    try {
      const api = new AzuroAPI(getChain(options));
      const sports = await api.getSports();

      spinner.succeed(`Found ${sports.length} sports with active games`);
      console.log('');

      for (const sport of sports) {
        console.log(chalk.cyan(`  ${sport.name}`) + chalk.gray(` (${sport.slug})`));
      }
    } catch (error) {
      spinner.fail('Failed to fetch sports');
      console.error(chalk.red((error as Error).message));
    }
  });

// Games command
program
  .command('games')
  .description('List upcoming games')
  .option('-c, --chain <chain>', 'Chain to use (polygon, gnosis, polygonAmoy)', 'polygon')
  .option('-s, --sport <sport>', 'Filter by sport slug (e.g., football, basketball)')
  .option('-l, --limit <limit>', 'Number of games to show', '20')
  .action(async (options) => {
    const spinner = ora('Fetching games...').start();
    try {
      const api = new AzuroAPI(getChain(options));
      const games = await api.getGames({
        sportSlug: options.sport,
        limit: parseInt(options.limit),
      });

      spinner.succeed(`Found ${games.length} upcoming games`);
      console.log('');

      for (const game of games) {
        const startsAt = new Date(parseInt(game.startsAt) * 1000);
        const participants = game.participants.map(p => p.name).join(' vs ');

        console.log(chalk.white.bold(participants));
        console.log(chalk.gray(`  ID: ${game.gameId}`));
        console.log(chalk.gray(`  ${game.sport.name} • ${game.league.name}`));
        console.log(chalk.gray(`  Starts: ${startsAt.toLocaleString()}`));

        // Show main odds
        if (game.conditions.length > 0) {
          const mainCondition = game.conditions[0];
          const oddsStr = mainCondition.outcomes
            .map(o => {
              const odds = api.formatOdds(o.currentOdds);
              return `${OUTCOME_NAMES[o.outcomeId] || o.outcomeId}: ${odds.toFixed(2)}`;
            })
            .join(' | ');
          console.log(chalk.yellow(`  Odds: ${oddsStr}`));
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail('Failed to fetch games');
      console.error(chalk.red((error as Error).message));
    }
  });

// Odds command
program
  .command('odds <gameId>')
  .description('Get detailed odds for a game')
  .option('-c, --chain <chain>', 'Chain to use', 'polygon')
  .action(async (gameId, options) => {
    const spinner = ora('Fetching odds...').start();
    try {
      const api = new AzuroAPI(getChain(options));
      const game = await api.getGame(gameId);

      if (!game) {
        spinner.fail('Game not found');
        return;
      }

      spinner.succeed(`Odds for: ${game.title}`);
      console.log('');

      for (const condition of game.conditions) {
        console.log(chalk.cyan(`Condition ID: ${condition.conditionId}`));
        console.log(chalk.gray(`  Status: ${condition.status}`));

        for (const outcome of condition.outcomes) {
          const odds = api.formatOdds(outcome.currentOdds);
          const name = OUTCOME_NAMES[outcome.outcomeId] || `Outcome ${outcome.outcomeId}`;
          console.log(chalk.white(`  ${name}: `) + chalk.yellow(odds.toFixed(2)));
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail('Failed to fetch odds');
      console.error(chalk.red((error as Error).message));
    }
  });

// Balance command
program
  .command('balance')
  .description('Check wallet balance')
  .option('-c, --chain <chain>', 'Chain to use', 'polygon')
  .option('-k, --key <privateKey>', 'Private key (or set PRIVATE_KEY env var)')
  .action(async (options) => {
    const privateKey = options.key || process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error(chalk.red('Private key required. Use -k flag or set PRIVATE_KEY env var'));
      return;
    }

    const spinner = ora('Checking balance...').start();
    try {
      const betting = new AzuroBetting(privateKey, getChain(options));
      await betting.init();

      const balance = await betting.getBalance();
      const chain = CHAINS[getChain(options)];

      spinner.succeed('Balance retrieved');
      console.log('');
      console.log(chalk.white(`  Wallet: ${betting.getWalletAddress()}`));
      console.log(chalk.white(`  Chain: ${chain.name}`));
      console.log(chalk.green(`  ${balance.token}: ${balance.balance}`));
      console.log(chalk.gray(`  Native: ${balance.native}`));
    } catch (error) {
      spinner.fail('Failed to check balance');
      console.error(chalk.red((error as Error).message));
    }
  });

// Bet command
program
  .command('bet')
  .description('Place a bet')
  .option('-c, --chain <chain>', 'Chain to use', 'polygon')
  .option('-k, --key <privateKey>', 'Private key')
  .option('--condition <conditionId>', 'Condition ID')
  .option('--outcome <outcomeId>', 'Outcome ID')
  .option('--amount <amount>', 'Bet amount')
  .option('--slippage <percent>', 'Slippage tolerance percent', '5')
  .action(async (options) => {
    const privateKey = options.key || process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error(chalk.red('Private key required'));
      return;
    }

    // Interactive mode if params not provided
    let { condition, outcome, amount } = options;

    if (!condition || !outcome || !amount) {
      const api = new AzuroAPI(getChain(options));
      const games = await api.getGames({ limit: 10 });

      const gameChoices = games.map(g => ({
        name: `${g.participants.map(p => p.name).join(' vs ')} (${g.sport.name})`,
        value: g,
      }));

      const { selectedGame } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedGame',
          message: 'Select a game:',
          choices: gameChoices,
        },
      ]);

      const conditionChoices = selectedGame.conditions.map((c: any) => ({
        name: `Condition ${c.conditionId}`,
        value: c,
      }));

      const { selectedCondition } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedCondition',
          message: 'Select a condition:',
          choices: conditionChoices,
        },
      ]);

      condition = selectedCondition.conditionId;

      const outcomeChoices = selectedCondition.outcomes.map((o: any) => {
        const odds = api.formatOdds(o.currentOdds);
        const name = OUTCOME_NAMES[o.outcomeId] || `Outcome ${o.outcomeId}`;
        return {
          name: `${name} @ ${odds.toFixed(2)}`,
          value: o,
        };
      });

      const { selectedOutcome } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedOutcome',
          message: 'Select outcome:',
          choices: outcomeChoices,
        },
      ]);

      outcome = selectedOutcome.outcomeId;
      const currentOdds = api.formatOdds(selectedOutcome.currentOdds);

      const { betAmount } = await inquirer.prompt([
        {
          type: 'input',
          name: 'betAmount',
          message: `Enter bet amount (${CHAINS[getChain(options)].token}):`,
          default: '1',
        },
      ]);

      amount = betAmount;

      // Calculate min odds with slippage
      const slippage = parseFloat(options.slippage) / 100;
      const minOdds = (currentOdds * (1 - slippage)).toFixed(6);

      console.log('');
      console.log(chalk.white('Bet Summary:'));
      console.log(chalk.gray(`  Game: ${selectedGame.participants.map((p: any) => p.name).join(' vs ')}`));
      console.log(chalk.gray(`  Condition: ${condition}`));
      console.log(chalk.gray(`  Outcome: ${OUTCOME_NAMES[outcome] || outcome}`));
      console.log(chalk.gray(`  Odds: ${currentOdds.toFixed(2)}`));
      console.log(chalk.gray(`  Min Odds: ${minOdds}`));
      console.log(chalk.gray(`  Amount: ${amount} ${CHAINS[getChain(options)].token}`));
      console.log(chalk.gray(`  Potential Payout: ${(parseFloat(amount) * currentOdds).toFixed(2)}`));
      console.log('');

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Place this bet?',
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('Bet cancelled'));
        return;
      }

      const spinner = ora('Placing bet...').start();
      try {
        const betting = new AzuroBetting(privateKey, getChain(options));
        await betting.init();

        const result = await betting.placeBet({
          conditionId: condition,
          outcomeId: outcome,
          amount,
          minOdds,
        });

        spinner.succeed('Bet placed successfully!');
        console.log(chalk.green(`  TX: ${result.txHash}`));
        console.log(chalk.green(`  Bet ID: ${result.betId}`));
      } catch (error) {
        spinner.fail('Failed to place bet');
        console.error(chalk.red((error as Error).message));
      }
    }
  });

// My bets command
program
  .command('mybets')
  .description('List your bets')
  .option('-c, --chain <chain>', 'Chain to use', 'polygon')
  .option('-k, --key <privateKey>', 'Private key')
  .option('--status <status>', 'Filter by status (Accepted, Resolved, Canceled)')
  .action(async (options) => {
    const privateKey = options.key || process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error(chalk.red('Private key required'));
      return;
    }

    const spinner = ora('Fetching your bets...').start();
    try {
      const betting = new AzuroBetting(privateKey, getChain(options));
      const api = new AzuroAPI(getChain(options));
      const chain = CHAINS[getChain(options)];

      const bets = await api.getBets(betting.getWalletAddress(), {
        status: options.status,
      });

      spinner.succeed(`Found ${bets.length} bets`);
      console.log('');

      for (const bet of bets) {
        const amount = api.formatAmount(bet.amount, chain.tokenDecimals);
        const odds = api.formatOdds(bet.odds);
        const payout = bet.payout ? api.formatAmount(bet.payout, chain.tokenDecimals) : 0;

        const statusColor = {
          Accepted: chalk.blue,
          Resolved: bet.result === 'Won' ? chalk.green : chalk.red,
          Canceled: chalk.gray,
        }[bet.status] || chalk.white;

        console.log(chalk.white.bold(`Bet #${bet.betId}`));
        console.log(chalk.gray(`  Game: ${bet.outcome.condition.game.title}`));
        console.log(chalk.gray(`  Amount: ${amount.toFixed(2)} ${chain.token}`));
        console.log(chalk.gray(`  Odds: ${odds.toFixed(2)}`));
        console.log(statusColor(`  Status: ${bet.status} ${bet.result ? `(${bet.result})` : ''}`));

        if (bet.result === 'Won' && !bet.isRedeemed) {
          console.log(chalk.yellow(`  💰 Payout available: ${payout.toFixed(2)} ${chain.token}`));
        } else if (bet.isRedeemed) {
          console.log(chalk.green(`  ✓ Redeemed: ${payout.toFixed(2)} ${chain.token}`));
        }
        console.log('');
      }
    } catch (error) {
      spinner.fail('Failed to fetch bets');
      console.error(chalk.red((error as Error).message));
    }
  });

// Withdraw command
program
  .command('withdraw [betId]')
  .description('Withdraw payout from a winning bet')
  .option('-c, --chain <chain>', 'Chain to use', 'polygon')
  .option('-k, --key <privateKey>', 'Private key')
  .option('--all', 'Withdraw all winning bets')
  .action(async (betId, options) => {
    const privateKey = options.key || process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error(chalk.red('Private key required'));
      return;
    }

    const betting = new AzuroBetting(privateKey, getChain(options));
    await betting.init();

    const api = new AzuroAPI(getChain(options));
    const chain = CHAINS[getChain(options)];

    if (options.all) {
      // Withdraw all winning bets
      const spinner = ora('Finding winning bets...').start();
      try {
        const winningBets = await api.getWinnableBets(betting.getWalletAddress());

        if (winningBets.length === 0) {
          spinner.info('No winning bets to withdraw');
          return;
        }

        spinner.succeed(`Found ${winningBets.length} winning bets`);
        console.log('');

        for (const bet of winningBets) {
          const withdrawSpinner = ora(`Withdrawing bet #${bet.betId}...`).start();
          try {
            const txHash = await betting.withdrawPayout(bet.betId);
            const payout = api.formatAmount(bet.payout || bet.potentialPayout, chain.tokenDecimals);
            withdrawSpinner.succeed(`Bet #${bet.betId}: ${payout.toFixed(2)} ${chain.token} - TX: ${txHash}`);
          } catch (error) {
            withdrawSpinner.fail(`Bet #${bet.betId}: ${(error as Error).message}`);
          }
        }
      } catch (error) {
        spinner.fail('Failed to fetch winning bets');
        console.error(chalk.red((error as Error).message));
      }
    } else if (betId) {
      // Withdraw specific bet
      const spinner = ora(`Withdrawing bet #${betId}...`).start();
      try {
        // Check payout first
        const payout = await betting.checkPayout(betId);
        if (parseFloat(payout) === 0) {
          spinner.fail('No payout available for this bet');
          return;
        }

        const txHash = await betting.withdrawPayout(betId);
        spinner.succeed(`Withdrawn ${payout} ${chain.token}`);
        console.log(chalk.green(`  TX: ${txHash}`));
      } catch (error) {
        spinner.fail('Failed to withdraw');
        console.error(chalk.red((error as Error).message));
      }
    } else {
      // Interactive mode - show winning bets
      const spinner = ora('Finding winning bets...').start();
      const winningBets = await api.getWinnableBets(betting.getWalletAddress());

      if (winningBets.length === 0) {
        spinner.info('No winning bets to withdraw');
        return;
      }

      spinner.succeed(`Found ${winningBets.length} winning bets`);

      const choices = winningBets.map(bet => {
        const payout = api.formatAmount(bet.payout || bet.potentialPayout, chain.tokenDecimals);
        return {
          name: `Bet #${bet.betId} - ${bet.outcome.condition.game.title} - ${payout.toFixed(2)} ${chain.token}`,
          value: bet.betId,
        };
      });

      const { selectedBets } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedBets',
          message: 'Select bets to withdraw:',
          choices,
        },
      ]);

      for (const id of selectedBets) {
        const withdrawSpinner = ora(`Withdrawing bet #${id}...`).start();
        try {
          const txHash = await betting.withdrawPayout(id);
          withdrawSpinner.succeed(`TX: ${txHash}`);
        } catch (error) {
          withdrawSpinner.fail((error as Error).message);
        }
      }
    }
  });

// Browse command - Interactive game browser
program
  .command('browse')
  .description('Interactive browser for sports, games, and odds')
  .option('-c, --chain <chain>', 'Chain to use (polygon, gnosis, polygonAmoy)', 'polygon')
  .option('-k, --key <privateKey>', 'Private key (or set PRIVATE_KEY env var)')
  .action(async (options) => {
    try {
      const api = new AzuroAPI(getChain(options));
      const chain = CHAINS[getChain(options)];

      console.log('');
      console.log(chalk.cyan.bold('  Azuro Betting Browser'));
      console.log(chalk.gray(`  Chain: ${chain.name}`));
      console.log('');

      // Main browse loop
      let running = true;
      while (running) {
        // Step 1: Fetch and display sports
        const sportsSpinner = ora('Fetching sports...').start();
        let sports;
        try {
          sports = await api.getSports();
          sportsSpinner.succeed(`Found ${sports.length} sports`);
        } catch (error) {
          sportsSpinner.fail('Failed to fetch sports');
          console.error(chalk.red((error as Error).message));
          return;
        }

        if (sports.length === 0) {
          console.log(chalk.yellow('No sports available'));
          return;
        }

        const sportChoices = [
          ...sports.map(s => ({
            name: chalk.white(s.name),
            value: s.slug,
          })),
          new inquirer.Separator(),
          { name: chalk.gray('Exit'), value: '__exit__' },
        ];

        let selectedSport: string;
        try {
          const sportAnswer = await inquirer.prompt([
            {
              type: 'list',
              name: 'selectedSport',
              message: 'Select a sport:',
              choices: sportChoices,
              pageSize: 15,
            },
          ]);
          selectedSport = sportAnswer.selectedSport;
        } catch (error) {
          const errMsg = (error as Error).message || '';
          const isPromptClosed = errMsg.includes('closed') ||
            errMsg.includes('force closed') ||
            errMsg.includes('User force closed') ||
            (error as any).isTtyError ||
            errMsg.includes('readline');
          if (isPromptClosed) {
            console.log(chalk.gray('\nGoodbye!'));
            return;
          }
          console.error(chalk.red('\nPrompt error:'), errMsg);
          if (process.env.DEBUG) {
            console.error((error as Error).stack);
          }
          return;
        }

        if (selectedSport === '__exit__') {
          console.log(chalk.gray('Goodbye!'));
          return;
        }

      const sportName = sports.find(s => s.slug === selectedSport)?.name || selectedSport;

      // Step 2: Choose between Live and Upcoming games
      let gameMode: string;
      try {
        const modeAnswer = await inquirer.prompt([
          {
            type: 'list',
            name: 'gameMode',
            message: `${sportName} - Select game type:`,
            choices: [
              { name: `${chalk.red.bold('LIVE')} ${chalk.white('Live Games')} ${chalk.gray('- Currently happening matches')}`, value: 'live' },
              { name: `${chalk.blue.bold('PRE')} ${chalk.white('Upcoming Games')} ${chalk.gray('- Pre-match betting')}`, value: 'upcoming' },
              new inquirer.Separator(),
              { name: chalk.yellow('Back to Sports'), value: '__back__' },
              { name: chalk.gray('Exit'), value: '__exit__' },
            ],
            pageSize: 10,
          },
        ]);
        gameMode = modeAnswer.gameMode;
      } catch (error) {
        const errMsg = (error as Error).message || '';
        const isPromptClosed = errMsg.includes('closed') ||
          errMsg.includes('force closed') ||
          (error as any).isTtyError ||
          errMsg.includes('readline');
        if (isPromptClosed) {
          console.log(chalk.gray('\nGoodbye!'));
          return;
        }
        console.error(chalk.red('\nPrompt error:'), errMsg);
        return;
      }

      if (gameMode === '__back__') {
        continue;
      }
      if (gameMode === '__exit__') {
        console.log(chalk.gray('Goodbye!'));
        return;
      }

      const isLiveMode = gameMode === 'live';

      // Step 3: Fetch games for selected sport and mode
      const gamesSpinner = ora(`Fetching ${isLiveMode ? 'live' : 'upcoming'} ${sportName} games...`).start();
      let games;
      try {
        if (isLiveMode) {
          games = await api.getLiveGames({ sportSlug: selectedSport, limit: 100 });
        } else {
          games = await api.getGames({ sportSlug: selectedSport, limit: 100 });
        }
        gamesSpinner.succeed(`Found ${games.length} ${isLiveMode ? 'live' : 'upcoming'} games`);
      } catch (error) {
        gamesSpinner.fail('Failed to fetch games');
        console.error(chalk.red((error as Error).message));
        continue;
      }

      if (games.length === 0) {
        console.log(chalk.yellow(`No ${isLiveMode ? 'live' : 'upcoming'} games available for ${sportName}`));
        continue;
      }

      // Helper function to calculate match time for live games
      const getMatchTime = (startsAt: string): string => {
        const startTime = parseInt(startsAt) * 1000;
        const now = Date.now();
        const elapsedMinutes = Math.floor((now - startTime) / 60000);

        // Assuming standard 90-minute football match with 15-min halftime
        if (elapsedMinutes < 45) {
          return `${elapsedMinutes}'`;
        } else if (elapsedMinutes >= 45 && elapsedMinutes < 60) {
          return 'HT';
        } else if (elapsedMinutes >= 60 && elapsedMinutes < 105) {
          return `${elapsedMinutes - 15}'`; // Subtract halftime
        } else {
          return '90+';
        }
      };

      // Group games by league
      const gamesByLeague: Record<string, typeof games> = {};
      for (const game of games) {
        const leagueKey = `${game.league.country.name} - ${game.league.name}`;
        if (!gamesByLeague[leagueKey]) {
          gamesByLeague[leagueKey] = [];
        }
        gamesByLeague[leagueKey].push(game);
      }

      // Build game choices grouped by league
      const gameChoices: any[] = [];
      for (const [league, leagueGames] of Object.entries(gamesByLeague)) {
        gameChoices.push(new inquirer.Separator(chalk.cyan(`\n  ${league}`)));
        for (const game of leagueGames) {
          const startsAt = new Date(parseInt(game.startsAt) * 1000);
          const participants = game.participants.map(p => p.name).join(' vs ');

          let displayStr: string;
          if (isLiveMode) {
            // For live games: show LIVE indicator and match time
            const matchTime = getMatchTime(game.startsAt);
            displayStr = `${chalk.red.bold('LIVE')} ${chalk.yellow(`[${matchTime}]`)} ${chalk.white(participants)}`;
          } else {
            // For upcoming games: show date/time
            const timeStr = startsAt.toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            displayStr = `${chalk.white(participants)} ${chalk.gray(`(${timeStr})`)}`;
          }

          gameChoices.push({
            name: displayStr,
            value: { ...game, isLive: isLiveMode },
          });
        }
      }
      gameChoices.push(new inquirer.Separator());
      gameChoices.push({ name: chalk.yellow('Back to Sports'), value: '__back__' });
      gameChoices.push({ name: chalk.gray('Exit'), value: '__exit__' });

      let selectedGame: any;
      try {
        const gameAnswer = await inquirer.prompt([
          {
            type: 'list',
            name: 'selectedGame',
            message: `Select a ${isLiveMode ? 'live' : 'upcoming'} ${sportName} game:`,
            choices: gameChoices,
            pageSize: 20,
          },
        ]);
        selectedGame = gameAnswer.selectedGame;
      } catch (error) {
        const errMsg = (error as Error).message || '';
        const isPromptClosed = errMsg.includes('closed') ||
          errMsg.includes('force closed') ||
          (error as any).isTtyError ||
          errMsg.includes('readline');
        if (isPromptClosed) {
          console.log(chalk.gray('\nGoodbye!'));
          return;
        }
        console.error(chalk.red('\nPrompt error:'), errMsg);
        if (process.env.DEBUG) {
          console.error((error as Error).stack);
        }
        return;
      }

      if (selectedGame === '__back__') {
        continue;
      }
      if (selectedGame === '__exit__') {
        console.log(chalk.gray('Goodbye!'));
        return;
      }

      // Step 3: Show odds for selected game with live streaming
      let browsingGame = true;

      // Set up WebSocket for live odds
      const wsClient = new AzuroWebSocket(getChain(options));
      let wsConnected = false;
      let liveOddsData: Map<string, Map<string, number>> = new Map(); // conditionId -> outcomeId -> odds

      // Extract condition IDs for subscription
      const conditionIds = selectedGame.conditions.map((c: any) => c.conditionId);

      // Initialize live odds data from current game data
      for (const condition of selectedGame.conditions) {
        const conditionOdds = new Map<string, number>();
        for (const outcome of condition.outcomes) {
          const odds = api.formatOdds(outcome.currentOdds);
          conditionOdds.set(outcome.outcomeId, odds);
        }
        liveOddsData.set(condition.conditionId, conditionOdds);
      }

      // Track odds updates silently (no console.log spam)
      let oddsUpdatesCount = 0;
      // Track odds at last render for showing arrows on refresh
      const lastRenderedOdds = new Map<string, number>();
      // Track recent changes with timestamps for arrow display
      const recentChanges = new Map<string, { direction: 'up' | 'down'; timestamp: number }>();
      const ARROW_DISPLAY_DURATION = 5000; // Show arrows for 5 seconds

      // Initialize with current odds so arrows show after first update
      for (const condition of selectedGame.conditions) {
        for (const outcome of condition.outcomes) {
          const key = `${condition.conditionId}-${outcome.outcomeId}`;
          lastRenderedOdds.set(key, api.formatOdds(outcome.currentOdds));
        }
      }

      // Track if we need to refresh display
      let needsRefresh = false;
      let refreshInterval: NodeJS.Timeout | null = null;
      let isPromptActive = false;

      // Function to render the game display
      const renderGameDisplay = () => {
        if (process.env.DEBUG) {
          console.log('[RENDER] Starting render');
        }
        const participants = selectedGame.participants.map((p: any) => p.name).join(' vs ');
        const startsAt = new Date(parseInt(selectedGame.startsAt) * 1000);

        // Clear screen - use ANSI escape codes that don't reset terminal state
        // \x1B[2J clears the screen, \x1B[H moves cursor to home position
        process.stdout.write('\x1B[2J\x1B[H');

        console.log('');

        // Show live game header with match time
        if (selectedGame.isLive) {
          const startTime = parseInt(selectedGame.startsAt) * 1000;
          const now = Date.now();
          const elapsedMinutes = Math.floor((now - startTime) / 60000);
          let matchTimeDisplay: string;
          if (elapsedMinutes < 45) {
            matchTimeDisplay = `${elapsedMinutes}'`;
          } else if (elapsedMinutes >= 45 && elapsedMinutes < 60) {
            matchTimeDisplay = 'HT';
          } else if (elapsedMinutes >= 60 && elapsedMinutes < 105) {
            matchTimeDisplay = `${elapsedMinutes - 15}'`;
          } else {
            matchTimeDisplay = '90+';
          }
          console.log(chalk.red.bold(`  LIVE [${matchTimeDisplay}]`) + chalk.cyan.bold(` ${participants}`));
        } else {
          console.log(chalk.cyan.bold(`  ${participants}`));
        }

        console.log(chalk.gray(`  ${selectedGame.league.country.name} - ${selectedGame.league.name}`));

        if (selectedGame.isLive) {
          console.log(chalk.yellow(`  Started: ${startsAt.toLocaleString()}`));
        } else {
          console.log(chalk.gray(`  Starts: ${startsAt.toLocaleString()}`));
        }

        if (wsConnected) {
          console.log(chalk.green('  \u25CF LIVE ODDS') + chalk.gray(' (auto-updates)'));
        }
        console.log('');

        if (selectedGame.conditions.length === 0) {
          console.log(chalk.yellow('  No betting markets available for this game'));
        } else {
          // Group outcomes by market using dictionaries, with live odds
          const groupedMarkets = groupOutcomesByMarket(selectedGame.conditions, (odds: string, conditionId?: string, outcomeId?: string) => {
            // Use live odds if available
            if (conditionId && outcomeId && liveOddsData.has(conditionId)) {
              const liveOdds = liveOddsData.get(conditionId)!.get(outcomeId);
              if (liveOdds !== undefined) {
                return liveOdds;
              }
            }
            return api.formatOdds(odds);
          });

          const now = Date.now();
          for (const market of groupedMarkets) {
            console.log(chalk.cyan.bold(`  ${market.marketName}:`));
            const oddsDisplay = market.outcomes
              .map(o => {
                // Show arrow based on recent changes
                const key = `${o.conditionId}-${o.outcomeId}`;
                const change = recentChanges.get(key);
                let indicator = '';
                if (change && (now - change.timestamp) < ARROW_DISPLAY_DURATION) {
                  if (change.direction === 'up') {
                    indicator = chalk.greenBright(' ↑');
                  } else {
                    indicator = chalk.redBright(' ↓');
                  }
                }
                return `${chalk.white(o.selectionName)} @ ${chalk.yellow(o.odds.toFixed(2))}${indicator}`;
              })
              .join(' | ');
            console.log(`    ${oddsDisplay}`);
            console.log('');
          }

          // Update lastRenderedOdds AFTER displaying
          for (const market of groupedMarkets) {
            for (const o of market.outcomes) {
              const key = `${o.conditionId}-${o.outcomeId}`;
              lastRenderedOdds.set(key, o.odds);
            }
          }
        }

        // Show status line
        console.log(chalk.gray('  ─────────────────────────────────────────'));
        const currentSlip = getSlipSummary();
        if (currentSlip.selections.length > 0) {
          console.log(chalk.cyan(`  Slip: ${currentSlip.selections.length} selection(s) | ${chalk.yellow(currentSlip.totalOdds.toFixed(2))} odds`));
        }
        console.log('');
      };

      // Handle odds updates from WebSocket - NOW WITH LIVE DISPLAY UPDATE
      const handleOddsUpdate = (update: OddsUpdate) => {
        const { conditionId, outcomeId, newOdds, previousOdds, direction } = update;

        // DEBUG logging
        if (process.env.DEBUG) {
          console.log(`[UPDATE] Received odds update`);
          console.log(`[UPDATE] conditionId=${conditionId.slice(0,20)}... outcomeId=${outcomeId} direction=${direction} odds=${previousOdds.toFixed(3)}->${newOdds.toFixed(3)}`);
        }

        // Update local odds data
        if (!liveOddsData.has(conditionId)) {
          liveOddsData.set(conditionId, new Map());
        }
        liveOddsData.get(conditionId)!.set(outcomeId, newOdds);

        // Track change with timestamp for arrow display
        if (direction !== 'same') {
          const key = `${conditionId}-${outcomeId}`;
          recentChanges.set(key, { direction, timestamp: Date.now() });
          oddsUpdatesCount++;
          needsRefresh = true;

          if (process.env.DEBUG) {
            console.log(`[UPDATE] Count: ${oddsUpdatesCount}, needsRefresh: true`);
          }
        }
      };

      wsClient.on('odds_update', handleOddsUpdate);
      if (process.env.DEBUG) {
        console.log('[UPDATE] odds_update listener attached to wsClient');
      }

      wsClient.on('connected', () => {
        wsConnected = true;
        if (process.env.DEBUG) {
          console.log('[UPDATE] WebSocket connected');
        }
      });

      wsClient.on('subscribed', (ids: string[]) => {
        if (process.env.DEBUG) {
          console.log('[UPDATE] Subscribed to', ids.length, 'conditions:', ids.slice(0, 3).join(', '), ids.length > 3 ? '...' : '');
        }
      });

      wsClient.on('disconnected', () => {
        wsConnected = false;
      });

      wsClient.on('reconnecting', ({ attempt, delay }: { attempt: number; delay: number }) => {
        // Silent reconnect
      });

      // Connect to WebSocket
      try {
        await wsClient.connect();
        wsConnected = true;

        // Set initial odds for direction detection
        for (const condition of selectedGame.conditions) {
          const outcomes = condition.outcomes.map((o: any) => ({
            outcomeId: o.outcomeId,
            odds: api.formatOdds(o.currentOdds),
          }));
          wsClient.setInitialOdds(condition.conditionId, outcomes);
        }

        // Subscribe to all conditions
        if (conditionIds.length > 0) {
          if (process.env.DEBUG) {
            console.log('[UPDATE] Subscribing to', conditionIds.length, 'conditions:', conditionIds.slice(0, 3).join(', '), conditionIds.length > 3 ? '...' : '');
          }
          wsClient.subscribe(conditionIds);
        } else {
          if (process.env.DEBUG) {
            console.log('[UPDATE] WARNING: No condition IDs to subscribe to!');
          }
        }
      } catch {
        // WebSocket connection failed, continue without live updates
        wsConnected = false;
      }

      // Start refresh interval for live updates
      if (process.env.DEBUG) {
        console.log('[REFRESH] Starting refresh interval');
      }
      refreshInterval = setInterval(() => {
        if (process.env.DEBUG) {
          console.log('[REFRESH] Checking... needsRefresh=' + needsRefresh + ' isPromptActive=' + isPromptActive);
        }
        // Refresh display when updates come in and user is just viewing (not in menu)
        if (needsRefresh && !isPromptActive) {
          if (process.env.DEBUG) {
            console.log('[REFRESH] Refreshing display');
          }
          needsRefresh = false;
          renderGameDisplay();
        }

        // Clean up old arrows
        const now = Date.now();
        for (const [key, change] of recentChanges) {
          if (now - change.timestamp > ARROW_DISPLAY_DURATION) {
            recentChanges.delete(key);
          }
        }
      }, 500);

      while (browsingGame) {
        // Render the game display with odds
        renderGameDisplay();

        // Get current slip for display
        const currentSlip = getSlipSummary();
        const slipCount = currentSlip.selections.length;

        // Build outcome choices for betting (grouped by market) with live odds
        const outcomeChoices: any[] = [];

        // Add refresh option FIRST at the very top if connected to WebSocket
        if (wsConnected) {
          const refreshLabel = oddsUpdatesCount > 0
            ? chalk.greenBright(`🔄 Refresh Display (${oddsUpdatesCount} update${oddsUpdatesCount > 1 ? 's' : ''})`)
            : chalk.cyan('🔄 Refresh Display');
          outcomeChoices.push({
            name: refreshLabel,
            value: { action: 'refresh' },
          });
          outcomeChoices.push(new inquirer.Separator());
        }

        if (selectedGame.conditions.length > 0) {
          const groupedMarketsForChoices = groupOutcomesByMarket(selectedGame.conditions, (odds: string, conditionId?: string, outcomeId?: string) => {
            // Use live odds if available
            if (conditionId && outcomeId && liveOddsData.has(conditionId)) {
              const liveOdds = liveOddsData.get(conditionId)!.get(outcomeId);
              if (liveOdds !== undefined) {
                return liveOdds;
              }
            }
            return api.formatOdds(odds);
          });

          for (const market of groupedMarketsForChoices) {
            outcomeChoices.push(new inquirer.Separator(chalk.cyan(`\n  ${market.marketName}`)));
            for (const outcome of market.outcomes) {
              // Find the original condition and outcome for betting
              const condition = selectedGame.conditions.find((c: any) => c.conditionId === outcome.conditionId);
              const originalOutcome = condition?.outcomes.find((o: any) => o.outcomeId === outcome.outcomeId);

              // Check if already in slip
              const isInSlip = currentSlip.selections.some(
                s => s.conditionId === outcome.conditionId && s.outcomeId === outcome.outcomeId
              );

              // Get change indicator based on recent changes
              const key = `${outcome.conditionId}-${outcome.outcomeId}`;
              const change = recentChanges.get(key);
              let indicator = '';
              if (change && (Date.now() - change.timestamp) < ARROW_DISPLAY_DURATION) {
                if (change.direction === 'up') {
                  indicator = chalk.greenBright(' ↑');
                } else {
                  indicator = chalk.redBright(' ↓');
                }
              }

              const label = isInSlip
                ? `  ${chalk.gray('In Slip')} ${chalk.white(outcome.selectionName)} @ ${chalk.yellow(outcome.odds.toFixed(2))}${indicator}`
                : `  ${chalk.green('+ Add')} ${chalk.white(outcome.selectionName)} @ ${chalk.yellow(outcome.odds.toFixed(2))}${indicator}`;

              outcomeChoices.push({
                name: label,
                value: {
                  action: isInSlip ? 'already_in_slip' : 'add_to_slip',
                  condition,
                  outcome: originalOutcome,
                  selectionName: outcome.selectionName,
                  marketName: market.marketName,
                  liveOdds: outcome.odds, // Pass live odds for adding to slip
                },
              });
            }
          }
        }

        outcomeChoices.push(new inquirer.Separator());

        // Add slip-related options
        if (slipCount > 0) {
          outcomeChoices.push({
            name: chalk.cyan(`View Slip (${slipCount} selection${slipCount > 1 ? 's' : ''})`),
            value: { action: 'view_slip' },
          });
          outcomeChoices.push({
            name: chalk.green('Place Bet from Slip'),
            value: { action: 'place_bet' },
          });
          outcomeChoices.push({
            name: chalk.yellow('Clear Slip'),
            value: { action: 'clear_slip' },
          });
          outcomeChoices.push(new inquirer.Separator());
        }

        outcomeChoices.push({ name: chalk.yellow('Back to Games'), value: { action: 'back' } });
        outcomeChoices.push({ name: chalk.gray('Exit'), value: { action: 'exit' } });

        let selection: any;
        try {
          // Build prompt message with updates indicator
          let promptMessage: string;
          const updatesIndicator = oddsUpdatesCount > 0 ? chalk.yellow(` (⚡ ${oddsUpdatesCount} update${oddsUpdatesCount > 1 ? 's' : ''})`) : '';
          if (slipCount > 0) {
            promptMessage = `Slip: ${slipCount} selection${slipCount > 1 ? 's' : ''} | ${chalk.yellow(currentSlip.totalOdds.toFixed(2))} odds${updatesIndicator}`;
          } else {
            promptMessage = `Select an outcome to add to slip:${updatesIndicator}`;
          }

          // Mark prompt as active to pause live updates during user interaction
          isPromptActive = true;

          const selectionAnswer = await inquirer.prompt([
            {
              type: 'list',
              name: 'selection',
              message: promptMessage,
              choices: outcomeChoices,
              pageSize: 20,
            },
          ]);
          selection = selectionAnswer.selection;

          // Mark prompt as inactive to resume live updates
          isPromptActive = false;
        } catch (error) {
          isPromptActive = false;
          const errMsg = (error as Error).message || '';
          const isPromptClosed = errMsg.includes('closed') ||
            errMsg.includes('force closed') ||
            (error as any).isTtyError ||
            errMsg.includes('readline');
          if (isPromptClosed) {
            if (refreshInterval) clearInterval(refreshInterval);
            wsClient.disconnect();
            console.log(chalk.gray('\nGoodbye!'));
            return;
          }
          console.error(chalk.red('\nPrompt error:'), errMsg);
          if (process.env.DEBUG) {
            console.error((error as Error).stack);
          }
          if (refreshInterval) clearInterval(refreshInterval);
          wsClient.disconnect();
          return;
        }

        if (selection.action === 'back') {
          // Disconnect WebSocket and cleanup when leaving game view
          if (refreshInterval) clearInterval(refreshInterval);
          wsClient.disconnect();
          browsingGame = false;
          continue;
        }
        if (selection.action === 'exit') {
          // Disconnect WebSocket and cleanup on exit
          if (refreshInterval) clearInterval(refreshInterval);
          wsClient.disconnect();
          console.log(chalk.gray('Goodbye!'));
          return;
        }

        // Refresh display with updated odds
        if (selection.action === 'refresh') {
          // Show how many odds were updated before resetting
          const updatesMessage = oddsUpdatesCount > 0
            ? chalk.green(`  ✓ ${oddsUpdatesCount} odd${oddsUpdatesCount > 1 ? 's' : ''} updated since last view`)
            : chalk.gray('  No odds changes since last view');
          console.log(updatesMessage);

          // Reset counter BEFORE re-render so arrows show correctly
          // (arrows compare current liveOddsData against lastRenderedOdds)
          oddsUpdatesCount = 0;

          // Note: We do NOT update lastRenderedOdds here - the re-render will show arrows
          // The arrows will be shown in the next render because liveOddsData differs from lastRenderedOdds
          // After the user sees the arrows, the next refresh will update lastRenderedOdds

          continue; // This will re-render the display with updated odds and arrows
        }

        // Add to slip
        if (selection.action === 'add_to_slip') {
          const { condition, outcome, selectionName, marketName, liveOdds } = selection;
          // Use live odds if available, otherwise use the API odds
          const odds = liveOdds ?? api.formatOdds(outcome.currentOdds);

          try {
            addToSlip({
              conditionId: condition.conditionId,
              outcomeId: outcome.outcomeId,
              odds,
              selectionName,
              marketName,
              gameTitle: selectedGame.participants.map((p: any) => p.name).join(' vs '),
              gameId: selectedGame.gameId,
              startsAt: selectedGame.startsAt,
            });

            console.log('');
            console.log(chalk.green(`  Added to slip: ${selectionName} @ ${odds.toFixed(2)}`));

            const updatedSlip = getSlipSummary();
            console.log(chalk.gray(`  Slip now has ${updatedSlip.selections.length} selection(s)`));
            console.log(chalk.gray(`  Combined odds: ${updatedSlip.totalOdds.toFixed(2)}`));
            console.log('');
          } catch (error) {
            console.log('');
            console.log(chalk.yellow(`  ${(error as Error).message}`));
            console.log('');
          }
          continue;
        }

        if (selection.action === 'already_in_slip') {
          console.log('');
          console.log(chalk.gray('  This selection is already in your slip.'));
          console.log('');
          continue;
        }

        // View slip
        if (selection.action === 'view_slip') {
          const slip = getSlipSummary();
          console.log('');
          console.log(chalk.cyan.bold('  Current Bet Slip'));
          console.log(chalk.gray('  ─────────────────────────────────────────'));

          for (let i = 0; i < slip.selections.length; i++) {
            const sel = slip.selections[i];
            console.log(chalk.white(`  ${i + 1}. ${sel.gameTitle}`));
            console.log(chalk.gray(`     ${sel.marketName}: ${chalk.yellow(sel.selectionName)}`));
            console.log(chalk.gray(`     Odds: ${chalk.green(sel.odds.toFixed(2))}`));
          }

          console.log(chalk.gray('  ─────────────────────────────────────────'));
          console.log(chalk.white(`  Total Odds: ${chalk.green(slip.totalOdds.toFixed(2))}`));
          console.log(chalk.white(`  Stake: ${chalk.yellow(slip.stake.toFixed(2))} ${chain.token}`));
          console.log(chalk.white(`  Potential: ${chalk.green(slip.potentialPayout.toFixed(2))} ${chain.token}`));
          console.log('');

          let slipAction: string;
          try {
            const slipActionAnswer = await inquirer.prompt([
              {
                type: 'list',
                name: 'slipAction',
                message: 'Slip action:',
                choices: [
                  { name: 'Continue browsing', value: 'continue' },
                  { name: 'Change stake', value: 'stake' },
                  { name: 'Remove selection', value: 'remove' },
                  { name: 'Place bet now', value: 'place' },
                ],
              },
            ]);
            slipAction = slipActionAnswer.slipAction;
          } catch (error) {
            if (isPromptCancelled(error)) {
              console.log(chalk.gray('\nGoodbye!'));
              return;
            }
            console.error(chalk.red('\nPrompt error:'), (error as Error).message);
            return;
          }

          if (slipAction === 'stake') {
            try {
              const { newStake } = await inquirer.prompt([
                {
                  type: 'input',
                  name: 'newStake',
                  message: `Enter stake (${chain.token}):`,
                  default: slip.stake.toString(),
                },
              ]);
              setSlipStake(parseFloat(newStake));
              console.log(chalk.green(`  Stake updated to ${newStake} ${chain.token}`));
            } catch (error) {
              if (isPromptCancelled(error)) {
                console.log(chalk.gray('\nGoodbye!'));
                return;
              }
              console.error(chalk.red('\nPrompt error:'), (error as Error).message);
              return;
            }
          } else if (slipAction === 'remove') {
            try {
              const { toRemove } = await inquirer.prompt([
                {
                  type: 'list',
                  name: 'toRemove',
                  message: 'Remove:',
                  choices: slip.selections.map((sel, i) => ({
                    name: `${sel.gameTitle} - ${sel.selectionName}`,
                    value: sel.id,
                  })),
                },
              ]);
              removeFromSlip(toRemove);
              console.log(chalk.green('  Removed from slip'));
            } catch (error) {
              if (isPromptCancelled(error)) {
                console.log(chalk.gray('\nGoodbye!'));
                return;
              }
              console.error(chalk.red('\nPrompt error:'), (error as Error).message);
              return;
            }
          } else if (slipAction === 'place') {
            const privateKey = options.key || process.env.PRIVATE_KEY;
            if (!privateKey) {
              console.log(chalk.red('  Private key required. Set PRIVATE_KEY env var'));
            } else {
              await placeBetFromSlip(privateKey, getChain(options));
            }
          }
          continue;
        }

        // Clear slip
        if (selection.action === 'clear_slip') {
          try {
            const { confirm } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'confirm',
                message: 'Clear entire slip?',
                default: false,
              },
            ]);
            if (confirm) {
              clearSlip();
              console.log(chalk.green('  Slip cleared'));
            }
          } catch (error) {
            if (isPromptCancelled(error)) {
              console.log(chalk.gray('\nGoodbye!'));
              return;
            }
            console.error(chalk.red('\nPrompt error:'), (error as Error).message);
            return;
          }
          continue;
        }

        // Place bet from slip
        if (selection.action === 'place_bet') {
          const privateKey = options.key || process.env.PRIVATE_KEY;
          if (!privateKey) {
            console.log('');
            console.log(chalk.red('  Private key required to place bets.'));
            console.log(chalk.gray('  Use -k flag or set PRIVATE_KEY env var'));
            console.log('');
            continue;
          }

          const slip = getSlipSummary();
          console.log('');
          console.log(chalk.cyan.bold('  Place Bet'));
          console.log(chalk.gray(`  Selections: ${slip.selections.length}`));
          console.log(chalk.gray(`  Combined Odds: ${slip.totalOdds.toFixed(2)}`));
          console.log(chalk.gray(`  Stake: ${slip.stake.toFixed(2)} ${chain.token}`));
          console.log(chalk.green(`  Potential Payout: ${slip.potentialPayout.toFixed(2)} ${chain.token}`));
          console.log('');

          try {
            const { confirmBet } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'confirmBet',
                message: 'Place this bet?',
                default: false,
              },
            ]);

            if (!confirmBet) {
              console.log(chalk.yellow('  Cancelled'));
              continue;
            }
          } catch (error) {
            if (isPromptCancelled(error)) {
              console.log(chalk.gray('\nGoodbye!'));
              return;
            }
            console.error(chalk.red('\nPrompt error:'), (error as Error).message);
            return;
          }

          await placeBetFromSlip(privateKey, getChain(options));
        }
      }
    }
    } catch (error) {
      // Top-level error handler for browse command
      closeWebSocket(); // Clean up any WebSocket connections
      if (isPromptCancelled(error)) {
        console.log(chalk.gray('\nGoodbye!'));
        return;
      }
      console.error(chalk.red('\nBrowse error:'), (error as Error).message);
      if (process.env.DEBUG) {
        console.error((error as Error).stack);
      }
    }
  });

// Show config
program
  .command('config')
  .description('Show configuration and supported chains')
  .action(() => {
    console.log(chalk.white.bold('\nSupported Chains:\n'));
    for (const [key, chain] of Object.entries(CHAINS)) {
      console.log(chalk.cyan(`  ${chain.name} (${key})`));
      console.log(chalk.gray(`    Chain ID: ${chain.id}`));
      console.log(chalk.gray(`    Token: ${chain.token}`));
      console.log(chalk.gray(`    LP: ${chain.contracts.lp}`));
      console.log('');
    }

    console.log(chalk.white.bold('Environment Variables:\n'));
    console.log(chalk.gray('  PRIVATE_KEY - Your wallet private key'));
    console.log('');
  });

// Wallet command - show wallet info and balance
program
  .command('wallet')
  .description('Show wallet address and USDT balance')
  .option('-c, --chain <chain>', 'Chain to use (polygon, gnosis, polygonAmoy)', 'polygon')
  .option('-k, --key <privateKey>', 'Private key (or set PRIVATE_KEY env var)')
  .action(async (options) => {
    const privateKey = options.key || process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.log('');
      console.log(chalk.red('  No wallet connected.'));
      console.log(chalk.gray('  Set PRIVATE_KEY in .env file or use -k flag'));
      console.log('');

      const { setupWallet } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'setupWallet',
          message: 'Would you like to set up a wallet now?',
          default: false,
        },
      ]);

      if (setupWallet) {
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'Choose an option:',
            choices: [
              { name: 'Enter existing private key', value: 'import' },
              { name: 'Generate new wallet (for testing)', value: 'generate' },
              { name: 'Cancel', value: 'cancel' },
            ],
          },
        ]);

        if (action === 'import') {
          const { key } = await inquirer.prompt([
            {
              type: 'password',
              name: 'key',
              message: 'Enter your private key:',
              mask: '*',
            },
          ]);

          if (WalletManager.isValidPrivateKey(key)) {
            const address = WalletManager.getAddressFromPrivateKey(key);
            console.log('');
            console.log(chalk.green(`  Valid key for address: ${address}`));

            const { save } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'save',
                message: 'Save private key to .env file?',
                default: true,
              },
            ]);

            if (save) {
              WalletManager.savePrivateKeyToEnv(key);
              console.log(chalk.green('  Private key saved to .env'));
            }
          } else {
            console.log(chalk.red('  Invalid private key format'));
          }
        } else if (action === 'generate') {
          const newWallet = WalletManager.generateWallet();
          console.log('');
          console.log(chalk.yellow('  New wallet generated (FOR TESTING ONLY):'));
          console.log(chalk.white(`  Address: ${newWallet.address}`));
          console.log(chalk.white(`  Private Key: ${newWallet.privateKey}`));
          console.log('');
          console.log(chalk.red('  WARNING: Save this private key securely!'));
          console.log(chalk.red('  It will not be shown again.'));

          const { save } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'save',
              message: 'Save private key to .env file?',
              default: true,
            },
          ]);

          if (save) {
            WalletManager.savePrivateKeyToEnv(newWallet.privateKey);
            console.log(chalk.green('  Private key saved to .env'));
          }
        }
      }
      return;
    }

    const spinner = ora('Loading wallet info...').start();
    try {
      const walletManager = new WalletManager(getChain(options));
      walletManager.loadWallet(privateKey);
      const info = await walletManager.getWalletInfo();

      spinner.succeed('Wallet loaded');
      console.log('');
      console.log(chalk.cyan.bold('  Wallet Information'));
      console.log(chalk.gray('  ─────────────────────────────────────────'));
      console.log(chalk.white(`  Address:  ${info.address}`));
      console.log(chalk.white(`  Chain:    ${info.chainName} (ID: ${info.chainId})`));
      console.log('');
      console.log(chalk.green.bold(`  ${info.tokenSymbol} Balance: ${formatBalance(info.usdtBalance)}`));
      console.log(chalk.gray(`  ${info.nativeSymbol} Balance: ${formatBalance(info.nativeBalance)}`));
      console.log('');
    } catch (error) {
      spinner.fail('Failed to load wallet');
      console.error(chalk.red((error as Error).message));
    }
  });

// Slip command - view and manage bet slip
program
  .command('slip')
  .description('View and manage your bet slip')
  .option('-c, --chain <chain>', 'Chain to use', 'polygon')
  .action(async (options) => {
    const chain = CHAINS[getChain(options)];
    const summary = getSlipSummary();

    console.log('');
    console.log(chalk.cyan.bold('  Bet Slip'));
    console.log(chalk.gray('  ─────────────────────────────────────────'));

    if (summary.selections.length === 0) {
      console.log(chalk.gray('  Your slip is empty.'));
      console.log(chalk.gray('  Use "azuro browse" to add selections.'));
      console.log('');
      return;
    }

    // Display selections
    for (let i = 0; i < summary.selections.length; i++) {
      const sel = summary.selections[i];
      console.log(chalk.white(`  ${i + 1}. ${sel.gameTitle}`));
      console.log(chalk.gray(`     ${sel.marketName}: ${chalk.yellow(sel.selectionName)}`));
      console.log(chalk.gray(`     Odds: ${chalk.green(sel.odds.toFixed(2))}`));
      console.log('');
    }

    console.log(chalk.gray('  ─────────────────────────────────────────'));

    if (summary.isCombo) {
      console.log(chalk.white(`  Bet Type: ${chalk.cyan('Accumulator/Parlay')}`));
      console.log(chalk.white(`  Combined Odds: ${chalk.green(summary.totalOdds.toFixed(2))}`));
    } else {
      console.log(chalk.white(`  Bet Type: ${chalk.cyan('Single')}`));
      console.log(chalk.white(`  Odds: ${chalk.green(summary.totalOdds.toFixed(2))}`));
    }

    console.log(chalk.white(`  Stake: ${chalk.yellow(summary.stake.toFixed(2))} ${chain.token}`));
    console.log(chalk.white(`  Potential Payout: ${chalk.green(summary.potentialPayout.toFixed(2))} ${chain.token}`));
    console.log('');

    // Actions menu
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Change stake', value: 'stake' },
          { name: 'Remove selection', value: 'remove' },
          { name: 'Clear slip', value: 'clear' },
          { name: 'Place bet', value: 'place' },
          { name: 'Exit', value: 'exit' },
        ],
      },
    ]);

    if (action === 'stake') {
      const { newStake } = await inquirer.prompt([
        {
          type: 'input',
          name: 'newStake',
          message: `Enter stake amount (${chain.token}):`,
          default: summary.stake.toString(),
          validate: (input) => {
            const num = parseFloat(input);
            if (isNaN(num) || num <= 0) return 'Enter a valid positive number';
            return true;
          },
        },
      ]);
      setSlipStake(parseFloat(newStake));
      console.log(chalk.green(`  Stake updated to ${newStake} ${chain.token}`));
    } else if (action === 'remove') {
      const { toRemove } = await inquirer.prompt([
        {
          type: 'list',
          name: 'toRemove',
          message: 'Select selection to remove:',
          choices: summary.selections.map((sel, i) => ({
            name: `${i + 1}. ${sel.gameTitle} - ${sel.selectionName}`,
            value: sel.id,
          })),
        },
      ]);
      removeFromSlip(toRemove);
      console.log(chalk.green('  Selection removed'));
    } else if (action === 'clear') {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Clear entire slip?',
          default: false,
        },
      ]);
      if (confirm) {
        clearSlip();
        console.log(chalk.green('  Slip cleared'));
      }
    } else if (action === 'place') {
      // Place bet from slip
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        console.log(chalk.red('  Private key required. Set PRIVATE_KEY env var'));
        return;
      }

      const { confirmPlace } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmPlace',
          message: `Place bet for ${summary.stake.toFixed(2)} ${chain.token} at ${summary.totalOdds.toFixed(2)} odds?`,
          default: false,
        },
      ]);

      if (!confirmPlace) {
        console.log(chalk.yellow('  Bet cancelled'));
        return;
      }

      await placeBetFromSlip(privateKey, getChain(options));
    }
  });

// Helper function to place bet from slip
async function placeBetFromSlip(privateKey: string, chainKey: ChainKey): Promise<void> {
  const summary = getSlipSummary();
  const chain = CHAINS[chainKey];

  if (summary.selections.length === 0) {
    console.log(chalk.red('  Slip is empty'));
    return;
  }

  const spinner = ora('Placing bet...').start();

  try {
    const betting = new AzuroBetting(privateKey, chainKey);
    await betting.init();

    // For single bets, place directly
    // For accumulators, Azuro requires express betting (combo bets)
    if (summary.isSingle) {
      const sel = summary.selections[0];
      const slippage = loadSettings().defaultSlippage / 100;
      const minOdds = (sel.odds * (1 - slippage)).toFixed(6);

      const result = await betting.placeBet({
        conditionId: sel.conditionId,
        outcomeId: sel.outcomeId,
        amount: summary.stake.toString(),
        minOdds,
      });

      spinner.succeed('Bet placed successfully!');
      console.log(chalk.green(`  TX: ${result.txHash}`));
      console.log(chalk.green(`  Bet ID: ${result.betId}`));

      // Add to history
      addBetToHistory({
        betId: result.betId,
        txHash: result.txHash,
        chain: chainKey,
        selections: summary.selections,
        stake: summary.stake,
        totalOdds: summary.totalOdds,
        potentialPayout: summary.potentialPayout,
        status: 'pending',
      });

      // Clear slip after successful bet
      clearSlip();
      console.log(chalk.gray('  Slip cleared'));
    } else {
      // For combo/parlay bets - place each as separate singles
      // Note: Azuro express bets require a different contract call
      spinner.info('Combo bets: Placing as separate singles...');

      const slippage = loadSettings().defaultSlippage / 100;
      const stakePerBet = summary.stake / summary.selections.length;

      for (const sel of summary.selections) {
        const betSpinner = ora(`Placing bet on ${sel.selectionName}...`).start();
        try {
          const minOdds = (sel.odds * (1 - slippage)).toFixed(6);
          const result = await betting.placeBet({
            conditionId: sel.conditionId,
            outcomeId: sel.outcomeId,
            amount: stakePerBet.toString(),
            minOdds,
          });

          betSpinner.succeed(`${sel.selectionName}: TX ${result.txHash.slice(0, 10)}...`);

          addBetToHistory({
            betId: result.betId,
            txHash: result.txHash,
            chain: chainKey,
            selections: [sel],
            stake: stakePerBet,
            totalOdds: sel.odds,
            potentialPayout: stakePerBet * sel.odds,
            status: 'pending',
          });
        } catch (error) {
          betSpinner.fail(`${sel.selectionName}: ${(error as Error).message}`);
        }
      }

      clearSlip();
      console.log(chalk.gray('  Slip cleared'));
    }
  } catch (error) {
    spinner.fail('Failed to place bet');
    console.error(chalk.red((error as Error).message));
  }
}

// Claim command - withdraw all winning bets
program
  .command('claim')
  .description('Claim/withdraw all winning bets')
  .option('-c, --chain <chain>', 'Chain to use', 'polygon')
  .option('-k, --key <privateKey>', 'Private key')
  .action(async (options) => {
    const privateKey = options.key || process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.log(chalk.red('  Private key required'));
      return;
    }

    const chainKey = getChain(options);
    const chain = CHAINS[chainKey];

    const spinner = ora('Finding winning bets...').start();

    try {
      const betting = new AzuroBetting(privateKey, chainKey);
      await betting.init();

      const api = new AzuroAPI(chainKey);
      const winningBets = await api.getWinnableBets(betting.getWalletAddress());

      if (winningBets.length === 0) {
        spinner.info('No winning bets to claim');
        return;
      }

      let totalPayout = 0;
      for (const bet of winningBets) {
        const payout = api.formatAmount(bet.payout || bet.potentialPayout, chain.tokenDecimals);
        totalPayout += payout;
      }

      spinner.succeed(`Found ${winningBets.length} winning bets worth ${totalPayout.toFixed(2)} ${chain.token}`);
      console.log('');

      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Claim all ${winningBets.length} winning bets?`,
          default: true,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('  Cancelled'));
        return;
      }

      let claimed = 0;
      let claimedAmount = 0;

      for (const bet of winningBets) {
        const claimSpinner = ora(`Claiming bet #${bet.betId}...`).start();
        try {
          const txHash = await betting.withdrawPayout(bet.betId);
          const payout = api.formatAmount(bet.payout || bet.potentialPayout, chain.tokenDecimals);
          claimedAmount += payout;
          claimed++;

          claimSpinner.succeed(`Bet #${bet.betId}: +${payout.toFixed(2)} ${chain.token}`);

          // Update history
          updateBetStatus(bet.betId, 'claimed', payout);
        } catch (error) {
          claimSpinner.fail(`Bet #${bet.betId}: ${(error as Error).message}`);
        }
      }

      console.log('');
      console.log(chalk.green.bold(`  Claimed ${claimed}/${winningBets.length} bets`));
      console.log(chalk.green.bold(`  Total: +${claimedAmount.toFixed(2)} ${chain.token}`));
      console.log('');
    } catch (error) {
      spinner.fail('Failed to claim');
      console.error(chalk.red((error as Error).message));
    }
  });

// History command - show bet history with P/L
program
  .command('history')
  .description('Show bet history and profit/loss summary')
  .option('-l, --limit <limit>', 'Number of bets to show', '10')
  .action((options) => {
    const history = loadHistory();
    const pl = getProfitLoss();
    const limit = parseInt(options.limit);

    console.log('');
    console.log(chalk.cyan.bold('  Betting History & P/L Summary'));
    console.log(chalk.gray('  ─────────────────────────────────────────'));
    console.log('');

    // P/L Summary
    const plColor = pl.netPL >= 0 ? chalk.green : chalk.red;
    const plSign = pl.netPL >= 0 ? '+' : '';

    console.log(chalk.white('  Summary:'));
    console.log(chalk.gray(`    Total Staked:    ${pl.totalStaked.toFixed(2)}`));
    console.log(chalk.gray(`    Total Won:       ${pl.totalWon.toFixed(2)}`));
    console.log(plColor(`    Net P/L:         ${plSign}${pl.netPL.toFixed(2)}`));
    console.log(chalk.gray(`    Win Rate:        ${pl.winRate.toFixed(1)}%`));
    console.log(chalk.gray(`    Bets: ${pl.wonCount}W / ${pl.lostCount}L / ${pl.pendingCount}P`));
    console.log('');
    console.log(chalk.gray('  ─────────────────────────────────────────'));
    console.log('');

    if (history.length === 0) {
      console.log(chalk.gray('  No betting history yet.'));
      console.log('');
      return;
    }

    // Recent bets
    console.log(chalk.white(`  Recent Bets (last ${Math.min(limit, history.length)}):`));
    console.log('');

    const recentBets = history.slice(0, limit);
    for (const bet of recentBets) {
      const date = new Date(bet.timestamp).toLocaleDateString();
      const statusColors: Record<string, typeof chalk> = {
        pending: chalk.blue,
        won: chalk.green,
        lost: chalk.red,
        claimed: chalk.green,
      };
      const statusColor = statusColors[bet.status] || chalk.white;

      const gameTitle = bet.selections[0]?.gameTitle || 'Unknown';
      const selection = bet.selections[0]?.selectionName || '';

      console.log(chalk.white(`  #${bet.betId} - ${date}`));
      console.log(chalk.gray(`    ${gameTitle}`));
      console.log(chalk.gray(`    ${selection} @ ${bet.totalOdds.toFixed(2)}`));
      console.log(chalk.gray(`    Stake: ${bet.stake.toFixed(2)} | `) + statusColor(`${bet.status.toUpperCase()}`));
      if (bet.payout) {
        console.log(chalk.green(`    Payout: +${bet.payout.toFixed(2)}`));
      }
      console.log('');
    }
  });

// Auto-withdraw settings command
program
  .command('auto-withdraw')
  .description('Enable/disable automatic withdrawal of winning bets')
  .option('--on', 'Enable auto-withdraw')
  .option('--off', 'Disable auto-withdraw')
  .option('--status', 'Show current status')
  .action((options) => {
    if (options.on) {
      setAutoWithdraw(true);
      console.log(chalk.green('  Auto-withdraw enabled'));
      console.log(chalk.gray('  Winning bets will be automatically claimed'));
    } else if (options.off) {
      setAutoWithdraw(false);
      console.log(chalk.yellow('  Auto-withdraw disabled'));
      console.log(chalk.gray('  Use "azuro claim" to manually claim winnings'));
    } else {
      const enabled = getAutoWithdraw();
      console.log('');
      console.log(chalk.white(`  Auto-withdraw: ${enabled ? chalk.green('ENABLED') : chalk.yellow('DISABLED')}`));
      console.log('');
      console.log(chalk.gray('  Use --on to enable or --off to disable'));
    }
  });

program.parse();
