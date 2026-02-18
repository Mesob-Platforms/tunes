import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
// @ts-expect-error - wrangler injects this module
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

const assetManifest = JSON.parse(manifestJSON);

const ADMIN_EMAIL = 'naolmideksa@gmail.com';
const PREVIEW_EMAILS = [ADMIN_EMAIL, 'naolmid.official@gmail.com', 'naolmideksa@gmail.com'];
const SUPABASE_URL = 'https://qkdcloplojidvscgzfxq.supabase.co';

interface Env {
  __STATIC_CONTENT: KVNamespace;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  AI: any; // Workers AI binding
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

/** Verify the request comes from the admin user */
async function verifyAdmin(request: Request, env: Env): Promise<{ valid: boolean; error?: string }> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return { valid: false, error: 'Server not configured (missing service role key)' };
  }
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing authorization' };
  }
  const token = authHeader.substring(7);
  // Verify the user's JWT by calling Supabase auth
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!res.ok) return { valid: false, error: 'Invalid session' };
  const user: any = await res.json();
  if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
    return { valid: false, error: 'Not admin' };
  }
  return { valid: true };
}

/** Supabase admin headers (using service-role key) */
function adminHeaders(env: Env) {
  return {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/* ══════════════════════════════════════════════════════════════
   TELEGRAM BOT API HELPERS
   ══════════════════════════════════════════════════════════════ */

const TG_API = 'https://api.telegram.org/bot';

/** Send a document (file) to a Telegram chat */
async function tgSendDocument(env: Env, fileBlob: Blob, filename: string, caption?: string): Promise<any> {
  const form = new FormData();
  form.append('chat_id', env.TELEGRAM_CHAT_ID);
  form.append('document', fileBlob, filename);
  if (caption) form.append('caption', caption.substring(0, 1024));
  const res = await fetch(`${TG_API}${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
  return res.json();
}

/** Get file info from Telegram (for retrieval) */
async function tgGetFile(env: Env, fileId: string): Promise<any> {
  const res = await fetch(`${TG_API}${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
  return res.json();
}

/** Download a file from Telegram */
async function tgDownloadFile(env: Env, filePath: string): Promise<Response> {
  return fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
}

/** Test Telegram bot connection by calling getMe */
async function tgTestConnection(env: Env): Promise<{ ok: boolean; bot_name?: string; error?: string }> {
  try {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      return { ok: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured' };
    }
    const res = await fetch(`${TG_API}${env.TELEGRAM_BOT_TOKEN}/getMe`);
    const data: any = await res.json();
    if (!data.ok) return { ok: false, error: data.description || 'Bot API error' };
    return { ok: true, bot_name: data.result?.username || 'unknown' };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/* ══════════════════════════════════════════════════════════════
   ARCHIVE LOGIC — export data to JSON and send to Telegram
   ══════════════════════════════════════════════════════════════ */

async function performArchive(env: Env): Promise<{ success: boolean; rows: number; error?: string }> {
  const hdrs = adminHeaders(env);

  // 1. Find the last successful archive date
  const idxRes = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_archive_index?select=date_to&status=eq.completed&order=date_to.desc&limit=1`,
    { headers: hdrs }
  );
  const idxData: any[] = idxRes.ok ? await idxRes.json() : [];
  const lastArchiveDate = idxData[0]?.date_to || null;

  // 2. Fetch listening events since last archive (up to 50k)
  let evtUrl = `${SUPABASE_URL}/rest/v1/listening_events?select=*&order=listened_at.asc&limit=50000`;
  if (lastArchiveDate) {
    evtUrl += `&listened_at=gt.${encodeURIComponent(lastArchiveDate)}`;
  }
  const evtRes = await fetch(evtUrl, { headers: hdrs });
  if (!evtRes.ok) return { success: false, rows: 0, error: `Failed to fetch events: ${evtRes.status}` };
  const events: any[] = await evtRes.json();

  if (events.length === 0) return { success: true, rows: 0 };

  // 3. Package as JSON
  const dateFrom = events[0].listened_at;
  const dateTo = events[events.length - 1].listened_at;
  const jsonStr = JSON.stringify(events, null, 0);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const sizeKb = Math.round(blob.size / 1024);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `tunes-archive-${ts}.json`;

  // 4. Send to Telegram
  const caption = `📦 Tunes Archive\n${events.length} events | ${sizeKb} KB\n${dateFrom} → ${dateTo}`;
  const tgResult = await tgSendDocument(env, blob, filename, caption);

  if (!tgResult.ok) {
    // Record failed attempt
    await fetch(`${SUPABASE_URL}/rest/v1/telegram_archive_index`, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({
        archive_type: 'listening_events',
        row_count: events.length,
        file_size_kb: sizeKb,
        date_from: dateFrom,
        date_to: dateTo,
        status: 'failed',
        error_message: tgResult.description || 'Telegram send failed',
      }),
    });
    return { success: false, rows: events.length, error: tgResult.description || 'Telegram send failed' };
  }

  // 5. Record success in archive index
  const doc = tgResult.result?.document;
  await fetch(`${SUPABASE_URL}/rest/v1/telegram_archive_index`, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify({
      archive_type: 'listening_events',
      row_count: events.length,
      file_size_kb: sizeKb,
      date_from: dateFrom,
      date_to: dateTo,
      telegram_file_id: doc?.file_id || null,
      telegram_msg_id: tgResult.result?.message_id || null,
      status: 'completed',
    }),
  });

  return { success: true, rows: events.length };
}

/* ══════════════════════════════════════════════════════════════
   ADMIN ENDPOINTS — db-stats, telegram/test, archive/*
   ══════════════════════════════════════════════════════════════ */

/** GET /api/admin/db-stats — database statistics */
async function handleDbStats(env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_database_stats`, {
    method: 'POST',
    headers: hdrs,
    body: '{}',
  });
  if (!rpcRes.ok) {
    const err = await rpcRes.text().catch(() => 'unknown');
    return Response.json({ error: `RPC failed: ${err}` }, { status: 500, headers: CORS_HEADERS });
  }
  const stats = await rpcRes.json();
  return Response.json(stats, { headers: CORS_HEADERS });
}

/** POST /api/admin/telegram/test — test bot connection */
async function handleTelegramTest(env: Env): Promise<Response> {
  const result = await tgTestConnection(env);
  return Response.json(result, { headers: CORS_HEADERS });
}

/** POST /api/admin/archive/trigger — manually trigger archive */
async function handleArchiveTrigger(env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return Response.json({ error: 'Telegram not configured' }, { status: 400, headers: CORS_HEADERS });
  }
  const result = await performArchive(env);
  return Response.json(result, { headers: CORS_HEADERS });
}

/** GET /api/admin/archive/history — archive history list */
async function handleArchiveHistory(env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_archive_index?select=*&order=created_at.desc&limit=50`,
    { headers: hdrs }
  );
  const data: any[] = res.ok ? await res.json() : [];
  return Response.json(data, { headers: CORS_HEADERS });
}

/** POST /api/admin/archive/retrieve — download an archive from Telegram */
async function handleArchiveRetrieve(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  const fileId = body.file_id;
  if (!fileId) return Response.json({ error: 'Missing file_id' }, { status: 400, headers: CORS_HEADERS });

  const fileInfo = await tgGetFile(env, fileId);
  if (!fileInfo.ok) return Response.json({ error: fileInfo.description || 'getFile failed' }, { status: 500, headers: CORS_HEADERS });

  const filePath = fileInfo.result.file_path;
  const fileRes = await tgDownloadFile(env, filePath);
  if (!fileRes.ok) return Response.json({ error: 'Download failed' }, { status: 500, headers: CORS_HEADERS });

  const data = await fileRes.json();
  return Response.json(data, { headers: CORS_HEADERS });
}

/** GET /api/admin/users — list all users from auth.users + profiles + play counts */
async function handleListUsers(env: Env): Promise<Response> {
  const headers = adminHeaders(env);

  // 1. Get all auth users (up to 100)
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=100`, { headers });
  if (!authRes.ok) {
    const err: any = await authRes.json().catch(() => ({}));
    return Response.json({ error: err.message || 'Failed to list auth users' }, { status: 500, headers: CORS_HEADERS });
  }
  const authData: any = await authRes.json();
  const authUsers: any[] = authData.users || [];

  // 2. Get all profiles (service-role bypasses RLS)
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=user_id,display_name,avatar_seed`, { headers });
  const profiles: any[] = profRes.ok ? await profRes.json() : [];
  const profileMap: Record<string, any> = {};
  for (const p of profiles) profileMap[p.user_id] = p;

  // 3. Get play counts from listening_events
  const evtRes = await fetch(`${SUPABASE_URL}/rest/v1/listening_events?select=user_id`, { headers });
  const events: any[] = evtRes.ok ? await evtRes.json() : [];
  const playCounts: Record<string, number> = {};
  for (const e of events) playCounts[e.user_id] = (playCounts[e.user_id] || 0) + 1;

  // 4. Filter out users who haven't confirmed their email
  const confirmedUsers = authUsers.filter((u: any) => u.email_confirmed_at);

  // 5. Build combined response
  const users = confirmedUsers.map((u: any) => ({
    user_id: u.id,
    email: u.email || null,
    display_name: profileMap[u.id]?.display_name || null,
    avatar_seed: profileMap[u.id]?.avatar_seed || u.id,
    total_plays: playCounts[u.id] || 0,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
  }));
  users.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return Response.json(users, { headers: CORS_HEADERS });
}

/** POST /api/admin/user-summary — get detailed user stats */
async function handleUserSummary(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  const userId = body.user_id;
  if (!userId) return Response.json({ error: 'Missing user_id' }, { status: 400, headers: CORS_HEADERS });

  const headers = adminHeaders(env);

  // Get auth user info
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers });
  const authUser: any = authRes.ok ? await authRes.json() : null;

  // Get profile
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=*&user_id=eq.${userId}`, { headers });
  const profiles: any[] = profRes.ok ? await profRes.json() : [];
  const profile = profiles[0] || null;

  // Get listening events
  const evtRes = await fetch(
    `${SUPABASE_URL}/rest/v1/listening_events?select=track_title,artist_name,album_title,genre,listened_at&user_id=eq.${userId}&order=listened_at.desc`,
    { headers }
  );
  const events: any[] = evtRes.ok ? await evtRes.json() : [];

  // Aggregate stats
  const artistCounts: Record<string, number> = {};
  const trackCounts: Record<string, { title: string; artist: string; count: number }> = {};
  const genreCounts: Record<string, number> = {};
  const uniqueArtists = new Set<string>();
  const uniqueTracks = new Set<string>();

  for (const e of events) {
    if (e.artist_name) { artistCounts[e.artist_name] = (artistCounts[e.artist_name] || 0) + 1; uniqueArtists.add(e.artist_name); }
    if (e.track_title) {
      const key = `${e.track_title}|||${e.artist_name}`;
      if (!trackCounts[key]) trackCounts[key] = { title: e.track_title, artist: e.artist_name, count: 0 };
      trackCounts[key].count++;
      uniqueTracks.add(key);
    }
    if (e.genre) genreCounts[e.genre] = (genreCounts[e.genre] || 0) + 1;
  }

  const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, plays]) => ({ artist_name: name, plays }));
  const topTracks = Object.values(trackCounts).sort((a, b) => b.count - a.count).slice(0, 5).map(t => ({ track_title: t.title, artist_name: t.artist, plays: t.count }));
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([genre, plays]) => ({ genre, plays }));

  return Response.json({
    user_id: userId,
    email: authUser?.email || null,
    display_name: profile?.display_name || null,
    avatar_seed: profile?.avatar_seed || userId,
    total_plays: events.length,
    unique_tracks: uniqueTracks.size,
    unique_artists: uniqueArtists.size,
    first_listen: events.length ? events[events.length - 1].listened_at : null,
    last_listen: events.length ? events[0].listened_at : null,
    top_artists: topArtists,
    top_tracks: topTracks,
    top_genres: topGenres,
    created_at: authUser?.created_at || null,
    last_sign_in_at: authUser?.last_sign_in_at || null,
  }, { headers: CORS_HEADERS });
}

