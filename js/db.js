export class MusicDatabase {
    constructor() {
        this.dbName = 'MonochromeDB';
        this.version = 14; // Bumped for page_cache store (instant page loads)
        this.db = null;
    }

    async open() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (event) => {
                console.error('Database error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Favorites stores
                if (!db.objectStoreNames.contains('favorites_tracks')) {
                    const store = db.createObjectStore('favorites_tracks', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_albums')) {
                    const store = db.createObjectStore('favorites_albums', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_artists')) {
                    const store = db.createObjectStore('favorites_artists', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_playlists')) {
                    const store = db.createObjectStore('favorites_playlists', { keyPath: 'uuid' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('favorites_mixes')) {
                    const store = db.createObjectStore('favorites_mixes', { keyPath: 'id' });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('history_tracks')) {
                    const store = db.createObjectStore('history_tracks', { keyPath: 'timestamp' });
                    store.createIndex('timestamp', 'timestamp', { unique: true });
                }
                if (!db.objectStoreNames.contains('user_playlists')) {
                    const store = db.createObjectStore('user_playlists', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('user_folders')) {
                    const store = db.createObjectStore('user_folders', { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings');
                }
                if (!db.objectStoreNames.contains('home_cache')) {
                    const store = db.createObjectStore('home_cache', { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
                // Cached audio blobs for offline / in-app downloads
                if (!db.objectStoreNames.contains('cached_audio')) {
                    db.createObjectStore('cached_audio', { keyPath: 'id' });
                }
                // Cached lyrics for offline access
                if (!db.objectStoreNames.contains('cached_lyrics')) {
                    db.createObjectStore('cached_lyrics', { keyPath: 'id' });
                }
                // Offline event queue — stores events to sync when online
                if (!db.objectStoreNames.contains('offline_events')) {
                    const store = db.createObjectStore('offline_events', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('eventType', 'eventType', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                    store.createIndex('synced', 'synced', { unique: false });
                }
                // Cached images for offline album covers + artist pictures
                if (!db.objectStoreNames.contains('cached_images')) {
                    db.createObjectStore('cached_images', { keyPath: 'id' });
                }
                // Page-level data cache for instant page loads on revisit
                if (!db.objectStoreNames.contains('page_cache')) {
                    db.createObjectStore('page_cache', { keyPath: 'key' });
                }
            };
        });
    }

    // Generic Helper
    async performTransaction(storeName, mode, callback) {
        const db = await this._getValidDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = callback(store);

            transaction.oncomplete = () => {
                resolve(request?.result);
            };
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            transaction.onabort = () => {
                reject(transaction.error || new Error('Transaction aborted'));
            };
        });
    }

    /** Return a live IDB connection, reopening if needed. */
    async _getValidDb() {
        if (this.db) {
            try {
                // Quick liveness check – if the connection was closed this throws
                this.db.transaction('settings', 'readonly');
                return this.db;
            } catch {
                this.db = null; // stale – reopen
            }
        }
        return this.open();
    }

    // History API
    async addToHistory(track) {
        const storeName = 'history_tracks';
        const minified = this._minifyItem('track', track);
        const timestamp = Date.now();
        const entry = { ...minified, timestamp };

        const db = await this.open();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const index = store.index('timestamp');

            // Check the most recent entry
            const cursorReq = index.openCursor(null, 'prev');

            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const lastTrack = cursor.value;
                    if (lastTrack.id === track.id) {
                        store.delete(cursor.primaryKey);
                    }
                }
                store.put(entry);
            };

            cursorReq.onerror = (_e) => {
                store.put(entry);
            };

            transaction.oncomplete = () => {
                resolve(entry);
            };
            transaction.onerror = (e) => {
                reject(e.target.error);
            };
        });
    }

    async getHistory() {
        const storeName = 'history_tracks';
        try {
            const db = await this.open();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readonly');
                const store = transaction.objectStore(storeName);
                const index = store.index('timestamp');
                const request = index.getAll();

                request.onsuccess = () => {
                    const result = request.result || [];
                    const history = Array.isArray(result) ? result.reverse() : [];
                    resolve(history);
                };
                request.onerror = () => {
                    resolve([]);
                };
            });
        } catch (e) {
            console.warn('[DB] Error opening database for history:', e);
            return [];
        }
    }

    async clearHistory() {
        const storeName = 'history_tracks';
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // Favorites API
    async toggleFavorite(type, item) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        const key = type === 'playlist' ? item.uuid : item.id;
        const exists = await this.isFavorite(type, key);

        if (exists) {
            await this.performTransaction(storeName, 'readwrite', (store) => store.delete(key));
            return false; // Removed
        } else {
            const minified = this._minifyItem(type, item);
            const entry = { ...minified, addedAt: Date.now() };
            await this.performTransaction(storeName, 'readwrite', (store) => store.put(entry));
            return true; // Added
        }
    }

    async isFavorite(type, id) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        try {
            const result = await this.performTransaction(storeName, 'readonly', (store) => store.get(id));
            return !!result;
        } catch {
            return false;
        }
    }

    async getFavorites(type) {
        const plural = type === 'mix' ? 'mixes' : `${type}s`;
        const storeName = `favorites_${plural}`;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);

            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result;
                results.sort((a, b) => {
                    const aTime = a.addedAt || 0;
                    const bTime = b.addedAt || 0;
                    return bTime - aTime; // Newest first
                });
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // Genre inference — the Tidal API doesn't return genre, so we infer from artist/title/album
    _inferGenre(track) {
        // 1. Check existing genre fields
        if (track.genre) return track.genre.toLowerCase();
        if (track.subGenre) return track.subGenre.toLowerCase();
        if (track.album?.genre) return track.album.genre.toLowerCase();

        // 2. Get text to match against
        const artistName = (Array.isArray(track.artists) ? track.artists[0]?.name : track.artist?.name) || '';
        const artistLower = artistName.toLowerCase().trim();
        const trackTitle = (track.title || '').toLowerCase();
        const albumTitle = (track.album?.title || '').toLowerCase();

        // 3. Artist → genre mapping (most reliable method)
        const A = MusicDatabase._ARTIST_GENRES;
        if (A[artistLower]) return A[artistLower];
        // Partial match for "Lil X", "DJ Y" style names
        for (const [key, genre] of Object.entries(A)) {
            if (artistLower.includes(key) || key.includes(artistLower)) return genre;
        }

        // 4. Keyword detection from titles
        const blob = `${trackTitle} ${albumTitle}`;
        const KW = [
            ['trap', ['trap', '808']],
            ['hip-hop', ['hip hop', 'hip-hop', 'hiphop', 'freestyle', 'cypher']],
            ['r&b', ['r&b', 'rnb', 'slow jam']],
            ['electronic', ['edm', 'techno', 'house music', 'dubstep', 'trance', 'dnb', 'drum and bass']],
            ['latin', ['reggaeton', 'reggaetón', 'bachata', 'salsa', 'cumbia', 'dembow']],
            ['afrobeats', ['afrobeat', 'amapiano', 'highlife']],
            ['country', ['country', 'bluegrass', 'nashville']],
            ['jazz', ['jazz', 'bebop', 'bossa nova']],
            ['classical', ['symphony', 'concerto', 'opus', 'sonata', 'orchestra']],
            ['reggae', ['reggae', 'dancehall', 'ska']],
            ['blues', ['blues']],
            ['metal', ['metal', 'thrash', 'death metal', 'hardcore']],
            ['rock', ['rock', 'punk', 'grunge']],
            ['folk', ['folk']],
            ['indie', ['indie', 'shoegaze', 'dream pop']],
            ['lo-fi', ['lo-fi', 'lofi', 'lo fi']],
        ];
        for (const [genre, keywords] of KW) {
            for (const kw of keywords) {
                if (blob.includes(kw)) return genre;
            }
        }

        // 5. Default to 'pop' — better than nothing, won't break mood ring
        return 'pop';
    }

    _minifyItem(type, item) {
        if (!item) return item;

        // Base properties to keep
        const base = {
            id: item.id,
            addedAt: item.addedAt || null,
        };

        if (type === 'track') {
            // Infer genre before minifying
            const genre = item.genre || this._inferGenre(item);
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                genre: genre,
                // Keep minimal artist info
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                // Keep minimal album info
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          vibrantColor: item.album.vibrantColor || null,
                          artist: item.album.artist || null,
                          numberOfTracks: item.album.numberOfTracks || null,
                          mediaMetadata: item.album.mediaMetadata ? { tags: item.album.mediaMetadata.tags } : null,
                      }
                    : null,
                copyright: item.copyright || null,
                isrc: item.isrc || null,
                trackNumber: item.trackNumber || null,
                // Fallback date
                streamStartDate: item.streamStartDate || null,
                // Keep version if exists
                version: item.version || null,
                // Keep mix info
                mixes: item.mixes || null,
                isTracker: item.isTracker || (item.id && String(item.id).startsWith('tracker-')),
                trackerInfo: item.trackerInfo || null,
                audioUrl: item.remoteUrl || item.audioUrl || null,
                remoteUrl: item.remoteUrl || null,
                audioQuality: item.audioQuality || null,
                mediaMetadata: item.mediaMetadata ? { tags: item.mediaMetadata.tags } : null,
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit || false,
                // UI uses singular 'artist'
                artist: item.artist
                    ? { name: item.artist.name || null, id: item.artist.id }
                    : item.artists?.[0]
                      ? { name: item.artists[0].name || null, id: item.artists[0].id }
                      : null,
                // Keep type and track count for UI labels
                type: item.type || null,
                numberOfTracks: item.numberOfTracks || null,
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null, // Handle both just in case
            };
        }

        if (type === 'playlist') {
            // Prefer squareImage for cover (image is often just the playlist UUID on TIDAL)
            const imageVal = item.squareImage || item.cover || null;
            // Only use item.image if it's different from the playlist uuid (not a placeholder)
            const fallbackImage = (item.image && item.image !== item.uuid && item.image !== item.id) ? item.image : null;
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || item.createdAt || null,
                title: item.title || item.name || null,
                squareImage: item.squareImage || null,
                image: imageVal || fallbackImage,
                numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
                user: item.user ? { name: item.user.name || null } : null,
            };
        }

        if (type === 'mix') {
            return {
                id: item.id,
                addedAt: item.addedAt,
                title: item.title,
                subTitle: item.subTitle,
                description: item.description,
                mixType: item.mixType,
                cover: item.cover,
            };
        }

        return item;
    }

    async exportData() {
        const tracks = await this.getFavorites('track');
        const albums = await this.getFavorites('album');
        const artists = await this.getFavorites('artist');
        const playlists = await this.getFavorites('playlist');
        const mixes = await this.getFavorites('mix');
        const history = await this.getHistory();

        const userPlaylists = await this.getPlaylists(true);
        const userFolders = await this.getFolders();
        const data = {
            favorites_tracks: tracks.map((t) => this._minifyItem('track', t)),
            favorites_albums: albums.map((a) => this._minifyItem('album', a)),
            favorites_artists: artists.map((a) => this._minifyItem('artist', a)),
            favorites_playlists: playlists.map((p) => this._minifyItem('playlist', p)),
            favorites_mixes: mixes.map((m) => this._minifyItem('mix', m)),
            history_tracks: history.map((t) => this._minifyItem('track', t)),
            user_playlists: userPlaylists,
            user_folders: userFolders,
        };
        return data;
    }

    async importData(data, clear = false) {
        const db = await this.open();

        const importStore = async (storeName, items) => {
            if (items === undefined) return false;

            let itemsArray = Array.isArray(items) ? items : Object.values(items || {});

            console.log(`Importing to ${storeName}: ${itemsArray.length} items`);

            if (itemsArray.length === 0) {
                if (clear) {
                    return new Promise((resolve, reject) => {
                        const transaction = db.transaction(storeName, 'readwrite');
                        const store = transaction.objectStore(storeName);

                        const countReq = store.count();
                        countReq.onsuccess = () => {
                            if (countReq.result > 0) {
                                store.clear();
                            }
                        };

                        transaction.oncomplete = () => {
                            resolve(countReq.result > 0);
                        };
                        transaction.onerror = () => reject(transaction.error);
                    });
                }
                return false;
            }

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                const store = transaction.objectStore(storeName);

                // force clear on first sync
                console.log(`Clearing ${storeName} to Make Sure Everythings Good`);
                store.clear();

                itemsArray.forEach((item) => {
                    if (item.id && typeof item.id === 'string' && !isNaN(item.id)) {
                        item.id = parseInt(item.id, 10);
                    }
                    if (item.album?.id && typeof item.album.id === 'string' && !isNaN(item.album.id)) {
                        item.album.id = parseInt(item.album.id, 10);
                    }
                    if (item.artists) {
                        item.artists.forEach((artist) => {
                            if (artist.id && typeof artist.id === 'string' && !isNaN(artist.id)) {
                                artist.id = parseInt(artist.id, 10);
                            }
                        });
                    }

                    console.log(`${storeName}: Adding item with ID ${item.id || item.uuid || item.timestamp}`);

                    // Critical: Ensure key exists for IndexedDB store.put()
                    const keyPath = store.keyPath;
                    if (keyPath && !item[keyPath]) {
                        console.warn(`Item missing keyPath "${keyPath}" in ${storeName}, generating fallback.`);
                        if (keyPath === 'uuid') item.uuid = crypto.randomUUID();
                        else if (keyPath === 'id')
                            item.id = item.trackId || item.albumId || item.artistId || Date.now() + Math.random();
                        else if (keyPath === 'timestamp') item.timestamp = Date.now() + Math.random();
                    }

                    store.put(item);
                });

                transaction.oncomplete = () => {
                    console.log(`${storeName}: Imported ${itemsArray.length} items`);
                    resolve(true);
                };

                transaction.onerror = (event) => {
                    console.error(`${storeName}: Transaction error:`, event.target.error);
                    reject(transaction.error);
                };
            });
        };

        console.log('Starting import with data:', {
            tracks: data.favorites_tracks?.length || 0,
            albums: data.favorites_albums?.length || 0,
            artists: data.favorites_artists?.length || 0,
            playlists: data.favorites_playlists?.length || 0,
            mixes: data.favorites_mixes?.length || 0,
            history: data.history_tracks?.length || 0,
            userPlaylists: data.user_playlists?.length || 0,
            user_folders: data.user_folders?.length || 0,
        });

        const results = await Promise.all([
            importStore('favorites_tracks', data.favorites_tracks),
            importStore('favorites_albums', data.favorites_albums),
            importStore('favorites_artists', data.favorites_artists),
            importStore('favorites_playlists', data.favorites_playlists),
            importStore('favorites_mixes', data.favorites_mixes),
            importStore('history_tracks', data.history_tracks),
            data.user_playlists ? importStore('user_playlists', data.user_playlists) : Promise.resolve(false),
            data.user_folders ? importStore('user_folders', data.user_folders) : Promise.resolve(false),
        ]);

        console.log('Import results:', results);
        return results.some((r) => r);
    }

    _updatePlaylistMetadata(playlist) {
        playlist.numberOfTracks = playlist.tracks ? playlist.tracks.length : 0;

        if (!playlist.cover) {
            const uniqueCovers = [];
            const seenCovers = new Set();
            const tracks = playlist.tracks || [];
            for (const track of tracks) {
                const cover = track.album?.cover;
                if (cover && !seenCovers.has(cover)) {
                    seenCovers.add(cover);
                    uniqueCovers.push(cover);
                    if (uniqueCovers.length >= 4) break;
                }
            }
            playlist.images = uniqueCovers;
        }
        return playlist;
    }

    _dispatchPlaylistSync(action, playlist) {
        window.dispatchEvent(
            new CustomEvent('sync-playlist-change', {
                detail: { action, playlist },
            })
        );
    }

    // User Playlists API
    async createPlaylist(name, tracks = [], cover = '') {
        const id = crypto.randomUUID();
        const playlist = {
            id: id,
            name: name,
            tracks: tracks.map((t) => this._minifyItem('track', { ...t, addedAt: Date.now() })),
            cover: cover,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            numberOfTracks: tracks.length,
            images: [], // Initialize images
        };
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        // TRIGGER SYNC
        this._dispatchPlaylistSync('create', playlist);

        return playlist;
    }

    async addTrackToPlaylist(playlistId, track) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        const trackWithDate = { ...track, addedAt: Date.now() };
        const minifiedTrack = this._minifyItem('track', trackWithDate);
        if (playlist.tracks.some((t) => t.id === track.id)) return;
        playlist.tracks.push(minifiedTrack);
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async addTracksToPlaylist(playlistId, tracks) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];

        let addedCount = 0;
        for (const track of tracks) {
            if (!playlist.tracks.some((t) => t.id === track.id)) {
                const trackWithDate = { ...track, addedAt: Date.now() };
                playlist.tracks.push(this._minifyItem('track', trackWithDate));
                addedCount++;
            }
        }

        if (addedCount > 0) {
            playlist.updatedAt = Date.now();
            this._updatePlaylistMetadata(playlist);
            await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
            this._dispatchPlaylistSync('update', playlist);
        }

        return playlist;
    }

    async removeTrackFromPlaylist(playlistId, trackId) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.tracks = playlist.tracks || [];
        playlist.tracks = playlist.tracks.filter((t) => t.id != trackId);
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async deletePlaylist(playlistId) {
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.delete(playlistId));

        // TRIGGER SYNC (but for deleting)
        this._dispatchPlaylistSync('delete', { id: playlistId });
    }

    async getPlaylist(playlistId) {
        return await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
    }

    async updatePlaylist(playlist) {
        playlist.updatedAt = Date.now();
        this._updatePlaylistMetadata(playlist);
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));

        this._dispatchPlaylistSync('update', playlist);

        return playlist;
    }

    async addPlaylistToFolder(folderId, playlistId) {
        const folder = await this.getFolder(folderId);
        if (!folder) throw new Error('Folder not found');
        folder.playlists = folder.playlists || [];
        if (!folder.playlists.includes(playlistId)) {
            folder.playlists.push(playlistId);
            folder.updatedAt = Date.now();
            await this.performTransaction('user_folders', 'readwrite', (store) => store.put(folder));
        }
        return folder;
    }

    // User Folders API
    async createFolder(name, cover = '') {
        const id = crypto.randomUUID();
        const folder = {
            id: id,
            name: name,
            cover: cover,
            playlists: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await this.performTransaction('user_folders', 'readwrite', (store) => store.put(folder));
        return folder;
    }

    async getFolders() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_folders', 'readonly');
            const store = transaction.objectStore('user_folders');
            const index = store.index('createdAt');
            const request = index.getAll();
            request.onsuccess = () => resolve(request.result.reverse());
            request.onerror = () => reject(request.error);
        });
    }

    async getFolder(id) {
        return await this.performTransaction('user_folders', 'readonly', (store) => store.get(id));
    }

    async deleteFolder(id) {
        await this.performTransaction('user_folders', 'readwrite', (store) => store.delete(id));
    }

    async getPlaylists(includeTracks = false) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_playlists', 'readwrite'); // Changed to readwrite for lazy migration
            const store = transaction.objectStore('user_playlists');
            const index = store.index('createdAt');
            const request = index.getAll();
            request.onsuccess = () => {
                const playlists = request.result.reverse(); // Newest first
                const processedPlaylists = playlists.map((playlist) => {
                    let needsUpdate = false;

                    // Lazy migration for numberOfTracks
                    if (typeof playlist.numberOfTracks === 'undefined') {
                        playlist.numberOfTracks = playlist.tracks ? playlist.tracks.length : 0;
                        needsUpdate = true;
                    }

                    // Lazy migration for images (collage)
                    if (!playlist.cover && (!playlist.images || playlist.images.length === 0)) {
                        this._updatePlaylistMetadata(playlist);
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        // We are in a readwrite transaction, so we can put back
                        try {
                            store.put(playlist);
                        } catch (e) {
                            console.warn('Failed to update playlist metadata', e);
                        }
                    }

                    if (includeTracks) {
                        return playlist;
                    }

                    // Return lightweight copy without tracks
                    // eslint-disable-next-line no-unused-vars
                    const { tracks, ...minified } = playlist;
                    return minified;
                });
                resolve(processedPlaylists);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async updatePlaylistName(playlistId, newName) {
        const playlist = await this.performTransaction('user_playlists', 'readonly', (store) => store.get(playlistId));
        if (!playlist) throw new Error('Playlist not found');
        playlist.name = newName;
        playlist.updatedAt = Date.now();
        await this.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
        return playlist;
    }

    async updatePlaylistTracks(playlistId, tracks) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('user_playlists', 'readwrite');
            const store = transaction.objectStore('user_playlists');

            const getRequest = store.get(playlistId);
            getRequest.onsuccess = () => {
                const playlist = getRequest.result;
                if (!playlist) {
                    reject(new Error('Playlist not found'));
                    return;
                }
                playlist.tracks = tracks;
                playlist.updatedAt = Date.now();
                this._updatePlaylistMetadata(playlist);
                const putRequest = store.put(playlist);
                putRequest.onsuccess = () => {
                    resolve(playlist);
                };
                putRequest.onerror = () => {
                    reject(putRequest.error);
                };
            };
            getRequest.onerror = () => {
                reject(getRequest.error);
            };

            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    async saveSetting(key, value) {
        await this.performTransaction('settings', 'readwrite', (store) => store.put(value, key));
    }

    async getSetting(key) {
        return await this.performTransaction('settings', 'readonly', (store) => store.get(key));
    }

    // Home page cache API (15-minute TTL)
    async saveHomeCache(data) {
        const entry = {
            key: 'home_content',
            data,
            timestamp: Date.now(),
        };
        await this.performTransaction('home_cache', 'readwrite', (store) => store.put(entry));
    }

    async getHomeCache() {
        const entry = await this.performTransaction('home_cache', 'readonly', (store) => store.get('home_content'));
        if (!entry) return null;
        const age = Date.now() - entry.timestamp;
        const ttl = 7 * 24 * 60 * 60 * 1000; // Soft TTL only; keep stale cache for offline resilience.
        if (age > ttl) {
            // Do not delete home cache automatically. We prefer stale-but-usable content
            // over an empty homepage when refresh fails or network is unstable.
            return entry.data;
        }
        return entry.data;
    }

    /* ── Page data cache (instant page loads) ──────────────────────── */

    async savePageCache(key, data) {
        const entry = { key, data, timestamp: Date.now() };
        await this.performTransaction('page_cache', 'readwrite', (store) => store.put(entry));
    }

    async getPageCache(key) {
        const entry = await this.performTransaction('page_cache', 'readonly', (store) => store.get(key));
        if (!entry) return null;
        const age = Date.now() - entry.timestamp;
        const ttl = 30 * 60 * 1000; // 30 minutes
        if (age > ttl && (typeof window !== 'undefined' && window.__TUNES_NATIVE__ ? true : navigator.onLine)) {
            await this.performTransaction('page_cache', 'readwrite', (store) => store.delete(key));
            return null;
        }
        return entry.data;
    }

    async clearPageCache(key) {
        if (key) {
            await this.performTransaction('page_cache', 'readwrite', (store) => store.delete(key));
        } else {
            await this.performTransaction('page_cache', 'readwrite', (store) => store.clear());
        }
    }

    /* ── Cached-audio helpers (in-app download / offline playback) ──── */

    /**
     * Store an audio Blob in IndexedDB so the track can be played offline.
     * @param {string} trackId
     * @param {Blob} blob  – the audio data
     */
    async cacheTrackBlob(trackId, blob) {
        await this.performTransaction('cached_audio', 'readwrite', (store) =>
            store.put({ id: String(trackId), blob, cachedAt: Date.now() })
        );
    }

    /**
     * Retrieve a previously cached audio Blob.
     * Returns the Blob, or null if not cached.
     */
    async getCachedTrackBlob(trackId) {
        const entry = await this.performTransaction('cached_audio', 'readonly', (store) =>
            store.get(String(trackId))
        );
        return entry ? entry.blob : null;
    }

    /**
     * Remove a single cached track (with verification & retry).
     */
    async removeCachedTrack(trackId) {
        const key = String(trackId);
        const attempt = async () => {
            const db = await this._getValidDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('cached_audio', 'readwrite');
                const store = tx.objectStore('cached_audio');
                store.delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
                tx.onabort = () => reject(tx.error || new Error('Delete transaction aborted'));
            });
        };

        // First attempt
        await attempt();

        // Verify the blob is actually gone
        const stillExists = await this.getCachedTrackBlob(trackId);
        if (stillExists) {
            // Force reopen the connection and retry
            this.db = null;
            await attempt();
        }
    }

    /**
     * Check whether a track is cached.
     */
    async isTrackCached(trackId) {
        const entry = await this.performTransaction('cached_audio', 'readonly', (store) =>
            store.get(String(trackId))
        );
        return !!entry;
    }

    /* ── Cached-lyrics helpers (offline lyrics) ──── */

    /**
     * Store lyrics data in IndexedDB for offline access.
     * @param {string} trackId
     * @param {object} lyricsData – { subtitles, lyricsProvider, ... }
     */
    async cacheLyrics(trackId, lyricsData) {
        await this.performTransaction('cached_lyrics', 'readwrite', (store) =>
            store.put({ id: String(trackId), ...lyricsData, cachedAt: Date.now() })
        );
    }

    /**
     * Retrieve cached lyrics for a track.
     * Returns the lyrics data object, or null if not cached.
     */
    async getCachedLyrics(trackId) {
        const entry = await this.performTransaction('cached_lyrics', 'readonly', (store) =>
            store.get(String(trackId))
        );
        return entry || null;
    }

    /**
     * Check whether lyrics are cached for a track.
     * Returns true only if lyrics exist AND have subtitles content.
     */
    async hasLyrics(trackId) {
        const entry = await this.performTransaction('cached_lyrics', 'readonly', (store) =>
            store.get(String(trackId))
        );
        // Verify that entry exists AND has subtitles (not just empty/null)
        return !!(entry && entry.subtitles && entry.subtitles.trim().length > 0);
    }

    /**
     * Remove cached lyrics for a track.
     */
    async removeCachedLyrics(trackId) {
        await this.performTransaction('cached_lyrics', 'readwrite', (store) =>
            store.delete(String(trackId))
        );
    }

    /* ── Cached-images helpers (offline covers + artist pics) ── */

    async cacheImage(key, blob) {
        await this.performTransaction('cached_images', 'readwrite', (store) =>
            store.put({ id: String(key), blob, cachedAt: Date.now() })
        );
    }

    async getCachedImage(key) {
        const entry = await this.performTransaction('cached_images', 'readonly', (store) =>
            store.get(String(key))
        );
        return entry ? entry.blob : null;
    }

    async removeCachedImage(key) {
        await this.performTransaction('cached_images', 'readwrite', (store) =>
            store.delete(String(key))
        );
    }

    /* ── Offline Event Queue ────────────────────────────────────── */

    /**
     * Queue an event to be synced when online.
     * @param {string} eventType - 'listening_event' | 'track_event' | 'scrobble'
     * @param {object} eventData - The event payload
     * @returns {Promise<number>} The queued event ID
     */
    async queueOfflineEvent(eventType, eventData) {
        const event = {
            eventType,
            eventData,
            createdAt: Date.now(),
            synced: false,
        };
        return await this.performTransaction('offline_events', 'readwrite', (store) =>
            store.add(event)
        );
    }

    /**
     * Get all unsynced events.
     * @returns {Promise<Array>} Array of unsynced events
     */
    static UNSYNCED_BATCH_LIMIT = 500;

    async getUnsyncedEvents() {
        const db = await this._getValidDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('offline_events', 'readonly');
            const store = transaction.objectStore('offline_events');
            const index = store.index('synced');
            const results = [];
            const request = index.openCursor(IDBKeyRange.only(false));

            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor || results.length >= MusicDatabase.UNSYNCED_BATCH_LIMIT) {
                    resolve(results);
                    return;
                }
                results.push(cursor.value);
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Mark an event as synced (or delete it).
     * @param {number} eventId - The event ID
     */
    async markEventSynced(eventId) {
        await this.performTransaction('offline_events', 'readwrite', (store) =>
            store.delete(eventId)
        );
    }

    /**
     * Get count of unsynced events.
     * @returns {Promise<number>} Count of pending events
     */
    async getUnsyncedEventCount() {
        const db = await this._getValidDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('offline_events', 'readonly');
            const store = transaction.objectStore('offline_events');
            const index = store.index('synced');
            const request = index.count(IDBKeyRange.only(false));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Clear all synced events (cleanup old data).
     * Keeps only unsynced events.
     */
    async clearSyncedEvents() {
        const db = await this._getValidDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('offline_events', 'readwrite');
            const store = transaction.objectStore('offline_events');
            const index = store.index('synced');
            const request = index.openCursor(IDBKeyRange.only(true));

            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Static artist → genre lookup used by _inferGenre
// Covers top-streamed artists across major genres so the mood ring works from song 1
MusicDatabase._ARTIST_GENRES = {
    // Hip-Hop / Rap
    'drake': 'hip-hop', 'kendrick lamar': 'hip-hop', 'j. cole': 'hip-hop',
    'kanye west': 'hip-hop', 'ye': 'hip-hop', 'jay-z': 'hip-hop',
    'eminem': 'hip-hop', 'nas': 'hip-hop', 'lil wayne': 'hip-hop',
    '50 cent': 'hip-hop', 'a$ap rocky': 'hip-hop', 'tyler, the creator': 'hip-hop',
    'mac miller': 'hip-hop', 'nipsey hussle': 'hip-hop', 'pop smoke': 'hip-hop',
    'jack harlow': 'hip-hop', 'dababy': 'hip-hop', 'megan thee stallion': 'hip-hop',
    'cardi b': 'hip-hop', 'nicki minaj': 'hip-hop', 'ice spice': 'hip-hop',
    'juice wrld': 'hip-hop', 'xxxtentacion': 'hip-hop', 'logic': 'hip-hop',
    'denzel curry': 'hip-hop', 'jid': 'hip-hop', 'joey bada$$': 'hip-hop',
    'earthgang': 'hip-hop', 'cordae': 'hip-hop', 'ski mask the slump god': 'hip-hop',
    'nba youngboy': 'hip-hop', 'youngboy never broke again': 'hip-hop',
    'lil durk': 'hip-hop', 'rod wave': 'hip-hop', 'polo g': 'hip-hop',
    'lil tecca': 'hip-hop', 'don toliver': 'hip-hop', 'larry june': 'hip-hop',
    'vince staples': 'hip-hop', 'freddie gibbs': 'hip-hop', 'pusha t': 'hip-hop',
    'baby keem': 'hip-hop', 'doechii': 'hip-hop', 'glorilla': 'hip-hop',
    'sexyy red': 'hip-hop', 'central cee': 'hip-hop', 'dave': 'hip-hop',
    'stormzy': 'hip-hop', 'little simz': 'hip-hop',
    // Trap
    'travis scott': 'trap', 'future': 'trap', 'lil baby': 'trap',
    'lil uzi vert': 'trap', 'playboi carti': 'trap', 'young thug': 'trap',
    '21 savage': 'trap', 'metro boomin': 'trap', 'gunna': 'trap',
    'offset': 'trap', 'quavo': 'trap', 'migos': 'trap',
    // R&B / Soul
    'the weeknd': 'r&b', 'sza': 'r&b', 'frank ocean': 'r&b',
    'daniel caesar': 'r&b', 'brent faiyaz': 'r&b', 'summer walker': 'r&b',
    'h.e.r.': 'r&b', 'jhené aiko': 'r&b', 'bryson tiller': 'r&b',
    'khalid': 'r&b', 'usher': 'r&b', 'chris brown': 'r&b',
    'alicia keys': 'r&b', 'john legend': 'r&b', 'kehlani': 'r&b',
    'jorja smith': 'r&b', 'snoh aalegra': 'r&b', 'giveon': 'r&b',
    'victoria monét': 'r&b', '6lack': 'r&b', 'partynextdoor': 'r&b',
    'tyla': 'r&b', 'tinashe': 'r&b', 'miguel': 'r&b',
    'beyoncé': 'r&b', 'beyonce': 'r&b',
    // Pop
    'taylor swift': 'pop', 'ariana grande': 'pop', 'billie eilish': 'pop',
    'dua lipa': 'pop', 'harry styles': 'pop', 'olivia rodrigo': 'pop',
    'ed sheeran': 'pop', 'justin bieber': 'pop', 'post malone': 'pop',
    'doja cat': 'pop', 'bruno mars': 'pop', 'lady gaga': 'pop',
    'rihanna': 'pop', 'adele': 'pop', 'sam smith': 'pop',
    'selena gomez': 'pop', 'miley cyrus': 'pop', 'katy perry': 'pop',
    'charli xcx': 'pop', 'chappell roan': 'pop', 'sabrina carpenter': 'pop',
    'tate mcrae': 'pop', 'demi lovato': 'pop', 'shawn mendes': 'pop',
    'camila cabello': 'pop', 'halsey': 'pop', 'lizzo': 'pop',
    'sia': 'pop', 'charlie puth': 'pop', 'benson boone': 'pop',
    'gracie abrams': 'pop', 'conan gray': 'pop',
    // Rock
    'foo fighters': 'rock', 'red hot chili peppers': 'rock',
    'imagine dragons': 'rock', 'twenty one pilots': 'rock',
    'linkin park': 'rock', 'green day': 'rock', 'nirvana': 'rock',
    'radiohead': 'rock', 'muse': 'rock', 'the killers': 'rock',
    'coldplay': 'rock', 'u2': 'rock', 'queen': 'rock',
    'the rolling stones': 'rock', 'led zeppelin': 'rock', 'pink floyd': 'rock',
    'ac/dc': 'rock', 'pearl jam': 'rock', 'the beatles': 'rock',
    'oasis': 'rock', 'weezer': 'rock', 'fall out boy': 'rock',
    'panic! at the disco': 'rock', 'paramore': 'rock',
    'my chemical romance': 'rock', 'blink-182': 'rock',
    // Metal
    'metallica': 'metal', 'iron maiden': 'metal', 'slipknot': 'metal',
    'avenged sevenfold': 'metal', 'tool': 'metal', 'system of a down': 'metal',
    'megadeth': 'metal', 'black sabbath': 'metal', 'bring me the horizon': 'metal',
    // Indie / Alt
    'lana del rey': 'indie', 'lorde': 'indie', 'the 1975': 'indie',
    'arctic monkeys': 'indie', 'tame impala': 'indie', 'phoebe bridgers': 'indie',
    'bon iver': 'indie', 'hozier': 'indie', 'glass animals': 'indie',
    'mac demarco': 'indie', 'clairo': 'indie', 'beabadoobee': 'indie',
    'boygenius': 'indie', 'mitski': 'indie', 'tv girl': 'indie',
    'beach house': 'indie', 'the neighbourhood': 'indie',
    'wallows': 'indie', 'dominic fike': 'indie',
    // Electronic / EDM
    'skrillex': 'electronic', 'marshmello': 'electronic', 'calvin harris': 'electronic',
    'deadmau5': 'electronic', 'avicii': 'electronic', 'tiësto': 'electronic',
    'david guetta': 'electronic', 'zedd': 'electronic', 'diplo': 'electronic',
    'flume': 'electronic', 'disclosure': 'electronic', 'kaytranada': 'electronic',
    'fred again..': 'electronic', 'fred again': 'electronic',
    'illenium': 'electronic', 'kygo': 'electronic', 'odesza': 'electronic',
    'porter robinson': 'electronic', 'madeon': 'electronic',
    'the chainsmokers': 'electronic', 'alan walker': 'electronic',
    // Latin
    'bad bunny': 'latin', 'j balvin': 'latin', 'ozuna': 'latin',
    'daddy yankee': 'latin', 'maluma': 'latin', 'rosalía': 'latin',
    'rauw alejandro': 'latin', 'feid': 'latin', 'karol g': 'latin',
    'anuel aa': 'latin', 'peso pluma': 'latin', 'shakira': 'latin',
    'luis fonsi': 'latin', 'romeo santos': 'latin', 'nicky jam': 'latin',
    // Afrobeats
    'burna boy': 'afrobeats', 'wizkid': 'afrobeats', 'davido': 'afrobeats',
    'tems': 'afrobeats', 'rema': 'afrobeats', 'ckay': 'afrobeats',
    'asake': 'afrobeats', 'ayra starr': 'afrobeats', 'fireboy dml': 'afrobeats',
    'omah lay': 'afrobeats', 'joeboy': 'afrobeats', 'ruger': 'afrobeats',
    // Country
    'morgan wallen': 'country', 'luke combs': 'country', 'chris stapleton': 'country',
    'zach bryan': 'country', 'tyler childers': 'country', 'jason aldean': 'country',
    'luke bryan': 'country', 'carrie underwood': 'country',
    'blake shelton': 'country', 'tim mcgraw': 'country', 'kenny chesney': 'country',
    'dolly parton': 'country', 'johnny cash': 'country',
    // Jazz
    'miles davis': 'jazz', 'john coltrane': 'jazz', 'kamasi washington': 'jazz',
    'robert glasper': 'jazz', 'herbie hancock': 'jazz', 'thelonious monk': 'jazz',
    'dave brubeck': 'jazz', 'chet baker': 'jazz', 'louis armstrong': 'jazz',
    // Classical
    'ludwig van beethoven': 'classical', 'mozart': 'classical', 'bach': 'classical',
    'vivaldi': 'classical', 'chopin': 'classical', 'debussy': 'classical',
    'tchaikovsky': 'classical', 'yo-yo ma': 'classical', 'lang lang': 'classical',
    // Reggae
    'bob marley': 'reggae', 'bob marley & the wailers': 'reggae',
    'sean paul': 'reggae', 'shaggy': 'reggae', 'damian marley': 'reggae',
    // Blues
    'b.b. king': 'blues', 'muddy waters': 'blues', 'john mayer': 'blues',
    'gary clark jr.': 'blues',
    // Lo-fi
    'nujabes': 'lo-fi',
    // Ethiopian / East African
    'teddy afro': 'afrobeats', 'aster aweke': 'afrobeats',
    'tilahun gessesse': 'afrobeats', 'mahmoud ahmed': 'afrobeats',
    'mulatu astatke': 'jazz', 'rophnan': 'electronic',
    'the weeknd': 'r&b', // Ethiopian-Canadian
};

export const db = new MusicDatabase();