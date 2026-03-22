import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const buildTimestamp = Date.now().toString();

function versionJsonPlugin() {
    return {
        name: 'generate-version-json',
        closeBundle() {
            writeFileSync(
                resolve(__dirname, 'dist', 'version.json'),
                JSON.stringify({ buildTimestamp, updatedAt: new Date().toISOString() })
            );
        },
    };
}

export default defineConfig({
    base: './',
    define: {
        '__BUILD_TIMESTAMP__': JSON.stringify(buildTimestamp),
        '__APP_VERSION__': JSON.stringify('1.1.5'),
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        assetsInlineLimit: 102400,
        sourcemap: false,
        minify: 'esbuild',
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('dashjs')) return 'vendor-dashjs';
                    if (id.includes('@supabase')) return 'vendor-supabase';
                    if (id.includes('html2canvas')) return 'vendor-html2canvas';
                    if (id.includes('gsap')) return 'vendor-gsap';
                    if (id.includes('lenis')) return 'vendor-lenis';
                },
            },
        },
    },
    plugins: [
        versionJsonPlugin(),
        {
            name: 'strip-local-crossorigin',
            enforce: 'post',
            transformIndexHtml(html) {
                return html
                    .replace(/<script([^>]*) crossorigin([^>]*) src="\.\/assets\//g, '<script$1$2 src="./assets/')
                    .replace(/<link([^>]*) crossorigin([^>]*) href="\.\/assets\//g, '<link$1$2 href="./assets/')
                    .replace(/<script([^>]*) src="\.\/assets\/([^"]*)"([^>]*) crossorigin/g, '<script$1 src="./assets/$2"$3');
            },
        },
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2,woff,map}'],
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
                cleanupOutdatedCaches: true,
                skipWaiting: true,
                clientsClaim: true,
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/\/api\//, /\.(js|css|ico|png|svg|woff2?|json|map)$/i],
                // Define runtime caching strategies
                runtimeCaching: [
                    {
                        urlPattern: /^https:\/\/resources\.tidal\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'tidal-images',
                            expiration: { maxEntries: 50000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/(arran\.monochrome\.tf|api\.monochrome\.tf|tidal-api\.binimum\.org|monochrome-api\.samidy\.com|triton\.squid\.wtf|wolf\.qqdl\.site|hifi-(one|two)\.spotisaver\.net|maus\.qqdl\.site|vogel\.qqdl\.site|hund\.qqdl\.site|tidal\.kinoplus\.online)\/(search|album|artist|track|playlist)\/.*/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'api-metadata',
                            expiration: { maxEntries: 50000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/tunes-music-app\.naolmideksa\.workers\.dev\/api\/.*/i,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'worker-api',
                            expiration: { maxEntries: 5000 },
                            networkTimeoutSeconds: 8,
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/lrclib\.net\/api\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'lyrics-api',
                            expiration: { maxEntries: 50000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /\/api\/lyrics\/word-synced/,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'word-synced-lyrics',
                            expiration: { maxEntries: 50000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/(lyricsplus\.(atomix\.one|binimum\.org|prjktla\.workers\.dev)|lyrics-plus-backend\.vercel\.app|lyricsplus-seven\.vercel\.app|.*\.qqdl\.site|.*\.monochrome\.tf|.*\.spotisaver\.net|tidal\.kinoplus\.online|triton\.squid\.wtf)\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'am-lyrics-api',
                            expiration: { maxEntries: 50000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/translate\.googleapis\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'translate-api',
                            expiration: { maxEntries: 50000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cdn-scripts',
                            expiration: { maxEntries: 10000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/unpkg\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cdn-unpkg',
                            expiration: { maxEntries: 10000 },
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                    {
                        urlPattern: ({ request }) => request.destination === 'image',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'images',
                            expiration: { maxEntries: 50000 },
                        },
                    },
                    {
                        urlPattern: ({ request }) => request.destination === 'audio' || request.destination === 'video',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'media',
                            expiration: { maxEntries: 50000 },
                            rangeRequests: true,
                        },
                    },
                    {
                        urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'supabase-api',
                            expiration: { maxEntries: 5000 },
                            networkTimeoutSeconds: 10,
                            cacheableResponse: { statuses: [0, 200] },
                        },
                    },
                ],
            },
            includeAssets: ['instances.json', 'offline.html'],
            manifest: false, // Use existing public/manifest.json
        }),
    ],
});