/** GET /api/admin/dashboard-stats — rich analytics for admin dashboard */
async function handleDashboardStats(env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);

  // Fetch ALL listening events with timestamps (up to 50k)
  const evtRes = await fetch(
    `${SUPABASE_URL}/rest/v1/listening_events?select=user_id,track_title,artist_name,genre,listened_at,duration_sec&order=listened_at.desc&limit=50000`,
    { headers: hdrs }
  );
  const events: any[] = evtRes.ok ? await evtRes.json() : [];

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const prevWeekStart = new Date(now.getTime() - 14 * 86400000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 3600000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  let playsToday = 0;
  let playsYesterday = 0;
  let playsThisWeek = 0;
  let playsPrevWeek = 0;
  const peakHours = new Array(24).fill(0);
  const genreCounts: Record<string, number> = {};
  const trending48hArtists: Record<string, number> = {};
  const trending48hTracks: Record<string, { title: string; artist: string; count: number }> = {};
  const dailyPlays: Record<string, number> = {};
  const weeklyActiveUsers = new Set<string>();
  const todayActiveUsers = new Set<string>();
  let totalMinutes = 0;

  for (const e of events) {
    const listenedAt = new Date(e.listened_at);
    const dayStr = e.listened_at.slice(0, 10);

    if (dayStr === todayStr) { playsToday++; todayActiveUsers.add(e.user_id); }
    if (dayStr === yesterdayStr) playsYesterday++;
    if (listenedAt >= weekAgo) { playsThisWeek++; weeklyActiveUsers.add(e.user_id); }
    if (listenedAt >= prevWeekStart && listenedAt < weekAgo) playsPrevWeek++;

    peakHours[listenedAt.getHours()]++;
    if (e.genre) genreCounts[e.genre] = (genreCounts[e.genre] || 0) + 1;

    if (listenedAt >= fortyEightHoursAgo) {
      if (e.artist_name) trending48hArtists[e.artist_name] = (trending48hArtists[e.artist_name] || 0) + 1;
      if (e.track_title) {
        const key = `${e.track_title}|||${e.artist_name}`;
        if (!trending48hTracks[key]) trending48hTracks[key] = { title: e.track_title, artist: e.artist_name, count: 0 };
        trending48hTracks[key].count++;
      }
    }

    if (listenedAt >= thirtyDaysAgo) dailyPlays[dayStr] = (dailyPlays[dayStr] || 0) + 1;
    totalMinutes += Math.round((e.duration_sec || 0) / 60);
  }

  const trendingArtists = Object.entries(trending48hArtists).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, plays]) => ({ name, plays }));
  const trendingTracks = Object.values(trending48hTracks).sort((a, b) => b.count - a.count).slice(0, 10).map(t => ({ title: t.title, artist: t.artist, plays: t.count }));
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([genre, plays]) => ({ genre, plays }));
  const dailyPlaysArr = Object.entries(dailyPlays).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

  return Response.json({
    plays_today: playsToday,
    plays_yesterday: playsYesterday,
    plays_this_week: playsThisWeek,
    plays_prev_week: playsPrevWeek,
    active_today: todayActiveUsers.size,
    active_this_week: weeklyActiveUsers.size,
    total_events: events.length,
    total_minutes: totalMinutes,
    peak_hours: peakHours,
    genre_breakdown: topGenres,
    trending_artists_48h: trendingArtists,
    trending_tracks_48h: trendingTracks,
    daily_plays_30d: dailyPlaysArr,
  }, { headers: CORS_HEADERS });
}

