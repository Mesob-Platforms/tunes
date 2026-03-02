// js/accounts/supabaseSync.js
// Supabase-based data sync (replaces PocketBase)
import { supabase } from './config.js';
import { db } from '../db.js';
import { authManager } from './auth.js';

console.log('[Supabase Sync] Initializing...');

const syncManager = {
    _userRecordCache: null,
    _isSyncing: false,

    async _getUserRecord(uid) {
        if (!uid) return null;

        if (this._userRecordCache && this._userRecordCache.user_id === uid) {
            return this._userRecordCache;
        }

        try {
            const { data, error } = await supabase
                .from('user_data')
                .select('*')
                .eq('user_id', uid)
                .maybeSingle();

            if (error) {
                console.error('[Supabase] Failed to get user:', error);
                return null;
            }

            if (data) {
                this._userRecordCache = data;
                return data;
            }

            // No record found — create one
            const { data: newRecord, error: createError } = await supabase
                .from('user_data')
                .insert({
                    user_id: uid,
                    library: {},
                    history: [],
                    user_playlists: {},
                    user_folders: {},
                })
                .select()
                .single();

            if (createError) {
                console.error('[Supabase] Failed to create user:', createError);
                return null;
            }

            this._userRecordCache = newRecord;
            return newRecord;
        } catch (error) {
            console.error('[Supabase] Unexpected error getting user:', error);
            return null;
        }
    },

    async getUserData() {
        const user = authManager.user;
        if (!user) return null;

        const record = await this._getUserRecord(user.uid);
        if (!record) return null;

        const library = this._ensureParsed(record.library, {});
        const history = this._ensureParsed(record.history, []);
        const userPlaylists = this._ensureParsed(record.user_playlists, {});
        const userFolders = this._ensureParsed(record.user_folders, {});

        return { library, history, userPlaylists, userFolders };
    },

    _pendingUpdates: {},
    _debounceTimers: {},

    async _updateUserJSON(uid, field, data) {
        this._pendingUpdates[field] = { uid, data };

        if (this._debounceTimers[field]) clearTimeout(this._debounceTimers[field]);
        this._debounceTimers[field] = setTimeout(() => this._flushUpdate(field), 1500);
    },

    async _flushUpdate(field) {
        const pending = this._pendingUpdates[field];
        if (!pending) return;
        delete this._pendingUpdates[field];
        delete this._debounceTimers[field];

        const record = await this._getUserRecord(pending.uid);
        if (!record) {
            console.error('Cannot update: no user record found');
            return;
        }

        try {
            const { data: updated, error } = await supabase
                .from('user_data')
                .update({ [field]: pending.data })
                .eq('id', record.id)
                .select()
                .single();

            if (error) {
                console.error(`Failed to sync ${field} to Supabase:`, error);
                return;
            }

            this._userRecordCache = updated;
        } catch (error) {
            console.error(`Failed to sync ${field} to Supabase:`, error);
        }
    },

    /**
     * Ensures a value from Supabase JSONB is a parsed JS value.
     * Supabase returns JSONB columns as native objects, but this handles
     * string fallback for any migrated data.
     */
    _ensureParsed(val, fallback) {
        if (val == null) return fallback;
        if (typeof val === 'string') {
            try {
                return JSON.parse(val);
            } catch {
                return fallback;
            }
        }
        return val;
    },

    // Kept for backward compatibility with code that calls safeParseInternal
    safeParseInternal(str, fieldName, fallback) {
        return this._ensureParsed(str, fallback);
    },

    async syncLibraryItem(type, item, added) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        let library = this._ensureParsed(record.library, {});

        const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
        const key = type === 'playlist' ? item.uuid : item.id;

        if (!library[pluralType]) {
            library[pluralType] = {};
        }

        if (added) {
            library[pluralType][key] = this._minifyItem(type, item);
        } else {
            delete library[pluralType][key];
        }

        await this._updateUserJSON(user.uid, 'library', library);
    },

    _minifyItem(type, item) {
        if (!item) return item;

        const base = {
            id: item.id,
            addedAt: item.addedAt || Date.now(),
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          vibrantColor: item.album.vibrantColor || null,
                          artist: item.album.artist || null,
                          numberOfTracks: item.album.numberOfTracks || null,
                      }
                    : null,
                copyright: item.copyright || null,
                isrc: item.isrc || null,
                trackNumber: item.trackNumber || null,
                streamStartDate: item.streamStartDate || null,
                version: item.version || null,
                mixes: item.mixes || null,
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit || false,
                artist: item.artist
                    ? { name: item.artist.name || null, id: item.artist.id }
                    : item.artists?.[0]
                      ? { name: item.artists[0].name || null, id: item.artists[0].id }
                      : null,
                type: item.type || null,
                numberOfTracks: item.numberOfTracks || null,
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null,
            };
        }

        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || Date.now(),
                title: item.title || item.name || null,
                image: item.image || item.squareImage || item.cover || null,
                numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
                user: item.user ? { name: item.user.name || null } : null,
            };
        }

        if (type === 'mix') {
            return {
                id: item.id,
                addedAt: item.addedAt || Date.now(),
                title: item.title,
                subTitle: item.subTitle,
                mixType: item.mixType,
                cover: item.cover,
            };
        }

        return item;
    },

    async syncHistoryItem(historyEntry) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        let history = this._ensureParsed(record.history, []);

        const newHistory = [historyEntry, ...history].slice(0, 100);
        await this._updateUserJSON(user.uid, 'history', newHistory);
    },

    async syncUserPlaylist(playlist, action) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        let userPlaylists = this._ensureParsed(record.user_playlists, {});

        if (action === 'delete') {
            delete userPlaylists[playlist.id];
            await this.unpublishPlaylist(playlist.id);
        } else {
            userPlaylists[playlist.id] = {
                id: playlist.id,
                name: playlist.name,
                cover: playlist.cover || null,
                tracks: playlist.tracks ? playlist.tracks.map((t) => this._minifyItem('track', t)) : [],
                createdAt: playlist.createdAt || Date.now(),
                updatedAt: playlist.updatedAt || Date.now(),
                numberOfTracks: playlist.tracks ? playlist.tracks.length : 0,
                images: playlist.images || [],
                isPublic: playlist.isPublic || false,
            };

            if (playlist.isPublic) {
                await this.publishPlaylist(playlist);
            }
        }

        await this._updateUserJSON(user.uid, 'user_playlists', userPlaylists);
    },

    async syncUserFolder(folder, action) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        let userFolders = this._ensureParsed(record.user_folders, {});

        if (action === 'delete') {
            delete userFolders[folder.id];
        } else {
            userFolders[folder.id] = {
                id: folder.id,
                name: folder.name,
                cover: folder.cover || null,
                playlists: folder.playlists || [],
                createdAt: folder.createdAt || Date.now(),
                updatedAt: folder.updatedAt || Date.now(),
            };
        }

        await this._updateUserJSON(user.uid, 'user_folders', userFolders);
    },

    async getPublicPlaylist(uuid) {
        try {
            const { data: record, error } = await supabase
                .from('public_playlists')
                .select('*')
                .eq('uuid', uuid)
                .maybeSingle();

            if (error) {
                console.error('Failed to fetch public playlist:', error);
                throw error;
            }

            if (!record) return null;

            let rawCover = record.image || record.cover || '';
            let extraData = this._ensureParsed(record.data, {});

            if (!rawCover && extraData && typeof extraData === 'object') {
                rawCover = extraData.cover || extraData.image || '';
            }

            let finalCover = rawCover;

            let images = [];
            let tracks = this._ensureParsed(record.tracks, []);

            if (!finalCover && tracks && tracks.length > 0) {
                const uniqueCovers = [];
                const seenCovers = new Set();
                for (const track of tracks) {
                    const c = track.album?.cover;
                    if (c && !seenCovers.has(c)) {
                        seenCovers.add(c);
                        uniqueCovers.push(c);
                        if (uniqueCovers.length >= 4) break;
                    }
                }
                images = uniqueCovers;
            }

            let finalTitle = record.title || '';
            if (!finalTitle && extraData && typeof extraData === 'object') {
                finalTitle = extraData.title || extraData.name || '';
            }
            if (!finalTitle) finalTitle = 'Untitled Playlist';

            return {
                ...record,
                id: record.uuid,
                name: finalTitle,
                title: finalTitle,
                cover: finalCover,
                image: finalCover,
                tracks: tracks,
                images: images,
                numberOfTracks: tracks.length,
                type: 'user-playlist',
                isPublic: true,
                user: { name: 'Community Playlist' },
            };
        } catch (error) {
            console.error('Failed to fetch public playlist:', error);
            throw error;
        }
    },

    async publishPlaylist(playlist) {
        if (!playlist || !playlist.id) return;
        const uid = authManager.user?.uid;
        if (!uid) return;

        const data = {
            uuid: playlist.id,
            uid: uid,
            title: playlist.name,
            image: playlist.cover || null,
            cover: playlist.cover || null,
            tracks: playlist.tracks || [],
            is_public: true,
            data: {
                title: playlist.name,
                cover: playlist.cover,
            },
        };

        try {
            const { error } = await supabase
                .from('public_playlists')
                .upsert(data, { onConflict: 'uuid' });

            if (error) {
                console.error('Failed to publish playlist:', error);
            }
        } catch (error) {
            console.error('Failed to publish playlist:', error);
        }
    },

    async unpublishPlaylist(uuid) {
        const uid = authManager.user?.uid;
        if (!uid) return;

        try {
            const { error } = await supabase
                .from('public_playlists')
                .delete()
                .eq('uuid', uuid)
                .eq('uid', uid);

            if (error) {
                console.error('Failed to unpublish playlist:', error);
            }
        } catch (error) {
            console.error('Failed to unpublish playlist:', error);
        }
    },

    async clearCloudData() {
        const user = authManager.user;
        if (!user) return;

        try {
            const { error } = await supabase
                .from('user_data')
                .delete()
                .eq('user_id', user.uid);

            if (error) {
                console.error('Failed to clear cloud data!', error);
                alert('Failed to clear cloud data! :( Check console for details.');
                return;
            }

            this._userRecordCache = null;
            alert('Cloud data cleared successfully.');
        } catch (error) {
            console.error('Failed to clear cloud data!', error);
            alert('Failed to clear cloud data! :( Check console for details.');
        }
    },

    async onAuthStateChanged(user) {
        if (user) {
            if (this._isSyncing) return;

            this._isSyncing = true;

            try {
                const cloudData = await this.getUserData();

                if (cloudData) {
                    let database = db;
                    if (typeof database === 'function') {
                        database = await database();
                    } else {
                        database = await database;
                    }

                    const getAll = async (store) => {
                        if (database && typeof database.getAll === 'function') return database.getAll(store);
                        if (database && database.db && typeof database.db.getAll === 'function')
                            return database.db.getAll(store);
                        return [];
                    };

                    const localData = {
                        tracks: (await getAll('favorites_tracks')) || [],
                        albums: (await getAll('favorites_albums')) || [],
                        artists: (await getAll('favorites_artists')) || [],
                        playlists: (await getAll('favorites_playlists')) || [],
                        mixes: (await getAll('favorites_mixes')) || [],
                        history: (await getAll('history_tracks')) || [],
                        userPlaylists: (await getAll('user_playlists')) || [],
                        userFolders: (await getAll('user_folders')) || [],
                    };

                    let { library, history, userPlaylists, userFolders } = cloudData;
                    let needsUpdate = false;

                    if (!library) library = {};
                    if (!library.tracks) library.tracks = {};
                    if (!library.albums) library.albums = {};
                    if (!library.artists) library.artists = {};
                    if (!library.playlists) library.playlists = {};
                    if (!library.mixes) library.mixes = {};
                    if (!userPlaylists) userPlaylists = {};
                    if (!userFolders) userFolders = {};
                    if (!history) history = [];

                    const mergeItem = (collection, item, type) => {
                        const id = type === 'playlist' ? item.uuid || item.id : item.id;
                        if (!collection[id]) {
                            collection[id] = this._minifyItem(type, item);
                            needsUpdate = true;
                        }
                    };

                    localData.tracks.forEach((item) => mergeItem(library.tracks, item, 'track'));
                    localData.albums.forEach((item) => mergeItem(library.albums, item, 'album'));
                    localData.artists.forEach((item) => mergeItem(library.artists, item, 'artist'));
                    localData.playlists.forEach((item) => mergeItem(library.playlists, item, 'playlist'));
                    localData.mixes.forEach((item) => mergeItem(library.mixes, item, 'mix'));

                    localData.userPlaylists.forEach((playlist) => {
                        if (!userPlaylists[playlist.id]) {
                            userPlaylists[playlist.id] = {
                                id: playlist.id,
                                name: playlist.name,
                                cover: playlist.cover || null,
                                tracks: playlist.tracks
                                    ? playlist.tracks.map((t) => this._minifyItem('track', t))
                                    : [],
                                createdAt: playlist.createdAt || Date.now(),
                                updatedAt: playlist.updatedAt || Date.now(),
                                numberOfTracks: playlist.tracks ? playlist.tracks.length : 0,
                                images: playlist.images || [],
                                isPublic: playlist.isPublic || false,
                            };
                            needsUpdate = true;
                        }
                    });

                    localData.userFolders.forEach((folder) => {
                        if (!userFolders[folder.id]) {
                            userFolders[folder.id] = {
                                id: folder.id,
                                name: folder.name,
                                cover: folder.cover || null,
                                playlists: folder.playlists || [],
                                createdAt: folder.createdAt || Date.now(),
                                updatedAt: folder.updatedAt || Date.now(),
                            };
                            needsUpdate = true;
                        }
                    });

                    if (history.length === 0 && localData.history.length > 0) {
                        history = localData.history;
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        await this._updateUserJSON(user.uid, 'library', library);
                        await this._updateUserJSON(user.uid, 'user_playlists', userPlaylists);
                        await this._updateUserJSON(user.uid, 'user_folders', userFolders);
                        await this._updateUserJSON(user.uid, 'history', history);
                    }

                    const convertedData = {
                        favorites_tracks: Object.values(library.tracks).filter(
                            (t) => t && typeof t === 'object'
                        ),
                        favorites_albums: Object.values(library.albums).filter(
                            (a) => a && typeof a === 'object'
                        ),
                        favorites_artists: Object.values(library.artists).filter(
                            (a) => a && typeof a === 'object'
                        ),
                        favorites_playlists: Object.values(library.playlists).filter(
                            (p) => p && typeof p === 'object'
                        ),
                        favorites_mixes: Object.values(library.mixes).filter(
                            (m) => m && typeof m === 'object'
                        ),
                        history_tracks: history,
                        user_playlists: Object.values(userPlaylists).filter(
                            (p) => p && typeof p === 'object'
                        ),
                        user_folders: Object.values(userFolders).filter(
                            (f) => f && typeof f === 'object'
                        ),
                    };

                    await database.importData(convertedData);
                    await new Promise((resolve) => setTimeout(resolve, 300));

                    window.dispatchEvent(new CustomEvent('library-changed'));
                    window.dispatchEvent(new CustomEvent('history-changed'));
                    window.dispatchEvent(new HashChangeEvent('hashchange'));

                    console.log('[Supabase] ✓ Sync completed');
                }
            } catch (error) {
                console.error('[Supabase] Sync error:', error);
            } finally {
                this._isSyncing = false;
            }
        } else {
            this._userRecordCache = null;
            this._isSyncing = false;
        }
    },

    /** Log a listening event to the listening_events table for trending/analytics */
    async logListeningEvent(track) {
        const user = authManager.user;
        if (!user) return;

        // Import offline sync manager dynamically to avoid circular deps
        const { offlineSync } = await import('../offlineSync.js');
        
        // Check if online
        const isOnline = await offlineSync.checkOnline();
        
        if (!isOnline) {
            // Queue for offline sync
            await offlineSync.queueListeningEvent(track);
            return;
        }

        // Try direct insert if online
        if (!supabase) return;
        try {
            const artistName = Array.isArray(track.artists)
                ? track.artists[0]?.name || 'Unknown'
                : track.artist?.name || 'Unknown';

            const { error } = await supabase.from('listening_events').insert({
                user_id: user.uid,
                track_id: String(track.id),
                track_title: track.title || '',
                artist_name: artistName,
                album_title: track.album?.title || '',
                album_id: track.album?.id ? String(track.album.id) : null,
                genre: track.genre || null,
                duration_sec: track.duration || null,
            });

            if (error) {
                // If insert fails, queue for retry
                console.warn('[Supabase] Failed to log listening event, queuing:', error.message);
                await offlineSync.queueListeningEvent(track);
            }
        } catch (e) {
            // Network error or other issue — queue for offline sync
            console.warn('[Supabase] Listening event error, queuing:', e);
            await offlineSync.queueListeningEvent(track);
        }
    },
    _trendingCache: null,
    _trendingCacheTime: 0,
    _TRENDING_TTL: 5 * 60 * 1000,

    /** Fetch global trending data from listening_events (all users), cached for 5 min */
    async getGlobalTrending(limit = 20) {
        if (!supabase) return { tracks: [], artists: [], albums: [] };

        if (this._trendingCache && (Date.now() - this._trendingCacheTime) < this._TRENDING_TTL) {
            return this._trendingCache;
        }

        try {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from('listening_events')
                .select('track_id, track_title, artist_name, album_title, album_id')
                .gte('listened_at', sevenDaysAgo)
                .limit(2000);

            if (error || !data || data.length === 0) {
                const { data: allData, error: allErr } = await supabase
                    .from('listening_events')
                    .select('track_id, track_title, artist_name, album_title, album_id')
                    .limit(2000);
                if (allErr || !allData || allData.length === 0) return { tracks: [], artists: [], albums: [] };
                const result = this._aggregateTrending(allData, limit);
                this._trendingCache = result;
                this._trendingCacheTime = Date.now();
                return result;
            }

            const result = this._aggregateTrending(data, limit);
            this._trendingCache = result;
            this._trendingCacheTime = Date.now();
            return result;
        } catch (e) {
            console.warn('[Supabase] Failed to get global trending:', e);
            return this._trendingCache || { tracks: [], artists: [], albums: [] };
        }
    },

    _aggregateTrending(data, limit) {
        const trackCounts = {};
        const artistCounts = {};
        const albumCounts = {};

        data.forEach(e => {
            const tk = e.track_id;
            if (tk && e.track_title) {
                if (!trackCounts[tk]) trackCounts[tk] = { id: e.track_id, title: e.track_title, artist: e.artist_name, album: e.album_title, albumId: e.album_id, count: 0 };
                trackCounts[tk].count++;
            }

            const ak = e.artist_name;
            if (ak && ak !== 'Unknown') {
                if (!artistCounts[ak]) artistCounts[ak] = { name: ak, count: 0 };
                artistCounts[ak].count++;
            }

            const bk = e.album_id;
            if (bk && e.album_title) {
                if (!albumCounts[bk]) albumCounts[bk] = { id: bk, title: e.album_title, artist: e.artist_name, count: 0 };
                albumCounts[bk].count++;
            }
        });

        const topTracks = Object.values(trackCounts).sort((a, b) => b.count - a.count).slice(0, limit);
        const topArtists = Object.values(artistCounts).sort((a, b) => b.count - a.count).slice(0, 12);
        const topAlbums = Object.values(albumCounts).sort((a, b) => b.count - a.count).slice(0, 12);

        return { tracks: topTracks, artists: topArtists, albums: topAlbums };
    },
};

// Register sync manager as auth state listener
if (supabase) {
    authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));
}

export { syncManager };
