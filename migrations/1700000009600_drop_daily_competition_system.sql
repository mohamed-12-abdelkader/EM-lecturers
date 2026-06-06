-- Remove Daily Competition System: drop tables and triggers

DROP TRIGGER IF EXISTS trigger_daily_competitions_updated_at ON daily_competitions;
DROP TRIGGER IF EXISTS trigger_monthly_scores_updated_at ON monthly_scores;

DROP TABLE IF EXISTS daily_competition_answers;
DROP TABLE IF EXISTS daily_competition_attempts;
DROP TABLE IF EXISTS daily_competition_questions;
DROP TABLE IF EXISTS monthly_scores;
DROP TABLE IF EXISTS daily_competitions;
