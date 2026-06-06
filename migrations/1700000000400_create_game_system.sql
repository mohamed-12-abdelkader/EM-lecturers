-- Migration: Create Game System Tables
-- Date: 2024-01-01
-- Description: Creates all necessary tables for the interactive game system

-- 1. Game Invitations Table
CREATE TABLE IF NOT EXISTS game_invitations (
    id SERIAL PRIMARY KEY,
    inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_ids TEXT[] NOT NULL,
    questions_count INTEGER NOT NULL DEFAULT 10,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
    accepted_at TIMESTAMP,
    rejected_at TIMESTAMP
);

-- Indexes for game invitations
CREATE INDEX IF NOT EXISTS idx_game_invitations_inviter ON game_invitations(inviter_id);
CREATE INDEX IF NOT EXISTS idx_game_invitations_invitee ON game_invitations(invitee_id);
CREATE INDEX IF NOT EXISTS idx_game_invitations_status ON game_invitations(status);
CREATE INDEX IF NOT EXISTS idx_game_invitations_expires_at ON game_invitations(expires_at);

-- 2. Game Rooms Table
CREATE TABLE IF NOT EXISTS game_rooms (
    id SERIAL PRIMARY KEY,
    invitation_id INTEGER NOT NULL REFERENCES game_invitations(id) ON DELETE CASCADE,
    player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'waiting',
    questions_count INTEGER NOT NULL,
    time_per_question INTEGER DEFAULT 120,
    total_time INTEGER NOT NULL,
    current_question INTEGER DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for game rooms
CREATE INDEX IF NOT EXISTS idx_game_rooms_player1 ON game_rooms(player1_id);
CREATE INDEX IF NOT EXISTS idx_game_rooms_player2 ON game_rooms(player2_id);
CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON game_rooms(status);
CREATE INDEX IF NOT EXISTS idx_game_rooms_invitation ON game_rooms(invitation_id);

-- 3. Game Questions Table
CREATE TABLE IF NOT EXISTS game_questions (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL,
    question_order INTEGER NOT NULL,
    question_text TEXT,
    question_image TEXT,
    options JSONB,
    correct_answer TEXT,
    points INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for game questions
CREATE INDEX IF NOT EXISTS idx_game_questions_room ON game_questions(room_id);
CREATE INDEX IF NOT EXISTS idx_game_questions_order ON game_questions(question_order);
CREATE INDEX IF NOT EXISTS idx_game_questions_question ON game_questions(question_id);

-- 4. Game Answers Table
CREATE TABLE IF NOT EXISTS game_answers (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES game_questions(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    answer TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    time_taken INTEGER DEFAULT 0
);

-- Indexes for game answers
CREATE INDEX IF NOT EXISTS idx_game_answers_room ON game_answers(room_id);
CREATE INDEX IF NOT EXISTS idx_game_answers_player ON game_answers(player_id);
CREATE INDEX IF NOT EXISTS idx_game_answers_question ON game_answers(question_id);

-- 5. Game Results Table
CREATE TABLE IF NOT EXISTS game_results (
    id SERIAL PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
    player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player1_score INTEGER DEFAULT 0,
    player2_score INTEGER DEFAULT 0,
    player1_correct_answers INTEGER DEFAULT 0,
    player2_correct_answers INTEGER DEFAULT 0,
    player1_total_time INTEGER DEFAULT 0,
    player2_total_time INTEGER DEFAULT 0,
    winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_tie BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for game results
CREATE INDEX IF NOT EXISTS idx_game_results_room ON game_results(room_id);
CREATE INDEX IF NOT EXISTS idx_game_results_player1 ON game_results(player1_id);
CREATE INDEX IF NOT EXISTS idx_game_results_player2 ON game_results(player2_id);
CREATE INDEX IF NOT EXISTS idx_game_results_winner ON game_results(winner_id);

-- 6. Player Game Stats Table
CREATE TABLE IF NOT EXISTS player_game_stats (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_games INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    games_lost INTEGER DEFAULT 0,
    games_tied INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    total_correct_answers INTEGER DEFAULT 0,
    total_questions_answered INTEGER DEFAULT 0,
    average_time_per_question DECIMAL(5,2) DEFAULT 0,
    win_rate DECIMAL(5,2) DEFAULT 0,
    last_played_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(player_id)
);

-- Indexes for player stats
CREATE INDEX IF NOT EXISTS idx_player_stats_player ON player_game_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_win_rate ON player_game_stats(win_rate);

-- Add updated_at trigger for player_game_stats
CREATE OR REPLACE FUNCTION trg_set_player_stats_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_player_stats_updated_at
  BEFORE UPDATE ON player_game_stats
  FOR EACH ROW EXECUTE FUNCTION trg_set_player_stats_updated_at();
