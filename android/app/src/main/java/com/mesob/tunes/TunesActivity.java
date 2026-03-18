package com.mesob.tunes;

import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import androidx.activity.OnBackPressedCallback;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.view.WindowCompat;
import android.view.MotionEvent;

import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import org.json.JSONException;
import org.json.JSONObject;

public class TunesActivity extends AppCompatActivity {

    private static final String TAG = "TunesActivity";

    public static final String ACTION_MEDIA_BRIDGE = "com.mesob.tunes.MEDIA_BRIDGE_ACTION";
    public static final String EXTRA_ACTION = "action";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private BroadcastReceiver mediaBridgeReceiver;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean bridgeReady = false;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            setupWindow();
        } catch (Exception e) {
            Log.e(TAG, "setupWindow failed", e);
        }

        swipeRefresh = new SwipeRefreshLayout(this) {
            private boolean touchInTopZone = false;
            @Override
            public boolean onInterceptTouchEvent(MotionEvent ev) {
                if (ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    touchInTopZone = ev.getY() < getHeight() * 0.15f;
                }
                if (!touchInTopZone) return false;
                if (webView != null && webView.getScrollY() > 0) return false;
                return super.onInterceptTouchEvent(ev);
            }
        };
        webView = new WebView(this);
        swipeRefresh.addView(webView,
            new android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(swipeRefresh);

        swipeRefresh.setColorSchemeColors(Color.WHITE);
        swipeRefresh.setProgressBackgroundColorSchemeColor(0xFF1A1A1A);
        swipeRefresh.setOnRefreshListener(() -> {
            if (bridgeReady && webView != null) {
                webView.evaluateJavascript(
                    "if(window.__tunesRefs&&window.__tunesRefs.pullRefresh){window.__tunesRefs.pullRefresh()}else{'no-handler'}", null);
            }
            swipeRefresh.postDelayed(() -> swipeRefresh.setRefreshing(false), 5000);
        });

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setCacheMode(WebSettings.LOAD_DEFAULT);
        ws.setTextZoom(100);
        ws.setUseWideViewPort(false);
        ws.setLoadWithOverviewMode(false);
        ws.setSupportZoom(false);
        ws.setBuiltInZoomControls(false);

        webView.setBackgroundColor(Color.BLACK);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        webView.addJavascriptInterface(new TunesBridgeInterface(), "TunesBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                bridgeReady = true;
                Log.i(TAG, "Page loaded, bridge ready: " + url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("file:///android_asset/")) return false;
                if (url.startsWith("file:///")) {
                    // SPA route like file:///library — don't load, it doesn't exist as a real file
                    Log.w(TAG, "Blocked navigation to fake file:// route: " + url);
                    return true;
                }
                if (url.startsWith("com.mesob.tunes://")) return false;
                try {
                    CustomTabsIntent cti = new CustomTabsIntent.Builder().setShowTitle(true).build();
                    cti.launchUrl(TunesActivity.this, Uri.parse(url));
                } catch (Exception e) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                Log.e(TAG, "WebView error: " + errorCode + " " + description + " url=" + failingUrl);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d(TAG, "JS: " + cm.message() + " [" + cm.sourceId() + ":" + cm.lineNumber() + "]");
                return true;
            }
        });

        registerMediaBridgeReceiver();
        registerNetworkCallback();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridgeReady && webView != null) {
                    webView.evaluateJavascript(
                        "window.NativeBridge._emit('backButton',{});", null);
                } else {
                    finish();
                }
            }
        });

        webView.loadUrl("file:///android_asset/index.html");

        handleIntent(getIntent());
    }

    private void setupWindow() {
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController ic = getWindow().getInsetsController();
            if (ic != null) {
                ic.setSystemBarsAppearance(
                    0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            }
        } else {
            View decorView = getWindow().getDecorView();
            int flags = decorView.getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            decorView.setSystemUiVisibility(flags);
        }
    }

    // --- @JavascriptInterface Bridge ---

    private class TunesBridgeInterface {
        @JavascriptInterface
        public void call(final int callbackId, final String method, final String argsJson) {
            runOnUiThread(() -> {
                try {
                    JSONObject args = new JSONObject(argsJson);
                    JSONObject response = handleBridgeCall(method, args);
                    resolveCallback(callbackId, response);
                } catch (Exception e) {
                    Log.e(TAG, "Bridge call error: " + method, e);
                    resolveCallback(callbackId, errorResult());
                }
            });
        }
    }

    private void resolveCallback(int callbackId, JSONObject result) {
        if (webView == null) return;
        String js = "window.NativeBridge._res(" + callbackId + "," + result.toString() + ");";
        webView.evaluateJavascript(js, null);
    }

    private JSONObject handleBridgeCall(String method, JSONObject args) {
        switch (method) {
            case "updateNowPlaying": return handleUpdateNowPlaying(args);
            case "stopService": return handleStopService();
            case "setSleepTimer": return handleSetSleepTimer(args);
            case "clearSleepTimer": return handleClearSleepTimer();
            case "openBrowser": return handleOpenBrowser(args);
            case "getNetworkStatus": return handleGetNetworkStatus();
            case "refreshDone":
                if (swipeRefresh != null) swipeRefresh.setRefreshing(false);
                return successResult();
            case "startRefreshing":
                if (swipeRefresh != null) swipeRefresh.setRefreshing(true);
                return successResult();
            case "setRefreshEnabled":
                if (swipeRefresh != null) swipeRefresh.setEnabled(args.optBoolean("enabled", true));
                return successResult();
            case "exitApp":
                finish();
                return successResult();
            default:
                return errorResult();
        }
    }

    // --- Native Feature Handlers ---

    private JSONObject handleUpdateNowPlaying(JSONObject args) {
        Intent serviceIntent = new Intent(this, AudioForegroundService.class);
        serviceIntent.setAction(AudioForegroundService.ACTION_UPDATE);
        serviceIntent.putExtra("title", args.optString("title", ""));
        serviceIntent.putExtra("artist", args.optString("artist", ""));
        serviceIntent.putExtra("album", args.optString("album", ""));
        serviceIntent.putExtra("albumArt", args.optString("albumArt", ""));
        serviceIntent.putExtra("isPlaying", args.optBoolean("isPlaying", false));
        serviceIntent.putExtra("duration", (long)(args.optDouble("duration", 0) * 1000));
        serviceIntent.putExtra("position", (long)(args.optDouble("position", 0) * 1000));
        serviceIntent.putExtra("isLiked", args.optBoolean("isLiked", false));

        try {
            startForegroundService(serviceIntent);

            SharedPreferences prefs = getSharedPreferences(TunesWidget.PREFS_NAME, MODE_PRIVATE);
            prefs.edit()
                .putString("title", args.optString("title", ""))
                .putString("artist", args.optString("artist", ""))
                .putString("albumArt", args.optString("albumArt", ""))
                .putBoolean("isPlaying", args.optBoolean("isPlaying", false))
                .apply();
            TunesWidget.triggerUpdate(this);
            TunesWidgetLarge.triggerUpdate(this);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground service", e);
        }
        return successResult();
    }

    private JSONObject handleStopService() {
        try {
            stopService(new Intent(this, AudioForegroundService.class));
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop service", e);
        }
        return successResult();
    }

    private JSONObject handleSetSleepTimer(JSONObject args) {
        int minutes = args.optInt("minutes", 0);
        if (minutes <= 0) return errorResult();

        long triggerAt = SystemClock.elapsedRealtime() + (long) minutes * 60 * 1000;
        AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        PendingIntent pi = getSleepTimerPendingIntent();
        am.cancel(pi);
        am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
        return successResult();
    }

    private JSONObject handleClearSleepTimer() {
        AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        am.cancel(getSleepTimerPendingIntent());
        return successResult();
    }

    private PendingIntent getSleepTimerPendingIntent() {
        Intent intent = new Intent(this, SleepTimerReceiver.class);
        intent.setAction(SleepTimerReceiver.ACTION_SLEEP);
        return PendingIntent.getBroadcast(this, 99, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private JSONObject handleOpenBrowser(JSONObject args) {
        String url = args.optString("url", "");
        if (!url.isEmpty()) {
            try {
                CustomTabsIntent cti = new CustomTabsIntent.Builder().setShowTitle(true).build();
                cti.launchUrl(this, Uri.parse(url));
            } catch (Exception e) {
                Log.e(TAG, "CustomTabs failed, falling back to ACTION_VIEW: " + url, e);
                try {
                    Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(browserIntent);
                } catch (Exception e2) {
                    Log.e(TAG, "ACTION_VIEW also failed", e2);
                }
            }
        }
        return successResult();
    }

    @SuppressWarnings("deprecation")
    private JSONObject handleGetNetworkStatus() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            boolean connected = false;
            if (cm != null) {
                android.net.Network net = cm.getActiveNetwork();
                if (net != null) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                    connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                } else {
                    android.net.NetworkInfo info = cm.getActiveNetworkInfo();
                    connected = info != null && info.isConnected();
                }
            }
            JSONObject result = new JSONObject();
            result.put("connected", connected);
            result.put("success", true);
            return result;
        } catch (Exception e) {
            return errorResult();
        }
    }

    // --- Media Bridge Receiver ---

    private void registerMediaBridgeReceiver() {
        mediaBridgeReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getStringExtra(EXTRA_ACTION);
                if (action != null) {
                    pushEventToJS("mediaAction", action, intent);
                }
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_MEDIA_BRIDGE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(mediaBridgeReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(mediaBridgeReceiver, filter);
        }
    }

    private void pushEventToJS(String event, String action, Intent intent) {
        if (!bridgeReady || webView == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("action", action);
            if (intent.hasExtra("position")) {
                data.put("position", intent.getDoubleExtra("position", 0));
            }
            String js = "window.NativeBridge._emit(" +
                JSONObject.quote(event) + "," + data.toString() + ");";
            runOnUiThread(() -> {
                webView.resumeTimers();
                webView.evaluateJavascript(js, null);
            });
        } catch (JSONException e) {
            Log.e(TAG, "Failed to push event to JS", e);
        }
    }

    // --- Network Status Callback ---

    private void registerNetworkCallback() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return;
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(@NonNull Network network) {
                    pushNetworkStatus(true);
                }
                @Override
                public void onLost(@NonNull Network network) {
                    pushNetworkStatus(false);
                }
            };
            NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
            cm.registerNetworkCallback(request, networkCallback);
        } catch (Exception e) {
            Log.e(TAG, "Failed to register network callback", e);
        }
    }

    private void pushNetworkStatus(boolean connected) {
        if (!bridgeReady || webView == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("connected", connected);
            String js = "window.NativeBridge._emit('networkChange'," + data.toString() + ");";
            runOnUiThread(() -> webView.evaluateJavascript(js, null));
        } catch (JSONException e) {
            Log.e(TAG, "Failed to push network status", e);
        }
    }

    // --- Deep Link / OAuth Handling ---

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        String scheme = uri.getScheme();
        if ("com.mesob.tunes".equals(scheme)) {
            if (bridgeReady && webView != null) {
                try {
                    JSONObject data = new JSONObject();
                    data.put("url", uri.toString());
                    String js = "window.NativeBridge._emit('appUrlOpen'," + data.toString() + ");";
                    runOnUiThread(() -> webView.evaluateJavascript(js, null));
                } catch (JSONException e) {
                    Log.e(TAG, "Failed to push URL open event", e);
                }
            }
        }
    }

    // --- Lifecycle ---

    @Override
    protected void onResume() {
        super.onResume();
        if (bridgeReady && webView != null) {
            webView.evaluateJavascript(
                "window.NativeBridge._emit('appResumed',{});", null);
        }
    }

    @Override
    protected void onDestroy() {
        if (mediaBridgeReceiver != null) {
            try { unregisterReceiver(mediaBridgeReceiver); } catch (Exception ignored) {}
        }
        if (networkCallback != null) {
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                if (cm != null) cm.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {}
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // --- Helpers ---

    private static JSONObject successResult() {
        try {
            return new JSONObject().put("success", true);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static JSONObject errorResult() {
        try {
            return new JSONObject().put("success", false);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }
}
