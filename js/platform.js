// js/platform.js — Platform detection & API URL routing

const WORKER_ORIGIN = 'https://tunes-music-app.naolmideksa.workers.dev';

const hasNativeQuery =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('native') === '1';

export const isNative =
    hasNativeQuery ||
    (typeof window !== 'undefined' && window.__TUNES_NATIVE__ === true);

export function apiUrl(path) {
    return path.startsWith('/api/') ? `${WORKER_ORIGIN}${path}` : path;
}