/** POST /api/admin/user-ai-review — AI-generated personality review */
async function handleUserAiReview(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return Response.json({ error: 'AI binding not configured' }, { status: 500, headers: CORS_HEADERS });

  const body: any = await request.json();
  const { display_name, top_artists, top_tracks, top_genres, total_plays, unique_artists, unique_tracks } = body;
  if (!display_name) return Response.json({ error: 'Missing user data' }, { status: 400, headers: CORS_HEADERS });

  const artistList = (top_artists || []).map((a: any) => `${a.artist_name || a.name} (${a.plays} plays)`).join(', ');
  const trackList = (top_tracks || []).map((t: any) => `"${t.track_title || t.title}" by ${t.artist_name || t.artist} (${t.plays} plays)`).join(', ');
  const genreList = (top_genres || []).map((g: any) => `${g.genre} (${g.plays})`).join(', ');

  const prompt = `You are a witty, sharp music critic with a Gen-Z sense of humor. Write a SHORT (3-4 sentences max) personality review of a music listener based on their data. Be creative, funny, slightly roasting but affectionate. Reference specific artists/songs they listen to.

User: ${display_name}
Total plays: ${total_plays || 0}
Unique artists: ${unique_artists || 0}
Unique tracks: ${unique_tracks || 0}
Top artists: ${artistList || 'none yet'}
Top tracks: ${trackList || 'none yet'}
Top genres: ${genreList || 'unknown'}

Write ONLY the review text. No quotes, no labels, no markdown. Just the personality roast/review in 3-4 punchy sentences.`;

  try {
    const aiResponse: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.8,
    });
    const review = (aiResponse.response || '').trim();
    return Response.json({ review }, { headers: CORS_HEADERS });
  } catch (err: any) {
    return Response.json({ error: err.message || 'AI failed' }, { status: 500, headers: CORS_HEADERS });
  }
}

/** POST /api/admin/delete-user — delete a user and all their data */
async function handleDeleteUser(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  const userId = body.user_id;
  if (!userId) return Response.json({ error: 'Missing user_id' }, { status: 400, headers: CORS_HEADERS });

  const headers = adminHeaders(env);

  // Delete from auth.users — FK CASCADE will clean up user_profiles, listening_events, user_data, etc.
  const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers,
  });

  if (!delRes.ok) {
    const err: any = await delRes.json().catch(() => ({}));
    return Response.json({ error: err.msg || err.message || 'Failed to delete user' }, { status: 500, headers: CORS_HEADERS });
  }

  return Response.json({ success: true }, { headers: CORS_HEADERS });
}

/* ══════════════════════════════════════════════════════════════
   UPDATES & ANNOUNCEMENTS ENDPOINTS (v2 — Messaging Overhaul)
   ══════════════════════════════════════════════════════════════ */

