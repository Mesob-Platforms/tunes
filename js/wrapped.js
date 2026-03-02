/**
 * js/wrapped.js — Tunes Wrapped (Spotify Wrapped–style yearly recap)
 *
 * Full vertical-scroll experience with bold Spotify-inspired colors,
 * decorative CSS patterns, full-bleed imagery, massive typography,
 * and IntersectionObserver-driven GSAP animations.
 */
import { gsap } from 'gsap';
import html2canvas from 'html2canvas';
import { supabase } from './accounts/config.js';
import { apiUrl } from './platform.js';
import { getAvatarUrl } from './accounts/profile.js';

/* ═══════════════════════════════════════════════════════════════
   0.  CONSTANTS & PALETTE
   ═══════════════════════════════════════════════════════════════ */
const CONTAINER_ID = 'wrapped-container';

/** Emails allowed to preview Wrapped in Feb 12-15 */
const PREVIEW_EMAILS = ['naolmideksa@gmail.com', 'naolmid.official@gmail.com'];

/* Spotify-inspired palette */
const C = {
  green:    '#1DB954',
  greenDk:  '#1AA34A',
  black:    '#191414',
  dark:     '#121212',
  pink:     '#E8115B',
  magenta:  '#AF2896',
  orange:   '#F49D37',
  purple:   '#7B2FBE',
  blue:     '#2D46B9',
  red:      '#E22134',
  cream:    '#F5F0E1',
  peach:    '#FFCBA4',
  lavender: '#D4BBFF',
  white:    '#FFFFFF',
};

/* Per-section theme — every section gets a pattern */
const SECTIONS = [
  { bg: C.black,   accent: C.green,    text: C.white, pattern: 'dots' },       // 0  intro
  { bg: C.green,   accent: C.black,    text: C.black, pattern: 'circles' },    // 1  total plays
  { bg: C.magenta, accent: C.lavender, text: C.white, pattern: 'stripes' },    // 2  total minutes
  { bg: C.pink,    accent: C.cream,    text: C.white, pattern: 'squares' },    // 3  unique stats
  { bg: C.dark,    accent: C.green,    text: C.white, pattern: 'dots' },       // 4  first song (image)
  { bg: C.red,     accent: C.white,    text: C.white, pattern: 'lines' },      // 5  top genre (red bg, lighter pattern)
  { bg: C.dark,    accent: C.green,    text: C.white, pattern: 'stripes' },    // 6  top artist (image)
  { bg: C.dark,    accent: C.magenta,  text: C.white, pattern: 'squares' },    // 7  top track (image)
  { bg: C.green,   accent: C.black,    text: C.black, pattern: 'scattered' },  // 8  streak
  { bg: C.magenta, accent: C.lavender, text: C.white, pattern: 'waves' },      // 9  personality (replaced bigcircle with waves)
  { bg: C.blue,    accent: C.white,     text: C.white, pattern: 'lines' },      // 10 top 5 artists (blue theme)
  { bg: C.orange,  accent: C.black,    text: C.black, pattern: 'lines' },     // 11 top 5 albums (orange theme)
  { bg: C.dark,    accent: C.green,    text: C.white, pattern: 'lines' },      // 12 leaderboard
  { bg: 'darkgrad',accent: C.green,    text: C.white, pattern: 'dots' },       // 13 outro
];

/* ═══════════════════════════════════════════════════════════════
   1.  STATE
   ═══════════════════════════════════════════════════════════════ */
let data = null;
let leaderboard = null;
let apiRef = null;
let imageMap = { artists: {}, tracks: {}, albums: {}, firstListen: null };
let albumDataMap = {}; // Maps track keys to album info: { title, artist, cover }
let observer = null;
let pageMutObs = null;

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const message = payload?.error || payload?.message || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ═══════════════════════════════════════════════════════════════
   2.  ENTRY POINT — called from ui.renderWrappedPage()
   ═══════════════════════════════════════════════════════════════ */
export async function initWrapped(api) {
  apiRef = api || null;
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;
  injectStyles();
  container.innerHTML = `<div class="wr-loading"><div class="wr-spinner"></div><p>Preparing your Wrapped\u2026</p></div>`;

  /* Fullscreen takeover: hide footer, nav, padding */
  document.body.classList.add('wrapped-active');

  /* Watch for router hiding the page (back navigation, tab bar click, etc.) */
  const pageEl = document.getElementById('page-wrapped');
  if (pageEl) {
    pageMutObs = new MutationObserver(() => {
      /* Router toggles the 'active' class; inline style.display is also possible */
      if (!pageEl.classList.contains('active') || pageEl.style.display === 'none') {
        cleanup(); pageMutObs?.disconnect();
      }
    });
    pageMutObs.observe(pageEl, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { container.innerHTML = '<p class="wr-err">Please sign in to view your Wrapped.</p>'; return; }

    const [computeRes, leaderboardRes] = await Promise.allSettled([
      fetchJsonWithTimeout(
        apiUrl('/api/wrapped/compute'),
        { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } },
        15000
      ),
      fetchJsonWithTimeout(
        apiUrl('/api/wrapped/leaderboard'),
        { headers: { 'Authorization': `Bearer ${token}` } },
        12000
      ),
    ]);

    if (computeRes.status !== 'fulfilled') {
      throw (computeRes.reason instanceof Error ? computeRes.reason : new Error('Failed to load Wrapped data.'));
    }

    data = computeRes.value || {};
    if (leaderboardRes.status === 'fulfilled') {
      leaderboard = leaderboardRes.value?.leaderboard || [];
    } else {
      leaderboard = [];
      console.warn('[Wrapped] Leaderboard unavailable:', leaderboardRes.reason);
    }

    if (data.error) { container.innerHTML = `<p class="wr-err">${data.error}</p>`; return; }
    if (Number(data.total_plays || 0) === 0) { container.innerHTML = '<p class="wr-err">You don\'t have any listening data for this period yet.<br>Start listening!</p>'; return; }

    await resolveImages();
    buildUI(container);
  } catch (e) {
    console.error('[Wrapped]', e);
    container.innerHTML = `<p class="wr-err">Failed to load Wrapped.<br>${e.message}</p>`;
  }
}

