CREATE TABLE IF NOT EXISTS news_feeds (
  source TEXT PRIMARY KEY,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  checked_at TIMESTAMPTZ,
  success_at TIMESTAMPTZ,
  failed BOOLEAN NOT NULL DEFAULT false
);
