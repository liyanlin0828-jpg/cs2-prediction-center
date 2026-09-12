-- V6: store PandaScore number_of_games for BO1 / BO3 / BO5 display

ALTER TABLE matches
ADD COLUMN IF NOT EXISTS number_of_games INTEGER;
