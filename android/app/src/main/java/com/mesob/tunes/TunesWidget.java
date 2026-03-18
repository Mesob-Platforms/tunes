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

public class TunesWidget extends AppWidgetProvider {

    private static final String TAG = "TunesWidget";
    public static final String PREFS_NAME = "tunes_widget";
    public static final String ACTION_WIDGET_UPDATE = "com.mesob.tunes.WIDGET_UPDATE";

    private static final int BG_W = 1000;
    private static final int BG_H = 340;
    private static final int ART_SIZE = 300;
    private static final float ART_RADIUS_DP = 12f;
    private static final float BG_RADIUS_DP = 24f;

    private static final String ACTION_PLAY  = "com.mesob.tunes.ACTION_PLAY";
    private static final String ACTION_PAUSE = "com.mesob.tunes.ACTION_PAUSE";
    private static final String ACTION_NEXT  = "com.mesob.tunes.ACTION_NEXT";

    private static final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(ctx, mgr, id);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_WIDGET_UPDATE.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TunesWidget.class));
            for (int id : ids) updateWidget(ctx, mgr, id);
        }
    }

    private void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String title = prefs.getString("title", "Not Playing");
        String artist = prefs.getString("artist", "Tunes");
        boolean playing = prefs.getBoolean("isPlaying", false);
        String artUrl = prefs.getString("albumArt", "");

        RemoteViews v = buildViews(ctx, title, artist, playing, 0);
        mgr.updateAppWidget(widgetId, v);

        if (artUrl != null && !artUrl.isEmpty()) {
            loadArt(ctx, mgr, widgetId, artUrl, title, artist, playing);
        }
    }

    private RemoteViews buildViews(Context ctx, String title, String artist,
                                    boolean playing, int buttonTint) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_layout);
        v.setTextViewText(R.id.widget_title, title);
        v.setTextViewText(R.id.widget_artist, artist);
        v.setImageViewResource(R.id.widget_play_pause,
                playing ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play);
        v.setImageViewResource(R.id.widget_album_art, R.mipmap.ic_launcher);

        if (buttonTint != 0) {
            v.setInt(R.id.widget_play_pause, "setColorFilter", buttonTint);
            v.setInt(R.id.widget_next, "setColorFilter", buttonTint);
        }

        v.setOnClickPendingIntent(R.id.widget_play_pause,
                svcIntent(ctx, playing ? ACTION_PAUSE : ACTION_PLAY, 2));
        v.setOnClickPendingIntent(R.id.widget_next,
                svcIntent(ctx, ACTION_NEXT, 3));

        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch != null) {
            PendingIntent lp = PendingIntent.getActivity(ctx, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            v.setOnClickPendingIntent(R.id.widget_album_art, lp);
            v.setOnClickPendingIntent(R.id.widget_title, lp);
            v.setOnClickPendingIntent(R.id.widget_artist, lp);
        }
        return v;
    }

    private void loadArt(Context ctx, AppWidgetManager mgr, int wid,
                         String url, String title, String artist, boolean playing) {
        executor.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(5000);
                c.connect();
                Bitmap raw = BitmapFactory.decodeStream(c.getInputStream());
                c.disconnect();
                if (raw == null) return;

                float density = ctx.getResources().getDisplayMetrics().density;

                Bitmap frostedBg = WidgetHelper.createFrostedBackground(raw, BG_W, BG_H);
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                    Bitmap rounded = WidgetHelper.roundCorners(frostedBg, BG_RADIUS_DP, density);
                    frostedBg.recycle();
                    frostedBg = rounded;
                }

                Bitmap art = WidgetHelper.roundAlbumArt(raw, ART_SIZE, ART_RADIUS_DP, density);
                int buttonColor = WidgetHelper.extractLightColor(raw);
                raw.recycle();

                final Bitmap bg = frostedBg;
                final Bitmap albumArt = art;
                final int tint = buttonColor;

                new Handler(Looper.getMainLooper()).post(() -> {
                    RemoteViews v = buildViews(ctx, title, artist, playing, tint);
                    v.setImageViewBitmap(R.id.widget_bg, bg);
                    v.setImageViewBitmap(R.id.widget_album_art, albumArt);
                    mgr.updateAppWidget(wid, v);
                });
            } catch (Exception e) {
                Log.w(TAG, "Art load failed", e);
            }
        });
    }

    private PendingIntent svcIntent(Context ctx, String action, int rc) {
        Intent i = new Intent(ctx, AudioForegroundService.class);
        i.setAction(action);
        return PendingIntent.getService(ctx, rc, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void triggerUpdate(Context ctx) {
        Intent i = new Intent(ACTION_WIDGET_UPDATE);
        i.setComponent(new ComponentName(ctx, TunesWidget.class));
        ctx.sendBroadcast(i);
    }
}
