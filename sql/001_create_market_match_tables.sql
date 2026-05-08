CREATE TABLE IF NOT EXISTS market_match_runs (
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

ALTER TABLE market_match_runs
  ADD COLUMN IF NOT EXISTS found_match_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_match_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_match_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conflict_replaced_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS market_matches (
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
  run_id bigint REFERENCES market_match_runs(run_id),
  first_matched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (polymarket_condition_id),
  UNIQUE (sx_market_hash)
);

CREATE INDEX IF NOT EXISTS market_matches_score_idx
  ON market_matches(score DESC);

CREATE INDEX IF NOT EXISTS market_matches_run_idx
  ON market_matches(run_id);

CREATE UNIQUE INDEX IF NOT EXISTS market_matches_polymarket_uidx
  ON market_matches(polymarket_condition_id);

CREATE UNIQUE INDEX IF NOT EXISTS market_matches_sx_uidx
  ON market_matches(sx_market_hash);
