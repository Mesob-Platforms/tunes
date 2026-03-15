// js/networkMonitor.js — Unified network monitoring for web & native (Capacitor)
//
// On native Android, uses @capacitor/network for reliable detection.
// On web, falls back to navigator.onLine + online/offline events.
// Provides a persistent offline banner and a "back online" toast.

import { isNative, apiUrl } from './platform.js';

let _isOnline = isNative ? true : navigator.onLine;
let _offlineBanner = null;
let _listeners = [];

/**
 * Register a callback for network status changes.
 * @param {(isOnline: boolean) => void} fn
 */
export function onNetworkChange(fn) {
    _listeners.push(fn);
}

/** Current connectivity state */
export function isOnline() {
    return _isOnline;
}

/**
 * Initialize network monitoring.
 * On native, installs Capacitor Network listener.
 * On web, uses browser online/offline events.
 */
export async function initNetworkMonitor() {
    if (isNative && window.NativeBridge) {
        try {
            const status = await window.NativeBridge.callAsync('getNetworkStatus');
            _setOnline(status.connected !== false);

            window.NativeBridge.on('networkChange', (data) => {
                _setOnline(data.connected);
            });

            console.log('[NetworkMonitor] Native listener active, connected:', status.connected);
        } catch (e) {
            console.warn('[NetworkMonitor] NativeBridge unavailable, using browser events', e);
            _initBrowserListeners();
        }
    } else {
        _initBrowserListeners();
    }

    if (!isNative && !_isOnline) {
        _showOfflineBanner();
    }
}

/** Fallback: browser online/offline events */
function _initBrowserListeners() {
    window.addEventListener('online', () => _setOnline(true));
    window.addEventListener('offline', () => _setOnline(false));
}

/**
 * Update the online state and fire UI + listeners.
 */
function _setOnline(connected) {
    const wasOffline = !_isOnline;
    _isOnline = connected;

    if (connected && wasOffline) {
        if (!isNative) _hideOfflineBanner();
        if (!isNative) _showBackOnlineToast();
        console.log('[NetworkMonitor] Back online');
    } else if (!connected && !wasOffline) {
        if (!isNative) _showOfflineBanner();
        console.log('[NetworkMonitor] Gone offline');
    }

    // Notify registered listeners
    for (const fn of _listeners) {
        try { fn(connected); } catch (_) { /* ignore */ }
    }
}

/* ── Persistent Offline Banner ── */

