//js/lyrics.js
import { getTrackTitle, getTrackArtists, buildTrackFilename, SVG_CLOSE } from './utils.js';
import { sidePanelManager } from './side-panel.js';
import { getVibrantColorFromImage } from './vibrant-color.js';
import { db as musicDB } from './db.js';

const SVG_GENIUS_ACTIVE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z" fill="#ffff64"/><path d="M6.3 6.3h11.4v11.4H6.3z" fill="#000"/></svg>`;

// Check if text contains Japanese, Chinese, or Korean characters
function containsAsianText(text) {
    if (!text) return false;
    // Japanese: Hiragana (3040-309F), Katakana (30A0-30FF), Kanji (4E00-9FFF, 3400-4DBF)
    // Chinese: CJK Unified Ideographs (4E00-9FFF, 3400-4DBF)
    // Korean: Hangul (AC00-D7AF, 1100-11FF, 3130-318F)
    const asianRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
    return asianRegex.test(text);
}

// Check if track has Asian text in title or artist names
function trackHasAsianText(track) {
    if (!track) return false;
    const title = track.title || '';
    const artist = getTrackArtists(track) || '';
    return containsAsianText(title) || containsAsianText(artist);
}
const SVG_GENIUS_INACTIVE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="opacity: 0.7;"><path d="M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12z" /><path d="M6.3 6.3h11.4v11.4H6.3z" fill="var(--card)"/></svg>`;

class LyricsStorageCache {
    constructor(storageKey = 'lyricsCache', maxEntries = 200) {
        this.storageKey = storageKey;
        this.maxEntries = maxEntries;
        this._mem = new Map();
        this._loadFromStorage();
    }

    _loadFromStorage() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const entries = JSON.parse(raw);
                // entries is [[key, value], ...]
                for (const [k, v] of entries) {
                    this._mem.set(k, v);
                }
            }
        } catch { /* ignore corrupt data */ }
    }

    _saveToStorage() {
        try {
            const entries = Array.from(this._mem.entries());
            // Trim to max
            while (entries.length > this.maxEntries) entries.shift();
            localStorage.setItem(this.storageKey, JSON.stringify(entries));
        } catch { /* storage full, ignore */ }
    }

    has(key) { return this._mem.has(key); }
    get(key) { return this._mem.get(key); }

    set(key, value) {
        this._mem.set(key, value);
        // Evict oldest if over limit
        if (this._mem.size > this.maxEntries) {
            const firstKey = this._mem.keys().next().value;
            this._mem.delete(firstKey);
        }
        this._saveToStorage();
    }
}

class GeniusManager {
    constructor() {
        this.cache = new Map();
        this.loading = false;
    }

    getToken() {
        return 'QmS9OvsS-7ifRBKx_ochIPQU7oejIS9Eo_z5iWHmCPyhwLVQID3pYTHJmJTa6z8z'; // idgaf anymore im js hardcoding this lmaooo
    }

    async searchTrack(title, artist) {
        const cleanTitle = title.split('(')[0].split('-')[0].trim();
        const query = encodeURIComponent(`${cleanTitle} ${artist}`);

        const url = `https://api.genius.com/search?q=${query}`;
        const token = this.getToken();
        const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error('Failed to search Genius');

        const data = await response.json();
        if (data.response.hits.length === 0) return null;

        const normalize = (str) => str.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const targetArtist = normalize(artist);

        const hit = data.response.hits.find((h) => {
            const hitArtist = normalize(h.result.primary_artist.name);
            return hitArtist.includes(targetArtist) || targetArtist.includes(hitArtist);
        });

        return hit ? hit.result : data.response.hits[0].result;
    }

    async getReferents(songId) {
        const token = this.getToken();
        const url = `https://api.genius.com/referents?song_id=${songId}&text_format=plain&per_page=50`;
        const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) throw new Error('Failed to fetch annotations');

        const data = await response.json();
        return data.response.referents;
    }

    async getDataForTrack(track) {
        if (this.cache.has(track.id)) return this.cache.get(track.id);

        try {
            this.loading = true;
            const artist = Array.isArray(track.artists) ? track.artists[0].name : track.artist.name;
            const song = await this.searchTrack(track.title, artist);

            if (!song) {
                this.loading = false;
                return null;
            }

            const referents = await this.getReferents(song.id);
            const result = { song, referents };

            this.cache.set(track.id, result);
            this.loading = false;
            return result;
        } catch (error) {
            console.error('Genius Error:', error);
            this.loading = false;
            throw error;
        }
    }

    findAnnotations(lineText, referents) {
        if (!referents || !lineText) return [];

        const normalize = (str) =>
            str
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, '')
                .replace(/\s+/g, ' ')
                .trim();
        const normLine = normalize(lineText);

        const getWordSet = (str) => new Set(str.split(' ').filter((w) => w.length > 0));
        const lineWords = getWordSet(normLine);

        return referents.filter((ref) => {
            const normFragment = normalize(ref.fragment);

            if (normLine.includes(normFragment) || normFragment.includes(normLine)) return true;

            const fragmentWords = getWordSet(normFragment);
            if (fragmentWords.size === 0 || lineWords.size === 0) return false;

            let matchCount = 0;
            fragmentWords.forEach((w) => {
                if (lineWords.has(w)) matchCount++;
            });

            return matchCount / Math.min(fragmentWords.size, lineWords.size) > 0.6;
        });
    }
}

export class LyricsManager {
    constructor(api) {
        this.api = api;
        this.currentLyrics = null;
        this.syncedLyrics = [];
        this.lyricsCache = new LyricsStorageCache('lyricsCache', 200);
        this.componentLoaded = false;
        this.amLyricsElement = null;
        this.animationFrameId = null;
        this.currentTrackId = null;
        this.mutationObserver = null;
        this.romajiObserver = null;
        this.isRomajiMode = false;
        this.originalLyricsData = null;
        this.kuroshiroLoaded = false;
        this.kuroshiroLoading = false;
        this.romajiTextCache = new Map(); // Cache: originalText -> convertedRomaji
        this.convertedTracksCache = new Set(); // Track IDs that have been fully converted
        this.geniusManager = new GeniusManager();
        this.isGeniusMode = false;
        this.currentGeniusData = null;
        this.timingOffset = 0; // Offset in milliseconds (positive = delay lyrics, negative = advance lyrics)
    }

    // Get timing offset for current track
    getTimingOffset(trackId) {
        try {
            const key = `lyrics-offset-${trackId}`;
            const stored = localStorage.getItem(key);
            return stored ? parseInt(stored, 10) : 0;
        } catch {
            return 0;
        }
    }

    // Set timing offset for current track
    setTimingOffset(trackId, offsetMs) {
        try {
            const key = `lyrics-offset-${trackId}`;
            localStorage.setItem(key, offsetMs.toString());
        } catch (e) {
            console.warn('Failed to save lyrics timing offset:', e);
        }
    }

