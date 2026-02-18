-- ============================================================
-- TUNES v1.1.0 — Messaging Overhaul (Updates + Announcements)
-- Run AFTER supabase-migration-v3-admin.sql
-- ============================================================

-- ─── ALTER admin_updates ───────────────────────────────────
-- Remove version targeting, add category
ALTER TABLE admin_updates DROP COLUMN IF EXISTS target_versions;
ALTER TABLE admin_updates ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'feature';
-- category values: feature, bugfix, improvement, security

-- ─── ALTER admin_announcements ─────────────────────────────
-- Add new columns for the enriched announcement system
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'announcement';
-- type values: ad, announcement, tip
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS tag TEXT DEFAULT 'NEW';
-- tag preset: AD, NEW, PROMO, TIP, ALERT, UPDATE, HOT
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS gradient_start TEXT DEFAULT '#a855f7';
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS gradient_end TEXT DEFAULT '#ec4899';
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS cta_buttons JSONB DEFAULT '[]'::jsonb;
-- cta_buttons: array of {text, url}, max 3
ALTER TABLE admin_announcements ADD COLUMN IF NOT EXISTS frequency TEXT DEFAULT 'always';
-- frequency values: always, once_per_day, once_per_session, once_ever

-- Drop starts_at (announcements now start immediately)
ALTER TABLE admin_announcements DROP COLUMN IF EXISTS starts_at;

-- ─── NEW: admin_tracking table ─────────────────────────────
-- Tracks unique impressions and clicks for updates & announcements
CREATE TABLE IF NOT EXISTS admin_tracking (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_type       TEXT NOT NULL,              -- 'update' or 'announcement'
    item_id         BIGINT NOT NULL,
    user_id         UUID NOT NULL,
    event_type      TEXT NOT NULL,              -- 'impression' or 'click'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_type, item_id, user_id, event_type)
);

ALTER TABLE admin_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on admin_tracking"
    ON admin_tracking FOR ALL
    USING (true)
    WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_admin_tracking_item
    ON admin_tracking (item_type, item_id, event_type);

-- ─── UPDATE RPC: get_active_updates ────────────────────────
-- Drop old version first (return type changed: target_versions → category)
DROP FUNCTION IF EXISTS get_active_updates(TEXT);
-- No longer filters by version; returns category instead
CREATE OR REPLACE FUNCTION get_active_updates(app_version TEXT DEFAULT NULL)
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    message TEXT,
    link TEXT,
    category TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id, u.title, u.message, u.link, u.category, u.created_at
    FROM admin_updates u
    WHERE u.is_active = true
    ORDER BY u.created_at DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── UPDATE RPC: get_active_announcements ──────────────────
-- Drop old version first (return type changed: added body, tag, type, gradients, cta_buttons, frequency)
DROP FUNCTION IF EXISTS get_active_announcements();
-- Returns new fields; no starts_at filter (starts immediately)
CREATE OR REPLACE FUNCTION get_active_announcements()
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    body TEXT,
    link TEXT,
    image_url TEXT,
    tag TEXT,
    type TEXT,
    gradient_start TEXT,
    gradient_end TEXT,
    cta_buttons JSONB,
    frequency TEXT,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        a.id, a.title, a.body, a.link, a.image_url,
        a.tag, a.type, a.gradient_start, a.gradient_end,
        a.cta_buttons, a.frequency, a.ends_at, a.created_at
    FROM admin_announcements a
    WHERE a.is_active = true
      AND (a.ends_at IS NULL OR a.ends_at > now())
    ORDER BY a.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── UPDATE RPC: admin_list_updates ────────────────────────
-- Drop old version first (return type changed: target_versions → category)
DROP FUNCTION IF EXISTS admin_list_updates();
CREATE OR REPLACE FUNCTION admin_list_updates()
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    message TEXT,
    link TEXT,
    category TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
    SELECT u.id, u.title, u.message, u.link, u.category, u.is_active, u.created_at
    FROM admin_updates u
    ORDER BY u.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- ─── UPDATE RPC: admin_list_announcements ──────────────────
-- Drop old version first (return type changed: added body, tag, type, gradients, cta_buttons, frequency)
DROP FUNCTION IF EXISTS admin_list_announcements();
CREATE OR REPLACE FUNCTION admin_list_announcements()
RETURNS TABLE (
    id BIGINT,
    title TEXT,
    body TEXT,
    link TEXT,
    image_url TEXT,
    tag TEXT,
    type TEXT,
    gradient_start TEXT,
    gradient_end TEXT,
    cta_buttons JSONB,
    frequency TEXT,
    ends_at TIMESTAMPTZ,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
    SELECT a.id, a.title, a.body, a.link, a.image_url,
           a.tag, a.type, a.gradient_start, a.gradient_end,
           a.cta_buttons, a.frequency, a.ends_at, a.is_active, a.created_at
    FROM admin_announcements a
    ORDER BY a.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- ─── RPC: get_tracking_stats ───────────────────────────────
-- Returns impression + click counts for all items
CREATE OR REPLACE FUNCTION get_tracking_stats()
RETURNS TABLE (
    item_type TEXT,
    item_id BIGINT,
    impressions BIGINT,
    clicks BIGINT
) AS $$
    SELECT
        t.item_type,
        t.item_id,
        COUNT(*) FILTER (WHERE t.event_type = 'impression') AS impressions,
        COUNT(*) FILTER (WHERE t.event_type = 'click') AS clicks
    FROM admin_tracking t
    GROUP BY t.item_type, t.item_id;
$$ LANGUAGE sql SECURITY DEFINER;

