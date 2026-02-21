//js/app.js
import { LosslessAPI } from './api.js';
import { apiSettings, themeManager, downloadQualitySettings, sidebarSettings } from './storage.js';
import { UIRenderer } from './ui.js';
import { Player } from './player.js';
import { MultiScrobbler } from './multi-scrobbler.js';
import { LyricsManager, openLyricsPanel, clearLyricsPanelSync } from './lyrics.js';
import { createRouter, updateTabTitle, navigate } from './router.js';
import { initializePlayerEvents, initializeTrackInteractions, handleTrackAction } from './events.js';
import { initializeUIInteractions } from './ui-interactions.js';
import { debounce, SVG_PLAY } from './utils.js';
import { sidePanelManager } from './side-panel.js';
import { db } from './db.js';
import { syncManager } from './accounts/supabaseSync.js';
import { authManager } from './accounts/auth.js';
import { getAvatarUrl } from './accounts/profile.js';
import { registerSW } from './pwa-stub.js';
import { apiUrl } from './platform.js';
import { initMediaBridge } from './mediaBridge.js';
import { isNative } from './platform.js';
import { initNetworkMonitor, onNetworkChange, checkAndClearStaleCache } from './networkMonitor.js';
import './smooth-scrolling.js';
// Lazy-loaded modules
let settingsModule = null;
let downloadsModule = null;
let trackerModule = null;
let metadataModule = null;

async function loadSettingsModule() {
    if (!settingsModule) {
        settingsModule = await import('./settings.js');
    }
    return settingsModule;
}

async function loadDownloadsModule() {
    if (!downloadsModule) {
        downloadsModule = await import('./downloads.js');
    }
    return downloadsModule;
}

async function loadTrackerModule() {
    if (!trackerModule) {
        trackerModule = await import('./tracker.js');
    }
    return trackerModule;
}

async function loadMetadataModule() {
    if (!metadataModule) {
        metadataModule = await import('./metadata.js');
    }
    return metadataModule;
}

function initializeCasting(audioPlayer, castBtn) {
    if (!castBtn) return;

    if ('remote' in audioPlayer) {
        audioPlayer.remote
            .watchAvailability((available) => {
                if (available) {
                    castBtn.style.display = 'flex';
                    castBtn.classList.add('available');
                }
            })
            .catch((err) => {
                console.log('Remote playback not available:', err);
                if (window.innerWidth > 768) {
                    castBtn.style.display = 'flex';
                }
            });

        castBtn.addEventListener('click', () => {
            if (!audioPlayer.src) {
                alert('Please play a track first to enable casting.');
                return;
            }
            audioPlayer.remote.prompt().catch((err) => {
                if (err.name === 'NotAllowedError') return;
                if (err.name === 'NotFoundError') {
                    alert('No remote playback devices (Chromecast/AirPlay) were found on your network.');
                    return;
                }
                console.log('Cast prompt error:', err);
            });
        });

        audioPlayer.addEventListener('playing', () => {
            if (audioPlayer.remote && audioPlayer.remote.state === 'connected') {
                castBtn.classList.add('connected');
            }
        });

        audioPlayer.addEventListener('pause', () => {
            if (audioPlayer.remote && audioPlayer.remote.state === 'disconnected') {
                castBtn.classList.remove('connected');
            }
        });
    } else if (audioPlayer.webkitShowPlaybackTargetPicker) {
        castBtn.style.display = 'flex';
        castBtn.classList.add('available');

        castBtn.addEventListener('click', () => {
            audioPlayer.webkitShowPlaybackTargetPicker();
        });

        audioPlayer.addEventListener('webkitplaybacktargetavailabilitychanged', (e) => {
            if (e.availability === 'available') {
                castBtn.classList.add('available');
            }
        });

        audioPlayer.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', () => {
            if (audioPlayer.webkitCurrentPlaybackTargetIsWireless) {
                castBtn.classList.add('connected');
            } else {
                castBtn.classList.remove('connected');
            }
        });
    } else if (window.innerWidth > 768) {
        castBtn.style.display = 'flex';
        castBtn.addEventListener('click', () => {
            alert('Casting is not supported in this browser. Try Chrome for Chromecast or Safari for AirPlay.');
        });
    }
}

