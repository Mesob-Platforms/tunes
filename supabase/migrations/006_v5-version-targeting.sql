-- ============================================================
-- TUNES v1.1.0 — Version-Targeted Update Messages
-- Run AFTER supabase-migration-v4-messaging.sql
-- ============================================================

-- Add target_versions column back to admin_updates
ALTER TABLE admin_updates ADD COLUMN IF NOT EXISTS target_versions TEXT[] DEFAULT '{}';

-- ─── UPDATE RPC: get_active_updates ────────────────────────
-- Now filters by app_version again. If target_versions is empty,
-- the update is shown to ALL versions (backward compatible).
DROP FUNCTION IF EXISTS get_active_updates(TEXT);
CREATE OR REPLACE FUNCTION get_active_updates(app_version TEXT DEFAULT NULL)
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    message TEXT,
    link TEXT,
    category TEXT,
    target_versions TEXT[],
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id, u.title, u.message, u.link, u.category, u.target_versions, u.created_at
    FROM admin_updates u
    WHERE u.is_active = true
      AND (
          app_version IS NULL
          OR u.target_versions = '{}'
          OR u.target_versions IS NULL
          OR app_version = ANY(u.target_versions)
      )
    ORDER BY u.created_at DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── UPDATE RPC: admin_list_updates ────────────────────────
-- Now returns target_versions so admin panel can display them
DROP FUNCTION IF EXISTS admin_list_updates();
CREATE OR REPLACE FUNCTION admin_list_updates()
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    message TEXT,
    link TEXT,
    category TEXT,
    target_versions TEXT[],
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
    SELECT u.id, u.title, u.message, u.link, u.category, u.target_versions, u.is_active, u.created_at
    FROM admin_updates u
    ORDER BY u.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;
