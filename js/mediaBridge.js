// js/mediaBridge.js — Bridges JS player state ↔ native Android foreground service
import { isNative } from './platform.js';
import { registerPlugin } from '@capacitor/core';
import { getTrackTitle, getTrackArtists } from './utils.js';
import { db } from './db.js';

/**
 * Native Capacitor plugin – only loaded on native (Android).
 * On web, all calls are no-ops.
 */
const MediaBridgePlugin = isNative
    ? registerPlugin('MediaBridge')
    : null;

let _player = null;
let _audioElement = null;
let _api = null;
let _lastSentTrackId = null;
let _positionInterval = null;
let _preDuckVolume = null;

/**
 * Initialize the media bridge. Call once after the Player is ready.
 * @param {Player} player - the main Player instance
 * @param {HTMLAudioElement} audioElement - the <audio> element
 * @param {object} api - the API instance (for getCoverUrl)
 */
export function initMediaBridge(player, audioElement, api) {
    if (!isNative || !MediaBridgePlugin) return;

    _player = player;
    _audioElement = audioElement;
    _api = api;

    // Listen for native actions (play/pause/next/prev/like from notification)
    MediaBridgePlugin.addListener('mediaAction', async (data) => {
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
                    // Re-push updated like state to notification
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
                // Native AlarmManager fired — pause playback and clear JS-side timer
                console.log('[MediaBridge] Native sleep timer fired');
                _audioElement.pause();
                if (_player) {
                    _player.clearSleepTimer(); // Clean up JS timer state + UI
                }
                break;
            case 'duck':
                // Lower volume temporarily (e.g. navigation voice, notification)
                if (_preDuckVolume === null) {
                    _preDuckVolume = _audioElement.volume;
                }
                _audioElement.volume = Math.max(0, _preDuckVolume * 0.2);
                break;
            case 'unduck':
                // Restore volume after ducking
                if (_preDuckVolume !== null) {
                    _audioElement.volume = _preDuckVolume;
                    _preDuckVolume = null;
                }
                break;
        }
    });

    // Wire into audio events to keep notification in sync
    _audioElement.addEventListener('play', () => pushNowPlaying());
    _audioElement.addEventListener('pause', () => pushNowPlaying());
    _audioElement.addEventListener('playing', () => pushNowPlaying());

    // Periodically update position (every 5s while playing)
    _positionInterval = setInterval(() => {
        if (_audioElement && !_audioElement.paused && _player?.currentTrack) {
            pushNowPlaying();
        }
    }, 5000);

    console.log('[MediaBridge] initialized');
}

/**
 * Push the current now-playing state to the native service.
 * Called automatically on play/pause/track change, and can be called
 * manually after a like toggle or seek.
 */
export async function pushNowPlaying() {
    if (!isNative || !MediaBridgePlugin || !_player?.currentTrack) return;

    const track = _player.currentTrack;
    const trackTitle = getTrackTitle(track);
    const artistName = getTrackArtists(track) || 'Unknown Artist';
    const albumTitle = track.album?.title || '';

    // Build album art URL (320px)
    let albumArt = '';
    if (track.album?.cover && _api) {
        albumArt = _api.getCoverUrl(track.album.cover, '320');
    }

    // Check if track is liked
    let isLiked = false;
    try {
        isLiked = await db.isFavorite('track', track.id);
    } catch (_) { /* ignore */ }

    const duration = _audioElement?.duration || track.duration || 0;
    const position = _audioElement?.currentTime || 0;

    try {
        await MediaBridgePlugin.updateNowPlaying({
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

/**
 * Call when a new track starts or metadata changes.
 * This is the main entry point from player.js updateMediaSession().
 */
export function onTrackChanged() {
    pushNowPlaying();
}

/**
 * Stop the foreground service entirely.
 */
export async function stopService() {
    if (!isNative || !MediaBridgePlugin) return;
    try {
        await MediaBridgePlugin.stopService();
    } catch (e) {
        console.warn('[MediaBridge] stopService failed:', e);
    }
    _lastSentTrackId = null;
}

/**
 * Set the native AlarmManager-based sleep timer as a reliable backup.
 * @param {number} minutes - how many minutes from now
 */
export async function setSleepTimerNative(minutes) {
    if (!isNative || !MediaBridgePlugin) return;
    try {
        await MediaBridgePlugin.setSleepTimer({ minutes });
        console.log(`[MediaBridge] Native sleep timer set for ${minutes} min`);
    } catch (e) {
        console.warn('[MediaBridge] setSleepTimer failed:', e);
    }
}

/**
 * Cancel the native AlarmManager sleep timer.
 */
export async function clearSleepTimerNative() {
    if (!isNative || !MediaBridgePlugin) return;
    try {
        await MediaBridgePlugin.clearSleepTimer();
        console.log('[MediaBridge] Native sleep timer cancelled');
    } catch (e) {
        console.warn('[MediaBridge] clearSleepTimer failed:', e);
    }
}

/**
 * Cleanup — call if the player is destroyed.
 */
export function destroyMediaBridge() {
    if (_positionInterval) {
        clearInterval(_positionInterval);
        _positionInterval = null;
    }
    stopService();
}

