-- ============================================================
-- TUNES v1.0.0 — Admin Updates & Announcements
-- Run this migration AFTER supabase-migration-v2.sql and
-- supabase-telegram-archive-migration.sql
-- ============================================================

-- ─── Updates table ──────────────────────────────────────────
-- Stores app update notifications posted by admin.
-- target_versions: array of version strings this update targets.
-- If empty/NULL, the update is shown to ALL versions.
CREATE TABLE IF NOT EXISTS admin_updates (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title           TEXT NOT NULL,
    message         TEXT,
    link            TEXT,
    target_versions TEXT[] DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE admin_updates ENABLE ROW LEVEL SECURITY;

-- Only service-role can insert/update/delete (through worker)
CREATE POLICY "Service role full access on admin_updates"
    ON admin_updates FOR ALL
    USING (true)
    WITH CHECK (true);

-- ─── Announcements / Ads table ──────────────────────────────
-- Stores banner ads/announcements with scheduling.
CREATE TABLE IF NOT EXISTS admin_announcements (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title           TEXT NOT NULL,
    link            TEXT,
    image_url       TEXT,
    starts_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at         TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE admin_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on admin_announcements"
    ON admin_announcements FOR ALL
    USING (true)
    WITH CHECK (true);

-- ─── RPC: Get active updates for a specific app version ─────
CREATE OR REPLACE FUNCTION get_active_updates(app_version TEXT DEFAULT NULL)
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    message TEXT,
    link TEXT,
    target_versions TEXT[],
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id, u.title, u.message, u.link, u.target_versions, u.created_at
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

-- ─── RPC: Get currently active announcements ────────────────
CREATE OR REPLACE FUNCTION get_active_announcements()
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    link TEXT,
    image_url TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id, a.title, a.link, a.image_url, a.starts_at, a.ends_at, a.created_at
    FROM admin_announcements a
    WHERE a.is_active = true
      AND a.starts_at <= now()
      AND (a.ends_at IS NULL OR a.ends_at > now())
    ORDER BY a.created_at DESC
    LIMIT 3;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RPC: List all updates (admin) ──────────────────────────
CREATE OR REPLACE FUNCTION admin_list_updates()
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    message TEXT,
    link TEXT,
    target_versions TEXT[],
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
    SELECT u.id, u.title, u.message, u.link, u.target_versions, u.is_active, u.created_at
    FROM admin_updates u
    ORDER BY u.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- ─── RPC: List all announcements (admin) ────────────────────
CREATE OR REPLACE FUNCTION admin_list_announcements()
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    link TEXT,
    image_url TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
    SELECT a.id, a.title, a.link, a.image_url, a.starts_at, a.ends_at, a.is_active, a.created_at
    FROM admin_announcements a
    ORDER BY a.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;


