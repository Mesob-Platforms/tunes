//js/downloads.js
import {
    buildTrackFilename,
    sanitizeForFilename,
    RATE_LIMIT_ERROR_MESSAGE,
    getTrackArtists,
    getTrackTitle,
    formatTemplate,
    SVG_CLOSE,
    getCoverBlob,
    getExtensionFromBlob,
} from './utils.js';
import { lyricsSettings, bulkDownloadSettings, playlistSettings } from './storage.js';
import { addMetadataToAudio } from './metadata.js';
import { DashDownloader } from './dash-downloader.js';
import { apiUrl } from './platform.js';
import { generateM3U, generateM3U8, generateCUE, generateNFO, generateJSON } from './playlist-generator.js';
import { db } from './db.js'; // For IndexedDB audio caching
import { getVibrantColorFromImage } from './vibrant-color.js';

const downloadTasks = new Map();
const bulkDownloadTasks = new Map();
const ongoingDownloads = new Set();
let downloadNotificationContainer = null;

/* ── Downloaded-catalog helpers (localStorage) ────────────────────────── */
const CATALOG_KEY = 'tunes-downloaded-catalog';

function _getCatalog() {
    try { return JSON.parse(localStorage.getItem(CATALOG_KEY) || '[]'); } catch { return []; }
}
function _saveCatalog(catalog) {
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)); } catch { /* quota */ }
}

/**
 * Record a successfully-downloaded track in the local catalog so the
 * "Downloaded" library section can display it.
 */
export function catalogDownloadedTrack(track) {
    if (!track || !track.id) return;
    const catalog = _getCatalog();
    // avoid duplicates
    if (catalog.some(t => String(t.id) === String(track.id))) return;
    catalog.push({
        id:        track.id,
        title:     track.title || '',
        artist:    track.artist?.name || (track.artists?.[0]?.name) || '',
        artistId:  track.artist?.id || (track.artists?.[0]?.id) || null,
        artistPicture: track.artist?.picture || (track.artists?.[0]?.picture) || null,
        album:     track.album?.title || '',
        albumId:   track.album?.id || null,
        cover:     track.album?.cover || null,
        duration:  track.duration || 0,
        trackNumber: track.trackNumber || null,
        discNumber: track.discNumber || null,
        artistPicture: track.artist?.picture || (track.artists?.[0]?.picture) || null,
        downloadedAt: Date.now(),
    });
    _saveCatalog(catalog);
}

/** Return the full catalog array. */
export function getDownloadedCatalog() { return _getCatalog(); }

/** Remove a single track from the catalog by trackId. */
export function removeFromDownloadedCatalog(trackId) {
    const catalog = _getCatalog();
    _saveCatalog(catalog.filter(t => String(t.id) !== String(trackId)));
}

/**
 * Remove all tracks belonging to an album from the catalog.
 * Returns the removed entries so the caller can also purge IndexedDB blobs.
 */
export function removeAlbumFromDownloadedCatalog(albumId) {
    const catalog = _getCatalog();
    const removed = catalog.filter(t => String(t.albumId) === String(albumId));
    _saveCatalog(catalog.filter(t => String(t.albumId) !== String(albumId)));
    return removed;
}

async function loadClientZip() {
    try {
        const module = await import('client-zip');
        return module;
    } catch (error) {
        console.error('Failed to load client-zip:', error);
        throw new Error('Failed to load ZIP library');
    }
}

