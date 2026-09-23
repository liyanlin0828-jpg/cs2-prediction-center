CREATE TABLE IF NOT EXISTS team_ranking_cache (
  id INTEGER PRIMARY KEY CHECK(id=1),
  data JSONB,
  checked_at TIMESTAMPTZ,
  failed BOOLEAN NOT NULL DEFAULT false
);