/** POST /api/admin/updates — create a new update */
async function handleCreateUpdate(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  if (!body.title) return Response.json({ error: 'Title is required' }, { status: 400, headers: CORS_HEADERS });
  const hdrs = adminHeaders(env);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_updates`, {
    method: 'POST',
    headers: { ...hdrs, 'Prefer': 'return=representation' },
    body: JSON.stringify({
      title: body.title,
      message: body.message || null,
      link: body.link || null,
      category: body.category || 'feature',
      is_active: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    return Response.json({ error: `Insert failed: ${err}` }, { status: 500, headers: CORS_HEADERS });
  }
  const data = await res.json();
  return Response.json(data, { headers: CORS_HEADERS });
}

/** POST /api/admin/updates/edit — edit an existing update */
async function handleEditUpdate(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  if (!body.id) return Response.json({ error: 'Missing id' }, { status: 400, headers: CORS_HEADERS });
  const hdrs = adminHeaders(env);
  const payload: any = {};
  if (body.title !== undefined) payload.title = body.title;
  if (body.message !== undefined) payload.message = body.message;
  if (body.link !== undefined) payload.link = body.link;
  if (body.category !== undefined) payload.category = body.category;
  if (body.is_active !== undefined) payload.is_active = body.is_active;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_updates?id=eq.${body.id}`, {
    method: 'PATCH',
    headers: { ...hdrs, 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    return Response.json({ error: `Update failed: ${err}` }, { status: 500, headers: CORS_HEADERS });
  }
  const data = await res.json();
  return Response.json(data, { headers: CORS_HEADERS });
}

/** GET /api/admin/updates — list all updates (admin) with tracking stats */
async function handleListUpdates(env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  const [updatesRes, trackingRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/admin_updates?select=*&order=created_at.desc`, { headers: hdrs }),
    fetch(`${SUPABASE_URL}/rest/v1/admin_tracking?select=item_id,event_type&item_type=eq.update`, { headers: hdrs }),
  ]);
  const updates: any[] = updatesRes.ok ? await updatesRes.json() : [];
  const tracking: any[] = trackingRes.ok ? await trackingRes.json() : [];
  // Aggregate stats per update
  const statsMap: Record<string, { impressions: number; clicks: number }> = {};
  for (const t of tracking) {
    if (!statsMap[t.item_id]) statsMap[t.item_id] = { impressions: 0, clicks: 0 };
    if (t.event_type === 'impression') statsMap[t.item_id].impressions++;
    if (t.event_type === 'click') statsMap[t.item_id].clicks++;
  }
  const enriched = updates.map(u => ({
    ...u,
    impressions: statsMap[u.id]?.impressions || 0,
    clicks: statsMap[u.id]?.clicks || 0,
    ctr: statsMap[u.id]?.impressions ? Math.round((statsMap[u.id].clicks / statsMap[u.id].impressions) * 100) : 0,
  }));
  return Response.json(enriched, { headers: CORS_HEADERS });
}

/** POST /api/admin/updates/delete — delete an update */
async function handleDeleteUpdate(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  if (!body.id) return Response.json({ error: 'Missing id' }, { status: 400, headers: CORS_HEADERS });
  const hdrs = adminHeaders(env);
  await fetch(`${SUPABASE_URL}/rest/v1/admin_tracking?item_type=eq.update&item_id=eq.${body.id}`, { method: 'DELETE', headers: hdrs });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_updates?id=eq.${body.id}`, { method: 'DELETE', headers: hdrs });
  if (!res.ok) return Response.json({ error: 'Delete failed' }, { status: 500, headers: CORS_HEADERS });
  return Response.json({ success: true }, { headers: CORS_HEADERS });
}

/** POST /api/admin/announcements — create a new announcement */
async function handleCreateAnnouncement(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  if (!body.title) return Response.json({ error: 'Title is required' }, { status: 400, headers: CORS_HEADERS });
  const hdrs = adminHeaders(env);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_announcements`, {
    method: 'POST',
    headers: { ...hdrs, 'Prefer': 'return=representation' },
    body: JSON.stringify({
      title: body.title,
      body: body.body || null,
      link: body.link || null,
      image_url: body.image_url || null,
      type: body.type || 'announcement',
      tag: body.tag || 'NEW',
      gradient_start: body.gradient_start || '#a855f7',
      gradient_end: body.gradient_end || '#ec4899',
      cta_buttons: body.cta_buttons || [],
      frequency: body.frequency || 'always',
      ends_at: body.ends_at || null,
      is_active: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    return Response.json({ error: `Insert failed: ${err}` }, { status: 500, headers: CORS_HEADERS });
  }
  const data = await res.json();
  return Response.json(data, { headers: CORS_HEADERS });
}

/** POST /api/admin/announcements/edit — edit an existing announcement */
async function handleEditAnnouncement(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  if (!body.id) return Response.json({ error: 'Missing id' }, { status: 400, headers: CORS_HEADERS });
  const hdrs = adminHeaders(env);
  const payload: any = {};
  const fields = ['title', 'body', 'link', 'image_url', 'type', 'tag', 'gradient_start', 'gradient_end', 'cta_buttons', 'frequency', 'ends_at', 'is_active'];
  for (const f of fields) { if (body[f] !== undefined) payload[f] = body[f]; }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_announcements?id=eq.${body.id}`, {
    method: 'PATCH',
    headers: { ...hdrs, 'Prefer': 'return=representation' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'unknown');
    return Response.json({ error: `Update failed: ${err}` }, { status: 500, headers: CORS_HEADERS });
  }
  const data = await res.json();
  return Response.json(data, { headers: CORS_HEADERS });
}

/** GET /api/admin/announcements — list all announcements (admin) with tracking stats */
async function handleListAnnouncements(env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  const [annsRes, trackingRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/admin_announcements?select=*&order=created_at.desc`, { headers: hdrs }),
    fetch(`${SUPABASE_URL}/rest/v1/admin_tracking?select=item_id,event_type&item_type=eq.announcement`, { headers: hdrs }),
  ]);
  const anns: any[] = annsRes.ok ? await annsRes.json() : [];
  const tracking: any[] = trackingRes.ok ? await trackingRes.json() : [];
  const statsMap: Record<string, { impressions: number; clicks: number }> = {};
  for (const t of tracking) {
    if (!statsMap[t.item_id]) statsMap[t.item_id] = { impressions: 0, clicks: 0 };
    if (t.event_type === 'impression') statsMap[t.item_id].impressions++;
    if (t.event_type === 'click') statsMap[t.item_id].clicks++;
  }
  const enriched = anns.map(a => ({
    ...a,
    impressions: statsMap[a.id]?.impressions || 0,
    clicks: statsMap[a.id]?.clicks || 0,
    ctr: statsMap[a.id]?.impressions ? Math.round((statsMap[a.id].clicks / statsMap[a.id].impressions) * 100) : 0,
  }));
  return Response.json(enriched, { headers: CORS_HEADERS });
}

/** POST /api/admin/announcements/delete — delete an announcement */
async function handleDeleteAnnouncement(request: Request, env: Env): Promise<Response> {
  const body: any = await request.json();
  if (!body.id) return Response.json({ error: 'Missing id' }, { status: 400, headers: CORS_HEADERS });
  const hdrs = adminHeaders(env);
  await fetch(`${SUPABASE_URL}/rest/v1/admin_tracking?item_type=eq.announcement&item_id=eq.${body.id}`, { method: 'DELETE', headers: hdrs });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_announcements?id=eq.${body.id}`, { method: 'DELETE', headers: hdrs });
  if (!res.ok) return Response.json({ error: 'Delete failed' }, { status: 500, headers: CORS_HEADERS });
  return Response.json({ success: true }, { headers: CORS_HEADERS });
}

/** POST /api/track-event — record impression or click (public, needs auth) */
async function handleTrackEvent(request: Request, env: Env): Promise<Response> {
  const auth = await verifyUser(request, env);
  if (!auth.valid) return Response.json({ error: auth.error }, { status: 403, headers: CORS_HEADERS });
  const body: any = await request.json();
  const { item_type, item_id, event_type } = body;
  if (!item_type || !item_id || !event_type) return Response.json({ error: 'Missing fields' }, { status: 400, headers: CORS_HEADERS });
  if (!['update', 'announcement'].includes(item_type)) return Response.json({ error: 'Invalid item_type' }, { status: 400, headers: CORS_HEADERS });
  if (!['impression', 'click'].includes(event_type)) return Response.json({ error: 'Invalid event_type' }, { status: 400, headers: CORS_HEADERS });
  const hdrs = adminHeaders(env);
  // Upsert — unique constraint will prevent duplicates
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_tracking`, {
    method: 'POST',
    headers: { ...hdrs, 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({ item_type, item_id, user_id: auth.user.id, event_type }),
  });
  return Response.json({ ok: true }, { headers: CORS_HEADERS });
}

/** GET /api/admin/messaging-stats — aggregate stats for overview card */
async function handleMessagingStats(env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  const [updatesRes, annsRes, trackingRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/admin_updates?select=id,is_active`, { headers: hdrs }),
    fetch(`${SUPABASE_URL}/rest/v1/admin_announcements?select=id,is_active,ends_at`, { headers: hdrs }),
    fetch(`${SUPABASE_URL}/rest/v1/admin_tracking?select=item_type,event_type`, { headers: hdrs }),
  ]);
  const updates: any[] = updatesRes.ok ? await updatesRes.json() : [];
  const anns: any[] = annsRes.ok ? await annsRes.json() : [];
  const tracking: any[] = trackingRes.ok ? await trackingRes.json() : [];

  const activeUpdates = updates.filter(u => u.is_active).length;
  const activeAnns = anns.filter(a => a.is_active && (!a.ends_at || new Date(a.ends_at) > new Date())).length;
  let totalImpressions = 0, totalClicks = 0;
  for (const t of tracking) {
    if (t.event_type === 'impression') totalImpressions++;
    if (t.event_type === 'click') totalClicks++;
  }

  return Response.json({
    total_updates: updates.length,
    active_updates: activeUpdates,
    total_announcements: anns.length,
    active_announcements: activeAnns,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    overall_ctr: totalImpressions ? Math.round((totalClicks / totalImpressions) * 100) : 0,
  }, { headers: CORS_HEADERS });
}

/* ══════════════════════════════════════════════════════════════
   AI SEARCH — Workers AI powered search intent resolution
   ══════════════════════════════════════════════════════════════ */

const AI_SYSTEM_PROMPT = `You are a music search assistant. Given a user's search query, find the MOST POPULAR match across all categories.

For the query "{query}", think of it as:
1. "popular song called {query}" - find the most popular track
2. "popular album called {query}" - find the most popular album
3. "popular artist called {query}" - find the most popular artist
4. "popular playlist called {query}" - find the most popular playlist

Then determine which category has the MOST POPULAR result and should be the top result.

CRITICAL RULES:
- Always pick the MOST FAMOUS, MOST POPULAR version (the mega-hit, not covers or remixes)
- For "sorry" → "Sorry" by Justin Bieber (the hit song, not random covers)
- For "justn" → Justin Bieber (the real, famous artist)
- For "graduation" → "Graduation" album by Kanye West (the famous album)
- If search results are provided with popularity scores, pick the HIGHEST popularity match

Return a JSON object with these fields:
- "artist": the most likely artist name (full, correct spelling), or null
- "title": the most likely song/album title (full, correct spelling), or null
- "type": one of "artist", "album", "track", "playlist", or "unknown"
- "confidence": a number 0-100

Examples:
Query: "sorry" → {"artist":"Justin Bieber","title":"Sorry","type":"track","confidence":95}
Query: "justn" → {"artist":"Justin Bieber","title":null,"type":"artist","confidence":95}
Query: "graduation" → {"artist":"Kanye West","title":"Graduation","type":"album","confidence":90}
Query: "ye" → {"artist":"Kanye West","title":null,"type":"artist","confidence":85}
Query: "swag ii" → {"artist":"Justin Bieber","title":"Journals","type":"album","confidence":60}
Query: "bohemian" → {"artist":"Queen","title":"Bohemian Rhapsody","type":"track","confidence":90}
Query: "thriller" → {"artist":"Michael Jackson","title":"Thriller","type":"album","confidence":92}
Query: "bad guy" → {"artist":"Billie Eilish","title":"bad guy","type":"track","confidence":90}
Query: "donda" → {"artist":"Kanye West","title":"Donda","type":"album","confidence":95}

ONLY return valid JSON. No explanation, no markdown, just the JSON object.`;

