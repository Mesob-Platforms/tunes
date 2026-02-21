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
        // Register the MediaBridge plugin before super (which loads Capacitor)
        registerPlugin(MediaBridge.class);

        super.onCreate(savedInstanceState);

        // ── Volume buttons always control media (not ringer) ──
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        // ── Content fits inside system bars (no edge-to-edge overlay) ──
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        // Status bar matches app background + black nav bar
        getWindow().setStatusBarColor(android.graphics.Color.BLACK);
        getWindow().setNavigationBarColor(android.graphics.Color.BLACK);

        // Light status bar icons = false → white icons on transparent bar (dark app)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().getInsetsController().setSystemBarsAppearance(
                0, android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
        } else {
            View decorView = getWindow().getDecorView();
            int flags = decorView.getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            decorView.setSystemUiVisibility(flags);
        }

        // ── WebView performance optimizations ──
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );

        // Optimize WebView settings after Capacitor initializes the bridge
        try {
            WebView wv = getBridge().getWebView();
            if (wv != null) {
                WebSettings ws = wv.getSettings();
                ws.setCacheMode(WebSettings.LOAD_DEFAULT);
                ws.setDomStorageEnabled(true);
                wv.setLayerType(View.LAYER_TYPE_HARDWARE, null);
            }
        } catch (Exception e) {
            // Bridge may not be ready yet — not critical
        }

        // Disable WebView debugging in production — prevents chrome://inspect access
        WebView.setWebContentsDebuggingEnabled(false);
    }
}
