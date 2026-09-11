ALTER TABLE matches ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS external_id VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_source_external ON matches(source, external_id) WHERE external_id IS NOT NULL;