function initializeKeyboardShortcuts(player, audioPlayer) {
    document.addEventListener('keydown', (e) => {
        if (e.target.matches('input, textarea')) return;

        switch (e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                player.handlePlayPause();
                break;
            case 'arrowright':
                if (e.shiftKey) {
                    player.playNext();
                } else {
                    audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 10);
                }
                break;
            case 'arrowleft':
                if (e.shiftKey) {
                    player.playPrev();
                } else {
                    audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 10);
                }
                break;
            case 'arrowup':
                e.preventDefault();
                player.setVolume(player.userVolume + 0.1);
                break;
            case 'arrowdown':
                e.preventDefault();
                player.setVolume(player.userVolume - 0.1);
                break;
            case 'm':
                audioPlayer.muted = !audioPlayer.muted;
                break;
            case 's':
                document.getElementById('shuffle-btn')?.click();
                break;
            case 'r':
                document.getElementById('repeat-btn')?.click();
                break;
            case 'q':
                document.getElementById('queue-btn')?.click();
                break;
            case '/':
                e.preventDefault();
                document.getElementById('search-input')?.focus();
                break;
            case 'escape':
                document.getElementById('search-input')?.blur();
                sidePanelManager.close();
                clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
                break;
            case 'l':
                document.querySelector('.now-playing-bar .cover')?.click();
                break;
        }
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // ── Version-based cache clear (must run before other init) ──
    await checkAndClearStaleCache();

    // ── Unified network monitoring (Capacitor Network on native, browser events on web) ──
    initNetworkMonitor();

    const api = new LosslessAPI(apiSettings);

    const audioPlayer = document.getElementById('audio-player');

    // ── Native: strip crossorigin so audio CDN requests aren't CORS-blocked ──
    if (isNative) {
        audioPlayer.removeAttribute('crossorigin');
        // Add native-app class for CSS perf optimizations (disable backdrop-filter blur)
        document.body.classList.add('native-app');
    }

    // Streaming quality hardcoded to LOW
    const player = new Player(audioPlayer, api, 'LOW');

    const ui = new UIRenderer(api, player);
    const scrobbler = new MultiScrobbler();
    const lyricsManager = new LyricsManager(api);

    // Expose refs for cross-module access (e.g. admin panel auth)
    window.__tunesRefs = { authManager, ui, api, player };

    // Initialize native media bridge (Android foreground service + notification)
    initMediaBridge(player, audioPlayer, api);

    // Native Android hardware back button handler
    if (isNative) {
        import('@capacitor/app').then(({ App }) => {
            let lastBackPress = 0;
            App.addListener('backButton', ({ canGoBack }) => {
                // Priority 1: close playlist modal
                const playlistModal = document.getElementById('playlist-modal');
                if (playlistModal?.classList.contains('active')) {
                    playlistModal.classList.remove('active');
                    return;
                }
                // Priority 2: close folder modal
                const folderModal = document.getElementById('folder-modal');
                if (folderModal?.classList.contains('active')) {
                    folderModal.classList.remove('active');
                    return;
                }
                // Priority 3: close any other active modal
                const activeModal = document.querySelector('.modal.active');
                if (activeModal) {
                    activeModal.classList.remove('active');
                    return;
                }
                // Priority 4: close side panel
                const sidePanel = document.getElementById('side-panel');
                if (sidePanel?.classList.contains('active')) {
                    sidePanelManager.close();
                    return;
                }
                // Priority 5: close fullscreen cover overlay
                const overlay = document.getElementById('fullscreen-cover-overlay');
                if (overlay && overlay.style.display !== 'none' && overlay.style.display !== '') {
                    if (window.location.hash === '#fullscreen') {
                        window.history.back();
                    } else {
                        ui.closeFullscreenCover();
                    }
                    return;
                }
                // Priority 6: close mobile sidebar
                const sidebar = document.querySelector('.sidebar.is-open');
                if (sidebar) {
                    sidebar.classList.remove('is-open');
                    document.getElementById('sidebar-overlay')?.classList.remove('is-visible');
                    return;
                }
                // Priority 7: go back in history
                if (canGoBack) {
                    window.history.back();
                } else {
                    // Double-tap to exit
                    const now = Date.now();
                    if (now - lastBackPress < 2000) {
                        App.exitApp();
                    } else {
                        lastBackPress = now;
                        // Show brief toast
                        const { showNotification } = window.__tunesDownloads || {};
                        if (typeof showNotification === 'function') {
                            showNotification('Press back again to exit');
                        }
                    }
                }
            });
        }).catch(e => console.warn('[BackButton] @capacitor/app not available:', e));

        // ── Status Bar: solid dark background with white icons, no overlay ──
        import('@capacitor/status-bar').then(({ StatusBar, Style }) => {
            StatusBar.setOverlaysWebView({ overlay: false });
            StatusBar.setStyle({ style: Style.Dark }); // Dark = white icons
            StatusBar.setBackgroundColor({ color: '#000000' });
        }).catch(e => console.warn('[StatusBar] @capacitor/status-bar not available:', e));
    }

    // Initialize auth — check for existing session & wire up auth gate forms
    authManager.init();
    authManager.initAuthGate();

    // Set the about page creator avatar (abstract art, no initials)
    const aboutOrgImg = document.getElementById('about-org-avatar-img');
    if (aboutOrgImg) aboutOrgImg.src = getAvatarUrl('mesob-platforms');
    const aboutAvatarImg = document.getElementById('about-creator-avatar-img');
    if (aboutAvatarImg) aboutAvatarImg.src = getAvatarUrl('naol-mideksa');
    const aboutZfly1Img = document.getElementById('about-zfly1-avatar-img');
    if (aboutZfly1Img) aboutZfly1Img.src = getAvatarUrl('z-fly1');

    const originalRenderPlaylistPage = ui.renderPlaylistPage.bind(ui);
    ui.renderPlaylistPage = async function (id, type) {
        await originalRenderPlaylistPage(id, type);

        if (type === 'user') {
            try {
                const playlist = await db.getPlaylist(id);
                const imgElement = document.getElementById('playlist-detail-image');

                if (!imgElement) return;

                let container = imgElement.parentElement;
                let collageElement = document.getElementById('playlist-detail-collage');

                if (!container.classList.contains('detail-header-cover-container')) {
                    container = document.createElement('div');
                    container.className = 'detail-header-cover-container';
                    imgElement.parentNode.insertBefore(container, imgElement);
                    container.appendChild(imgElement);

                    collageElement = document.createElement('div');
                    collageElement.id = 'playlist-detail-collage';
                    collageElement.className = 'detail-header-collage';
                    collageElement.style.display = 'none';
                    container.appendChild(collageElement);
                }

                if (playlist && !playlist.cover && collageElement && playlist.tracks && playlist.tracks.length > 0) {
                    const tracksWithCovers = playlist.tracks.filter((t) => t.album && t.album.cover);

                    if (tracksWithCovers.length > 0) {
                        imgElement.style.setProperty('display', 'none', 'important');
                        collageElement.style.display = 'grid';
                        collageElement.innerHTML = '';

                        const uniqueCovers = [];
                        const seen = new Set();
                        for (const t of tracksWithCovers) {
                            if (!seen.has(t.album.cover)) {
                                seen.add(t.album.cover);
                                uniqueCovers.push(t.album.cover);
                                if (uniqueCovers.length >= 4) break;
                            }
                        }

                        const images = [];
                        for (let i = 0; i < 4; i++) {
                            images.push(uniqueCovers[i % uniqueCovers.length]);
                        }

                        images.forEach((src) => {
                            const img = document.createElement('img');
                            img.src = api.getCoverUrl(src);
                            collageElement.appendChild(img);
                        });
                    } else {
                        imgElement.style.removeProperty('display');
                        collageElement.style.display = 'none';
                    }
                } else if (collageElement) {
                    imgElement.style.removeProperty('display');
                    collageElement.style.display = 'none';
                }
            } catch (e) {
                console.error('Error generating playlist cover:', e);
            }
        }
    };

    // Check browser support for local files
    // On native Android, File System Access API is unavailable — hide entire section
    const selectLocalBtn = document.getElementById('select-local-folder-btn');
    const browserWarning = document.getElementById('local-browser-warning');

    if (isNative) {
        // Hide local files UI completely on native (WebView has no showDirectoryPicker)
        if (selectLocalBtn) selectLocalBtn.style.display = 'none';
        if (browserWarning) browserWarning.style.display = 'none';
        const localIntro = document.getElementById('local-files-intro');
        if (localIntro) localIntro.style.display = 'none';
    } else if (selectLocalBtn && browserWarning) {
        const ua = navigator.userAgent;
        const isChromeOrEdge = (ua.indexOf('Chrome') > -1 || ua.indexOf('Edg') > -1) && !/Mobile|Android/.test(ua);
        const hasFileSystemApi = 'showDirectoryPicker' in window;

        if (!isChromeOrEdge || !hasFileSystemApi) {
            selectLocalBtn.style.display = 'none';
            browserWarning.style.display = 'block';
        }
    }

    // Kuroshiro is now loaded on-demand only when needed for Asian text with Romaji mode enabled

    const currentTheme = themeManager.getTheme();
    themeManager.setTheme(currentTheme);

    // Restore sidebar state
    sidebarSettings.restoreState();

    // Initialize core event handlers immediately (no await needed)
    initializePlayerEvents(player, audioPlayer, scrobbler, ui);
    initializeTrackInteractions(
        player,
        api,
        document.querySelector('.main-content'),
        document.getElementById('context-menu'),
        lyricsManager,
        ui,
        scrobbler
    );
    initializeUIInteractions(player, api, ui);
    initializeKeyboardShortcuts(player, audioPlayer);

    // Casting is not supported in native Android WebView — skip entirely
    if (!isNative) {
        const castBtn = document.getElementById('cast-btn');
        initializeCasting(audioPlayer, castBtn);
    } else {
        // Hide all cast-related buttons on native
        document.querySelectorAll('#cast-btn, #fs-cast-btn').forEach(el => {
            el.style.display = 'none';
        });
    }

    // Defer non-critical modules - load in background after router runs
    const deferredInit = async () => {
        try {
            const [settingsMod, trackerMod] = await Promise.all([
                loadSettingsModule(),
                loadTrackerModule(),
            ]);
            settingsMod.initializeSettings(scrobbler, player, api, ui);
            trackerMod.initTracker(player);
        } catch (e) {
            console.error('Deferred module init error:', e);
        }
    };
    // Use requestIdleCallback if available, else setTimeout
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => deferredInit());
    } else {
        setTimeout(() => deferredInit(), 100);
    }

    // Restore UI state for the current track (like button, theme)
    if (player.currentTrack) {
        ui.setCurrentTrack(player.currentTrack);
    }

    // Set up cover click handler - use event delegation to ensure it works
    const setupCoverClick = () => {
        const cover = document.querySelector('.now-playing-bar .cover');
        if (cover) {
            // Remove any existing listeners by cloning
            const newCover = cover.cloneNode(true);
            cover.parentNode.replaceChild(newCover, cover);
            
            newCover.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent footer click from interfering
                if (!player.currentTrack) {
                    alert('No track is currently playing');
                    return;
                }

                // Open fullscreen now-playing view
                const overlay = document.getElementById('fullscreen-cover-overlay');
                if (overlay && overlay.style.display === 'flex') {
                    // Already open, close it
                    if (window.location.hash === '#fullscreen') {
                        window.history.back();
                    } else {
                        ui.closeFullscreenCover();
                    }
                } else {
                    const nextTrack = player.getNextTrack();
                    ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
                }
            });
        }
    };
    
    // Set up immediately and also after a short delay in case element isn't ready
    setupCoverClick();
    setTimeout(setupCoverClick, 500);

    // All playlists are public – share button always available when editing

    document.getElementById('close-fullscreen-cover-btn')?.addEventListener('click', () => {
        if (window.location.hash === '#fullscreen') {
            window.history.back();
        } else {
            ui.closeFullscreenCover();
        }
    });

    document.getElementById('fullscreen-cover-image')?.addEventListener('click', () => {
        if (window.location.hash === '#fullscreen') {
            window.history.back();
        } else {
            ui.closeFullscreenCover();
        }
    });

    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
        const isCollapsed = document.body.classList.contains('sidebar-collapsed');
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.innerHTML = isCollapsed
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
        }
        // Save sidebar state to localStorage
        sidebarSettings.setCollapsed(isCollapsed);
    });

    document.getElementById('nav-back')?.addEventListener('click', () => {
        window.history.back();
    });

    document.getElementById('nav-forward')?.addEventListener('click', () => {
        window.history.forward();
    });

    // ── Pull-to-refresh (replaces reload button) ──
    {
        const mainContent = document.querySelector('.main-content');
        const ptrIndicator = document.getElementById('pull-to-refresh-indicator');
        const THRESHOLD = 70; // px to pull before triggering refresh
        let startY = 0;
        let pulling = false;

        if (mainContent && ptrIndicator) {
            mainContent.addEventListener('touchstart', (e) => {
                // Only start tracking if scrolled to top
                if (mainContent.scrollTop > 5) return;
                // Don't activate inside lyrics panel or fullscreen overlay
                const target = e.target;
                if (target.closest('#lyrics-side-panel') || target.closest('#fullscreen-cover-overlay')) return;
                startY = e.touches[0].clientY;
                pulling = false;
            }, { passive: true });

            mainContent.addEventListener('touchmove', (e) => {
                if (!startY) return;
                if (mainContent.scrollTop > 5) { startY = 0; return; }
                const currentY = e.touches[0].clientY;
                const diff = currentY - startY;
                if (diff > 10) {
                    pulling = true;
                    const pullDist = Math.min(diff, THRESHOLD + 30);
                    ptrIndicator.classList.add('pulling');
                    ptrIndicator.classList.toggle('threshold', diff >= THRESHOLD);
                    ptrIndicator.style.height = Math.min(pullDist * 0.6, 50) + 'px';
                } else {
                    pulling = false;
                    ptrIndicator.classList.remove('pulling', 'threshold');
                    ptrIndicator.style.height = '0';
                }
            }, { passive: true });

            mainContent.addEventListener('touchend', () => {
                if (!pulling) { startY = 0; return; }
                const indicator = ptrIndicator;
                if (indicator.classList.contains('threshold')) {
                    // Trigger a real full page reload (like Ctrl+R)
                    indicator.classList.add('refreshing');
                    indicator.style.height = '40px';
                    window.location.reload();
                    return; // page will reload
                } else {
                    indicator.classList.remove('pulling', 'threshold');
                    indicator.style.height = '0';
                }
                startY = 0;
                pulling = false;
            }, { passive: true });
        }
    }

    document.getElementById('toggle-lyrics-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!player.currentTrack) {
            alert('No track is currently playing');
            return;
        }

        const isActive = sidePanelManager.isActive('lyrics');

        if (isActive) {
            sidePanelManager.close();
            clearLyricsPanelSync(audioPlayer, sidePanelManager.panel);
        } else {
            openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager);
        }
    });

    document.getElementById('download-current-btn')?.addEventListener('click', () => {
        if (player.currentTrack) {
            handleTrackAction('download', player.currentTrack, player, api, lyricsManager, 'track', ui);
        }
    });

    // Go to Album button in player more menu
    document.getElementById('goto-album-btn')?.addEventListener('click', () => {
        if (player.currentTrack?.album?.id) {
            // Close dropdown
            document.querySelectorAll('.detail-more-dropdown.open').forEach(d => d.classList.remove('open'));
            // Close fullscreen if open
            ui.closeFullscreenCover?.();
            navigate(`/album/${player.currentTrack.album.id}`);
        }
    });

    // Go to Artist button in player more menu
    document.getElementById('goto-artist-btn')?.addEventListener('click', () => {
        if (player.currentTrack?.artist?.id) {
            document.querySelectorAll('.detail-more-dropdown.open').forEach(d => d.classList.remove('open'));
            ui.closeFullscreenCover?.();
            navigate(`/artist/${player.currentTrack.artist.id}`);
        }
    });

    // Song Credits button in player more menu
    document.getElementById('song-credits-btn')?.addEventListener('click', async () => {
        if (!player.currentTrack) return;
        document.querySelectorAll('.detail-more-dropdown.open').forEach(d => d.classList.remove('open'));
        const track = player.currentTrack;

        const esc = (s) => s ? s.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        let html = `<div style="padding: 1.25rem;">`;
        html += `<h3 style="margin: 0 0 0.25rem; font-size: 1.1rem;">${esc(track.title)}</h3>`;
        html += `<p style="opacity: 0.6; margin: 0 0 1.25rem; font-size: 0.85rem;">${esc(track.artist?.name || '')}</p>`;

        // Artist
        html += `<div style="margin-bottom: 1rem;">`;
        html += `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Primary Artist</p>`;
        html += `<p style="margin: 0; font-size: 0.9rem;">${esc(track.artist?.name || 'Unknown')}</p>`;
        html += `</div>`;

        // Featured artists
        if (track.artists && track.artists.length > 1) {
            html += `<div style="margin-bottom: 1rem;">`;
            html += `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Featured Artists</p>`;
            for (const a of track.artists.slice(1)) {
                html += `<p style="margin: 0.15rem 0; font-size: 0.9rem;">${esc(a.name)}</p>`;
            }
            html += `</div>`;
        }

        // Album
        if (track.album) {
            html += `<div style="margin-bottom: 1rem;">`;
            html += `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Album</p>`;
            html += `<p style="margin: 0; font-size: 0.9rem;">${esc(track.album.title || '')}</p>`;
            html += `</div>`;
        }

        // Track info
        html += `<div style="margin-bottom: 1rem;">`;
        html += `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Track Info</p>`;
        if (track.trackNumber) html += `<p style="margin: 0.15rem 0; font-size: 0.85rem; opacity: 0.8;">Track ${track.trackNumber}${track.volumeNumber ? `, Disc ${track.volumeNumber}` : ''}</p>`;
        if (track.duration) {
            const mins = Math.floor(track.duration / 60);
            const secs = track.duration % 60;
            html += `<p style="margin: 0.15rem 0; font-size: 0.85rem; opacity: 0.8;">Duration: ${mins}:${String(secs).padStart(2, '0')}</p>`;
        }
        if (track.copyright) html += `<p style="margin: 0.15rem 0; font-size: 0.85rem; opacity: 0.8;">${esc(track.copyright)}</p>`;
        if (track.isrc) html += `<p style="margin: 0.15rem 0; font-size: 0.85rem; opacity: 0.6;">ISRC: ${esc(track.isrc)}</p>`;
        html += `</div>`;

        // Producer credits placeholder (will be filled from Tidal API)
        html += `<div id="song-credits-producers" style="margin-bottom: 1rem;">`;
        html += `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Produced By</p>`;
        html += `<p style="margin: 0; font-size: 0.85rem; opacity: 0.5;">Loading...</p>`;
        html += `</div>`;

        // Writers placeholder
        html += `<div id="song-credits-writers" style="margin-bottom: 1rem; display:none;">`;
        html += `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Written By</p>`;
        html += `</div>`;

        html += `</div>`;

        const sidePanelTitle = document.getElementById('side-panel-title');
        const sidePanelContent = document.getElementById('side-panel-content');
        const sidePanel = document.getElementById('side-panel');
        if (sidePanelTitle) sidePanelTitle.textContent = 'Song Credits';
        if (sidePanelContent) sidePanelContent.innerHTML = html;
        if (sidePanel) sidePanel.classList.add('active');

        // Fetch credits from Tidal API (async, non-blocking)
        try {
            let credits = track.credits;
            let composers = track.composers;

            // If current track doesn't have credits, fetch from album or track metadata
            if (!credits || credits.length === 0) {
                const albumId = track.album?.id;
                if (albumId) {
                    try {
                        const { tracks: albumTracks } = await api.getAlbum(albumId);
                        const matched = albumTracks?.find(t => String(t.id) === String(track.id));
                        if (matched) {
                            credits = matched.credits || [];
                            composers = matched.composers || composers || [];
                        }
                    } catch (_) { /* fallback below */ }
                }
            }

            // If still no credits, try direct track metadata
            if (!credits || credits.length === 0) {
                try {
                    const meta = await api.getTrackMetadata(track.id);
                    if (meta) {
                        credits = meta.credits || [];
                        composers = meta.composers || composers || [];
                    }
                } catch (_) { /* ok */ }
            }

            credits = credits || [];
            composers = composers || [];

            // Extract producers from credits
            const producersEl = document.getElementById('song-credits-producers');
            const producers = credits.filter(c =>
                /produc/i.test(c.type || '')
            );

            if (producersEl) {
                if (producers.length > 0) {
                    producersEl.innerHTML = `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Produced By</p>` +
                        producers.map(p => `<p style="margin: 0.15rem 0; font-size: 0.9rem;">${esc(p.name)}</p>`).join('');
                } else {
                    producersEl.innerHTML = `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Produced By</p><p style="margin:0;font-size:0.85rem;opacity:0.4;">Not available</p>`;
                }
            }

            // Extract writers/composers from credits
            const writersEl = document.getElementById('song-credits-writers');
            const writerCredits = credits.filter(c =>
                /writer|lyricist|composer|author/i.test(c.type || '')
            );
            const writerNames = writerCredits.map(w => w.name);
            // Add composers that aren't already listed
            for (const comp of composers) {
                if (comp.name && !writerNames.includes(comp.name)) writerNames.push(comp.name);
            }

            if (writersEl && writerNames.length > 0) {
                writersEl.style.display = '';
                writersEl.innerHTML = `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Written By</p>` +
                    writerNames.map(name => `<p style="margin: 0.15rem 0; font-size: 0.9rem;">${esc(name)}</p>`).join('');
            }

            // Show any other unique credit types not yet shown
            const shownTypes = new Set([...producers, ...writerCredits].map(c => c.type));
            const otherCredits = credits.filter(c => !shownTypes.has(c.type));
            if (otherCredits.length > 0) {
                const grouped = {};
                for (const c of otherCredits) {
                    const type = c.type || 'Other';
                    if (!grouped[type]) grouped[type] = [];
                    grouped[type].push(c.name);
                }
                const parentDiv = producersEl?.parentElement;
                if (parentDiv) {
                    for (const [type, names] of Object.entries(grouped)) {
                        const div = document.createElement('div');
                        div.style.marginBottom = '1rem';
                        div.innerHTML = `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">${esc(type)}</p>` +
                            names.map(n => `<p style="margin: 0.15rem 0; font-size: 0.9rem;">${esc(n)}</p>`).join('');
                        parentDiv.appendChild(div);
                    }
                }
            }

            // Release date from track/album data
            const releaseDate = track.album?.releaseDate || track.streamStartDate?.split('T')[0];
            if (releaseDate) {
                const parentDiv = producersEl?.parentElement;
                if (parentDiv) {
                    const dateDiv = document.createElement('div');
                    dateDiv.style.marginBottom = '1rem';
                    dateDiv.innerHTML = `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Release Date</p><p style="margin: 0; font-size: 0.9rem;">${esc(releaseDate)}</p>`;
                    parentDiv.appendChild(dateDiv);
                }
            }
        } catch (e) {
            console.warn('Credits fetch failed:', e);
            const producersEl = document.getElementById('song-credits-producers');
            if (producersEl) producersEl.innerHTML = `<p style="font-size: 0.7rem; opacity: 0.4; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3rem;">Produced By</p><p style="margin:0;font-size:0.85rem;opacity:0.4;">Unavailable</p>`;
        }
    });

    // Share button in player more menu
    document.getElementById('share-track-btn')?.addEventListener('click', async () => {
        if (!player.currentTrack) return;
        document.querySelectorAll('.detail-more-dropdown.open').forEach(d => d.classList.remove('open'));
        const track = player.currentTrack;
        const shareData = {
            title: track.title || 'Track',
            text: `${track.title} by ${track.artist?.name || 'Unknown'}`,
            url: `${window.location.origin}/album/${track.album?.id || ''}`,
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else {
                await navigator.clipboard.writeText(shareData.url);
                alert('Link copied to clipboard!');
            }
        } catch (_) {}
    });

    // Auto-update lyrics when track changes
    let previousTrackId = null;
    audioPlayer.addEventListener('play', async () => {
        if (!player.currentTrack) return;

        // Update UI with current track info for theme
        ui.setCurrentTrack(player.currentTrack);

        const currentTrackId = player.currentTrack.id;
        if (currentTrackId === previousTrackId) return;
        previousTrackId = currentTrackId;

        // Update lyrics panel if it's open
        if (sidePanelManager.isActive('lyrics')) {
            // Re-open forces update/refresh of content and sync
            openLyricsPanel(player.currentTrack, audioPlayer, lyricsManager, true);
        }

        // Update Fullscreen if it's open
        const fullscreenOverlay = document.getElementById('fullscreen-cover-overlay');
        if (fullscreenOverlay && getComputedStyle(fullscreenOverlay).display !== 'none') {
            const nextTrack = player.getNextTrack();
            ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }

        // DEV: Auto-open fullscreen mode if ?fullscreen=1 in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (
            urlParams.get('fullscreen') === '1' &&
            fullscreenOverlay &&
            getComputedStyle(fullscreenOverlay).display === 'none'
        ) {
            const nextTrack = player.getNextTrack();
            ui.showFullscreenCover(player.currentTrack, nextTrack, lyricsManager, audioPlayer);
        }
    });

    document.addEventListener('click', async (e) => {
        if (e.target.closest('#play-album-btn')) {
            const btn = e.target.closest('#play-album-btn');
            if (btn.disabled) return;

            const pathParts = window.location.pathname.split('/');
            const albumIndex = pathParts.indexOf('album');
            const albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;

            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    // Sort tracks by disc and track number for consistent playback
                    const sortedTracks = [...tracks].sort((a, b) => {
                        const discA = a.volumeNumber ?? a.discNumber ?? 1;
                        const discB = b.volumeNumber ?? b.discNumber ?? 1;
                        if (discA !== discB) return discA - discB;
                        return a.trackNumber - b.trackNumber;
                    });

                    player.setQueue(sortedTracks, 0);
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    player.shuffleActive = false;
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play album:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to play album');
            }
        }

        if (e.target.closest('#shuffle-album-btn')) {
            const btn = e.target.closest('#shuffle-album-btn');
            if (btn.disabled) return;

            const pathParts = window.location.pathname.split('/');
            const albumIndex = pathParts.indexOf('album');
            const albumId = albumIndex !== -1 ? pathParts[albumIndex + 1] : null;

            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);
                if (tracks && tracks.length > 0) {
                    const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
                    player.setQueue(shuffledTracks, 0);
                    const shuffleBtn = document.getElementById('shuffle-btn');
                    if (shuffleBtn) shuffleBtn.classList.remove('active');
                    player.shuffleActive = false;
                    player.playTrackFromQueue();
                    const { showNotification } = await loadDownloadsModule();
                    showNotification('Shuffling album');
                }
            } catch (error) {
                console.error('Failed to shuffle album:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to shuffle album');
            }
        }

        if (e.target.closest('#shuffle-artist-btn')) {
            const btn = e.target.closest('#shuffle-artist-btn');
            if (btn.disabled) return;
            document.getElementById('play-artist-radio-btn')?.click();
        }
        if (e.target.closest('#download-mix-btn')) {
            const btn = e.target.closest('#download-mix-btn');
            if (btn.disabled) return;

            const mixId = window.location.pathname.split('/')[2];
            if (!mixId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { mix, tracks } = await api.getMix(mixId);
                const { downloadPlaylistAsZip } = await loadDownloadsModule();
                await downloadPlaylistAsZip(mix, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Mix download failed:', error);
                alert('Failed to download mix: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#download-playlist-btn')) {
            const btn = e.target.closest('#download-playlist-btn');
            if (btn.disabled) return;

            const playlistId = window.location.pathname.split('/')[2];
            if (!playlistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                let playlist, tracks;
                let userPlaylist = await db.getPlaylist(playlistId);

                if (!userPlaylist) {
                    try {
                        userPlaylist = await syncManager.getPublicPlaylist(playlistId);
                    } catch {
                        // Not a public playlist
                    }
                }

                if (userPlaylist) {
                    playlist = { ...userPlaylist, title: userPlaylist.name || userPlaylist.title };
                    tracks = userPlaylist.tracks || [];
                } else {
                    const data = await api.getPlaylist(playlistId);
                    playlist = data.playlist;
                    tracks = data.tracks;
                }

                const { downloadPlaylistAsZip } = await loadDownloadsModule();
                await downloadPlaylistAsZip(playlist, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Playlist download failed:', error);
                alert('Failed to download playlist: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#create-playlist-btn')) {
            const modal = document.getElementById('playlist-modal');
            document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
            document.getElementById('playlist-name-input').value = '';
            document.getElementById('playlist-cover-input').value = '';
            const descInput = document.getElementById('playlist-description-input');
            if (descInput) descInput.value = '';
            modal.dataset.editingId = '';
            document.getElementById('csv-import-section').style.display = 'block';
            document.getElementById('csv-file-input').value = '';

            modal.classList.add('active');
            document.getElementById('playlist-name-input').focus();
        }

        if (e.target.closest('#create-folder-btn')) {
            const modal = document.getElementById('folder-modal');
            document.getElementById('folder-name-input').value = '';
            document.getElementById('folder-cover-input').value = '';
            modal.classList.add('active');
            document.getElementById('folder-name-input').focus();
        }

        if (e.target.closest('#folder-modal-save')) {
            const name = document.getElementById('folder-name-input').value.trim();
            const cover = document.getElementById('folder-cover-input').value.trim();

            if (name) {
                await db.createFolder(name, cover);
                ui.renderLibraryPage();
                document.getElementById('folder-modal').classList.remove('active');
            }
        }

        if (e.target.closest('#folder-modal-cancel')) {
            document.getElementById('folder-modal').classList.remove('active');
        }

        if (e.target.closest('#delete-folder-btn')) {
            const folderId = window.location.pathname.split('/')[2];
            if (folderId && confirm('Are you sure you want to delete this folder?')) {
                await db.deleteFolder(folderId);
                navigate('/library');
            }
        }

        if (e.target.closest('#playlist-modal-save')) {
            const name = document.getElementById('playlist-name-input').value.trim();
            const description = document.getElementById('playlist-description-input')?.value?.trim() || '';

            if (name) {
                const modal = document.getElementById('playlist-modal');
                const editingId = modal.dataset.editingId;

                const handlePublicStatus = async (playlist) => {
                    playlist.isPublic = true; // All playlists are public
                    try {
                        await syncManager.publishPlaylist(playlist);
                    } catch (e) {
                        console.error('Failed to publish playlist:', e);
                    }
                    return playlist;
                };

                if (editingId) {
                    // Edit
                    const cover = document.getElementById('playlist-cover-input').value.trim();
                    db.getPlaylist(editingId).then(async (playlist) => {
                        if (playlist) {
                            playlist.name = name;
                            playlist.cover = cover;
                            playlist.description = description;
                            await handlePublicStatus(playlist);
                            await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                            syncManager.syncUserPlaylist(playlist, 'update');
                            ui.renderLibraryPage();
                            // Also update current page if we are on it
                            if (window.location.pathname === `/userplaylist/${editingId}`) {
                                ui.renderPlaylistPage(editingId, 'user');
                            }
                            modal.classList.remove('active');
                            delete modal.dataset.editingId;
                        }
                    });
                } else {
                    // Create
                    const csvFileInput = document.getElementById('csv-file-input');
                    let tracks = [];

                    if (csvFileInput.files.length > 0) {
                        // Import from CSV
                        const file = csvFileInput.files[0];
                        const progressElement = document.getElementById('csv-import-progress');
                        const progressFill = document.getElementById('csv-progress-fill');
                        const progressCurrent = document.getElementById('csv-progress-current');
                        const progressTotal = document.getElementById('csv-progress-total');
                        const currentTrackElement = progressElement.querySelector('.current-track');
                        const currentArtistElement = progressElement.querySelector('.current-artist');

                        try {
                            // Show progress bar
                            progressElement.style.display = 'block';
                            progressFill.style.width = '0%';
                            progressCurrent.textContent = '0';
                            currentTrackElement.textContent = 'Reading CSV file...';
                            if (currentArtistElement) currentArtistElement.textContent = '';

                            const csvText = await file.text();
                            const lines = csvText.trim().split('\n');
                            const totalTracks = Math.max(0, lines.length - 1);
                            progressTotal.textContent = totalTracks.toString();

                            const result = await parseCSV(csvText, api, (progress) => {
                                const percentage = totalTracks > 0 ? (progress.current / totalTracks) * 100 : 0;
                                progressFill.style.width = `${Math.min(percentage, 100)}%`;
                                progressCurrent.textContent = progress.current.toString();
                                currentTrackElement.textContent = progress.currentTrack;
                                if (currentArtistElement)
                                    currentArtistElement.textContent = progress.currentArtist || '';
                            });

                            tracks = result.tracks;
                            const missingTracks = result.missingTracks;

                            if (tracks.length === 0) {
                                alert('No valid tracks found in the CSV file! Please check the format.');
                                progressElement.style.display = 'none';
                                return;
                            }
                            console.log(`Imported ${tracks.length} tracks from CSV`);

                            // if theres missing songs, warn the user
                            if (missingTracks.length > 0) {
                                setTimeout(() => {
                                    showMissingTracksNotification(missingTracks);
                                }, 500);
                            }
                        } catch (error) {
                            console.error('Failed to parse CSV!', error);
                            alert('Failed to parse CSV file! ' + error.message);
                            progressElement.style.display = 'none';
                            return;
                        } finally {
                            // Hide progress bar
                            setTimeout(() => {
                                progressElement.style.display = 'none';
                            }, 1000);
                        }
                    }

                    const cover = document.getElementById('playlist-cover-input').value.trim();

                    // Check for pending tracks (from Add to Playlist -> New Playlist)
                    const modal = document.getElementById('playlist-modal');
                    if (modal._pendingTracks && Array.isArray(modal._pendingTracks)) {
                        tracks = [...tracks, ...modal._pendingTracks];
                        delete modal._pendingTracks;
                        // Also clear CSV input if we came from there? No, keep it separate.
                        console.log(`Added ${tracks.length} tracks (including pending)`);
                    }

                    db.createPlaylist(name, tracks, cover).then(async (playlist) => {
                        playlist.description = description;
                        await handlePublicStatus(playlist);
                        // Update DB again with isPublic + description
                        await db.performTransaction('user_playlists', 'readwrite', (store) => store.put(playlist));
                        syncManager.syncUserPlaylist(playlist, 'create');
                        ui.renderLibraryPage();
                        modal.classList.remove('active');
                    });
                }
            }
        }

        if (e.target.closest('#playlist-modal-cancel')) {
            document.getElementById('playlist-modal').classList.remove('active');
        }

        if (e.target.closest('.edit-playlist-btn')) {
            const card = e.target.closest('.user-playlist');
            const playlistId = card.dataset.userPlaylistId;
            db.getPlaylist(playlistId).then(async (playlist) => {
                if (playlist) {
                    const modal = document.getElementById('playlist-modal');
                    document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                    document.getElementById('playlist-name-input').value = playlist.name;
                    document.getElementById('playlist-cover-input').value = playlist.cover || '';
                    const descInput = document.getElementById('playlist-description-input');
                    if (descInput) descInput.value = playlist.description || '';

                    const shareBtn = document.getElementById('playlist-share-btn');
                    if (shareBtn) {
                        shareBtn.style.display = 'flex';
                        shareBtn.onclick = () => {
                            const url = `${window.location.origin}/userplaylist/${playlist.id}`;
                            navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!'));
                        };
                    }

                    modal.dataset.editingId = playlistId;
                    document.getElementById('csv-import-section').style.display = 'none';
                    modal.classList.add('active');
                    document.getElementById('playlist-name-input').focus();
                }
            });
        }

        // Delete button removed from library grid - only available on detail page

        if (e.target.closest('#edit-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            db.getPlaylist(playlistId).then((playlist) => {
                if (playlist) {
                    const modal = document.getElementById('playlist-modal');
                    document.getElementById('playlist-modal-title').textContent = 'Edit Playlist';
                    document.getElementById('playlist-name-input').value = playlist.name;
                    document.getElementById('playlist-cover-input').value = playlist.cover || '';
                    const descInput = document.getElementById('playlist-description-input');
                    if (descInput) descInput.value = playlist.description || '';

                    const shareBtn = document.getElementById('playlist-share-btn');
                    if (shareBtn) {
                        shareBtn.style.display = 'flex';
                        shareBtn.onclick = () => {
                            const url = `${window.location.origin}/userplaylist/${playlist.id}`;
                            navigator.clipboard.writeText(url).then(() => alert('Link copied to clipboard!'));
                        };
                    }

                    modal.dataset.editingId = playlistId;
                    document.getElementById('csv-import-section').style.display = 'none';
                    modal.classList.add('active');
                    document.getElementById('playlist-name-input').focus();
                }
            });
        }

        if (e.target.closest('#delete-playlist-btn')) {
            const playlistId = window.location.pathname.split('/')[2];
            const deleteModal = document.getElementById('delete-playlist-modal');
            if (deleteModal && playlistId) {
                deleteModal.classList.add('active');
                
                // Store playlist ID for confirmation
                deleteModal.dataset.playlistId = playlistId;
            }
        }

        // Handle delete confirmation
        if (e.target.closest('#delete-confirm')) {
            const deleteModal = document.getElementById('delete-playlist-modal');
            const playlistId = deleteModal?.dataset.playlistId;
            if (playlistId) {
                deleteModal.classList.remove('active');
                db.deletePlaylist(playlistId).then(() => {
                    syncManager.syncUserPlaylist({ id: playlistId }, 'delete');
                    navigate('/library');
                });
            }
        }

        // Handle delete cancellation
        if (e.target.closest('#delete-cancel') || (e.target.closest('#delete-playlist-modal .modal-overlay'))) {
            const deleteModal = document.getElementById('delete-playlist-modal');
            if (deleteModal) {
                deleteModal.classList.remove('active');
                deleteModal.dataset.playlistId = '';
            }
        }

        // Handle share playlist button
        if (e.target.closest('#share-playlist-btn-header')) {
            const shareBtn = e.target.closest('#share-playlist-btn-header');
            const playlistId = shareBtn.dataset.playlistId;
            const playlistName = shareBtn.dataset.playlistName || 'Playlist';
            const url = `${window.location.origin}/userplaylist/${playlistId}`;

            // Use native Web Share API if available
            if (navigator.share) {
                navigator.share({
                    title: playlistName,
                    text: `Check out this playlist: ${playlistName}`,
                    url: url
                }).catch((err) => {
                    // User cancelled or error occurred - fallback to clipboard
                    if (err.name !== 'AbortError') {
                        navigator.clipboard.writeText(url).then(() => {
                            // Show toast notification
                            const toast = document.createElement('div');
                            toast.textContent = 'Link copied to clipboard!';
                            toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--secondary);color:var(--foreground);padding:0.75rem 1.5rem;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:10000;font-size:0.9rem;';
                            document.body.appendChild(toast);
                            setTimeout(() => toast.remove(), 3000);
                        });
                    }
                });
            } else {
                // Fallback to clipboard
                navigator.clipboard.writeText(url).then(() => {
                    // Show toast notification
                    const toast = document.createElement('div');
                    toast.textContent = 'Link copied to clipboard!';
                    toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--secondary);color:var(--foreground);padding:0.75rem 1.5rem;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:10000;font-size:0.9rem;';
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                });
            }
        }

        if (e.target.closest('.remove-from-playlist-btn')) {
            e.stopPropagation();
            const btn = e.target.closest('.remove-from-playlist-btn');
            const playlistId = window.location.pathname.split('/')[2];

            db.getPlaylist(playlistId).then(async (playlist) => {
                let trackId = null;

                // Prefer ID if available (from sorted view)
                if (btn.dataset.trackId) {
                    trackId = btn.dataset.trackId;
                } else if (btn.dataset.trackIndex) {
                    // Fallback to index (legacy/unsorted)
                    const index = parseInt(btn.dataset.trackIndex);
                    if (playlist && playlist.tracks[index]) {
                        trackId = playlist.tracks[index].id;
                    }
                }

                if (trackId) {
                    const updatedPlaylist = await db.removeTrackFromPlaylist(playlistId, trackId);
                    syncManager.syncUserPlaylist(updatedPlaylist, 'update');
                    const scrollTop = document.querySelector('.main-content').scrollTop;
                    await ui.renderPlaylistPage(playlistId, 'user');
                    document.querySelector('.main-content').scrollTop = scrollTop;
                }
            });
        }

        if (e.target.closest('#play-playlist-btn')) {
            const btn = e.target.closest('#play-playlist-btn');
            if (btn.disabled) return;

            const playlistId = window.location.pathname.split('/')[2];
            if (!playlistId) return;

            try {
                let tracks;
                const userPlaylist = await db.getPlaylist(playlistId);
                if (userPlaylist) {
                    tracks = userPlaylist.tracks;
                } else {
                    // Try API, if fail, try Public Supabase playlist
                    try {
                        const { tracks: apiTracks } = await api.getPlaylist(playlistId);
                        tracks = apiTracks;
                    } catch (e) {
                        const publicPlaylist = await syncManager.getPublicPlaylist(playlistId);
                        if (publicPlaylist) {
                            tracks = publicPlaylist.tracks;
                        } else {
                            throw e;
                        }
                    }
                }
                if (tracks.length > 0) {
                    player.setQueue(tracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to play playlist:', error);
                alert('Failed to play playlist: ' + error.message);
            }
        }

        if (e.target.closest('#download-album-btn')) {
            const btn = e.target.closest('#download-album-btn');
            if (btn.disabled) return;

            const albumId = window.location.pathname.split('/')[2];
            if (!albumId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

            try {
                const { album, tracks } = await api.getAlbum(albumId);
                const { downloadAlbumAsZip } = await loadDownloadsModule();
                await downloadAlbumAsZip(album, tracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Album download failed:', error);
                alert('Failed to download album: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#add-album-to-playlist-btn')) {
            const btn = e.target.closest('#add-album-to-playlist-btn');
            if (btn.disabled) return;

            const albumId = window.location.pathname.split('/')[2];
            if (!albumId) return;

            try {
                const { tracks } = await api.getAlbum(albumId);

                if (!tracks || tracks.length === 0) {
                    const { showNotification } = await loadDownloadsModule();
                    showNotification('No tracks found in this album.');
                    return;
                }

                const modal = document.getElementById('playlist-select-modal');
                const list = document.getElementById('playlist-select-list');
                const cancelBtn = document.getElementById('playlist-select-cancel');
                const overlay = modal.querySelector('.modal-overlay');

                const playlists = await db.getPlaylists(false);

                list.innerHTML =
                    `
                    <div class="modal-option create-new-option" style="border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
                        <span style="font-weight: 600; color: var(--primary);">+ Create New Playlist</span>
                    </div>
                ` +
                    playlists
                        .map(
                            (p) => `
                    <div class="modal-option" data-id="${p.id}">
                        <span>${p.name}</span>
                    </div>
                `
                        )
                        .join('');

                const closeModal = () => {
                    modal.classList.remove('active');
                    cleanup();
                };

                const handleOptionClick = async (e) => {
                    const option = e.target.closest('.modal-option');
                    if (!option) return;

                    if (option.classList.contains('create-new-option')) {
                        closeModal();
                        const createModal = document.getElementById('playlist-modal');
                        document.getElementById('playlist-modal-title').textContent = 'Create Playlist';
                        document.getElementById('playlist-name-input').value = '';
                        document.getElementById('playlist-cover-input').value = '';
                        createModal.dataset.editingId = '';
                        document.getElementById('csv-import-section').style.display = 'none'; // Hide CSV for simple add

                        // Pass tracks
                        createModal._pendingTracks = tracks;

                        createModal.classList.add('active');
                        document.getElementById('playlist-name-input').focus();
                        return;
                    }

                    const playlistId = option.dataset.id;

                    try {
                        await db.addTracksToPlaylist(playlistId, tracks);
                        const { showNotification } = await loadDownloadsModule();
                        showNotification(`Added ${tracks.length} tracks to playlist.`);
                        closeModal();
                    } catch (err) {
                        console.error(err);
                        const { showNotification } = await loadDownloadsModule();
                        showNotification('Failed to add tracks.');
                    }
                };

                const cleanup = () => {
                    cancelBtn.removeEventListener('click', closeModal);
                    overlay.removeEventListener('click', closeModal);
                    list.removeEventListener('click', handleOptionClick);
                };

                cancelBtn.addEventListener('click', closeModal);
                overlay.addEventListener('click', closeModal);
                list.addEventListener('click', handleOptionClick);

                modal.classList.add('active');
            } catch (error) {
                console.error('Failed to prepare album for playlist:', error);
                const { showNotification } = await loadDownloadsModule();
                showNotification('Failed to load album tracks.');
            }
        }

        if (e.target.closest('#play-artist-radio-btn')) {
            const btn = e.target.closest('#play-artist-radio-btn');
            if (btn.disabled) return;

            const artistId = window.location.pathname.split('/')[2];
            if (!artistId) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Loading...</span>';

            try {
                const artist = await api.getArtist(artistId);

                const allReleases = [...(artist.albums || []), ...(artist.eps || [])];
                if (allReleases.length === 0) {
                    throw new Error('No albums or EPs found for this artist');
                }

                const trackSet = new Set();
                const allTracks = [];

                const chunks = [];
                const chunkSize = 3;
                const albums = allReleases;

                for (let i = 0; i < albums.length; i += chunkSize) {
                    chunks.push(albums.slice(i, i + chunkSize));
                }

                for (const chunk of chunks) {
                    await Promise.all(
                        chunk.map(async (album) => {
                            try {
                                const { tracks } = await api.getAlbum(album.id);
                                tracks.forEach((track) => {
                                    if (!trackSet.has(track.id)) {
                                        trackSet.add(track.id);
                                        allTracks.push(track);
                                    }
                                });
                            } catch (err) {
                                console.warn(`Failed to fetch tracks for album ${album.title}:`, err);
                            }
                        })
                    );
                }

                if (allTracks.length > 0) {
                    for (let i = allTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
                    }

                    player.setQueue(allTracks, 0);
                    player.playTrackFromQueue();
                } else {
                    throw new Error('No tracks found across all albums');
                }
            } catch (error) {
                console.error('Artist radio failed:', error);
                alert('Failed to start artist radio: ' + error.message);
            } finally {
                if (document.body.contains(btn)) {
                    btn.disabled = false;
                    btn.innerHTML = originalHTML;
                }
            }
        }

        if (e.target.closest('#shuffle-liked-tracks-btn')) {
            const btn = e.target.closest('#shuffle-liked-tracks-btn');
            if (btn.disabled) return;

            try {
                const likedTracks = await db.getFavorites('track');
                if (likedTracks.length > 0) {
                    // Shuffle array
                    for (let i = likedTracks.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [likedTracks[i], likedTracks[j]] = [likedTracks[j], likedTracks[i]];
                    }
                    player.setQueue(likedTracks, 0);
                    document.getElementById('shuffle-btn').classList.remove('active');
                    player.playTrackFromQueue();
                }
            } catch (error) {
                console.error('Failed to shuffle liked tracks:', error);
            }
        }

        if (e.target.closest('#download-liked-tracks-btn')) {
            const btn = e.target.closest('#download-liked-tracks-btn');
            if (btn.disabled) return;

            btn.disabled = true;
            const originalHTML = btn.innerHTML;
            btn.innerHTML =
                '<svg class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';

            try {
                const likedTracks = await db.getFavorites('track');
                if (likedTracks.length === 0) {
                    alert('No liked tracks to download.');
                    return;
                }
                const { downloadLikedTracks } = await loadDownloadsModule();
                await downloadLikedTracks(likedTracks, api, downloadQualitySettings.getQuality(), lyricsManager);
            } catch (error) {
                console.error('Liked tracks download failed:', error);
                alert('Failed to download liked tracks: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        }

        if (e.target.closest('#download-discography-btn')) {
            const btn = e.target.closest('#download-discography-btn');
            if (btn.disabled) return;

            const artistId = window.location.pathname.split('/')[2];
            if (!artistId) return;

            try {
                const artist = await api.getArtist(artistId);
                showDiscographyDownloadModal(artist, api, downloadQualitySettings.getQuality(), lyricsManager, btn);
            } catch (error) {
                console.error('Failed to load artist for discography download:', error);
                alert('Failed to load artist: ' + error.message);
            }
        }

        // Local Files Logic lollll (skip entirely on native — no File System Access API)
        if (!isNative && (e.target.closest('#select-local-folder-btn') || e.target.closest('#change-local-folder-btn'))) {
            try {
                const handle = await window.showDirectoryPicker({
                    id: 'music-folder',
                    mode: 'read',
                });

                await db.saveSetting('local_folder_handle', handle);

                const btn = document.getElementById('select-local-folder-btn');
                const btnText = document.getElementById('select-local-folder-text');
                if (btn) {
                    if (btnText) btnText.textContent = 'Scanning...';
                    else btn.textContent = 'Scanning...';
                    btn.disabled = true;
                }

                const tracks = [];
                let idCounter = 0;

                async function scanDirectory(dirHandle) {
                    for await (const entry of dirHandle.values()) {
                        if (entry.kind === 'file') {
                            const name = entry.name.toLowerCase();
                            if (
                                name.endsWith('.flac') ||
                                name.endsWith('.mp3') ||
                                name.endsWith('.m4a') ||
                                name.endsWith('.wav') ||
                                name.endsWith('.ogg')
                            ) {
                                const file = await entry.getFile();
                                const { readTrackMetadata } = await loadMetadataModule();
                                const metadata = await readTrackMetadata(file);
                                metadata.id = `local-${idCounter++}-${file.name}`;
                                tracks.push(metadata);
                            }
                        } else if (entry.kind === 'directory') {
                            await scanDirectory(entry);
                        }
                    }
                }

                await scanDirectory(handle);

                tracks.sort((a, b) => {
                    const artistA = a.artist.name || '';
                    const artistB = b.artist.name || '';
                    return artistA.localeCompare(artistB);
                });

                window.localFilesCache = tracks;
                ui.renderLibraryPage();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Error selecting folder:', err);
                    alert('Failed to access folder. Please try again.');
                }
                const btn = document.getElementById('select-local-folder-btn');
                const btnText = document.getElementById('select-local-folder-text');
                if (btn) {
                    if (btnText) btnText.textContent = 'Select Music Folder';
                    else btn.textContent = 'Select Music Folder';
                    btn.disabled = false;
                }
            }
        }
    });

    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');

    // Setup clear button for search bar
    ui.setupSearchClearButton(searchInput);

    const performSearch = debounce((query) => {
        if (query) {
            navigate(`/search/${encodeURIComponent(query)}`);
        }
    }, 300);

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 2) {
            performSearch(query);
        } else if (query.length === 0) {
            // When input is cleared, show explore landing
            const exploreLanding = document.getElementById('explore-landing');
            const searchResultsTitle = document.getElementById('search-results-title');
            const searchTabs = document.querySelector('.search-tabs');
            if (exploreLanding) { exploreLanding.style.display = ''; ui._renderExploreLanding(); }
            if (searchResultsTitle) searchResultsTitle.style.display = 'none';
            if (searchTabs) searchTabs.style.display = 'none';
            document.querySelectorAll('.search-tab-content').forEach(el => { el.style.display = 'none'; el.classList.remove('active'); });
            const allContainer = document.getElementById('search-all-container');
            if (allContainer) allContainer.innerHTML = '';
        }
    });

    searchInput.addEventListener('change', (e) => {
        const query = e.target.value.trim();
        if (query.length > 2) {
            ui.addToSearchHistory(query);
        }
    });

    searchInput.addEventListener('focus', () => {
        ui.renderSearchHistory();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-bar')) {
            const historyEl = document.getElementById('search-history');
            if (historyEl) historyEl.style.display = 'none';
        }
    });

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
            ui.addToSearchHistory(query);
            navigate(`/search/${encodeURIComponent(query)}`);
            const historyEl = document.getElementById('search-history');
            if (historyEl) historyEl.style.display = 'none';
        }
    });

    // ── Network-aware offline sync (uses unified networkMonitor) ──
    onNetworkChange(async (online) => {
        if (online) {
            const { offlineSync } = await import('./offlineSync.js');
            offlineSync.syncPendingEvents();
        }
    });

    // Initialize offline sync and start periodic sync
    (async () => {
        const { offlineSync } = await import('./offlineSync.js');
        offlineSync.startPeriodicSync();
        // Sync any pending events on startup
        if (navigator.onLine) {
            setTimeout(() => offlineSync.syncPendingEvents(), 2000); // Wait 2s for auth to settle
        }
    })();

    document.querySelector('.now-playing-bar .play-pause-btn').innerHTML = SVG_PLAY;

    const router = createRouter(ui);

    const handleRouteChange = async (event) => {
        const overlay = document.getElementById('fullscreen-cover-overlay');
        // Remove fullscreen-open class when navigating away
        if (window.location.hash !== '#fullscreen') {
            document.body.classList.remove('fullscreen-open');
        }
        const isFullscreenOpen = overlay && getComputedStyle(overlay).display === 'flex';

        if (isFullscreenOpen && window.location.hash !== '#fullscreen') {
            ui.closeFullscreenCover();
        }

        if (event && event.state && event.state.exitTrap) {
            const { showNotification } = await loadDownloadsModule();
            showNotification('Press back again to exit');
            setTimeout(() => {
                if (history.state && history.state.exitTrap) {
                    history.pushState({ app: true }, '', window.location.pathname);
                }
            }, 2000);
            return;
        }

        await router();
        updateTabTitle(player);
    };

    await handleRouteChange();

    window.addEventListener('popstate', handleRouteChange);

    document.body.addEventListener('click', (e) => {
        // If another handler already handled this click, don't interfere
        if (e.defaultPrevented) return;

        const link = e.target.closest('a');

        // Don't navigate if it's a search result track (they play music instead)
        if (link && (link.classList.contains('search-top-result') || link.classList.contains('search-mixed-item'))) {
            if (link.hasAttribute('data-track-id')) {
                return; // Let the search handler deal with it
            }
        }

        if (
            link &&
            link.origin === window.location.origin &&
            link.target !== '_blank' &&
            !link.hasAttribute('download')
        ) {
            e.preventDefault();
            navigate(link.pathname);
        }
    });

    audioPlayer.addEventListener('play', () => {
        updateTabTitle(player);
    });

    // PWA Update Logic
    const updateSW = registerSW({
        onNeedRefresh() {
            showUpdateNotification(() => updateSW(true));
        },
        onOfflineReady() {
            console.log('App ready to work offline');
        },
    });

    document.getElementById('show-shortcuts-btn')?.addEventListener('click', () => {
        showKeyboardShortcuts();
    });

    // Listener for Supabase Sync updates
    window.addEventListener('library-changed', () => {
        const path = window.location.pathname;
        if (path === '/library') {
            ui.renderLibraryPage();
        } else if (path === '/' || path === '/home') {
            ui.renderHomePage();
        } else if (path.startsWith('/userplaylist/')) {
            const playlistId = path.split('/')[2];
            const content = document.querySelector('.main-content');
            const scroll = content ? content.scrollTop : 0;
            ui.renderPlaylistPage(playlistId, 'user').then(() => {
                if (content) content.scrollTop = scroll;
            });
        }
    });
    window.addEventListener('history-changed', () => {
        const path = window.location.pathname;
        if (path === '/recent') {
            ui.renderRecentPage();
        }
    });

    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (contextMenu.style.display === 'block') {
                        const track = contextMenu._contextTrack;
                        const albumItem = contextMenu.querySelector('[data-action="go-to-album"]');
                        const artistItem = contextMenu.querySelector('[data-action="go-to-artist"]');

                        if (track) {
                            if (albumItem) {
                                let label = 'album';
                                const albumType = track.album?.type?.toUpperCase();
                                const trackCount = track.album?.numberOfTracks;

                                if (albumType === 'SINGLE' || trackCount === 1) label = 'single';
                                else if (albumType === 'EP') label = 'EP';
                                else if (trackCount && trackCount <= 6) label = 'EP';

                                albumItem.textContent = `Go to ${label}`;
                                albumItem.style.display = track.album ? 'block' : 'none';
                            }
                            if (artistItem) {
                                const hasArtist = track.artist || (track.artists && track.artists.length > 0);
                                artistItem.style.display = hasArtist ? 'block' : 'none';
                            }
                        }
                    }
                }
            });
        });

        observer.observe(contextMenu, { attributes: true });
    }

    // === Account Page Event Handlers ===
    const googleSignInBtn = document.getElementById('google-sign-in-btn');
    if (googleSignInBtn) {
        googleSignInBtn.addEventListener('click', () => {
            authManager.signInWithGoogle();
        });
    }

    const emailSignInForm = document.getElementById('email-sign-in-form');
    if (emailSignInForm) {
        emailSignInForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('account-email-input')?.value?.trim();
            const password = document.getElementById('account-password-input')?.value;
            if (!email) return;
            if (password) {
                await authManager.signInWithEmailPassword(email, password);
            } else {
                await authManager.signInWithEmail(email);
                alert('Check your email for a magic link to sign in.');
            }
        });
    }

    const signUpBtn = document.getElementById('sign-up-btn');
    if (signUpBtn) {
        signUpBtn.addEventListener('click', async () => {
            const email = document.getElementById('account-email-input')?.value?.trim();
            const password = document.getElementById('account-password-input')?.value;
            if (!email || !password) {
                alert('Please enter both email and password to create an account.');
                return;
            }
            await authManager.signUpWithEmailPassword(email, password);
            alert('Account created! Check your email to confirm, then sign in.');
        });
    }

    const forgotPasswordBtn = document.getElementById('forgot-password-btn');
    if (forgotPasswordBtn) {
        forgotPasswordBtn.addEventListener('click', async () => {
            const email = document.getElementById('account-email-input')?.value?.trim();
            if (!email) {
                alert('Please enter your email address first.');
                return;
            }
            await authManager.sendPasswordReset(email);
        });
    }

    const signOutBtn = document.getElementById('sign-out-btn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', () => {
            authManager.signOut();
        });
    }


    // === Library Recent Tab Clear History Button ===
    const clearHistoryLibraryBtn = document.getElementById('clear-history-library-btn');
    if (clearHistoryLibraryBtn) {
        clearHistoryLibraryBtn.addEventListener('click', async () => {
            if (confirm('Clear all recently played tracks? This cannot be undone.')) {
                try {
                    await db.clearHistory();
                    const recentContainer = document.getElementById('library-recent-container');
                    if (recentContainer) {
                        recentContainer.innerHTML = '<div class="placeholder-text"><p>No recently played tracks yet.</p></div>';
                    }
                    } catch (err) {
                    console.error('Failed to clear history:', err);
                    alert('Failed to clear history');
                }
            }
        });
    }

    // ── Check for updates & announcements ──
    _initUpdateNotificationBar();
    _initAnnouncementBanners();
});