async function handleAiSearch(request: Request, env: Env): Promise<Response> {
  if (!env.AI) {
    return Response.json(
      { error: 'AI binding not configured' },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  try {
    const body: any = await request.json();
    const query = (body.query || '').trim();
    if (!query) {
      return Response.json({ error: 'Missing query' }, { status: 400, headers: CORS_HEADERS });
    }

    // Build user prompt — explicitly search for popular matches in all categories
    let userPrompt = `Find the most popular match for: "${query}"

Consider these searches:
1. "popular song called ${query}" - list popular tracks by popularity
2. "popular album called ${query}" - list popular albums by popularity  
3. "popular artist called ${query}" - list popular artists by popularity
4. "popular playlist called ${query}" - list popular playlists by popularity

From these 4 categories, determine which has the MOST POPULAR result and should be the top result.`;
    
    if (body.candidates && body.candidates.length > 0) {
      const candidateList = body.candidates
        .slice(0, 20)
        .map((c: any, i: number) => `${i + 1}. ${c.name}${c.artist ? ` by ${c.artist}` : ''} (${c.type})${c.popularity ? ` - popularity: ${c.popularity}` : ''}`)
        .join('\n');
      userPrompt += `\n\nActual search results found (with popularity scores):\n${candidateList}\n\nPick the result with the HIGHEST popularity that matches the query.`;
    }

    const aiResponse: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 150,
      temperature: 0.1,
    });

    const text = (aiResponse.response || '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = { artist: null, title: null, type: 'unknown', confidence: 0 };
      }
    }

    return Response.json({ query, intent: parsed }, { headers: CORS_HEADERS });
  } catch (err: any) {
    console.error('AI search error:', err);
    return Response.json(
      { error: err.message || 'AI inference failed' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/* ══════════════════════════════════════════════════════════════
   PUBLIC ENDPOINTS — updates/check, announcements/active
   ══════════════════════════════════════════════════════════════ */

/** GET /api/updates/check — get active updates (public, no version filtering) */
async function handleCheckUpdates(request: Request, env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_active_updates`, {
    method: 'POST',
    headers: hdrs,
    body: '{}',
  });
  if (!rpcRes.ok) {
    return Response.json([], { headers: CORS_HEADERS });
  }
  const data = await rpcRes.json();
  return Response.json(data, { headers: CORS_HEADERS });
}

/** GET /api/announcements/active — get currently active announcements (public, new schema) */
async function handleActiveAnnouncements(env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_active_announcements`, {
    method: 'POST',
    headers: hdrs,
    body: '{}',
  });
  if (!rpcRes.ok) {
    return Response.json([], { headers: CORS_HEADERS });
  }
  const data = await rpcRes.json();
  return Response.json(data, { headers: CORS_HEADERS });
}

/* ══════════════════════════════════════════════════════════════
   WRAPPED — helpers, compute, leaderboard, public share
   ══════════════════════════════════════════════════════════════ */

/** Verify any authenticated user (not just admin) — returns user object */
async function verifyUser(request: Request, env: Env): Promise<{ valid: boolean; user?: any; error?: string }> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { valid: false, error: 'Server not configured' };
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return { valid: false, error: 'Missing authorization' };
  const token = authHeader.substring(7);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!res.ok) {
    return { valid: false, error: `Invalid session (${res.status})` };
  }
  const user: any = await res.json();
  return { valid: true, user };
}

/** Ethiopian year date range for Wrapped.  Sep 8 → Sep 6 next year.
 *  When isPreview=true (Feb preview window) we show the CURRENT in-progress
 *  Ethiopian year instead of the previous completed one.                     */
function getWrappedDateRange(isPreview = false): { start: string; end: string; yearLabel: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed (Sep=8)
  const d = now.getDate();
  // After Sep 7 (or during preview): current / just-ended year = (y-1)-09-08 → y-09-06
  if (isPreview || m > 8 || (m === 8 && d >= 7)) {
    return { start: `${y - 1}-09-08T00:00:00Z`, end: `${y}-09-06T23:59:59Z`, yearLabel: `${y - 1}/${y}` };
  }
  // Jan-Sep 6 (normal September window): previous completed year
  return { start: `${y - 2}-09-08T00:00:00Z`, end: `${y - 1}-09-06T23:59:59Z`, yearLabel: `${y - 2}/${y - 1}` };
}

/** Whether the Wrapped banner should be visible right now */
function isWrappedWindowOpen(isAdmin: boolean, email?: string): boolean {
  const now = new Date();
  const m = now.getMonth(); // 0-indexed
  const d = now.getDate();
  // Preview window: Feb 12-20 for admin + preview emails
  const isPreview = isAdmin || (email ? PREVIEW_EMAILS.includes(email.toLowerCase()) : false);
  if (isPreview && m === 1 && d >= 12 && d <= 20) return true;
  if (m !== 8) return false; // only September for general availability
  return isAdmin ? d >= 4 && d <= 14 : d >= 7 && d <= 14;
}

/* ── Personality types ──────────────────────────────────────── */
const PERSONALITIES = [
  { id: 'the-maestro', name: 'The Maestro', desc: 'Your taste is sophisticated and refined. You appreciate the artistry behind every note.', match: ['classical', 'jazz', 'soul', 'blues'], emoji: '🎼' },
  { id: 'the-hype-beast', name: 'The Hype Beast', desc: 'You run on pure adrenaline. Your playlist could fuel a rocket launch.', match: ['hip-hop', 'trap', 'rap', 'drill'], emoji: '🔥' },
  { id: 'the-dreamer', name: 'The Dreamer', desc: 'Music is your escape. You live in your own cinematic universe.', match: ['pop', 'indie', 'dream-pop', 'shoegaze', 'ambient'], emoji: '✨' },
  { id: 'the-rebel', name: 'The Rebel', desc: 'Rules are made to be broken. Your playlist is a manifesto.', match: ['rock', 'punk', 'metal', 'grunge', 'alternative'], emoji: '⚡' },
  { id: 'the-groove-master', name: 'The Groove Master', desc: 'You were born to move. If it\'s got a beat, you\'re already dancing.', match: ['electronic', 'edm', 'house', 'techno', 'dance'], emoji: '🎧' },
  { id: 'the-romantic', name: 'The Romantic', desc: 'Every song is a love story, and you\'re always the main character.', match: ['r&b', 'soul', 'ballad', 'love'], emoji: '💜' },
  { id: 'the-explorer', name: 'The Explorer', desc: 'Genre-fluid and fearless. You go wherever the music takes you.', match: [] as string[], emoji: '🌍' },
];