/* ── Resolve images for top artists, tracks, albums, first listen ── */
async function resolveImages() {
  imageMap = { artists: {}, tracks: {}, albums: {}, firstListen: null };
  albumDataMap = {}; // Reset album data map
  if (!apiRef) return;
  const promises = [];

  for (const a of (data.top_artists || [])) {
    promises.push(
      apiRef.searchArtists(a.name).then(res => {
        const hit = (res.items || [])[0];
        if (hit?.picture) imageMap.artists[a.name] = apiRef.getArtistPictureUrl(hit.picture, '750');
      }).catch(() => {})
    );
  }

  for (const t of (data.top_tracks || [])) {
    const key = `${t.title}|||${t.artist}`;
    promises.push(
      apiRef.searchTracks(t.title).then(async res => {
        const items = res.items || [];
        const exact = items.find(i =>
          i.title?.toLowerCase() === t.title.toLowerCase() &&
          (i.artist?.name?.toLowerCase() === t.artist.toLowerCase() || i.artists?.[0]?.name?.toLowerCase() === t.artist.toLowerCase())
        );
        const hit = exact || items[0];
        if (hit?.album?.cover) {
          imageMap.tracks[key] = apiRef.getCoverUrl(hit.album.cover, '750');
          // Store album data for this track
          if (hit.album?.title && hit.album?.id) {
            // Fetch album details to check if it's a single (exclude singles)
            try {
              const albumData = await apiRef.getAlbum(hit.album.id);
              const trackCount = albumData?.tracks?.length || 0;
              // Exclude singles: albums with 3 or fewer tracks are considered singles/EPs
              if (trackCount > 3) {
                albumDataMap[key] = {
                  title: hit.album.title,
                  artist: t.artist,
                  cover: apiRef.getCoverUrl(hit.album.cover, '750'),
                  trackCount: trackCount
                };
                const albumKey = `${hit.album.title}|||${t.artist}`;
                imageMap.albums[albumKey] = apiRef.getCoverUrl(hit.album.cover, '750');
              }
            } catch (err) {
              // If album fetch fails, skip this album (don't include it)
              console.warn('[Wrapped] Failed to fetch album details:', err);
            }
          }
        }
      }).catch(() => {})
    );
  }

  if (data.first_listen) {
    const fl = data.first_listen;
    promises.push(
      apiRef.searchTracks(fl.track_title).then(res => {
        const items = res.items || [];
        const exact = items.find(i =>
          i.title?.toLowerCase() === fl.track_title.toLowerCase() &&
          (i.artist?.name?.toLowerCase() === fl.artist_name.toLowerCase() || i.artists?.[0]?.name?.toLowerCase() === fl.artist_name.toLowerCase())
        );
        const hit = exact || items[0];
        if (hit?.album?.cover) imageMap.firstListen = apiRef.getCoverUrl(hit.album.cover, '750');
      }).catch(() => {})
    );
  }

  await Promise.allSettled(promises);
}

/* ═══════════════════════════════════════════════════════════════
   3.  BUILD UI SHELL
   ═══════════════════════════════════════════════════════════════ */
function buildUI(container) {
  container.innerHTML = '';
  const scroller = mk('div', 'wr-scroller');

  const secs = [
    sectionIntro(),
    sectionTotalPlays(),
    sectionTotalMinutes(),
    sectionUniqueStats(),
    sectionFirstSong(),
    sectionTopGenre(),
    sectionTopArtist(),
    sectionTopTrack(),
    sectionStreak(),
    sectionPersonality(),
    sectionTop5Artists(),
    sectionTop5Albums(),
    sectionLeaderboard(),
    sectionOutro(),
  ];

  secs.forEach((sec, i) => {
    const theme = SECTIONS[i];
    sec.classList.add('wr-section');
    sec.dataset.idx = i;

    if (theme.bg === 'darkgrad') {
      sec.style.background = 'linear-gradient(180deg, #121212 0%, #191414 50%, #0d0d0d 100%)';
    } else {
      sec.style.backgroundColor = theme.bg;
    }
    sec.style.color = theme.text;
    if (theme.text === C.black) sec.dataset.theme = 'light';

    if (theme.pattern !== 'none') sec.dataset.pattern = theme.pattern;
    scroller.appendChild(sec);
  });

  /* Fixed buttons */
  const closeBtn = mk('div', 'wr-close', '&times;');
  closeBtn.addEventListener('click', () => { cleanup(); window.history.back(); });

  const shareBtn = mk('div', 'wr-share-fab');
  shareBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;
  shareBtn.addEventListener('click', shareWrapped);

  container.appendChild(scroller);
  container.appendChild(closeBtn);
  container.appendChild(shareBtn);

  setupScrollAnimations(scroller);
}

/* ═══════════════════════════════════════════════════════════════
   4.  SCROLL-TRIGGERED ANIMATIONS
   ═══════════════════════════════════════════════════════════════ */
function setupScrollAnimations(scroller) {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateSection(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { root: scroller, threshold: 0.25 });

  scroller.querySelectorAll('.wr-section').forEach(sec => observer.observe(sec));
}

function animateSection(section) {
  /* Stagger .wr-anim children */
  const items = section.querySelectorAll('.wr-anim');
  if (items.length) {
    gsap.fromTo(items,
      { opacity: 0, y: 50 },
      { opacity: 1, y: 0, duration: 0.7, stagger: 0.12, ease: 'power3.out', delay: 0.1 }
    );
  }

  /* Count-up numbers */
  section.querySelectorAll('[data-countup]').forEach(el => {
    const target = parseInt(el.dataset.countup, 10);
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target, duration: 2, ease: 'power2.out', delay: 0.4,
      onUpdate: () => { el.textContent = Math.round(obj.val).toLocaleString(); }
    });
  });

  /* Full-bleed image reveal */
  section.querySelectorAll('.wr-img-reveal').forEach(img => {
    gsap.fromTo(img,
      { opacity: 0, scale: 1.08 },
      { opacity: 0.55, scale: 1, duration: 1.5, ease: 'power2.out', delay: 0.15 }
    );
  });

  /* Confetti */
  if (section.classList.contains('wr-confetti-trigger')) launchConfetti(section);
}

export function cleanupWrapped() {
  if (observer) { observer.disconnect(); observer = null; }
  if (pageMutObs) { pageMutObs.disconnect(); pageMutObs = null; }
  document.body.classList.remove('wrapped-active');
}
/* Keep internal alias for existing callers */
function cleanup() { cleanupWrapped(); }

/* ═══════════════════════════════════════════════════════════════
   5.  CONFETTI
   ═══════════════════════════════════════════════════════════════ */
