// js/aiDj.js — AI DJ Manager
import { authManager } from './accounts/auth.js';

const DJ_STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    PLAYING: 'playing',
    ERROR: 'error',
};

const SUGGESTION_CHIPS = [
    { label: 'Workout', icon: '💪', prompt: 'Play high energy workout music' },
    { label: 'Chill', icon: '🌙', prompt: 'Play chill relaxing vibes' },
    { label: 'Party', icon: '🎉', prompt: 'Play party bangers' },
    { label: 'Focus', icon: '🧠', prompt: 'Play deep focus study music' },
    { label: 'Drive', icon: '🚗', prompt: 'Play driving music with great bass' },
    { label: 'Sad', icon: '🥀', prompt: 'Play melancholic emotional songs' },
    { label: 'Throwback', icon: '⏪', prompt: 'Play nostalgic throwback hits from the 2000s and 2010s' },
    { label: 'R&B', icon: '🎤', prompt: 'Play smooth R&B and soul music' },
    { label: 'Hype', icon: '🔥', prompt: 'Play hype rap and trap music' },
    { label: 'Lo-fi', icon: '🎧', prompt: 'Play lo-fi hip hop beats to relax to' },
    { label: 'Romantic', icon: '❤️', prompt: 'Play romantic love songs' },
    { label: 'Late Night', icon: '🌃', prompt: 'Play late night vibes, moody and atmospheric' },
];

export class AIDJManager {
    constructor() {
        this.state = DJ_STATES.IDLE;
        this.player = null;
        this.api = null;
        this.recognition = null;
        this.isVoiceSupported = false;
        this.isActive = false; // Whether AI DJ mode is currently controlling playback
        this.currentMood = null;
        this.sessionId = Date.now().toString(36);
        this.commentary = '';
        this.queueRefillThreshold = 3;
        this.lastPrompt = '';
        this.isRefilling = false;
        this._onStateChange = null; // callback: (state, data) => void
        this._personaRef = null; // reference to persona animation controller
        this._monitorInterval = null;
        this._commentaryTimeout = null;
    }

    init(player, api) {
        this.player = player;
        this.api = api;
        this._initVoiceRecognition();
    }

    /** Set callback for state changes */
    onStateChange(cb) {
        this._onStateChange = cb;
    }

    /** Set persona reference for audio-reactive effects */
    setPersona(persona) {
        this._personaRef = persona;
    }

    _setState(state, data = {}) {
        this.state = state;
        if (this._onStateChange) this._onStateChange(state, data);
        if (this._personaRef) this._personaRef.setState(state);
    }

    /* ══════════════════════════════════════════════
       VOICE RECOGNITION
       ══════════════════════════════════════════════ */

