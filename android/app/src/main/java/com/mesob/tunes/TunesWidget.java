package com.mesob.tunes;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.RemoteViews;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 4×1 home-screen widget: album art + track title/artist + prev/play/next buttons.
 * Reads current track info from SharedPreferences written by MediaBridge.
 */
public class TunesWidget extends AppWidgetProvider {

    private static final String TAG = "TunesWidget";
    public static final String PREFS_NAME = "tunes_widget";
    public static final String ACTION_WIDGET_UPDATE = "com.mesob.tunes.WIDGET_UPDATE";

    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);

        if (ACTION_WIDGET_UPDATE.equals(intent.getAction())) {
            // MediaBridge triggers this broadcast whenever now-playing changes
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, TunesWidget.class));
            for (int id : ids) {
                updateWidget(context, manager, id);
            }
        }
    }

    private void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        String title = prefs.getString("title", "Not Playing");
        String artist = prefs.getString("artist", "Tunes");
        boolean isPlaying = prefs.getBoolean("isPlaying", false);
        String albumArtUrl = prefs.getString("albumArt", "");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout);
        views.setTextViewText(R.id.widget_title, title);
        views.setTextViewText(R.id.widget_artist, artist);

        // Play/Pause icon
        views.setImageViewResource(R.id.widget_play_pause,
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);

        // ── Button PendingIntents → send to AudioForegroundService ──
        views.setOnClickPendingIntent(R.id.widget_prev,
                makeServiceIntent(context, "com.mesob.tunes.ACTION_PREV", 1));
        views.setOnClickPendingIntent(R.id.widget_play_pause,
                makeServiceIntent(context, isPlaying ? "com.mesob.tunes.ACTION_PAUSE" : "com.mesob.tunes.ACTION_PLAY", 2));
        views.setOnClickPendingIntent(R.id.widget_next,
                makeServiceIntent(context, "com.mesob.tunes.ACTION_NEXT", 3));

        // Tap album art or title/artist → open the app
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            PendingIntent launchPending = PendingIntent.getActivity(
                    context, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_album_art, launchPending);
            views.setOnClickPendingIntent(R.id.widget_title, launchPending);
            views.setOnClickPendingIntent(R.id.widget_artist, launchPending);
        }

        // Update with text first (fast), then load album art async
        manager.updateAppWidget(widgetId, views);

        // ── Load album art in background thread ──
        if (albumArtUrl != null && !albumArtUrl.isEmpty()) {
            executor.execute(() -> {
                try {
                    URL url = new URL(albumArtUrl);
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
                        // Scale down to save memory
                        Bitmap scaled = Bitmap.createScaledBitmap(bitmap, 128, 128, true);
                        if (scaled != bitmap) bitmap.recycle();

                        RemoteViews artViews = new RemoteViews(context.getPackageName(), R.layout.widget_layout);
                        artViews.setImageViewBitmap(R.id.widget_album_art, scaled);

                        // Re-apply all text + intents (RemoteViews is additive)
                        artViews.setTextViewText(R.id.widget_title, title);
                        artViews.setTextViewText(R.id.widget_artist, artist);
                        artViews.setImageViewResource(R.id.widget_play_pause,
                                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
                        artViews.setOnClickPendingIntent(R.id.widget_prev,
                                makeServiceIntent(context, "com.mesob.tunes.ACTION_PREV", 1));
                        artViews.setOnClickPendingIntent(R.id.widget_play_pause,
                                makeServiceIntent(context, isPlaying ? "com.mesob.tunes.ACTION_PAUSE" : "com.mesob.tunes.ACTION_PLAY", 2));
                        artViews.setOnClickPendingIntent(R.id.widget_next,
                                makeServiceIntent(context, "com.mesob.tunes.ACTION_NEXT", 3));
                        if (launchIntent != null) {
                            PendingIntent lp = PendingIntent.getActivity(context, 0, launchIntent,
                                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                            artViews.setOnClickPendingIntent(R.id.widget_album_art, lp);
                            artViews.setOnClickPendingIntent(R.id.widget_title, lp);
                            artViews.setOnClickPendingIntent(R.id.widget_artist, lp);
                        }

                        new Handler(Looper.getMainLooper()).post(() ->
                                manager.updateAppWidget(widgetId, artViews));
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to load album art for widget", e);
                }
            });
        }
    }

    private PendingIntent makeServiceIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, AudioForegroundService.class);
        intent.setAction(action);
        return PendingIntent.getService(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Static helper — call from MediaBridge to trigger widget refresh */
    public static void triggerUpdate(Context context) {
        Intent intent = new Intent(ACTION_WIDGET_UPDATE);
        intent.setComponent(new ComponentName(context, TunesWidget.class));
        context.sendBroadcast(intent);
    }
}


