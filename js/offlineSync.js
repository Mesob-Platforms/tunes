/**
 * js/offlineSync.js — Offline Event Queue & Sync Manager
 * 
 * Queues user stats/events when offline, syncs to server when online.
 * Handles: listening events, track events (impressions/clicks), scrobbles
 */

import { db } from './db.js';
import { supabase } from './accounts/config.js';
import { authManager } from './accounts/auth.js';

class OfflineSyncManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.isSyncing = false;
        this.syncInterval = null;
        this._setupNetworkListeners();
    }

    _setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.syncPendingEvents();
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    }

    /**
     * Check if we're online (with fallback check)
     */
    async checkOnline() {
        if (!navigator.onLine) return false;
        // Try a lightweight fetch to confirm (gracefully handle 404)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch('/', { method: 'HEAD', cache: 'no-store', signal: controller.signal });
            clearTimeout(timeoutId);
            return res.status < 500; // Any non-server-error means we're online
        } catch {
            // Network error — assume offline
            return false;
        }
    }

    /**
     * Queue a listening event for offline sync
     */
    async queueListeningEvent(track) {
        const user = authManager?.user;
        if (!user) return;

        const artistName = Array.isArray(track.artists)
            ? track.artists[0]?.name || 'Unknown'
            : track.artist?.name || 'Unknown';

        const eventData = {
            user_id: user.uid,
            track_id: String(track.id),
            track_title: track.title || '',
            artist_name: artistName,
            album_title: track.album?.title || '',
            album_id: track.album?.id ? String(track.album.id) : null,
            genre: track.genre || null,
            duration_sec: track.duration || null,
            listened_at: new Date().toISOString(), // Preserve timestamp
        };

        await db.queueOfflineEvent('listening_event', eventData);
    }

    /**
     * Queue a track event (impression/click) for offline sync
     */
    async queueTrackEvent(itemType, itemId, eventType) {
        const user = authManager?.user;
        if (!user) return;

        const eventData = {
            item_type: itemType,
            item_id: Number(itemId),
            user_id: user.uid,
            event_type: eventType,
        };

        await db.queueOfflineEvent('track_event', eventData);
    }

    /**
     * Sync all pending events to server
     */
    async syncPendingEvents() {
        if (this.isSyncing) return;
        if (!await this.checkOnline()) return;

        this.isSyncing = true;
        const events = await db.getUnsyncedEvents();
        if (events.length === 0) {
            this.isSyncing = false;
            return;
        }

        let synced = 0;
        let failed = 0;

        for (const event of events) {
            try {
                if (event.eventType === 'listening_event') {
                    await this._syncListeningEvent(event.eventData);
                } else if (event.eventType === 'track_event') {
                    await this._syncTrackEvent(event.eventData);
                }
                await db.markEventSynced(event.id);
                synced++;
            } catch (error) {
                console.warn(`[OfflineSync] Failed to sync event ${event.id}:`, error);
                failed++;
                // Don't delete failed events — retry later
            }
        }

        if (synced > 0) {
            console.log(`[OfflineSync] Synced ${synced} events`);
            this._showSyncNotification(synced);
        }
        if (failed > 0) {
            console.warn(`[OfflineSync] ${failed} events failed to sync`);
        }

        this.isSyncing = false;
    }

    /**
     * Sync a listening event to Supabase
     */
    async _syncListeningEvent(eventData) {
        if (!supabase) throw new Error('Supabase not initialized');
        
        const { error } = await supabase.from('listening_events').insert({
            user_id: eventData.user_id,
            track_id: eventData.track_id,
            track_title: eventData.track_title,
            artist_name: eventData.artist_name,
            album_title: eventData.album_title,
            album_id: eventData.album_id,
            genre: eventData.genre,
            duration_sec: eventData.duration_sec,
            listened_at: eventData.listened_at || new Date().toISOString(),
        });

        if (error) throw error;
    }

    /**
     * Sync a track event to the API
     */
    async _syncTrackEvent(eventData) {
        const res = await fetch('/api/track-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(eventData),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }

    /**
     * Show sync notification
     */
    _showSyncNotification(count) {
        // Remove existing notification
        const existing = document.querySelector('.offline-sync-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'offline-sync-notification';
        notification.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
            <span>Synced ${count} offline event${count > 1 ? 's' : ''}</span>
        `;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slide-out 0.3s ease forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * Get sync status for UI
     */
    async getSyncStatus() {
        const count = await db.getUnsyncedEventCount();
        return {
            pending: count,
            isSyncing: this.isSyncing,
            isOnline: this.isOnline,
        };
    }

    /**
     * Start periodic sync (every 30 seconds when online)
     */
    startPeriodicSync() {
        if (this.syncInterval) return;
        this.syncInterval = setInterval(() => {
            if (this.isOnline && !this.isSyncing) {
                this.syncPendingEvents();
            }
        }, 30000); // Every 30 seconds
    }

    /**
     * Stop periodic sync
     */
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }
}

export const offlineSync = new OfflineSyncManager();

