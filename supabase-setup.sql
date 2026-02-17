-- ============================================================
-- MONOCHROME SUPABASE SETUP
-- Run this ENTIRE script in your Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query → Paste → Run)
-- ============================================================

-- ============================================================
-- 1. USER DATA TABLE
-- Stores all user-specific data: library, history, playlists, folders
-- Each user gets ONE row, with JSONB columns for each data type
-- ============================================================

CREATE TABLE IF NOT EXISTS user_data (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    library     JSONB NOT NULL DEFAULT '{}'::jsonb,
    history     JSONB NOT NULL DEFAULT '[]'::jsonb,
    user_playlists JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_folders   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_data_user_id_unique UNIQUE (user_id)
);

-- Index for fast lookups by user_id
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id);

-- Auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_data_updated_at ON user_data;
CREATE TRIGGER user_data_updated_at
    BEFORE UPDATE ON user_data
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 2. PUBLIC PLAYLISTS TABLE
-- Stores playlists that users choose to share publicly
-- ============================================================

CREATE TABLE IF NOT EXISTS public_playlists (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid        TEXT NOT NULL UNIQUE,
    uid         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       TEXT,
    image       TEXT,
    cover       TEXT,
    tracks      JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_public   BOOLEAN NOT NULL DEFAULT true,
    data        JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by uuid
CREATE INDEX IF NOT EXISTS idx_public_playlists_uuid ON public_playlists(uuid);
-- Index for fast lookups by owner
CREATE INDEX IF NOT EXISTS idx_public_playlists_uid ON public_playlists(uid);

-- Auto-update the updated_at timestamp
DROP TRIGGER IF EXISTS public_playlists_updated_at ON public_playlists;
CREATE TRIGGER public_playlists_updated_at
    BEFORE UPDATE ON public_playlists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- This is CRITICAL — without this, the anon key can't access data
-- ============================================================

-- Enable RLS on both tables
ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_playlists ENABLE ROW LEVEL SECURITY;

-- ----- user_data policies -----

-- Users can read their own data
CREATE POLICY "Users can read own data"
    ON user_data
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own data
CREATE POLICY "Users can insert own data"
    ON user_data
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update their own data
CREATE POLICY "Users can update own data"
    ON user_data
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete their own data
CREATE POLICY "Users can delete own data"
    ON user_data
    FOR DELETE
    USING (auth.uid() = user_id);

-- ----- public_playlists policies -----

-- ANYONE (even anonymous/logged-out) can read public playlists
CREATE POLICY "Anyone can read public playlists"
    ON public_playlists
    FOR SELECT
    USING (true);

-- Only the owner can insert their playlists
CREATE POLICY "Owners can insert playlists"
    ON public_playlists
    FOR INSERT
    WITH CHECK (auth.uid() = uid);

-- Only the owner can update their playlists
CREATE POLICY "Owners can update playlists"
    ON public_playlists
    FOR UPDATE
    USING (auth.uid() = uid)
    WITH CHECK (auth.uid() = uid);

-- Only the owner can delete their playlists
CREATE POLICY "Owners can delete playlists"
    ON public_playlists
    FOR DELETE
    USING (auth.uid() = uid);


-- ============================================================
-- DONE! You can verify by checking:
--   Table Editor → user_data (should exist with columns)
--   Table Editor → public_playlists (should exist with columns)
--   Authentication → Policies (should show all policies above)
-- ============================================================

