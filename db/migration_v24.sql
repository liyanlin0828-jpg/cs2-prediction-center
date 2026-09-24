CREATE TABLE IF NOT EXISTS team_match_cache (
  team_id BIGINT PRIMARY KEY,
  data JSONB,
  checked_at TIMESTAMPTZ,
  success_at TIMESTAMPTZ,
  failed BOOLEAN NOT NULL DEFAULT false
);