/* ══════════════════════════════════════════════════════════════
   UPDATE NOTIFICATION BAR — gradient bar BELOW mobile tab bar
   ══════════════════════════════════════════════════════════════ */

async function _initUpdateNotificationBar() {
    const bar = document.getElementById('update-notification-bar');
    if (!bar) return;
    try {
        const res = await fetch(apiUrl('/api/updates/check'));
        const updates = await res.json();
        if (!Array.isArray(updates) || updates.length === 0) { bar.style.display = 'none'; return; }

        _injectUpdateBarStyles();
        const latest = updates[0];
        const count = updates.length;

        bar.style.display = '';
        bar.className = 'tunes-update-bar';
        bar.setAttribute('data-update-id', latest.id);
        bar.setAttribute('data-update-link', latest.link || '');

        const categoryIcons = { feature: '✦', bugfix: '🛠', improvement: '⚡', security: '🔒' };
        const icon = categoryIcons[latest.category] || '✦';

        bar.innerHTML = `
            <div class="tunes-update-inner">
                <span class="tunes-update-icon">${icon}</span>
                    <span class="tunes-update-text">${_esc(latest.title)}</span>
                ${count > 1 ? `<span class="tunes-update-badge">${count}</span>` : ''}
                    <span class="tunes-update-arrow">→</span>
            </div>
        `;

        // Click opens the link + track click
        bar.addEventListener('click', () => {
            const link = bar.getAttribute('data-update-link');
            const uid = bar.getAttribute('data-update-id');
            _trackEvent('update', uid, 'click');
            if (link) window.open(link, '_blank', 'noopener');
        });

        // Fade-in + push tab bar up + track impression
        requestAnimationFrame(() => {
            bar.classList.add('tunes-update-visible');
            document.body.classList.add('has-update-bar');
            _trackEvent('update', latest.id, 'impression');
        });

    } catch (e) {
        console.warn('[Updates] Could not check for updates:', e);
        if (bar) bar.style.display = 'none';
    }
}

