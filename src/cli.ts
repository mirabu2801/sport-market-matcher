#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, type AppConfig } from './config';
import { finalizeCandidateMatches, matchMarkets } from './matcher';
import {
  createPool,
  ensureMatchSchema,
  loadPolymarketMarketsPage,
  loadSxMarkets,
  writeMatchResult
} from './repository';
import { extractPolymarketOutcomeTokens } from './tokenMapping';
import type { CandidateMatch, MatchOptions, MatchResult, OutcomeTokenMapping, SxMarket } from './types';

interface CliOptions {
  write: boolean;
  migrateOnly: boolean;
  help: boolean;
  matchingOverrides: Partial<MatchOptions>;
  reports: ReportOptions;
  pmLimit?: number;
  sxLimit?: number;
  intervalMinutes?: number;
}

interface ReportOptions {
  markdown: boolean;
  json: boolean;
  csv: boolean;
}

interface ReportPaths {
  markdownPath?: string;
  jsonPath?: string;
  csvPath?: string;
}

let shutdownRequested = false;
let wakeSchedulerSleep: (() => void) | undefined;

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.help) {
    printHelp();
    return;
  }

  if (cli.intervalMinutes !== undefined) {
    await runScheduled(cli);
    return;
  }

  await runOnce(cli);
}

async function runOnce(cli: CliOptions): Promise<void> {
  const config = applyCliOverrides(loadConfig(), cli);
  const pool = createPool(config);

  try {
    if (cli.migrateOnly) {
      await ensureMatchSchema(pool, config);
      console.log('Created matcher tables if they did not exist.');
      return;
    }

    if (cli.write) {
      await ensureMatchSchema(pool, config);
    }

    const sxMarkets = await timed('Loaded SX rows', () => loadSxMarkets(pool, config));

    const result = await timed('Matched markets', async () =>
      matchPolymarketBatches(pool, config, sxMarkets)
    );
    printSummary(result);
    const reportPaths = await writeReports(result, config, cli.reports);
    printReportPaths(reportPaths);

    if (cli.write) {
      const persisted = await writeMatchResult(pool, config, result, {
        filters: config.filters,
        appliedFilters: appliedSourceFilters(),
        matching: config.matching,
        sourceTables: {
          polymarket: config.polymarketTable,
          sx: config.sxMarketsTable
        }
      });
      console.log(
        [
          `Persisted run ${persisted.runId}.`,
          `found=${persisted.foundMatchCount}`,
          `new=${persisted.newMatchCount}`,
          `updated=${persisted.conflictReplacedCount}`
        ].join(' ')
      );
    } else {
      console.log('Dry run only. Re-run with --write to persist selected matches.');
    }
  } finally {
    await pool.end();
  }
}

async function runScheduled(cli: CliOptions): Promise<void> {
  if (cli.migrateOnly) {
    throw new Error('--interval-minutes cannot be used with --migrate-only');
  }

  installShutdownHandlers();
  const intervalMinutes = cli.intervalMinutes ?? 10;
  const intervalMs = intervalMinutes * 60_000;
  let runNumber = 0;

  console.log(`Scheduler started. Running every ${intervalMinutes} minutes.`);

  while (!shutdownRequested) {
    runNumber += 1;
    const runStartedAtMs = Date.now();
    console.log(`Scheduled run ${runNumber} started at ${new Date().toISOString()}.`);

    try {
      await runOnce(cli);
      console.log(`Scheduled run ${runNumber} finished at ${new Date().toISOString()}.`);
    } catch (error) {
      console.error(`Scheduled run ${runNumber} failed at ${new Date().toISOString()}.`);
      console.error(error);
    }

    if (shutdownRequested) {
      break;
    }

    const nextRunAtMs = runStartedAtMs + intervalMs;
    const sleepMs = Math.max(0, nextRunAtMs - Date.now());
    console.log(`Next scheduled run at ${new Date(nextRunAtMs).toISOString()}.`);
    await sleepUntilNextRun(sleepMs);
  }

  console.log('Scheduler stopped.');
}

function installShutdownHandlers(): void {
  const requestShutdown = (signal: NodeJS.Signals) => {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    console.log(`Received ${signal}; stopping after the current run.`);
    wakeSchedulerSleep?.();
  };

  process.once('SIGINT', requestShutdown);
  process.once('SIGTERM', requestShutdown);
}

async function sleepUntilNextRun(delayMs: number): Promise<void> {
  if (shutdownRequested) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    wakeSchedulerSleep = () => {
      clearTimeout(timer);
      resolve();
    };
  });

  wakeSchedulerSleep = undefined;
}

