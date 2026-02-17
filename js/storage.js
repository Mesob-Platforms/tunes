//storage.js
export const apiSettings = {
    STORAGE_KEY: 'monochrome-api-instances-v6',
    INSTANCES_URL: 'instances.json',
    SPEED_TEST_CACHE_KEY: 'monochrome-instance-speeds',
    SPEED_TEST_CACHE_DURATION: 1000 * 60 * 60,
    defaultInstances: { api: [], streaming: [] },
    instancesLoaded: false,
    _loadPromise: null,

    async loadInstancesFromGitHub() {
        if (this.instancesLoaded) {
            return this.defaultInstances;
        }
        // Deduplicate concurrent calls - reuse same promise
        if (this._loadPromise) return this._loadPromise;
        this._loadPromise = this._doLoadInstances();
        return this._loadPromise;
    },

    async _doLoadInstances() {
        try {
            const response = await fetch(this.INSTANCES_URL);
            if (!response.ok) throw new Error('Failed to fetch instances');

            const data = await response.json();

            let groupedInstances = { api: [], streaming: [] };

            if (Array.isArray(data)) {
                groupedInstances.api = [...data];
                groupedInstances.streaming = [...data];
            } else {
                if (data.api && Array.isArray(data.api)) {
                    const isSimpleArray = data.api.length > 0 && typeof data.api[0] === 'string';
                    if (isSimpleArray) {
                        groupedInstances.api = [...data.api];
                    } else {
                        for (const [, config] of Object.entries(data.api)) {
                            if (config.cors === false && Array.isArray(config.urls)) {
                                groupedInstances.api.push(...config.urls);
                            }
                        }
                    }
                }

                if (data.streaming && Array.isArray(data.streaming)) {
                    groupedInstances.streaming = [...data.streaming];
                } else if (groupedInstances.api.length > 0) {
                    groupedInstances.streaming = [...groupedInstances.api];
                }
            }

            this.defaultInstances = groupedInstances;
            this.instancesLoaded = true;

            return groupedInstances;
        } catch (error) {
            console.error('Failed to load instances from GitHub:', error);
            this.defaultInstances = {
                api: [
                    'https://arran.monochrome.tf',
                    'https://api.monochrome.tf',
                    'https://triton.squid.wtf',
                    'https://wolf.qqdl.site',
                    'https://tidal-api.binimum.org',
                    'https://monochrome-api.samidy.com',
                    'https://hifi-one.spotisaver.net',
                    'https://hifi-two.spotisaver.net',
                    'https://maus.qqdl.site',
                    'https://tidal.kinoplus.online',
                    'https://hund.qqdl.site',
                    'https://vogel.qqdl.site',
                ],
                streaming: [
                    'https://arran.monochrome.tf',
                    'https://triton.squid.wtf',
                    'https://wolf.qqdl.site',
                    'https://maus.qqdl.site',
                    'https://vogel.qqdl.site',
                    'https://katze.qqdl.site',
                    'https://hund.qqdl.site',
                    'https://tidal.kinoplus.online',
                    'https://tidal-api.binimum.org',
                    'https://hifi-one.spotisaver.net',
                    'https://hifi-two.spotisaver.net',
                ],
            };
            this.instancesLoaded = true;
            return this.defaultInstances;
        }
    },

    async speedTestInstance(url, type = 'api') {
        let testUrl;
        if (type === 'streaming') {
            testUrl = url.endsWith('/')
                ? `${url}track/?id=204567804&quality=HIGH`
                : `${url}/track/?id=204567804&quality=HIGH`;
        } else {
            testUrl = url.endsWith('/')
                ? `${url}artist/?id=3532302`
                : `${url}/artist/?id=3532302`;
        }

        const startTime = performance.now();

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(testUrl, {
                signal: controller.signal,
                cache: 'no-store',
            });

            clearTimeout(timeout);

            if (!response.ok) {
                return { url, type, speed: Infinity, error: `HTTP ${response.status}` };
            }

            const endTime = performance.now();
            const speed = endTime - startTime;

            return { url, type, speed, error: null };
        } catch (error) {
            return { url, type, speed: Infinity, error: error.message };
        }
    },

    getCachedSpeedTests() {
        try {
            const cached = localStorage.getItem(this.SPEED_TEST_CACHE_KEY);
            if (!cached) return { speeds: {}, timestamp: Date.now() };

            const data = JSON.parse(cached);

            if (Date.now() - data.timestamp > this.SPEED_TEST_CACHE_DURATION) {
                return { speeds: {}, timestamp: Date.now() };
            }

            return data;
        } catch {
            return { speeds: {}, timestamp: Date.now() };
        }
    },

    updateSpeedCache(newResults) {
        const currentCache = this.getCachedSpeedTests();

        newResults.forEach((r) => {
            const key = r.type === 'streaming' ? `${r.url}#streaming` : r.url;
            currentCache.speeds[key] = { speed: r.speed, error: r.error };
        });

        currentCache.timestamp = Date.now();

        try {
            localStorage.setItem(this.SPEED_TEST_CACHE_KEY, JSON.stringify(currentCache));
        } catch {
            console.warn('[SpeedTest] Failed to cache results');
        }

        return currentCache;
    },

    async testSpecificUrls(urls, type) {
        if (!urls || urls.length === 0) return [];
        console.log(`[SpeedTest] Testing ${urls.length} instances for ${type}...`);

        const results = await Promise.all(urls.map((url) => this.speedTestInstance(url, type)));

        const validResults = results.filter((r) => r.speed !== Infinity);
        console.log(
            `[SpeedTest] ${type} Results:`,
            validResults.map((r) => `${r.url}: ${r.speed.toFixed(0)}ms`)
        );

        return results;
    },

    async getInstances(type = 'api') {
        let instancesObj;

        const stored = localStorage.getItem(this.STORAGE_KEY);
        if (stored) {
            instancesObj = JSON.parse(stored);

            if (instancesObj?.api?.length === 2) {
                const hasBinimum = instancesObj.api.some((url) => url.includes('tidal-api.binimum.org'));
                const hasSamidy = instancesObj.api.some((url) => url.includes('monochrome-api.samidy.com'));

                if (hasBinimum && hasSamidy) {
                    localStorage.removeItem(this.STORAGE_KEY);
                    instancesObj = null;
                }
            }
        }

        if (!instancesObj) {
            instancesObj = await this.loadInstancesFromGitHub();
        }

        const targetUrls = instancesObj[type] || instancesObj.api || [];
        if (targetUrls.length === 0) return [];

        const speedCache = this.getCachedSpeedTests();
        const getCacheKey = (u) => (type === 'streaming' ? `${u}#streaming` : u);

        const hasCachedData = targetUrls.some((url) => speedCache.speeds[getCacheKey(url)]);

        if (hasCachedData) {
            const sortedList = [...targetUrls].sort((a, b) => {
                const speedA = speedCache.speeds[getCacheKey(a)]?.speed ?? Infinity;
                const speedB = speedCache.speeds[getCacheKey(b)]?.speed ?? Infinity;
                return speedA - speedB;
            });
            return sortedList;
        }

        return targetUrls;
    },

    async refreshSpeedTests() {
        const instances = await this.loadInstancesFromGitHub();
        const promises = [];

        if (instances.api && instances.api.length) {
            promises.push(this.testSpecificUrls(instances.api, 'api'));
        }

        if (instances.streaming && instances.streaming.length) {
            promises.push(this.testSpecificUrls(instances.streaming, 'streaming'));
        }

        const resultsArray = await Promise.all(promises);
        const allResults = resultsArray.flat();

        this.updateSpeedCache(allResults);

        return this.getInstances('api');
    },
    saveInstances(instances, type) {
        if (type) {
            try {
                const stored = localStorage.getItem(this.STORAGE_KEY);
                let fullObj = stored ? JSON.parse(stored) : { api: [], streaming: [] };
                fullObj[type] = instances;
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(fullObj));
            } catch (e) {
                console.error('Failed to save instances:', e);
            }
        } else {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(instances));
        }
    },
};

