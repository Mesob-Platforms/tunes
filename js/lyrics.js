//js/lyrics.js
import { getTrackTitle, getTrackArtists, buildTrackFilename, SVG_CLOSE } from './utils.js';
import { sidePanelManager } from './side-panel.js';
import { db as musicDB } from './db.js';

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
                let purged = false;
                for (const [k, v] of entries) {
                    if (v && v.lyricsProvider === 'LRCLIB' && !v.wordSynced) {
                        this._mem.set(k, v);
                    } else {
                        purged = true;
                    }
                }
                if (purged) this._saveToStorage();
            }
        } catch { /* ignore corrupt data */ }
    }

    _saveToStorage() {
        try {
            const entries = Array.from(this._mem.entries());
            while (entries.length > this.maxEntries) entries.shift();
            localStorage.setItem(this.storageKey, JSON.stringify(entries));
        } catch { /* storage full */ }
    }

    has(key) { return this._mem.has(key); }
    get(key) { return this._mem.get(key); }

    set(key, value) {
        this._mem.set(key, value);
        if (this._mem.size > this.maxEntries) {
            const firstKey = this._mem.keys().next().value;
            this._mem.delete(firstKey);
        }
        this._saveToStorage();
    }
}

export class LyricsManager {
    constructor(api) {
        this.api = api;
        this.currentLyrics = null;
        this.syncedLyrics = [];
        this.lyricsCache = new LyricsStorageCache('lyricsCache', 200);
        this.componentLoaded = false;
        this.currentTrackId = null;
        this.timingOffset = 0;
    }

    getTimingOffset(trackId) {
        try {
            const stored = localStorage.getItem(`lyrics-offset-${trackId}`);
            return stored ? parseInt(stored, 10) : 0;
        } catch { return 0; }
    }

    setTimingOffset(trackId, offsetMs) {
        try { localStorage.setItem(`lyrics-offset-${trackId}`, offsetMs.toString()); }
        catch (e) { console.warn('Failed to save lyrics timing offset:', e); }
    }

    resetTimingOffset(trackId) { this.setTimingOffset(trackId, 0); }

    getOffsetDisplayString(offsetMs) {
        const sign = offsetMs >= 0 ? '+' : '';
        return `${sign}${(Math.abs(offsetMs) / 1000).toFixed(1)}s`;
    }

    async fetchLrclib(track) {
        const artist = Array.isArray(track.artists)
            ? track.artists.map(a => a.name || a).join(', ')
            : track.artist?.name || '';
        const title = track.title || '';
        const album = track.album?.title || '';
        const duration = track.duration ? Math.round(track.duration) : null;
        if (!title || !artist) return null;
        try {
            const params = new URLSearchParams({ track_name: title, artist_name: artist });
            if (album) params.append('album_name', album);
            if (duration) params.append('duration', duration.toString());
            const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
            if (!response.ok) return null;
            const data = await response.json();
            if (data.syncedLyrics || data.plainLyrics) {
                return {
                    subtitles: data.syncedLyrics || null,
                    plainLyrics: data.plainLyrics || null,
                    lyricsProvider: 'LRCLIB',
                };
            }
        } catch (e) { console.warn('LRCLIB fetch failed:', e); }
        return null;
    }

    _isValidLrclibData(data) {
        if (!data || data.lyricsProvider !== 'LRCLIB') return false;
        if (data.wordSynced) return false;
        return true;
    }

    async fetchLyrics(trackId, track = null) {
        if (!track) return null;

        if (this.lyricsCache.has(trackId)) {
            const memCached = this.lyricsCache.get(trackId);
            if (this._isValidLrclibData(memCached)) return memCached;
        }

        try {
            await musicDB.open();
            const cached = await musicDB.getCachedLyrics(trackId);
            if (cached && this._isValidLrclibData(cached)) {
                this.lyricsCache.set(trackId, cached);
                return cached;
            }
            if (cached) {
                try { await musicDB.deleteCachedLyrics?.(trackId); } catch {}
            }
        } catch (e) { console.warn('IndexedDB lyrics read failed:', e); }

        if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

        try {
            const lrclib = await this.fetchLrclib(track);
            if (lrclib) {
                this.lyricsCache.set(trackId, lrclib);
                try { await musicDB.cacheLyrics(trackId, lrclib); } catch {}
                return lrclib;
            }
        } catch (e) { console.warn('LRCLIB fetch failed:', e); }

        return null;
    }

