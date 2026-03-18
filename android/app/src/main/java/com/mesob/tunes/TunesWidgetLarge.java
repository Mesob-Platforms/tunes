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
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.RemoteViews;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class TunesWidgetLarge extends AppWidgetProvider {

    private static final String TAG = "TunesWidgetLarge";
    public static final String ACTION_WIDGET_LARGE_UPDATE = "com.mesob.tunes.WIDGET_LARGE_UPDATE";

    private static final int BG_WIDTH = 600;
    private static final int BG_HEIGHT = 400;
    private static final float CORNER_RADIUS_DP = 24f;

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
        if (ACTION_WIDGET_LARGE_UPDATE.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, TunesWidgetLarge.class));
            for (int id : ids) {
                updateWidget(context, manager, id);
            }
        }
    }

    private void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(TunesWidget.PREFS_NAME, Context.MODE_PRIVATE);

        String title = prefs.getString("title", "Not Playing");
        String artist = prefs.getString("artist", "Tunes");
        boolean isPlaying = prefs.getBoolean("isPlaying", false);
        String albumArtUrl = prefs.getString("albumArt", "");

        RemoteViews views = buildRemoteViews(context, title, artist, isPlaying);
        manager.updateAppWidget(widgetId, views);

        if (albumArtUrl != null && !albumArtUrl.isEmpty()) {
            loadArtAndUpdate(context, manager, widgetId, albumArtUrl, title, artist, isPlaying);
        }
    }

    private RemoteViews buildRemoteViews(Context context, String title, String artist, boolean isPlaying) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_layout_large);
        views.setTextViewText(R.id.widget_title, title);
        views.setTextViewText(R.id.widget_artist, artist);

        views.setImageViewResource(R.id.widget_play_pause,
                isPlaying ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play);

        views.setOnClickPendingIntent(R.id.widget_prev,
                makeServiceIntent(context, "com.mesob.tunes.ACTION_PREV", 11));
        views.setOnClickPendingIntent(R.id.widget_play_pause,
                makeServiceIntent(context, isPlaying ? "com.mesob.tunes.ACTION_PAUSE" : "com.mesob.tunes.ACTION_PLAY", 12));
        views.setOnClickPendingIntent(R.id.widget_next,
                makeServiceIntent(context, "com.mesob.tunes.ACTION_NEXT", 13));

        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launchIntent != null) {
            PendingIntent lp = PendingIntent.getActivity(
                    context, 10, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widget_album_art, lp);
            views.setOnClickPendingIntent(R.id.widget_title, lp);
            views.setOnClickPendingIntent(R.id.widget_artist, lp);
        }

        return views;
    }

    private void loadArtAndUpdate(Context context, AppWidgetManager manager, int widgetId,
                                   String albumArtUrl, String title, String artist, boolean isPlaying) {
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

                if (bitmap == null) return;

                Bitmap albumThumb = Bitmap.createScaledBitmap(bitmap, 192, 192, true);
                Bitmap blurredBg = WidgetHelper.createBlurredBackground(bitmap, BG_WIDTH, BG_HEIGHT);

                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                    float density = context.getResources().getDisplayMetrics().density;
                    Bitmap rounded = WidgetHelper.roundCorners(blurredBg, CORNER_RADIUS_DP, density);
                    blurredBg.recycle();
                    blurredBg = rounded;
                }

                if (albumThumb != bitmap) bitmap.recycle();

                final Bitmap finalBg = blurredBg;
                final Bitmap finalArt = albumThumb;

                new Handler(Looper.getMainLooper()).post(() -> {
                    RemoteViews views = buildRemoteViews(context, title, artist, isPlaying);
                    views.setImageViewBitmap(R.id.widget_bg, finalBg);
                    views.setImageViewBitmap(R.id.widget_album_art, finalArt);
                    manager.updateAppWidget(widgetId, views);
                });
            } catch (Exception e) {
                Log.w(TAG, "Failed to load album art for large widget", e);
            }
        });
    }

    private PendingIntent makeServiceIntent(Context context, String action, int requestCode) {
        Intent intent = new Intent(context, AudioForegroundService.class);
        intent.setAction(action);
        return PendingIntent.getService(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void triggerUpdate(Context context) {
        Intent intent = new Intent(ACTION_WIDGET_LARGE_UPDATE);
        intent.setComponent(new ComponentName(context, TunesWidgetLarge.class));
        context.sendBroadcast(intent);
    }
}