function launchConfetti(section) {
  const colors = [C.green, C.pink, C.orange, C.magenta, C.lavender, C.white, C.peach, '#FFD700'];
  for (let i = 0; i < 100; i++) {
    const dot = document.createElement('div');
    dot.className = 'wr-confetti-dot';
    const size = Math.random() * 10 + 4;
    dot.style.cssText = `background:${colors[i % colors.length]};left:${Math.random()*100}%;width:${size}px;height:${size}px;border-radius:${Math.random()>0.5?'50%':'2px'}`;
    section.appendChild(dot);
    gsap.fromTo(dot,
      { y: -30, x: (Math.random()-0.5)*80, opacity: 1, scale: Math.random()*0.5+0.7, rotation: 0 },
      { y: section.offsetHeight + 40, x: `+=${(Math.random()-0.5)*200}`, rotation: Math.random()*720,
        opacity: 0, duration: 3 + Math.random()*2, delay: Math.random()*1, ease: 'power1.in',
        onComplete: () => dot.remove()
      }
    );
  }
}

/* ═══════════════════════════════════════════════════════════════
   6.  SHARING
   ═══════════════════════════════════════════════════════════════ */
async function shareWrapped() {
  const card = document.createElement('div');
  card.className = 'wr-share-card';

  const topArtist = data.top_artists?.[0];
  const topTrack  = data.top_tracks?.[0];
  const topGenre  = data.top_genres?.[0];

  card.innerHTML = `
    <div class="wr-sc-bg"></div>
    <div class="wr-sc-content">
      <div class="wr-sc-logo">TUNES WRAPPED</div>
      <div class="wr-sc-year">${esc(data.year_label)}</div>
      <div class="wr-sc-avatar"><img src="${getAvatarUrl(data.user_avatar_seed)}" alt=""></div>
      <div class="wr-sc-name">${esc(data.user_name)}</div>
      <div class="wr-sc-stats">
        <div class="wr-sc-stat"><span class="wr-sc-num">${data.total_plays}</span><span class="wr-sc-label">plays</span></div>
        <div class="wr-sc-stat"><span class="wr-sc-num">${data.total_minutes}</span><span class="wr-sc-label">minutes</span></div>
      </div>
      ${topArtist ? `<div class="wr-sc-row"><span class="wr-sc-tag">Top Artist</span><span class="wr-sc-val">${esc(topArtist.name)}</span></div>` : ''}
      ${topTrack  ? `<div class="wr-sc-row"><span class="wr-sc-tag">Top Song</span><span class="wr-sc-val">${esc(topTrack.title)}</span></div>` : ''}
      ${topGenre  ? `<div class="wr-sc-row"><span class="wr-sc-tag">Top Genre</span><span class="wr-sc-val">${esc(topGenre.genre)}</span></div>` : ''}
    </div>
  `;
  card.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:400px;height:520px;z-index:-1';
  document.body.appendChild(card);

  try {
    const cvs = await html2canvas(card, { backgroundColor: null, scale: 2, useCORS: true });
    const blob = await new Promise(r => cvs.toBlob(r, 'image/png'));
    const file = new File([blob], `tunes-wrapped-${data.year_label}.png`, { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: `My Tunes ${data.year_label} Wrapped`, files: [file] });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = file.name; a.click();
      URL.revokeObjectURL(url);
    }
  } catch (e) { console.warn('[Wrapped] Share error:', e); }
  card.remove();
}

/* ═══════════════════════════════════════════════════════════════
   7.  HELPERS
   ═══════════════════════════════════════════════════════════════ */