    parseSyncedLyrics(subtitles) {
        if (!subtitles) return [];
        return subtitles.split('\n').filter(l => l.trim()).map(line => {
            const m = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.+)/);
            if (m) {
                const frac = m[3];
                const fracVal = frac.length === 3 ? parseInt(frac) / 1000 : parseInt(frac) / 100;
                const time = parseInt(m[1]) * 60 + parseInt(m[2]) + fracVal;
                return { time, text: m[4].trim() };
            }
            return null;
        }).filter(Boolean);
    }

    generateLRCContent(lyricsData, track) {
        if (!lyricsData || !lyricsData.subtitles) return null;
        let lrc = `[ti:${getTrackTitle(track)}]\n`;
        lrc += `[ar:${getTrackArtists(track)}]\n`;
        lrc += `[al:${track.album?.title || 'Unknown Album'}]\n`;
        lrc += `[by:${lyricsData.lyricsProvider || 'Unknown'}]\n\n`;
        lrc += lyricsData.subtitles;
        return lrc;
    }

    downloadLRC(lyricsData, track) {
        const lrcContent = this.generateLRCContent(lyricsData, track);
        if (!lrcContent) { return; }
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
        let idx = -1;
        for (let i = 0; i < this.syncedLyrics.length; i++) {
            if (currentTime >= this.syncedLyrics[i].time) idx = i;
            else break;
        }
        return idx;
    }
}

/* ================================================================
   PANEL ENTRY POINT
   ================================================================ */

