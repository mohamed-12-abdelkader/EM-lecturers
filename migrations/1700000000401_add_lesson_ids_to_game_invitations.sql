-- Migration: Add missing columns to game_invitations table
-- Date: 2024-01-01
-- Description: Adds all required columns if they don't exist (fix for missing columns)

DO $$ 
BEGIN
    -- Check if table exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_name = 'game_invitations'
    ) THEN
        -- Add lesson_ids column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_invitations' 
            AND column_name = 'lesson_ids'
        ) THEN
            ALTER TABLE game_invitations 
            ADD COLUMN lesson_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
        END IF;

        -- Add questions_count column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_invitations' 
            AND column_name = 'questions_count'
        ) THEN
            ALTER TABLE game_invitations 
            ADD COLUMN questions_count INTEGER NOT NULL DEFAULT 10;
        END IF;

        -- Add status column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_invitations' 
            AND column_name = 'status'
        ) THEN
            ALTER TABLE game_invitations 
            ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
        END IF;

        -- Add expires_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_invitations' 
            AND column_name = 'expires_at'
        ) THEN
            ALTER TABLE game_invitations 
            ADD COLUMN expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour');
        END IF;

        -- Add accepted_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_invitations' 
            AND column_name = 'accepted_at'
        ) THEN
            ALTER TABLE game_invitations 
            ADD COLUMN accepted_at TIMESTAMP;
        END IF;

        -- Add rejected_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_invitations' 
            AND column_name = 'rejected_at'
        ) THEN
            ALTER TABLE game_invitations 
            ADD COLUMN rejected_at TIMESTAMP;
        END IF;

        -- Add created_at column if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name = 'game_invitations' 
            AND column_name = 'created_at'
        ) THEN
            ALTER TABLE game_invitations 
            ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
    END IF;
END $$;