function mk(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ═══════════════════════════════════════════════════════════════
   8.  SECTION BUILDERS (12 sections — trend removed)
   ═══════════════════════════════════════════════════════════════ */

/* ── 0  INTRO ── */
function sectionIntro() {
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    <div class="wr-anim wr-logo-text">#WRAPPED</div>
    <div class="wr-anim wr-year-big">${esc(data.year_label)}</div>
    <div class="wr-anim" style="margin:2rem 0">
      <div class="wr-avatar-ring-sp">
        <img src="${getAvatarUrl(data.user_avatar_seed)}" class="wr-avatar-img" alt="">
      </div>
    </div>
    <div class="wr-anim wr-username">${esc(data.user_name)}</div>
    <div class="wr-anim wr-scroll-hint">
      <span>Scroll to begin</span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
  `;
  return s;
}

/* ── 1  TOTAL PLAYS ── */
function sectionTotalPlays() {
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    <div class="wr-anim wr-section-label">You pressed play</div>
    <div class="wr-anim wr-mega-num" data-countup="${data.total_plays}">0</div>
    <div class="wr-anim wr-section-label">times this year</div>
    <div class="wr-anim wr-stat-pill" style="margin-top:2rem">
      That's about <strong>${Math.round(data.total_plays / 12)}</strong> songs per month
    </div>
  `;
  return s;
}

/* ── 2  TOTAL MINUTES ── */
function sectionTotalMinutes() {
  const hrs = Math.round(data.total_minutes / 60);
  const cmp = hrs > 24 ? `That's ${Math.round(hrs/24)} full days of music`
    : hrs > 1 ? `That's ${hrs} hours of pure vibes`
    : 'Just getting started!';
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    <div class="wr-anim wr-section-label">You listened for</div>
    <div class="wr-anim wr-mega-num" data-countup="${data.total_minutes}">0</div>
    <div class="wr-anim wr-section-label">minutes</div>
    <div class="wr-anim wr-stat-pill" style="margin-top:2rem">${cmp}</div>
  `;
  return s;
}

/* ── 3  UNIQUE TRACKS + ARTISTS ── */
function sectionUniqueStats() {
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    <div class="wr-anim wr-section-label">You explored</div>
    <div class="wr-anim wr-stats-row">
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${data.unique_tracks}">0</div>
        <div class="wr-stat-tag">tracks</div>
      </div>
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${data.unique_artists}">0</div>
        <div class="wr-stat-tag">artists</div>
      </div>
    </div>
    <div class="wr-anim wr-section-label" style="margin-top:1.5rem;opacity:0.45">That's a lot of exploring</div>
  `;
  return s;
}

/* ── 4  FIRST SONG ── */
function sectionFirstSong() {
  const f = data.first_listen;
  if (!f) return mk('div', 'wr-center', '<div class="wr-anim wr-section-label">Your first song awaits\u2026</div>');
  const date = new Date(f.listened_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const coverUrl = imageMap.firstListen || '';
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    ${coverUrl ? `<img class="wr-hero-bg wr-img-reveal" src="${coverUrl}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="wr-hero-color-overlay" style="background:linear-gradient(to top,rgba(18,18,18,0.95) 0%,rgba(29,185,84,0.3) 50%,rgba(18,18,18,0.7) 100%)"></div>
    <div class="wr-anim wr-section-label">Your year started with</div>
    <div class="wr-anim wr-track-name">${esc(f.track_title)}</div>
    <div class="wr-anim wr-artist-sub">${esc(f.artist_name)}</div>
    <div class="wr-anim wr-date-pill">${date}</div>
  `;
  return s;
}

/* ── 5  TOP GENRE (#1 only) ── */
function sectionTopGenre() {
  const g = data.top_genres?.[0];
  if (!g) return mk('div', 'wr-center', '<div class="wr-anim wr-section-label">No genre data yet</div>');
  const s = mk('div', 'wr-center');

  // Build mini genre bars for top 3 genres
  const bars = (data.top_genres || []).slice(0, 3).map((genre) => {
    const maxP = (data.top_genres[0]?.plays) || 1;
    const pct = Math.max(10, Math.round((genre.plays / maxP) * 100));
    return `<div class="wr-genre-bar wr-anim">
      <div class="wr-genre-bar-info"><span class="wr-genre-bar-name">${esc(genre.genre)}</span><span class="wr-genre-bar-plays">${genre.plays}</span></div>
      <div class="wr-genre-bar-track"><div class="wr-genre-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  s.innerHTML = `
    <div class="wr-anim wr-section-label-small">Your top genre was</div>
    <div class="wr-anim wr-genre-name-big">${esc(g.genre)}</div>
    <div class="wr-anim wr-play-count">${g.plays} plays</div>
    ${bars ? `<div class="wr-anim wr-genre-bars">${bars}</div>` : ''}
  `;
  return s;
}

/* ── 6  TOP ARTIST (#1 only) ── */
function sectionTopArtist() {
  const a = data.top_artists?.[0];
  if (!a) return mk('div', 'wr-center', '<div class="wr-anim wr-section-label">No artist data yet</div>');
  const imgUrl = imageMap.artists[a.name] || '';
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    ${imgUrl ? `<img class="wr-hero-bg wr-img-reveal" src="${imgUrl}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="wr-hero-color-overlay" style="background:linear-gradient(to top,rgba(18,18,18,0.92) 0%,rgba(29,185,84,0.12) 45%,rgba(18,18,18,0.5) 100%)"></div>
    <div class="wr-anim wr-section-label">Your #1 artist</div>
    <div class="wr-anim wr-artist-hero">${esc(a.name)}</div>
    <div class="wr-anim wr-play-count" style="color:${C.green}">${a.plays} plays</div>
  `;
  return s;
}

/* ── 7  TOP TRACK (#1 only) ── */
function sectionTopTrack() {
  const t = data.top_tracks?.[0];
  if (!t) return mk('div', 'wr-center', '<div class="wr-anim wr-section-label">No track data yet</div>');
  const key = `${t.title}|||${t.artist}`;
  const coverUrl = imageMap.tracks[key] || '';
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    ${coverUrl ? `<img class="wr-hero-bg wr-img-reveal" src="${coverUrl}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="wr-hero-color-overlay" style="background:linear-gradient(to top,rgba(18,18,18,0.95) 0%,rgba(175,40,150,0.3) 45%,rgba(18,18,18,0.7) 100%)"></div>
    <div class="wr-anim wr-section-label">Your #1 song</div>
    <div class="wr-anim wr-track-name">${esc(t.title)}</div>
    <div class="wr-anim wr-artist-sub">${esc(t.artist)}</div>
    <div class="wr-anim wr-play-count" style="color:${C.magenta}">${t.plays} plays</div>
  `;
  return s;
}

/* ── 8  STREAK + DISCOVERY ── */
function sectionStreak() {
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    <div class="wr-anim wr-section-label">Your milestones</div>
    <div class="wr-anim wr-stats-row">
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${data.longest_streak}">0</div>
        <div class="wr-stat-tag">day streak</div>
      </div>
      <div class="wr-stat-block">
        <div class="wr-stat-big" data-countup="${data.new_artists_discovered}">0</div>
        <div class="wr-stat-tag">new artists</div>
      </div>
    </div>
    <div class="wr-anim wr-sub" style="margin-top:1.5rem;opacity:0.5">That's some serious exploring</div>
  `;
  return s;
}

/* ── 9  PERSONALITY ── */
function sectionPersonality() {
  const p = data.personality || {};
  const s = mk('div', 'wr-center');
  s.innerHTML = `
    <div class="wr-anim" style="font-size:4rem;margin-bottom:0.5rem">${p.emoji || '\uD83D\uDD25'}</div>
    <div class="wr-anim wr-section-label">Your listening personality</div>
    <div class="wr-anim wr-personality-name">${esc(p.name || 'The Listener')}</div>
    <div class="wr-anim wr-personality-desc">${esc(p.description || '')}</div>
  `;
  return s;
}

/* ── 10  TOP 5 ARTISTS ── */
function sectionTop5Artists() {
  const artists = (data.top_artists || []).slice(0, 5);
  if (!artists.length) return mk('div', 'wr-center', '<div class="wr-anim wr-section-label">No artist data yet</div>');
  const s = mk('div', 'wr-center');
  
  const artistCards = artists.map((a, i) => {
    const imgUrl = imageMap.artists[a.name] || '';
    return `
      <div class="wr-top5-item wr-anim">
        <div class="wr-top5-rank">${i + 1}</div>
        ${imgUrl ? `<img src="${imgUrl}" class="wr-top5-img" alt="" onerror="this.style.display='none'">` : '<div class="wr-top5-img-placeholder"></div>'}
        <div class="wr-top5-info">
          <div class="wr-top5-name">${esc(a.name)}</div>
          <div class="wr-top5-plays">${a.plays} plays</div>
        </div>
      </div>
    `;
  }).join('');

  s.innerHTML = `
    <div class="wr-anim wr-section-label">Your top 5 artists</div>
    <div class="wr-top5-list">${artistCards}</div>
  `;
  return s;
}

/* ── 11  TOP 5 ALBUMS ── */
function sectionTop5Albums() {
  // Derive top albums from top tracks by grouping by album from API data
  const albumMap = {};
  (data.top_tracks || []).forEach(t => {
    const trackKey = `${t.title}|||${t.artist}`;
    const albumInfo = albumDataMap[trackKey];
    
    // Only process tracks that have valid album data from API
    if (!albumInfo || !albumInfo.title) return;
    
    const albumKey = `${albumInfo.title}|||${albumInfo.artist}`;
    if (!albumMap[albumKey]) {
      albumMap[albumKey] = {
        name: albumInfo.title,
        artist: albumInfo.artist,
        cover: albumInfo.cover,
        plays: 0,
        tracks: []
      };
    }
    albumMap[albumKey].plays += t.plays;
    albumMap[albumKey].tracks.push(t);
  });
  
  const albums = Object.values(albumMap)
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 5);
  
  if (!albums.length) return mk('div', 'wr-center', '<div class="wr-anim wr-section-label">No album data yet</div>');
  const s = mk('div', 'wr-center');
  
  const albumCards = albums.map((album, i) => {
    const imgUrl = album.cover || '';
    return `
      <div class="wr-top5-item wr-anim">
        <div class="wr-top5-rank">${i + 1}</div>
        ${imgUrl ? `<img src="${imgUrl}" class="wr-top5-img" alt="" onerror="this.style.display='none'">` : '<div class="wr-top5-img-placeholder"></div>'}
        <div class="wr-top5-info">
          <div class="wr-top5-name">${esc(album.name)}</div>
          <div class="wr-top5-artist">${esc(album.artist)}</div>
          <div class="wr-top5-plays">${album.plays} plays</div>
        </div>
      </div>
    `;
  }).join('');

  s.innerHTML = `
    <div class="wr-anim wr-section-label">Your top 5 albums</div>
    <div class="wr-top5-list">${albumCards}</div>
  `;
  return s;
}

/* ── 12  LEADERBOARD ── */
function sectionLeaderboard() {
  const rows = (leaderboard || []).slice(0, 10).map((u, i) => {
    const rank = Number.isFinite(Number(u?.rank)) ? Number(u.rank) : i + 1;
    const minutes = Number.isFinite(Number(u?.total_minutes)) ? Number(u.total_minutes) : 0;
    const name = esc(u?.display_name || 'Listener');
    const avatar = getAvatarUrl(u?.avatar_seed || 'listener');
    return `
    <div class="wr-lb-row wr-anim">
      <span class="wr-lb-rank" style="${i < 3 ? `color:${[C.orange, '#C0C0C0', '#CD7F32'][i]}` : ''}">#${rank}</span>
      <img src="${avatar}" class="wr-lb-avatar" alt="">
      <span class="wr-lb-name">${name}</span>
      <span class="wr-lb-stat">${minutes.toLocaleString()} min</span>
    </div>
  `;
  }).join('');
  const s = mk('div', '');
  s.innerHTML = `
    <div class="wr-anim wr-section-label" style="text-align:center;margin-bottom:1.5rem">\uD83D\uDC51 Top Listeners</div>
    <div class="wr-lb-list">${rows || '<div style="text-align:center;opacity:0.4">No data yet</div>'}</div>
    ${data.user_rank ? `<div class="wr-anim" style="text-align:center;margin-top:1.5rem;font-size:0.9rem;opacity:0.6">You're <strong style="color:${C.green}">#${data.user_rank}</strong> out of ${data.total_app_users} listeners</div>` : ''}
  `;
  return s;
}

/* ── 13  OUTRO ── */
function sectionOutro() {
  const s = mk('div', 'wr-center wr-confetti-trigger');
  let userId = '';
  supabase?.auth.getSession().then(({ data: { session } }) => {
    if (session?.user?.id) {
      userId = session.user.id;
      const link = s.querySelector('.wr-share-link');
      if (link) link.href = `${window.location.origin}/wrapped/share/${userId}`;
    }
  });
  s.innerHTML = `
    <div class="wr-anim wr-outro-title">That's a wrap!</div>
    <div class="wr-anim" style="font-size:1rem;opacity:0.6;margin:0.5rem 0;font-weight:500">${esc(data.year_label)} \u00B7 Tunes Wrapped</div>
    <div class="wr-anim" style="margin-top:2.5rem;display:flex;gap:0.8rem;flex-direction:column;align-items:center">
      <button class="wr-btn-sp wr-btn-sp-primary" onclick="document.querySelector('.wr-share-fab')?.click()">Share as Image</button>
      <button class="wr-btn-sp wr-btn-sp-ghost" onclick="window.history.back()">Done</button>
    </div>
  `;
  return s;
}

/* ═══════════════════════════════════════════════════════════════
   9.  HOME BANNER  (reverted to original style)
   ═══════════════════════════════════════════════════════════════ */
export function getWrappedBannerHTML() {
  injectBannerStyles();
  return `
    <div class="wrb-sp" data-navigate="/wrapped">
      <div class="wrb-sp-content">
        <div class="wrb-sp-tag">#WRAPPED</div>
        <div class="wrb-sp-title">Your 2025/26 Wrapped is here</div>
        <div class="wrb-sp-sub">See your year in music \u2192</div>
      </div>
      <div class="wrb-sp-eq">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
    </div>
  `;
}

function injectBannerStyles() {
  if (document.getElementById('wrb-sp-styles')) return;
  const s = document.createElement('style');
  s.id = 'wrb-sp-styles';
  s.textContent = `
.wrb-sp{position:relative;width:100%;border-radius:1.5rem;overflow:hidden;cursor:pointer;margin-bottom:1rem;background-color:rgba(9,9,11,0.65);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(168,85,247,0.25);box-shadow:0 0 18px rgba(168,85,247,0.15),0 20px 50px rgba(0,0,0,0.5);padding:1.2rem 1.4rem;box-sizing:border-box;transition:transform 0.25s cubic-bezier(.22,1,.36,1),box-shadow 0.25s;display:flex;align-items:center;justify-content:space-between}
.wrb-sp:hover{transform:translateY(-2px) scale(1.01);box-shadow:0 0 28px rgba(168,85,247,0.25),0 20px 50px rgba(0,0,0,0.5)}
.wrb-sp:active{transform:scale(0.98)}
.wrb-sp-content{position:relative;z-index:1;display:flex;flex-direction:column;gap:0.1rem}
.wrb-sp-tag{font-size:0.65rem;font-weight:800;letter-spacing:-0.04em;color:rgba(168,85,247,0.8)}
.wrb-sp-title{font-size:1.25rem;font-weight:800;letter-spacing:-0.04em;color:#fff;line-height:1.3;margin-top:0.3rem}
.wrb-sp-sub{font-size:0.8rem;font-weight:400;letter-spacing:-0.04em;color:rgba(255,255,255,0.45);margin-top:0.2rem}
.wrb-sp-eq{display:flex;align-items:flex-end;gap:3px;height:40px;position:relative;z-index:1}
.wrb-sp-eq span{display:block;width:4px;border-radius:2px;background:rgba(168,85,247,0.7);animation:wrb-sp-eq 1s ease-in-out infinite alternate}
.wrb-sp-eq span:nth-child(1){height:40%;animation-delay:0s}
.wrb-sp-eq span:nth-child(2){height:75%;animation-delay:0.15s}
.wrb-sp-eq span:nth-child(3){height:50%;animation-delay:0.3s}
.wrb-sp-eq span:nth-child(4){height:90%;animation-delay:0.1s}
.wrb-sp-eq span:nth-child(5){height:60%;animation-delay:0.25s}
@keyframes wrb-sp-eq{0%{transform:scaleY(0.3);opacity:0.5}100%{transform:scaleY(1);opacity:1}}
  `;
  document.head.appendChild(s);
}

/* ═══════════════════════════════════════════════════════════════
   10. AVAILABILITY CHECK
   ═══════════════════════════════════════════════════════════════ */
export function isWrappedAvailable(isAdmin = false, userEmail = '') {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  const isPreview = isAdmin || (userEmail && PREVIEW_EMAILS.includes(userEmail.toLowerCase()));
  if (isPreview && m === 1 && d >= 12 && d <= 20) return true;
  if (m !== 8) return false;
  return isAdmin ? d >= 4 && d <= 14 : d >= 7 && d <= 14;
}

/* ═══════════════════════════════════════════════════════════════
   11. INJECT STYLES
   ═══════════════════════════════════════════════════════════════ */
function injectStyles() {
  if (document.getElementById('wr-styles')) return;

  /* Montserrat font is now bundled in /fonts/fonts.css */

  const style = document.createElement('style');
  style.id = 'wr-styles';
  style.textContent = `
/* ═══ Fullscreen takeover ═══ */
body.wrapped-active .now-playing-bar{display:none!important}
body.wrapped-active .bottom-nav{display:none!important}
body.wrapped-active .main-header{display:none!important}
body.wrapped-active #mobile-tab-bar,body.wrapped-active .mobile-tab-bar{display:none!important}
body.wrapped-active .main-content{padding:0!important;margin:0!important;height:100vh!important;max-height:100vh!important;overflow:hidden!important}
body.wrapped-active #page-wrapped{position:fixed!important;inset:0!important;z-index:999!important;padding:0!important;margin:0!important}

/* ═══ Base ═══ */
#${CONTAINER_ID}{position:relative;width:100%;height:100vh;overflow:hidden;font-family:Montserrat,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.wr-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;color:#fff;gap:1rem;background:${C.black};font-family:Montserrat,sans-serif}
.wr-loading p{font-size:0.85rem;opacity:0.5;font-weight:500}
.wr-spinner{width:44px;height:44px;border:3px solid rgba(29,185,84,0.15);border-top-color:${C.green};border-radius:50%;animation:wrspin 0.7s linear infinite}
@keyframes wrspin{to{transform:rotate(360deg)}}
.wr-err{color:rgba(255,255,255,0.5);text-align:center;padding:3rem 1.5rem;font-size:0.95rem;line-height:1.6;background:${C.black};min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Montserrat,sans-serif}

/* ═══ Scroll Container ═══ */
.wr-scroller{width:100%;height:100%;overflow-y:auto;scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch}

/* ═══ Sections ═══ */
.wr-section{position:relative;min-height:100vh;width:100%;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;padding:3rem 2rem;box-sizing:border-box;overflow:hidden;font-family:Montserrat,sans-serif;isolation:isolate}
.wr-center{align-items:center;text-align:center}

/* ═══ Content z-index (above patterns & images) ═══ */
.wr-anim{position:relative;z-index:1}
.wr-lb-list{position:relative;z-index:1}

/* ═══ Decorative Patterns (fine grain, visible) ═══ */
[data-pattern="dots"]::before{content:'';position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,0.28) 1px,transparent 1px);background-size:14px 14px;pointer-events:none;z-index:0}
[data-pattern="circles"]::before{content:'';position:absolute;top:-20%;right:-15%;width:60vw;height:60vw;border-radius:50%;border:3px solid rgba(0,0,0,0.28);pointer-events:none;z-index:0}
[data-pattern="circles"]::after{content:'';position:absolute;bottom:-25%;left:-20%;width:45vw;height:45vw;border-radius:50%;border:3px solid rgba(0,0,0,0.22);pointer-events:none;z-index:0}
[data-pattern="stripes"]::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(135deg,transparent,transparent 14px,rgba(255,255,255,0.18) 14px,rgba(255,255,255,0.18) 16px);pointer-events:none;z-index:0}
[data-pattern="squares"]::before{content:'';position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,0.18) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.18) 1px,transparent 1px);background-size:22px 22px;pointer-events:none;z-index:0}
[data-pattern="waves"]::before{content:'';position:absolute;bottom:0;left:0;right:0;height:160px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 120'%3E%3Cpath fill='rgba(0,0,0,0.18)' d='M0,40 C360,120 720,0 1080,80 C1260,110 1380,60 1440,40 L1440,120 L0,120Z'/%3E%3C/svg%3E");background-size:cover;pointer-events:none;z-index:0}
[data-pattern="lines"]::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(255,255,255,0.08) 18px,rgba(255,255,255,0.08) 19px);pointer-events:none;z-index:0}
[data-pattern="scattered"]::before{content:'';position:absolute;inset:0;background:radial-gradient(circle 4px at 10% 12%,rgba(0,0,0,0.3) 100%,transparent 100%),radial-gradient(circle 3px at 30% 45%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 5px at 55% 20%,rgba(0,0,0,0.28) 100%,transparent 100%),radial-gradient(circle 3px at 75% 65%,rgba(0,0,0,0.22) 100%,transparent 100%),radial-gradient(circle 4px at 45% 80%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 3.5px at 85% 35%,rgba(0,0,0,0.26) 100%,transparent 100%),radial-gradient(circle 3px at 20% 70%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 65% 90%,rgba(0,0,0,0.24) 100%,transparent 100%),radial-gradient(circle 2.5px at 5% 55%,rgba(0,0,0,0.18) 100%,transparent 100%),radial-gradient(circle 3px at 92% 80%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 40% 30%,rgba(0,0,0,0.15) 100%,transparent 100%),radial-gradient(circle 2px at 68% 50%,rgba(0,0,0,0.17) 100%,transparent 100%);pointer-events:none;z-index:0}
[data-pattern="waves"]::before{content:'';position:absolute;bottom:0;left:0;right:0;height:160px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 120'%3E%3Cpath fill='rgba(255,255,255,0.18)' d='M0,40 C360,120 720,0 1080,80 C1260,110 1380,60 1440,40 L1440,120 L0,120Z'/%3E%3C/svg%3E");background-size:cover;pointer-events:none;z-index:0}
[data-pattern="waves"]::after{content:'';position:absolute;top:0;left:0;right:0;height:160px;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 120'%3E%3Cpath fill='rgba(255,255,255,0.12)' d='M0,80 C360,0 720,120 1080,40 C1260,10 1380,60 1440,80 L1440,0 L0,0Z'/%3E%3C/svg%3E");background-size:cover;pointer-events:none;z-index:0}

/* Light-theme pattern overrides (dark colors on light bg) */
[data-theme="light"][data-pattern="dots"]::before{background:radial-gradient(circle,rgba(0,0,0,0.2) 1px,transparent 1px);background-size:14px 14px}
[data-theme="light"][data-pattern="stripes"]::before{background:repeating-linear-gradient(135deg,transparent,transparent 14px,rgba(0,0,0,0.16) 14px,rgba(0,0,0,0.16) 16px)}
[data-theme="light"][data-pattern="squares"]::before{background:linear-gradient(rgba(0,0,0,0.15) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.15) 1px,transparent 1px);background-size:22px 22px}
[data-theme="light"][data-pattern="lines"]::before{background:repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(0,0,0,0.07) 18px,rgba(0,0,0,0.07) 19px)}
[data-theme="light"][data-pattern="scattered"]::before{background:radial-gradient(circle 4px at 10% 12%,rgba(0,0,0,0.3) 100%,transparent 100%),radial-gradient(circle 3px at 30% 45%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 5px at 55% 20%,rgba(0,0,0,0.28) 100%,transparent 100%),radial-gradient(circle 3px at 75% 65%,rgba(0,0,0,0.22) 100%,transparent 100%),radial-gradient(circle 4px at 45% 80%,rgba(0,0,0,0.25) 100%,transparent 100%),radial-gradient(circle 3.5px at 85% 35%,rgba(0,0,0,0.26) 100%,transparent 100%),radial-gradient(circle 3px at 20% 70%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 65% 90%,rgba(0,0,0,0.24) 100%,transparent 100%),radial-gradient(circle 2.5px at 5% 55%,rgba(0,0,0,0.18) 100%,transparent 100%),radial-gradient(circle 3px at 92% 80%,rgba(0,0,0,0.2) 100%,transparent 100%),radial-gradient(circle 4px at 40% 30%,rgba(0,0,0,0.15) 100%,transparent 100%),radial-gradient(circle 2px at 68% 50%,rgba(0,0,0,0.17) 100%,transparent 100%)}
/* Red background with lighter lines pattern */
[style*="background-color: rgb(226, 33, 52)"][data-pattern="lines"]::before{background:repeating-linear-gradient(0deg,transparent,transparent 18px,rgba(255,255,255,0.12) 18px,rgba(255,255,255,0.12) 19px)}