async function matchPolymarketBatches(
  pool: ReturnType<typeof createPool>,
  config: AppConfig,
  sxMarkets: SxMarket[]
): Promise<MatchResult> {
  const batchSize = parsePositiveInteger(process.env.MATCH_PM_BATCH_SIZE, 10_000);
  const maxRows = config.filters.pmLimit > 0 ? config.filters.pmLimit : Number.POSITIVE_INFINITY;
  const allCandidates: CandidateMatch[] = [];
  let afterConditionId: string | undefined;
  let loaded = 0;
  let batchNumber = 0;
  const startedAt = Date.now();

  while (loaded < maxRows) {
    const remaining = maxRows - loaded;
    const pageSize = Math.min(batchSize, remaining);
    const batch = await loadPolymarketMarketsPage(pool, config, afterConditionId, pageSize);
    if (batch.length === 0) {
      break;
    }

    batchNumber += 1;
    loaded += batch.length;
    afterConditionId = batch.at(-1)?.conditionId;
    const batchStarted = Date.now();
    const batchResult = matchMarkets(batch, sxMarkets, config.matching);
    allCandidates.push(...batchResult.allCandidates);
    const batchSeconds = ((Date.now() - batchStarted) / 1000).toFixed(2);
    const totalSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Batch ${batchNumber}: loaded ${loaded} Polymarket rows; batch candidates ${batchResult.stats.candidateCount}; total candidates ${allCandidates.length}; batch ${batchSeconds}s; total ${totalSeconds}s.`
    );

    if (batch.length < pageSize) {
      break;
    }
  }

  return finalizeCandidateMatches(allCandidates, loaded, sxMarkets.length, config.matching);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

async function writeReports(
  result: MatchResult,
  config: AppConfig,
  options: ReportOptions
): Promise<ReportPaths> {
  if (!options.markdown && !options.json && !options.csv) {
    return {};
  }

  const reportDir = path.resolve(process.cwd(), 'reports');
  await mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const markdownPath = path.join(reportDir, `market-match-report-${stamp}.md`);
  const jsonPath = path.join(reportDir, `market-match-report-${stamp}.json`);
  const csvPath = path.join(reportDir, `market-match-report-${stamp}.csv`);
  const baseReport = {
    generatedAt: new Date().toISOString(),
    sourceTables: {
      polymarket: config.polymarketTable,
      sx: config.sxMarketsTable
    },
    filters: {
      ...appliedSourceFilters(),
      pmLimit: config.filters.pmLimit || null,
      sxLimit: config.filters.sxLimit || null
    },
    matching: config.matching,
    stats: result.stats
  };
  const paths: ReportPaths = {};

  if (options.markdown || options.csv) {
    const compactMatches = result.matches.map(compactCandidate);
    const compactReviewCandidates = result.reviewCandidates.map(compactCandidate);

    if (options.markdown) {
      await writeFile(
        markdownPath,
        renderMarkdownReport({
          ...baseReport,
          matches: compactMatches,
          reviewCandidates: compactReviewCandidates
        })
      );
      paths.markdownPath = markdownPath;
    }

    if (options.csv) {
      await writeFile(
        csvPath,
        renderCsvReport([
          ...compactMatches.map((entry) => ({ ...entry, reportStatus: 'matched' })),
          ...compactReviewCandidates.map((entry) => ({ ...entry, reportStatus: 'review' }))
        ])
      );
      paths.csvPath = csvPath;
    }
  }

  if (options.json) {
    const compact = {
      ...baseReport,
      matches: result.matches.map(compactCandidate),
      reviewCandidates: result.reviewCandidates.map(compactCandidate),
      allCandidates: result.allCandidates.map(compactCandidate)
    };

    await writeFile(jsonPath, `${JSON.stringify(compact, null, 2)}\n`);
    paths.jsonPath = jsonPath;
  }

  return paths;
}

function printReportPaths(paths: ReportPaths): void {
  if (paths.markdownPath) {
    console.log(`Report written to ${paths.markdownPath}`);
  }

  if (paths.jsonPath) {
    console.log(`Full candidate JSON written to ${paths.jsonPath}`);
  }

  if (paths.csvPath) {
    console.log(`CSV report written to ${paths.csvPath}`);
  }

  if (!paths.markdownPath && !paths.jsonPath && !paths.csvPath) {
    console.log('Report files disabled.');
  }
}

function appliedSourceFilters(): { polymarket: string; sx: string } {
  return {
    polymarket: `"is_sport" = true and "gameStartTime" >= now() - interval '3 days'`,
    sx: 'outcome IS NULL and team_one_name IS NOT NULL'
  };
}

function compactCandidate(candidate: CandidateMatch): Record<string, unknown> {
  const tokenMapping = candidate.reasons.tokenMapping;
  return {
    polymarketConditionId: candidate.polymarketId,
    sxMarketHash: candidate.sxMarketHash,
    score: candidate.score,
    confidence: candidate.confidence,
    status: candidate.status,
    method: candidate.reasons.method ?? 'unknown',
    polymarketQuestion: candidate.polymarket.question,
    sxStatus: candidate.sx.status,
    sxTeams: [candidate.sx.team_one_name, candidate.sx.team_two_name].filter(Boolean),
    sxOutcomes: [
      candidate.sx.outcome_one_name,
      candidate.sx.outcome_two_name,
      candidate.sx.outcome_void_name
    ].filter(Boolean),
    sxLeague: candidate.sx.league_label,
    sxSport: candidate.sx.sport_label,
    sxMarketType: candidate.sx.market_type,
    sxLine: candidate.sx.line,
    sxGameTimeAt: candidate.sx.game_time_at,
    canonicalMarketKey: candidate.reasons.canonicalMarketKey,
    polymarketCanonicalMarketKey: candidate.reasons.polymarketCanonicalMarketKey,
    sxCanonicalMarketKey: candidate.reasons.sxCanonicalMarketKey,
    polymarketTokens: extractPolymarketOutcomeTokens(candidate.polymarket.tokens),
    tokenMapping,
    tokenMappingSummary: renderTokenMappingSummary(tokenMapping),
    componentScores: candidate.componentScores,
    reasons: candidate.reasons
  };
}

function renderMarkdownReport(report: {
  generatedAt: string;
  sourceTables: Record<string, string>;
  filters: Record<string, unknown>;
  stats: MatchResult['stats'];
  matches: Array<Record<string, unknown>>;
  reviewCandidates: Array<Record<string, unknown>>;
}): string {
  const lines = [
    '# Market Match Report',
    '',
    `Generated at: ${report.generatedAt}`,
    '',
    '## Sources',
    '',
    `- Polymarket table: \`${report.sourceTables.polymarket}\``,
    `- SX table: \`${report.sourceTables.sx}\``,
    `- Polymarket filter: \`${report.filters.polymarket}\``,
    `- SX filter: \`${report.filters.sx}\``,
    '',
    '## Summary',
    '',
    `- Polymarket rows loaded: ${report.stats.polymarketCount}`,
    `- SX rows loaded: ${report.stats.sxCount}`,
    `- Candidates scored: ${report.stats.candidateCount}`,
    `- One-to-one matches selected: ${report.stats.matchCount}`,
    `- Review candidates: ${report.stats.reviewCount}`,
    '',
    '## Selected Matches',
    '',
    renderTable(report.matches),
    '',
    '## Review Candidates',
    '',
    renderTable(report.reviewCandidates),
    ''
  ];

  return `${lines.join('\n')}\n`;
}

