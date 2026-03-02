import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: './',
    define: {
        // Inject build timestamp so the app can detect APK updates and clear stale caches
        '__BUILD_TIMESTAMP__': JSON.stringify(Date.now().toString()),
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        assetsInlineLimit: 102400,
        sourcemap: 'hidden',
        minify: false,
        rollupOptions: {
            output: {
                manualChunks: undefined,
            },
        },
    },
    plugins: [
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