function _injectUpdateBarStyles() {
    if (document.getElementById('tunes-update-bar-styles')) return;
    const s = document.createElement('style');
    s.id = 'tunes-update-bar-styles';
    s.textContent = `
.tunes-update-bar{
    position:fixed;
    bottom:0;
    left:0;
    right:0;
    z-index:10001;
    cursor:pointer;
    opacity:0;
    transform:translateY(100%);
    transition:opacity 0.5s cubic-bezier(.22,1,.36,1),transform 0.5s cubic-bezier(.22,1,.36,1);
    -webkit-tap-highlight-color:transparent;
}
.tunes-update-bar.tunes-update-visible{
    opacity:1;
    transform:translateY(0);
}
.tunes-update-inner{
    display:flex;
    align-items:center;
    justify-content:center;
    gap:0.45rem;
    padding:0.55rem 1rem;
    background:linear-gradient(135deg,#c084fc,#a855f7,#ec4899,#f43f5e);
    background-size:200% 200%;
    animation:tunes-update-gradient-shift 4s ease infinite;
    box-shadow:0 -4px 20px rgba(168,85,247,0.3),0 -1px 8px rgba(236,72,153,0.2);
}
.tunes-update-text{
    font-size:0.72rem;
    font-weight:700;
    color:#000;
    letter-spacing:-0.01em;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    max-width:70vw;
}
.tunes-update-icon{
    font-size:0.7rem;
    color:#000;
    animation:tunes-update-pulse 2s ease-in-out infinite;
}
.tunes-update-arrow{
    font-size:0.7rem;
    color:rgba(0,0,0,0.6);
    transition:transform 0.2s;
}
.tunes-update-bar:hover .tunes-update-arrow{
    transform:translateX(2px);
}
.tunes-update-badge{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    min-width:1.1rem;
    height:1.1rem;
    padding:0 0.3rem;
    border-radius:999px;
    background:rgba(88,28,135,0.85);
    color:#e9d5ff;
    font-size:0.6rem;
    font-weight:800;
    letter-spacing:0;
    line-height:1;
    backdrop-filter:blur(4px);
    box-shadow:0 0 6px rgba(88,28,135,0.4);
}
@keyframes tunes-update-pulse{
    0%,100%{opacity:0.6;transform:scale(0.9)}
    50%{opacity:1;transform:scale(1.15)}
}
@keyframes tunes-update-gradient-shift{
    0%{background-position:0% 50%}
    50%{background-position:100% 50%}
    100%{background-position:0% 50%}
}
/* Desktop: show as thin bar at bottom of sidebar area */
@media(min-width:769px){
    .tunes-update-bar{
        position:fixed;
        bottom:0;
        left:0;
        right:0;
        z-index:10001;
    }
}
/* Ensure no overlap — push above safe area on iOS */
@supports(padding-bottom: env(safe-area-inset-bottom)){
    .tunes-update-inner{
        padding-bottom:calc(0.55rem + env(safe-area-inset-bottom));
    }
}
/* Light theme */
[data-theme="light"] .tunes-update-inner{
    background:linear-gradient(135deg,#c084fc,#a855f7,#ec4899,#f43f5e);
    box-shadow:0 -4px 16px rgba(168,85,247,0.2),0 -1px 6px rgba(236,72,153,0.15);
}
[data-theme="light"] .tunes-update-text{color:#000;}
    `;
    document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════
   ANNOUNCEMENT BANNERS — stacked, glassmorphism, custom gradients
   ══════════════════════════════════════════════════════════════ */

function _shouldShowAnnouncement(ann) {
    const freq = ann.frequency || 'always';
    if (freq === 'always') return true;
    const key = `tunes_ann_seen_${ann.id}`;
    const stored = localStorage.getItem(key);
    if (!stored) return true;

    try {
        const data = JSON.parse(stored);
        if (freq === 'once_ever') return false;
        if (freq === 'once_per_session') {
            // Session = per page load, tracked by sessionStorage
            return !sessionStorage.getItem(key);
        }
        if (freq === 'once_per_day') {
            const lastSeen = new Date(data.ts);
            const now = new Date();
            return lastSeen.toDateString() !== now.toDateString();
        }
    } catch { return true; }
    return true;
}

function _markAnnouncementSeen(ann) {
    const freq = ann.frequency || 'always';
    if (freq === 'always') return;
    const key = `tunes_ann_seen_${ann.id}`;
    localStorage.setItem(key, JSON.stringify({ ts: Date.now() }));
    if (freq === 'once_per_session') sessionStorage.setItem(key, '1');
}

// Global store for announcement data (used by modal)
const _annDataMap = new Map();

async function _initAnnouncementBanners() {
    try {
        const res = await fetch(apiUrl('/api/announcements/active'));
        const announcements = await res.json();
        if (!Array.isArray(announcements) || announcements.length === 0) return;

        // Store data for modal access
        announcements.forEach(a => _annDataMap.set(String(a.id), a));

        // Filter by frequency cap
        const visible = announcements.filter(a => _shouldShowAnnouncement(a));
        if (visible.length === 0) return;

        _injectAnnouncementStyles();

        // Mark them seen
        visible.forEach(a => _markAnnouncementSeen(a));

        // Build stacked banners HTML for home/explore (full)
        const fullHTML = visible.map(a => _buildAnnouncementBanner(a, false)).join('');
        _setAnnouncementSlot('home-announcement-banner', fullHTML);
        _setAnnouncementSlot('explore-announcement-banner', fullHTML);

        // Build compact version for sidebar
        const compactHTML = visible.map(a => _buildAnnouncementBanner(a, true)).join('');
        _setAnnouncementSlot('sidebar-announcement-banner', compactHTML);

        // Track impressions for each visible announcement
        visible.forEach(a => _trackEvent('announcement', a.id, 'impression'));

        // Wire CTA click tracking + card click → fullscreen modal
        document.querySelectorAll('[data-ann-id]').forEach(el => {
            if (el.tagName === 'A' || el.classList.contains('tunes-ann-cta-btn') || el.classList.contains('tunes-ann-compact-link')) {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    _trackEvent('announcement', el.getAttribute('data-ann-id'), 'click');
                });
            }
        });

        // Wire card body click → open fullscreen modal
        document.querySelectorAll('.tunes-ann-card').forEach(card => {
            card.style.cursor = 'pointer';
            card.addEventListener('click', (e) => {
                // Don't open modal if clicking a CTA link
                if (e.target.closest('a')) return;
                const annId = card.getAttribute('data-ann-id');
                _openAnnouncementModal(annId);
            });
        });

    } catch (e) {
        console.warn('[Announcements] Could not load announcements:', e);
    }
}

