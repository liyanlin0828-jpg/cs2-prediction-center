BEGIN;
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS map_selection_odds JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS map_selection_closes_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS map_selection_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_maps JSONB,
  ADD COLUMN IF NOT EXISTS selected_maps_source TEXT;
CREATE TABLE IF NOT EXISTS map_selection_predictions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  predicted_map VARCHAR(40) NOT NULL,
  stake_points INTEGER NOT NULL CHECK (stake_points BETWEEN 1 AND 1000000),
  odds_at_prediction NUMERIC(10,4) NOT NULL CHECK (odds_at_prediction BETWEEN 1 AND 100),
  result VARCHAR(20) CHECK (result IN ('win','loss','refunded')),
  points_delta INTEGER NOT NULL DEFAULT 0,
  payout_points INTEGER NOT NULL DEFAULT 0 CHECK (payout_points>=0),
  refund_points INTEGER NOT NULL DEFAULT 0 CHECK (refund_points>=0),
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id,match_id)
);
CREATE INDEX IF NOT EXISTS map_selection_pending_match ON map_selection_predictions(match_id) WHERE result IS NULL;
COMMIT;
