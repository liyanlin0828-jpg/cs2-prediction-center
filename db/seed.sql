INSERT INTO matches (event_name, team_a, team_b, odds_a, odds_b, starts_at)
SELECT 'IEM Cologne', 'NaVi', 'FaZe', 1.72, 2.10, NOW() + INTERVAL '1 day'
WHERE NOT EXISTS (SELECT 1 FROM matches);
INSERT INTO matches (event_name, team_a, team_b, odds_a, odds_b, starts_at)
SELECT 'BLAST 秋季赛', 'Spirit', 'G2', 1.65, 2.20, NOW() + INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM matches WHERE team_a='Spirit' AND team_b='G2');
INSERT INTO matches (event_name, team_a, team_b, odds_a, odds_b, starts_at)
SELECT 'ESL 挑战者', 'Vitality', 'MOUZ', 1.80, 2.00, NOW() + INTERVAL '3 days'
WHERE NOT EXISTS (SELECT 1 FROM matches WHERE team_a='Vitality' AND team_b='MOUZ');
INSERT INTO matches (event_name, team_a, team_b, odds_a, odds_b, starts_at)
SELECT 'Major 预选赛', 'Cloud9', 'FURIA', 1.95, 1.85, NOW() + INTERVAL '4 days'
WHERE NOT EXISTS (SELECT 1 FROM matches WHERE team_a='Cloud9' AND team_b='FURIA');