// Pre-warm instances eagerly at module load - eliminates waterfall on first API call
apiSettings.loadInstancesFromGitHub();

export const recentActivityManager = {
    STORAGE_KEY: 'monochrome-recent-activity',
    LIMIT: 10,

    _get() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            const parsed = data ? JSON.parse(data) : { artists: [], albums: [], playlists: [], mixes: [] };
            if (!parsed.playlists) parsed.playlists = [];
            if (!parsed.mixes) parsed.mixes = [];
            return parsed;
        } catch {
            return { artists: [], albums: [], playlists: [], mixes: [] };
        }
    },

    _save(data) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    },

    getRecents() {
        return this._get();
    },

    _add(type, item) {
        const data = this._get();
        data[type] = data[type].filter((i) => i.id !== item.id);
        data[type].unshift(item);
        data[type] = data[type].slice(0, this.LIMIT);
        this._save(data);
    },

    clear() {
        this._save({ artists: [], albums: [], playlists: [], mixes: [] });
    },

    addArtist(artist) {
        this._add('artists', artist);
    },

    addAlbum(album) {
        this._add('albums', album);
    },

    addPlaylist(playlist) {
        this._add('playlists', playlist);
    },

    addMix(mix) {
        this._add('mixes', mix);
    },
};

// ============================================
// Hardcoded settings (no UI, no localStorage)
// ============================================