    _initVoiceRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.isVoiceSupported = false;
            return;
        }

        this.isVoiceSupported = true;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Show interim results for feedback
            if (interimTranscript) {
                this._setState(DJ_STATES.LISTENING, { transcript: interimTranscript });
            }

            if (finalTranscript) {
                this.processRequest(finalTranscript.trim());
            }
        };

        this.recognition.onerror = (event) => {
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            console.warn('Voice recognition error:', event.error);
            this._setState(DJ_STATES.IDLE, { error: 'Voice not available. Try typing instead.' });
        };

        this.recognition.onend = () => {
            if (this.state === DJ_STATES.LISTENING) {
                this._setState(DJ_STATES.IDLE);
            }
        };
    }

    startListening() {
        if (!this.recognition) return false;
        try {
            this.recognition.start();
            this._setState(DJ_STATES.LISTENING, { transcript: '' });
            return true;
        } catch (e) {
            console.warn('Could not start voice recognition:', e);
            return false;
        }
    }

    stopListening() {
        if (this.recognition) {
            try { this.recognition.stop(); } catch {}
        }
    }

    /* ══════════════════════════════════════════════
       REQUEST PROCESSING
       ══════════════════════════════════════════════ */

    async processRequest(text) {
        if (!text || !text.trim()) return;

        this.lastPrompt = text.trim();
        this._setState(DJ_STATES.PROCESSING, { prompt: this.lastPrompt });

        const session = authManager.getSession();
        if (!session?.access_token) {
            this._setState(DJ_STATES.ERROR, { error: 'Please sign in to use AI DJ' });
            return;
        }

        // Build context
        const now = new Date();
        const timeOfDay = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const currentTrack = this.player?.currentTrack
            ? `${this.player.currentTrack.title} by ${this.player.currentTrack.artist?.name || this.player.currentTrack.artists?.[0]?.name || 'Unknown'}`
            : null;

        try {
            const res = await fetch('/api/ai-dj/curate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    prompt: this.lastPrompt,
                    context: { timeOfDay, currentTrack },
                }),
            });

            const data = await res.json();

            if (data.error && !data.tracks?.length) {
                this._setState(DJ_STATES.ERROR, { error: data.error });
                return;
            }

            this.commentary = data.commentary || '';
            this.currentMood = data.mood || 'vibing';

            if (data.tracks && data.tracks.length > 0) {
                await this._queueAITracks(data.tracks);
                this.isActive = true;
                this._setState(DJ_STATES.PLAYING, {
                    commentary: this.commentary,
                    mood: this.currentMood,
                    trackCount: data.tracks.length,
                });
                this._startQueueMonitor();
            } else {
                this._setState(DJ_STATES.ERROR, { error: 'No tracks found for that request. Try something different!' });
            }
        } catch (err) {
            console.error('AI DJ curate error:', err);
            this._setState(DJ_STATES.ERROR, { error: 'Connection error. Please try again.' });
        }
    }

    /* ══════════════════════════════════════════════
       TRACK SEARCH + QUEUE
       ══════════════════════════════════════════════ */

    async _queueAITracks(aiTracks) {
        const shouldStartFresh = !this.player.currentTrack || !this.isActive;
        let startedPlaying = false;

        // Search all tracks in parallel (batches of 5 to avoid hammering)
        const BATCH_SIZE = 5;
        const resolvedTracks = [];

        for (let i = 0; i < aiTracks.length; i += BATCH_SIZE) {
            const batch = aiTracks.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(
                batch.map(async (t) => {
                    const query = `${t.title} ${t.artist}`;
                    const results = await this.api.search(query, { limit: 3 });
                    if (results?.tracks?.items?.length) return results.tracks.items[0];
                    if (results?.tracks?.length) return results.tracks[0];
                    return null;
                })
            );

            const found = batchResults
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => r.value);
            resolvedTracks.push(...found);

            // Start playing immediately once we have the first batch
            if (!startedPlaying && resolvedTracks.length > 0 && shouldStartFresh) {
                this.player.setQueue([...resolvedTracks], 0);
                this.player.playTrackFromQueue(0, 0);
                startedPlaying = true;
            } else if (found.length > 0 && startedPlaying) {
                // Append subsequent batches as they arrive
                this.player.addToQueue(found);
            }
        }

        // If we never started fresh (appending to existing queue)
        if (!shouldStartFresh && resolvedTracks.length > 0) {
            this.player.addToQueue(resolvedTracks);
        }
    }

    /* ══════════════════════════════════════════════
       INFINITE RADIO / QUEUE MONITOR
       ══════════════════════════════════════════════ */

    _startQueueMonitor() {
        this._stopQueueMonitor();
        this._monitorInterval = setInterval(() => this._checkQueueLevel(), 5000);
    }

    _stopQueueMonitor() {
        if (this._monitorInterval) {
            clearInterval(this._monitorInterval);
            this._monitorInterval = null;
        }
    }

    async _checkQueueLevel() {
        if (!this.isActive || this.isRefilling) return;

        const queue = this.player.getCurrentQueue();
        const remaining = queue.length - this.player.currentQueueIndex - 1;

        if (remaining <= this.queueRefillThreshold) {
            await this._refillQueue();
        }
    }

    async _refillQueue() {
        if (this.isRefilling) return;
        this.isRefilling = true;

        const session = authManager.getSession();
        if (!session?.access_token) {
            this.isRefilling = false;
            return;
        }

        try {
            const prompt = `Continue the ${this.currentMood || 'current'} vibe. More ${this.lastPrompt || 'music like this'}. Pick different tracks than before.`;

            const res = await fetch('/api/ai-dj/curate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    prompt,
                    context: {
                        timeOfDay: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
                        currentTrack: this.player?.currentTrack
                            ? `${this.player.currentTrack.title} by ${(this.player.currentTrack.artist?.name || this.player.currentTrack.artists?.[0]?.name || '')}`
                            : null,
                    },
                }),
            });

            const data = await res.json();
            if (data.tracks?.length) {
                await this._queueAITracks(data.tracks);
                // Show refill commentary
                if (data.commentary) {
                    this._setState(DJ_STATES.PLAYING, { commentary: data.commentary, mood: data.mood || this.currentMood });
                }
            }
        } catch (e) {
            console.warn('AI DJ refill error:', e);
        } finally {
            this.isRefilling = false;
        }
    }

    /* ══════════════════════════════════════════════
       COMMENTARY
       ══════════════════════════════════════════════ */

    async generateCommentary(currentTrack, nextTrack) {
        const session = authManager.getSession();
        if (!session?.access_token) return null;

        try {
            const res = await fetch('/api/ai-dj/commentary', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    currentTrack: currentTrack ? `${currentTrack.title} by ${currentTrack.artist?.name || currentTrack.artists?.[0]?.name || ''}` : null,
                    nextTrack: nextTrack ? `${nextTrack.title} by ${nextTrack.artist?.name || nextTrack.artists?.[0]?.name || ''}` : null,
                    mood: this.currentMood,
                }),
            });

            const data = await res.json();
            return data.text || null;
        } catch {
            return null;
        }
    }

    /* ══════════════════════════════════════════════
       LEARNING / FEEDBACK
       ══════════════════════════════════════════════ */

    async recordFeedback(action, track) {
        const session = authManager.getSession();
        if (!session?.access_token || !track) return;

        try {
            await fetch('/api/ai-dj/learn', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({
                    action,
                    trackTitle: track.title || 'unknown',
                    artistName: track.artist?.name || track.artists?.[0]?.name || 'unknown',
                    mood: this.currentMood,
                    sessionId: this.sessionId,
                }),
            });
        } catch {
            // Non-critical, fail silently
        }
    }

    /* ══════════════════════════════════════════════
       LIFECYCLE
       ══════════════════════════════════════════════ */

    stop() {
        this.isActive = false;
        this._stopQueueMonitor();
        this.stopListening();
        this._setState(DJ_STATES.IDLE);
    }

    destroy() {
        this.stop();
        if (this.recognition) {
            this.recognition.onresult = null;
            this.recognition.onerror = null;
            this.recognition.onend = null;
        }
    }

    getState() { return this.state; }
    getMood() { return this.currentMood; }
    getCommentary() { return this.commentary; }
    getSuggestionChips() { return SUGGESTION_CHIPS; }
    isVoiceAvailable() { return this.isVoiceSupported; }
    isDJActive() { return this.isActive; }
}

