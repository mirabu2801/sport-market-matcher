# Markets Matcher

TypeScript matcher for one-to-one Polymarket <-> SX Bet markets stored in PostgreSQL.

The matcher is deterministic and canonical-first:

1. Loads Polymarket rows where `is_sport = true` and `"gameStartTime" >= now() - interval '3 days'`, and SX rows where `outcome IS NULL` and `team_one_name IS NOT NULL`.
2. Canonicalizes SX events using `sport_x_event_id`, home/away teams, league, start time, market type, side, and line.
3. Infers the matching Polymarket event/bet intent against each SX event.
4. Scores canonical pairs first, then keeps fuzzy text matching as a fallback for incomplete records.
5. Selects a one-to-one set of matches.
6. Writes close or low-confidence alternatives to the generated report for review.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` so either `DATABASE_URL` or `POSTGRESQL_HOST`/`POSTGRESQL_PORT`/`POSTGRESQL_USER`/`POSTGRESQL_PASSWORD`/`POSTGRESQL_DB` point at your database. `POSTGRESQL_SSLMODE` is supported too, for example `disable` or `require`; if `DATABASE_URL` is blank, the `POSTGRESQL_*` fields are used. The source table defaults are `markets_info` and `sx_markets`.

Create matcher tables:

```bash
npm run migrate
```

Run a dry run:

```bash
npm run match
```

Persist selected matches:

```bash
npm run match -- --write
```

Run continuously every 10 minutes from TypeScript:

```bash
npm run match:loop
# or
npm run match -- --write --interval-minutes 10
```

Reports:

```bash
# Markdown summary is written by default.
npm run match -- --json-report
npm run match -- --csv-report
npm run match -- --no-report
```

Full JSON and CSV reports are disabled by default.

Useful debug overrides:

```bash
npm run match -- --min-score 0.82 --review-score 0.68 --max-time-delta-hours 24
npm run match -- --pm-limit 2000 --sx-limit 2000
```

By default, `MATCH_PM_LIMIT=0` and `MATCH_SX_LIMIT=0` mean no row limit.

## Docker

Build the image:

```bash
docker build -t markets-matcher .
```

Run migrations:

```bash
docker run --rm --env-file .env markets-matcher node dist/src/cli.js --migrate-only
```

Run a dry run or persist matches:

```bash
docker run --rm --env-file .env markets-matcher node dist/src/cli.js
docker run --rm --env-file .env markets-matcher node dist/src/cli.js --write
```

Run the container as the 10-minute write loop. This is also the image default command:

```bash
docker run --env-file .env markets-matcher
docker run --env-file .env markets-matcher node dist/src/cli.js --write --interval-minutes 10
```

## Output Tables

`market_matches` contains only selected one-to-one matches. It has unique constraints on both `polymarket_condition_id` and `sx_market_hash`.

Persisted writes are incremental: existing identical PM/SX pairs are updated, unrelated old matches are kept, and only conflicting rows are replaced. A conflict means a new run selected a different SX market for an already stored Polymarket condition, or a different Polymarket condition for an already stored SX hash. Each replacement is printed as a `WARNING`.

Candidates and review alternatives are kept in generated report files, not in PostgreSQL. Markdown summary reports are enabled by default; full JSON reports and CSV reports are opt-in with `--json-report` and `--csv-report`.

`market_match_runs` stores system metadata, counts, and parameters for each persisted run. `match_count` / `found_match_count` are the selected matches found in that run, `new_match_count` is the number of newly inserted pairs, and `updated_match_count` is the number of conflict replacements printed as `WARNING`s. `conflict_replaced_count` stores the same warning count under a more explicit name. `market_matches.run_id` records the last run that inserted or updated that match.

## Notes

- Ambiguous pairs are not auto-matched by default. Lower `MATCH_AMBIGUITY_GAP` if you want more aggressive matching.
- For spread markets, canonical matching compares absolute line values because books can represent the same binary market from opposite sides.
- SX market types `52/226`, `3/342`, and `2/28` are treated as `12`, `spread`, and `total` respectively. Type `1` is handled as either soccer-style `1x2` binary or two-outcome `12` depending on outcomes.
- `teamAliases.ts` contains the built-in canonical team map. Add aliases there when you see recurring review candidates caused by platform-specific team names.
- The Polymarket entity uses camelCase columns such as `"conditionId"` and explicit snake-case fields such as `"is_sport"`. If your TypeORM naming strategy changed those names, adjust the select list in `src/repository.ts`.