function renderCsvReport(rows: Array<Record<string, unknown>>): string {
  const headers = [
    'reportStatus',
    'score',
    'confidence',
    'method',
    'polymarketConditionId',
    'sxMarketHash',
    'polymarketQuestion',
    'sxTeams',
    'sxOutcomes',
    'sxSport',
    'sxLeague',
    'sxMarketType',
    'sxLine',
    'sxGameTimeAt',
    'canonicalMarketKey',
    'tokenMappingSummary'
  ];

  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(csvValue(row[header]))).join(','))
  ].join('\n').concat('\n');
}

function csvValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(' | ');
  }

  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function renderTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '_None._';
  }

  const header = '| Score | Method | Polymarket | SX | Key | Tokens |';
  const separator = '|---:|---|---|---|---|---|';
  const body = rows.map((row) =>
    [
      Number(row.score).toFixed(4),
      escapeMarkdown(String(row.method ?? '')),
      escapeMarkdown(String(row.polymarketQuestion ?? '')).slice(0, 120),
      escapeMarkdown(String((row.sxTeams as unknown[] | undefined)?.join(' vs ') ?? row.sxMarketHash ?? '')).slice(0, 80),
      escapeMarkdown(String(row.canonicalMarketKey ?? '')),
      escapeMarkdown(String(row.tokenMappingSummary ?? ''))
    ]
      .map((value) => ` ${value} `)
      .join('|')
      .replace(/^/, '|')
      .replace(/$/, '|')
  );

  return [header, separator, ...body].join('\n');
}

