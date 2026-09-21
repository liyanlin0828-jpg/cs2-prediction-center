CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('match','user')),
  target_id BIGINT NOT NULL,
  before_state JSONB NOT NULL,
  after_state JSONB NOT NULL
);