/* ═══ Close & Share (fixed) ═══ */
.wr-close{position:fixed;top:16px;right:16px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:rgba(255,255,255,0.7);cursor:pointer;z-index:1000;border-radius:50%;background:rgba(0,0,0,0.4);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:all 0.2s}
.wr-close:hover{color:#fff;background:rgba(0,0,0,0.6)}
.wr-share-fab{position:fixed;bottom:24px;right:20px;width:50px;height:50px;display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;z-index:1001;border-radius:50%;background:${C.green};box-shadow:0 4px 20px rgba(29,185,84,0.4);transition:all 0.2s}
.wr-share-fab:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(29,185,84,0.5)}
.wr-share-fab:active{transform:scale(0.95)}

/* ═══ Typography ═══ */
.wr-logo-text{font-size:0.85rem;font-weight:900;letter-spacing:0.25em;opacity:0.5;text-transform:uppercase}
.wr-year-big{font-size:clamp(3.5rem,12vw,6rem);font-weight:900;line-height:1;margin:0.5rem 0;color:${C.green};text-shadow:0 0 60px rgba(29,185,84,0.25)}
.wr-username{font-size:1.2rem;font-weight:500;opacity:0.6}
.wr-scroll-hint{display:flex;flex-direction:column;align-items:center;gap:0.3rem;font-size:0.8rem;font-weight:500;opacity:0.3;margin-top:3rem;animation:wr-bounce 2s ease-in-out infinite}
@keyframes wr-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(8px)}}
.wr-section-label{font-size:clamp(0.85rem,2.5vw,1.05rem);font-weight:500;text-transform:uppercase;letter-spacing:0.12em;opacity:0.65}
.wr-section-label-small{font-size:clamp(0.65rem,2vw,0.85rem);font-weight:500;text-transform:uppercase;letter-spacing:0.12em;opacity:0.5;margin-bottom:0.5rem}
.wr-mega-num{font-size:clamp(7rem,28vw,14rem);font-weight:900;line-height:0.85;margin:0.3rem 0;letter-spacing:-0.04em}
.wr-stat-pill{font-size:0.9rem;font-weight:500;opacity:0.6;padding:0.6rem 1.4rem;border-radius:50px;background:rgba(255,255,255,0.1)}

