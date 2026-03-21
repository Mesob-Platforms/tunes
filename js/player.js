//js/player.js
import { MediaPlayer } from 'dashjs';
import {
    REPEAT_MODE,
    formatTime,
    getTrackArtists,
    getTrackTitle,
    getTrackArtistsHTML,
    getTrackYearDisplay,
    createQualityBadgeHTML,
} from './utils.js';
import { queueManager, trackDateSettings, crossfadeSettings } from './storage.js';
import { showNotification } from './downloads.js';
import { audioContextManager } from './audio-context.js';
import { db } from './db.js';
import { isOnline } from './networkMonitor.js';
import { apiUrl } from './platform.js';
import { onTrackChanged, pushNowPlaying } from './mediaBridge.js';
import { isNative } from './platform.js';

export class Player {
    constructor(audioElement, api, quality = 'HI_RES_LOSSLESS') {
        this.audio = audioElement;
        this.api = api;
        this.quality = quality;
        this.queue = [];
        this.shuffledQueue = [];
        this.originalQueueBeforeShuffle = [];
        this.currentQueueIndex = -1;
        this.shuffleActive = false;
        this.repeatMode = REPEAT_MODE.OFF;
        this.preloadCache = new Map();
        this.preloadAbortController = null;
        this.currentTrack = null;
        this.userVolume = parseFloat(localStorage.getItem('volume') || '0.7');
        this.isFallbackRetry = false;
        this._playRetryCount = 0;
        this._maxPlayRetries = 15;

        // Crossfade properties
        this._isCrossfading = false;
        this._isFadingIn = false;
        this._crossfadeVolumeFactor = 1;
        this._crossfadeRaf = null;
        this._lastBlobUrl = null;

        this.dashPlayer = MediaPlayer().create();
        this.dashPlayer.updateSettings({
            streaming: {
                buffer: { fastSwitchEnabled: true },
            },
        });
        this._dashErrorCount = 0;
        this.dashPlayer.on('error', (e) => {
            console.error('[DASH] Error event:', e);
            this._dashErrorCount++;
            if (this._dashErrorCount > 2) {
                this._dashErrorCount = 0;
                if (this.audio && !this.audio.paused) this.audio.pause();
                this.audio.dispatchEvent(new Event('error'));
            }
        });
        this.dashPlayer.on('playbackError', (e) => {
            console.error('[DASH] Playback error:', e);
            if (this.audio && !this.audio.paused) this.audio.pause();
            this.audio.dispatchEvent(new Event('error'));
        });
        this.dashInitialized = false;

        this.loadQueueState();
        this.setupMediaSession();

        window.addEventListener('beforeunload', () => {
            this.saveQueueState();
        });

        // Handle visibility change for iOS - AudioContext gets suspended when screen locks
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.audio.paused) {
                // Ensure audio context is resumed when user returns to the app
                if (!audioContextManager.isReady()) {
                    audioContextManager.init(this.audio);
                }
                audioContextManager.resume();
            }
        });
    }

    async _setNowPlayingCover(track) {
        const coverEl = document.querySelector('.now-playing-bar .cover');
        if (!coverEl) return;
        const coverId = track?.album?.cover || track?.cover;
        if (!coverId) {
            coverEl.src = 'assets/everywhere.png';
            return;
        }

        try {
            await db.open();
            const key = `cover-${String(coverId).replace(/\//g, '-')}`;
            let cached = await db.getCachedImage(key);
            if (!cached) cached = await db.getCachedImage(`cover-${coverId}`);
            if (cached) {
                coverEl.src = URL.createObjectURL(cached);
                return;
            }
        } catch (e) { /* ignore */ }

        if (!isOnline()) {
            coverEl.src = 'assets/everywhere.png';
            return;
        }

        const directUrl = this.api.getCoverUrl(coverId);
        coverEl.src = directUrl;
        coverEl.onerror = () => {
            coverEl.onerror = null;
            coverEl.src = apiUrl(`/api/image-proxy?url=${encodeURIComponent(directUrl)}`);
        };
    }

    setVolume(value) {
        this.userVolume = Math.max(0, Math.min(1, value));
        localStorage.setItem('volume', this.userVolume);
        this.applyReplayGain();
    }

    applyReplayGain() {
        const effectiveVolume = this.userVolume * this._crossfadeVolumeFactor;
        this.audio.volume = Math.max(0, Math.min(1, effectiveVolume));
    }

    loadQueueState() {
        const savedState = queueManager.getQueue();
        if (savedState) {
            this.queue = savedState.queue || [];
            this.shuffledQueue = savedState.shuffledQueue || [];
            this.originalQueueBeforeShuffle = savedState.originalQueueBeforeShuffle || [];
            this.currentQueueIndex = savedState.currentQueueIndex ?? -1;
            this.shuffleActive = savedState.shuffleActive || false;
            this.repeatMode = savedState.repeatMode !== undefined ? savedState.repeatMode : REPEAT_MODE.OFF;

            // Restore current track if queue exists and index is valid
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
            if (this.currentQueueIndex >= 0 && this.currentQueueIndex < currentQueue.length) {
                this.currentTrack = currentQueue[this.currentQueueIndex];

                // Restore UI
                const track = this.currentTrack;
                const trackTitle = getTrackTitle(track);
                const trackArtistsHTML = getTrackArtistsHTML(track);
                const yearDisplay = getTrackYearDisplay(track);

                const coverEl = document.querySelector('.now-playing-bar .cover');
                const titleEl = document.querySelector('.now-playing-bar .title');
                const albumEl = document.querySelector('.now-playing-bar .album');
                const artistEl = document.querySelector('.now-playing-bar .artist');

                this._setNowPlayingCover(track);
                if (titleEl) {
                    const qualityBadge = createQualityBadgeHTML(track);
                    titleEl.innerHTML = `${trackTitle} ${qualityBadge}`;
                }
                if (albumEl) {
                    const albumTitle = track.album?.title || '';
                    if (albumTitle && albumTitle !== trackTitle) {
                        albumEl.textContent = albumTitle;
                        albumEl.style.display = 'block';
                    } else {
                        albumEl.textContent = '';
                        albumEl.style.display = 'none';
                    }
                }
                if (artistEl) artistEl.innerHTML = trackArtistsHTML + yearDisplay;

                // Always fetch album release date in background to ensure we have the correct year
                // (even if yearDisplay exists, it might be from streamStartDate which is wrong)
                if (track.album?.id) {
                    this.loadAlbumYear(track, trackArtistsHTML, artistEl);
                }

                const mixBtn = document.getElementById('now-playing-mix-btn');
                if (mixBtn) {
                    mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
                }
                const totalDurationEl = document.getElementById('total-duration');
                if (totalDurationEl) totalDurationEl.textContent = formatTime(track.duration);
                document.title = `${trackTitle} • ${getTrackArtists(track)}`;

                this.updatePlayingTrackIndicator();
                this.updateMediaSession(track);
            }
        }
    }

    saveQueueState() {
        queueManager.saveQueue({
            queue: this.queue,
            shuffledQueue: this.shuffledQueue,
            originalQueueBeforeShuffle: this.originalQueueBeforeShuffle,
            currentQueueIndex: this.currentQueueIndex,
            shuffleActive: this.shuffleActive,
            repeatMode: this.repeatMode,
        });

        if (window.renderQueueFunction) {
            window.renderQueueFunction();
        }
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        // On native Android, the Java AudioForegroundService owns the MediaSession.
        // Setting up a SECOND session here causes Android's MediaSessionManager to
        // conflict: it deactivates the WebView session, firing a 'pause' callback
        // that kills audio within ~100ms of starting. Skip entirely on native.
        if (isNative) return;

        navigator.mediaSession.setActionHandler('play', async () => {
            if (!audioContextManager.isReady()) {
                audioContextManager.init(this.audio);
            }
            await audioContextManager.resume();

            try {
                await this.audio.play();
            } catch (e) {
                console.error('MediaSession play failed:', e);
                this.handlePlayPause();
            }
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            this.audio.pause();
        });

        navigator.mediaSession.setActionHandler('previoustrack', async () => {
            if (!audioContextManager.isReady()) {
                audioContextManager.init(this.audio);
            }
            await audioContextManager.resume();
            this.playPrev();
        });

        navigator.mediaSession.setActionHandler('nexttrack', async () => {
            if (!audioContextManager.isReady()) {
                audioContextManager.init(this.audio);
            }
            await audioContextManager.resume();
            this.playNext();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekBackward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 10;
            this.seekForward(skipTime);
        });

        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined) {
                this.audio.currentTime = Math.max(0, details.seekTime);
                this.updateMediaSessionPositionState();
            }
        });

        navigator.mediaSession.setActionHandler('stop', () => {
            this.audio.pause();
            this.audio.currentTime = 0;
            this.updateMediaSessionPlaybackState();
        });
    }

    setQuality(quality) {
        this.quality = quality;
    }

    async preloadNextTracks() {
        if (!isOnline()) return;

        if (this.preloadAbortController) {
            this.preloadAbortController.abort();
        }

        this.preloadAbortController = new AbortController();
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const tracksToPreload = [];

        for (let i = 1; i <= 2; i++) {
            const nextIndex = this.currentQueueIndex + i;
            if (nextIndex < currentQueue.length) {
                tracksToPreload.push({ track: currentQueue[nextIndex], index: nextIndex });
            }
        }

        for (const { track } of tracksToPreload) {
            if (this.preloadCache.has(track.id)) continue;
            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));
            if (track.isLocal || isTracker || (track.audioUrl && !track.isLocal)) continue;
            try {
                const [streamUrl] = await Promise.all([
                    this.api.getStreamUrl(track.id, this.quality),
                    this.api.getTrack(track.id, this.quality).catch(() => null),
                ]);

                if (this.preloadAbortController.signal.aborted) break;

                this.preloadCache.set(track.id, streamUrl);
                if (!streamUrl.startsWith('blob:')) {
                    fetch(streamUrl, { method: 'HEAD', signal: this.preloadAbortController.signal }).catch(() => {});
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    // preload failed silently
                }
            }
        }
    }

    _stopCurrentPlayback() {
        if (!this.audio.paused) this.audio.pause();
        this.audio.currentTime = 0;
        if (this.dashInitialized) {
            this.dashPlayer.reset();
            this.dashInitialized = false;
        }
    }

    async playTrackFromQueue(startTime = 0, recursiveCount = 0) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (this.currentQueueIndex < 0 || this.currentQueueIndex >= currentQueue.length) {
            return;
        }

        this._stopCurrentPlayback();

        this._playGeneration = (this._playGeneration || 0) + 1;
        const gen = this._playGeneration;

        const wasCrossfading = this._isCrossfading;
        if (wasCrossfading) {
            if (this._crossfadeRaf) {
                cancelAnimationFrame(this._crossfadeRaf);
                this._crossfadeRaf = null;
            }
        } else {
            this.cancelCrossfade();
        }
        this._playRetryCount = 0;
        this._dashErrorCount = 0;
        if (!wasCrossfading) {
            this.audio.volume = this.userVolume;
        }

        const track = currentQueue[this.currentQueueIndex];
        if (track.isUnavailable) {
            track.isUnavailable = false;
        }

        this.saveQueueState();

        this.currentTrack = track;

        const trackTitle = getTrackTitle(track);
        const trackArtistsHTML = getTrackArtistsHTML(track);
        const yearDisplay = getTrackYearDisplay(track);

        // Show now-playing bar on first play (slide-up)
        const npBar = document.querySelector('.now-playing-bar');
        if (npBar && !npBar.classList.contains('npb-visible')) {
            npBar.style.display = '';          // remove inline display:none
            npBar.classList.add('npb-visible');
            npBar.dataset.hasTrack = 'true';
        }

        this._setNowPlayingCover(track);
        document.querySelector('.now-playing-bar .title').innerHTML = `${trackTitle} ${createQualityBadgeHTML(track)}`;
        const albumEl = document.querySelector('.now-playing-bar .album');
        if (albumEl) {
            const albumTitle = track.album?.title || '';
            if (albumTitle && albumTitle !== trackTitle) {
                albumEl.textContent = albumTitle;
                albumEl.style.display = 'block';
            } else {
                albumEl.textContent = '';
                albumEl.style.display = 'none';
            }
        }
        const artistEl = document.querySelector('.now-playing-bar .artist');
        artistEl.innerHTML = trackArtistsHTML + yearDisplay;

        // Always fetch album release date in background to ensure we have the correct year
        // (even if yearDisplay exists, it might be from streamStartDate which is wrong)
        if (track.album?.id) {
            this.loadAlbumYear(track, trackArtistsHTML, artistEl);
        }

        const mixBtn = document.getElementById('now-playing-mix-btn');
        if (mixBtn) {
            mixBtn.style.display = track.mixes && track.mixes.TRACK_MIX ? 'flex' : 'none';
        }
        document.title = `${trackTitle} • ${getTrackArtists(track)}`;

        this.updatePlayingTrackIndicator();
        this.updateMediaSession(track);
        this.updateMediaSessionPlaybackState();

        const isOffline = !isOnline();
        try {
            const cachedBlob = await db.getCachedTrackBlob(track.id);
            if (gen !== this._playGeneration) return;
            if (cachedBlob) {
                if (this.dashInitialized) {
                    this.dashPlayer.reset();
                    this.dashInitialized = false;
                }
                const blobUrl = URL.createObjectURL(cachedBlob);
                await this._setSourceAndPlay(blobUrl, startTime);
                if (gen !== this._playGeneration) return;
                this.preloadNextTracks();
                return;
            }
        } catch (cacheErr) {
            console.warn('Cache lookup failed:', cacheErr);
        }

        if (isOffline) {
            const { showNotification } = await import('./downloads.js');
            showNotification('Track not available offline');
            return;
        }

        try {
            let streamUrl;

            const isTracker = track.isTracker || (track.id && String(track.id).startsWith('tracker-'));

            if (isTracker || (track.audioUrl && !track.isLocal)) {
                if (this.dashInitialized) {
                    this.dashPlayer.reset();
                    this.dashInitialized = false;
                }
                streamUrl = track.audioUrl;

                if (
                    (!streamUrl || (typeof streamUrl === 'string' && streamUrl.startsWith('blob:'))) &&
                    track.remoteUrl
                ) {
                    streamUrl = track.remoteUrl;
                }

                if (!streamUrl) {
                    throw new Error(`Track ${trackTitle} audio URL is missing`);
                }

                if (isTracker && !streamUrl.startsWith('blob:') && streamUrl.startsWith('http')) {
                    try {
                        const response = await fetch(streamUrl);
                        if (gen !== this._playGeneration) return;
                        if (response.ok) {
                            const blob = await response.blob();
                            if (gen !== this._playGeneration) return;
                            streamUrl = URL.createObjectURL(blob);
                        }
                    } catch (e) {
                        console.warn('Failed to fetch tracker blob, trying direct link', e);
                    }
                }

                await this._setSourceAndPlay(streamUrl, startTime);
                if (gen !== this._playGeneration) return;
            } else if (track.isLocal && track.file) {
                if (this.dashInitialized) {
                    this.dashPlayer.reset();
                    this.dashInitialized = false;
                }
                streamUrl = URL.createObjectURL(track.file);
                await this._setSourceAndPlay(streamUrl, startTime);
            } else {
                if (this.dashInitialized) {
                    this.dashPlayer.reset();
                    this.dashInitialized = false;
                }

                const trackData = await this.api.getTrack(track.id, this.quality);
                if (gen !== this._playGeneration) return;

                if (this.preloadCache.has(track.id)) {
                    streamUrl = this.preloadCache.get(track.id);
                } else if (trackData.originalTrackUrl) {
                    streamUrl = trackData.originalTrackUrl;
                } else {
                    streamUrl = this.api.extractStreamUrlFromManifest(trackData.info.manifest);
                }

                if (!streamUrl) {
                    throw new Error('No stream URL available for this track');
                }

                // ═══════════════════════════════════════════════════════
                //  NATIVE ANDROID: WebView has no MSE, so DASH.js is
                //  useless. Download all DASH segments into one audio
                //  blob, cache it, then play from the blob.
                // ═══════════════════════════════════════════════════════
                if (isNative) {
                    if (streamUrl && streamUrl.startsWith('blob:')) {
                        const { DashDownloader } = await import('./dash-downloader.js');
                        if (gen !== this._playGeneration) return;
                        const downloader = new DashDownloader();
                        const audioBlob = await downloader.downloadDashStream(streamUrl);
                        if (gen !== this._playGeneration) return;
                        try { await db.cacheTrackBlob(track.id, audioBlob); } catch (ce) { console.warn('Auto-cache failed:', ce); }
                        streamUrl = URL.createObjectURL(audioBlob);
                    } else if (!streamUrl) {
                        throw new Error('No stream URL available');
                    }

                    await this._setSourceAndPlay(streamUrl, startTime);
                    if (gen !== this._playGeneration) return;
                    if (gen !== this._playGeneration) return;
                } else {
                    if (streamUrl && streamUrl.startsWith('blob:')) {
                        try {
                            this._trackBlobUrl(streamUrl);
                            if (this.dashInitialized) {
                                this.dashPlayer.attachSource(streamUrl);
                            } else {
                                this.dashPlayer.initialize(this.audio, streamUrl, false);
                                this.dashInitialized = true;
                            }

                            await this._waitForCanPlay(8000);
                            if (gen !== this._playGeneration) return;

                            if (startTime > 0) this.dashPlayer.seek(startTime);
                            await this.audio.play();
                        } catch (dashError) {
                            console.warn('DASH playback failed, falling back:', dashError);
                            if (this.dashInitialized) {
                                this.dashPlayer.reset();
                                this.dashInitialized = false;
                            }
                            const fallbackUrl = await this.api.getStreamUrl(track.id, 'LOSSLESS');
                            if (fallbackUrl && !fallbackUrl.startsWith('blob:')) {
                                streamUrl = fallbackUrl;
                            } else {
                                throw new Error('DASH and fallback both failed');
                            }
                        }
                    }

                    if (!this.dashInitialized) {
                        await this._setSourceAndPlay(streamUrl, startTime);
                        if (gen !== this._playGeneration) return;
                    }
                }
            }

            this._playRetryCount = 0;
            if (gen !== this._playGeneration) return;
            this.preloadNextTracks();
        } catch (error) {
            console.error(`Could not play track: ${trackTitle}`, error);

            if (error?.name === 'NotAllowedError' || error?.message?.includes('NotAllowedError')) {
                console.warn('Autoplay blocked - waiting for user interaction');
                this._playRetryCount = 0;
                return;
            }

            if (gen !== this._playGeneration) return;

            // Invalidate cached stream URLs so retry fetches fresh ones
            if (track?.id) {
                this.preloadCache.delete(track.id);
                this.api.clearStreamCache(track.id);
                this.api.cache.delete('track', `${track.id}_${this.quality}`);
            }

            this._playRetryCount++;
            if (this._playRetryCount > this._maxPlayRetries) {
                this._playRetryCount = 0;
                showNotification(`Couldn't play "${trackTitle}" after multiple attempts.`);
                return;
            }
            const retryDelay = Math.min(this._playRetryCount * 2000, 8000);
            if (this._playRetryCount === 1) {
                showNotification(`Loading "${trackTitle}"…`);
            }
            console.warn(`Retrying "${trackTitle}" (attempt ${this._playRetryCount}/${this._maxPlayRetries}) in ${retryDelay / 1000}s...`);
            setTimeout(() => {
                if (gen !== this._playGeneration) return;
                this.playTrackFromQueue(startTime, recursiveCount);
            }, retryDelay);
        }
    }

    _trackBlobUrl(url) {
        if (url && url.startsWith('blob:')) {
            if (this._lastBlobUrl && this._lastBlobUrl !== url) {
                try { URL.revokeObjectURL(this._lastBlobUrl); } catch {}
            }
            this._lastBlobUrl = url;
        }
    }

    async _setSourceAndPlay(url, startTime = 0) {
        this._trackBlobUrl(url);
        this.applyReplayGain();
        this.audio.src = url;
        this.audio.load();
        await this._waitForCanPlay(8000);
        if (startTime > 0) this.audio.currentTime = startTime;
        await this.audio.play();
    }

    _waitForCanPlay(timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            if (this.audio.readyState >= 3) { resolve(); return; }
            const cleanup = () => {
                this.audio.removeEventListener('canplay', onReady);
                this.audio.removeEventListener('loadeddata', onReady);
                this.audio.removeEventListener('error', onErr);
                clearTimeout(tid);
            };
            const onReady = () => { cleanup(); resolve(); };
            const onErr = (e) => { cleanup(); reject(e); };
            this.audio.addEventListener('canplay', onReady);
            this.audio.addEventListener('loadeddata', onReady);
            this.audio.addEventListener('error', onErr);
            const tid = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for audio to load')); }, timeoutMs);
        });
    }

    playAtIndex(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        if (index >= 0 && index < currentQueue.length) {
            this.currentQueueIndex = index;
            this.playTrackFromQueue(0, 0);
        }
    }

    async playNext() {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const isLastTrack = this.currentQueueIndex >= currentQueue.length - 1;

        if (this.repeatMode === REPEAT_MODE.ONE && !currentQueue[this.currentQueueIndex]?.isUnavailable) {
            this.playTrackFromQueue(0, 0);
            return;
        }

        const maxSkips = Math.min(currentQueue.length, 50);
        let skipped = 0;

        const advance = () => {
            if (!isLastTrack || this.repeatMode === REPEAT_MODE.ALL) {
                this.currentQueueIndex = (this.currentQueueIndex + 1) % currentQueue.length;
            }
        };

        advance();
        while (currentQueue[this.currentQueueIndex]?.isUnavailable && skipped < maxSkips) {
            skipped++;
            this.currentQueueIndex = (this.currentQueueIndex + 1) % currentQueue.length;
        }

        if (skipped >= maxSkips) {
            console.error('All tracks in queue are unavailable.');
            this.audio.pause();
            return;
        }

        if (isLastTrack && this.repeatMode !== REPEAT_MODE.ALL && skipped === 0) {
            // Smart Queue: try to auto-add related tracks when queue ends
            try {
                const lastTrack = currentQueue[this.currentQueueIndex];
                if (lastTrack?.mixes?.TRACK_MIX) {
                    const mixData = await this.api.getMix(lastTrack.mixes.TRACK_MIX);
                    if (mixData?.tracks?.length > 0) {
                        const existingIds = new Set(currentQueue.map(t => t.id));
                        const newTracks = mixData.tracks.filter(t => !existingIds.has(t.id));
                        if (newTracks.length > 0) {
                            this.queue.push(...newTracks);
                            if (this.shuffleActive) {
                                this.shuffledQueue.push(...newTracks);
                                this.originalQueueBeforeShuffle.push(...newTracks);
                            }
                            this.currentQueueIndex++;
                            this.saveQueueState();
                            this.playTrackFromQueue(0, 0);
                            return;
                        }
                    }
                }
            } catch (e) {
                console.warn('Smart queue: failed to fetch related tracks', e);
            }
            return;
        }

        this.playTrackFromQueue(0, 0);
    }

    playPrev() {
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            this.updateMediaSessionPositionState();
        } else if (this.currentQueueIndex > 0) {
            const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
            const maxSkips = Math.min(currentQueue.length, 50);
            let skipped = 0;
            this.currentQueueIndex--;
            while (currentQueue[this.currentQueueIndex]?.isUnavailable && skipped < maxSkips && this.currentQueueIndex > 0) {
                skipped++;
                this.currentQueueIndex--;
            }
            if (currentQueue[this.currentQueueIndex]?.isUnavailable) {
                console.error('All previous tracks are unavailable.');
                this.audio.pause();
                return;
            }
            this.playTrackFromQueue(0, 0);
        }
    }

    handlePlayPause() {
        if (!this.audio.src || this.audio.error) {
            if (this.currentTrack) {
                this.playTrackFromQueue(0, 0);
            }
            return;
        }

        if (this.audio.paused) {
            this.audio.play().catch((e) => {
                if (e.name === 'NotAllowedError' || e.name === 'AbortError') return;
                console.error('Play failed, reloading track:', e);
                if (this.currentTrack) {
                    this.playTrackFromQueue(0, 0);
                }
            });
        } else {
            this.audio.pause();
            this.saveQueueState();
        }
    }

    seekBackward(seconds = 10) {
        const newTime = Math.max(0, this.audio.currentTime - seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    seekForward(seconds = 10) {
        const duration = this.audio.duration || 0;
        const newTime = Math.min(duration, this.audio.currentTime + seconds);
        this.audio.currentTime = newTime;
        this.updateMediaSessionPositionState();
    }

    toggleShuffle() {
        this.shuffleActive = !this.shuffleActive;

        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle = [...this.queue];
            const currentTrack = this.queue[this.currentQueueIndex];

            const tracksToShuffle = [...this.queue];
            if (currentTrack && this.currentQueueIndex >= 0) {
                tracksToShuffle.splice(this.currentQueueIndex, 1);
            }

            for (let i = tracksToShuffle.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [tracksToShuffle[i], tracksToShuffle[j]] = [tracksToShuffle[j], tracksToShuffle[i]];
            }

            if (currentTrack) {
                this.shuffledQueue = [currentTrack, ...tracksToShuffle];
                this.currentQueueIndex = 0;
            } else {
                this.shuffledQueue = tracksToShuffle;
                this.currentQueueIndex = -1;
            }
        } else {
            const currentTrack = this.shuffledQueue[this.currentQueueIndex];
            this.queue = [...this.originalQueueBeforeShuffle];
            this.currentQueueIndex = this.queue.findIndex((t) => t.id === currentTrack?.id);
        }

        this.preloadCache.clear();
        this.preloadNextTracks();
        this.saveQueueState();
    }

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        this.saveQueueState();
        return this.repeatMode;
    }

    setQueue(tracks, startIndex = 0) {
        this.queue = tracks;
        this.currentQueueIndex = startIndex;
        this.shuffleActive = false;
        this.preloadCache.clear();
        this.saveQueueState();
    }

    async playWithMix(track) {
        this.setQueue([track], 0);
        this.playTrackFromQueue();

        if (track.mixes?.TRACK_MIX) {
            try {
                const mixData = await this.api.getMix(track.mixes.TRACK_MIX);
                if (mixData?.tracks?.length > 0) {
                    const mixTracks = mixData.tracks.filter(t => t.id !== track.id);
                    if (mixTracks.length > 0) {
                        this.queue.push(...mixTracks);
                        this.saveQueueState();
                    }
                }
            } catch (e) {
                console.warn('Failed to load track mix for queue:', e);
            }
        }
    }

    addToQueue(trackOrTracks) {
        const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
        this.queue.push(...tracks);

        if (this.shuffleActive) {
            this.shuffledQueue.push(...tracks);
            this.originalQueueBeforeShuffle.push(...tracks);
        }

        if (!this.currentTrack || this.currentQueueIndex === -1) {
            this.currentQueueIndex = this.getCurrentQueue().length - tracks.length;
            this.playTrackFromQueue(0, 0);
        }
        this.saveQueueState();
    }

    addNextToQueue(trackOrTracks) {
        const tracks = Array.isArray(trackOrTracks) ? trackOrTracks : [trackOrTracks];
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;
        const insertIndex = this.currentQueueIndex + 1;

        // Insert after current track
        currentQueue.splice(insertIndex, 0, ...tracks);

        // If we are shuffling, we might want to also add it to the original queue for consistency,
        // though syncing that is tricky. The standard logic often just appends to the active queue view.
        if (this.shuffleActive) {
            this.originalQueueBeforeShuffle.push(...tracks); // Sync original queue
        }

        this.saveQueueState();
        this.preloadNextTracks(); // Update preload since next track changed
    }

    removeFromQueue(index) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        // If removing current track
        if (index === this.currentQueueIndex) {
            // If playing, we might want to stop or just let it finish?
            // For now, let's just remove it.
            // If it's the last track, playback will stop naturally or we handle it?
        }

        if (index < this.currentQueueIndex) {
            this.currentQueueIndex--;
        }

        const removedTrack = currentQueue.splice(index, 1)[0];

        if (this.shuffleActive) {
            // Also remove from original queue
            const originalIndex = this.originalQueueBeforeShuffle.findIndex((t) => t.id === removedTrack.id); // Simple ID check
            if (originalIndex !== -1) {
                this.originalQueueBeforeShuffle.splice(originalIndex, 1);
            }
        }

        this.saveQueueState();
        this.preloadNextTracks();
    }

    clearQueue() {
        if (this.currentTrack) {
            this.queue = [this.currentTrack];

            if (this.shuffleActive) {
                this.shuffledQueue = [this.currentTrack];
                this.originalQueueBeforeShuffle = [this.currentTrack];
            } else {
                this.shuffledQueue = [];
                this.originalQueueBeforeShuffle = [];
            }
            this.currentQueueIndex = 0;
        } else {
            this.queue = [];
            this.shuffledQueue = [];
            this.originalQueueBeforeShuffle = [];
            this.currentQueueIndex = -1;
        }

        this.preloadCache.clear();
        this.saveQueueState();
    }

    moveInQueue(fromIndex, toIndex) {
        const currentQueue = this.shuffleActive ? this.shuffledQueue : this.queue;

        if (fromIndex < 0 || fromIndex >= currentQueue.length) return;
        if (toIndex < 0 || toIndex >= currentQueue.length) return;

        const [track] = currentQueue.splice(fromIndex, 1);
        currentQueue.splice(toIndex, 0, track);

        if (this.currentQueueIndex === fromIndex) {
            this.currentQueueIndex = toIndex;
        } else if (fromIndex < this.currentQueueIndex && toIndex >= this.currentQueueIndex) {
            this.currentQueueIndex--;
        } else if (fromIndex > this.currentQueueIndex && toIndex <= this.currentQueueIndex) {
            this.currentQueueIndex++;
        }
        this.saveQueueState();
    }

    getCurrentQueue() {
        return this.shuffleActive ? this.shuffledQueue : this.queue;
    }

    getNextTrack() {
        const currentQueue = this.getCurrentQueue();
        if (this.currentQueueIndex === -1 || currentQueue.length === 0) return null;

        const nextIndex = this.currentQueueIndex + 1;
        if (nextIndex < currentQueue.length) {
            return currentQueue[nextIndex];
        } else if (this.repeatMode === REPEAT_MODE.ALL) {
            return currentQueue[0];
        }
        return null;
    }

    loadAlbumYear(track, trackArtistsHTML, artistEl) {
        // Always fetch album year to ensure accuracy (don't check useAlbumYear setting)
        this.api
            .getAlbum(track.album.id)
            .then(({ album }) => {
                if (album?.releaseDate && this.currentTrack?.id === track.id && artistEl) {
                    track.album.releaseDate = album.releaseDate;
                    const date = new Date(album.releaseDate);
                    const year = date.getFullYear();
                    // Validate the year is reasonable before displaying
                    if (!isNaN(date.getTime()) && year >= 1900 && year <= new Date().getFullYear() + 1) {
                        artistEl.innerHTML = `${trackArtistsHTML} • ${year}`;
                    }
                }
            })
            .catch(() => {});
    }

    updatePlayingTrackIndicator() {
        const currentTrack = this.getCurrentQueue()[this.currentQueueIndex];
        document.querySelectorAll('.track-item').forEach((item) => {
            item.classList.toggle('playing', currentTrack && item.dataset.trackId == currentTrack.id);
        });

        document.querySelectorAll('.queue-track-item').forEach((item) => {
            const index = parseInt(item.dataset.queueIndex);
            item.classList.toggle('playing', index === this.currentQueueIndex);
        });
    }

    updateMediaSession(track) {
        // On native, skip WebView MediaSession entirely — Java service handles it
        if (!isNative && 'mediaSession' in navigator) {
            navigator.mediaSession.metadata = null;

            const artwork = [];
            const sizes = ['320'];
            const coverId = track.album?.cover;
            const trackTitle = getTrackTitle(track);

            if (coverId) {
                sizes.forEach((size) => {
                    artwork.push({
                        src: this.api.getCoverUrl(coverId, size),
                        sizes: `${size}x${size}`,
                        type: 'image/jpeg',
                    });
                });
            }

            navigator.mediaSession.metadata = new MediaMetadata({
                title: trackTitle || 'Unknown Title',
                artist: getTrackArtists(track) || 'Unknown Artist',
                album: track.album?.title || 'Unknown Album',
                artwork: artwork.length > 0 ? artwork : undefined,
            });

            this.updateMediaSessionPlaybackState();
            this.updateMediaSessionPositionState();
        }

        // Push track metadata to native foreground service (Android)
        onTrackChanged();
    }

    updateMediaSessionPlaybackState() {
        if (!isNative && 'mediaSession' in navigator) {
            navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
        }
        pushNowPlaying();
    }

    updateMediaSessionPositionState() {
        if (isNative) return;
        if (!('mediaSession' in navigator)) return;
        if (!('setPositionState' in navigator.mediaSession)) return;

        const duration = this.audio.duration;

        if (!duration || isNaN(duration) || !isFinite(duration)) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: this.audio.playbackRate || 1,
                position: Math.min(this.audio.currentTime, duration),
            });
        } catch (error) {
            console.log('Failed to update Media Session position:', error);
        }
    }

    // ── Crossfade Methods ──

    /**
     * Begin fading out the current track. Called from events.js when
     * remaining playback time equals the crossfade duration.
     */
    startCrossfadeOut(durationSeconds) {
        if (this._isCrossfading) return;
        this._isCrossfading = true;
        this._isFadingIn = false;

        const startTime = performance.now();
        const durationMs = durationSeconds * 1000;

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(1, elapsed / durationMs);

            // Smooth ease-out curve for natural-sounding fade
            this._crossfadeVolumeFactor = 1 - progress;
            this.applyReplayGain();

            if (progress < 1 && this._isCrossfading && !this._isFadingIn) {
                this._crossfadeRaf = requestAnimationFrame(animate);
            }
        };

        this._crossfadeRaf = requestAnimationFrame(animate);
    }

    /**
     * Fade the new track in after a crossfade transition.
     * Called from the 'play' event handler when _isCrossfading is true.
     */
    startCrossfadeIn() {
        if (this._isFadingIn) return; // prevent double-trigger
        this._isFadingIn = true;

        // Cancel any lingering fade-out RAF
        if (this._crossfadeRaf) {
            cancelAnimationFrame(this._crossfadeRaf);
            this._crossfadeRaf = null;
        }

        const fadeInMs = 1000; // 1-second fade-in for the new track
        const startTime = performance.now();
        this._crossfadeVolumeFactor = 0;
        this.applyReplayGain();

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(1, elapsed / fadeInMs);

            // Ease-in curve
            this._crossfadeVolumeFactor = progress;
            this.applyReplayGain();

            if (progress < 1) {
                this._crossfadeRaf = requestAnimationFrame(animate);
            } else {
                // Crossfade complete – restore normal state
                this._isCrossfading = false;
                this._isFadingIn = false;
                this._crossfadeVolumeFactor = 1;
                this._crossfadeRaf = null;
                this.applyReplayGain();
            }
        };

        this._crossfadeRaf = requestAnimationFrame(animate);
    }

    /**
     * Cancel any in-progress crossfade and restore full volume.
     */
    cancelCrossfade() {
        if (this._crossfadeRaf) {
            cancelAnimationFrame(this._crossfadeRaf);
            this._crossfadeRaf = null;
        }
        this._isCrossfading = false;
        this._isFadingIn = false;
        this._crossfadeVolumeFactor = 1;
        this.applyReplayGain();
    }

}