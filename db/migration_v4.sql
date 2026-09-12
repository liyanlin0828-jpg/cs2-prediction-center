-- V4: one-time cleanup of old demo data

CREATE TABLE IF NOT EXISTS app_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app_migrations
    WHERE name = 'cleanup_demo_matches_v1'
  ) THEN

    -- Delete only the four old manual demo matches.
    -- Related predictions are removed automatically by ON DELETE CASCADE.
    DELETE FROM matches
    WHERE source = 'manual'
      AND (
        (team_a = 'NaVi' AND team_b = 'FaZe')
        OR (team_a = 'Spirit' AND team_b = 'G2')
        OR (team_a = 'Vitality' AND team_b = 'MOUZ')
        OR (team_a = 'Cloud9' AND team_b = 'FURIA')
      );

    -- Reset only the admin test account.
    UPDATE users
    SET points = 1000
    WHERE username = 'admin';

    INSERT INTO app_migrations(name)
    VALUES ('cleanup_demo_matches_v1');

  END IF;
END $$;
