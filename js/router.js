//router.js
import { getTrackArtists } from './utils.js';
import { isNative } from './platform.js';
import { isOnline } from './networkMonitor.js';

let _currentRoute = null;

/**
 * On native (file:// protocol), pushState may silently fail or throw.
 * _currentRoute tracks the intended path independently of the actual URL,
 * so the router always knows which page the user navigated to.
 */
export function getCurrentPath() {
    return _currentRoute || window.location.pathname;
}

export function navigate(path) {
    if (path === getCurrentPath()) {
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
    }
    _currentRoute = path;
    try {
        window.history.pushState({}, '', path);
    } catch (e) {
        // pushState can throw SecurityError on file:// (opaque origin)
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
}

export function createRouter(ui) {
    const router = async () => {
        const { authManager } = window.__tunesRefs || {};
        if (!isNative && authManager && authManager._sessionRestored && !authManager.user) {
            if (authManager._hasAnyPriorSession?.() || localStorage.getItem('tunes_was_signed_in') === 'true') {
                /* allow navigation for previously authenticated users */
            } else {
                return;
            }
        }

        if (window.location.hash && window.location.hash.length > 1) {
            const hash = window.location.hash.substring(1);
            if (hash.includes('/')) {
                const newPath = hash.startsWith('/') ? hash : '/' + hash;
                _currentRoute = newPath;
                try { window.history.replaceState(null, '', newPath); } catch {}
            }
        }

        let path = getCurrentPath();

        if (path.startsWith('/')) path = path.substring(1);
        if (path.endsWith('/')) path = path.substring(0, path.length - 1);
        if (path === '' || path.endsWith('index.html')) path = 'home';

        const parts = path.split('/');
        const page = parts[0];
        const param = parts.slice(1).join('/');

        try {
            switch (page) {
                case 'search':
                    await ui.renderSearchPage(decodeURIComponent(param));
                    break;
                case 'album':
                    await ui.renderAlbumPage(param);
                    break;
                case 'artist':
                    await ui.renderArtistPage(param);
                    break;
                case 'playlist':
                    await ui.renderPlaylistPage(param, 'api');
                    break;
                case 'userplaylist':
                    await ui.renderPlaylistPage(param, 'user');
                    break;
                case 'mix':
                    await ui.renderMixPage(param);
                    break;
                case 'track':
                    _currentRoute = '/';
                    try { window.history.replaceState(null, '', '/'); } catch {}
                    await ui.renderHomePage();
                    break;
                case 'library':
                    await ui.renderLibraryPage();
                    break;
                case 'recent':
                    _currentRoute = '/library';
                    try { window.history.replaceState(null, '', '/library'); } catch {}
                    await ui.renderLibraryPage();
                    break;
                case 'wrapped':
                    await ui.renderWrappedPage();
                    break;
                case 'account':
                    await ui.renderAccountPage();
                    break;
                case 'admin':
                    await ui.renderAdminPage();
                    break;
                case 'settings':
                    ui.showPage('settings');
                    break;
                case 'explore':
                    await ui.renderSearchPage('');
                    break;
                case 'home':
                    await ui.renderHomePage();
                    break;
                case 'about':
                case 'contact':
                default:
                    ui.showPage(page);
                    break;
            }
        } catch (routeErr) {
            console.error(`[Router] Failed to render page "${page}":`, routeErr);
            ui.showPage(page);
        }
    };

    return router;
}

export function updateTabTitle(player) {
    if (player.currentTrack) {
        const track = player.currentTrack;
        document.title = `${track.title} • ${getTrackArtists(track)}`;
    } else {
        const path = getCurrentPath();
        if (path.startsWith('/album/') || path.startsWith('/playlist/')) {
            return;
        }
        document.title = 'Tunes';
    }
}
