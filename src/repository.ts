import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { AppConfig } from './config';
import { quoteIdentPath } from './sql';
import type { CandidateMatch, MatchResult, PolymarketMarket, SxMarket } from './types';

export interface PersistedRunSummary {
  runId: number;
  foundMatchCount: number;
  newMatchCount: number;
  conflictReplacedCount: number;
}

interface PersistedMatchStats {
  foundMatchCount: number;
  newMatchCount: number;
  conflictReplacedCount: number;
}

export function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: 8
  });
}

export async function loadPolymarketMarkets(pool: Pool, config: AppConfig): Promise<PolymarketMarket[]> {
  return loadPolymarketMarketsPage(pool, config);
}

export async function loadPolymarketMarketsPage(
  pool: Pool,
  config: AppConfig,
  afterConditionId?: string,
  pageSize?: number
): Promise<PolymarketMarket[]> {
  const table = quoteIdentPath(config.polymarketTable);
  const where: string[] = [];
  const params: unknown[] = [];

  where.push('coalesce("is_sport", false) = true');
  where.push(`
    CASE
      WHEN nullif("gameStartTime", '') IS NULL THEN false
      ELSE nullif("gameStartTime", '')::timestamptz >= now() - interval '3 days'
    END
  `);
  if (afterConditionId) {
    params.push(afterConditionId);
    where.push(`"conditionId" > $${params.length}`);
  }

  const limit = pageSize ?? config.filters.pmLimit;
  if (limit && limit > 0) {
    params.push(limit);
  }

  const result = await queryReadWithRetry<PolymarketMarket>(
    pool,
    `
      SELECT
        "conditionId",
        "questionId",
        "marketSlug",
        "question",
        "description",
        "active",
        "closed",
        "archived",
        "acceptingOrders",
        "endDateIso",
        "gameStartTime",
        "is_sport" AS "isSport",
        "is_crypto" AS "isCrypto",
        "tags",
        "tokens"
      FROM ${table}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY "conditionId"
      ${limit && limit > 0 ? `LIMIT $${params.length}` : ''}
    `,
    params,
    'load Polymarket markets page'
  );

  return result.rows;
}

export async function loadSxMarkets(pool: Pool, config: AppConfig): Promise<SxMarket[]> {
  const table = quoteIdentPath(config.sxMarketsTable);
  const params: unknown[] = [];
  const where: string[] = [];

  where.push('outcome IS NULL');
  where.push('team_one_name IS NOT NULL');
  if (config.filters.sxLimit > 0) {
    params.push(config.filters.sxLimit);
  }

  const result = await queryReadWithRetry<SxMarket>(
    pool,
    `
      SELECT
        market_hash,
        status,
        outcome_one_name,
        outcome_two_name,
        outcome_void_name,
        team_one_name,
        team_two_name,
        market_type,
        game_time,
        game_time_at,
        line,
        sport_x_event_id,
        live_enabled,
        sport_label,
        sport_id,
        league_id,
        league_label,
        group1,
        group2,
        participant_one_id,
        participant_two_id,
        main_line,
        raw
      FROM ${table}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY market_hash
      ${config.filters.sxLimit > 0 ? `LIMIT $${params.length}` : ''}
    `,
    params,
    'load SX markets'
  );

  return result.rows;
}