function createDownloadNotification() {
    if (!downloadNotificationContainer) {
        downloadNotificationContainer = document.createElement('div');
        downloadNotificationContainer.id = 'download-notifications';

        // Small circle collapser toggle
        const toggle = document.createElement('button');
        toggle.className = 'download-notif-toggle';
        toggle.title = 'Collapse / Expand';
        toggle.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="14" y1="14" x2="4" y2="4"/><polyline points="4 10 4 4 10 4"/>
                <line x1="10" y1="10" x2="20" y2="20"/><polyline points="14 20 20 20 20 14"/>
            </svg>
            <span class="download-notif-badge">0</span>
        `;
        toggle.style.display = 'none'; // hidden until first task
        downloadNotificationContainer.appendChild(toggle);

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const activeTasks = downloadNotificationContainer.querySelectorAll('.download-task');
            const hasActive = Array.from(activeTasks).some(t => {
                const status = t.querySelector('.download-status');
                return status && !status.textContent.startsWith('✓') && !status.textContent.startsWith('✗');
            });
            if (!hasActive && activeTasks.length === 0) {
                downloadNotificationContainer.remove();
                downloadNotificationContainer = null;
                return;
            }
            if (!hasActive && downloadNotificationContainer.classList.contains('collapsed')) {
                downloadNotificationContainer.remove();
                downloadNotificationContainer = null;
                return;
            }
            downloadNotificationContainer.classList.toggle('collapsed');
        });

        document.body.appendChild(downloadNotificationContainer);
    }
    return downloadNotificationContainer;
}

/** Update the toggle badge count and visibility */
function _updateNotifHeader() {
    if (!downloadNotificationContainer) return;
    const toggle = downloadNotificationContainer.querySelector('.download-notif-toggle');
    if (!toggle) return;
    const tasks = downloadNotificationContainer.querySelectorAll('.download-task');
    const badge = toggle.querySelector('.download-notif-badge');
    if (tasks.length > 0) {
        toggle.style.display = '';
        if (badge) { badge.textContent = tasks.length; badge.style.display = ''; }
    } else {
        toggle.style.display = 'none';
        downloadNotificationContainer.classList.remove('collapsed');
        if (badge) badge.style.display = 'none';
        // Reset glow to default purple when no tasks remain
        toggle.style.removeProperty('--dl-glow-rgb');
    }
}

/**
 * Extract vibrant color from a cover image URL and apply it
 * to the collapser circle glow.
 */
function _updateGlowColor(coverUrl) {
    if (!coverUrl || !downloadNotificationContainer) return;
    const toggle = downloadNotificationContainer.querySelector('.download-notif-toggle');
    if (!toggle) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            const hex = getVibrantColorFromImage(img);
            if (hex) {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                toggle.style.setProperty('--dl-glow-rgb', `${r}, ${g}, ${b}`);
            }
        } catch { /* ignore extraction errors */ }
    };
    img.src = coverUrl;
}

export function showNotification(message) {
    return;
}

export function addDownloadTask(trackId, track, filename, api, abortController) {
    const container = createDownloadNotification();

    const taskEl = document.createElement('div');
    taskEl.className = 'download-task';
    taskEl.dataset.trackId = trackId;
    const trackTitle = getTrackTitle(track);
    const trackArtists = getTrackArtists(track);
    taskEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.75rem;">
            <img src="${api.getCoverUrl(track.album?.cover)}"
                 style="width: 40px; height: 40px; border-radius: 4px; flex-shrink: 0;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; font-size: 0.9rem; margin-bottom: 0.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${trackTitle}</div>
                <div style="font-size: 0.8rem; color: var(--muted-foreground); margin-bottom: 0.5rem;">${trackArtists}</div>
                <div class="download-progress-bar" style="height: 4px; background: var(--secondary); border-radius: 2px; overflow: hidden;">
                    <div class="download-progress-fill" style="width: 0%; height: 100%; background: var(--highlight); transition: width 0.2s;"></div>
                </div>
                <div class="download-status" style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Starting...</div>
            </div>
            <button class="download-cancel" style="background: transparent; border: none; color: var(--muted-foreground); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
                ${SVG_CLOSE}
            </button>
        </div>
    `;

    container.appendChild(taskEl);
    _updateNotifHeader();

    // Update collapser glow to match the album cover color
    const coverUrl = api.getCoverUrl(track.album?.cover);
    if (coverUrl) _updateGlowColor(coverUrl);

    downloadTasks.set(trackId, { taskEl, abortController });

    taskEl.querySelector('.download-cancel').addEventListener('click', () => {
        abortController.abort();
        removeDownloadTask(trackId);
    });

    return { taskEl, abortController };
}

export function updateDownloadProgress(trackId, progress) {
    const task = downloadTasks.get(trackId);
    if (!task) return;

    const { taskEl } = task;
    const progressFill = taskEl.querySelector('.download-progress-fill');
    const statusEl = taskEl.querySelector('.download-status');

    if (progress.stage === 'downloading') {
        const percent = progress.totalBytes ? Math.round((progress.receivedBytes / progress.totalBytes) * 100) : 0;

        progressFill.style.width = `${percent}%`;

        const receivedMB = (progress.receivedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = progress.totalBytes ? (progress.totalBytes / (1024 * 1024)).toFixed(1) : '?';

        statusEl.textContent = `Downloading: ${receivedMB}MB / ${totalMB}MB (${percent}%)`;
    }
}

export function completeDownloadTask(trackId, success = true, message = null) {
    const task = downloadTasks.get(trackId);
    if (!task) return;

    const { taskEl } = task;
    const progressFill = taskEl.querySelector('.download-progress-fill');
    const statusEl = taskEl.querySelector('.download-status');
    const cancelBtn = taskEl.querySelector('.download-cancel');

    if (success) {
        progressFill.style.width = '100%';
        progressFill.style.background = '#10b981';
        statusEl.textContent = '✓ Downloaded';
        statusEl.style.color = '#10b981';
        cancelBtn.remove();

        setTimeout(() => removeDownloadTask(trackId), 3000);
    } else {
        progressFill.style.background = '#ef4444';
        statusEl.textContent = message || '✗ Download failed';
        statusEl.style.color = '#ef4444';
        cancelBtn.innerHTML = `
            ${SVG_CLOSE}
        `;
        cancelBtn.onclick = () => removeDownloadTask(trackId);

        setTimeout(() => removeDownloadTask(trackId), 5000);
    }
}

function removeDownloadTask(trackId) {
    const task = downloadTasks.get(trackId);
    if (!task) return;

    const { taskEl } = task;
    taskEl.style.animation = 'slide-out 0.3s ease forwards';

    setTimeout(() => {
        taskEl.remove();
        downloadTasks.delete(trackId);
        _updateNotifHeader();

        if (downloadNotificationContainer && downloadNotificationContainer.querySelectorAll('.download-task').length === 0) {
            downloadNotificationContainer.remove();
            downloadNotificationContainer = null;
        }
    }, 300);
}

function removeBulkDownloadTask(notifEl) {
    bulkDownloadTasks.delete(notifEl);

    notifEl.style.animation = 'slide-out 0.3s ease forwards';

    setTimeout(() => {
        notifEl.remove();
        _updateNotifHeader();

        if (downloadNotificationContainer && downloadNotificationContainer.querySelectorAll('.download-task').length === 0) {
            downloadNotificationContainer.remove();
            downloadNotificationContainer = null;
        }
    }, 300);
}

async function downloadTrackBlob(track, quality, api, lyricsManager = null, signal = null) {
    let enrichedTrack = {
        ...track,
        artist: track.artist || (track.artists && track.artists.length > 0 ? track.artists[0] : null),
    };

    if (enrichedTrack.album && (!enrichedTrack.album.title || !enrichedTrack.album.artist) && enrichedTrack.album.id) {
        try {
            const albumData = await api.getAlbum(enrichedTrack.album.id);
            if (albumData.album) {
                enrichedTrack.album = {
                    ...enrichedTrack.album,
                    ...albumData.album,
                };
            }
        } catch (error) {
            console.warn('Failed to fetch album data for metadata:', error);
        }
    }

    const lookup = await api.getTrack(track.id, quality);
    let streamUrl;

    if (lookup.originalTrackUrl) {
        streamUrl = lookup.originalTrackUrl;
    } else {
        streamUrl = api.extractStreamUrlFromManifest(lookup.info.manifest);
        if (!streamUrl) {
            throw new Error('Could not resolve stream URL');
        }
    }

    // Handle DASH streams (blob URLs)
    let blob;
    if (streamUrl.startsWith('blob:')) {
        try {
            const downloader = new DashDownloader();
            blob = await downloader.downloadDashStream(streamUrl, { signal });
        } catch (dashError) {
            console.error('DASH download failed:', dashError);
            // Fallback
            if (quality !== 'LOSSLESS') {
                console.warn('Falling back to LOSSLESS (16-bit) download.');
                return downloadTrackBlob(track, 'LOSSLESS', api, lyricsManager, signal);
            }
            throw dashError;
        }
    } else {
        const response = await fetch(streamUrl, { signal });
        if (!response.ok) {
            throw new Error(`Failed to fetch track: ${response.status}`);
        }
        blob = await response.blob();
    }

    // Detect actual format from blob signature BEFORE adding metadata
    const extension = await getExtensionFromBlob(blob);

    // Add metadata to the blob
    blob = await addMetadataToAudio(blob, enrichedTrack, api, quality);

    return { blob, extension };
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    for (let i = 0; i < tracks.length; i++) {
        if (signal.aborted) break;
        const track = tracks[i];
        const trackTitle = getTrackTitle(track);

        updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

        try {
            const { blob } = await downloadTrackBlob(track, quality, api, null, signal);
            await db.cacheTrackBlob(track.id, blob);
            catalogDownloadedTrack(track);

            // Cache lyrics for offline access
            if (lyricsManager) {
                try {
                    const lyricsData = await lyricsManager.fetchLyrics(track.id, track, true);
                    if (!lyricsData) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await lyricsManager.fetchLyrics(track.id, track, true);
                    }
                } catch (e) {
                    console.warn(`Failed to cache lyrics for ${track.title}:`, e);
                    try {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        await lyricsManager.fetchLyrics(track.id, track, true);
                    } catch (e2) {
                        console.warn(`Final lyrics fetch failed for ${track.title}`);
                    }
                }
            }

            // Cache album cover + artist picture for offline display
            try {
                const coverId = track.album?.cover;
                const artistPicId = track.artist?.picture || track.artists?.[0]?.picture;
                const normalizedKey = (prefix, id) => (id ? `${prefix}-${String(id).replace(/\//g, '-')}` : null);
                const fetchAndCache = async (imageId, prefix, size = '320x320') => {
                    if (!imageId) return;
                    const key = normalizedKey(prefix, imageId);
                    const existing = await db.getCachedImage(key);
                    if (existing) return;
                    const formattedId = String(imageId).replace(/-/g, '/');
                    const tidalUrl = `https://resources.tidal.com/images/${formattedId}/${size}.jpg`;
                    const proxyUrl = apiUrl(`/api/image-proxy?url=${encodeURIComponent(tidalUrl)}`);
                    const resp = await fetch(proxyUrl);
                    if (resp.ok) {
                        const imgBlob = await resp.blob();
                        await db.cacheImage(key, imgBlob);
                    }
                };
                await Promise.allSettled([
                    fetchAndCache(coverId, 'cover', '1280x1280'),
                    fetchAndCache(artistPicId, 'artist', '320x320'),
                ]);
            } catch (imgErr) {
                console.warn('Image caching failed (non-blocking):', imgErr);
            }
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            console.error(`Failed to download track ${trackTitle}:`, err);
        }
    }
}

async function bulkDownloadToZipStream(
    tracks,
    folderName,
    api,
    quality,
    lyricsManager,
    notification,
    fileHandle,
    coverBlob = null,
    type = 'playlist',
    metadata = null
) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;
    const { downloadZip } = await loadClientZip();

    const writable = await fileHandle.createWritable();

    async function* yieldFiles() {
        // Add cover if available
        if (coverBlob) {
            yield { name: `${folderName}/cover.jpg`, lastModified: new Date(), input: coverBlob };
        }

        // Generate playlist files first
        const useRelativePaths = playlistSettings.shouldUseRelativePaths();

        if (playlistSettings.shouldGenerateM3U()) {
            const m3uContent = generateM3U(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u`,
                lastModified: new Date(),
                input: m3uContent,
            };
        }

        if (playlistSettings.shouldGenerateM3U8()) {
            const m3u8Content = generateM3U8(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u8`,
                lastModified: new Date(),
                input: m3u8Content,
            };
        }

        if (playlistSettings.shouldGenerateNFO()) {
            const nfoContent = generateNFO(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.nfo`,
                lastModified: new Date(),
                input: nfoContent,
            };
        }

        if (playlistSettings.shouldGenerateJSON()) {
            const jsonContent = generateJSON(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.json`,
                lastModified: new Date(),
                input: jsonContent,
            };
        }

        // For albums, generate CUE file
        if (type === 'album' && playlistSettings.shouldGenerateCUE()) {
            const audioFilename = `${sanitizeForFilename(folderName)}.flac`; // Assume FLAC for CUE
            const cueContent = generateCUE(metadata, tracks, audioFilename);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.cue`,
                lastModified: new Date(),
                input: cueContent,
            };
        }

        // Download tracks
        for (let i = 0; i < tracks.length; i++) {
            if (signal.aborted) break;
            const track = tracks[i];
            const trackTitle = getTrackTitle(track);

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const { blob, extension } = await downloadTrackBlob(track, quality, api, null, signal);
                const filename = buildTrackFilename(track, quality, extension);
                yield { name: `${folderName}/${filename}`, lastModified: new Date(), input: blob };
                catalogDownloadedTrack(track);

                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                    try {
                        const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                        if (lyricsData) {
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                yield {
                                    name: `${folderName}/${lrcFilename}`,
                                    lastModified: new Date(),
                                    input: lrcContent,
                                };
                            }
                        }
                    } catch {
                        /* ignore */
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') throw err;
                console.error(`Failed to download track ${trackTitle}:`, err);
            }
        }
    }

    try {
        const response = downloadZip(yieldFiles());
        await response.body.pipeTo(writable);
    } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
    }
}

// Generate ZIP as blob for browsers without File System Access API (iOS, etc.)
async function bulkDownloadToZipBlob(
    tracks,
    folderName,
    api,
    quality,
    lyricsManager,
    notification,
    coverBlob = null,
    type = 'playlist',
    metadata = null
) {
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;
    const { downloadZip } = await loadClientZip();

    async function* yieldFiles() {
        // Add cover if available
        if (coverBlob) {
            yield { name: `${folderName}/cover.jpg`, lastModified: new Date(), input: coverBlob };
        }

        // Generate playlist files first
        const useRelativePaths = playlistSettings.shouldUseRelativePaths();

        if (playlistSettings.shouldGenerateM3U()) {
            const m3uContent = generateM3U(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u`,
                lastModified: new Date(),
                input: m3uContent,
            };
        }

        if (playlistSettings.shouldGenerateM3U8()) {
            const m3u8Content = generateM3U8(metadata || { title: folderName }, tracks, useRelativePaths);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.m3u8`,
                lastModified: new Date(),
                input: m3u8Content,
            };
        }

        if (playlistSettings.shouldGenerateNFO()) {
            const nfoContent = generateNFO(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.nfo`,
                lastModified: new Date(),
                input: nfoContent,
            };
        }

        if (playlistSettings.shouldGenerateJSON()) {
            const jsonContent = generateJSON(metadata || { title: folderName }, tracks, type);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.json`,
                lastModified: new Date(),
                input: jsonContent,
            };
        }

        // For albums, generate CUE file
        if (type === 'album' && playlistSettings.shouldGenerateCUE()) {
            const audioFilename = `${sanitizeForFilename(folderName)}.flac`; // Assume FLAC for CUE
            const cueContent = generateCUE(metadata, tracks, audioFilename);
            yield {
                name: `${folderName}/${sanitizeForFilename(folderName)}.cue`,
                lastModified: new Date(),
                input: cueContent,
            };
        }

        // Download tracks
        for (let i = 0; i < tracks.length; i++) {
            if (signal.aborted) break;
            const track = tracks[i];
            const trackTitle = getTrackTitle(track);

            updateBulkDownloadProgress(notification, i, tracks.length, trackTitle);

            try {
                const { blob, extension } = await downloadTrackBlob(track, quality, api, null, signal);
                const filename = buildTrackFilename(track, quality, extension);
                yield { name: `${folderName}/${filename}`, lastModified: new Date(), input: blob };
                catalogDownloadedTrack(track);

                if (lyricsManager && lyricsSettings.shouldDownloadLyrics()) {
                    try {
                        const lyricsData = await lyricsManager.fetchLyrics(track.id, track);
                        if (lyricsData) {
                            const lrcContent = lyricsManager.generateLRCContent(lyricsData, track);
                            if (lrcContent) {
                                const lrcFilename = filename.replace(/\.[^.]+$/, '.lrc');
                                yield {
                                    name: `${folderName}/${lrcFilename}`,
                                    lastModified: new Date(),
                                    input: lrcContent,
                                };
                            }
                        }
                    } catch {
                        /* ignore */
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') throw err;
                console.error(`Failed to download track ${trackTitle}:`, err);
            }
        }
    }

    try {
        const response = downloadZip(yieldFiles());
        const blob = await response.blob();
        triggerDownload(blob, `${folderName}.zip`);
    } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
    }
}

async function startBulkDownload(
    tracks,
    defaultName,
    api,
    quality,
    lyricsManager,
    type,
    name,
    coverBlob = null,
    metadata = null
) {
    const notification = createBulkDownloadNotification(type, name, tracks.length);

    // Update collapser glow color from the first track's cover
    const firstCover = tracks.find(t => t.album?.cover)?.album?.cover;
    if (firstCover && api.getCoverUrl) _updateGlowColor(api.getCoverUrl(firstCover));

    try {
        // Always cache tracks in IndexedDB for in-app offline playback
        // (no external file downloads – all stays inside the app)
        await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification);
        completeBulkDownload(notification, true);
    } catch (error) {
        console.error('Bulk download failed:', error);
        completeBulkDownload(notification, false, error.message);
    }
}

export async function downloadTracks(tracks, api, quality, lyricsManager = null) {
    const folderName = `Queue - ${new Date().toISOString().slice(0, 10)}`;
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'queue', 'Queue', null, {
        title: 'Queue',
    });
}

export async function downloadAlbumAsZip(album, tracks, api, quality, lyricsManager = null) {
    const releaseDateStr =
        album.releaseDate || (tracks[0]?.streamStartDate ? tracks[0].streamStartDate.split('T')[0] : '');
    const releaseDate = releaseDateStr ? new Date(releaseDateStr) : null;
    const year = releaseDate && !isNaN(releaseDate.getTime()) ? releaseDate.getFullYear() : '';

    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: album.title,
        albumArtist: album.artist?.name,
        year: year,
    });

    const coverBlob = await getCoverBlob(api, album.cover || album.album?.cover || album.coverId);
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'album', album.title, coverBlob, album);
}

export async function downloadPlaylistAsZip(playlist, tracks, api, quality, lyricsManager = null) {
    const folderName = formatTemplate(localStorage.getItem('zip-folder-template') || '{albumTitle} - {albumArtist}', {
        albumTitle: playlist.title,
        albumArtist: 'Playlist',
        year: new Date().getFullYear(),
    });

    const representativeTrack = tracks.find((t) => t.album?.cover);
    const coverBlob = await getCoverBlob(api, representativeTrack?.album?.cover);
    await startBulkDownload(
        tracks,
        folderName,
        api,
        quality,
        lyricsManager,
        'playlist',
        playlist.title,
        coverBlob,
        playlist
    );
}

export async function downloadDiscography(artist, selectedReleases, api, quality, lyricsManager = null) {
    const rootFolder = `${sanitizeForFilename(artist.name)} discography`;
    const notification = createBulkDownloadNotification('discography', artist.name, selectedReleases.length);
    const { abortController } = bulkDownloadTasks.get(notification);
    const signal = abortController.signal;

    // Cache all tracks in IndexedDB for in-app offline playback
    try {
        for (let albumIndex = 0; albumIndex < selectedReleases.length; albumIndex++) {
            if (signal.aborted) break;
            const album = selectedReleases[albumIndex];
            updateBulkDownloadProgress(notification, albumIndex, selectedReleases.length, album.title);
            const { tracks } = await api.getAlbum(album.id);
            await bulkDownloadSequentially(tracks, api, quality, lyricsManager, notification);
        }
        completeBulkDownload(notification, true);
    } catch (error) {
        if (error.name === 'AbortError') {
            removeBulkDownloadTask(notification);
            return;
        }
        completeBulkDownload(notification, false, error.message);
    }
}

function createBulkDownloadNotification(type, name, _totalItems) {
    const container = createDownloadNotification();

    const notifEl = document.createElement('div');
    notifEl.className = 'download-task bulk-download';
    notifEl.dataset.bulkType = type;
    notifEl.dataset.bulkName = name;

    const typeLabel =
        type === 'album'
            ? 'Album'
            : type === 'playlist'
              ? 'Playlist'
              : type === 'liked'
                ? 'Liked Tracks'
                : type === 'queue'
                  ? 'Queue'
                  : 'Discography';

    notifEl.innerHTML = `
        <div style="display: flex; align-items: start; gap: 0.75rem;">
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.25rem;">
                    Downloading ${typeLabel}
                </div>
                <div style="font-size: 0.85rem; color: var(--muted-foreground); margin-bottom: 0.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
                <div class="download-progress-bar" style="height: 4px; background: var(--secondary); border-radius: 2px; overflow: hidden;">
                    <div class="download-progress-fill" style="width: 0%; height: 100%; background: var(--highlight); transition: width 0.2s;"></div>
                </div>
                <div class="download-status" style="font-size: 0.75rem; color: var(--muted-foreground); margin-top: 0.25rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Starting...</div>
            </div>
            <button class="download-cancel" style="background: transparent; border: none; color: var(--muted-foreground); cursor: pointer; padding: 4px; border-radius: 4px; transition: all 0.2s;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    `;

    container.appendChild(notifEl);
    _updateNotifHeader();

    const abortController = new AbortController();
    bulkDownloadTasks.set(notifEl, { abortController });

    notifEl.querySelector('.download-cancel').addEventListener('click', () => {
        abortController.abort();
        removeBulkDownloadTask(notifEl);
    });

    return notifEl;
}

