// js/lyrics.js — Fullscreen lyrics using am-lyrics web component (LyricsPlus API)
import { getTrackTitle, getTrackArtists } from './utils.js';

let _amLyricsEl = null;
let _rafId = null;
let _audioPlayer = null;
let _isOpen = false;
let _currentTrackId = null;
let _swipeStartX = 0;
let _swipeStartY = 0;
let _shadowStyleInjected = false;
let _componentReady = null;

const LEAD_MS = 300;

const IS_NATIVE = !!window.__TUNES_NATIVE__;

const SHADOW_OVERRIDE_CSS = `
    .lyrics-header { display: none !important; }
    .lyrics-footer { display: none !important; }

    /* Keep the just-finished line lit during gaps between lines (no delay) */
    .lyrics-line.post-active-line:not(.active) {
        opacity: 1 !important;
        color: var(--lyplus-text-primary, #fff) !important;
        transition: opacity 2.5s ease, color 2.5s ease !important;
    }

    /* Keep all lines the same size — active line differs by color/glow only */
    .lyrics-line {
        font-size: inherit !important;
    }
    .lyrics-line.active {
        font-size: inherit !important;
    }

    /* Disable scale transform on active line — keeps glow/color, kills size jump */
    .lyrics-line-container {
        transform: none !important;
        transition: transform 0.15s ease-out !important;
    }
    .lyrics-line.active .lyrics-line-container {
        transform: none !important;
    }

    /* Snappy scroll to active line */
    .lyrics-container {
        scroll-behavior: smooth;
        transition: scroll-position 0.15s ease-out;
    }
` + (IS_NATIVE ? `
    /* Native: kill expensive per-line blur, use opacity dimming only */
    .lyrics-container.blur-inactive-enabled .lyrics-line:not(.active):not(.lyrics-gap) {
        filter: none !important;
    }
    .lyrics-container.blur-inactive-enabled:not(.not-focused) .lyrics-line.post-active-line:not(.lyrics-gap):not(.active),
    .lyrics-container.blur-inactive-enabled:not(.not-focused) .lyrics-line.next-active-line:not(.lyrics-gap):not(.active),
    .lyrics-container.blur-inactive-enabled:not(.not-focused) .lyrics-line.lyrics-activest:not(.active):not(.lyrics-gap) {
        filter: none !important;
    }
    /* Disable backdrop-filter inside component on native */
    * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
` : '');

function _getOverlay() {
    return document.getElementById('lyrics-fullscreen-overlay');
}

function _getContentEl() {
    return document.getElementById('lyrics-fs-content');
}

function _waitForComponent() {
    if (_componentReady) return _componentReady;
    _componentReady = Promise.race([
        customElements.whenDefined('am-lyrics'),
        new Promise(r => setTimeout(r, 5000))
    ]).catch(() => {});
    return _componentReady;
}

function _injectShadowStyles(el) {
    if (_shadowStyleInjected) return;
    const tryInject = () => {
        const root = el.shadowRoot;
        if (!root) return false;
        const style = document.createElement('style');
        style.textContent = SHADOW_OVERRIDE_CSS;
        root.appendChild(style);
        _shadowStyleInjected = true;
        return true;
    };
    if (!tryInject()) {
        const obs = new MutationObserver(() => {
            if (tryInject()) obs.disconnect();
        });
        obs.observe(el, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), 8000);
    }
}

async function _ensureAmLyrics() {
    const content = _getContentEl();
    if (!content) return null;

    await _waitForComponent();

    if (_amLyricsEl && content.contains(_amLyricsEl)) {
        _injectShadowStyles(_amLyricsEl);
        return _amLyricsEl;
    }

    content.innerHTML = '';

    _amLyricsEl = document.createElement('am-lyrics');
    _amLyricsEl.setAttribute('highlight-color', '#fff');
    _amLyricsEl.setAttribute('hover-background-color', 'rgba(255,255,255,0.08)');
    _amLyricsEl.setAttribute('font-family', "'Bricolage Grotesque','DM Sans',sans-serif");
    _amLyricsEl.setAttribute('autoscroll', '');
    _amLyricsEl.setAttribute('interpolate', '');
    _amLyricsEl.style.height = '100%';
    _amLyricsEl.style.width = '100%';

    _amLyricsEl.addEventListener('line-click', (e) => {
        if (_audioPlayer && e.detail?.timestamp != null) {
            _audioPlayer.currentTime = e.detail.timestamp / 1000;
            if (_audioPlayer.paused) _audioPlayer.play();
        }
    });

    content.appendChild(_amLyricsEl);
    _shadowStyleInjected = false;
    _injectShadowStyles(_amLyricsEl);
    return _amLyricsEl;
}

function _startSyncLoop() {
    _stopSyncLoop();
    let lastUpdate = 0;
    const interval = IS_NATIVE ? 33 : 16;
    const tick = (now) => {
        if (_amLyricsEl && _audioPlayer && !_audioPlayer.paused) {
            if (now - lastUpdate >= interval) {
                _amLyricsEl.currentTime = (_audioPlayer.currentTime * 1000) + LEAD_MS;
                lastUpdate = now;
            }
        }
        _rafId = requestAnimationFrame(tick);
    };
    _rafId = requestAnimationFrame(tick);
}

function _stopSyncLoop() {
    if (_rafId) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
}

function _setBackground(track, api) {
    const overlay = _getOverlay();
    if (!overlay) return;
    const bg = overlay.querySelector('.lyrics-fs-bg');
    if (!bg) return;

    const coverId = track.album?.cover || track.cover;
    if (coverId && api) {
        bg.style.backgroundImage = `url(${api.getCoverUrl(coverId, '640')})`;
    } else {
        bg.style.backgroundImage = 'none';
    }
}

