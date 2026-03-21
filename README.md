<p align="center">
  <img src="public/assets/tunes-logo.png" alt="Tunes" width="120" />
</p>

<h1 align="center">Tunes</h1>

<p align="center">
  A lossless music streaming PWA with offline playback, lyrics, and an Android app.
</p>

<p align="center">
  <strong>v1.1.4</strong>
</p>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, HTML, CSS |
| Bundler | Vite |
| Hosting | Cloudflare Pages |
| API Proxy | Cloudflare Workers |
| Auth & Database | Supabase |
| Android | Capacitor |
| Streaming | DASH (dashjs) |
| Lyrics | LRC + Apple Music word-synced |

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Production build
npm run build

# Deploy (web + worker)
npm run deploy
```

## Android Build

```bash
# Sync web assets into the Android project
npx cap sync android

# Build debug APK
cd android
./gradlew assembleDebug

# APK output location:
# android/app/build/outputs/apk/debug/app-debug.apk
```

## Project Structure

```
tunes/
├── js/                     App source code
│   ├── app.js              Entry point, routing, player init
│   ├── api.js              Lossless API client (search, albums, tracks, streaming)
│   ├── player.js           Audio player (DASH, queue, crossfade)
│   ├── ui.js               UI renderer (pages, cards, lists)
│   ├── lyrics.js           Lyrics display (synced, word-level)
│   ├── downloads.js        Offline download manager
│   ├── router.js           Client-side router
│   ├── cache.js            API response cache (memory + IndexedDB)
│   ├── db.js               IndexedDB wrapper
│   ├── storage.js          Settings, instances, speed testing
│   ├── networkMonitor.js   Online/offline detection
│   └── accounts/           Supabase auth, sync, profiles
├── worker/                 Cloudflare Worker (API proxy, lyrics, admin)
├── functions/              Cloudflare Pages Functions (SSR metadata)
├── public/                 Static assets (fonts, icons, manifest)
├── android/                Capacitor Android project
├── supabase/
│   └── migrations/         Database migrations (run in order)
├── docs/                   Setup guides
├── scripts/                Build utilities
├── index.html              Main app shell
├── styles.css              Global styles
├── vite.config.js          Vite + PWA config
├── wrangler.toml           Cloudflare Worker config
└── capacitor.config.ts     Capacitor config
```

## Database Setup

Run the SQL migrations in `supabase/migrations/` in numeric order against your Supabase project:

```
001_setup.sql
002_v2.sql
003_v3-admin.sql
004_v4-messaging.sql
005_v5-database-control.sql
006_v5-version-targeting.sql
007_telegram-archive.sql
```

## Documentation

- [Setup & Build Guide](docs/SETUP_GUIDE.md) -- full setup walkthrough (Google Cloud, keystore, build)
- [Google Sign-In Setup](docs/GOOGLE_SIGNIN_SETUP.md) -- Android OAuth configuration

## Deploy

| Target | Command |
|--------|---------|
| Web (Cloudflare Pages) | `npm run deploy:pages` |
| Worker (Cloudflare Workers) | `npm run deploy:worker` |
| Both | `npm run deploy` |

## License

Private. All rights reserved.
