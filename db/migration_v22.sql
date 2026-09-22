CREATE TABLE IF NOT EXISTS team_profiles (
  id BIGINT PRIMARY KEY,
  data JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS match_team_links (
  match_id INTEGER PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  team_a_id BIGINT NOT NULL,
  team_b_id BIGINT NOT NULL,
  team_a_name TEXT NOT NULL,
  team_b_name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS team_sync_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  checked_at TIMESTAMPTZ,
  success_at TIMESTAMPTZ,
  failed BOOLEAN NOT NULL DEFAULT false
);