export const themeManager = {
    STORAGE_KEY: 'monochrome-theme',
    CUSTOM_THEME_KEY: 'monochrome-custom-theme',

    defaultThemes: {
        light: {},
        dark: {},
        monochrome: {},
        ocean: {},
        purple: {},
        forest: {},
        mocha: {},
        machiatto: {},
        frappe: {},
        latte: {},
    },

    getTheme() {
        return 'dark';
    },

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme || 'dark');
    },

    getCustomTheme() {
        return null;
    },

    setCustomTheme() {},

    applyCustomTheme() {},
};

// Scrobbling stubs (disabled, kept for import compatibility)
export const lastFMStorage = {
    isEnabled() { return false; },
    setEnabled() {},
    shouldLoveOnLike() { return false; },
    setLoveOnLike() {},
};

export const nowPlayingSettings = {
    getMode() { return 'expanded'; },
    setMode() {},
};

export const lyricsSettings = {
    shouldDownloadLyrics() { return false; },
    setDownloadLyrics() {},
};

export const backgroundSettings = {
    isEnabled() { return true; },
    setEnabled() {},
};

export const cardSettings = {
    isCompactArtist() { return false; },
    setCompactArtist() {},
    isCompactAlbum() { return false; },
    setCompactAlbum() {},
};

export const replayGainSettings = {
    getMode() { return 'off'; },
    setMode() {},
    getPreamp() { return 3; },
    setPreamp() {},
};

export const streamingQualitySettings = {
    STORAGE_KEY: 'tunes-streaming-quality',
    getQuality() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) || 'LOW';
        } catch {
            return 'LOW';
        }
    },
    setQuality(quality) {
        try {
            localStorage.setItem(this.STORAGE_KEY, quality);
        } catch (e) {
            console.error('Failed to save streaming quality:', e);
        }
    },
};

export const downloadQualitySettings = {
    // Downloads ALWAYS use lowest quality — hardcoded, no setting
    getQuality() { return 'LOW'; },
    setQuality() {},
};

export const coverArtSizeSettings = {
    getSize() { return '640'; },
    setSize() {},
};

export const waveformSettings = {
    isEnabled() { return false; },
    setEnabled() {},
};

export const smoothScrollingSettings = {
    isEnabled() { return false; },
    setEnabled() {},
};

export const qualityBadgeSettings = {
    isEnabled() { return false; },
    setEnabled() {},
};

export const trackDateSettings = {
    useAlbumYear() { return true; },
    setUseAlbumYear() {},
};

export const bulkDownloadSettings = {
    shouldForceIndividual() { return true; },
    setForceIndividual() {},
};

export const playlistSettings = {
    shouldGenerateM3U() { return true; },
    shouldGenerateM3U8() { return false; },
    shouldGenerateCUE() { return false; },
    shouldGenerateNFO() { return false; },
    shouldGenerateJSON() { return false; },
    shouldUseRelativePaths() { return true; },
    setGenerateM3U() {},
    setGenerateM3U8() {},
    setGenerateCUE() {},
    setGenerateNFO() {},
    setGenerateJSON() {},
    setUseRelativePaths() {},
};

export const visualizerSettings = {
    getPreset() { return 'lcd'; },
    setPreset() {},
    isEnabled() { return false; },
    setEnabled() {},
    getMode() { return 'solid'; },
    setMode() {},
    getSensitivity() { return 1.0; },
    setSensitivity() {},
    isSmartIntensityEnabled() { return true; },
    setSmartIntensity() {},
};