function _buildAnnouncementBanner(ann, compact = false) {
    const gs = ann.gradient_start || '#a855f7';
    const ge = ann.gradient_end || '#ec4899';
    const hasImage = ann.image_url;
    const tag = _esc(ann.tag || 'NEW');
    const typeLabel = (ann.type || 'announcement').toUpperCase();
    const body = ann.body ? `<p class="tunes-ann-body">${_esc(ann.body)}</p>` : '';

    // CTA buttons (up to 3)
    let ctaHTML = '';
    const buttons = Array.isArray(ann.cta_buttons) ? ann.cta_buttons.slice(0, 3) : [];
    if (buttons.length > 0) {
        ctaHTML = `<div class="tunes-ann-ctas">${buttons.map((b, i) =>
            `<a href="${_esc(b.url || '#')}" target="_blank" rel="noopener" class="tunes-ann-cta-btn${i === 0 ? ' primary' : ''}" data-ann-id="${ann.id}">${_esc(b.text || 'Learn more')}</a>`
        ).join('')}</div>`;
    } else if (ann.link) {
        ctaHTML = `<div class="tunes-ann-ctas"><a href="${_esc(ann.link)}" target="_blank" rel="noopener" class="tunes-ann-cta-btn primary" data-ann-id="${ann.id}">Learn more →</a></div>`;
    }

    if (compact) {
        // Sidebar compact variant
    return `
            <div class="tunes-ann-card compact" data-ann-id="${ann.id}"
                 style="--ann-gs:${gs};--ann-ge:${ge};">
                <div class="tunes-ann-card-glow"></div>
                <div class="tunes-ann-card-inner">
                    <span class="tunes-ann-tag-pill">${tag}</span>
                    <span class="tunes-ann-card-title">${_esc(ann.title)}</span>
                    ${buttons.length > 0 ?
                        `<a href="${_esc(buttons[0].url || ann.link || '#')}" target="_blank" rel="noopener" class="tunes-ann-compact-link" data-ann-id="${ann.id}">${_esc(buttons[0].text || 'Go')} →</a>`
                    : ann.link ?
                        `<a href="${_esc(ann.link)}" target="_blank" rel="noopener" class="tunes-ann-compact-link" data-ann-id="${ann.id}">Go →</a>`
                    : ''}
            </div>
            </div>
        `;
    }

    // Full banner
    return `
        <div class="tunes-ann-card" data-ann-id="${ann.id}"
             style="--ann-gs:${gs};--ann-ge:${ge};">
            <div class="tunes-ann-card-glow"></div>
            <div class="tunes-ann-card-body">
                ${hasImage ? `<img src="${_esc(ann.image_url)}" alt="" class="tunes-ann-card-img" />` : ''}
                <div class="tunes-ann-card-content">
                    <div class="tunes-ann-card-header">
                        <span class="tunes-ann-tag-pill">${tag}</span>
                        <span class="tunes-ann-type-label">${typeLabel}</span>
                    </div>
                    <h3 class="tunes-ann-card-title">${_esc(ann.title)}</h3>
                    ${body}
                    ${ctaHTML}
                </div>
            </div>
        </div>
    `;
}

