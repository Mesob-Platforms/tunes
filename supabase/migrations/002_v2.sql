-- ============================================================
-- TUNES V2 MIGRATION — Run in Supabase SQL Editor
-- Adds: user_profiles, listening_events, taste_groups,
--        taste_group_members, followed_artists
-- Plus: RPC functions for admin/trending queries
-- ============================================================

-- ============================================================
-- 1. USER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    avatar_seed  TEXT NOT NULL DEFAULT '',
    display_name TEXT,
    taste_group_id INT,
    mood_data    JSONB DEFAULT '{}'::jsonb,
    total_minutes NUMERIC DEFAULT 0,
    streak_days  INT DEFAULT 0,
    streak_last_date DATE,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_profiles_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_taste_group ON user_profiles(taste_group_id);

DROP TRIGGER IF EXISTS user_profiles_updated_at ON user_profiles;
CREATE TRIGGER user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 2. LISTENING EVENTS (backbone for trending, admin, taste groups)
-- ============================================================
CREATE TABLE IF NOT EXISTS listening_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    track_id      TEXT NOT NULL,
    track_title   TEXT,
    artist_id     TEXT,
    artist_name   TEXT,
    album_id      TEXT,
    album_title   TEXT,
    genre         TEXT,
    duration_sec  INT DEFAULT 0,
    listened_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listening_events_user ON listening_events(user_id);
CREATE INDEX IF NOT EXISTS idx_listening_events_time ON listening_events(listened_at DESC);
CREATE INDEX IF NOT EXISTS idx_listening_events_artist ON listening_events(artist_name);
CREATE INDEX IF NOT EXISTS idx_listening_events_track ON listening_events(track_id);

-- ============================================================
-- 3. TASTE GROUPS (100 genre-based groups)
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_groups (
    id          INT PRIMARY KEY,
    name        TEXT NOT NULL,
    genre_key   TEXT NOT NULL,
    description TEXT,
    icon        TEXT DEFAULT '🎵'
);

