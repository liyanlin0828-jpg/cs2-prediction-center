CREATE TABLE IF NOT EXISTS sync_history (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  status VARCHAR(20) NOT NULL,
  trigger_source VARCHAR(30),

  upcoming_fetched INTEGER NOT NULL DEFAULT 0,
  upcoming_inserted INTEGER NOT NULL DEFAULT 0,
  upcoming_updated INTEGER NOT NULL DEFAULT 0,
  upcoming_skipped INTEGER NOT NULL DEFAULT 0,

  results_fetched INTEGER NOT NULL DEFAULT 0,
  results_checked INTEGER NOT NULL DEFAULT 0,
  results_settled INTEGER NOT NULL DEFAULT 0,
  results_skipped INTEGER NOT NULL DEFAULT 0,

  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_history_created_at
ON sync_history(created_at DESC);