// Equalizer stub (disabled, kept for import compatibility)
export const equalizerSettings = {
    isEnabled() { return false; },
    setEnabled() {},
    getGains() { return new Array(16).fill(0); },
    setGains() {},
    getPreset() { return 'flat'; },
    setPreset() {},
};

export const sidebarSettings = {
    STORAGE_KEY: 'monochrome-sidebar-collapsed',

    isCollapsed() {
        try {
            return localStorage.getItem(this.STORAGE_KEY) === 'true';
        } catch {
            return false;
        }
    },

    setCollapsed(collapsed) {
        localStorage.setItem(this.STORAGE_KEY, collapsed ? 'true' : 'false');
    },

    restoreState() {
        const isCollapsed = this.isCollapsed();
        if (isCollapsed) {
            document.body.classList.add('sidebar-collapsed');
            const toggleBtn = document.getElementById('sidebar-toggle');
            if (toggleBtn) {
                toggleBtn.innerHTML =
                    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
            }
        }
    },
};

export const queueManager = {
    STORAGE_KEY: 'monochrome-queue',

    getQueue() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : null;
        } catch {
            return null;
        }
    },

    saveQueue(queueState) {
        try {
            const minimalState = {
                queue: queueState.queue,
                shuffledQueue: queueState.shuffledQueue,
                originalQueueBeforeShuffle: queueState.originalQueueBeforeShuffle,
                currentQueueIndex: queueState.currentQueueIndex,
                shuffleActive: queueState.shuffleActive,
                repeatMode: queueState.repeatMode,
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(minimalState));
        } catch (e) {
            console.warn('Failed to save queue to localStorage:', e);
        }
    },
};

// Scrobbling stubs (disabled)
export const listenBrainzSettings = {
    isEnabled() { return false; },
    setEnabled() {},
    getToken() { return ''; },
    setToken() {},
    getCustomUrl() { return ''; },
    setCustomUrl() {},
};

export const malojaSettings = {
    isEnabled() { return false; },
    setEnabled() {},
    getToken() { return ''; },
    setToken() {},
    getCustomUrl() { return ''; },
    setCustomUrl() {},
};

export const libreFmSettings = {
    isEnabled() { return false; },
    setEnabled() {},
    shouldLoveOnLike() { return false; },
    setLoveOnLike() {},
};

// Home page sections - all enabled
export const homePageSettings = {
    shouldShowRecommendedSongs() { return true; },
    setShowRecommendedSongs() {},
    shouldShowRecommendedAlbums() { return true; },
    setShowRecommendedAlbums() {},
    shouldShowRecommendedArtists() { return true; },
    setShowRecommendedArtists() {},
    shouldShowJumpBackIn() { return true; },
    setShowJumpBackIn() {},
};

// Sidebar sections - hardcoded visibility
// Hide: settings, account, download, discord
// Show: home, library, recent, unreleased, donate, about
export const sidebarSectionSettings = {
    shouldShowHome() { return true; },
    setShowHome() {},
    shouldShowLibrary() { return true; },
    setShowLibrary() {},
    shouldShowRecent() { return true; },
    setShowRecent() {},
    shouldShowUnreleased() { return true; },
    setShowUnreleased() {},
    shouldShowDonate() { return true; },
    setShowDonate() {},
    shouldShowSettings() { return true; },
    setShowSettings() {},
    shouldShowAccount() { return true; },
    setShowAccount() {},
    shouldShowAbout() { return true; },
    setShowAbout() {},
    shouldShowDownload() { return false; },
    setShowDownload() {},
    shouldShowDiscord() { return false; },
    setShowDiscord() {},

    applySidebarVisibility() {
        const items = [
            { id: 'sidebar-nav-home', check: false },
            { id: 'sidebar-nav-library', check: false },
            { id: 'sidebar-nav-recent', check: false },
            { id: 'sidebar-nav-unreleased', check: false },
            { id: 'sidebar-nav-donate', check: false },
            { id: 'sidebar-nav-settings', check: true },
            { id: 'sidebar-nav-account', check: true },
            { id: 'sidebar-nav-about', check: true },
            { id: 'sidebar-nav-contact', check: true },
            { id: 'sidebar-nav-download', check: false },
            { id: 'sidebar-nav-discord', check: false },
        ];

        items.forEach(({ id, check }) => {
            const el = document.getElementById(id);
            if (el) {
                el.style.display = check ? '' : 'none';
            }
        });
    },
};

// Apply dark theme immediately
if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', 'dark');
}