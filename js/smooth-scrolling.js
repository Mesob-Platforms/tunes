//js/smooth-scrolling.js
import { smoothScrollingSettings } from './storage.js';
import Lenis from 'lenis';

let lenis = null;

async function initializeSmoothScrolling() {
    if (lenis) return; // Already initialized

    lenis = new Lenis({
        wrapper: document.querySelector('.main-content'),
        content: document.querySelector('.main-content'),
        lerp: 0.1,
        smoothWheel: true,
        smoothTouch: false,
        normalizeWheel: true,
        wheelMultiplier: 0.8,
    });

    function raf(time) {
        if (lenis) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
    }

    requestAnimationFrame(raf);
}

function destroySmoothScrolling() {
    if (lenis) {
        lenis.destroy();
        lenis = null;
    }
}

async function setupSmoothScrolling() {
    // Check if smooth scrolling is enabled
    const smoothScrollingEnabled = smoothScrollingSettings.isEnabled();

    if (smoothScrollingEnabled) {
        await initializeSmoothScrolling();
    }

    // Listen for toggle changes
    window.addEventListener('smooth-scrolling-toggle', async function (e) {
        if (e.detail.enabled) {
            await initializeSmoothScrolling();
        } else {
            destroySmoothScrolling();
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupSmoothScrolling);
} else {
    setupSmoothScrolling();
}
