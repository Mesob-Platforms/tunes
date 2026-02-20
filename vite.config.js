import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('/visualizer') || id.includes('/visualizers/') || id.includes('/waveform.js') || id.includes('/equalizer.js')) {
                        return 'visualizer';
                    }
                    if (id.includes('/lastfm.js') || id.includes('/librefm.js') || id.includes('/listenbrainz.js') || id.includes('/maloja.js') || id.includes('/multi-scrobbler.js')) {
                        return 'scrobblers';
                    }
                    if (id.includes('/settings.js') || id.includes('/tracker.js')) {
                        return 'settings';
                    }
                    if (id.includes('/accounts/')) {
                        return 'accounts';
                    }
                    if (id.includes('/ui.js') || id.includes('/ui-interactions.js') || id.includes('/side-panel.js')) {
                        return 'ui';
                    }
                },
            },
        },
    },
    plugins: [],
});
