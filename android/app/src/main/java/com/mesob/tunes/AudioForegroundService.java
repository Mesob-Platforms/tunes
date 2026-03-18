package com.mesob.tunes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground service that keeps audio alive when the app is backgrounded.
 * Manages a MediaSession, media-style notification with prev/play/pause/next,
 * headphone unplug (becoming noisy), and Bluetooth auto-resume.
 *
 * Audio focus is NOT managed here — the WebView's Chromium engine handles
 * focus internally for the <audio> element. Requesting focus here would
 * conflict and cause Chromium to pause audio immediately after starting.
 */
public class AudioForegroundService extends Service {

    private static final String TAG = "AudioFgService";
    public static final String ACTION_UPDATE = "com.mesob.tunes.ACTION_UPDATE";
    public static final String CHANNEL_ID = "tunes_music_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final long PAUSE_STOP_DELAY_MS = 5 * 60 * 1000;

    public static final String ACTION_PLAY  = "com.mesob.tunes.ACTION_PLAY";
    public static final String ACTION_PAUSE = "com.mesob.tunes.ACTION_PAUSE";
    public static final String ACTION_NEXT  = "com.mesob.tunes.ACTION_NEXT";
    public static final String ACTION_PREV  = "com.mesob.tunes.ACTION_PREV";
    public static final String ACTION_LIKE  = "com.mesob.tunes.ACTION_LIKE";
    public static final String ACTION_STOP  = "com.mesob.tunes.ACTION_STOP";

    private MediaSessionCompat mediaSession;
    private NotificationManager notificationManager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pauseStopRunnable;
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();

    // Bluetooth auto-resume
    private boolean pausedDueToNoisy = false;
    private BroadcastReceiver noisyReceiver;
    private BroadcastReceiver btReconnectReceiver;
    private boolean noisyReceiverRegistered = false;
    private boolean btReceiverRegistered = false;