function computePersonality(genreCounts: Record<string, number>) {
  const lc: Record<string, number> = {};
  for (const [g, c] of Object.entries(genreCounts)) lc[g.toLowerCase()] = (lc[g.toLowerCase()] || 0) + c;
  let best = PERSONALITIES[PERSONALITIES.length - 1]; // default Explorer
  let bestScore = 0;
  for (const p of PERSONALITIES) {
    let score = 0;
    for (const g of p.match) score += lc[g] || 0;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return { id: best.id, name: best.name, description: best.desc, emoji: best.emoji };
}

/* ── Roast generator ────────────────────────────────────────── */
function generateRoast(s: {
  total_plays: number; unique_tracks: number; unique_artists: number; total_minutes: number;
  top_tracks: any[]; top_artists: any[]; top_genres: any[]; longest_streak: number;
}): string {
  const lines: string[] = [];
  if (s.top_tracks[0]?.plays > 15)
    lines.push(`You played "${s.top_tracks[0].title}" ${s.top_tracks[0].plays} times. Even the artist doesn't listen to their own song that much.`);
  if (s.top_artists[0]?.plays > 20) {
    const pct = Math.round(s.top_artists[0].plays / s.total_plays * 100);
    lines.push(`${s.top_artists[0].name} accounts for ${pct}% of your listening. At this point you're basically a fan page.`);
  }
  if (s.total_minutes > 3000) {
    const days = Math.round(s.total_minutes / 1440);
    lines.push(`${s.total_minutes.toLocaleString()} minutes of music this year — that's ${days} full days. Your headphones deserve hazard pay.`);
  } else if (s.total_minutes < 60 && s.total_plays > 0) {
    lines.push(`${s.total_minutes} minutes total? That's barely a podcast episode. Did you even use this app?`);
  }
  if (s.unique_tracks < 10 && s.total_plays > 20)
    lines.push(`${s.total_plays} plays but only ${s.unique_tracks} unique tracks? You're not exploring music, you're trapped in a time loop.`);
  if (s.unique_artists > 50)
    lines.push(`${s.unique_artists} different artists? You have commitment issues and your playlist proves it.`);
  if (s.top_genres[0] && s.total_plays > 10) {
    const pct = Math.round(s.top_genres[0].plays / s.total_plays * 100);
    if (pct > 60) lines.push(`${pct}% of your music is ${s.top_genres[0].genre}. Your playlist has less diversity than a company board meeting.`);
  }
  if (s.longest_streak <= 1 && s.total_plays > 5)
    lines.push(`Longest listening streak: ${s.longest_streak} day. Consistency isn't exactly your thing.`);
  lines.push(`Your music taste is… unique. And by unique, I mean nobody else would voluntarily listen to this combination.`);
  // Pick up to 3 (deterministic-ish via data-seeded index)
  const seed = (s.total_plays * 7 + s.unique_tracks * 13) % (lines.length || 1);
  const picked: string[] = [];
  for (let i = 0; i < Math.min(3, lines.length); i++) picked.push(lines[(seed + i) % lines.length]);
  return picked.join(' ');
}

/* ── Monthly trend ──────────────────────────────────────────── */
function computeMonthlyTrend(events: any[], startISO: string, endISO: string) {
  const buckets: Record<string, { plays: number; minutes: number }> = {};
  // Initialise every month in range
  const cur = new Date(startISO);
  const end = new Date(endISO);
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
    buckets[key] = { plays: 0, minutes: 0 };
    cur.setMonth(cur.getMonth() + 1);
  }
  for (const e of events) {
    const d = new Date(e.listened_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (buckets[key]) { buckets[key].plays++; buckets[key].minutes += Math.round((e.duration_sec || 0) / 60); }
  }
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => {
    const [yr, mo] = k.split('-');
    return { month: k, label: `${MONTH_NAMES[parseInt(mo, 10) - 1]} '${yr.slice(2)}`, ...v };
  });
}

/* ── Consecutive listening days ─────────────────────────────── */
function longestStreak(events: any[]): number {
  if (!events.length) return 0;
  const dates = new Set<string>();
  for (const e of events) {
    const d = new Date(e.listened_at);
    dates.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const sorted = Array.from(dates).sort();
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]).getTime();
    const next = new Date(sorted[i]).getTime();
    if (next - prev <= 86400000 * 1.1) { cur++; max = Math.max(max, cur); } else { cur = 1; }
  }
  return max;
}

