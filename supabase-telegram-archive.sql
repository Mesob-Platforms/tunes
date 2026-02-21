-- ============================================================
-- TUNES — Telegram Archive Migration
-- Adds: telegram_archive_index table, get_database_stats() RPC
-- Run in Supabase SQL Editor after supabase-migration-v2.sql
-- ============================================================

-- ============================================================
-- 1. TELEGRAM ARCHIVE INDEX — tracks every archive sent to TG
-- ============================================================
CREATE TABLE IF NOT EXISTS telegram_archive_index (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    archive_type  TEXT NOT NULL DEFAULT 'listening_events',   -- what was archived
    row_count     INT NOT NULL DEFAULT 0,                     -- rows in this archive
    file_size_kb  INT NOT NULL DEFAULT 0,                     -- approximate file size
    date_from     TIMESTAMPTZ,                                -- earliest record in batch
    date_to       TIMESTAMPTZ,                                -- latest record in batch
    telegram_file_id  TEXT,                                   -- Telegram file_id for retrieval
    telegram_msg_id   BIGINT,                                 -- Telegram message_id
    status        TEXT NOT NULL DEFAULT 'completed',          -- completed | failed | pending
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archive_created ON telegram_archive_index(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_type    ON telegram_archive_index(archive_type);

-- RLS: only service-role (admin) can read/write
ALTER TABLE telegram_archive_index ENABLE ROW LEVEL SECURITY;
-- No public policies → only service-role key can access

-- ============================================================
-- 2. GET DATABASE STATS — returns row counts for all app tables
-- ============================================================
CREATE OR REPLACE FUNCTION get_database_stats()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'user_profiles',     (SELECT count(*) FROM user_profiles),
        'listening_events',  (SELECT count(*) FROM listening_events),
        'taste_groups',      (SELECT count(*) FROM taste_groups),
        'taste_group_members', (SELECT count(*) FROM taste_group_members),
        'followed_artists',  (SELECT count(*) FROM followed_artists),
        'telegram_archives', (SELECT count(*) FROM telegram_archive_index),
        'total_auth_users',  (SELECT count(*) FROM auth.users),
        'listening_events_last_24h', (
            SELECT count(*) FROM listening_events
            WHERE listened_at >= now() - interval '24 hours'
        ),
        'listening_events_last_7d', (
            SELECT count(*) FROM listening_events
            WHERE listened_at >= now() - interval '7 days'
        ),
        'oldest_event', (
            SELECT min(listened_at) FROM listening_events
        ),
        'newest_event', (
            SELECT max(listened_at) FROM listening_events
        ),
        'last_archive_at', (
            SELECT max(created_at) FROM telegram_archive_index
            WHERE status = 'completed'
        ),
        'total_archived_rows', (
            SELECT COALESCE(sum(row_count), 0) FROM telegram_archive_index
            WHERE status = 'completed'
        )
    ) INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DONE! Tables: telegram_archive_index
--        RPCs:  get_database_stats()
-- ============================================================










