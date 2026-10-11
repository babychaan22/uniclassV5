# UniClass mobile builds

UniClass uses Capacitor to package the same Vite build for Android and iOS. The app identifier is `com.uniclass.app`.

## Daily workflow

Run `npm run mobile:sync` after web changes. It builds the web app and copies the result into both native projects.

## Android

1. Install Android Studio and an Android SDK (API 24 or newer).
2. Run `npm run mobile:android`.
3. In Android Studio, select an emulator or connected device, then run the `app` configuration.

The app requests camera access only for QR scanning. Android production releases are generated from Android Studio as an Android App Bundle (`.aab`).

## iOS

Building iOS requires a Mac with Xcode. On that machine, run `npm ci`, then `npm run mobile:ios`, select an iPhone simulator or device in Xcode, and run the app.

The iOS project includes the camera-use explanation required for QR scanning. Configure the Apple signing team and bundle identifier in Xcode before creating an App Store archive.
