package com.mesob.tunes;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin that bridges the JS player state to the native
 * AudioForegroundService / MediaNotificationManager.
 *
 * JS  →  updateNowPlaying({ title, artist, album, albumArt, isPlaying, duration, position, isLiked })
 * JS  →  stopService()
 * Native  →  notifyListeners("mediaAction", { action: "play"|"pause"|"next"|"prev"|"like" })
 */
@CapacitorPlugin(name = "MediaBridge")
public class MediaBridge extends Plugin {

    private static final String TAG = "MediaBridge";

    public static final String ACTION_MEDIA_BRIDGE = "com.mesob.tunes.MEDIA_BRIDGE_ACTION";
    public static final String EXTRA_ACTION = "action";

    private BroadcastReceiver actionReceiver;

    @Override
    public void load() {
        // Listen for actions from the notification buttons (forwarded via broadcast)
        actionReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getStringExtra(EXTRA_ACTION);
                if (action != null) {
                    JSObject data = new JSObject();
                    data.put("action", action);
                    notifyListeners("mediaAction", data);
                }
            }
        };

        IntentFilter filter = new IntentFilter(ACTION_MEDIA_BRIDGE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(actionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(actionReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (actionReceiver != null) {
            try {
                getContext().unregisterReceiver(actionReceiver);
            } catch (Exception ignored) {}
        }
    }

    /**
     * Called by JS whenever the player state changes (track change, play/pause, seek, like toggle).
     * Starts or updates the foreground service + notification.
     */
    @PluginMethod()
    public void updateNowPlaying(PluginCall call) {
        String title    = call.getString("title", "");
        String artist   = call.getString("artist", "");
        String album    = call.getString("album", "");
        String albumArt = call.getString("albumArt", "");
        boolean isPlaying = call.getBoolean("isPlaying", false);
        double duration  = call.getDouble("duration", 0.0);
        double position  = call.getDouble("position", 0.0);
        boolean isLiked  = call.getBoolean("isLiked", false);

        Intent serviceIntent = new Intent(getContext(), AudioForegroundService.class);
        serviceIntent.setAction(AudioForegroundService.ACTION_UPDATE);
        serviceIntent.putExtra("title", title);
        serviceIntent.putExtra("artist", artist);
        serviceIntent.putExtra("album", album);
        serviceIntent.putExtra("albumArt", albumArt);
        serviceIntent.putExtra("isPlaying", isPlaying);
        serviceIntent.putExtra("duration", (long) (duration * 1000)); // seconds → ms
        serviceIntent.putExtra("position", (long) (position * 1000));
        serviceIntent.putExtra("isLiked", isLiked);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }

            // Persist to SharedPreferences so the home-screen widget can read it
            SharedPreferences prefs = getContext()
                    .getSharedPreferences(TunesWidget.PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString("title", title)
                    .putString("artist", artist)
                    .putString("albumArt", albumArt)
                    .putBoolean("isPlaying", isPlaying)
                    .apply();

            // Trigger widget refresh
            TunesWidget.triggerUpdate(getContext());

            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground service", e);
            call.reject("Failed to start service: " + e.getMessage());
        }
    }

    /**
     * Set a native AlarmManager-based sleep timer (backup for the JS timer).
     * JS calls: MediaBridge.setSleepTimer({ minutes: 30 })
     */
    @PluginMethod()
    public void setSleepTimer(PluginCall call) {
        int minutes = call.getInt("minutes", 0);
        if (minutes <= 0) {
            call.reject("minutes must be > 0");
            return;
        }

        long triggerAt = SystemClock.elapsedRealtime() + (long) minutes * 60 * 1000;

        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = getSleepTimerPendingIntent();

        // Cancel any existing alarm first
        am.cancel(pi);

        // Use setExactAndAllowWhileIdle for reliability on doze-mode devices
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
        } else {
            am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
        }

        Log.i(TAG, "Native sleep timer set for " + minutes + " minutes");
        call.resolve();
    }

    /**
     * Cancel the native sleep timer alarm.
     */
    @PluginMethod()
    public void clearSleepTimer(PluginCall call) {
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        am.cancel(getSleepTimerPendingIntent());
        Log.i(TAG, "Native sleep timer cancelled");
        call.resolve();
    }

    private PendingIntent getSleepTimerPendingIntent() {
        Intent intent = new Intent(getContext(), SleepTimerReceiver.class);
        intent.setAction(SleepTimerReceiver.ACTION_SLEEP);
        return PendingIntent.getBroadcast(getContext(), 99, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /**
     * Stop the foreground service (e.g. when the user closes the player entirely).
     */
    @PluginMethod()
    public void stopService(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), AudioForegroundService.class);
            getContext().stopService(serviceIntent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop service", e);
            call.reject("Failed to stop service: " + e.getMessage());
        }
    }
}

