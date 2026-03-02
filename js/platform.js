// js/platform.js — Platform detection & API URL routing for Capacitor
import { Capacitor } from '@capacitor/core';

const WORKER_ORIGIN = 'https://tunes-music-app.naolmideksa.workers.dev';

export const isNative = Capacitor.isNativePlatform();

/**
 * Always prefix /api/ paths with the Worker origin.
 * Static files live on Cloudflare Pages (unlimited); API on the Worker.
 */
export function apiUrl(path) {
    return path.startsWith('/api/') ? `${WORKER_ORIGIN}${path}` : path;
}