export function openLyricsPanel(track, audioPlayer, lyricsManager, forceOpen = false) {
    const manager = lyricsManager || new LyricsManager();
    manager.timingOffset = manager.getTimingOffset(track.id);

    const renderControls = (container) => {
        container.innerHTML = `<button id="close-side-panel-btn" class="btn-icon" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>`;
        container.querySelector('#close-side-panel-btn').addEventListener('click', () => {
            sidePanelManager.close();
        });
    };

    const renderContent = async (container) => {
        clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        await renderCustomLyrics(container, track, audioPlayer, manager);
        if (container.lyricsCleanup) {
            sidePanelManager.panel.lyricsCleanup = container.lyricsCleanup;
            sidePanelManager.panel.lyricsManager = container.lyricsManager;
        }
        return;
    };

    const songTitle = track.title || 'Unknown';
    const artistName = track.artist?.name || (track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown');
    const albumName = track.album?.title || '';

    if (sidePanelManager._lyricsPopHandler) {
        window.removeEventListener('popstate', sidePanelManager._lyricsPopHandler);
        sidePanelManager._lyricsPopHandler = null;
    }
    if (!sidePanelManager._originalClose) {
        sidePanelManager._originalClose = sidePanelManager.close.bind(sidePanelManager);
    }

    const coverId = track.album?.cover || track.cover;
    if (coverId && manager.api) {
        const coverUrl = manager.api.getCoverUrl(coverId, '320');
        sidePanelManager.panel.style.setProperty('--lyrics-bg', `url(${coverUrl})`);
    } else {
        sidePanelManager.panel.style.removeProperty('--lyrics-bg');
    }

    sidePanelManager.open('lyrics', songTitle, renderControls, renderContent, forceOpen);

    if (!window.location.hash.includes('lyrics')) {
        window.history.pushState({ lyricsPanel: true }, '', '#lyrics');
    }

    const resetLyricsToggle = () => {
        const btn = document.getElementById('toggle-fullscreen-lyrics-btn');
        if (btn) btn.classList.remove('active');
    };

    const onPopState = () => {
        if (sidePanelManager.isActive('lyrics')) {
            sidePanelManager.close();
        }
        window.removeEventListener('popstate', onPopState);
        sidePanelManager._lyricsPopHandler = null;
    };
    sidePanelManager._lyricsPopHandler = onPopState;
    window.addEventListener('popstate', onPopState);

    const origClose = sidePanelManager._originalClose;
    sidePanelManager.close = () => {
        window.removeEventListener('popstate', onPopState);
        sidePanelManager._lyricsPopHandler = null;
        resetLyricsToggle();
        if (window.location.hash === '#lyrics') {
            window.history.back();
        }
        sidePanelManager.close = origClose;
        origClose();
    };

    const titleEl = document.getElementById('side-panel-title');
    if (titleEl) {
        let titleHTML = `<span class="lyrics-title-song">${songTitle.replace(/</g, '&lt;')}</span>`;
        titleHTML += `<span class="lyrics-title-artist">${artistName.replace(/</g, '&lt;')}</span>`;
        if (albumName) titleHTML += `<span class="lyrics-title-album">${albumName.replace(/</g, '&lt;')}</span>`;
        titleEl.innerHTML = titleHTML;
    }
}

/* ================================================================
   LYRICS RENDERER
   ================================================================ */

async function renderCustomLyrics(container, track, audioPlayer, lyricsManager) {
    const errorMsg = (msg) => {
        container.innerHTML = `<div class="lyrics-error" style="font-family:'Bricolage Grotesque','DM Sans',sans-serif;text-align:center;padding:3rem 1.5rem;font-size:1.1rem;color:rgba(255,255,255,0.5);">${msg}</div>`;
        container.lyricsCleanup = () => {};
        container.lyricsManager = lyricsManager;
        return null;
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        try {
            await musicDB.open();
            if (!(await musicDB.getCachedLyrics(track.id))) return errorMsg('No lyrics available offline');
        } catch { return errorMsg('No lyrics available offline'); }
    }

    container.innerHTML = '<div class="lyrics-loading">Loading lyrics...</div>';

    lyricsManager.currentTrackId = track.id;
    const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
    if (!lyricsData) return errorMsg('No lyrics found');

    const subtitles = lyricsData.subtitles;
    let parsed = lyricsManager.parseSyncedLyrics(subtitles);

    if (parsed.length > 1) {
        const uniqueTimes = new Set(parsed.map(l => l.time));
        if (uniqueTimes.size === 1) parsed = [];
    }

    const hasSync = parsed.length > 0;

    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'tunes-lyrics';

    if (!hasSync && lyricsData.plainLyrics) {
        for (const text of lyricsData.plainLyrics.split('\n')) {
            const p = document.createElement('p');
            p.className = 'tl-plain-line';
            p.textContent = text;
            root.appendChild(p);
        }
        container.appendChild(root);
        container.lyricsCleanup = () => {};
        container.lyricsManager = lyricsManager;
        return root;
    }

    if (!hasSync) return errorMsg('No synced lyrics found');

    const lineEls = [];
    for (let i = 0; i < parsed.length; i++) {
        const el = document.createElement('p');
        el.className = 'tl-line';
        el.dataset.idx = i;
        el.innerHTML = wrapParenthesized(parsed[i].text);

        el.addEventListener('click', () => {
            audioPlayer.currentTime = parsed[i].time;
            audioPlayer.play();
        });
        root.appendChild(el);
        lineEls.push(el);
    }

    container.classList.add('lyrics-scroll-mask');
    container.appendChild(root);
    container.scrollTop = 0;

    const cleanup = setupSyncEngine(parsed, lineEls, container, audioPlayer, lyricsManager);

    container.lyricsCleanup = cleanup;
    container.lyricsManager = lyricsManager;

    return root;
}

function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapParenthesized(text) {
    const escaped = escHtml(text);
    return escaped.replace(/(\([^)]*\))/g, '<span class="tl-bg-vocal">$1</span>');
}

/* ================================================================
   SYNC ENGINE — rAF lerp scroll, multi-line active
   ================================================================ */