/** Geometric Persona Visualization — Canvas-based animated shapes */
export class DJPersona {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.state = DJ_STATES.IDLE;
        this.animId = null;
        this.time = 0;
        this.particles = [];
        this.rings = [];
        this.pulsePhase = 0;
        this.targetPulse = 0.5;
        this.currentPulse = 0.5;
        this.glowIntensity = 0;
        this.colorHue = 260; // Purple base
        this._resize();
        this._initParticles();

        this._resizeHandler = () => this._resize();
        window.addEventListener('resize', this._resizeHandler);
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.w = rect.width;
        this.h = rect.height;
        this.canvas.width = this.w * dpr;
        this.canvas.height = this.h * dpr;
        this.ctx.scale(dpr, dpr);
        this.cx = this.w / 2;
        this.cy = this.h / 2;
        this.baseRadius = Math.min(this.w, this.h) * 0.28;
    }

    _initParticles() {
        this.particles = [];
        // Fewer particles on mobile for better perf
        const isMobile = window.innerWidth < 768;
        const count = isMobile ? 30 : 55;
        for (let i = 0; i < count; i++) {
            this.particles.push({
                angle: Math.random() * Math.PI * 2,
                radius: this.baseRadius * (0.8 + Math.random() * 1.5),
                speed: 0.001 + Math.random() * 0.003,
                size: 1 + Math.random() * (isMobile ? 1.8 : 2.5),
                alpha: 0.1 + Math.random() * 0.5,
                drift: (Math.random() - 0.5) * 0.5,
            });
        }
    }

    setState(state) {
        this.state = state;
        switch (state) {
            case DJ_STATES.IDLE:
                this.targetPulse = 0.5;
                this.colorHue = 260;
                break;
            case DJ_STATES.LISTENING:
                this.targetPulse = 0.7;
                this.colorHue = 200; // Blue when listening
                break;
            case DJ_STATES.PROCESSING:
                this.targetPulse = 0.9;
                this.colorHue = 280; // Violet when processing
                break;
            case DJ_STATES.PLAYING:
                this.targetPulse = 0.6;
                this.colorHue = 250;
                break;
            case DJ_STATES.ERROR:
                this.targetPulse = 0.3;
                this.colorHue = 0; // Red flash
                break;
        }
    }

    start() {
        if (this.animId) return;
        let lastTs = 0;
        const animate = (ts) => {
            if (!lastTs) lastTs = ts;
            const dt = Math.min((ts - lastTs) / 1000, 0.05); // Cap at 50ms to prevent jumps
            lastTs = ts;
            this.time += dt;
            this._update(dt);
            this._draw();
            this.animId = requestAnimationFrame(animate);
        };
        this.animId = requestAnimationFrame(animate);
    }

    stop() {
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
    }

    _update(dt = 0.016) {
        // Use dt (seconds) to make animations frame-rate independent
        const speed = dt * 60; // Normalize so speed=1 at 60fps

        // Smooth pulse transition
        this.currentPulse += (this.targetPulse - this.currentPulse) * 0.05 * speed;
        this.pulsePhase += (0.02 + this.currentPulse * 0.02) * speed;

        // Update glow
        const targetGlow = this.state === DJ_STATES.PROCESSING ? 1 : this.state === DJ_STATES.LISTENING ? 0.7 : 0.3;
        this.glowIntensity += (targetGlow - this.glowIntensity) * 0.03 * speed;

        // Update particles
        for (const p of this.particles) {
            p.angle += p.speed * (1 + this.currentPulse) * speed;
            // Add drift in processing state
            if (this.state === DJ_STATES.PROCESSING) {
                p.radius += Math.sin(this.time * 3 + p.angle) * 0.3 * speed;
            }
        }
    }

    _draw() {
        const { ctx, w, h, cx, cy, time } = this;
        ctx.clearRect(0, 0, w, h);

        const pulse = Math.sin(this.pulsePhase) * 0.15 * this.currentPulse;
        const radius = this.baseRadius * (1 + pulse);

        // Background glow
        const grd = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 2.5);
        grd.addColorStop(0, `hsla(${this.colorHue}, 80%, 60%, ${0.15 * this.glowIntensity})`);
        grd.addColorStop(0.5, `hsla(${this.colorHue}, 60%, 40%, ${0.05 * this.glowIntensity})`);
        grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);

        // Outer rings
        for (let i = 0; i < 3; i++) {
            const ringRadius = radius * (1.3 + i * 0.25) + Math.sin(time * (0.5 + i * 0.3)) * 4;
            const alpha = (0.08 - i * 0.02) * (1 + this.glowIntensity);
            ctx.beginPath();
            ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
            ctx.strokeStyle = `hsla(${this.colorHue + i * 15}, 70%, 65%, ${alpha})`;
            ctx.lineWidth = 1.5 - i * 0.3;
            ctx.stroke();
        }

        // Geometric shape (morphing between circle and polygon)
        const sides = this.state === DJ_STATES.PROCESSING ? 6 : this.state === DJ_STATES.LISTENING ? 8 : 64;
        const morphFactor = this.state === DJ_STATES.IDLE ? 0 : 0.08 * this.currentPulse;

        ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
            const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
            const wobble = Math.sin(angle * 3 + time * 2) * radius * morphFactor;
            const r = radius + wobble;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();

        // Fill with gradient
        const fillGrd = ctx.createRadialGradient(cx, cy - radius * 0.3, 0, cx, cy, radius);
        fillGrd.addColorStop(0, `hsla(${this.colorHue}, 50%, 30%, 0.4)`);
        fillGrd.addColorStop(0.7, `hsla(${this.colorHue + 30}, 40%, 15%, 0.3)`);
        fillGrd.addColorStop(1, `hsla(${this.colorHue}, 30%, 8%, 0.15)`);
        ctx.fillStyle = fillGrd;
        ctx.fill();

        // Stroke
        ctx.strokeStyle = `hsla(${this.colorHue}, 70%, 70%, ${0.4 + this.glowIntensity * 0.3})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner glow ring
        ctx.beginPath();
        ctx.arc(cx, cy, radius * 0.6 + Math.sin(time * 1.5) * 3, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${this.colorHue + 20}, 60%, 65%, ${0.1 + pulse * 0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Particles
        for (const p of this.particles) {
            const px = cx + Math.cos(p.angle) * p.radius;
            const py = cy + Math.sin(p.angle) * p.radius;
            const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
            const maxDist = radius * 2.5;
            if (dist > maxDist) continue;

            const fadeAlpha = p.alpha * (1 - dist / maxDist) * (0.5 + this.glowIntensity * 0.5);
            ctx.beginPath();
            ctx.arc(px, py, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${this.colorHue + 30}, 60%, 75%, ${fadeAlpha})`;
            ctx.fill();
        }

        // Center dot / icon indicator
        const dotSize = 4 + Math.sin(time * 3) * 2 * this.currentPulse;
        ctx.beginPath();
        ctx.arc(cx, cy, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${this.colorHue}, 80%, 80%, ${0.6 + this.glowIntensity * 0.4})`;
        ctx.fill();

        // Processing spinner overlay
        if (this.state === DJ_STATES.PROCESSING) {
            const spinAngle = time * 3;
            for (let i = 0; i < 3; i++) {
                const a = spinAngle + (i * Math.PI * 2) / 3;
                const sr = radius * 0.85;
                const sx = cx + Math.cos(a) * sr;
                const sy = cy + Math.sin(a) * sr;
                ctx.beginPath();
                ctx.arc(sx, sy, 3, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${this.colorHue + 40}, 80%, 75%, ${0.7 - i * 0.15})`;
                ctx.fill();
            }
        }

        // Listening wave effect
        if (this.state === DJ_STATES.LISTENING) {
            ctx.save();
            ctx.globalAlpha = 0.4;
            for (let i = 0; i < 3; i++) {
                const waveRadius = radius * (1.1 + i * 0.15) + Math.sin(time * 4 - i * 0.5) * 5;
                ctx.beginPath();
                ctx.arc(cx, cy, waveRadius, 0, Math.PI * 2);
                ctx.strokeStyle = `hsla(200, 70%, 65%, ${0.3 - i * 0.08})`;
                ctx.lineWidth = 2 - i * 0.5;
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    destroy() {
        this.stop();
        window.removeEventListener('resize', this._resizeHandler);
    }
}

// Singleton export
export const aiDjManager = new AIDJManager();

