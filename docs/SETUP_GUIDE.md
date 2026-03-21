# Tunes – Setup & Build Guide

Follow these steps in order. I’ll Build and sync are done. You do the one-time Google and keystore setup.

---

## Step 1: Google Cloud Console (for native Google Sign-In)

1. Go to **[Google Cloud Console](https://console.cloud.google.com/)** and sign in.
2. Create or select a project (e.g. “Tunes”).
3. **Enable APIs**
   - Go to **APIs & Services → Library**.
   - Search for **Google+ API** (or **Google Identity**) and enable it if needed.
   - Search for **Supabase** – you don’t need to enable anything for Supabase; your app uses Supabase’s own Google config.
4. **Create OAuth credentials**
   - Go to **APIs & Services → Credentials**.
   - Click **Create Credentials → OAuth client ID**.
   - If asked, set **Application type** to **Web application** first, then create the **Android** client (see below).
   - For **Android**:
     - **Application type:** Android
     - **Name:** Tunes Android (or any name)
     - **Package name:** `com.mesob.tunes`
     - **SHA-1:** (see Step 2 below – you’ll add this after creating the keystore)
   - Click **Create**. Copy the **Client ID** (looks like `xxxxx.apps.googleusercontent.com`).
5. **Add the Android Client ID to the app**
   - Open `js/accounts/config.js` in this project.
   - Set `GOOGLE_WEB_CLIENT_ID` to your **Web application** Client ID (not the Android one).  
     Supabase uses the Web client ID for `signInWithIdToken`; the Android OAuth client is used by the native plugin to get the ID token.
   - If the plugin expects the Android client ID in config, use the **Android** Client ID in `config.js`.  
     (Typical setup: one Web client for Supabase dashboard, one Android client for the app; the plugin often uses the Web client ID in code. Check `capacitor-native-google-one-tap-signin` docs for which ID to put in config.)

**If you don’t have SHA-1 yet:** Create the Android OAuth client after Step 2, then add the SHA-1 in Credentials → your Android client → Edit.

---

## Step 2: Keystore (for release APK signing)

Run this in a terminal (PowerShell or Command Prompt). One-time only.

```bash
cd "c:\Users\NaolMId\Documents\cursor ai\tunes\android\app"
keytool -genkey -v -keystore tunes-release.keystore -alias tunes -keyalg RSA -keysize 2048 -validity 10000
```

- It will ask for a **keystore password** and an **alias password** – pick strong ones and **write them down**.
- Fill in name/org (can be anything).
- **Do not lose the keystore file or passwords** – you need them for every future update.

**Get SHA-1 for Google Console:**

```bash
keytool -list -v -keystore tunes-release.keystore -alias tunes
```

Copy the **SHA-1** line and add it to your Android OAuth client in Google Cloud Console (Step 1).

---

## Step 3: Build the web app and sync to Android

From the project root:

```bash
cd "c:\Users\NaolMId\Documents\cursor ai\tunes"
npm run build
npx cap sync android
```

---

## Step 4: Open in Android Studio and build APK

1. Open Android Studio.
2. **File → Open** → select `c:\Users\NaolMId\Documents\cursor ai\tunes\android`.
3. Wait for Gradle sync.
4. **Build → Generate Signed Bundle / APK** → choose **APK** → **Next**.
5. **Create new** (or choose existing) keystore:
   - **Key store path:** `android/app/tunes-release.keystore`
   - **Passwords:** the ones you set in Step 2.
   - **Alias:** `tunes` → **Key password:** same as alias password.
6. Pick **release** build type, then **Finish**.

The signed APK will be in `android/app/release/app-release.apk`. Install that on your device or share it.

---

## Step 5: Run on device/emulator (debug)

- Connect a phone (USB debugging on) or start an emulator.
- In Android Studio, pick the device and click the green **Run** button.

---

## Quick reference

| Step | Who does it | What |
|------|-------------|------|
| 1 | You | Google Cloud: create project, Android OAuth client, add SHA-1, copy Client ID into `js/accounts/config.js` |
| 2 | You | `keytool` keystore + SHA-1 for Google |
| 3 | Me / You | `npm run build` and `npx cap sync android` |
| 4 | You | Android Studio: Generate Signed APK with your keystore |
| 5 | You | Run app on device/emulator |

If you tell me where you are (e.g. “done Step 1”, “need help with config.js”), I’ll give you the exact next steps and, if you want, the exact config.js snippet once you have your Client ID.
