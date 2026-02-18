-- ============================================================
-- TUNES — Database Control Migration
-- Enhances: get_database_stats() RPC with size estimation and usage percentages
-- Run in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- ENHANCE: get_database_stats() — add database size and usage percentages
-- ============================================================

-- Drop old version first (return type changed)
DROP FUNCTION IF EXISTS get_database_stats();

CREATE OR REPLACE FUNCTION get_database_stats()
RETURNS JSON AS $$
DECLARE
    result JSON;
    db_size_bytes BIGINT;
    db_size_mb NUMERIC;
    listening_events_count BIGINT;
    listening_events_percent NUMERIC;
    -- Supabase Free tier limits
    supabase_db_limit_mb NUMERIC := 500;
    supabase_row_limit BIGINT := 1000000; -- Safe limit for listening_events (1M rows)
BEGIN
    -- Get database size (estimate from table sizes)
    -- Note: pg_database_size() requires superuser, so we estimate from table sizes
    SELECT COALESCE(
        (SELECT sum(pg_total_relation_size(oid)) 
         FROM pg_class 
         WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
         AND relkind = 'r'),
        0
    ) INTO db_size_bytes;
    
    db_size_mb := ROUND((db_size_bytes::NUMERIC / 1024 / 1024)::NUMERIC, 2);
    
    -- Get listening_events count
    SELECT count(*) INTO listening_events_count FROM listening_events;
    
    -- Calculate percentages
    listening_events_percent := LEAST(ROUND((listening_events_count::NUMERIC / supabase_row_limit * 100)::NUMERIC, 1), 100);
    
    SELECT json_build_object(
        -- Row counts (existing)
        'user_profiles',     (SELECT count(*) FROM user_profiles),
        'listening_events',  listening_events_count,
        'taste_groups',      (SELECT count(*) FROM taste_groups),
        'taste_group_members', (SELECT count(*) FROM taste_group_members),
        'followed_artists',  (SELECT count(*) FROM followed_artists),
        'telegram_archives', (SELECT count(*) FROM telegram_archive_index),
        'total_auth_users',  (SELECT count(*) FROM auth.users),
        
        -- Time-based counts (existing)
        'listening_events_last_24h', (
            SELECT count(*) FROM listening_events
            WHERE listened_at >= now() - interval '24 hours'
        ),
        'listening_events_last_7d', (
            SELECT count(*) FROM listening_events
            WHERE listened_at >= now() - interval '7 days'
        ),
        
        -- Date ranges (existing)
        'oldest_event', (
            SELECT min(listened_at) FROM listening_events
        ),
        'newest_event', (
            SELECT max(listened_at) FROM listening_events
        ),
        
        -- Archive info (existing)
        'last_archive_at', (
            SELECT max(created_at) FROM telegram_archive_index
            WHERE status = 'completed'
        ),
        'total_archived_rows', (
            SELECT COALESCE(sum(row_count), 0) FROM telegram_archive_index
            WHERE status = 'completed'
        ),
        
        -- NEW: Database size and usage
        'database_size_mb', db_size_mb,
        'database_size_percent', LEAST(ROUND((db_size_mb / supabase_db_limit_mb * 100)::NUMERIC, 1), 100),
        'listening_events_percent', listening_events_percent,
        
        -- Limits (for reference)
        'limits', json_build_object(
            'supabase_db_mb', supabase_db_limit_mb,
            'supabase_row_limit', supabase_row_limit,
            'warning_threshold', 70,
            'critical_threshold', 90
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DONE! Enhanced: get_database_stats()
--        Now returns: database_size_mb, database_size_percent, 
--                     listening_events_percent, limits
-- ============================================================