async function queryReadWithRetry<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[],
  label: string
): Promise<QueryResult<T>> {
  const maxAttempts = 4;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await pool.query<T>(sql, params);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientPgError(error)) {
        throw error;
      }

      const delayMs = 300 * attempt;
      console.warn(
        `${label} failed with transient Postgres error (${errorMessage(error)}); retry ${attempt}/${maxAttempts - 1} in ${delayMs}ms.`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function isTransientPgError(error: unknown): boolean {
  const message = errorMessage(error);
  return /connection terminated|server closed the connection|econnreset|etimedout|epipe|timeout/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function ensureMatchSchema(pool: Pool, config: AppConfig): Promise<void> {
  const runs = quoteIdentPath(config.matchRunsTable);
  const matches = quoteIdentPath(config.matchesTable);
  const matchScoreIndex = `${config.matchesTable.replace(/\./g, '_')}_score_idx`;
  const matchRunIndex = `${config.matchesTable.replace(/\./g, '_')}_run_idx`;
  const matchPolymarketUniqueIndex = `${config.matchesTable.replace(/\./g, '_')}_polymarket_uidx`;
  const matchSxUniqueIndex = `${config.matchesTable.replace(/\./g, '_')}_sx_uidx`;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${runs} (
      run_id bigserial PRIMARY KEY,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      params jsonb NOT NULL DEFAULT '{}'::jsonb,
      polymarket_count integer NOT NULL DEFAULT 0,
      sx_count integer NOT NULL DEFAULT 0,
      candidate_count integer NOT NULL DEFAULT 0,
      match_count integer NOT NULL DEFAULT 0,
      review_count integer NOT NULL DEFAULT 0,
      found_match_count integer NOT NULL DEFAULT 0,
      new_match_count integer NOT NULL DEFAULT 0,
      updated_match_count integer NOT NULL DEFAULT 0,
      conflict_replaced_count integer NOT NULL DEFAULT 0
    );

    ALTER TABLE ${runs}
      ADD COLUMN IF NOT EXISTS found_match_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS new_match_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_match_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS conflict_replaced_count integer NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS ${matches} (
      id bigserial PRIMARY KEY,
      polymarket_condition_id varchar NOT NULL,
      sx_market_hash text NOT NULL,
      score double precision NOT NULL,
      confidence text NOT NULL,
      status text NOT NULL DEFAULT 'matched',
      reasons jsonb NOT NULL,
      component_scores jsonb NOT NULL,
      polymarket_question text,
      sx_summary jsonb NOT NULL,
      run_id bigint REFERENCES ${runs}(run_id),
      first_matched_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (polymarket_condition_id),
      UNIQUE (sx_market_hash)
    );

    CREATE INDEX IF NOT EXISTS "${matchScoreIndex}"
      ON ${matches}(score DESC);

    CREATE INDEX IF NOT EXISTS "${matchRunIndex}"
      ON ${matches}(run_id);

    CREATE UNIQUE INDEX IF NOT EXISTS "${matchPolymarketUniqueIndex}"
      ON ${matches}(polymarket_condition_id);

    CREATE UNIQUE INDEX IF NOT EXISTS "${matchSxUniqueIndex}"
      ON ${matches}(sx_market_hash);
  `);
}

export async function writeMatchResult(
  pool: Pool,
  config: AppConfig,
  result: MatchResult,
  params: Record<string, unknown>
): Promise<PersistedRunSummary> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const runId = await createRun(client, config, result, params);
    const persistedStats = await upsertMatchesWithConflictWarnings(client, config, runId, result.matches);
    await finishRun(client, config, runId, persistedStats);
    await client.query('COMMIT');
    return { runId, ...persistedStats };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function sxSummary(candidate: CandidateMatch): Record<string, unknown> {
  const sx = candidate.sx;
  return {
    marketHash: sx.market_hash,
    status: sx.status,
    sport: sx.sport_label,
    league: sx.league_label,
    teams: [sx.team_one_name, sx.team_two_name].filter(Boolean),
    outcomes: [sx.outcome_one_name, sx.outcome_two_name, sx.outcome_void_name].filter(Boolean),
    marketType: candidate.reasons.sxMarketType,
    line: sx.line,
    gameTimeAt: sx.game_time_at,
    marketTypeId: sx.market_type,
    sportXEventId: sx.sport_x_event_id,
    tokenMapping: candidate.reasons.tokenMapping
  };
}

async function createRun(
  client: PoolClient,
  config: AppConfig,
  result: MatchResult,
  params: Record<string, unknown>
): Promise<number> {
  const runs = quoteIdentPath(config.matchRunsTable);
  const response = await client.query<{ run_id: string }>(
    `
      INSERT INTO ${runs} (
        params,
        polymarket_count,
        sx_count,
        candidate_count,
        match_count,
        review_count,
        found_match_count
      )
      VALUES ($1::jsonb, $2, $3, $4, $5, $6, $7)
      RETURNING run_id
    `,
    [
      JSON.stringify(params),
      result.stats.polymarketCount,
      result.stats.sxCount,
      result.stats.candidateCount,
      result.stats.matchCount,
      result.stats.reviewCount,
      result.stats.matchCount
    ]
  );

  return Number(response.rows[0]?.run_id);
}

async function finishRun(
  client: PoolClient,
  config: AppConfig,
  runId: number,
  persistedStats: PersistedMatchStats
): Promise<void> {
  const runs = quoteIdentPath(config.matchRunsTable);
  await client.query(
    `
      UPDATE ${runs}
      SET
        finished_at = now(),
        found_match_count = $2,
        new_match_count = $3,
        updated_match_count = $4,
        conflict_replaced_count = $4
      WHERE run_id = $1
    `,
    [
      runId,
      persistedStats.foundMatchCount,
      persistedStats.newMatchCount,
      persistedStats.conflictReplacedCount
    ]
  );
}

interface ExistingMatchRow extends QueryResultRow {
  id: string;
  polymarket_condition_id: string;
  sx_market_hash: string;
}

async function upsertMatchesWithConflictWarnings(
  client: PoolClient,
  config: AppConfig,
  runId: number,
  matches: CandidateMatch[]
): Promise<PersistedMatchStats> {
  if (matches.length === 0) {
    return {
      foundMatchCount: 0,
      newMatchCount: 0,
      conflictReplacedCount: 0
    };
  }

  const table = quoteIdentPath(config.matchesTable);
  const polymarketIds = matches.map((match) => match.polymarketId);
  const sxHashes = matches.map((match) => match.sxMarketHash);

  const existing = await client.query<ExistingMatchRow>(
    `
      SELECT id::text, polymarket_condition_id, sx_market_hash
      FROM ${table}
      WHERE polymarket_condition_id = ANY($1::varchar[])
        OR sx_market_hash = ANY($2::text[])
    `,
    [polymarketIds, sxHashes]
  );

  const existingByPolymarketId = new Map(
    existing.rows.map((row) => [row.polymarket_condition_id, row])
  );
  const existingBySxHash = new Map(existing.rows.map((row) => [row.sx_market_hash, row]));
  const conflictsById = new Map<string, ExistingMatchRow>();
  let newMatchCount = 0;
  let conflictReplacedCount = 0;

  for (const match of matches) {
    const samePolymarketRow = existingByPolymarketId.get(match.polymarketId);
    const sameSxRow = existingBySxHash.get(match.sxMarketHash);
    const exactMatchExists =
      samePolymarketRow?.sx_market_hash === match.sxMarketHash ||
      sameSxRow?.polymarket_condition_id === match.polymarketId;
    const conflictingRows = [samePolymarketRow, sameSxRow].filter((row): row is ExistingMatchRow => {
      if (!row) {
        return false;
      }

      return !(row.polymarket_condition_id === match.polymarketId && row.sx_market_hash === match.sxMarketHash);
    });
    const uniqueConflictingRows = Array.from(new Map(conflictingRows.map((row) => [row.id, row])).values());

    if (uniqueConflictingRows.length === 0 && !exactMatchExists) {
      newMatchCount += 1;
    }

    for (const row of uniqueConflictingRows) {
      if (conflictsById.has(row.id)) {
        continue;
      }

      conflictsById.set(row.id, row);
      conflictReplacedCount += 1;
      console.warn(
        [
          'WARNING: replacing conflicting market match',
          `run=${runId}`,
          `existing_pm=${row.polymarket_condition_id}`,
          `existing_sx=${row.sx_market_hash}`,
          `new_pm=${match.polymarketId}`,
          `new_sx=${match.sxMarketHash}`,
          `score=${match.score.toFixed(4)}`
        ].join(' ')
      );
    }
  }

  const conflictIds = Array.from(conflictsById.keys());
  if (conflictIds.length > 0) {
    await client.query(`DELETE FROM ${table} WHERE id = ANY($1::bigint[])`, [conflictIds]);
  }

  const batchSize = 500;
  for (let start = 0; start < matches.length; start += batchSize) {
    const batch = matches.slice(start, start + batchSize);
    const values: string[] = [];
    const params: unknown[] = [];

    for (const match of batch) {
      const offset = params.length;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, 'matched', $${offset + 5}::jsonb, $${offset + 6}::jsonb, $${offset + 7}, $${offset + 8}::jsonb, $${offset + 9}, now())`
      );
      params.push(
        match.polymarketId,
        match.sxMarketHash,
        match.score,
        match.confidence,
        JSON.stringify(match.reasons),
        JSON.stringify(match.componentScores),
        match.polymarket.question,
        JSON.stringify(sxSummary(match)),
        runId
      );
    }

    await client.query(
      `
        INSERT INTO ${table} (
          polymarket_condition_id,
          sx_market_hash,
          score,
          confidence,
          status,
          reasons,
          component_scores,
          polymarket_question,
          sx_summary,
          run_id,
          updated_at
        )
        VALUES ${values.join(', ')}
        ON CONFLICT (polymarket_condition_id) DO UPDATE SET
          sx_market_hash = EXCLUDED.sx_market_hash,
          score = EXCLUDED.score,
          confidence = EXCLUDED.confidence,
          status = EXCLUDED.status,
          reasons = EXCLUDED.reasons,
          component_scores = EXCLUDED.component_scores,
          polymarket_question = EXCLUDED.polymarket_question,
          sx_summary = EXCLUDED.sx_summary,
          run_id = EXCLUDED.run_id,
          updated_at = now()
      `,
      params
    );
  }

  return {
    foundMatchCount: matches.length,
    newMatchCount,
    conflictReplacedCount
  };
}
