# Keep the @JavascriptInterface bridge so WebView can call it
-keepclassmembers class com.mesob.tunes.TunesActivity$TunesBridgeInterface {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep our app classes
-keep class com.mesob.tunes.TunesActivity { *; }
-keep class com.mesob.tunes.AudioForegroundService { *; }
-keep class com.mesob.tunes.NotificationActionReceiver { *; }
-keep class com.mesob.tunes.SleepTimerReceiver { *; }
-keep class com.mesob.tunes.TunesWidget { *; }
