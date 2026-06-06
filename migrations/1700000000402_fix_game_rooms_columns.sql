-- Migration: Fix game_rooms table columns
-- Date: 2024-01-01
-- Description: Adds missing columns to game_rooms table if they don't exist

DO $$ 
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_name = 'game_rooms'
    ) THEN
        -- Add questions_count column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'questions_count'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN questions_count INTEGER NOT NULL DEFAULT 10;
        END IF;

        -- Add total_questions column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'total_questions'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN total_questions INTEGER NOT NULL DEFAULT 10;
        END IF;
        
        -- If total_questions exists but questions_count doesn't, add questions_count with same value
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'total_questions'
        ) AND NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'questions_count'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN questions_count INTEGER NOT NULL DEFAULT 10;
            -- Copy values from total_questions
            UPDATE game_rooms SET questions_count = total_questions WHERE questions_count IS NULL;
        END IF;
        
        -- If questions_count exists but total_questions doesn't, add total_questions with same value
        IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'questions_count'
        ) AND NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'total_questions'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN total_questions INTEGER NOT NULL DEFAULT 10;
            -- Copy values from questions_count
            UPDATE game_rooms SET total_questions = questions_count WHERE total_questions IS NULL;
        END IF;

        -- Add time_per_question column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'time_per_question'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN time_per_question INTEGER DEFAULT 120;
        END IF;

        -- Add total_time column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'total_time'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN total_time INTEGER NOT NULL DEFAULT 1200;
        END IF;

        -- Add current_question column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'current_question'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN current_question INTEGER DEFAULT 0;
        END IF;

        -- Add status column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'status'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN status VARCHAR(20) DEFAULT 'waiting';
        END IF;

        -- Add started_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'started_at'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN started_at TIMESTAMP;
        END IF;

        -- Add completed_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'completed_at'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN completed_at TIMESTAMP;
        END IF;

        -- Add created_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'created_at'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;

        -- Add invitation_id column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'invitation_id'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN invitation_id INTEGER REFERENCES game_invitations(id) ON DELETE CASCADE;
        END IF;

        -- Add player1_id column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'player1_id'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN player1_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        END IF;

        -- Add player2_id column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_rooms' 
            AND column_name = 'player2_id'
        ) THEN
            ALTER TABLE game_rooms 
            ADD COLUMN player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        END IF;
    ELSE
        -- Create table if it doesn't exist
        CREATE TABLE IF NOT EXISTS game_rooms (
            id SERIAL PRIMARY KEY,
            invitation_id INTEGER NOT NULL REFERENCES game_invitations(id) ON DELETE CASCADE,
            player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            player2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(20) DEFAULT 'waiting',
            questions_count INTEGER NOT NULL DEFAULT 10,
            total_questions INTEGER NOT NULL DEFAULT 10,
            time_per_question INTEGER DEFAULT 120,
            total_time INTEGER NOT NULL DEFAULT 1200,
            current_question INTEGER DEFAULT 0,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_game_rooms_player1 ON game_rooms(player1_id);
        CREATE INDEX IF NOT EXISTS idx_game_rooms_player2 ON game_rooms(player2_id);
        CREATE INDEX IF NOT EXISTS idx_game_rooms_status ON game_rooms(status);
        CREATE INDEX IF NOT EXISTS idx_game_rooms_invitation ON game_rooms(invitation_id);
    END IF;
END $$;

