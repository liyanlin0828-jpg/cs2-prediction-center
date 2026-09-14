CREATE TABLE IF NOT EXISTS sync_status (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'never',
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

INSERT INTO sync_status (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
