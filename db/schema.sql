CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(24) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'user',
  points INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  event_name VARCHAR(120) NOT NULL,
  team_a VARCHAR(80) NOT NULL,
  team_b VARCHAR(80) NOT NULL,
  odds_a NUMERIC(6,2) NOT NULL DEFAULT 1.80,
  odds_b NUMERIC(6,2) NOT NULL DEFAULT 1.80,
  starts_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  winner VARCHAR(80),
  source VARCHAR(20) NOT NULL DEFAULT 'manual',
  external_id VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  predicted_team VARCHAR(80) NOT NULL,
  result VARCHAR(20),
  points_delta INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_source_external ON matches(source, external_id) WHERE external_id IS NOT NULL;
