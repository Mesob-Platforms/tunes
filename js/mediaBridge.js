// js/mediaBridge.js — Bridges JS player state <-> native Android foreground service
import { isNative } from './platform.js';
import { getTrackTitle, getTrackArtists } from './utils.js';
import { db } from './db.js';

let _player = null;
let _audioElement = null;
let _api = null;
let _lastSentTrackId = null;
let _positionInterval = null;
let _preDuckVolume = null;

export function initMediaBridge(player, audioElement, api) {
    if (!isNative || !window.NativeBridge) return;

    _player = player;
    _audioElement = audioElement;
    _api = api;

    window.NativeBridge.on('mediaAction', async (data) => {
        if (!_player || !data?.action) return;

        switch (data.action) {
            case 'play':
                try { await _audioElement.play(); } catch (e) { console.warn('[MediaBridge] play failed:', e); }
                break;
            case 'pause':
                _audioElement.pause();
                break;
            case 'next':
                _player.playNext();
                break;
            case 'prev':
                _player.playPrev();
                break;
            case 'like':
                if (_player.currentTrack) {
                    await db.toggleFavorite('track', _player.currentTrack);
                    pushNowPlaying();
                }
                break;
            case 'seekTo':
                if (data.position !== undefined && !isNaN(data.position)) {
                    _audioElement.currentTime = data.position;
                }
                break;
            case 'stop':
                _audioElement.pause();
                stopService();
                break;
            case 'sleepTimerFired':
                console.log('[MediaBridge] Native sleep timer fired');
                _audioElement.pause();
                if (_player) _player.clearSleepTimer();
                break;
            case 'duck':
                if (_preDuckVolume === null) _preDuckVolume = _audioElement.volume;
                _audioElement.volume = Math.max(0, _preDuckVolume * 0.2);
                break;
            case 'unduck':
                if (_preDuckVolume !== null) {
                    _audioElement.volume = _preDuckVolume;
                    _preDuckVolume = null;
                }
                break;
        }
    });

    _audioElement.addEventListener('play', () => pushNowPlaying());
    _audioElement.addEventListener('pause', () => pushNowPlaying());
    _audioElement.addEventListener('playing', () => pushNowPlaying());

    _positionInterval = setInterval(() => {
        if (_audioElement && !_audioElement.paused && _player?.currentTrack) {
            pushNowPlaying();
        }
    }, 5000);

    console.log('[MediaBridge] initialized');
}

export async function pushNowPlaying() {
    if (!isNative || !window.NativeBridge || !_player?.currentTrack) return;

    const track = _player.currentTrack;
    const trackTitle = getTrackTitle(track);
    const artistName = getTrackArtists(track) || 'Unknown Artist';
    const albumTitle = track.album?.title || '';

    let albumArt = '';
    if (track.album?.cover && _api) {
        albumArt = _api.getCoverUrl(track.album.cover, '320');
    }

    let isLiked = false;
    try { isLiked = await db.isFavorite('track', track.id); } catch (_) {}

    const duration = _audioElement?.duration || track.duration || 0;
    const position = _audioElement?.currentTime || 0;

    try {
        await window.NativeBridge.call('updateNowPlaying', {
            title: trackTitle || 'Unknown Title',
            artist: artistName,
            album: albumTitle,
            albumArt: albumArt,
            isPlaying: !_audioElement.paused,
            duration: isFinite(duration) ? duration : 0,
            position: isFinite(position) ? position : 0,
            isLiked: isLiked,
        });
        _lastSentTrackId = track.id;
    } catch (e) {
        console.warn('[MediaBridge] updateNowPlaying failed:', e);
    }
}

export function onTrackChanged() {
    pushNowPlaying();
}

export async function stopService() {
    if (!isNative || !window.NativeBridge) return;
    try { await window.NativeBridge.call('stopService'); } catch (e) {
        console.warn('[MediaBridge] stopService failed:', e);
    }
    _lastSentTrackId = null;
}

export async function setSleepTimerNative(minutes) {
    if (!isNative || !window.NativeBridge) return;
    try {
        await window.NativeBridge.call('setSleepTimer', { minutes });
    } catch (e) {
        console.warn('[MediaBridge] setSleepTimer failed:', e);
    }
}

export async function clearSleepTimerNative() {
    if (!isNative || !window.NativeBridge) return;
    try { await window.NativeBridge.call('clearSleepTimer'); } catch (e) {
        console.warn('[MediaBridge] clearSleepTimer failed:', e);
    }
}

export function destroyMediaBridge() {
    if (_positionInterval) {
        clearInterval(_positionInterval);
        _positionInterval = null;
    }
    stopService();
}