function _setAnnouncementSlot(elementId, html) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
}

/* ══════════════════════════════════════════════════════════════
   ANNOUNCEMENT FULLSCREEN MODAL
   ══════════════════════════════════════════════════════════════ */
function _openAnnouncementModal(annId) {
    const ann = _annDataMap.get(String(annId));
    if (!ann) return;

    // Remove existing modal if any
    const old = document.getElementById('ann-modal-overlay');
    if (old) old.remove();

    const gs = ann.gradient_start || '#a855f7';
    const ge = ann.gradient_end || '#ec4899';
    const tag = _esc(ann.tag || 'NEW');
    const typeLabel = (ann.type || 'announcement').toUpperCase();

    // CTA buttons
    let ctaHTML = '';
    const buttons = Array.isArray(ann.cta_buttons) ? ann.cta_buttons.slice(0, 3) : [];
    if (buttons.length > 0) {
        ctaHTML = buttons.map((b, i) =>
            `<a href="${_esc(b.url || '#')}" target="_blank" rel="noopener"
                class="ann-modal-cta${i === 0 ? ' primary' : ''}"
                style="--ann-gs:${gs};--ann-ge:${ge};"
                data-ann-id="${ann.id}">${_esc(b.text || 'Learn more')}</a>`
        ).join('');
    } else if (ann.link) {
        ctaHTML = `<a href="${_esc(ann.link)}" target="_blank" rel="noopener"
            class="ann-modal-cta primary"
            style="--ann-gs:${gs};--ann-ge:${ge};"
            data-ann-id="${ann.id}">Learn more →</a>`;
    }

    const overlay = document.createElement('div');
    overlay.id = 'ann-modal-overlay';
    overlay.style.cssText = `--ann-gs:${gs};--ann-ge:${ge};`;
    overlay.innerHTML = `
        <div class="ann-modal-backdrop"></div>
        <div class="ann-modal-container">
            <!-- Close button -->
            <button class="ann-modal-close" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>

            <!-- Hero image area -->
            ${ann.image_url ? `
            <div class="ann-modal-hero">
                <img src="${_esc(ann.image_url)}" alt="" class="ann-modal-hero-img" />
                <div class="ann-modal-hero-fade"></div>
                <div class="ann-modal-hero-glow"></div>
            </div>
            ` : `
            <div class="ann-modal-hero no-img">
                <div class="ann-modal-hero-gradient" style="background:linear-gradient(135deg,${gs},${ge});"></div>
                <div class="ann-modal-hero-fade"></div>
                <div class="ann-modal-hero-pattern"></div>
            </div>
            `}

            <!-- Content -->
            <div class="ann-modal-content">
                <div class="ann-modal-meta">
                    <span class="ann-modal-tag" style="background:linear-gradient(135deg,${gs},${ge});">${tag}</span>
                    <span class="ann-modal-type">${typeLabel}</span>
                    ${ann.created_at ? `<span class="ann-modal-date">${new Date(ann.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}
                </div>
                <h2 class="ann-modal-title">${_esc(ann.title)}</h2>
                ${ann.body ? `<p class="ann-modal-body">${_esc(ann.body)}</p>` : ''}
                ${ctaHTML ? `<div class="ann-modal-ctas">${ctaHTML}</div>` : ''}
            </div>

            <!-- Bottom gradient accent -->
            <div class="ann-modal-bottom-bar" style="background:linear-gradient(90deg,${gs},${ge});"></div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => {
        overlay.classList.add('ann-modal-visible');
    });

    // Close handlers
    const close = () => {
        overlay.classList.remove('ann-modal-visible');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        // Fallback removal
        setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 400);
    };
    overlay.querySelector('.ann-modal-close').addEventListener('click', close);
    overlay.querySelector('.ann-modal-backdrop').addEventListener('click', close);

    // Track click
    _trackEvent('announcement', ann.id, 'click');

    // Wire CTA tracking
    overlay.querySelectorAll('.ann-modal-cta').forEach(cta => {
        cta.addEventListener('click', (e) => {
            e.stopPropagation();
            _trackEvent('announcement', ann.id, 'click');
        });
    });
}

