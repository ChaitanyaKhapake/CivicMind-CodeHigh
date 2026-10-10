# CivicMind citizen app (Android)

The **citizen portal** packaged as an Android app with [Capacitor](https://capacitorjs.com). It uses the very
same HTML, CSS and JavaScript as the website (`../frontend`), so reporting, voice notes, 1–3 photos/videos,
address search, current location, the review step, tracking, the map, notifications, the chatbot and the
three languages work exactly as on the web. Officers and administrators keep using the website — the app
signs in **citizen accounts only**.

What differs from the website:

- `app/index.html` — an app sign-in / create-account screen with a **server address** setting
  (the app talks to your CivicMind server; nothing is stored on a third-party service).
- Leaflet and the Plus Jakarta Sans font are bundled (no CDN); map tiles still come from OpenStreetMap.
- `app/app-shell.js` — citizen-only guard and an offline banner.

## Use the APK

1. Copy `CivicMind-Citizen.apk` to the phone and open it (allow "install unknown apps" for your file manager).
2. Start the server the app will talk to:
   - **Local demo (same Wi-Fi):** run `run_demo_for_app.bat` on the computer. It prints the address to enter,
     e.g. `http://192.168.33.116:8000`. Allow Python through the Windows firewall for *private* networks.
   - **Deployment:** your HTTPS address, e.g. `https://civicmind.example.org`, with
     `CIVICMIND_CORS_ORIGINS=https://localhost` set on the server (the app's WebView origin).
3. In the app, open **🌐 Server**, enter the address, *Save & test*, then sign in or create a citizen account.

## Build

Requirements: Node 22+, JDK 21, Android SDK (platform 36, build-tools 36.1.0) — Android Studio provides them.

```bash
cd mobile
npm install
node scripts/make-resources.mjs          # app icon + splash sources from frontend/assets/logo.svg (once)
npx capacitor-assets generate --android --iconBackgroundColor "#FFFFFF" --splashBackgroundColor "#F5F8FC"
npm run sync                              # rebuild www/ from ../frontend and copy it into android/
cd android && gradlew.bat assembleRelease # or assembleDebug
```

Optional: `set CIVICMIND_APP_SERVER=https://civicmind.example.org` before `npm run sync` pre-fills that
server address in the app. Open `mobile/android` in Android Studio to run it on a device or emulator.

Outputs: `android/app/build/outputs/apk/release/app-release.apk` (signed) and
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Release signing — keep the key safe

`android/keystore/civicmind-release.jks` and `android/keystore.properties` (passwords) are generated locally
and **git-ignored**. Back them up somewhere safe: every future update of the app must be signed with the same
key, and a lost key means users have to uninstall and reinstall. Never commit or share them.

## Notes

- Android 7.0 (API 24) and newer. iPhone needs a Mac with Xcode (`npx cap add ios`); the web code is ready for it.
- Plain-HTTP servers are allowed so the local demo works; use HTTPS for real users.
- Camera, microphone and location permissions are requested only when the citizen uses those features.
