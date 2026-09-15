UPDATE matches
SET
  status = 'canceled',
  winner = NULL,
  score_a = NULL,
  score_b = NULL
WHERE id IN (8869,3255,957,9,24,32,39,20,13,10959)
  AND source = 'pandascore'
  AND status = 'settled';
