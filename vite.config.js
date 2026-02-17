import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    // Visualizer + its sub-visualizers → separate chunk (large, rarely used)
                    if (id.includes('/visualizer') || id.includes('/visualizers/') || id.includes('/waveform.js') || id.includes('/equalizer.js')) {
                        return 'visualizer';
                    }
                    // Scrobbler modules → separate chunk
                    if (id.includes('/lastfm.js') || id.includes('/librefm.js') || id.includes('/listenbrainz.js') || id.includes('/maloja.js') || id.includes('/multi-scrobbler.js')) {
                        return 'scrobblers';
                    }
                    // Settings + tracker (deferred loaded via requestIdleCallback)
                    if (id.includes('/settings.js') || id.includes('/tracker.js')) {
                        return 'settings';
                    }
                    // Accounts/sync
                    if (id.includes('/accounts/')) {
                        return 'accounts';
                    }
                    // UI rendering layer
                    if (id.includes('/ui.js') || id.includes('/ui-interactions.js') || id.includes('/side-panel.js')) {
                        return 'ui';
                    }
                },
            },
        },
    },
    plugins: [
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
                cleanupOutdatedCaches: true,
                // Define runtime caching strategies
                runtimeCaching: [
                    // Google Fonts stylesheets (CSS) — stale-while-revalidate
                    {
                        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'google-fonts-stylesheets',
                        },
                    },
                    // Google Fonts webfont files (woff2 etc) — cache-first, long expiry
                    {
                        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-webfonts',
                            expiration: {
                                maxEntries: 30,
                                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // LRCLIB lyrics API — cache-first (lyrics don't change for a given track)
                    {
                        urlPattern: /^https:\/\/lrclib\.net\/api\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'lyrics-api',
                            expiration: {
                                maxEntries: 500,
                                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // CDN scripts (am-lyrics, kuroshiro, etc) — cache-first, long expiry
                    {
                        urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cdn-scripts',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    {
                        urlPattern: /^https:\/\/unpkg\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'cdn-unpkg',
                            expiration: {
                                maxEntries: 30,
                                maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // Genius API via CORS proxy — stale-while-revalidate
                    {
                        urlPattern: /^https:\/\/corsproxy\.io\/.*/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'genius-api',
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
                            },
                        },
                    },
                    {
                        urlPattern: ({ request }) => request.destination === 'image',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'images',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                            },
                        },
                    },
                    {
                        urlPattern: ({ request }) => request.destination === 'audio' || request.destination === 'video',
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'media',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 24 * 60 * 60, // 60 Days
                            },
                            rangeRequests: true, // Support scrubbing
                        },
                    },
                ],
            },
            includeAssets: ['instances.json', 'discord.html'],
            manifest: false, // Use existing public/manifest.json
        }),
    ],
});