//router.js
import { getTrackArtists } from './utils.js';

export function navigate(path) {
    if (path === window.location.pathname) {
        return;
    }
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
}

export function createRouter(ui) {
    const router = async () => {
        const { authManager } = window.__tunesRefs || {};
        if (authManager && authManager._sessionRestored && !authManager.user) {
            return;
        }

        if (window.location.hash && window.location.hash.length > 1) {
            const hash = window.location.hash.substring(1);
            if (hash.includes('/')) {
                const newPath = hash.startsWith('/') ? hash : '/' + hash;
                window.history.replaceState(null, '', newPath);
            }
        }

        let path = window.location.pathname;

        if (path.startsWith('/')) path = path.substring(1);
        if (path.endsWith('/')) path = path.substring(0, path.length - 1);
        if (path === '' || path === 'index.html') path = 'home';

        const parts = path.split('/');
        const page = parts[0];
        const param = parts.slice(1).join('/');

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
                window.history.replaceState(null, '', '/');
                await ui.renderHomePage();
                break;
            case 'library':
                await ui.renderLibraryPage();
                break;
            case 'recent':
                // Redirect /recent to /library (recent is now a tab inside library)
                window.history.replaceState(null, '', '/library');
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
    };

    return router;
}

export function updateTabTitle(player) {
    if (player.currentTrack) {
        const track = player.currentTrack;
        document.title = `${track.title} • ${getTrackArtists(track)}`;
    } else {
        const path = window.location.pathname;
        if (path.startsWith('/album/') || path.startsWith('/playlist/')) {
            return;
        }
        document.title = 'Tunes';
    }
}