    // Reset timing offset for current track
    resetTimingOffset(trackId) {
        this.setTimingOffset(trackId, 0);
    }

    // Get formatted offset display string
    getOffsetDisplayString(offsetMs) {
        const sign = offsetMs >= 0 ? '+' : '';
        const seconds = Math.abs(offsetMs) / 1000;
        return `${sign}${seconds.toFixed(1)}s`;
    }

    // Load Kuroshiro from CDN (npm package uses Node.js path which doesn't work in browser)
    async loadKuroshiro() {
        if (this.kuroshiroLoaded) return true;
        if (this.kuroshiroLoading) {
            // Wait for existing load to complete
            return new Promise((resolve) => {
                const checkLoad = setInterval(() => {
                    if (!this.kuroshiroLoading) {
                        clearInterval(checkLoad);
                        resolve(this.kuroshiroLoaded);
                    }
                }, 100);
            });
        }

        this.kuroshiroLoading = true;
        try {
            // Bug on kuromoji@0.1.2 where it mangles absolute URLs
            // Using self-hosted dict files is failed, so we use CDN with monkey-patch
            // Monkey-patch XMLHttpRequest to redirect dictionary requests to CDN
            // Kuromoji uses XHR, not fetch, for loading dictionary files
            if (!window._originalXHROpen) {
                window._originalXHROpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                    const urlStr = url.toString();
                    if (urlStr.includes('/dict/') && urlStr.includes('.dat.gz')) {
                        // Extract just the filename
                        const filename = urlStr.split('/').pop();
                        // Redirect to CDN
                        const cdnUrl = `https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/${filename}`;
                        return window._originalXHROpen.call(this, method, cdnUrl, ...rest);
                    }
                    return window._originalXHROpen.call(this, method, url, ...rest);
                };
            }

            // Also patch fetch just in case
            if (!window._originalFetch) {
                window._originalFetch = window.fetch;
                window.fetch = async (url, options) => {
                    const urlStr = url.toString();
                    if (urlStr.includes('/dict/') && urlStr.includes('.dat.gz')) {
                        const filename = urlStr.split('/').pop();
                        const cdnUrl = `https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/${filename}`;
                        console.log(`Redirecting dict fetch: ${filename} -> CDN`);
                        return window._originalFetch(cdnUrl, options);
                    }
                    return window._originalFetch(url, options);
                };
            }

            // Load Kuroshiro from CDN
            if (!window.Kuroshiro) {
                await this.loadScript('https://unpkg.com/kuroshiro@1.2.0/dist/kuroshiro.min.js');
            }

            // Load Kuromoji analyzer from CDN
            if (!window.KuromojiAnalyzer) {
                await this.loadScript(
                    'https://unpkg.com/kuroshiro-analyzer-kuromoji@1.1.0/dist/kuroshiro-analyzer-kuromoji.min.js'
                );
            }

            // Initialize Kuroshiro (CDN version exports as .default)
            const Kuroshiro = window.Kuroshiro.default || window.Kuroshiro;
            const KuromojiAnalyzer = window.KuromojiAnalyzer.default || window.KuromojiAnalyzer;

            this.kuroshiro = new Kuroshiro();

            // Initialize with a dummy path - our fetch interceptor will redirect to CDN
            await this.kuroshiro.init(
                new KuromojiAnalyzer({
                    dictPath: '/dict/', // This gets mangled but our interceptor fixes it
                })
            );

            this.kuroshiroLoaded = true;
            this.kuroshiroLoading = false;
            console.log('✓ Kuroshiro loaded and initialized successfully');
            return true;
        } catch (error) {
            console.error('✗ Failed to load Kuroshiro:', error);
            this.kuroshiroLoaded = false;
            this.kuroshiroLoading = false;
            return false;
        }
    }

    // Helper to load external scripts
    loadScript(src) {
        return new Promise((resolve, reject) => {
            // Check if script already exists
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    // Check if text contains Japanese characters
    containsJapanese(text) {
        if (!text) return false;
        // Match any Japanese character (Hiragana, Katakana, Kanji)
        return /[\u3040-\u30FF\u31F0-\u9FFF]/.test(text);
    }

    // Convert Japanese text to Romaji (including Kanji) with caching
    async convertToRomaji(text) {
        if (!text) return text;

        // Check cache first
        if (this.romajiTextCache.has(text)) {
            return this.romajiTextCache.get(text);
        }

        // Only process if text contains Asian characters
        if (!containsAsianText(text)) {
            return text;
        }

        // Make sure Kuroshiro is loaded
        if (!this.kuroshiroLoaded) {
            const success = await this.loadKuroshiro();
            if (!success) {
                console.warn('Kuroshiro not available, skipping conversion');
                return text;
            }
        }

        if (!this.kuroshiro) {
            console.warn('Kuroshiro not available, skipping conversion');
            return text;
        }

        try {
            // Convert to Romaji using Kuroshiro (handles Kanji, Hiragana, Katakana)
            const result = await this.kuroshiro.convert(text, {
                to: 'romaji',
                mode: 'spaced',
                romajiSystem: 'hepburn',
            });
            // Cache the result
            this.romajiTextCache.set(text, result);
            return result;
        } catch (error) {
            console.warn('Romaji conversion failed for text:', text.substring(0, 30), error);
            return text;
        }
    }

    // Set Romaji mode and save preference
    setRomajiMode(enabled) {
        this.isRomajiMode = enabled;
        try {
            localStorage.setItem('lyricsRomajiMode', enabled ? 'true' : 'false');
        } catch (e) {
            console.warn('Failed to save Romaji mode preference:', e);
        }
    }

    // Get saved Romaji mode preference
    getRomajiMode() {
        try {
            return localStorage.getItem('lyricsRomajiMode') === 'true';
        } catch {
            return false;
        }
    }

    async ensureComponentLoaded() {
        if (this.componentLoaded) return;

        if (typeof customElements !== 'undefined' && customElements.get('am-lyrics')) {
            this.componentLoaded = true;
            return;
        }

        // Try local bundle first, then CDN fallback
        const sources = [
            '/js/vendor/am-lyrics.min.js',
            'https://cdn.jsdelivr.net/npm/@uimaxbai/am-lyrics@0.6.5/dist/src/am-lyrics.min.js',
        ];

        for (const src of sources) {
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.type = 'module';
                    script.src = src;

                    script.onload = () => {
                        if (typeof customElements !== 'undefined') {
                            customElements
                                .whenDefined('am-lyrics')
                                .then(() => {
                                    this.componentLoaded = true;
                                    resolve();
                                })
                                .catch(reject);
                        } else {
                            resolve();
                        }
                    };

                    script.onerror = () => reject(new Error(`Failed to load from ${src}`));
                    document.head.appendChild(script);
                });
                return; // loaded successfully
            } catch (e) {
                console.warn('Lyrics component load attempt failed:', e.message);
            }
        }

        throw new Error('Failed to load lyrics component from all sources');
    }

    async fetchLyrics(trackId, track = null) {
        if (track) {
            // 1. Check in-memory cache
            if (this.lyricsCache.has(trackId)) {
                return this.lyricsCache.get(trackId);
            }

            // 2. Check IndexedDB cache
            try {
                await musicDB.open();
                const cached = await musicDB.getCachedLyrics(trackId);
                if (cached) {
                    this.lyricsCache.set(trackId, cached);
                    return cached;
                }
            } catch (e) {
                console.warn('IndexedDB lyrics read failed:', e);
            }

            // 3. Fetch from LRCLIB
            try {
                const artist = Array.isArray(track.artists)
                    ? track.artists.map((a) => a.name || a).join(', ')
                    : track.artist?.name || '';
                const title = track.title || '';
                const album = track.album?.title || '';
                const duration = track.duration ? Math.round(track.duration) : null;

                if (!title || !artist) {
                    console.warn('Missing required fields for LRCLIB');
                    return null;
                }

                const params = new URLSearchParams({
                    track_name: title,
                    artist_name: artist,
                });

                if (album) params.append('album_name', album);
                if (duration) params.append('duration', duration.toString());

                const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);

                if (response.ok) {
                    const data = await response.json();

                    if (data.syncedLyrics) {
                        const lyricsData = {
                            subtitles: data.syncedLyrics,
                            lyricsProvider: 'LRCLIB',
                        };

                        this.lyricsCache.set(trackId, lyricsData);

                        // Persist to IndexedDB for offline access
                        try {
                            await musicDB.cacheLyrics(trackId, lyricsData);
                        } catch (e) {
                            console.warn('IndexedDB lyrics write failed:', e);
                        }

                        return lyricsData;
                    }
                }
            } catch (error) {
                console.warn('LRCLIB fetch failed:', error);
            }
        }

        return null;
    }

    parseSyncedLyrics(subtitles) {
        if (!subtitles) return [];
        const lines = subtitles.split('\n').filter((line) => line.trim());
        return lines
            .map((line) => {
                const match = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.+)/);
                if (match) {
                    const [, minutes, seconds, centiseconds, text] = match;
                    const timeInSeconds = parseInt(minutes) * 60 + parseInt(seconds) + parseInt(centiseconds) / 100;
                    return { time: timeInSeconds, text: text.trim() };
                }
                return null;
            })
            .filter(Boolean);
    }

    generateLRCContent(lyricsData, track) {
        if (!lyricsData || !lyricsData.subtitles) return null;

        const trackTitle = getTrackTitle(track);
        const trackArtist = getTrackArtists(track);

        let lrc = `[ti:${trackTitle}]\n`;
        lrc += `[ar:${trackArtist}]\n`;
        lrc += `[al:${track.album?.title || 'Unknown Album'}]\n`;
        lrc += `[by:${lyricsData.lyricsProvider || 'Unknown'}]\n`;
        lrc += '\n';
        lrc += lyricsData.subtitles;

        return lrc;
    }

    downloadLRC(lyricsData, track) {
        const lrcContent = this.generateLRCContent(lyricsData, track);
        if (!lrcContent) {
            alert('No synced lyrics available for this track');
            return;
        }

        const blob = new Blob([lrcContent], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = buildTrackFilename(track, 'LOSSLESS').replace(/\.flac$/, '.lrc');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    getCurrentLine(currentTime) {
        if (!this.syncedLyrics || this.syncedLyrics.length === 0) return -1;
        let currentIndex = -1;
        for (let i = 0; i < this.syncedLyrics.length; i++) {
            if (currentTime >= this.syncedLyrics[i].time) {
                currentIndex = i;
            } else {
                break;
            }
        }
        return currentIndex;
    }

    // Setup MutationObserver to convert lyrics in am-lyrics component
    setupLyricsObserver(amLyricsElement) {
        this.stopLyricsObserver();

        if (!amLyricsElement) return;

        // Check for shadow DOM
        const observeRoot = amLyricsElement.shadowRoot || amLyricsElement;

        this.romajiObserver = new MutationObserver((mutations) => {
            // Check if any relevant mutation occurred
            const hasRelevantChange = mutations.some((mutation) => {
                if (mutation.type === 'childList') {
                    let relevant = false;
                    if (mutation.addedNodes.length > 0) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('genius-indicator'))
                                continue;
                            relevant = true;
                            break;
                        }
                    }
                    if (!relevant && mutation.removedNodes.length > 0) {
                        for (const node of mutation.removedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('genius-indicator'))
                                continue;
                            relevant = true;
                            break;
                        }
                    }
                    return relevant;
                }
                if (mutation.type === 'characterData') return true;
                return false;
            });

            if (!hasRelevantChange) {
                return;
            }

            // Debounce mutations
            if (this.observerTimeout) {
                clearTimeout(this.observerTimeout);
            }
            this.observerTimeout = setTimeout(async () => {
                if (this.isRomajiMode) {
                    await this.convertLyricsContent(amLyricsElement);
                }
                if (this.isGeniusMode && this.currentGeniusData) {
                    this.applyGeniusAnnotations(amLyricsElement, this.currentGeniusData.referents);
                }
            }, 100);
        });

        // Observe all child nodes for changes (in shadow DOM if it exists)
        // Watch for new nodes AND text content changes to catch when lyrics refresh
        this.romajiObserver.observe(observeRoot, {
            childList: true,
            subtree: true,
            characterData: true, // Watch text changes to catch lyric refreshes
            attributes: false, // Don't watch attribute changes (highlight, etc)
        });

        // Initial conversion if Romaji mode is enabled - single attempt, no periodic polling
        if (this.isRomajiMode) {
            this.convertLyricsContent(amLyricsElement);
        }
        if (this.isGeniusMode && this.currentGeniusData) {
            this.applyGeniusAnnotations(amLyricsElement, this.currentGeniusData.referents);
        }
    }

    // Convert lyrics content to Romaji
    async convertLyricsContent(amLyricsElement) {
        if (!amLyricsElement || !this.isRomajiMode) {
            return;
        }

        // Find the root to traverse - check for shadow DOM first
        const rootToTraverse = amLyricsElement.shadowRoot || amLyricsElement;

        // Make sure Kuroshiro is ready
        if (!this.kuroshiroLoaded) {
            const success = await this.loadKuroshiro();
            if (!success) {
                console.warn('Cannot convert lyrics - Kuroshiro load failed');
                return;
            }
        }

        // Find all text nodes in the component
        const textNodes = [];
        const walker = document.createTreeWalker(rootToTraverse, NodeFilter.SHOW_TEXT, null, false);

        let node;
        while ((node = walker.nextNode())) {
            textNodes.push(node);
        }

        // Convert Japanese text to Romaji (using async/await for Kuroshiro)
        for (const textNode of textNodes) {
            if (!textNode.parentElement) {
                continue;
            }

            const parentTag = textNode.parentElement.tagName?.toLowerCase();
            const parentClass = String(textNode.parentElement.className || '');

            // Skip elements that shouldn't be converted
            const skipTags = ['script', 'style', 'code', 'input', 'textarea', 'time'];
            if (skipTags.includes(parentTag)) {
                continue;
            }

            const originalText = textNode.textContent;

            // Skip progress indicators and timestamps (but NOT progress-text which is the actual lyrics!)
            if (
                (parentClass.includes('progress') && !parentClass.includes('progress-text')) ||
                (parentClass.includes('time') && !parentClass.includes('progress-text')) ||
                parentClass.includes('timestamp')
            ) {
                continue;
            }

            if (!originalText || originalText.trim().length === 0) {
                continue;
            }

            // Check if contains Japanese - convert if we find Japanese
            if (this.containsJapanese(originalText)) {
                const romajiText = await this.convertToRomaji(originalText);

                // Only update if conversion produced different text
                if (romajiText && romajiText !== originalText) {
                    textNode.textContent = romajiText;
                }
            }
        }

        // Mark this track as converted
        if (this.currentTrackId) {
            this.convertedTracksCache.add(this.currentTrackId);
        }
    }

    // Stop the observer
    stopLyricsObserver() {
        if (this.romajiObserver) {
            this.romajiObserver.disconnect();
            this.romajiObserver = null;
        }
        if (this.observerTimeout) {
            clearTimeout(this.observerTimeout);
            this.observerTimeout = null;
        }
    }

    // Toggle Romaji mode
    async toggleRomajiMode(amLyricsElement) {
        this.isRomajiMode = !this.isRomajiMode;
        this.setRomajiMode(this.isRomajiMode);

        if (amLyricsElement) {
            if (this.isRomajiMode) {
                // Turning ON: Setup observer and convert immediately
                this.setupLyricsObserver(amLyricsElement);
                await this.convertLyricsContent(amLyricsElement);
            } else {
                // Turning OFF: Stop observer
                // Note: To restore original Japanese, we'd need to reload the component
                this.stopLyricsObserver();
            }
        }

        return this.isRomajiMode;
    }

    async applyGeniusAnnotations(amLyricsElement, referents) {
        if (!amLyricsElement || !referents) return;

        const root = amLyricsElement.shadowRoot || amLyricsElement;

        const lineElements = Array.from(root.querySelectorAll('p, .line, .lyric-line, .lrc-line'));

        if (lineElements.length === 0) return;

        lineElements.forEach((el) => {
            el.classList.remove('genius-annotated', 'genius-multi-start', 'genius-multi-end', 'genius-multi-mid');
            delete el.__geniusAnnotations;
        });

        const normalize = (str) =>
            str
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, '')
                .replace(/\s+/g, ' ')
                .trim();

        referents.forEach((ref) => {
            const fragment = normalize(ref.fragment);
            if (!fragment) return;

            for (let i = 0; i < lineElements.length; i++) {
                let combinedText = '';
                let currentLines = [];

                for (let j = i; j < lineElements.length; j++) {
                    const line = lineElements[j];

                    const lineClone = line.cloneNode(true);
                    lineClone
                        .querySelectorAll('.time, .timestamp, [class*="time"], .genius-indicator')
                        .forEach((n) => n.remove());
                    const text = normalize(lineClone.textContent || '');

                    if (!text) continue;

                    if (currentLines.length > 0) combinedText += ' ';
                    combinedText += text;
                    currentLines.push(line);

                    if (combinedText.includes(fragment)) {
                        currentLines.forEach((el, idx) => {
                            el.classList.add('genius-annotated');
                            if (!el.__geniusAnnotations) el.__geniusAnnotations = [];

                            if (!el.__geniusAnnotations.some((a) => a.id === ref.id)) {
                                el.__geniusAnnotations.push(ref);
                            }

                            if (currentLines.length > 1) {
                                if (idx === 0) el.classList.add('genius-multi-start');
                                else if (idx === currentLines.length - 1) el.classList.add('genius-multi-end');
                                else el.classList.add('genius-multi-mid');
                            }

                            if (!el.querySelector('.genius-indicator')) {
                                const smiley = document.createElement('span');
                                smiley.className = 'genius-indicator';
                                smiley.textContent = ' ☺';
                                smiley.style.color = '#ffff64';
                                smiley.style.marginLeft = '0.5em';
                                el.appendChild(smiley);
                            }
                        });
                        break;
                    }

                    if (combinedText.length > fragment.length + 50) break;
                }
            }
        });
    }
}

