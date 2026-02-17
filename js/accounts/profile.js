// js/accounts/profile.js
// User profile management: avatars, stats, mood ring
import { supabase } from './config.js';
import { authManager } from './auth.js';

// Gender-neutral avatar via DiceBear API (bottts-neutral style)
export function getAvatarUrl(seed) {
    const safeSeed = encodeURIComponent(String(seed));
    return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${safeSeed}`;
}

// Ensure user has a profile row
export async function ensureProfile(userId) {
    if (!supabase || !userId) return null;

    try {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (data) return data;

        // Create profile
        const avatarSeed = userId; // Deterministic: same user = same avatar
        const { data: newProfile, error: insertErr } = await supabase
            .from('user_profiles')
            .insert({
                user_id: userId,
                avatar_seed: avatarSeed,
                display_name: authManager.user?.displayName || 'Music Lover',
            })
            .select()
            .single();

        if (insertErr) {
            console.error('[Profile] Insert error:', insertErr);
            return null;
        }
        return newProfile;
    } catch (e) {
        console.error('[Profile] Error:', e);
        return null;
    }
}

// Get user stats from listening_events
export async function getUserStats(userId) {
    if (!supabase || !userId) return null;

    try {
        // Get distinct counts + total
        const { data: events, error } = await supabase
            .from('listening_events')
            .select('track_id, artist_name, album_id, duration_sec, genre')
            .eq('user_id', userId);

        if (error || !events) return { uniqueTracks: 0, uniqueArtists: 0, uniqueAlbums: 0, topGenres: [], totalMinutes: 0 };

        const uniqueTracks = new Set(events.map(e => e.track_id)).size;
        const uniqueArtists = new Set(events.filter(e => e.artist_name).map(e => e.artist_name)).size;
        const uniqueAlbums = new Set(events.filter(e => e.album_id).map(e => e.album_id)).size;
        const totalMinutes = Math.round(events.reduce((sum, e) => sum + (e.duration_sec || 0), 0) / 60);

        // Genre distribution
        const genreCounts = {};
        events.forEach(e => {
            if (e.genre) {
                genreCounts[e.genre] = (genreCounts[e.genre] || 0) + 1;
            }
        });
        const topGenres = Object.entries(genreCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([genre, count]) => ({ genre, count, pct: Math.round(count / events.length * 100) }));

        return { uniqueTracks, uniqueArtists, uniqueAlbums, topGenres, totalMinutes };
    } catch (e) {
        console.error('[Profile] Stats error:', e);
        return null;
    }
}

// Get listening streak
export async function getListeningStreak(userId) {
    if (!supabase || !userId) return 0;

    try {
        const { data, error } = await supabase
            .from('listening_events')
            .select('listened_at')
            .eq('user_id', userId)
            .order('listened_at', { ascending: false })
            .limit(500);

        if (error || !data || data.length === 0) return 0;

        // Get unique dates
        const dates = [...new Set(data.map(e => new Date(e.listened_at).toISOString().split('T')[0]))].sort().reverse();
        
        let streak = 0;
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        // Must have listened today or yesterday to have an active streak
        if (dates[0] !== today && dates[0] !== yesterday) return 0;

        for (let i = 0; i < dates.length; i++) {
            const expected = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
            if (dates[i] === expected) {
                streak++;
            } else if (i === 0 && dates[0] === yesterday) {
                // Started from yesterday
                streak++;
                continue;
            } else {
                break;
            }
        }

        return streak;
    } catch (e) {
        return 0;
    }
}

// Mood ring: compute mood from recent listening genres
const GENRE_MOODS = {
    'hip-hop': { h: 35, s: 85, l: 55, label: 'Energetic' },
    'rap': { h: 35, s: 85, l: 55, label: 'Energetic' },
    'trap': { h: 15, s: 90, l: 45, label: 'Intense' },
    'pop': { h: 320, s: 75, l: 65, label: 'Upbeat' },
    'rock': { h: 0, s: 80, l: 50, label: 'Powerful' },
    'metal': { h: 0, s: 90, l: 35, label: 'Fierce' },
    'electronic': { h: 260, s: 80, l: 55, label: 'Electric' },
    'house': { h: 280, s: 70, l: 55, label: 'Groovy' },
    'techno': { h: 240, s: 85, l: 45, label: 'Hypnotic' },
    'r&b': { h: 280, s: 60, l: 50, label: 'Smooth' },
    'soul': { h: 30, s: 50, l: 55, label: 'Warm' },
    'jazz': { h: 45, s: 55, l: 50, label: 'Mellow' },
    'classical': { h: 210, s: 40, l: 60, label: 'Serene' },
    'ambient': { h: 190, s: 30, l: 65, label: 'Calm' },
    'lo-fi': { h: 170, s: 35, l: 55, label: 'Chill' },
    'folk': { h: 90, s: 45, l: 55, label: 'Grounded' },
    'country': { h: 50, s: 60, l: 55, label: 'Nostalgic' },
    'blues': { h: 220, s: 50, l: 45, label: 'Soulful' },
    'reggae': { h: 120, s: 65, l: 50, label: 'Relaxed' },
    'afrobeats': { h: 45, s: 80, l: 55, label: 'Vibrant' },
    'latin': { h: 10, s: 85, l: 55, label: 'Passionate' },
    'punk': { h: 350, s: 90, l: 50, label: 'Rebellious' },
    'emo': { h: 270, s: 40, l: 40, label: 'Reflective' },
    'indie': { h: 160, s: 50, l: 55, label: 'Thoughtful' },
};

export function computeMood(topGenres) {
    if (!topGenres || topGenres.length === 0) {
        return { h: 200, s: 30, l: 50, label: 'Discovering' };
    }

    let totalH = 0, totalS = 0, totalL = 0;
    let totalWeight = 0;
    let topLabel = 'Vibing';

    topGenres.forEach((g, i) => {
        const genreLower = g.genre.toLowerCase();
        let mood = null;
        for (const [key, val] of Object.entries(GENRE_MOODS)) {
            if (genreLower.includes(key)) { mood = val; break; }
        }
        if (!mood) mood = { h: 200, s: 40, l: 50, label: 'Eclectic' };

        const weight = g.count;
        totalH += mood.h * weight;
        totalS += mood.s * weight;
        totalL += mood.l * weight;
        totalWeight += weight;
        if (i === 0) topLabel = mood.label;
    });

    return {
        h: Math.round(totalH / totalWeight),
        s: Math.round(totalS / totalWeight),
        l: Math.round(totalL / totalWeight),
        label: topLabel,
    };
}

// Compute compatibility between two users' genre distributions
export function computeCompatibility(myGenres, theirGenres) {
    if (!myGenres || !theirGenres || myGenres.length === 0 || theirGenres.length === 0) return 0;

    const myMap = {};
    const theirMap = {};
    let myTotal = 0, theirTotal = 0;

    myGenres.forEach(g => { myMap[g.genre] = g.count; myTotal += g.count; });
    theirGenres.forEach(g => { theirMap[g.genre] = g.count; theirTotal += g.count; });

    // Cosine similarity
    const allGenres = new Set([...Object.keys(myMap), ...Object.keys(theirMap)]);
    let dotProduct = 0, magA = 0, magB = 0;

    allGenres.forEach(genre => {
        const a = (myMap[genre] || 0) / myTotal;
        const b = (theirMap[genre] || 0) / theirTotal;
        dotProduct += a * b;
        magA += a * a;
        magB += b * b;
    });

    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    if (magnitude === 0) return 0;

    return Math.round((dotProduct / magnitude) * 100);
}

// Build the full account page data
export async function buildAccountPageData(userId) {
    const profile = await ensureProfile(userId);
    const stats = await getUserStats(userId);
    const streak = await getListeningStreak(userId);
    const mood = computeMood(stats?.topGenres || []);

    return {
        profile,
        stats,
        streak,
        mood,
        avatarUrl: getAvatarUrl(profile?.avatar_seed || userId),
    };
}