function updateBulkDownloadProgress(notifEl, current, total, currentItem) {
    const progressFill = notifEl.querySelector('.download-progress-fill');
    const statusEl = notifEl.querySelector('.download-status');

    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = `${percent}%`;
    statusEl.textContent = `${current}/${total} - ${currentItem}`;
}

function completeBulkDownload(notifEl, success = true, message = null) {
    const progressFill = notifEl.querySelector('.download-progress-fill');
    const statusEl = notifEl.querySelector('.download-status');
    const cancelBtn = notifEl.querySelector('.download-cancel');

    if (cancelBtn) cancelBtn.remove();

    if (success) {
        progressFill.style.width = '100%';
        progressFill.style.background = '#10b981';
        statusEl.textContent = '✓ Download complete';
        statusEl.style.color = '#10b981';

        setTimeout(() => removeBulkDownloadTask(notifEl), 3000);
    } else {
        progressFill.style.background = '#ef4444';
        statusEl.textContent = message || '✗ Download failed';
        statusEl.style.color = '#ef4444';

        setTimeout(() => removeBulkDownloadTask(notifEl), 5000);
    }
}

export async function downloadTrackWithMetadata(track, quality, api, lyricsManager = null, abortController = null) {
    if (!track) {
        showNotification('No track is currently playing');
        return;
    }

    const downloadKey = `track-${track.id}`;
    if (ongoingDownloads.has(downloadKey)) {
        showNotification('This track is already being downloaded');
        return;
    }

    let enrichedTrack = {
        ...track,
        artist: track.artist || (track.artists && track.artists.length > 0 ? track.artists[0] : null),
    };

    if (enrichedTrack.album && (!enrichedTrack.album.title || !enrichedTrack.album.artist) && enrichedTrack.album.id) {
        try {
            const albumData = await api.getAlbum(enrichedTrack.album.id);
            if (albumData.album) {
                enrichedTrack.album = {
                    ...enrichedTrack.album,
                    ...albumData.album,
                };
            }
        } catch (error) {
            console.warn('Failed to fetch album data for metadata:', error);
        }
    }

    const filename = buildTrackFilename(enrichedTrack, quality);

    const controller = abortController || new AbortController();
    ongoingDownloads.add(downloadKey);

    try {
        addDownloadTask(track.id, enrichedTrack, filename, api, controller);

        // Download blob and cache it in IndexedDB (in-app, no file download)
        const { blob } = await downloadTrackBlob(enrichedTrack, quality, api, null, controller.signal);

        // Report progress complete
        updateDownloadProgress(track.id, { stage: 'downloading', receivedBytes: blob.size, totalBytes: blob.size });

        // Cache the audio blob in IndexedDB for offline playback
        await db.cacheTrackBlob(track.id, blob);

        completeDownloadTask(track.id, true);
        catalogDownloadedTrack(enrichedTrack);

        // Cache lyrics for offline access
        if (lyricsManager) {
            try {
                const lyricsData = await lyricsManager.fetchLyrics(track.id, enrichedTrack, true);
                if (!lyricsData) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    await lyricsManager.fetchLyrics(track.id, enrichedTrack, true);
                }
            } catch (e) {
                console.warn(`Failed to cache lyrics for ${enrichedTrack.title}:`, e);
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await lyricsManager.fetchLyrics(track.id, enrichedTrack, true);
                } catch (e2) {
                    console.warn(`Final lyrics fetch failed for ${enrichedTrack.title}`);
                }
            }
        }

        // Cache album cover + artist picture for offline display
        try {
            const coverId = enrichedTrack.album?.cover;
            const artistPicId = enrichedTrack.artist?.picture || enrichedTrack.artists?.[0]?.picture;
            const normalizedKey = (prefix, id) => (id ? `${prefix}-${String(id).replace(/\//g, '-')}` : null);
            const fetchAndCache = async (imageId, prefix, size = '320x320') => {
                if (!imageId) return;
                const key = normalizedKey(prefix, imageId);
                const existing = await db.getCachedImage(key);
                if (existing) return;
                const formattedId = String(imageId).replace(/-/g, '/');
                const tidalUrl = `https://resources.tidal.com/images/${formattedId}/${size}.jpg`;
                const proxyUrl = apiUrl(`/api/image-proxy?url=${encodeURIComponent(tidalUrl)}`);
                const resp = await fetch(proxyUrl);
                if (resp.ok) {
                    const imgBlob = await resp.blob();
                    await db.cacheImage(key, imgBlob);
                }
            };
            await Promise.allSettled([
                fetchAndCache(coverId, 'cover', '1280x1280'),
                fetchAndCache(artistPicId, 'artist', '320x320'),
            ]);
        } catch (imgErr) {
            console.warn('Image caching failed (non-blocking):', imgErr);
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            const errorMsg =
                error.message === RATE_LIMIT_ERROR_MESSAGE ? error.message : 'Download failed. Please try again.';
            completeDownloadTask(track.id, false, errorMsg);
        }
    } finally {
        ongoingDownloads.delete(downloadKey);
    }
}

export async function downloadLikedTracks(tracks, api, quality, lyricsManager = null) {
    const folderName = `Liked Tracks - ${new Date().toISOString().slice(0, 10)}`;
    await startBulkDownload(tracks, folderName, api, quality, lyricsManager, 'liked', 'Liked Tracks');
}
