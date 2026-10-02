BEGIN;
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_user_id_match_id_key;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS entry_phase TEXT NOT NULL DEFAULT 'prematch';
CREATE UNIQUE INDEX IF NOT EXISTS predictions_request_unique ON predictions(user_id,request_id) WHERE request_id IS NOT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS live_market JSONB;
COMMIT;
