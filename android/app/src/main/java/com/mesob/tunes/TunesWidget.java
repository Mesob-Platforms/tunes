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
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.RemoteViews;

import androidx.palette.graphics.Palette;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TunesWidget extends AppWidgetProvider {

    private static final String TAG = "TunesWidget";
    public static final String PREFS_NAME = "tunes_widget";
    public static final String ACTION_WIDGET_UPDATE = "com.mesob.tunes.WIDGET_UPDATE";
    private static final int DEFAULT_BG_COLOR = 0x99111113;
    private static final int ACCENT_COLOR = 0xFF035480;

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

        views.setImageViewResource(R.id.widget_play_pause,
                isPlaying ? R.drawable.ic_notif_pause : R.drawable.ic_notif_play);

        views.setOnClickPendingIntent(R.id.widget_prev,
                makeServiceIntent(context, "com.mesob.tunes.ACTION_PREV", 1));
        views.setOnClickPendingIntent(R.id.widget_play_pause,
                makeServiceIntent(context, isPlaying ? "com.mesob.tunes.ACTION_PAUSE" : "com.mesob.tunes.ACTION_PLAY", 2));
        views.setOnClickPendingIntent(R.id.widget_next,
                makeServiceIntent(context, "com.mesob.tunes.ACTION_NEXT", 3));

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            PendingIntent launchPending = PendingIntent.getActivity(
                    context, 0, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_album_art, launchPending);
            views.setOnClickPendingIntent(R.id.widget_title, launchPending);
            views.setOnClickPendingIntent(R.id.widget_artist, launchPending);
        }

        manager.updateAppWidget(widgetId, views);

        if (albumArtUrl != null && !albumArtUrl.isEmpty()) {
            final Intent fLaunchIntent = launchIntent;
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
                        Bitmap scaled = Bitmap.createScaledBitmap(bitmap, 128, 128, true);
                        if (scaled != bitmap) bitmap.recycle();

                        int bgColor = DEFAULT_BG_COLOR;
                        try {
                            Palette palette = Palette.from(scaled).generate();
                            Palette.Swatch swatch = palette.getDarkMutedSwatch();
                            if (swatch == null) swatch = palette.getMutedSwatch();
                            if (swatch == null) swatch = palette.getDominantSwatch();
                            if (swatch != null) {
                                int rgb = swatch.getRgb();
                                bgColor = Color.argb(0xB3, Color.red(rgb), Color.green(rgb), Color.blue(rgb));
                            }
                        } catch (Exception pe) {
                            Log.w(TAG, "Palette extraction failed", pe);
                        }

                        RemoteViews artViews = new RemoteViews(context.getPackageName(), R.layout.widget_layout);
                        artViews.setImageViewBitmap(R.id.widget_album_art, scaled);
                        artViews.setInt(R.id.widget_root, "setBackgroundColor", bgColor);

                        artViews.setTextViewText(R.id.widget_title, title);
                        artViews.setTextViewText(R.id.widget_artist, artist);
                        artViews.setImageViewResource(R.id.widget_play_pause,
                                isPlaying ? R.drawable.ic_notif_pause : R.drawable.ic_notif_play);
                        artViews.setOnClickPendingIntent(R.id.widget_prev,
                                makeServiceIntent(context, "com.mesob.tunes.ACTION_PREV", 1));
                        artViews.setOnClickPendingIntent(R.id.widget_play_pause,
                                makeServiceIntent(context, isPlaying ? "com.mesob.tunes.ACTION_PAUSE" : "com.mesob.tunes.ACTION_PLAY", 2));
                        artViews.setOnClickPendingIntent(R.id.widget_next,
                                makeServiceIntent(context, "com.mesob.tunes.ACTION_NEXT", 3));
                        if (fLaunchIntent != null) {
                            PendingIntent lp = PendingIntent.getActivity(context, 0, fLaunchIntent,
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

    public static void triggerUpdate(Context context) {
        Intent intent = new Intent(ACTION_WIDGET_UPDATE);
        intent.setComponent(new ComponentName(context, TunesWidget.class));
        context.sendBroadcast(intent);
    }
}