/* ── POST /api/wrapped/compute ─────────────────────────────── */
async function handleWrappedCompute(request: Request, env: Env): Promise<Response> {
  const auth = await verifyUser(request, env);
  if (!auth.valid) return Response.json({ error: auth.error }, { status: 403, headers: CORS_HEADERS });
  const user = auth.user;
  const userId = user.id;
  const isAdmin = user.email?.toLowerCase() === ADMIN_EMAIL;
  const isPreview = isAdmin || PREVIEW_EMAILS.includes(user.email?.toLowerCase() ?? '');
  const now = new Date();
  const inPreviewWindow = isPreview && now.getMonth() === 1 && now.getDate() >= 12 && now.getDate() <= 20;

  const { start, end, yearLabel } = getWrappedDateRange(inPreviewWindow);
  const bannerOpen = isWrappedWindowOpen(isAdmin, user.email);

  const hdrs = adminHeaders(env);

  // Fetch events in date range (up to 50 000)
  const evtUrl = `${SUPABASE_URL}/rest/v1/listening_events?select=track_id,track_title,artist_name,album_title,genre,duration_sec,listened_at&user_id=eq.${userId}&listened_at=gte.${encodeURIComponent(start)}&listened_at=lte.${encodeURIComponent(end)}&order=listened_at.asc&limit=50000`;
  const evtRes = await fetch(evtUrl, { headers: hdrs });
  const events: any[] = evtRes.ok ? await evtRes.json() : [];

  // Profile
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=display_name,avatar_seed&user_id=eq.${userId}`, { headers: hdrs });
  const profs: any[] = profRes.ok ? await profRes.json() : [];
  const profile = profs[0] || {};

  // ── Aggregate ──
  const artistCounts: Record<string, number> = {};
  const trackCounts: Record<string, { title: string; artist: string; plays: number; track_id: string }> = {};
  const genreCounts: Record<string, number> = {};
  const uniqueArtists = new Set<string>();
  const uniqueTracks = new Set<string>();
  let totalSec = 0;

  for (const e of events) {
    totalSec += e.duration_sec || 0;
    if (e.artist_name) { artistCounts[e.artist_name] = (artistCounts[e.artist_name] || 0) + 1; uniqueArtists.add(e.artist_name); }
    if (e.track_title) {
      const key = `${e.track_title}|||${e.artist_name}`;
      if (!trackCounts[key]) trackCounts[key] = { title: e.track_title, artist: e.artist_name, plays: 0, track_id: e.track_id };
      trackCounts[key].plays++;
      uniqueTracks.add(key);
    }
    if (e.genre) genreCounts[e.genre] = (genreCounts[e.genre] || 0) + 1;
  }

  const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, plays], i) => ({ name, plays, rank: i + 1 }));
  const topTracks = Object.values(trackCounts).sort((a, b) => b.plays - a.plays).slice(0, 5)
    .map((t, i) => ({ title: t.title, artist: t.artist, plays: t.plays, track_id: t.track_id, rank: i + 1 }));
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([genre, plays], i) => ({ genre, plays, rank: i + 1 }));

  const totalMinutes = Math.round(totalSec / 60);
  const streak = longestStreak(events);
  const trend = computeMonthlyTrend(events, start, end);

  // New artists discovered — artists whose first listen falls in this period
  // (All artists in range are effectively "new" for the period. Count total unique artists.)
  const newArtistsDiscovered = uniqueArtists.size;

  const personality = computePersonality(genreCounts);
  const roast = generateRoast({
    total_plays: events.length, unique_tracks: uniqueTracks.size, unique_artists: uniqueArtists.size,
    total_minutes: totalMinutes, top_tracks: topTracks, top_artists: topArtists, top_genres: topGenres,
    longest_streak: streak,
  });

  const firstEvent = events[0] || null;
  const lastEvent = events.length ? events[events.length - 1] : null;

  // ── User rank on leaderboard ──
  const allEvtUrl = `${SUPABASE_URL}/rest/v1/listening_events?select=user_id,duration_sec&listened_at=gte.${encodeURIComponent(start)}&listened_at=lte.${encodeURIComponent(end)}&limit=50000`;
  const allEvtRes = await fetch(allEvtUrl, { headers: hdrs });
  const allEvts: any[] = allEvtRes.ok ? await allEvtRes.json() : [];
  const userMinutes: Record<string, number> = {};
  for (const e of allEvts) userMinutes[e.user_id] = (userMinutes[e.user_id] || 0) + Math.round((e.duration_sec || 0) / 60);
  const ranked = Object.entries(userMinutes).sort((a, b) => b[1] - a[1]);
  const userRank = ranked.findIndex(([uid]) => uid === userId) + 1;

  return Response.json({
    year_label: yearLabel,
    banner_open: bannerOpen,
    user_name: profile.display_name || user.email?.split('@')[0] || 'Listener',
    user_avatar_seed: profile.avatar_seed || userId,
    total_plays: events.length,
    unique_tracks: uniqueTracks.size,
    unique_artists: uniqueArtists.size,
    total_minutes: totalMinutes,
    top_artists: topArtists,
    top_tracks: topTracks,
    top_genres: topGenres,
    first_listen: firstEvent ? { track_title: firstEvent.track_title, artist_name: firstEvent.artist_name, listened_at: firstEvent.listened_at } : null,
    last_listen: lastEvent ? { track_title: lastEvent.track_title, artist_name: lastEvent.artist_name, listened_at: lastEvent.listened_at } : null,
    longest_streak: streak,
    new_artists_discovered: newArtistsDiscovered,
    personality,
    roast,
    monthly_trend: trend,
    user_rank: userRank || ranked.length + 1,
    total_app_users: ranked.length,
    top_track_id: topTracks[0]?.track_id || null,
  }, { headers: CORS_HEADERS });
}

/* ── GET /api/wrapped/leaderboard ──────────────────────────── */
async function handleWrappedLeaderboard(request: Request, env: Env): Promise<Response> {
  const auth = await verifyUser(request, env);
  if (!auth.valid) return Response.json({ error: auth.error }, { status: 403, headers: CORS_HEADERS });

  const user = auth.user;
  const isPreviewUser = PREVIEW_EMAILS.includes(user.email?.toLowerCase() ?? '') || user.email?.toLowerCase() === ADMIN_EMAIL;
  const now = new Date();
  const inPreviewWindow = isPreviewUser && now.getMonth() === 1 && now.getDate() >= 12 && now.getDate() <= 20;
  const { start, end, yearLabel } = getWrappedDateRange(inPreviewWindow);
  const hdrs = adminHeaders(env);

  // All events in range
  const evtUrl = `${SUPABASE_URL}/rest/v1/listening_events?select=user_id,duration_sec&listened_at=gte.${encodeURIComponent(start)}&listened_at=lte.${encodeURIComponent(end)}&limit=50000`;
  const evtRes = await fetch(evtUrl, { headers: hdrs });
  const events: any[] = evtRes.ok ? await evtRes.json() : [];

  const mins: Record<string, number> = {};
  const plays: Record<string, number> = {};
  for (const e of events) {
    mins[e.user_id] = (mins[e.user_id] || 0) + Math.round((e.duration_sec || 0) / 60);
    plays[e.user_id] = (plays[e.user_id] || 0) + 1;
  }
  const sorted = Object.entries(mins).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const userIds = sorted.map(([uid]) => uid);

  // Fetch profiles for these users
  const profUrl = `${SUPABASE_URL}/rest/v1/user_profiles?select=user_id,display_name,avatar_seed&user_id=in.(${userIds.join(',')})`;
  const profRes = userIds.length ? await fetch(profUrl, { headers: hdrs }) : null;
  const profiles: any[] = profRes && profRes.ok ? await profRes.json() : [];
  const profMap: Record<string, any> = {};
  for (const p of profiles) profMap[p.user_id] = p;

  // Fetch auth users for email fallback
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=100`, { headers: hdrs });
  const authData: any = authRes.ok ? await authRes.json() : { users: [] };
  const emailMap: Record<string, string> = {};
  for (const u of authData.users || []) emailMap[u.id] = u.email || '';

  const leaderboard = sorted.map(([uid, minutes], i) => ({
    rank: i + 1,
    user_id: uid,
    display_name: profMap[uid]?.display_name || emailMap[uid]?.split('@')[0] || 'Listener',
    avatar_seed: profMap[uid]?.avatar_seed || uid,
    total_minutes: minutes,
    total_plays: plays[uid] || 0,
  }));

  return Response.json({ year_label: yearLabel, leaderboard }, { headers: CORS_HEADERS });
}