-- ============================================================
-- 4. TASTE GROUP MEMBERS (assigned monthly)
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_group_members (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    group_id    INT NOT NULL REFERENCES taste_groups(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT taste_group_members_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_tgm_group ON taste_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_tgm_user ON taste_group_members(user_id);

-- ============================================================
-- 5. FOLLOWED ARTISTS (for onboarding + recommendations)
-- ============================================================
CREATE TABLE IF NOT EXISTS followed_artists (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    artist_id   TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    artist_picture TEXT,
    followed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT followed_artists_unique UNIQUE (user_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_followed_user ON followed_artists(user_id);

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE listening_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE followed_artists ENABLE ROW LEVEL SECURITY;

-- user_profiles: users read/write own, admin reads all
CREATE POLICY "Users read own profile" ON user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = user_id);

-- listening_events: users insert own, everyone reads (for trending)
CREATE POLICY "Users insert own events" ON listening_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone reads events" ON listening_events FOR SELECT USING (true);

-- taste_groups: everyone reads
CREATE POLICY "Anyone reads taste groups" ON taste_groups FOR SELECT USING (true);

-- taste_group_members: everyone reads (to show member counts/avatars)
CREATE POLICY "Anyone reads members" ON taste_group_members FOR SELECT USING (true);
CREATE POLICY "Users insert own membership" ON taste_group_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own membership" ON taste_group_members FOR UPDATE USING (auth.uid() = user_id);

-- followed_artists: users read/write own
CREATE POLICY "Users read own follows" ON followed_artists FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own follows" ON followed_artists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own follows" ON followed_artists FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 7. RPC FUNCTIONS FOR ADMIN / TRENDING
-- ============================================================

-- Get total user count
CREATE OR REPLACE FUNCTION get_total_users()
RETURNS INT AS $$
    SELECT count(*)::int FROM auth.users;
$$ LANGUAGE sql SECURITY DEFINER;

-- Get active users today
CREATE OR REPLACE FUNCTION get_active_users_today()
RETURNS INT AS $$
    SELECT count(DISTINCT user_id)::int
    FROM listening_events
    WHERE listened_at >= CURRENT_DATE;
$$ LANGUAGE sql SECURITY DEFINER;

-- Get total events today
CREATE OR REPLACE FUNCTION get_events_today()
RETURNS INT AS $$
    SELECT count(*)::int FROM listening_events WHERE listened_at >= CURRENT_DATE;
$$ LANGUAGE sql SECURITY DEFINER;

-- Get total events all time
CREATE OR REPLACE FUNCTION get_events_total()
RETURNS INT AS $$
    SELECT count(*)::int FROM listening_events;
$$ LANGUAGE sql SECURITY DEFINER;

-- Trending artists (last 48h)
CREATE OR REPLACE FUNCTION get_trending_artists(lim INT DEFAULT 15)
RETURNS TABLE(artist_name TEXT, listen_count BIGINT) AS $$
    SELECT artist_name, count(*) as listen_count
    FROM listening_events
    WHERE listened_at >= now() - interval '48 hours'
      AND artist_name IS NOT NULL AND artist_name != ''
    GROUP BY artist_name
    ORDER BY listen_count DESC
    LIMIT lim;
$$ LANGUAGE sql SECURITY DEFINER;

-- Trending albums (last 48h)
CREATE OR REPLACE FUNCTION get_trending_albums(lim INT DEFAULT 15)
RETURNS TABLE(album_title TEXT, artist_name TEXT, album_id TEXT, listen_count BIGINT) AS $$
    SELECT album_title, artist_name, album_id, count(*) as listen_count
    FROM listening_events
    WHERE listened_at >= now() - interval '48 hours'
      AND album_title IS NOT NULL AND album_title != ''
    GROUP BY album_title, artist_name, album_id
    ORDER BY listen_count DESC
    LIMIT lim;
$$ LANGUAGE sql SECURITY DEFINER;

-- Trending tracks (last 48h)
CREATE OR REPLACE FUNCTION get_trending_tracks(lim INT DEFAULT 15)
RETURNS TABLE(track_title TEXT, artist_name TEXT, track_id TEXT, listen_count BIGINT) AS $$
    SELECT track_title, artist_name, track_id, count(*) as listen_count
    FROM listening_events
    WHERE listened_at >= now() - interval '48 hours'
      AND track_title IS NOT NULL AND track_title != ''
    GROUP BY track_title, artist_name, track_id
    ORDER BY listen_count DESC
    LIMIT lim;
$$ LANGUAGE sql SECURITY DEFINER;

-- Trending searches (top artist names people listen to - used as "trending" on explore)
CREATE OR REPLACE FUNCTION get_trending_searches(lim INT DEFAULT 20)
RETURNS TABLE(search_term TEXT, search_count BIGINT) AS $$
    SELECT artist_name as search_term, count(*) as search_count
    FROM listening_events
    WHERE listened_at >= now() - interval '48 hours'
      AND artist_name IS NOT NULL AND artist_name != ''
    GROUP BY artist_name
    ORDER BY search_count DESC
    LIMIT lim;
$$ LANGUAGE sql SECURITY DEFINER;

-- Taste group distribution
CREATE OR REPLACE FUNCTION get_taste_group_distribution()
RETURNS TABLE(group_id INT, group_name TEXT, member_count BIGINT) AS $$
    SELECT tg.id as group_id, tg.name as group_name, count(tgm.user_id) as member_count
    FROM taste_groups tg
    LEFT JOIN taste_group_members tgm ON tg.id = tgm.group_id
    GROUP BY tg.id, tg.name
    ORDER BY member_count DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- Signups over time (daily for last 30 days)
CREATE OR REPLACE FUNCTION get_signups_over_time()
RETURNS TABLE(signup_date DATE, signup_count BIGINT) AS $$
    SELECT created_at::date as signup_date, count(*) as signup_count
    FROM auth.users
    WHERE created_at >= now() - interval '30 days'
    GROUP BY signup_date
    ORDER BY signup_date;
$$ LANGUAGE sql SECURITY DEFINER;

-- Get user's genre distribution (for taste group assignment)
CREATE OR REPLACE FUNCTION get_user_genre_distribution(uid UUID)
RETURNS TABLE(genre TEXT, listen_count BIGINT) AS $$
    SELECT genre, count(*) as listen_count
    FROM listening_events
    WHERE user_id = uid
      AND listened_at >= date_trunc('month', now())
      AND genre IS NOT NULL AND genre != ''
    GROUP BY genre
    ORDER BY listen_count DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- Get taste group members with avatars (for compatibility + display)
CREATE OR REPLACE FUNCTION get_group_members(gid INT, lim INT DEFAULT 10)
RETURNS TABLE(user_id UUID, avatar_seed TEXT, display_name TEXT) AS $$
    SELECT tgm.user_id, COALESCE(up.avatar_seed, tgm.user_id::text) as avatar_seed,
           COALESCE(up.display_name, 'Music Lover') as display_name
    FROM taste_group_members tgm
    LEFT JOIN user_profiles up ON up.user_id = tgm.user_id
    WHERE tgm.group_id = gid
    LIMIT lim;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- 8. SEED THE 100 TASTE GROUPS
-- ============================================================
INSERT INTO taste_groups (id, name, genre_key, description, icon) VALUES
(1, 'Rap Royals', 'hip-hop', 'The throne of hip-hop. Bars over everything.', '👑'),
(2, 'Trap Titans', 'trap', 'Hi-hats and 808s run through your veins.', '🔥'),
(3, 'Boom Bap Purists', 'boom-bap', 'Golden era. Real hip-hop, no gimmicks.', '🎤'),
(4, 'Drill Demons', 'drill', 'Sliding on the beat, always.', '😈'),
(5, 'Cloud Rap Drifters', 'cloud-rap', 'Floating above the noise.', '☁️'),
(6, 'Pop Royalty', 'pop', 'Chart-topping anthems are your love language.', '💎'),
(7, 'Synth Pop Dreamers', 'synth-pop', 'Neon lights and retro futures.', '🌆'),
(8, 'Indie Pop Wanderers', 'indie-pop', 'Quirky, heartfelt, and unapologetically different.', '🌻'),
(9, 'K-Pop Stans', 'k-pop', 'Choreography, visuals, and flawless production.', '🇰🇷'),
(10, 'Electropop Architects', 'electropop', 'Where melody meets the machine.', '⚡'),
(11, 'Rock Rebels', 'rock', 'Guitars loud, spirits louder.', '🎸'),
(12, 'Punk Anarchists', 'punk', 'Three chords and the truth.', '🏴'),
(13, 'Grunge Ghosts', 'grunge', 'Flannel shirts and distortion pedals.', '👻'),
(14, 'Metal Maniacs', 'metal', 'Headbanging is a lifestyle.', '🤘'),
(15, 'Prog Rock Wizards', 'progressive-rock', '20-minute songs? Not long enough.', '🧙'),
(16, 'Alt Rock Misfits', 'alternative', 'Too rock for pop, too pop for punk.', '🎭'),
(17, 'Classic Rock Legends', 'classic-rock', 'Zeppelin, Floyd, Sabbath. Enough said.', '🏛️'),
(18, 'Garage Rock Rats', 'garage-rock', 'Raw, loud, and beautiful.', '🐀'),
(19, 'Emo Knights', 'emo', 'Feelings turned up to eleven.', '🖤'),
(20, 'Post-Punk Shadows', 'post-punk', 'Dark, angular, and impossibly cool.', '🌑'),
(21, 'R&B Royals', 'r&b', 'Smooth vocals and silky production.', '💜'),
(22, 'Neo-Soul Seekers', 'neo-soul', 'Erykah, D''Angelo, and vibes eternal.', '✨'),
(23, 'Soul Architects', 'soul', 'Building cathedrals out of feeling.', '🏗️'),
(24, 'Funk Machines', 'funk', 'If you ain''t got the funk, you ain''t got nothin''.', '🕺'),
(25, 'Quiet Storm Lovers', 'quiet-storm', 'Late night, low lights, deep feelings.', '🌙'),
(26, 'Bass Prophets', 'electronic', 'The future sounds like this.', '🔊'),
(27, 'House Heads', 'house', 'Four-on-the-floor till the sun comes up.', '🏠'),
(28, 'Techno Monks', 'techno', 'Repetition is meditation.', '🔁'),
(29, 'Dubstep Warriors', 'dubstep', 'Drop it. Drop it harder.', '💥'),
(30, 'Drum & Bass Pilots', 'drum-and-bass', 'Breakneck speed, absolute precision.', '🛩️'),
(31, 'Trance Voyagers', 'trance', 'Euphoria in 138 BPM.', '🌀'),
(32, 'Ambient Ghosts', 'ambient', 'Music for spaces between thoughts.', '🫧'),
(33, 'Lo-Fi Scholars', 'lo-fi', 'Study beats and rainy windows.', '📚'),
(34, 'Synthwave Riders', 'synthwave', 'Outrunning the sunset since 1984.', '🌅'),
(35, 'IDM Explorers', 'idm', 'Aphex Twin is your spirit animal.', '🧪'),
(36, 'Garage Gang', 'uk-garage', 'Two-step and basslines, London style.', '🇬🇧'),
(37, 'Jazz Cats', 'jazz', 'Improvisation is the highest art form.', '🎷'),
(38, 'Smooth Jazz Loungers', 'smooth-jazz', 'Elevator music? No. Elevation music.', '🛋️'),
(39, 'Bebop Speedsters', 'bebop', 'Faster fingers, deeper soul.', '💨'),
(40, 'Jazz Fusion Alchemists', 'jazz-fusion', 'Where jazz meets everything else.', '⚗️'),
(41, 'Classical Connoisseurs', 'classical', 'Centuries of beauty, one playlist.', '🎻'),
(42, 'Orchestral Dreamers', 'orchestral', 'Symphonies paint your world.', '🎼'),
(43, 'Opera Enthusiasts', 'opera', 'Drama, passion, and impossible notes.', '🎭'),
(44, 'Piano Poets', 'piano', 'Ivory keys, infinite emotion.', '🎹'),
(45, 'Chamber Music Circle', 'chamber', 'Intimate, refined, perfect.', '🕯️'),
(46, 'Country Roads', 'country', 'Trucks, heartbreak, and open highways.', '🤠'),
(47, 'Outlaw Country Riders', 'outlaw-country', 'Willie, Waylon, and whiskey.', '🏴‍☠️'),
(48, 'Bluegrass Pickers', 'bluegrass', 'Banjos and front porches.', '🪕'),
(49, 'Americana Storytellers', 'americana', 'The soundtrack of the heartland.', '🦅'),
(50, 'Country Pop Stars', 'country-pop', 'Nashville meets the mainstream.', '⭐'),
(51, 'Reggae Roots', 'reggae', 'One love, one heart.', '🟢'),
(52, 'Dancehall Kings', 'dancehall', 'Riddims that move mountains.', '🇯🇲'),
(53, 'Afrobeats Royalty', 'afrobeats', 'The sound of a continent conquering the world.', '🌍'),
(54, 'Amapiano Architects', 'amapiano', 'Log drums and basslines from Mzansi.', '🇿🇦'),
(55, 'Latin Heat', 'latin', 'Ritmo, sabor, y fuego.', '🔥'),
(56, 'Reggaeton Riders', 'reggaeton', 'Dem bow forever.', '🎺'),
(57, 'Salsa Spinners', 'salsa', 'Feet never stop moving.', '💃'),
(58, 'Bossa Nova Breeze', 'bossa-nova', 'Cool jazz from Copacabana.', '🏖️'),
(59, 'Samba Spirits', 'samba', 'Carnival energy year-round.', '🎪'),
(60, 'Flamenco Fire', 'flamenco', 'Passion expressed in every strum.', '🇪🇸'),
(61, 'Folk Wanderers', 'folk', 'Acoustic guitars and honest stories.', '🍂'),
(62, 'Indie Folk Campfire', 'indie-folk', 'Bon Iver on repeat.', '🏕️'),
(63, 'Psychedelic Folk Oracles', 'psych-folk', 'Mushrooms optional, wonder required.', '🍄'),
(64, 'Celtic Mystics', 'celtic', 'Ancient melodies from green hills.', '☘️'),
(65, 'World Music Nomads', 'world', 'Every border crossed, every rhythm absorbed.', '🗺️'),
(66, 'Blues Brothers', 'blues', 'Twelve bars of pure truth.', '🎸'),
(67, 'Delta Blues Diggers', 'delta-blues', 'Where it all began.', '🏚️'),
(68, 'Gospel Choir', 'gospel', 'Lifting spirits through song.', '🙏'),
(69, 'Psychedelic Explorers', 'psychedelic', 'Expanding consciousness through sound.', '🌈'),
(70, 'Shoegaze Dreamers', 'shoegaze', 'Lost in walls of reverb.', '👟'),
(71, 'Dream Pop Drifters', 'dream-pop', 'Ethereal, floating, transcendent.', '💫'),
(72, 'Noise Rock Destroyers', 'noise-rock', 'Beautiful chaos.', '🔇'),
(73, 'Math Rock Calculators', 'math-rock', 'Odd time signatures are home.', '🔢'),
(74, 'Post-Rock Builders', 'post-rock', 'Crescendos that touch the sky.', '🏔️'),
(75, 'Doom Metal Prophets', 'doom-metal', 'Slow, heavy, eternal.', '⚰️'),
(76, 'Black Metal Forest', 'black-metal', 'Blast beats in the frozen woods.', '🌲'),
(77, 'Death Metal Surgeons', 'death-metal', 'Precision brutality.', '💀'),
(78, 'Metalcore Warriors', 'metalcore', 'Breakdowns that shake the earth.', '⚔️'),
(79, 'Power Metal Champions', 'power-metal', 'Epic tales and soaring vocals.', '🐉'),
(80, 'Ska Skankers', 'ska', 'Pick it up, pick it up, pick it up!', '🎺'),
(81, 'New Wave Prophets', 'new-wave', 'The 80s never ended.', '📺'),
(82, 'Disco Dynasty', 'disco', 'Mirror balls and bass kicks.', '🪩'),
(83, 'City Pop Cruisers', 'city-pop', 'Tokyo nights, plastic love.', '🌃'),
(84, 'Vaporwave Ghosts', 'vaporwave', 'A E S T H E T I C.', '🏢'),
(85, 'Chiptune Pixies', 'chiptune', '8-bit dreams and pixel beats.', '👾'),
(86, 'Experimental Alchemists', 'experimental', 'Rules? What rules?', '🧬'),
(87, 'Noise Artists', 'noise', 'Finding beauty in chaos.', '📡'),
(88, 'Industrial Machines', 'industrial', 'Gears, grit, and rhythm.', '🏭'),
(89, 'Darkwave Shadows', 'darkwave', 'Gothic synths and midnight drives.', '🦇'),
(90, 'Witch House Coven', 'witch-house', 'Hexed beats and chopped vocals.', '🧙‍♀️'),
(91, 'Hyperpop Glitchers', 'hyperpop', 'Distortion is the new melody.', '💊'),
(92, 'Phonk Drifters', 'phonk', 'Memphis tapes and cowbell.', '🚗'),
(93, 'Meditation Monks', 'meditation', 'Inner peace, one frequency at a time.', '🧘'),
(94, 'Film Score Fans', 'soundtrack', 'Every day needs a cinematic score.', '🎬'),
(95, 'Video Game Soundtrackers', 'game-music', 'Boss fight music for daily life.', '🎮'),
(96, 'Anime Otaku', 'anime', 'Opening themes are an art form.', '⛩️'),
(97, 'Podcast People', 'spoken-word', 'Voices over beats.', '🎙️'),
(98, 'Worship Warriors', 'worship', 'Music as devotion.', '🕊️'),
(99, 'Ethio-Jazz Pioneers', 'ethio-jazz', 'Mulatu Astatke opened the door.', '🇪🇹'),
(100, 'The Eclectics', 'eclectic', 'Cannot be boxed. Will not be labeled.', '🎲')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 9. ADMIN RPC FUNCTIONS (user list, summary, deletion)
-- ============================================================

-- Admin: Get all users with basic stats
CREATE OR REPLACE FUNCTION admin_get_all_users()
RETURNS TABLE(
    user_id UUID,
    email TEXT,
    display_name TEXT,
    avatar_seed TEXT,
    total_plays BIGINT,
    created_at TIMESTAMPTZ
) AS $$
    SELECT
        au.id AS user_id,
        au.email::text,
        COALESCE(up.display_name, 'Music Lover') AS display_name,
        COALESCE(up.avatar_seed, au.id::text) AS avatar_seed,
        (SELECT count(*) FROM listening_events le WHERE le.user_id = au.id) AS total_plays,
        au.created_at
    FROM auth.users au
    LEFT JOIN user_profiles up ON au.id = up.user_id
    ORDER BY au.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- Admin: Get detailed user summary for profile view
CREATE OR REPLACE FUNCTION admin_get_user_summary(target_user_id UUID)
RETURNS TABLE(
    total_plays BIGINT,
    unique_tracks BIGINT,
    unique_artists BIGINT,
    first_listen TIMESTAMPTZ,
    last_listen TIMESTAMPTZ,
    top_artists JSONB,
    top_tracks JSONB,
    top_genres JSONB
) AS $$
    SELECT
        (SELECT count(*) FROM listening_events WHERE user_id = target_user_id) AS total_plays,
        (SELECT count(DISTINCT track_id) FROM listening_events WHERE user_id = target_user_id) AS unique_tracks,
        (SELECT count(DISTINCT artist_name) FROM listening_events WHERE user_id = target_user_id AND artist_name IS NOT NULL AND artist_name != '') AS unique_artists,
        (SELECT min(listened_at) FROM listening_events WHERE user_id = target_user_id) AS first_listen,
        (SELECT max(listened_at) FROM listening_events WHERE user_id = target_user_id) AS last_listen,
        (
            SELECT COALESCE(jsonb_agg(row_to_json(a).*), '[]'::jsonb)
            FROM (
                SELECT artist_name, count(*) AS plays
                FROM listening_events
                WHERE user_id = target_user_id AND artist_name IS NOT NULL AND artist_name != ''
                GROUP BY artist_name
                ORDER BY plays DESC
                LIMIT 5
            ) a
        ) AS top_artists,
        (
            SELECT COALESCE(jsonb_agg(row_to_json(t).*), '[]'::jsonb)
            FROM (
                SELECT track_title, artist_name, count(*) AS plays
                FROM listening_events
                WHERE user_id = target_user_id AND track_title IS NOT NULL AND track_title != ''
                GROUP BY track_title, artist_name
                ORDER BY plays DESC
                LIMIT 5
            ) t
        ) AS top_tracks,
        (
            SELECT COALESCE(jsonb_agg(row_to_json(g).*), '[]'::jsonb)
            FROM (
                SELECT genre, count(*) AS plays
                FROM listening_events
                WHERE user_id = target_user_id AND genre IS NOT NULL AND genre != ''
                GROUP BY genre
                ORDER BY plays DESC
                LIMIT 5
            ) g
        ) AS top_genres;
$$ LANGUAGE sql SECURITY DEFINER;

-- Admin: Delete a user and all associated data
CREATE OR REPLACE FUNCTION admin_delete_user(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Delete from auth.users (cascades to user_profiles, listening_events, etc.)
    DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- DONE! Verify:
-- Table Editor → user_profiles, listening_events, taste_groups,
--   taste_group_members, followed_artists
-- ============================================================

