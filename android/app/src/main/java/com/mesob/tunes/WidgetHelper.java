package com.mesob.tunes;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.util.Log;

import androidx.palette.graphics.Palette;

public final class WidgetHelper {

    private static final String TAG = "WidgetHelper";

    private WidgetHelper() {}

    /**
     * Creates a heavily blurred, frosted-glass background from album art.
     * Downscales to 6x6 for extreme blur, upscales, then overlays a
     * semi-transparent matte color extracted from the art via Palette.
     */
    static Bitmap createFrostedBackground(Bitmap albumArt, int width, int height) {
        Bitmap tiny = Bitmap.createScaledBitmap(albumArt, 6, 6, true);
        Bitmap mid = Bitmap.createScaledBitmap(tiny, 50, 50, true);
        tiny.recycle();
        Bitmap blurred = Bitmap.createScaledBitmap(mid, width, height, true)
                .copy(Bitmap.Config.ARGB_8888, true);
        mid.recycle();

        int accent = extractDarkColor(albumArt);

        Canvas canvas = new Canvas(blurred);
        Paint glassPaint = new Paint();
        glassPaint.setColor(Color.argb(0xCC,
                Color.red(accent), Color.green(accent), Color.blue(accent)));
        canvas.drawRect(0, 0, width, height, glassPaint);

        Paint veilPaint = new Paint();
        veilPaint.setColor(Color.argb(0x33, 0, 0, 0));
        canvas.drawRect(0, 0, width, height, veilPaint);

        return blurred;
    }

    static Bitmap roundCorners(Bitmap bitmap, float radiusDp, float density) {
        float radiusPx = radiusDp * density;
        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        Bitmap output = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        Paint clipPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        RectF rect = new RectF(0, 0, w, h);
        canvas.drawRoundRect(rect, radiusPx, radiusPx, clipPaint);
        clipPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        canvas.drawBitmap(bitmap, 0, 0, clipPaint);
        return output;
    }

    /**
     * Rounds album art corners into a bitmap suitable for RemoteViews.
     */
    static Bitmap roundAlbumArt(Bitmap albumArt, int size, float radiusDp, float density) {
        Bitmap scaled = Bitmap.createScaledBitmap(albumArt, size, size, true);
        return roundCorners(scaled, radiusDp, density);
    }

    static int extractDarkColor(Bitmap bitmap) {
        try {
            Palette palette = Palette.from(bitmap).maximumColorCount(16).generate();
            Palette.Swatch s = palette.getDarkMutedSwatch();
            if (s == null) s = palette.getDarkVibrantSwatch();
            if (s == null) s = palette.getMutedSwatch();
            if (s == null) s = palette.getDominantSwatch();
            if (s != null) return s.getRgb();
        } catch (Exception e) {
            Log.w(TAG, "Palette failed", e);
        }
        return 0xFF1A1A2E;
    }
}