/* ═══ Stats Row ═══ */
.wr-stats-row{display:flex;gap:2rem;margin:1.5rem 0;justify-content:center;flex-wrap:wrap;position:relative;z-index:1}
.wr-stat-block{text-align:center}
.wr-stat-big{font-size:clamp(5rem,18vw,9rem);font-weight:900;line-height:0.9;letter-spacing:-0.03em}
.wr-stat-tag{font-size:0.85rem;font-weight:500;text-transform:uppercase;letter-spacing:0.15em;opacity:0.55;margin-top:0.3rem}

/* ═══ Full-bleed images ═══ */
.wr-hero-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 20%;z-index:0;opacity:0}
.wr-hero-color-overlay{position:absolute;inset:0;z-index:0}

/* ═══ Track / Artist names ═══ */
.wr-track-name{font-size:clamp(2rem,7vw,3.5rem);font-weight:900;line-height:1.1;margin:0.5rem 0}
.wr-artist-sub{font-size:clamp(1rem,3.5vw,1.5rem);font-weight:500;opacity:0.6}
.wr-artist-hero{font-size:clamp(2.5rem,9vw,5rem);font-weight:900;line-height:1;margin:0.5rem 0}
.wr-genre-name{font-size:clamp(3.5rem,14vw,7.5rem);font-weight:900;line-height:1;margin:0.5rem 0;text-transform:capitalize}
.wr-genre-name-big{font-size:clamp(5rem,18vw,9rem);font-weight:900;line-height:1;margin:0.8rem 0;text-transform:capitalize}
.wr-play-count{font-size:0.8rem;font-weight:400;opacity:0.4;margin-top:0.5rem;letter-spacing:0.05em}
.wr-date-pill{font-size:0.85rem;font-weight:500;opacity:0.45;margin-top:1.2rem;padding:0.5rem 1.2rem;border-radius:50px;background:rgba(255,255,255,0.08)}