function _setTrackInfo(track) {
    const titleEl = document.getElementById('lyrics-fs-title');
    const artistEl = document.getElementById('lyrics-fs-artist');
    const albumEl = document.getElementById('lyrics-fs-album');
    if (titleEl) titleEl.textContent = getTrackTitle(track);
    if (artistEl) artistEl.textContent = getTrackArtists(track);
    if (albumEl) albumEl.textContent = track.album?.title || '';
}

function _refreshFullscreenPlayerUI() {
    const playBtn = document.getElementById('fs-play-pause-btn');
    const progressFill = document.getElementById('fs-progress-fill');
    const currentTimeEl = document.getElementById('fs-current-time');

    if (!_audioPlayer) return;

    if (playBtn) {
        if (_audioPlayer.paused) {
            playBtn.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6.906 4c-.85-.53-1.906.08-1.906 1.08v13.84c0 1 1.056 1.61 1.906 1.08l11.094-6.92c.81-.505.81-1.655 0-2.16L6.906 4z"/></svg>';
        } else {
            playBtn.innerHTML =
                '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="5" height="18" rx="1.5"/><rect x="14" y="3" width="5" height="18" rx="1.5"/></svg>';
        }
    }

    const dur = _audioPlayer.duration || 0;
    const cur = _audioPlayer.currentTime || 0;
    if (dur > 0) {
        if (progressFill) progressFill.style.width = `${(cur / dur) * 100}%`;
        if (currentTimeEl) {
            const m = Math.floor(cur / 60);
            const s = Math.floor(cur % 60);
            currentTimeEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
        }
    }
}

export async function openLyricsFullscreen(track, audioPlayer, api) {
    if (!track) return;
    const overlay = _getOverlay();
    if (!overlay) return;

    try {
        _audioPlayer = audioPlayer;
        _currentTrackId = track.id;

        _setBackground(track, api);
        _setTrackInfo(track);

        overlay.style.display = 'flex';
        document.body.classList.add('lyrics-fs-open');
        _isOpen = true;

        if (window.__TUNES_NATIVE__ && window.NativeBridge) {
            window.NativeBridge.call('setRefreshEnabled', { enabled: false }).catch(() => {});
        }

        if (!window.location.hash.includes('lyrics')) {
            window.history.pushState({ lyricsFullscreen: true }, '', '#lyrics');
        }

        const el = await _ensureAmLyrics();
        if (!el || !_isOpen) return;

        const title = track.title || '';
        const artist = Array.isArray(track.artists)
            ? track.artists.map(a => a.name || a).join(', ')
            : track.artist?.name || '';
        const album = track.album?.title || '';
        const duration = track.duration ? Math.round(track.duration * 1000) : undefined;

        el.setAttribute('song-title', title);
        el.setAttribute('song-artist', artist);
        if (album) el.setAttribute('song-album', album);
        if (duration) el.setAttribute('song-duration', String(duration));
        el.setAttribute('query', `${title} ${artist}`);

        if (audioPlayer && !audioPlayer.paused) {
            el.currentTime = (audioPlayer.currentTime * 1000) + LEAD_MS;
        } else {
            el.currentTime = 0;
        }

        _startSyncLoop();
    } catch (err) {
        console.error('[Lyrics] Failed to open fullscreen lyrics:', err);
        closeLyricsFullscreen();
    }
}

export function closeLyricsFullscreen() {
    if (!_isOpen) return;
    const overlay = _getOverlay();
    if (!overlay) return;

    _stopSyncLoop();
    overlay.style.display = 'none';
    document.body.classList.remove('lyrics-fs-open');
    _isOpen = false;

    if (_amLyricsEl) {
        _amLyricsEl.setAttribute('duration', '-1');
    }

    if (window.location.hash === '#lyrics') {
        window.history.back();
    }

    requestAnimationFrame(() => _refreshFullscreenPlayerUI());
}

export function isLyricsOpen() {
    return _isOpen;
}

export async function updateLyricsTrack(track, api) {
    if (!_isOpen || !track || !_amLyricsEl) return;
    if (track.id === _currentTrackId) return;
    _currentTrackId = track.id;

    const title = track.title || '';
    const artist = Array.isArray(track.artists)
        ? track.artists.map(a => a.name || a).join(', ')
        : track.artist?.name || '';
    const album = track.album?.title || '';
    const duration = track.duration ? Math.round(track.duration * 1000) : undefined;

    _amLyricsEl.setAttribute('song-title', title);
    _amLyricsEl.setAttribute('song-artist', artist);
    if (album) _amLyricsEl.setAttribute('song-album', album);
    if (duration) _amLyricsEl.setAttribute('song-duration', String(duration));
    _amLyricsEl.setAttribute('query', `${title} ${artist}`);

    _amLyricsEl.currentTime = 0;

    _setBackground(track, api);
    _setTrackInfo(track);
}

export function initLyricsOverlayGestures() {
    const overlay = _getOverlay();
    if (!overlay) return;

    overlay.addEventListener('touchstart', (e) => {
        _swipeStartX = e.touches[0].clientX;
        _swipeStartY = e.touches[0].clientY;
    }, { passive: true });

    overlay.addEventListener('touchend', (e) => {
        const dx = (e.changedTouches[0]?.clientX || 0) - _swipeStartX;
        const dy = (e.changedTouches[0]?.clientY || 0) - _swipeStartY;
        if (dy > 120 && Math.abs(dx) < 80) closeLyricsFullscreen();
        if (dx > 80 && Math.abs(dy) < 80 && _swipeStartX < 40) closeLyricsFullscreen();
    }, { passive: true });
}

export class LyricsManager {
    constructor() {}
    async fetchLyrics() { return null; }
}
export function openLyricsPanel() {}
export function clearLyricsPanelSync() {}