    // Current state
    private String currentTitle = "";
    private String currentArtist = "";
    private String currentAlbum = "";
    private String currentAlbumArtUrl = "";
    private boolean currentIsPlaying = false;
    private long currentDurationMs = 0;
    private long currentPositionMs = 0;
    private boolean currentIsLiked = false;
    private Bitmap currentArtBitmap = null;
    private String lastLoadedArtUrl = "";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        mediaSession = new MediaSessionCompat(this, "TunesMediaSession");
        mediaSession.setActive(true);

        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                sendActionToJS("play");
            }

            @Override
            public void onPause() {
                sendActionToJS("pause");
            }

            @Override
            public void onSkipToNext() {
                sendActionToJS("next");
            }

            @Override
            public void onSkipToPrevious() {
                sendActionToJS("prev");
            }

            @Override
            public void onSeekTo(long pos) {
                Intent i = new Intent(TunesActivity.ACTION_MEDIA_BRIDGE);
                i.setPackage(getPackageName());
                i.putExtra(TunesActivity.EXTRA_ACTION, "seekTo");
                i.putExtra("position", pos / 1000.0);
                sendBroadcast(i);
            }

            @Override
            public void onStop() {
                sendActionToJS("stop");
                stopSelf();
            }
        });

        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        registerNoisyReceiver();
        registerBluetoothReconnectReceiver();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            startForeground(NOTIFICATION_ID, buildNotification());
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_PAUSE.equals(action)) {
            sendActionToJS("pause");
            currentIsPlaying = false;
            updateMediaSessionPlaybackState();
            notificationManager.notify(NOTIFICATION_ID, buildNotification());
            startPauseStopTimer();
            return START_NOT_STICKY;
        }
        if (ACTION_PLAY.equals(action)) {
            sendActionToJS("play");
            currentIsPlaying = true;
            updateMediaSessionPlaybackState();
            notificationManager.notify(NOTIFICATION_ID, buildNotification());
            cancelPauseStopTimer();
            return START_NOT_STICKY;
        }
        if (ACTION_NEXT.equals(action)) {
            sendActionToJS("next");
            return START_NOT_STICKY;
        }
        if (ACTION_PREV.equals(action)) {
            sendActionToJS("prev");
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            sendActionToJS("stop");
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!ACTION_UPDATE.equals(action)) {
            startForeground(NOTIFICATION_ID, buildNotification());
            stopSelf();
            return START_NOT_STICKY;
        }

        currentTitle      = intent.getStringExtra("title");
        currentArtist     = intent.getStringExtra("artist");
        currentAlbum      = intent.getStringExtra("album");
        currentAlbumArtUrl = intent.getStringExtra("albumArt");
        currentIsPlaying  = intent.getBooleanExtra("isPlaying", false);
        currentDurationMs = intent.getLongExtra("duration", 0);
        currentPositionMs = intent.getLongExtra("position", 0);
        currentIsLiked    = intent.getBooleanExtra("isLiked", false);

        if (currentTitle == null) currentTitle = "";
        if (currentArtist == null) currentArtist = "";
        if (currentAlbum == null) currentAlbum = "";
        if (currentAlbumArtUrl == null) currentAlbumArtUrl = "";

        if (currentIsPlaying) {
            pausedDueToNoisy = false;
        }

        updateMediaSessionMetadata();
        updateMediaSessionPlaybackState();
        startForeground(NOTIFICATION_ID, buildNotification());
        loadAlbumArtAsync();

        if (currentIsPlaying) {
            cancelPauseStopTimer();
        } else {
            startPauseStopTimer();
        }

        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        cancelPauseStopTimer();
        unregisterNoisyReceiver();
        unregisterBluetoothReceiver();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        artExecutor.shutdownNow();
        super.onDestroy();
    }

    // ──────────────────────────────────────────────────
    //  Becoming Noisy (headphone unplug / BT disconnect)
    // ──────────────────────────────────────────────────

    private void registerNoisyReceiver() {
        if (noisyReceiverRegistered) return;
        noisyReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                    Log.d(TAG, "Audio becoming noisy — pausing");
                    if (currentIsPlaying) {
                        pausedDueToNoisy = true;
                        sendActionToJS("pause");
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(noisyReceiver, filter);
        }
        noisyReceiverRegistered = true;
    }

    private void unregisterNoisyReceiver() {
        if (noisyReceiverRegistered && noisyReceiver != null) {
            try { unregisterReceiver(noisyReceiver); } catch (Exception ignored) {}
            noisyReceiverRegistered = false;
        }
    }

    // ──────────────────────────────────────────────────
    //  Bluetooth Auto-Resume
    // ──────────────────────────────────────────────────

    private void registerBluetoothReconnectReceiver() {
        if (btReceiverRegistered) return;
        btReconnectReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(intent.getAction())) {
                    Log.d(TAG, "Bluetooth device reconnected");
                    if (pausedDueToNoisy && !currentIsPlaying) {
                        Log.d(TAG, "Resuming playback after BT reconnect");
                        handler.postDelayed(() -> {
                            pausedDueToNoisy = false;
                            sendActionToJS("play");
                        }, 1500);
                    }
                }
            }
        };
        IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_ACL_CONNECTED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(btReconnectReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(btReconnectReceiver, filter);
        }
        btReceiverRegistered = true;
    }

    private void unregisterBluetoothReceiver() {
        if (btReceiverRegistered && btReconnectReceiver != null) {
            try { unregisterReceiver(btReconnectReceiver); } catch (Exception ignored) {}
            btReceiverRegistered = false;
        }
    }

    // ──────────────────────────────────────────────────
    //  Notification
    // ──────────────────────────────────────────────────

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Music Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows current track and playback controls");
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        Intent launchIntent = new Intent(this, TunesActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Action prevAction = makeAction(ACTION_PREV, R.drawable.ic_notif_prev, "Previous");
        NotificationCompat.Action playPauseAction;
        if (currentIsPlaying) {
            playPauseAction = makeAction(ACTION_PAUSE, R.drawable.ic_notif_pause, "Pause");
        } else {
            playPauseAction = makeAction(ACTION_PLAY, R.drawable.ic_notif_play, "Play");
        }
        NotificationCompat.Action nextAction = makeAction(ACTION_NEXT, R.drawable.ic_notif_next, "Next");

        MediaStyle mediaStyle = new MediaStyle()
            .setMediaSession(mediaSession.getSessionToken())
            .setShowActionsInCompactView(0, 1, 2);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle.isEmpty() ? "Tunes" : currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum)
            .setSmallIcon(R.drawable.ic_notif_music)
            .setColor(Color.parseColor("#035480"))
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(currentIsPlaying)
            .setShowWhen(false)
            .setStyle(mediaStyle)
            .addAction(prevAction)
            .addAction(playPauseAction)
            .addAction(nextAction);

        if (currentArtBitmap != null) {
            builder.setLargeIcon(currentArtBitmap);
        }

        return builder.build();
    }

    private NotificationCompat.Action makeAction(String actionStr, int icon, String title) {
        Intent intent = new Intent(this, AudioForegroundService.class);
        intent.setAction(actionStr);
        PendingIntent pi = PendingIntent.getService(
            this, actionStr.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Action.Builder(icon, title, pi).build();
    }

    // ──────────────────────────────────────────────────
    //  MediaSession
    // ──────────────────────────────────────────────────

    private void updateMediaSessionMetadata() {
        MediaMetadataCompat.Builder mb = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs);

        if (currentArtBitmap != null) {
            mb.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtBitmap);
        }

        mediaSession.setMetadata(mb.build());
    }

    private void updateMediaSessionPlaybackState() {
        long actions = PlaybackStateCompat.ACTION_PLAY
                     | PlaybackStateCompat.ACTION_PAUSE
                     | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                     | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                     | PlaybackStateCompat.ACTION_SEEK_TO
                     | PlaybackStateCompat.ACTION_STOP;

        int state = currentIsPlaying
            ? PlaybackStateCompat.STATE_PLAYING
            : PlaybackStateCompat.STATE_PAUSED;

        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, currentPositionMs, currentIsPlaying ? 1.0f : 0f)
            .build();

        mediaSession.setPlaybackState(playbackState);
    }

    // ──────────────────────────────────────────────────
    //  Album art loading
    // ──────────────────────────────────────────────────

    private void loadAlbumArtAsync() {
        if (currentAlbumArtUrl.isEmpty() || currentAlbumArtUrl.equals(lastLoadedArtUrl)) {
            return;
        }

        final String urlToLoad = currentAlbumArtUrl;
        artExecutor.execute(() -> {
            try {
                URL url = new URL(urlToLoad);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setDoInput(true);
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);
                conn.connect();
                InputStream input = conn.getInputStream();
                Bitmap bitmap = BitmapFactory.decodeStream(input);
                input.close();
                conn.disconnect();

                if (bitmap != null) {
                    handler.post(() -> {
                        currentArtBitmap = bitmap;
                        lastLoadedArtUrl = urlToLoad;
                        updateMediaSessionMetadata();
                        if (notificationManager != null) {
                            notificationManager.notify(NOTIFICATION_ID, buildNotification());
                        }
                    });
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to load album art: " + e.getMessage());
            }
        });
    }

    // ──────────────────────────────────────────────────
    //  Auto-stop after 5 min pause
    // ──────────────────────────────────────────────────

    private void startPauseStopTimer() {
        cancelPauseStopTimer();
        pauseStopRunnable = () -> {
            Log.d(TAG, "Paused for 5 minutes — stopping service");
            stopForeground(true);
            stopSelf();
        };
        handler.postDelayed(pauseStopRunnable, PAUSE_STOP_DELAY_MS);
    }

    private void cancelPauseStopTimer() {
        if (pauseStopRunnable != null) {
            handler.removeCallbacks(pauseStopRunnable);
            pauseStopRunnable = null;
        }
    }

    // ──────────────────────────────────────────────────
    //  Send actions back to JS via broadcast → MediaBridge
    // ──────────────────────────────────────────────────

    private void sendActionToJS(String action) {
        Intent i = new Intent(TunesActivity.ACTION_MEDIA_BRIDGE);
        i.setPackage(getPackageName());
        i.putExtra(TunesActivity.EXTRA_ACTION, action);
        sendBroadcast(i);
    }
}
