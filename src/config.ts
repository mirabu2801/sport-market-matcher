import 'dotenv/config';
import type { MatchOptions } from './types';

export interface AppConfig {
  databaseUrl?: string;
  polymarketTable: string;
  sxMarketsTable: string;
  matchRunsTable: string;
  matchesTable: string;
  filters: {
    sportOnly: boolean;
    activeOnly: boolean;
    openOnly: boolean;
    lookbackHours: number;
    lookaheadHours: number;
    pmLimit: number;
    sxLimit: number;
    sxStatusBlocklist: string[];
  };
  matching: MatchOptions;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: nonEmpty(env.DATABASE_URL) ?? buildPostgresqlUrl(env),
    polymarketTable: env.POLYMARKET_TABLE ?? 'markets_info',
    sxMarketsTable: env.SX_MARKETS_TABLE ?? 'sx_markets',
    matchRunsTable: env.MARKET_MATCH_RUNS_TABLE ?? 'market_match_runs',
    matchesTable: env.MARKET_MATCHES_TABLE ?? 'market_matches',
    filters: {
      sportOnly: parseBoolean(env.MATCH_SPORT_ONLY, true),
      activeOnly: parseBoolean(env.MATCH_ACTIVE_ONLY, true),
      openOnly: parseBoolean(env.MATCH_OPEN_ONLY, true),
      lookbackHours: parseNumber(env.MATCH_LOOKBACK_HOURS, 72),
      lookaheadHours: parseNumber(env.MATCH_LOOKAHEAD_HOURS, 720),
      pmLimit: parseInteger(env.MATCH_PM_LIMIT, 0),
      sxLimit: parseInteger(env.MATCH_SX_LIMIT, 0),
      sxStatusBlocklist: parseList(
        env.SX_STATUS_BLOCKLIST,
        ['closed', 'cancelled', 'canceled', 'settled', 'resolved', 'inactive', 'void']
      )
    },
    matching: {
      minScore: parseNumber(env.MATCH_MIN_SCORE, 0.78),
      reviewScore: parseNumber(env.MATCH_REVIEW_SCORE, 0.66),
      ambiguityGap: parseNumber(env.MATCH_AMBIGUITY_GAP, 0.03),
      maxTimeDeltaHours: parseNumber(env.MATCH_MAX_TIME_DELTA_HOURS, 36),
      lineTolerance: parseNumber(env.MATCH_LINE_TOLERANCE, 0.05),
      minEventScore: parseNumber(env.MATCH_MIN_EVENT_SCORE, 0.54),
      maxCandidatesPerPolymarket: parseInteger(env.MATCH_MAX_CANDIDATES_PER_PM, 12)
    }
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseInteger(value: string | undefined, fallback: number): number {
  return Math.trunc(parseNumber(value, fallback));
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function buildPostgresqlUrl(env: NodeJS.ProcessEnv): string | undefined {
  const host = nonEmpty(env.POSTGRESQL_HOST);
  const database = nonEmpty(env.POSTGRESQL_DB);
  const user = nonEmpty(env.POSTGRESQL_USER);

  if (!host || !database || !user) {
    return undefined;
  }

  const port = nonEmpty(env.POSTGRESQL_PORT) ?? '5432';
  const password = env.POSTGRESQL_PASSWORD ?? '';
  const auth = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  const sslMode = nonEmpty(env.POSTGRESQL_SSLMODE) ?? (parseBoolean(env.POSTGRESQL_SSL, false) ? 'require' : 'disable');
  const query = new URLSearchParams({ sslmode: sslMode }).toString();

  return `postgresql://${auth}@${host}:${port}/${encodeURIComponent(database)}?${query}`;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
