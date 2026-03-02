# Continue with Google – Setup (one-time)

Your app already has the **Web** Client ID in `js/accounts/config.js`. To make "Continue with Google" work on the **Android** app, add an **Android** OAuth client in the same Google Cloud project and register your app with this SHA-1.

---

## 1. Open Google Cloud Console

Go to: **https://console.cloud.google.com/**

Sign in with the same Google account you use for Supabase (or the one that owns the project where your **Web** client `917537000667-...` lives).

---

## 2. Select the right project

In the top bar, click the project name and choose the project that already has your **Web application** OAuth client (the one in config.js). If you’re not sure, open **APIs & Services → Credentials** and check that you see a Web client with ID like `917537000667-ddotjubit837hn0bnginptc1ihrnqaql.apps.googleusercontent.com`.

---

## 3. Create the Android OAuth client

1. Go to **APIs & Services** → **Credentials**.
2. Click **+ Create Credentials** → **OAuth client ID**.
3. If asked to set the OAuth consent screen first, choose **External** (or keep existing), add your email if needed, and save.
4. Back in **Create OAuth client ID**:
   - **Application type:** **Android**
   - **Name:** e.g. `Tunes Android`
   - **Package name:** `com.mesob.tunes`
   - **SHA-1 certificate fingerprint:** paste the value below (from `SHA1_FOR_GOOGLE.txt`).
5. Click **Create**.

You don’t need to copy the Android Client ID into the app. The app keeps using the **Web** Client ID in `config.js`; the Android client only tells Google that this app (package + SHA-1) is allowed to get tokens.

---

## 4. Supabase (optional check)

- In **Supabase Dashboard** → **Authentication** → **Providers** → **Google**, the Client ID and Secret should be the **Web** client from the same Google Cloud project.
- Your `config.js` already has that Web Client ID; no change needed there.

---

## 5. Rebuild and test

After saving the Android OAuth client:

1. Rebuild the web app and sync to Android (or use your existing build).
2. Install the APK on a device and open the app.
3. Tap **Continue with Google** – you should get the native account picker and then be signed in.

If it still fails, check:

- Package name is exactly `com.mesob.tunes`.
- SHA-1 is exactly the one from `SHA1_FOR_GOOGLE.txt` (no extra spaces, same colons).
- Web client in Supabase matches the one in `config.js`.