/* ═══ Genre Bars ═══ */
.wr-genre-bars{width:100%;max-width:260px;margin-top:1.8rem}
.wr-genre-bar{margin-bottom:0.7rem}
.wr-genre-bar-info{display:flex;justify-content:space-between;font-size:0.7rem;font-weight:500;margin-bottom:0.25rem;opacity:0.7}
.wr-genre-bar-name{text-transform:capitalize}
.wr-genre-bar-plays{opacity:0.5}
.wr-genre-bar-track{height:4px;border-radius:2px;background:rgba(0,0,0,0.12);overflow:hidden}
.wr-genre-bar-fill{height:100%;border-radius:2px;background:currentColor;opacity:0.5;transition:width 1.5s ease-out}

/* ═══ Personality ═══ */
.wr-personality-name{font-size:clamp(2.2rem,8vw,3.5rem);font-weight:900;line-height:1.15;margin:0.5rem 0;color:${C.lavender}}
.wr-personality-desc{font-size:0.9rem;font-weight:500;opacity:0.55;line-height:1.7;max-width:320px;margin-top:1rem;position:relative;z-index:1}

/* ═══ Outro ═══ */
.wr-outro-title{font-size:clamp(2.5rem,8vw,4rem);font-weight:900;line-height:1.1}

/* ═══ Avatar ═══ */
.wr-avatar-ring-sp{width:88px;height:88px;border-radius:50%;padding:3px;background:${C.green}}
.wr-avatar-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}

