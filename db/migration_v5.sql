-- V5: remove two remaining admin test predictions only

CREATE TABLE IF NOT EXISTS app_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app_migrations
    WHERE name = 'cleanup_admin_test_predictions_v1'
  ) THEN

    DELETE FROM predictions
    WHERE user_id = (
      SELECT id
      FROM users
      WHERE username = 'admin'
      LIMIT 1
    )
    AND match_id IN (
      SELECT id
      FROM matches
      WHERE
        (team_a = 'Legacy' AND team_b = 'MIBR')
        OR
        (team_a = 'NRG' AND team_b = 'Liquid')
    );

    INSERT INTO app_migrations(name)
    VALUES ('cleanup_admin_test_predictions_v1');

  END IF;
END $$;
