package com.mesob.tunes;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.RectF;
import android.graphics.Shader;
import android.util.Log;

import androidx.palette.graphics.Palette;

/**
 * Shared utilities for both compact and large Tunes widgets.
 * Handles blurred background compositing, color extraction, and bitmap manipulation.
 */
public final class WidgetHelper {

    private static final String TAG = "WidgetHelper";
    static final int DEFAULT_BG_COLOR = 0xCC111113;

    private WidgetHelper() {}

    /**
     * Creates a blurred, gradient-overlaid background bitmap from album art.
     * Uses downscale-upscale technique (no external libraries).
     */
    static Bitmap createBlurredBackground(Bitmap albumArt, int width, int height) {
        Bitmap tiny = Bitmap.createScaledBitmap(albumArt, 24, 24, true);
        Bitmap blurred = Bitmap.createScaledBitmap(tiny, width, height, true).copy(Bitmap.Config.ARGB_8888, true);
        tiny.recycle();

        int accentColor = extractAccentColor(albumArt);
        int gradientStart = Color.argb(0x66,
                Color.red(accentColor), Color.green(accentColor), Color.blue(accentColor));
        int gradientEnd = Color.argb(0xCC, 0, 0, 0);

        Canvas canvas = new Canvas(blurred);
        Paint gradientPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        LinearGradient gradient = new LinearGradient(
                0, 0, 0, height,
                new int[]{gradientStart, gradientEnd},
                null, Shader.TileMode.CLAMP);
        gradientPaint.setShader(gradient);
        canvas.drawRect(0, 0, width, height, gradientPaint);

        return blurred;
    }

    /**
     * Rounds the corners of a bitmap for pre-Android 12 devices.
     */
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
     * Extracts the most vibrant/colorful swatch from album art.
     * Prioritizes: Vibrant -> DarkVibrant -> Muted -> DarkMuted -> Dominant
     */
    static int extractAccentColor(Bitmap bitmap) {
        try {
            Palette palette = Palette.from(bitmap).maximumColorCount(16).generate();
            Palette.Swatch swatch = palette.getVibrantSwatch();
            if (swatch == null) swatch = palette.getDarkVibrantSwatch();
            if (swatch == null) swatch = palette.getMutedSwatch();
            if (swatch == null) swatch = palette.getDarkMutedSwatch();
            if (swatch == null) swatch = palette.getDominantSwatch();
            if (swatch != null) return swatch.getRgb();
        } catch (Exception e) {
            Log.w(TAG, "Palette extraction failed", e);
        }
        return 0xFF1A1A2E;
    }
}