/* ═══ Top 5 Artists & Albums ═══ */
.wr-top5-list{display:flex;flex-direction:column;gap:0.8rem;width:100%;max-width:360px;margin-top:2rem}
.wr-top5-item{display:flex;align-items:center;gap:1rem;padding:0.8rem;background:rgba(255,255,255,0.08);border-radius:16px;transition:all 0.3s;backdrop-filter:blur(8px)}
.wr-top5-item:hover{background:rgba(255,255,255,0.12);transform:translateX(4px)}
.wr-top5-rank{font-size:1.8rem;font-weight:900;min-width:40px;opacity:0.4;text-align:center}
.wr-top5-img{width:64px;height:64px;border-radius:12px;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.3)}
.wr-top5-img-placeholder{width:64px;height:64px;border-radius:12px;background:rgba(255,255,255,0.1)}
.wr-top5-info{flex:1;display:flex;flex-direction:column;gap:0.2rem}
.wr-top5-name{font-size:1.1rem;font-weight:700;line-height:1.2}
.wr-top5-artist{font-size:0.85rem;font-weight:500;opacity:0.6}
.wr-top5-plays{font-size:0.75rem;font-weight:500;opacity:0.4;margin-top:0.2rem}

/* ═══ Leaderboard ═══ */
.wr-lb-list{display:flex;flex-direction:column;gap:0.5rem;padding:0 0.5rem;max-height:55vh;overflow-y:auto}
.wr-lb-row{display:flex;align-items:center;gap:0.7rem;padding:0.7rem 1rem;background:rgba(255,255,255,0.05);border-radius:12px;transition:background 0.2s}
.wr-lb-row:hover{background:rgba(255,255,255,0.08)}
.wr-lb-rank{font-weight:900;font-size:0.9rem;min-width:30px}
.wr-lb-avatar{width:34px;height:34px;border-radius:50%}
.wr-lb-name{flex:1;font-size:0.9rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wr-lb-stat{font-size:0.75rem;font-weight:500;opacity:0.4}

/* ═══ Buttons ═══ */
.wr-btn-sp{display:inline-block;padding:0.8rem 2.2rem;border-radius:50px;font-size:0.9rem;font-weight:700;cursor:pointer;border:none;text-decoration:none;text-align:center;font-family:Montserrat,sans-serif;transition:all 0.2s;color:#fff}
.wr-btn-sp-primary{background:${C.green};color:${C.black}}
.wr-btn-sp-primary:hover{background:${C.greenDk};transform:scale(1.03)}
.wr-btn-sp-outline{background:transparent;border:2px solid rgba(255,255,255,0.3)}
.wr-btn-sp-outline:hover{border-color:rgba(255,255,255,0.6)}
.wr-btn-sp-ghost{background:transparent;color:rgba(255,255,255,0.5)}
.wr-btn-sp-ghost:hover{color:rgba(255,255,255,0.8)}

/* ═══ Confetti ═══ */
.wr-confetti-dot{position:absolute;top:0;pointer-events:none;z-index:2}

/* ═══ Share Card ═══ */
.wr-share-card{font-family:Montserrat,sans-serif;color:#fff;overflow:hidden;border-radius:20px}
.wr-sc-bg{position:absolute;inset:0;background:linear-gradient(135deg,${C.green} 0%,${C.magenta} 100%)}
.wr-sc-content{position:relative;z-index:1;padding:2rem;display:flex;flex-direction:column;align-items:center;text-align:center;height:100%;box-sizing:border-box;justify-content:center}
.wr-sc-logo{font-size:0.7rem;font-weight:900;letter-spacing:0.2em;text-transform:uppercase;opacity:0.7;margin-bottom:0.3rem}
.wr-sc-year{font-size:1.8rem;font-weight:900;margin-bottom:1rem}
.wr-sc-avatar{width:56px;height:56px;border-radius:50%;overflow:hidden;margin-bottom:0.5rem;border:2px solid rgba(255,255,255,0.3)}
.wr-sc-avatar img{width:100%;height:100%;object-fit:cover}
.wr-sc-name{font-size:1rem;font-weight:700;margin-bottom:1.2rem}
.wr-sc-stats{display:flex;gap:2rem;margin-bottom:1.2rem}
.wr-sc-stat{text-align:center}
.wr-sc-num{display:block;font-size:2rem;font-weight:900}
.wr-sc-label{font-size:0.65rem;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;opacity:0.7}
.wr-sc-row{display:flex;justify-content:space-between;width:100%;max-width:280px;padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.15);font-size:0.8rem}
.wr-sc-tag{font-weight:500;opacity:0.7}
.wr-sc-val{font-weight:900}

/* ═══ Responsive ═══ */
@media(max-width:380px){
  .wr-mega-num{font-size:clamp(5rem,22vw,8rem)}
  .wr-stat-big{font-size:clamp(4rem,16vw,7rem)}
  .wr-section{padding:2rem 1.2rem}
  .wr-stats-row{gap:1.2rem}
  .wr-genre-name{font-size:clamp(2.2rem,9vw,4rem)}
  .wr-artist-hero{font-size:clamp(2rem,8vw,3.5rem)}
}
  `;
  document.head.appendChild(style);
}
