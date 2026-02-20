// js/platform.js — Platform detection & API URL routing for Capacitor
import { Capacitor } from '@capacitor/core';

const WORKER_ORIGIN = 'https://tunes-music-app.naolmideksa.workers.dev';

export const isNative = Capacitor.isNativePlatform();

/**
 * Prefix a relative /api/... path with the worker origin when running
 * inside the native Android shell (Capacitor serves from https://localhost,
 * so relative API paths would 404 without this).
 */
export function apiUrl(path) {
    return isNative ? `${WORKER_ORIGIN}${path}` : path;
}



