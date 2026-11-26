# Store-Ready Mobile Builds (TestFlight & Google Play Internal Testing)

This directory contains store listing metadata (`listing.md`) and store-ready screenshots (`screenshots/`) for the Brew-Bruvs Expo app (`apps/app`).

## Prerequisites (Maintainer)

1. Install the EAS CLI (`npm install -g eas-cli`) and sign in (`eas login`).
2. Link the Expo project once from `apps/app`:

   ```bash
   cd apps/app
   eas init
   ```

   _(Do not commit Apple/Google secrets or service-account JSON keys into the repository; configure credentials via `eas credentials` or CI environment variables.)_
3. Confirm the public Privacy Policy URL (`https://github.com/ironbeard21/brew-bruvs/blob/main/docs/privacy-policy.md`) is reachable before submitting.

## Build Profiles (`apps/app/eas.json`)

| Profile         | Platform(s)   | Purpose                                             |
| --------------- | ------------- | --------------------------------------------------- |
| `development`   | iOS / Android | Dev client build (iOS simulator / Android APK)      |
| `preview`       | iOS / Android | Internal ad-hoc / APK testing outside the stores    |
| `testflight`    | iOS           | Release IPA signed for App Store Connect TestFlight |
| `play-internal` | Android       | Release AAB signed for Google Play Internal Testing |
| `production`    | iOS / Android | Production App Store & Google Play release builds   |

## Building & Submitting

### iOS TestFlight

```bash
cd apps/app
eas build --platform ios --profile testflight
eas submit --platform ios --profile testflight --latest
```
Notes:

- `app.json` sets `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` (standard HTTPS + OS Keychain only) and includes `ios.privacyManifests` (`NSPrivacyTracking: false`, `UserDefaults` reason `CA92.1`).

### Android Google Play Internal Testing

```bash
cd apps/app
eas build --platform android --profile play-internal
eas submit --platform android --profile play-internal --latest
```
Notes:

- Builds an Android App Bundle (`.aab`) and targets the `internal` track as a `draft` release so the maintainer can verify in Play Console before promoting.
- Store credentials (Google Play service account JSON key) are passed via `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` or EAS Secrets — never committed to git.

## Store Checklist

- [ ] Icons & splash verified (`apps/app/assets/icon.png` 1024×1024 RGB no alpha, `adaptive-icon.png`, `splash-icon.png`, `notification-icon.png`, `favicon.png`)
- [ ] Listing text copied from `apps/app/store/listing.md`
- [ ] Screenshots uploaded from `apps/app/store/screenshots/` (`1290×2796`)
- [ ] Privacy Policy URL set in App Store Connect and Google Play Console (`docs/privacy-policy.md`)
- [ ] App Privacy / Data Safety marked as **No data collected, no tracking**