function setupSyncEngine(parsed, lineEls, scrollEl, audioPlayer, lyricsManager) {
    let activeLineIdx = -1;
    let intervalId = null;
    let isUserScrolling = false;
    let userScrollTimer = null;
    let canScroll = false;
    let initialScrollTimer = null;

    scrollEl.addEventListener('touchstart', () => {
        isUserScrolling = true;
        clearTimeout(userScrollTimer);
    }, { passive: true });
    scrollEl.addEventListener('touchend', () => {
        clearTimeout(userScrollTimer);
        userScrollTimer = setTimeout(() => { isUserScrolling = false; }, 3000);
    }, { passive: true });

    let swipeStartY = 0;
    let swipeStartScrollTop = 0;
    scrollEl.addEventListener('touchstart', (e) => {
        swipeStartY = e.touches[0].clientY;
        swipeStartScrollTop = scrollEl.scrollTop;
    }, { passive: true });
    scrollEl.addEventListener('touchend', (e) => {
        if (swipeStartScrollTop > 30) return;
        const deltaY = (e.changedTouches[0]?.clientY || 0) - swipeStartY;
        if (deltaY > 100) sidePanelManager.close();
    }, { passive: true });

    const getTimingOffset = () => lyricsManager?.timingOffset || 0;

    const setScrollTarget = (lineIdx, instant) => {
        if (lineIdx < 0 || lineIdx >= lineEls.length || isUserScrolling) return;
        const lineRect = lineEls[lineIdx].getBoundingClientRect();
        const containerRect = scrollEl.getBoundingClientRect();
        const lineTop = scrollEl.scrollTop + (lineRect.top - containerRect.top);
        const target = Math.max(0, lineTop - scrollEl.clientHeight * 0.25);
        scrollEl.scrollTop = target;
    };

    const LYRICS_LEAD_SEC = 0.3;
    const MULTI_LINE_GAP = 1.0;

    const update = () => {
        const t = audioPlayer.currentTime - getTimingOffset() / 1000 + LYRICS_LEAD_SEC;
        if (Number.isNaN(t)) return;

        let newIdx = -1;
        for (let i = 0; i < parsed.length; i++) {
            if (t >= parsed[i].time) newIdx = i;
            else break;
        }

        if (newIdx !== activeLineIdx) {
            for (let i = 0; i < lineEls.length; i++) {
                lineEls[i].classList.remove('tl-active');
                if (i < newIdx) {
                    lineEls[i].classList.add('tl-past');
                } else {
                    lineEls[i].classList.remove('tl-past');
                }
            }

            activeLineIdx = newIdx;

            if (activeLineIdx >= 0 && activeLineIdx < lineEls.length) {
                lineEls[activeLineIdx].classList.add('tl-active');

                let multiStart = activeLineIdx;
                while (multiStart > 0 && (parsed[multiStart].time - parsed[multiStart - 1].time) < MULTI_LINE_GAP) {
                    const prevTime = parsed[multiStart - 1].time;
                    if (t >= prevTime && (t - prevTime) < MULTI_LINE_GAP) {
                        multiStart--;
                        lineEls[multiStart].classList.remove('tl-past');
                        lineEls[multiStart].classList.add('tl-active');
                    } else {
                        break;
                    }
                }

                if (canScroll) setScrollTarget(activeLineIdx, false);
            }
        }
    };

    const startInterval = () => { if (!intervalId) intervalId = setInterval(update, 80); };
    const stopInterval = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };

    const onPlay = () => startInterval();
    const onPlaying = () => startInterval();
    const onPause = () => stopInterval();
    const onSeeked = () => {
        activeLineIdx = -1;
        for (const el of lineEls) el.classList.remove('tl-active', 'tl-past');
        if (!audioPlayer.paused) startInterval();
        update();
    };
    const onTimeUpdate = () => {
        if (!intervalId && !audioPlayer.paused) {
            startInterval();
            audioPlayer.removeEventListener('timeupdate', onTimeUpdate);
        }
    };

    audioPlayer.addEventListener('play', onPlay);
    audioPlayer.addEventListener('playing', onPlaying);
    audioPlayer.addEventListener('pause', onPause);
    audioPlayer.addEventListener('seeked', onSeeked);
    audioPlayer.addEventListener('timeupdate', onTimeUpdate);

    if (!audioPlayer.paused && !intervalId) startInterval();

    scrollEl.scrollTop = 0;
    update();

    initialScrollTimer = setTimeout(() => {
        canScroll = true;
        update();
        setScrollTarget(activeLineIdx, true);
    }, 400);

    return () => {
        canScroll = false;
        clearTimeout(initialScrollTimer);
        stopInterval();
        clearTimeout(userScrollTimer);
        audioPlayer.removeEventListener('play', onPlay);
        audioPlayer.removeEventListener('playing', onPlaying);
        audioPlayer.removeEventListener('pause', onPause);
        audioPlayer.removeEventListener('seeked', onSeeked);
        audioPlayer.removeEventListener('timeupdate', onTimeUpdate);
    };
}

/* ================================================================
   EXPORTS
   ================================================================ */

export async function renderLyricsInFullscreen(track, audioPlayer, lyricsManager, container) {
    return renderCustomLyrics(container, track, audioPlayer, lyricsManager);
}

export function clearFullscreenLyricsSync(container) {
    if (container && container.lyricsCleanup) {
        container.lyricsCleanup();
        container.lyricsCleanup = null;
    }
}

export function clearLyricsPanelSync(audioPlayer, panel) {
    if (panel && panel.lyricsCleanup) {
        panel.lyricsCleanup();
        panel.lyricsCleanup = null;
    }
}
