package com.mesob.tunes;

import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Isolate WebView data directory from Chrome / System WebView.
        // Without this, some devices share cache/cookies between the app and Chrome.
        // Must be called BEFORE any WebView is instantiated (before super.onCreate).
        try {
            WebView.setDataDirectorySuffix("tunes_app");
        } catch (IllegalStateException ignored) {
            // Already set in this process or WebView already created
        }

        registerPlugin(MediaBridge.class);
        super.onCreate(savedInstanceState);

        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(android.graphics.Color.BLACK);
        getWindow().setNavigationBarColor(android.graphics.Color.BLACK);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().getInsetsController().setSystemBarsAppearance(
                0, android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
        } else {
            View decorView = getWindow().getDecorView();
            int flags = decorView.getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            decorView.setSystemUiVisibility(flags);
        }

        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        // Keep screen on while music is playing (managed by JS via keepAwake if needed)
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        configureWebView();

        WebView.setWebContentsDebuggingEnabled(false);
    }

    private void configureWebView() {
        try {
            WebView wv = getBridge().getWebView();
            if (wv == null) return;

            WebSettings ws = wv.getSettings();

            // --- Storage & Cache ---
            ws.setCacheMode(WebSettings.LOAD_DEFAULT);
            ws.setDomStorageEnabled(true);
            ws.setDatabaseEnabled(true);
            ws.setAllowFileAccess(true);

            // --- Audio ---
            ws.setMediaPlaybackRequiresUserGesture(false);

            // --- Disable browser-like behavior ---
            ws.setBuiltInZoomControls(false);
            ws.setDisplayZoomControls(false);
            ws.setSupportZoom(false);
            ws.setTextZoom(100);
            ws.setGeolocationEnabled(false);

            // --- Security ---
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            ws.setAllowFileAccessFromFileURLs(false);
            ws.setAllowUniversalAccessFromFileURLs(false);

            // --- Performance ---
            wv.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            ws.setOffscreenPreRaster(true);

            // --- Native feel: kill all web-like visual artifacts ---
            wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
            wv.setVerticalScrollBarEnabled(false);
            wv.setHorizontalScrollBarEnabled(false);
            wv.setOnLongClickListener(v -> true);
            wv.setLongClickable(false);
            wv.setHapticFeedbackEnabled(false);

        } catch (Exception e) {
            // Bridge may not be ready yet — non-fatal
        }
    }
}