function _injectAnnouncementStyles() {
    if (document.getElementById('tunes-ann-styles')) return;
    const s = document.createElement('style');
    s.id = 'tunes-ann-styles';
    s.textContent = `
/* ─── Full announcement card ─────────────────────── */
.tunes-ann-card{
    position:relative;
    border-radius:1.1rem;
    overflow:hidden;
    margin-bottom:0.65rem;
    background:rgba(9,9,11,0.55);
    backdrop-filter:blur(28px) saturate(1.4);
    -webkit-backdrop-filter:blur(28px) saturate(1.4);
    border:1px solid rgba(255,255,255,0.08);
    box-shadow:
        0 0 0 1px rgba(255,255,255,0.04),
        0 0 24px color-mix(in srgb, var(--ann-gs) 15%, transparent),
        0 8px 32px rgba(0,0,0,0.45);
    transition:transform 0.25s cubic-bezier(.22,1,.36,1),box-shadow 0.3s;
}
.tunes-ann-card:hover{
    transform:translateY(-1px);
    box-shadow:
        0 0 0 1px rgba(255,255,255,0.06),
        0 0 32px color-mix(in srgb, var(--ann-gs) 22%, transparent),
        0 12px 40px rgba(0,0,0,0.5);
}
.tunes-ann-card:active{transform:scale(0.99)}

/* Glow accent */
.tunes-ann-card-glow{
    position:absolute;
    top:-40%;left:-20%;
    width:80%;height:180%;
    background:radial-gradient(ellipse at 30% 50%, color-mix(in srgb, var(--ann-gs) 12%, transparent), transparent 70%);
    pointer-events:none;
    z-index:0;
}
.tunes-ann-card::after{
    content:'';
    position:absolute;
    bottom:0;left:0;right:0;
    height:3px;
    background:linear-gradient(90deg, var(--ann-gs), var(--ann-ge));
    opacity:0.7;
}

/* Body layout */
.tunes-ann-card-body{
    position:relative;
    z-index:1;
    display:flex;
    align-items:flex-start;
    gap:0.85rem;
    padding:1rem 1.15rem;
}
.tunes-ann-card-img{
    width:52px;height:52px;border-radius:10px;object-fit:cover;flex-shrink:0;
    border:1px solid rgba(255,255,255,0.06);
}
.tunes-ann-card-content{
    display:flex;flex-direction:column;gap:0.25rem;min-width:0;flex:1;
}

/* Header row */
.tunes-ann-card-header{
    display:flex;align-items:center;gap:0.4rem;
}
.tunes-ann-tag-pill{
    display:inline-block;
    font-size:0.52rem;
    font-weight:800;
    letter-spacing:0.1em;
    text-transform:uppercase;
    padding:0.15rem 0.45rem;
    border-radius:4px;
    background:linear-gradient(135deg, var(--ann-gs), var(--ann-ge));
    color:#000;
    line-height:1.3;
}
.tunes-ann-type-label{
    font-size:0.52rem;
    font-weight:600;
    letter-spacing:0.06em;
    opacity:0.35;
    text-transform:uppercase;
}

/* Title & body */
.tunes-ann-card-title{
    font-size:0.95rem;
    font-weight:700;
    letter-spacing:-0.02em;
    color:#fff;
    line-height:1.3;
    margin:0.1rem 0 0;
    display:-webkit-box;
    -webkit-line-clamp:2;
    -webkit-box-orient:vertical;
    overflow:hidden;
}
.tunes-ann-body{
    font-size:0.78rem;
    line-height:1.5;
    color:rgba(255,255,255,0.55);
    margin:0.15rem 0 0;
    display:-webkit-box;
    -webkit-line-clamp:3;
    -webkit-box-orient:vertical;
    overflow:hidden;
}

/* CTA buttons */
.tunes-ann-ctas{
    display:flex;
    gap:0.4rem;
    margin-top:0.45rem;
    flex-wrap:wrap;
}
.tunes-ann-cta-btn{
    display:inline-block;
    font-size:0.68rem;
    font-weight:600;
    letter-spacing:0.01em;
    padding:0.3rem 0.7rem;
    border-radius:6px;
    text-decoration:none;
    transition:all 0.2s;
    cursor:pointer;
    color:rgba(255,255,255,0.7);
    background:rgba(255,255,255,0.06);
    border:1px solid rgba(255,255,255,0.08);
}
.tunes-ann-cta-btn.primary{
    background:linear-gradient(135deg, var(--ann-gs), var(--ann-ge));
    color:#000;
    font-weight:700;
    border:none;
    box-shadow:0 2px 8px color-mix(in srgb, var(--ann-gs) 25%, transparent);
}
.tunes-ann-cta-btn:hover{
    transform:translateY(-1px);
    filter:brightness(1.1);
}

/* ─── Compact sidebar variant ──────────────────── */
.tunes-ann-card.compact{
    margin-bottom:0.45rem;
    border-radius:0.75rem;
    background:rgba(9,9,11,0.45);
}
.tunes-ann-card.compact .tunes-ann-card-glow{
    width:60%;height:140%;
}
.tunes-ann-card.compact::after{
    height:2px;
}
.tunes-ann-card-inner{
    position:relative;
    z-index:1;
    display:flex;
    align-items:center;
    gap:0.4rem;
    padding:0.55rem 0.7rem;
    flex-wrap:wrap;
}
.tunes-ann-card.compact .tunes-ann-tag-pill{
    font-size:0.45rem;
    padding:0.1rem 0.35rem;
}
.tunes-ann-card.compact .tunes-ann-card-title{
    font-size:0.75rem;
    font-weight:600;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    flex:1;
    min-width:0;
    margin:0;
}
.tunes-ann-compact-link{
    font-size:0.65rem;
    font-weight:600;
    color:rgba(255,255,255,0.5);
    text-decoration:none;
    white-space:nowrap;
    transition:color 0.2s;
}
.tunes-ann-compact-link:hover{
    color:#fff;
}

/* ─── Light theme ──────────────────────────────── */
[data-theme="light"] .tunes-ann-card{
    background:rgba(255,255,255,0.7);
    border-color:rgba(0,0,0,0.06);
    box-shadow:
        0 0 0 1px rgba(0,0,0,0.03),
        0 0 16px color-mix(in srgb, var(--ann-gs) 8%, transparent),
        0 6px 20px rgba(0,0,0,0.06);
}
[data-theme="light"] .tunes-ann-card-title{color:var(--foreground);}
[data-theme="light"] .tunes-ann-body{color:var(--muted-foreground);}
[data-theme="light"] .tunes-ann-cta-btn{
    color:var(--muted-foreground);
    background:rgba(0,0,0,0.04);
    border-color:rgba(0,0,0,0.08);
}
[data-theme="light"] .tunes-ann-cta-btn.primary{color:#000;}
[data-theme="light"] .tunes-ann-compact-link{color:var(--muted-foreground);}

/* ─── Stacking animation ──────────────────────── */
.tunes-ann-card{
    animation:tunes-ann-fade-up 0.5s cubic-bezier(.22,1,.36,1) both;
}
.tunes-ann-card:nth-child(2){animation-delay:0.08s}
.tunes-ann-card:nth-child(3){animation-delay:0.16s}
@keyframes tunes-ann-fade-up{
    from{opacity:0;transform:translateY(10px)}
    to{opacity:1;transform:translateY(0)}
}

/* ══════════════════════════════════════════════════════════════
   ANNOUNCEMENT FULLSCREEN MODAL
   ══════════════════════════════════════════════════════════════ */
#ann-modal-overlay{
    position:fixed;
    inset:0;
    z-index:99999;
    display:flex;
    align-items:center;
    justify-content:center;
    opacity:0;
    transition:opacity 0.3s cubic-bezier(.22,1,.36,1);
    pointer-events:none;
}
#ann-modal-overlay.ann-modal-visible{
    opacity:1;
    pointer-events:all;
}

/* Blurred backdrop */
.ann-modal-backdrop{
    position:absolute;
    inset:0;
    background:rgba(0,0,0,0.75);
    backdrop-filter:blur(20px) saturate(0.8);
    -webkit-backdrop-filter:blur(20px) saturate(0.8);
}

/* Modal container */
.ann-modal-container{
    position:relative;
    width:92vw;
    max-width:420px;
    max-height:90vh;
    border-radius:1.4rem;
    overflow:hidden;
    overflow-y:auto;
    background:rgba(12,12,16,0.92);
    backdrop-filter:blur(40px) saturate(1.5);
    -webkit-backdrop-filter:blur(40px) saturate(1.5);
    border:1px solid rgba(255,255,255,0.08);
    box-shadow:
        0 0 0 1px rgba(255,255,255,0.04),
        0 0 60px color-mix(in srgb, var(--ann-gs) 15%, transparent),
        0 0 120px color-mix(in srgb, var(--ann-ge) 8%, transparent),
        0 24px 80px rgba(0,0,0,0.6);
    transform:translateY(20px) scale(0.97);
    transition:transform 0.35s cubic-bezier(.22,1,.36,1);
}
#ann-modal-overlay.ann-modal-visible .ann-modal-container{
    transform:translateY(0) scale(1);
}

/* Hide scrollbar */
.ann-modal-container::-webkit-scrollbar{display:none;}
.ann-modal-container{-ms-overflow-style:none;scrollbar-width:none;}

/* Close button */
.ann-modal-close{
    position:absolute;
    top:0.85rem;
    right:0.85rem;
    z-index:10;
    width:36px;height:36px;
    display:flex;align-items:center;justify-content:center;
    border-radius:50%;
    background:rgba(0,0,0,0.5);
    backdrop-filter:blur(12px);
    -webkit-backdrop-filter:blur(12px);
    border:1px solid rgba(255,255,255,0.1);
    color:rgba(255,255,255,0.7);
    cursor:pointer;
    transition:all 0.2s;
}
.ann-modal-close:hover{
    background:rgba(255,255,255,0.1);
    color:#fff;
    transform:scale(1.08);
}

/* Hero image area */
.ann-modal-hero{
    position:relative;
    width:100%;
    height:220px;
    overflow:hidden;
}
.ann-modal-hero.no-img{
    height:160px;
}
.ann-modal-hero-img{
    width:100%;height:100%;
    object-fit:cover;
    display:block;
}
.ann-modal-hero-gradient{
    width:100%;height:100%;
    opacity:0.6;
}
.ann-modal-hero-fade{
    position:absolute;
    bottom:0;left:0;right:0;
    height:80px;
    background:linear-gradient(to top, rgba(12,12,16,0.92), transparent);
    pointer-events:none;
}
.ann-modal-hero-glow{
    position:absolute;
    top:0;left:0;
    width:100%;height:100%;
    background:radial-gradient(ellipse at 50% 80%, color-mix(in srgb, var(--ann-gs) 15%, transparent), transparent 65%);
    pointer-events:none;
}
.ann-modal-hero-pattern{
    position:absolute;
    inset:0;
    background:
        radial-gradient(circle at 20% 30%, color-mix(in srgb, var(--ann-gs) 20%, transparent) 0%, transparent 50%),
        radial-gradient(circle at 80% 60%, color-mix(in srgb, var(--ann-ge) 15%, transparent) 0%, transparent 50%);
    pointer-events:none;
    animation:ann-modal-pattern-shift 6s ease-in-out infinite alternate;
}
@keyframes ann-modal-pattern-shift{
    from{opacity:0.7;transform:scale(1)}
    to{opacity:1;transform:scale(1.08)}
}

/* Content area */
.ann-modal-content{
    padding:1.25rem 1.5rem 1.5rem;
}

/* Meta row */
.ann-modal-meta{
    display:flex;
    align-items:center;
    gap:0.5rem;
    margin-bottom:0.75rem;
}
.ann-modal-tag{
    display:inline-block;
    font-size:0.58rem;
    font-weight:800;
    letter-spacing:0.1em;
    text-transform:uppercase;
    padding:0.2rem 0.55rem;
    border-radius:5px;
    color:#000;
    line-height:1.3;
}
.ann-modal-type{
    font-size:0.55rem;
    font-weight:600;
    letter-spacing:0.06em;
    opacity:0.35;
    text-transform:uppercase;
}
.ann-modal-date{
    font-size:0.55rem;
    opacity:0.3;
    margin-left:auto;
}

/* Title */
.ann-modal-title{
    font-size:1.35rem;
    font-weight:800;
    letter-spacing:-0.03em;
    line-height:1.25;
    color:#fff;
    margin:0 0 0.65rem;
}

/* Body text */
.ann-modal-body{
    font-size:0.88rem;
    line-height:1.65;
    color:rgba(255,255,255,0.6);
    margin:0 0 1.1rem;
    white-space:pre-line;
}

/* CTA buttons */
.ann-modal-ctas{
    display:flex;
    gap:0.55rem;
    flex-wrap:wrap;
    margin-top:0.25rem;
}
.ann-modal-cta{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    font-size:0.8rem;
    font-weight:600;
    padding:0.55rem 1.2rem;
    border-radius:10px;
    text-decoration:none;
    transition:all 0.2s;
    cursor:pointer;
    color:rgba(255,255,255,0.7);
    background:rgba(255,255,255,0.06);
    border:1px solid rgba(255,255,255,0.1);
}
.ann-modal-cta.primary{
    background:linear-gradient(135deg, var(--ann-gs), var(--ann-ge));
    color:#000;
    font-weight:700;
    border:none;
    box-shadow:0 4px 16px color-mix(in srgb, var(--ann-gs) 30%, transparent);
}
.ann-modal-cta:hover{
    transform:translateY(-2px);
    filter:brightness(1.12);
}

/* Bottom accent bar */
.ann-modal-bottom-bar{
    height:3px;
    opacity:0.6;
}
    `;
    document.head.appendChild(s);
}

function _esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Tracking helper — fires impression / click events ── */
const _trackedEvents = new Set(); // prevent duplicate fires per session

async function _trackEvent(itemType, itemId, eventType) {
    const user = authManager?.user;
    if (!user) return;
    const key = `${itemType}_${itemId}_${eventType}`;
    if (_trackedEvents.has(key)) return;
    _trackedEvents.add(key);

    // Import offline sync manager
    const { offlineSync } = await import('./offlineSync.js');
    
    // Check if online
    const isOnline = await offlineSync.checkOnline();
    
    if (!isOnline) {
        // Queue for offline sync
        await offlineSync.queueTrackEvent(itemType, itemId, eventType);
        return;
    }

    // Try direct send if online
    try {
        const res = await fetch(apiUrl('/api/track-event'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_type: itemType,
                item_id: Number(itemId),
                user_id: user.uid,
                event_type: eventType
            })
        });
        if (!res.ok) {
            // If send fails, queue for retry
            await offlineSync.queueTrackEvent(itemType, itemId, eventType);
        }
    } catch (e) {
        // Network error — queue for offline sync
        await offlineSync.queueTrackEvent(itemType, itemId, eventType);
    }
}

// === Pull-to-Refresh on Homepage ===
(function initPullToRefresh() {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    let startY = 0;
    let pulling = false;
    let pullIndicator = null;

    function createPullIndicator() {
        if (pullIndicator) return pullIndicator;
        pullIndicator = document.createElement('div');
        pullIndicator.id = 'pull-to-refresh-indicator';
        pullIndicator.style.cssText = 'position:absolute;top:0;left:0;right:0;height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:height 0.2s;z-index:50;pointer-events:none;';
        pullIndicator.innerHTML = '<div style="display:flex;align-items:center;gap:0.5rem;opacity:0.5;font-size:0.8rem;font-family:DM Sans,sans-serif;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ptr-arrow" style="transition:transform 0.2s;"><polyline points="7 13 12 18 17 13"/><line x1="12" y1="18" x2="12" y2="6"/></svg> Pull to refresh</div>';
        mainContent.style.position = 'relative';
        mainContent.insertBefore(pullIndicator, mainContent.firstChild);
        return pullIndicator;
    }

    mainContent.addEventListener('touchstart', (e) => {
        if (mainContent.scrollTop <= 0 && window.location.pathname === '/' || window.location.pathname === '/home') {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });

    mainContent.addEventListener('touchmove', (e) => {
        if (!pulling) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 0 && mainContent.scrollTop <= 0) {
            const indicator = createPullIndicator();
            const h = Math.min(dy * 0.5, 80);
            indicator.style.height = h + 'px';
            const arrow = indicator.querySelector('.ptr-arrow');
            if (arrow) arrow.style.transform = h >= 60 ? 'rotate(180deg)' : '';
            if (h >= 60) {
                indicator.querySelector('div').lastChild.textContent = ' Release to refresh';
            } else {
                indicator.querySelector('div').lastChild.textContent = ' Pull to refresh';
            }
        }
    }, { passive: true });

    mainContent.addEventListener('touchend', () => {
        if (!pulling) return;
        pulling = false;
        const indicator = pullIndicator;
        if (indicator) {
            const h = parseInt(indicator.style.height);
            if (h >= 60) {
                indicator.innerHTML = '<div style="display:flex;align-items:center;gap:0.5rem;opacity:0.5;font-size:0.8rem;font-family:DM Sans,sans-serif;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.8s linear infinite;"><path d="M21 12a9 9 0 11-6.22-8.57"/></svg> Refreshing...</div>';
                // Real full page reload (like Ctrl+R)
                window.location.reload();
                return;
            } else {
                indicator.style.height = '0px';
            }
        }
    }, { passive: true });

    // Add spin animation
    const style = document.createElement('style');
    style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
})();