function _showOfflineBanner() {
    if (_offlineBanner) return; // already showing

    _offlineBanner = document.createElement('div');
    _offlineBanner.className = 'offline-banner';
    _offlineBanner.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
        <span>No internet connection</span>
    `;
    document.body.appendChild(_offlineBanner);

    // Animate in
    requestAnimationFrame(() => {
        _offlineBanner.classList.add('visible');
    });
}

function _hideOfflineBanner() {
    if (!_offlineBanner) return;
    _offlineBanner.classList.remove('visible');
    _offlineBanner.classList.add('hiding');
    const el = _offlineBanner;
    _offlineBanner = null;
    setTimeout(() => el.remove(), 350);
}

/* ── "Back Online" Toast ── */

function _showBackOnlineToast() {
    const toast = document.createElement('div');
    toast.className = 'online-toast';
    toast.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
        <span>Back online</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
        toast.classList.remove('visible');
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 350);
    }, 2500);
}

/* ── Version-based cache clear on update ── */

const BUILD_VERSION_KEY = 'tunes_build_version';

/**
 * Check if the app was updated (new APK or new build).
 * If so, clear stale API response caches from IndexedDB.
 */
export async function checkAndClearStaleCache() {
    try {
        // __BUILD_TIMESTAMP__ is injected by Vite at build time
        const currentBuild = typeof __BUILD_TIMESTAMP__ !== 'undefined'
            ? __BUILD_TIMESTAMP__
            : 'dev';

        const storedBuild = localStorage.getItem(BUILD_VERSION_KEY);

        if (storedBuild && storedBuild !== currentBuild) {
            console.log(`[CacheClear] Build changed: ${storedBuild} → ${currentBuild}. Clearing stale caches.`);

            // 1. Clear API response cache (IndexedDB)
            await _clearIndexedDBCache('api_cache');

            // 1b. Clear stale homepage HTML cache
            await _clearObjectStore('MonochromeDB', 'home_cache');
            await _clearObjectStore('MonochromeDB', 'page_cache');

            // 2. Clear Service Worker runtime caches (if any)
            if ('caches' in window) {
                const keys = await caches.keys();
                const staleCaches = keys.filter(k =>
                    k.startsWith('lyrics-api') ||
                    k.startsWith('genius-api') ||
                    k.startsWith('cdn-scripts') ||
                    k.startsWith('cdn-unpkg') ||
                    k.startsWith('images')
                );
                await Promise.all(staleCaches.map(k => caches.delete(k)));
                if (staleCaches.length > 0) {
                    console.log(`[CacheClear] Cleared ${staleCaches.length} SW runtime caches`);
                }
            }

            // 3. Clear stale localStorage entries (keep auth, settings, favorites)
            _clearStaleLocalStorage();

            console.log('[CacheClear] Stale cache cleanup complete');
        }

        // Store current build version
        localStorage.setItem(BUILD_VERSION_KEY, currentBuild);
    } catch (e) {
        console.warn('[CacheClear] Failed to check/clear cache:', e);
    }
}

/** Delete all records from an IndexedDB object store */
async function _clearIndexedDBCache(dbName) {
    return new Promise((resolve) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
            const db = req.result;
            const storeNames = Array.from(db.objectStoreNames);
            if (storeNames.length === 0) {
                db.close();
                resolve();
                return;
            }
            try {
                const tx = db.transaction(storeNames, 'readwrite');
                for (const name of storeNames) {
                    tx.objectStore(name).clear();
                }
                tx.oncomplete = () => {
                    console.log(`[CacheClear] Cleared IndexedDB "${dbName}" (${storeNames.join(', ')})`);
                    db.close();
                    resolve();
                };
                tx.onerror = () => { db.close(); resolve(); };
            } catch (_) {
                db.close();
                resolve();
            }
        };
        req.onerror = () => resolve();
    });
}

/** Clear a single object store inside an existing IndexedDB database */
async function _clearObjectStore(dbName, storeName) {
    return new Promise((resolve) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
            const database = req.result;
            if (!database.objectStoreNames.contains(storeName)) {
                database.close();
                resolve();
                return;
            }
            try {
                const tx = database.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).clear();
                tx.oncomplete = () => {
                    console.log(`[CacheClear] Cleared "${storeName}" in "${dbName}"`);
                    database.close();
                    resolve();
                };
                tx.onerror = () => { database.close(); resolve(); };
            } catch (_) { database.close(); resolve(); }
        };
        req.onerror = () => resolve();
    });
}

/** Remove only stale localStorage keys; keep auth/settings/favorites */
function _clearStaleLocalStorage() {
    const KEEP_PREFIXES = [
        'tunes_build_version',
        'auth_',
        'supabase.',
        'sb-',
        'apiSettings',
        'themeSettings',
        'downloadQuality',
        'sidebarSettings',
        'replayGainSettings',
        'crossfadeSettings',
        'streamingQuality',
        'lastfm_',
        'listenbrainz_',
        'librefm_',
        'maloja_',
        'pocketbase_',
    ];

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const keep = KEEP_PREFIXES.some(p => key.startsWith(p));
        if (!keep) {
            // Also keep a few exact keys
            if (key === 'theme' || key === 'audioQuality') continue;
            keysToRemove.push(key);
        }
    }

    for (const key of keysToRemove) {
        localStorage.removeItem(key);
    }

    if (keysToRemove.length > 0) {
        console.log(`[CacheClear] Removed ${keysToRemove.length} stale localStorage entries`);
    }
}