function renderTokenMappingSummary(mapping: OutcomeTokenMapping | undefined): string {
  return mapping?.summary?.join(', ') ?? '';
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const result = await fn();
  const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(2);
  const count = Array.isArray(result) ? ` (${result.length})` : '';
  console.log(`${label}${count} in ${elapsedSeconds}s.`);
  return result;
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    write: false,
    migrateOnly: false,
    help: false,
    matchingOverrides: {},
    reports: {
      markdown: true,
      json: false,
      csv: false
    }
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--write':
        options.write = true;
        break;
      case '--dry-run':
        options.write = false;
        break;
      case '--migrate-only':
        options.migrateOnly = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--min-score':
        options.matchingOverrides.minScore = readNumber(args, ++index, arg);
        break;
      case '--review-score':
        options.matchingOverrides.reviewScore = readNumber(args, ++index, arg);
        break;
      case '--ambiguity-gap':
        options.matchingOverrides.ambiguityGap = readNumber(args, ++index, arg);
        break;
      case '--max-time-delta-hours':
        options.matchingOverrides.maxTimeDeltaHours = readNumber(args, ++index, arg);
        break;
      case '--min-event-score':
        options.matchingOverrides.minEventScore = readNumber(args, ++index, arg);
        break;
      case '--max-candidates-per-pm':
        options.matchingOverrides.maxCandidatesPerPolymarket = readNumber(args, ++index, arg);
        break;
      case '--pm-limit':
        options.pmLimit = readNumber(args, ++index, arg);
        break;
      case '--sx-limit':
        options.sxLimit = readNumber(args, ++index, arg);
        break;
      case '--interval-minutes':
      case '--every-minutes':
        options.intervalMinutes = readPositiveNumber(args, ++index, arg);
        break;
      case '--watch':
        options.intervalMinutes = options.intervalMinutes ?? 10;
        break;
      case '--json-report':
      case '--report-json':
        options.reports.json = true;
        break;
      case '--csv-report':
      case '--report-csv':
        options.reports.csv = true;
        break;
      case '--no-markdown-report':
        options.reports.markdown = false;
        break;
      case '--no-report':
        options.reports.markdown = false;
        options.reports.json = false;
        options.reports.csv = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function applyCliOverrides(config: AppConfig, cli: CliOptions): AppConfig {
  return {
    ...config,
    filters: {
      ...config.filters,
      pmLimit: cli.pmLimit ?? config.filters.pmLimit,
      sxLimit: cli.sxLimit ?? config.filters.sxLimit
    },
    matching: {
      ...config.matching,
      ...cli.matchingOverrides
    }
  };
}

function readNumber(args: string[], index: number, flag: string): number {
  const value = args[index];
  if (value === undefined) {
    throw new Error(`${flag} requires a numeric value`);
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${flag} requires a numeric value, got ${value}`);
  }

  return numeric;
}

function readPositiveNumber(args: string[], index: number, flag: string): number {
  const numeric = readNumber(args, index, flag);
  if (numeric <= 0) {
    throw new Error(`${flag} requires a positive numeric value, got ${numeric}`);
  }

  return numeric;
}

function printSummary(result: ReturnType<typeof matchMarkets>): void {
  console.log(`Loaded ${result.stats.polymarketCount} Polymarket markets and ${result.stats.sxCount} SX markets.`);
  console.log(
    `Scored ${result.stats.candidateCount} candidates, selected ${result.stats.matchCount} one-to-one matches, left ${result.stats.reviewCount} review candidates.`
  );

  for (const match of result.matches.slice(0, 10)) {
    console.log(
      [
        `[${match.confidence}] ${match.score.toFixed(4)}`,
        match.polymarketId,
        '<->',
        match.sxMarketHash,
        '-',
        match.polymarket.question
      ].join(' ')
    );
  }

  if (result.matches.length > 10) {
    console.log(`...and ${result.matches.length - 10} more matches.`);
  }
}

function printHelp(): void {
  console.log(`
Usage:
  npm run match
  npm run match -- --write
  npm run match -- --write --interval-minutes 10
  npm run migrate

Options:
  --write                         Persist selected matches.
  --dry-run                       Do not write anything. This is the default.
  --migrate-only                  Create matcher tables and exit.
  --interval-minutes <n>          Run forever with this many minutes between starts.
  --watch                         Shortcut for --interval-minutes 10.
  --json-report                   Write full JSON report with all candidates. Disabled by default.
  --csv-report                    Write CSV report for selected/review pairs. Disabled by default.
  --no-markdown-report            Do not write the default Markdown report.
  --no-report                     Do not write report files.
  --min-score <n>                 Minimum score for auto-selected matches.
  --review-score <n>              Minimum score kept as a review candidate.
  --ambiguity-gap <n>             Required gap versus nearest alternative.
  --max-time-delta-hours <n>      Reject markets farther apart than this.
  --min-event-score <n>           Minimum team/event score unless text is very similar.
  --max-candidates-per-pm <n>     Candidate cap per Polymarket market.
  --pm-limit <n>                  Polymarket rows to load.
  --sx-limit <n>                  SX rows to load.
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
