# ─── Capacitor / WebView app ProGuard rules ──────────────────────

# Keep Capacitor plugin classes and their annotated methods
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public *;
}

# Keep our custom native classes
-keep class com.mesob.tunes.** { *; }

# Keep WebView JavaScript interface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep AndroidX Media classes (MediaSession, notifications)
-keep class androidx.media.** { *; }
-keep class android.support.v4.media.** { *; }

# Keep AppWidgetProvider
-keep class * extends android.appwidget.AppWidgetProvider { *; }

# Keep BroadcastReceivers
-keep class * extends android.content.BroadcastReceiver { *; }

# Keep Service classes
-keep class * extends android.app.Service { *; }

# Don't warn about missing optional dependencies
-dontwarn com.google.android.gms.**
-dontwarn org.apache.http.**
-dontwarn com.google.firebase.**

# Keep R8 from stripping enum values
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Keep Parcelable implementations
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}
