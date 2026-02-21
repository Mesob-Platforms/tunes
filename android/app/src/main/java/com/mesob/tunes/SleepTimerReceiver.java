package com.mesob.tunes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Fires when the native AlarmManager sleep timer triggers.
 * Sends a "stop" action to the foreground service to pause playback,
 * and also notifies the JS side via MediaBridge broadcast.
 */
public class SleepTimerReceiver extends BroadcastReceiver {

    private static final String TAG = "SleepTimerReceiver";
    public static final String ACTION_SLEEP = "com.mesob.tunes.ACTION_SLEEP_TIMER";

    @Override
    public void onReceive(Context context, Intent intent) {
        Log.i(TAG, "Sleep timer fired — pausing playback");

        // Tell the foreground service to pause
        Intent svcIntent = new Intent(context, AudioForegroundService.class);
        svcIntent.setAction("com.mesob.tunes.ACTION_PAUSE");
        try {
            context.startService(svcIntent);
        } catch (Exception e) {
            Log.w(TAG, "Could not send pause to service", e);
        }

        // Also notify JS so the UI updates (the JS timer may have already fired)
        Intent bridgeIntent = new Intent(MediaBridge.ACTION_MEDIA_BRIDGE);
        bridgeIntent.setPackage(context.getPackageName());
        bridgeIntent.putExtra(MediaBridge.EXTRA_ACTION, "sleepTimerFired");
        context.sendBroadcast(bridgeIntent);
    }
}