export function openLyricsPanel(track, audioPlayer, lyricsManager, forceOpen = false) {
    const manager = lyricsManager || new LyricsManager();

    // Load Kuroshiro in background only if track has Asian text and Romaji mode is enabled
    const isRomajiMode = manager.getRomajiMode();
    if (isRomajiMode && trackHasAsianText(track) && !manager.kuroshiroLoaded && !manager.kuroshiroLoading) {
        manager.loadKuroshiro().catch((err) => {
            console.warn('Failed to load Kuroshiro for Romaji conversion:', err);
        });
    }

    // Load saved timing offset for this track
    manager.timingOffset = manager.getTimingOffset(track.id);

    const renderControls = (container) => {
        container.innerHTML = '';
    };

    const renderContent = async (container) => {
        clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        await renderLyricsComponent(container, track, audioPlayer, manager);
        if (container.lyricsCleanup) {
            sidePanelManager.panel.lyricsCleanup = container.lyricsCleanup;
            sidePanelManager.panel.lyricsManager = container.lyricsManager;
        }

        // Extract album cover colors for the bleeding background
        const coverEl = document.querySelector('.now-playing-bar .cover');
        if (coverEl && coverEl.src) {
            try {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                const sep = coverEl.src.includes('?') ? '&' : '?';
                img.src = `${coverEl.src}${sep}lyrics-color`;
                img.onload = () => {
                    try {
                        const color = getVibrantColorFromImage(img);
                        if (color) {
                            const panel = sidePanelManager.panel;
                            if (panel) {
                                // Shift hue slightly for the 3 gradient colors
                                panel.style.setProperty('--lyrics-color-1', color);
                                // Create complementary colors by adjusting
                                const r = parseInt(color.slice(1, 3), 16);
                                const g = parseInt(color.slice(3, 5), 16);
                                const b = parseInt(color.slice(5, 7), 16);
                                const c2 = `rgb(${Math.min(255, r + 60)}, ${Math.max(0, g - 30)}, ${Math.min(255, b + 40)})`;
                                const c3 = `rgb(${Math.max(0, r - 40)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 60)})`;
                                panel.style.setProperty('--lyrics-color-2', c2);
                                panel.style.setProperty('--lyrics-color-3', c3);
                            }
                        }
                    } catch (e) {
                        // Fallback to default colors
                    }
                };
            } catch (e) {
                // Fallback to default colors
            }
        }
    };

    // Build title with song info on multiple lines
    const songTitle = track.title || 'Unknown';
    const artistName = track.artist?.name || (track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown');
    const albumName = track.album?.title || '';
    const panelTitle = songTitle; // Main title is the song name
    
    sidePanelManager.open('lyrics', panelTitle, renderControls, renderContent, forceOpen);

    // After opening, set the title to multi-line HTML
    const titleEl = document.getElementById('side-panel-title');
    if (titleEl) {
        let titleHTML = `<span class="lyrics-title-song">${songTitle.replace(/</g, '&lt;')}</span>`;
        titleHTML += `<span class="lyrics-title-artist">${artistName.replace(/</g, '&lt;')}</span>`;
        if (albumName) {
            titleHTML += `<span class="lyrics-title-album">${albumName.replace(/</g, '&lt;')}</span>`;
        }
        titleEl.innerHTML = titleHTML;
    }
}

async function renderLyricsComponent(container, track, audioPlayer, lyricsManager) {
    container.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';

    try {
        await lyricsManager.ensureComponentLoaded();

        // Set initial Romaji mode
        lyricsManager.isRomajiMode = lyricsManager.getRomajiMode();
        lyricsManager.currentTrackId = track.id;

        const title = track.title;
        const artist = getTrackArtists(track);
        const album = track.album?.title;
        const durationMs = track.duration ? Math.round(track.duration * 1000) : undefined;
        const isrc = track.isrc || '';

        container.innerHTML = '';
        const amLyrics = document.createElement('am-lyrics');
        amLyrics.setAttribute('song-title', title);
        amLyrics.setAttribute('song-artist', artist);
        if (album) amLyrics.setAttribute('song-album', album);
        if (durationMs) amLyrics.setAttribute('song-duration', durationMs);
        amLyrics.setAttribute('query', `${title} ${artist}`.trim());
        if (isrc) amLyrics.setAttribute('isrc', isrc);

        amLyrics.setAttribute('highlight-color', '#ffffff');
        amLyrics.setAttribute('hover-background-color', 'rgba(255, 255, 255, 0.08)');
        amLyrics.setAttribute('autoscroll', '');
        amLyrics.setAttribute('interpolate', '');
        amLyrics.style.height = '100%';
        amLyrics.style.width = '100%';

        container.appendChild(amLyrics);

        // Override the built-in scrollToActiveLine to position active line at 20% from top (30% above center)
        const overrideScroll = () => {
            if (typeof amLyrics.scrollToActiveLine === 'function') {
                amLyrics.scrollToActiveLine = function () {
                    if (!this.lyricsContainer || this.activeLineIndices.length === 0) return;
                    const idx = Math.min(...this.activeLineIndices);
                    const el = this.lyricsContainer.querySelector(`.lyrics-line:nth-child(${idx + 1})`);
                    if (el) {
                        const ch = this.lyricsContainer.clientHeight;
                        const top = el.offsetTop;
                        const h = el.clientHeight;
                        const bg = el.querySelector('.background-text.before');
                        let bgOff = 0;
                        if (bg) bgOff = bg.clientHeight / 2;
                        // 0.2 = 20% from top (30% above center)
                        const target = top - ch * 0.2 + h / 2 - bgOff;
                        requestAnimationFrame(() => {
                            this.isProgrammaticScroll = true;
                            this.lyricsContainer?.scrollTo({ top: target, behavior: 'smooth' });
                            setTimeout(() => { this.isProgrammaticScroll = false; }, 100);
                        });
                    }
                };
            }
            if (typeof amLyrics.scrollToInstrumental === 'function') {
                amLyrics.scrollToInstrumental = function (insertIdx) {
                    if (!this.lyricsContainer) return;
                    const el = this.lyricsContainer.querySelector(`.lyrics-line:nth-child(${insertIdx + 1})`);
                    if (el) {
                        const ch = this.lyricsContainer.clientHeight;
                        const top = el.offsetTop;
                        const h = el.clientHeight;
                        const bg = el.querySelector('.background-text.before');
                        let bgOff = 0;
                        if (bg) bgOff = bg.clientHeight / 2;
                        const target = top - ch * 0.2 + h / 2 - bgOff;
                        requestAnimationFrame(() => {
                            this.isProgrammaticScroll = true;
                            this.lyricsContainer?.scrollTo({ top: target, behavior: 'smooth' });
                            setTimeout(() => { this.isProgrammaticScroll = false; }, 100);
                        });
                    }
                };
            }
        };
        // Override immediately if available, and also after shadow DOM renders
        overrideScroll();
        setTimeout(overrideScroll, 100);
        setTimeout(overrideScroll, 500);
        setTimeout(overrideScroll, 1500);

        // Inject custom styles into am-lyrics shadow DOM once it renders
        const injectLyricsStyles = () => {
            const root = amLyrics.shadowRoot;
            if (!root) return;
            // Check if styles already injected
            if (root.querySelector('#custom-lyrics-style')) {
                return; // Already injected
            }
            const style = document.createElement('style');
            style.id = 'custom-lyrics-style';
            style.textContent = `
                /* Hide Rom, Trans, Auto buttons and all controls */
                .controls, .lyrics-controls, .toolbar, .options-bar,
                button[title*="oman"], button[title*="ranslat"], button[title*="uto"],
                .rom-btn, .trans-btn, .auto-btn,
                [class*="control"], [class*="option"], [class*="toolbar"],
                .settings, .settings-bar, .bottom-bar, .top-bar,
                [class*="setting"], [class*="toggle"] {
                    display: none !important;
                }
                /* Hide version text, github star, footer, credits */
                footer, .footer, [class*="footer"],
                [class*="version"], [class*="credit"],
                [class*="github"], [class*="star"],
                a[href*="github"], [class*="badge"],
                [class*="watermark"], [class*="branding"] {
                    display: none !important;
                }
                /* Hide any text containing v0.6 or star/github via parent containers */
                .bottom, .info-bar, .meta, .about {
                    display: none !important;
                }
                /* Apply Bricolage Grotesque font */
                :host, *, .line, .synced-line, .lyrics-line, p, span, div {
                    font-family: 'Bricolage Grotesque', 'DM Sans', sans-serif !important;
                }

                /* Pad so first line starts at ~20% from top and last line can reach 20% */
                .lyrics-container {
                    padding-top: 20vh !important;
                    padding-bottom: 80vh !important;
                }

                /* === KILL transitions ONLY on sung/past lines === */
                [data-sung], [data-sung] *,
                .line.past, .synced-line.past, .lyrics-line.past,
                .line.past *, .synced-line.past *, .lyrics-line.past * {
                    transition: none !important;
                    -webkit-transition: none !important;
                }

                /* Lyrics text: default dim state */
                .line, .synced-line, .lyrics-line, [class*="line"] {
                    font-size: 2rem !important;
                    line-height: 1.6 !important;
                    font-weight: 700 !important;
                    letter-spacing: -0.01em !important;
                    padding: 0.5rem 0 !important;
                    margin: 0 !important;
                    opacity: 0.35 !important;
                    color: rgba(255,255,255,0.4) !important;
                    transition: opacity 0.4s ease, text-shadow 0.4s ease !important;
                }

                /* Active line: bright white, NO glare */
                /* .active-line is the class am-lyrics component uses */
                .line.active, .synced-line.active,
                .active-line, .lyrics-line.active-line,
                [class*="line"].active, [class*="line"][class*="active"] {
                    font-size: 2rem !important;
                    line-height: 1.6 !important;
                    font-weight: 800 !important;
                    opacity: 1 !important;
                    color: #ffffff !important;
                    text-shadow: none !important;
                    filter: none !important;
                }

                /* Active line children (karaoke fill spans) */
                .active-line *, .lyrics-line.active-line *,
                .line.active *, .synced-line.active *, [class*="line"].active *,
                [class*="line"][class*="active"] * {
                    transition: background-position 0.6s linear, color 0.5s ease, -webkit-text-fill-color 0.5s ease !important;
                }

                /* Active line progress-text should also be white */
                .active-line .progress-text,
                .lyrics-line.active-line .progress-text {
                    color: #ffffff !important;
                    -webkit-text-fill-color: transparent !important;
                }

                /* === SUNG LINES: data-sung dims back to default === */
                [data-sung],
                .line[data-sung],
                .synced-line[data-sung],
                .lyrics-line[data-sung],
                [class*="line"][data-sung],
                p[data-sung] {
                    opacity: 0.35 !important;
                    color: rgba(255,255,255,0.4) !important;
                    filter: none !important;
                    text-shadow: none !important;
                }
                [data-sung] *,
                .line[data-sung] *,
                .synced-line[data-sung] *,
                .lyrics-line[data-sung] *,
                [class*="line"][data-sung] *,
                p[data-sung] * {
                    color: rgba(255,255,255,0.4) !important;
                    -webkit-text-fill-color: rgba(255,255,255,0.4) !important;
                    background: none !important;
                }

                /* Past lines also dimmed via class */
                .line.past, .synced-line.past, .lyrics-line.past, [class*="line"].past {
                    opacity: 0.35 !important;
                    color: rgba(255,255,255,0.4) !important;
                    filter: none !important;
                    text-shadow: none !important;
                }
                .line.past *, .synced-line.past *, .lyrics-line.past *, [class*="line"].past * {
                    color: rgba(255,255,255,0.4) !important;
                    -webkit-text-fill-color: rgba(255,255,255,0.4) !important;
                    background: none !important;
                }

                /* Hide scrollbar inside component */
                :host {
                    scrollbar-width: none !important;
                    -ms-overflow-style: none !important;
                }
                :host::-webkit-scrollbar {
                    display: none !important;
                }
                *, div, section, main {
                    scrollbar-width: none !important;
                    -ms-overflow-style: none !important;
                }
                *::-webkit-scrollbar {
                    display: none !important;
                }
            `;
            root.appendChild(style);
        };

        // Aggressively remove version/github text from shadow DOM
        const removeUnwantedElements = () => {
            const root = amLyrics.shadowRoot;
            if (!root) return;
            // Walk all text nodes and hide parents containing unwanted text
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while ((node = walker.nextNode())) {
                const text = (node.textContent || '').trim().toLowerCase();
                if (
                    text.includes('v0.6') || text.includes('v0.5') || text.includes('v0.4') ||
                    text.includes('star') || text.includes('github') ||
                    text.includes('uimaxbai') || text.includes('am-lyrics') ||
                    text.includes('version')
                ) {
                    let el = node.parentElement;
                    // Walk up a few levels to hide the container
                    for (let i = 0; i < 3 && el; i++) {
                        if (el === root || el === root.host) break;
                        if (el.children && el.children.length <= 2) {
                            el.style.display = 'none';
                            break;
                        }
                        el = el.parentElement;
                    }
                }
            }
        };

        // Use data-sung attribute to mark lines that have been sung and passed.
        // The CSS in the shadow DOM dims them back to default appearance.

        const forceLyricsDim = () => {
            const root = amLyrics.shadowRoot;
            if (!root) return;

            // Find all lyric line containers
            let lines = root.querySelectorAll('.line, .synced-line, [class*="lyric-line"], p[class]');
            if (lines.length === 0) {
                lines = root.querySelectorAll('p, div.line, div[class*="line"]');
            }
            if (lines.length === 0) return;

            // Find the currently active line
            let activeIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                const cls = lines[i].className || '';
                if (cls.includes('active') || cls.includes('current')) {
                    activeIndex = i;
                    break;
                }
            }

            // Also check for 'past' class lines to find the frontier
            if (activeIndex === -1) {
                for (let i = lines.length - 1; i >= 0; i--) {
                    const cls = lines[i].className || '';
                    if (cls.includes('past')) {
                        activeIndex = i;
                        break;
                    }
                }
            }

            // Apply data-sung to all lines BEFORE the active line.
            // data-sung CSS now dims them back to default (gray, low opacity).
            for (let i = 0; i < lines.length; i++) {
                if (i < activeIndex) {
                    if (!lines[i].hasAttribute('data-sung')) {
                        lines[i].setAttribute('data-sung', '');
                        // Strip any inline color/opacity the component set
                        lines[i].style.removeProperty('color');
                        lines[i].style.removeProperty('opacity');
                        lines[i].style.removeProperty('-webkit-text-fill-color');
                        lines[i].style.removeProperty('text-shadow');
                        lines[i].querySelectorAll('*').forEach(child => {
                            child.style.removeProperty('color');
                            child.style.removeProperty('opacity');
                            child.style.removeProperty('-webkit-text-fill-color');
                        });
                    }
                } else if (i === activeIndex) {
                    // Force bright white on the active line via inline styles (NO glare)
                    if (lines[i].hasAttribute('data-sung')) {
                        lines[i].removeAttribute('data-sung');
                    }
                    lines[i].style.setProperty('opacity', '1', 'important');
                    lines[i].style.setProperty('color', '#ffffff', 'important');
                    lines[i].style.setProperty('font-weight', '800', 'important');
                    lines[i].style.setProperty('text-shadow', 'none', 'important');
                    lines[i].style.setProperty('filter', 'none', 'important');
                    // Scrolling is handled by the overridden scrollToActiveLine on the am-lyrics component
                } else {
                    // Future lines: remove data-sung, clear forced active styles
                    if (lines[i].hasAttribute('data-sung')) {
                        lines[i].removeAttribute('data-sung');
                    }
                    // Clear any leftover forced active styles from when this was the active line
                    lines[i].style.removeProperty('opacity');
                    lines[i].style.removeProperty('color');
                    lines[i].style.removeProperty('font-weight');
                    lines[i].style.removeProperty('text-shadow');
                    lines[i].style.removeProperty('filter');
                }
            }
        };

        // Try immediately and also observe for shadow DOM readiness
        injectLyricsStyles();
        removeUnwantedElements();
        const observer = new MutationObserver(() => {
            injectLyricsStyles();
            removeUnwantedElements();
            forceLyricsDim();
        });
        observer.observe(amLyrics, { childList: true, subtree: true });
        // Also observe shadow root directly
        const observeShadow = () => {
            const root = amLyrics.shadowRoot;
            if (!root) return;
            const shadowObserver = new MutationObserver(() => {
                forceLyricsDim();
            });
            shadowObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        };
        observeShadow();
        setTimeout(() => { injectLyricsStyles(); removeUnwantedElements(); forceLyricsDim(); observeShadow(); }, 500);
        setTimeout(() => { injectLyricsStyles(); removeUnwantedElements(); forceLyricsDim(); }, 1500);
        setTimeout(() => { removeUnwantedElements(); forceLyricsDim(); }, 3000);
        // Continuous polling - run every 80ms to beat the component's own updates
        const pollInterval = setInterval(() => {
            if (!document.contains(amLyrics)) { clearInterval(pollInterval); return; }
            forceLyricsDim();
        }, 80);

        // Setup observer IMMEDIATELY to catch lyrics as they load (not after waiting)
        // This is critical - observer must be running before lyrics arrive from LRCLIB
        lyricsManager.setupLyricsObserver(amLyrics);

        // If Romaji mode is enabled and track has Asian text, ensure Kuroshiro is ready
        if (lyricsManager.isRomajiMode && trackHasAsianText(track) && !lyricsManager.kuroshiroLoaded) {
            await lyricsManager.loadKuroshiro();
        }

        lyricsManager
            .fetchLyrics(track.id, track)
            .then(async () => {
                if (lyricsManager.isGeniusMode) {
                    try {
                        const data = await lyricsManager.geniusManager.getDataForTrack(track);
                        if (data) {
                            lyricsManager.currentGeniusData = data;
                            lyricsManager.applyGeniusAnnotations(amLyrics, data.referents);
                        }
                    } catch (e) {
                        console.warn('Genius auto-load failed', e);
                    }
                }
            })
            .catch((e) => console.warn('Background lyrics fetch failed', e));

        // Wait for lyrics to appear, then do an immediate conversion
        const waitForLyrics = () => {
            return new Promise((resolve) => {
                // Check if lyrics are already loaded
                const checkForLyrics = () => {
                    const hasLyrics =
                        amLyrics.querySelector(".lyric-line, [class*='lyric']") ||
                        (amLyrics.shadowRoot && amLyrics.shadowRoot.querySelector("[class*='lyric']")) ||
                        (amLyrics.textContent && amLyrics.textContent.length > 50);
                    return hasLyrics;
                };

                if (checkForLyrics()) {
                    resolve();
                    return;
                }

                // Check more frequently (200ms) for faster response
                let attempts = 0;
                const maxAttempts = 25; // 5 seconds max
                const interval = setInterval(() => {
                    attempts++;
                    if (checkForLyrics() || attempts >= maxAttempts) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 200);
            });
        };

        await waitForLyrics();

        // Convert immediately after lyrics detected
        if (lyricsManager.isRomajiMode) {
            await lyricsManager.convertLyricsContent(amLyrics);
            // One retry after 500ms in case more lyrics load
            setTimeout(() => lyricsManager.convertLyricsContent(amLyrics), 500);
        }

        if (lyricsManager.isGeniusMode && lyricsManager.currentGeniusData) {
            lyricsManager.applyGeniusAnnotations(amLyrics, lyricsManager.currentGeniusData.referents);
        }

        const cleanup = setupSync(track, audioPlayer, amLyrics, lyricsManager);

        // Attach cleanup to container for easy access
        container.lyricsCleanup = cleanup;
        container.lyricsManager = lyricsManager;

        return amLyrics;
    } catch (error) {
        console.error('am-lyrics component failed, trying fallback renderer:', error);
        // Fallback: render lyrics from IndexedDB cache with custom karaoke renderer
        return renderFallbackLyrics(container, track, audioPlayer, lyricsManager);
    }
}

/**
 * Custom offline-capable lyrics renderer with karaoke word-fill effect.
 * Used when am-lyrics web component can't load (offline / network error).
 */
async function renderFallbackLyrics(container, track, audioPlayer, lyricsManager) {
    // Try to get lyrics from IndexedDB
    let lyricsData = null;
    try {
        await musicDB.open();
        lyricsData = await musicDB.getCachedLyrics(track.id);
    } catch (e) {
        console.warn('IndexedDB lyrics read failed in fallback:', e);
    }

    // Also check in-memory cache
    if (!lyricsData && lyricsManager.lyricsCache.has(track.id)) {
        lyricsData = lyricsManager.lyricsCache.get(track.id);
    }

    if (!lyricsData || !lyricsData.subtitles) {
        container.innerHTML = `<div class="lyrics-error" style="font-family:'Bricolage Grotesque','DM Sans',sans-serif;opacity:0.5;text-align:center;padding:3rem 1rem;">No cached lyrics available offline</div>`;
        return null;
    }

    const parsed = lyricsManager.parseSyncedLyrics(lyricsData.subtitles);
    if (parsed.length === 0) {
        container.innerHTML = `<div class="lyrics-error" style="font-family:'Bricolage Grotesque','DM Sans',sans-serif;opacity:0.5;text-align:center;padding:3rem 1rem;">No synced lyrics found</div>`;
        return null;
    }

    // Build DOM
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'fallback-lyrics-wrapper';
    wrapper.style.cssText = `
        font-family: 'Bricolage Grotesque', 'DM Sans', sans-serif;
        padding: 20vh 1.5rem 80vh;
        overflow-y: auto;
        height: 100%;
        scrollbar-width: none;
        -ms-overflow-style: none;
    `;

    const lineEls = parsed.map((line, idx) => {
        const el = document.createElement('p');
        el.className = 'fb-lyric-line';
        el.textContent = line.text;
        el.dataset.time = line.time;
        el.dataset.idx = idx;
        el.style.cssText = `
            font-size: 2rem;
            line-height: 1.6;
            font-weight: 700;
            letter-spacing: -0.01em;
            padding: 0.5rem 0;
            margin: 0;
            color: rgba(255,255,255,0.4);
            opacity: 0.35;
            cursor: pointer;
            transition: opacity 0.4s ease, text-shadow 0.4s ease;
            -webkit-user-select: none;
            user-select: none;
        `;
        el.addEventListener('click', () => {
            audioPlayer.currentTime = line.time;
            audioPlayer.play();
        });
        wrapper.appendChild(el);
        return el;
    });

    container.appendChild(wrapper);

    // --- Karaoke sync loop ---
    let activeIdx = -1;
    let animId = null;

    const updateActive = () => {
        const t = audioPlayer.currentTime;
        let newIdx = -1;
        for (let i = 0; i < parsed.length; i++) {
            if (t >= parsed[i].time) newIdx = i;
            else break;
        }
        if (newIdx !== activeIdx) {
            // Dim old line back to default
            if (activeIdx >= 0 && activeIdx < lineEls.length) {
                lineEls[activeIdx].style.opacity = '0.35';
                lineEls[activeIdx].style.fontSize = '2rem';
                lineEls[activeIdx].style.fontWeight = '700';
                lineEls[activeIdx].style.color = 'rgba(255,255,255,0.4)';
                lineEls[activeIdx].style.textShadow = 'none';
            }
            activeIdx = newIdx;
            // Highlight new line
            if (activeIdx >= 0 && activeIdx < lineEls.length) {
                lineEls[activeIdx].style.opacity = '1';
                lineEls[activeIdx].style.fontSize = '2rem';
                lineEls[activeIdx].style.fontWeight = '800';
                lineEls[activeIdx].style.color = '#ffffff';
                lineEls[activeIdx].style.textShadow = 'none';
                // Auto-scroll to ~20% from top (30% above center)
                const sc = wrapper;
                if (sc && sc.scrollTo) {
                    const cRect = sc.getBoundingClientRect();
                    const lRect = lineEls[activeIdx].getBoundingClientRect();
                    const relTop = lRect.top - cRect.top + sc.scrollTop;
                    const tgt = relTop - (sc.clientHeight * 0.2);
                    sc.scrollTo({ top: Math.max(0, tgt), behavior: 'smooth' });
                } else {
                    lineEls[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        }
        animId = requestAnimationFrame(updateActive);
    };

    // Start loop
    animId = requestAnimationFrame(updateActive);

    const cleanup = () => {
        if (animId) cancelAnimationFrame(animId);
    };

    container.lyricsCleanup = cleanup;
    container.lyricsManager = lyricsManager;
    return wrapper;
}

function setupSync(track, audioPlayer, amLyrics, lyricsManager) {
    let baseTimeMs = 0;
    let lastTimestamp = performance.now();
    let animationFrameId = null;

    // Get timing offset from lyrics manager (in milliseconds)
    const getTimingOffset = () => {
        return lyricsManager?.timingOffset || 0;
    };

    const updateTime = () => {
        const currentMs = audioPlayer.currentTime * 1000;
        baseTimeMs = currentMs;
        lastTimestamp = performance.now();
        // Apply timing offset: positive offset delays lyrics, negative advances them
        amLyrics.currentTime = currentMs - getTimingOffset();
    };

    const tick = () => {
        if (!audioPlayer.paused) {
            const now = performance.now();
            const elapsed = now - lastTimestamp;
            const nextMs = baseTimeMs + elapsed;
            // Apply timing offset: positive offset delays lyrics, negative advances them
            amLyrics.currentTime = nextMs - getTimingOffset();
            animationFrameId = requestAnimationFrame(tick);
        }
    };

    const onPlay = () => {
        baseTimeMs = audioPlayer.currentTime * 1000;
        lastTimestamp = performance.now();
        tick();
    };

    const onPause = () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    };

    const onLineClick = (e) => {
        if (e.detail && e.detail.timestamp !== undefined) {
            const manager = lyricsManager || sidePanelManager.panel.lyricsManager;
            if (manager && manager.isGeniusMode) {
                const timestampSeconds = e.detail.timestamp / 1000;

                const lyricsData = manager.lyricsCache.get(track.id);
                if (lyricsData && lyricsData.subtitles) {
                    const parsed = manager.parseSyncedLyrics(lyricsData.subtitles);

                    const line = parsed.find((l) => Math.abs(l.time - timestampSeconds) < 1.0);

                    if (line && line.text && manager.currentGeniusData) {
                        const annotations = manager.geniusManager.findAnnotations(
                            line.text,
                            manager.currentGeniusData.referents
                        );
                        showGeniusAnnotations(annotations, line.text);
                    }
                }
                return;
            }

            audioPlayer.currentTime = e.detail.timestamp / 1000;
            audioPlayer.play();
        }
    };

    audioPlayer.addEventListener('timeupdate', updateTime);
    audioPlayer.addEventListener('play', onPlay);
    audioPlayer.addEventListener('pause', onPause);
    audioPlayer.addEventListener('seeked', updateTime);
    amLyrics.addEventListener('line-click', onLineClick);

    if (!audioPlayer.paused) {
        tick();
    }

    return () => {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        audioPlayer.removeEventListener('timeupdate', updateTime);
        audioPlayer.removeEventListener('play', onPlay);
        audioPlayer.removeEventListener('pause', onPause);
        audioPlayer.removeEventListener('seeked', updateTime);
        amLyrics.removeEventListener('line-click', onLineClick);
    };
}

function showGeniusAnnotations(annotations, lineText) {
    const existing = document.querySelector('.genius-annotation-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'genius-annotation-modal';

    let contentHtml = `
        <div class="genius-modal-content">
            <div class="genius-header">
                <span class="genius-line">"${lineText}"</span>
                <button class="close-genius">×</button>
            </div>
            <div class="genius-body">
    `;

    if (annotations.length === 0) {
        contentHtml += `
            <div class="annotation-item">
                <div class="annotation-text" style="color: var(--muted-foreground); font-style: italic;">No Genius annotation found for this line.</div>
            </div>
        `;
    } else {
        annotations.forEach((ann) => {
            const body = ann.annotations[0].body.plain;
            contentHtml += `
                <div class="annotation-item">
                    <div class="annotation-text">${body.replace(/\n/g, '<br>')}</div>
                </div>
            `;
        });
    }

    contentHtml += `</div></div>`;
    modal.innerHTML = contentHtml;

    document.body.appendChild(modal);

    modal.querySelector('.close-genius').addEventListener('click', () => modal.remove());

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

export async function renderLyricsInFullscreen(track, audioPlayer, lyricsManager, container) {
    return renderLyricsComponent(container, track, audioPlayer, lyricsManager);
}

export function clearFullscreenLyricsSync(container) {
    if (container && container.lyricsCleanup) {
        container.lyricsCleanup();
        container.lyricsCleanup = null;
    }
    if (container && container.lyricsManager) {
        container.lyricsManager.stopLyricsObserver();
    }
}

export function clearLyricsPanelSync(audioPlayer, panel) {
    if (panel && panel.lyricsCleanup) {
        panel.lyricsCleanup();
        panel.lyricsCleanup = null;
    }
    if (panel && panel.lyricsManager) {
        panel.lyricsManager.stopLyricsObserver();
    }
}