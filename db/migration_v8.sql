UPDATE matches
SET
  score_a = NULL,
  score_b = NULL
WHERE
  score_a = 0
  AND score_b = 0;