function showUpdateNotification(updateCallback) {
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div>
            <strong>Update Available</strong>
            <p>A new version of Tunes is available.</p>
        </div>
        <button class="btn-primary" id="update-now-btn">Update Now</button>
    `;
    document.body.appendChild(notification);

    document.getElementById('update-now-btn').addEventListener('click', () => {
        if (typeof updateCallback === 'function') {
            updateCallback();
        } else if (updateCallback && updateCallback.postMessage) {
            updateCallback.postMessage({ action: 'skipWaiting' });
        } else {
            window.location.reload();
        }
    });
}

function showMissingTracksNotification(missingTracks) {
    const modal = document.getElementById('missing-tracks-modal');
    const listUl = document.getElementById('missing-tracks-list-ul');

    listUl.innerHTML = missingTracks.map((track) => `<li>${track}</li>`).join('');

    const closeModal = () => modal.classList.remove('active');

    // Remove old listeners if any (though usually these functions are called once per instance,
    // but since we reuse the same modal element we should be careful or use a one-time listener)
    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.closest('.close-missing-tracks') ||
            e.target.id === 'close-missing-tracks-btn' ||
            e.target.classList.contains('modal-overlay')
        ) {
            closeModal();
            modal.removeEventListener('click', handleClose);
        }
    };

    modal.addEventListener('click', handleClose);
    modal.classList.add('active');
}

async function parseCSV(csvText, api, onProgress) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    // Robust CSV line parser that respects quotes
    const parseLine = (text) => {
        const values = [];
        let current = '';
        let inQuote = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === ',' && !inQuote) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current);

        // Clean up quotes: remove surrounding quotes and unescape double quotes if any
        return values.map((v) => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"').trim());
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1);

    const tracks = [];
    const missingTracks = [];
    const totalTracks = rows.length;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.trim()) continue; // Skip empty lines

        const values = parseLine(row);

        if (values.length >= headers.length) {
            let trackTitle = '';
            let artistNames = '';
            let albumName = '';

            headers.forEach((header, index) => {
                const value = values[index];
                if (!value) return;

                switch (header.toLowerCase()) {
                    case 'track name':
                    case 'title':
                    case 'song':
                        trackTitle = value;
                        break;
                    case 'artist name(s)':
                    case 'artist name':
                    case 'artist':
                    case 'artists':
                        artistNames = value;
                        break;
                    case 'album':
                    case 'album name':
                        albumName = value;
                        break;
                }
            });

            if (onProgress) {
                onProgress({
                    current: i,
                    total: totalTracks,
                    currentTrack: trackTitle || 'Unknown track',
                    currentArtist: artistNames || '',
                });
            }

            // Search for the track in hifi tidal api's catalog
            if (trackTitle && artistNames) {
                // Add a small delay to prevent rate limiting
                await new Promise((resolve) => setTimeout(resolve, 300));

                try {
                    let foundTrack = null;

                    // Helper: Normalize strings for fuzzy matching
                    const normalize = (str) =>
                        str
                            .normalize('NFD')
                            .replace(/[\u0300-\u036f]/g, '')
                            .toLowerCase()
                            .replace(/[^\w\s]/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();

                    // Helper: Check if result matches our criteria
                    const isValidMatch = (track, title, artists, album) => {
                        if (!track) return false;

                        const trackTitle = normalize(track.title || '');
                        const trackArtists = (track.artists || []).map((a) => normalize(a.name || '')).join(' ');
                        const trackAlbum = normalize(track.album?.name || '');

                        const queryTitle = normalize(title);
                        const queryArtists = normalize(artists);
                        const queryAlbum = normalize(album || '');

                        // Must match title (exact or substring match)
                        const titleMatch =
                            trackTitle === queryTitle ||
                            trackTitle.includes(queryTitle) ||
                            queryTitle.includes(trackTitle);
                        if (!titleMatch) return false;

                        // Must match at least one artist
                        const artistMatch =
                            trackArtists.includes(queryArtists.split(' ')[0]) ||
                            queryArtists.includes(trackArtists.split(' ')[0]);
                        if (!artistMatch) return false;

                        // If album provided, prefer matching album but not strict
                        if (queryAlbum) {
                            const albumMatch =
                                trackAlbum === queryAlbum ||
                                trackAlbum.includes(queryAlbum) ||
                                queryAlbum.includes(trackAlbum);
                            return albumMatch;
                        }

                        return true;
                    };

                    // 1. Initial Search: Title + All Artists + Album (most specific)
                    if (!foundTrack) {
                        let searchQuery = `${trackTitle} ${artistNames}`;
                        if (albumName) searchQuery += ` ${albumName}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            // Try to find best match within results
                            for (const result of searchResults.items) {
                                if (isValidMatch(result, trackTitle, artistNames, albumName)) {
                                    foundTrack = result;
                                    break;
                                }
                            }
                            // Fallback: if no valid match found, use first result only if album matches
                            if (!foundTrack && albumName) {
                                const firstResult = searchResults.items[0];
                                if (isValidMatch(firstResult, trackTitle, artistNames, albumName)) {
                                    foundTrack = firstResult;
                                }
                            }
                        }
                    }

                    // 2. Retry: Title + Main Artist + Album
                    if (!foundTrack && artistNames) {
                        const mainArtist = artistNames.split(',')[0].trim();
                        if (mainArtist && mainArtist !== artistNames) {
                            let searchQuery = `${trackTitle} ${mainArtist}`;
                            if (albumName) searchQuery += ` ${albumName}`;
                            const searchResults = await api.searchTracks(searchQuery);

                            if (searchResults.items && searchResults.items.length > 0) {
                                for (const result of searchResults.items) {
                                    if (isValidMatch(result, trackTitle, mainArtist, albumName)) {
                                        foundTrack = result;
                                        console.log(`Found (Retry 1 - Main Artist): ${trackTitle}`);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 3. Retry: Just Title + Album (strong album context)
                    if (!foundTrack && albumName) {
                        const searchQuery = `${trackTitle} ${albumName}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            for (const result of searchResults.items) {
                                if (isValidMatch(result, trackTitle, artistNames, albumName)) {
                                    foundTrack = result;
                                    console.log(`Found (Retry 2 - Album): ${trackTitle}`);
                                    break;
                                }
                            }
                        }
                    }

                    // Clean title for retry strategies
                    // Remove " - ", "(feat. ...)", "[feat. ...]"
                    const cleanTitle = (t) =>
                        t
                            .split(' - ')[0]
                            .replace(/\s*[([]feat\.?.*?[)\]]/i, '')
                            .trim();
                    const cleanedTitle = cleanTitle(trackTitle);
                    const isTitleCleaned = cleanedTitle !== trackTitle;

                    // 4. Retry: Cleaned Title + Main Artist + Album
                    if (!foundTrack && isTitleCleaned) {
                        const mainArtist = (artistNames || '').split(',')[0].trim();
                        if (cleanedTitle) {
                            let searchQuery = `${cleanedTitle} ${mainArtist}`;
                            if (albumName) searchQuery += ` ${albumName}`;
                            const searchResults = await api.searchTracks(searchQuery);

                            if (searchResults.items && searchResults.items.length > 0) {
                                for (const result of searchResults.items) {
                                    if (isValidMatch(result, cleanedTitle, mainArtist, albumName)) {
                                        foundTrack = result;
                                        console.log(`Found (Retry 3 - Cleaned Title): ${trackTitle}`);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // 5. Retry: Title + Main Artist (Ignore Album in Query and Match)
                    if (!foundTrack) {
                        const mainArtist = (artistNames || '').split(',')[0].trim();
                        // Search WITHOUT album name to find tracks where album metadata differs
                        const searchQuery = `${trackTitle} ${mainArtist}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            for (const result of searchResults.items) {
                                // Pass null for album to ignore it in validation
                                if (isValidMatch(result, trackTitle, mainArtist, null)) {
                                    foundTrack = result;
                                    console.log(`Found (Retry 4 - Ignore Album): ${trackTitle}`);
                                    break;
                                }
                            }
                        }
                    }

                    // 6. Retry: Cleaned Title + Main Artist (Ignore Album in Query and Match)
                    if (!foundTrack && isTitleCleaned) {
                        const mainArtist = (artistNames || '').split(',')[0].trim();
                        const searchQuery = `${cleanedTitle} ${mainArtist}`;
                        const searchResults = await api.searchTracks(searchQuery);

                        if (searchResults.items && searchResults.items.length > 0) {
                            for (const result of searchResults.items) {
                                if (isValidMatch(result, cleanedTitle, mainArtist, null)) {
                                    foundTrack = result;
                                    console.log(`Found (Retry 5 - Cleaned Title + Ignore Album): ${trackTitle}`);
                                    break;
                                }
                            }
                        }
                    }

                    if (foundTrack) {
                        tracks.push(foundTrack);
                        console.log(`✓ "${trackTitle}" by ${artistNames}${albumName ? ' [' + albumName + ']' : ''}`);
                    } else {
                        console.warn(
                            `✗ Track not found: "${trackTitle}" by ${artistNames}${albumName ? ' [' + albumName + ']' : ''}`
                        );
                        missingTracks.push(
                            `${trackTitle} - ${artistNames}${albumName ? ' (album: ' + albumName + ')' : ''}`
                        );
                    }
                } catch (error) {
                    console.error(`Error searching for track "${trackTitle}":`, error);
                    missingTracks.push(
                        `${trackTitle} - ${artistNames}${albumName ? ' (album: ' + albumName + ')' : ''}`
                    );
                }
            }
        }
    }

    // yayyy its finished :P
    if (onProgress) {
        onProgress({
            current: totalTracks,
            total: totalTracks,
            currentTrack: 'Import complete',
        });
    }

    return { tracks, missingTracks };
}

function showDiscographyDownloadModal(artist, api, quality, lyricsManager, triggerBtn) {
    const modal = document.getElementById('discography-download-modal');

    document.getElementById('discography-artist-name').textContent = artist.name;
    document.getElementById('albums-count').textContent = artist.albums?.length || 0;
    document.getElementById('eps-count').textContent = (artist.eps || []).filter((a) => a.type === 'EP').length;
    document.getElementById('singles-count').textContent = (artist.eps || []).filter((a) => a.type === 'SINGLE').length;

    // Reset checkboxes
    document.getElementById('download-albums').checked = true;
    document.getElementById('download-eps').checked = true;
    document.getElementById('download-singles').checked = true;

    const closeModal = () => {
        modal.classList.remove('active');
    };

    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.classList.contains('modal-overlay') ||
            e.target.closest('.close-modal-btn') ||
            e.target.id === 'cancel-discography-download'
        ) {
            closeModal();
        }
    };

    modal.addEventListener('click', handleClose);

    document.getElementById('start-discography-download').onclick = async () => {
        const includeAlbums = document.getElementById('download-albums').checked;
        const includeEPs = document.getElementById('download-eps').checked;
        const includeSingles = document.getElementById('download-singles').checked;

        if (!includeAlbums && !includeEPs && !includeSingles) {
            alert('Please select at least one type of release to download.');
            return;
        }

        closeModal();

        // Filter releases based on selection
        let selectedReleases = [];
        if (includeAlbums) {
            selectedReleases = selectedReleases.concat(artist.albums || []);
        }
        if (includeEPs) {
            selectedReleases = selectedReleases.concat((artist.eps || []).filter((a) => a.type === 'EP'));
        }
        if (includeSingles) {
            selectedReleases = selectedReleases.concat((artist.eps || []).filter((a) => a.type === 'SINGLE'));
        }

        triggerBtn.disabled = true;
        const originalHTML = triggerBtn.innerHTML;
        triggerBtn.innerHTML =
            '<svg class="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg><span>Downloading...</span>';

        try {
            const { downloadDiscography } = await loadDownloadsModule();
            await downloadDiscography(artist, selectedReleases, api, quality, lyricsManager);
        } catch (error) {
            console.error('Discography download failed:', error);
            alert('Failed to download discography: ' + error.message);
        } finally {
            triggerBtn.disabled = false;
            triggerBtn.innerHTML = originalHTML;
        }
    };

    modal.classList.add('active');
}

function showKeyboardShortcuts() {
    const modal = document.getElementById('shortcuts-modal');

    const closeModal = () => {
        modal.classList.remove('active');

        modal.removeEventListener('click', handleClose);
    };

    const handleClose = (e) => {
        if (
            e.target === modal ||
            e.target.classList.contains('close-shortcuts') ||
            e.target.classList.contains('modal-overlay')
        ) {
            closeModal();
        }
    };

    modal.addEventListener('click', handleClose);
    modal.classList.add('active');
}