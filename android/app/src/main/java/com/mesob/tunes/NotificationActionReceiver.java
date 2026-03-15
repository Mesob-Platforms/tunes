package com.mesob.tunes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Receives PendingIntent broadcasts from the media notification action buttons
 * and forwards them to the AudioForegroundService / MediaBridge via a local broadcast.
 */
public class NotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        String bridgeAction = null;

        switch (action) {
            case AudioForegroundService.ACTION_PLAY:
                bridgeAction = "play";
                break;
            case AudioForegroundService.ACTION_PAUSE:
                bridgeAction = "pause";
                break;
            case AudioForegroundService.ACTION_NEXT:
                bridgeAction = "next";
                break;
            case AudioForegroundService.ACTION_PREV:
                bridgeAction = "prev";
                break;
            case AudioForegroundService.ACTION_LIKE:
                bridgeAction = "like";
                break;
            case AudioForegroundService.ACTION_STOP:
                bridgeAction = "stop";
                break;
        }

        if (bridgeAction != null) {
            // Forward to MediaBridge plugin via broadcast
            Intent bridgeIntent = new Intent(TunesActivity.ACTION_MEDIA_BRIDGE);
            bridgeIntent.setPackage(context.getPackageName());
            bridgeIntent.putExtra(TunesActivity.EXTRA_ACTION, bridgeAction);
            context.sendBroadcast(bridgeIntent);
        }
    }
}