/* ── GET /wrapped/share/:userId — public share page ────────── */
async function handleWrappedShare(userId: string, env: Env): Promise<Response> {
  const hdrs = adminHeaders(env);
  // Share page is public; during Feb preview window use current year
  const now = new Date();
  const inFebWindow = now.getMonth() === 1 && now.getDate() >= 12 && now.getDate() <= 15;
  const { start, end, yearLabel } = getWrappedDateRange(inFebWindow);

  // Profile
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=display_name,avatar_seed&user_id=eq.${userId}`, { headers: hdrs });
  const profs: any[] = profRes.ok ? await profRes.json() : [];
  const profile = profs[0] || {};

  // Events (just enough for top 5 stats)
  const evtUrl = `${SUPABASE_URL}/rest/v1/listening_events?select=track_title,artist_name,genre,duration_sec&user_id=eq.${userId}&listened_at=gte.${encodeURIComponent(start)}&listened_at=lte.${encodeURIComponent(end)}&limit=50000`;
  const evtRes = await fetch(evtUrl, { headers: hdrs });
  const events: any[] = evtRes.ok ? await evtRes.json() : [];

  const artistC: Record<string, number> = {};
  const trackC: Record<string, { t: string; a: string; c: number }> = {};
  const genreC: Record<string, number> = {};
  let totalSec = 0;
  for (const e of events) {
    totalSec += e.duration_sec || 0;
    if (e.artist_name) artistC[e.artist_name] = (artistC[e.artist_name] || 0) + 1;
    if (e.track_title) {
      const k = `${e.track_title}|||${e.artist_name}`;
      if (!trackC[k]) trackC[k] = { t: e.track_title, a: e.artist_name, c: 0 };
      trackC[k].c++;
    }
    if (e.genre) genreC[e.genre] = (genreC[e.genre] || 0) + 1;
  }
  const top5Artists = Object.entries(artistC).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const top5Tracks = Object.values(trackC).sort((a, b) => b.c - a.c).slice(0, 5);
  const top5Genres = Object.entries(genreC).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const userName = profile.display_name || 'A Tunes Listener';
  const totalMin = Math.round(totalSec / 60);

  const artistsHTML = top5Artists.map(([n, c], i) => `<div class="row"><span class="rank">${i + 1}</span><span class="name">${esc(n)}</span><span class="stat">${c} plays</span></div>`).join('');
  const tracksHTML = top5Tracks.map((t, i) => `<div class="row"><span class="rank">${i + 1}</span><span class="name">${esc(t.t)} <small>— ${esc(t.a)}</small></span><span class="stat">${t.c} plays</span></div>`).join('');
  const genresHTML = top5Genres.map(([g, c], i) => `<div class="row"><span class="rank">${i + 1}</span><span class="name">${esc(g)}</span><span class="stat">${c} plays</span></div>`).join('');

  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(userName)}'s ${yearLabel} Wrapped — Tunes</title>
<meta property="og:title" content="${esc(userName)}'s ${yearLabel} Wrapped — Tunes">
<meta property="og:description" content="${events.length} plays · ${totalMin} minutes · Top artist: ${top5Artists[0]?.[0] || 'N/A'}">
<meta property="og:type" content="website">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{max-width:420px;width:90vw;padding:2rem;border-radius:20px;background:linear-gradient(135deg,#1a0a2e,#0d1b2a,#1a0a2e);border:1px solid rgba(139,92,246,0.3)}
h1{font-size:1.6rem;margin-bottom:0.2rem;background:linear-gradient(90deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{opacity:0.6;font-size:0.85rem;margin-bottom:1.5rem}
.stats{display:flex;gap:1rem;margin-bottom:1.5rem}
.stat-box{flex:1;background:rgba(255,255,255,0.05);border-radius:12px;padding:0.75rem;text-align:center}
.stat-box .num{font-size:1.4rem;font-weight:800;color:#8b5cf6}
.stat-box .lbl{font-size:0.7rem;opacity:0.5;margin-top:2px}
.section{margin-bottom:1.2rem}
.section h2{font-size:0.85rem;text-transform:uppercase;letter-spacing:0.1em;opacity:0.5;margin-bottom:0.5rem}
.row{display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.05)}
.rank{width:22px;font-weight:700;color:#8b5cf6;font-size:0.85rem;text-align:center}
.name{flex:1;font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.name small{opacity:0.5}
.row .stat{font-size:0.75rem;opacity:0.5}
.cta{display:block;margin-top:1.5rem;text-align:center;padding:0.75rem;background:linear-gradient(135deg,#8b5cf6,#06b6d4);border-radius:12px;color:#fff;text-decoration:none;font-weight:600;font-size:0.9rem}
</style></head><body>
<div class="card">
<h1>${esc(userName)}'s Wrapped</h1>
<p class="sub">${yearLabel} · Ethiopian Year</p>
<div class="stats">
<div class="stat-box"><div class="num">${events.length}</div><div class="lbl">plays</div></div>
<div class="stat-box"><div class="num">${totalMin}</div><div class="lbl">minutes</div></div>
<div class="stat-box"><div class="num">${new Set(events.map((e: any) => e.artist_name)).size}</div><div class="lbl">artists</div></div>
</div>
${top5Artists.length ? `<div class="section"><h2>Top Artists</h2>${artistsHTML}</div>` : ''}
${top5Tracks.length ? `<div class="section"><h2>Top Tracks</h2>${tracksHTML}</div>` : ''}
${top5Genres.length ? `<div class="section"><h2>Top Genres</h2>${genresHTML}</div>` : ''}
<a class="cta" href="/">Listen on Tunes ▸</a>
</div></body></html>`;

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

function esc(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export default {
  /** Cron trigger — archive listening data to Telegram every 6h */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
    ctx.waitUntil(
      performArchive(env).then(r => {
        if (!r.success && r.error) console.error('[cron-archive]', r.error);
        else console.log(`[cron-archive] archived ${r.rows} rows`);
      }).catch(e => console.error('[cron-archive] exception:', e))
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // ── Admin API routes ──
    if (url.pathname.startsWith('/api/admin/')) {
      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (request.method !== 'POST' && request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
      }

      // Verify admin
      const auth = await verifyAdmin(request, env);
      if (!auth.valid) {
        return Response.json({ error: auth.error }, { status: 403, headers: CORS_HEADERS });
      }

      try {
        // Existing endpoints
        if (url.pathname === '/api/admin/users') return await handleListUsers(env);
        if (url.pathname === '/api/admin/user-summary') return await handleUserSummary(request, env);
        if (url.pathname === '/api/admin/delete-user') return await handleDeleteUser(request, env);
        if (url.pathname === '/api/admin/dashboard-stats') return await handleDashboardStats(env);
        if (url.pathname === '/api/admin/user-ai-review' && request.method === 'POST') return await handleUserAiReview(request, env);
        // Storage / Archive endpoints
        if (url.pathname === '/api/admin/db-stats') return await handleDbStats(env);
        if (url.pathname === '/api/admin/telegram/test') return await handleTelegramTest(env);
        if (url.pathname === '/api/admin/archive/trigger') return await handleArchiveTrigger(env);
        if (url.pathname === '/api/admin/archive/history') return await handleArchiveHistory(env);
        if (url.pathname === '/api/admin/archive/retrieve') return await handleArchiveRetrieve(request, env);
        // Updates CRUD
        if (url.pathname === '/api/admin/updates' && request.method === 'POST') return await handleCreateUpdate(request, env);
        if (url.pathname === '/api/admin/updates' && request.method === 'GET') return await handleListUpdates(env);
        if (url.pathname === '/api/admin/updates/edit') return await handleEditUpdate(request, env);
        if (url.pathname === '/api/admin/updates/delete') return await handleDeleteUpdate(request, env);
        // Announcements CRUD
        if (url.pathname === '/api/admin/announcements' && request.method === 'POST') return await handleCreateAnnouncement(request, env);
        if (url.pathname === '/api/admin/announcements' && request.method === 'GET') return await handleListAnnouncements(env);
        if (url.pathname === '/api/admin/announcements/edit') return await handleEditAnnouncement(request, env);
        if (url.pathname === '/api/admin/announcements/delete') return await handleDeleteAnnouncement(request, env);
        // Messaging stats
        if (url.pathname === '/api/admin/messaging-stats') return await handleMessagingStats(env);
      } catch (err: any) {
        return Response.json({ error: err.message || 'Internal error' }, { status: 500, headers: CORS_HEADERS });
      }

      return Response.json({ error: 'Unknown endpoint' }, { status: 404, headers: CORS_HEADERS });
    }

    // ── Wrapped API routes ──
    if (url.pathname.startsWith('/api/wrapped/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      try {
        if (url.pathname === '/api/wrapped/compute' && request.method === 'POST')
          return await handleWrappedCompute(request, env);
        if (url.pathname === '/api/wrapped/leaderboard')
          return await handleWrappedLeaderboard(request, env);
      } catch (err: any) {
        return Response.json({ error: err.message || 'Internal error' }, { status: 500, headers: CORS_HEADERS });
      }
      return Response.json({ error: 'Unknown endpoint' }, { status: 404, headers: CORS_HEADERS });
    }

    // ── Public API routes (no auth required) ──
    if (url.pathname === '/api/ai-search') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (request.method === 'POST') return await handleAiSearch(request, env);
      return Response.json({ error: 'POST only' }, { status: 405, headers: CORS_HEADERS });
    }
    if (url.pathname === '/api/updates/check') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      return await handleCheckUpdates(request, env);
    }
    if (url.pathname === '/api/announcements/active') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      return await handleActiveAnnouncements(env);
    }
    if (url.pathname === '/api/track-event') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
      if (request.method === 'POST') return await handleTrackEvent(request, env);
      return Response.json({ error: 'POST only' }, { status: 405, headers: CORS_HEADERS });
    }

    // ── Public Wrapped share page ──
    const shareMatch = url.pathname.match(/^\/wrapped\/share\/([a-f0-9-]+)$/i);
    if (shareMatch) {
      try { return await handleWrappedShare(shareMatch[1], env); }
      catch { return new Response('Not Found', { status: 404 }); }
    }

    // ── Static file serving ──
    try {
      return await getAssetFromKV(
        { request, waitUntil: ctx.waitUntil.bind(ctx) } as any,
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: assetManifest,
        } as any
      );
    } catch {
      // SPA fallback - serve index.html for client-side routes
      try {
        const indexRequest = new Request(new URL('/', request.url).toString(), request);
        return await getAssetFromKV(
          { request: indexRequest, waitUntil: ctx.waitUntil.bind(ctx) } as any,
          {
            ASSET_NAMESPACE: env.__STATIC_CONTENT,
            ASSET_MANIFEST: assetManifest,
          } as any
        );
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  },
};
