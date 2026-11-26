# Brew-Bruvs Privacy Policy

_Last updated: 2026-11-25_

Brew-Bruvs is free, open-source (AGPL-3.0-or-later), self-hosted software for making beer, mead, wine, and cider. Privacy is built into the architecture: there is no central Brew-Bruvs cloud service, no tracking, and no advertising.

## 1. No tracking or telemetry

The Brew-Bruvs mobile apps (iOS and Android) and web app contain:

- **No analytics or crash-reporting SDKs**
- **No advertising networks or cross-app tracking**
- **No third-party push notification servers** (all brew-day timers, batch reminders, and low-stock alerts are scheduled locally on your device)

## 2. Your data stays on your own server

When you connect Brew-Bruvs to a server, you enter the address of a self-hosted Brew-Bruvs server operated by you or someone you trust (such as your homebrew club).

- All account data, recipes, batches, fermentation readings, notes, inventory, equipment, and brewery memberships are sent **only** to the server address you configure.
- The Brew-Bruvs project maintainers do **not** operate a central server and never receive your server address, credentials, or brewing data.
- If you use the calculators in **Offline Mode**, the app makes no network requests at all.

If you connect to a Brew-Bruvs server hosted by someone else (such as a club administrator), that server operator controls how data on their server is stored, backed up, and deleted.

## 3. Data stored locally on your device

The app stores only the minimum state needed to work reliably on your device:

- **Server URL(s) and session token:** stored in iOS Keychain / Android Keystore via Expo SecureStore on mobile (or browser storage on web) so you stay signed in.
- **App preferences:** your chosen unit system (US or Metric) and active workspace selection.
- **Local notification state:** IDs of locally scheduled brew-day timers, batch reminders, and low-stock alert deduplication state so the app can cancel completed reminders and avoid duplicate alerts.

Signing out clears your session token. Disconnecting or removing a saved server removes its stored address from your device.

## 4. Device permissions

Brew-Bruvs requests only minimal, optional permissions when you use the corresponding feature:

- **Notifications (optional):** used strictly for local, on-device brew-day timers, batch reminders, and low-stock alerts.
- **Files / Document Picker (on demand):** used only when you explicitly choose a BeerXML or BeerJSON file from your device to import a recipe. The app only reads the single file you select.

Brew-Bruvs does not request access to your location, contacts, camera, microphone, or photo library.

## 5. Source code & contact

Brew-Bruvs is open source under the GNU AGPL-3.0-or-later license. You can inspect every line of code and verify these privacy guarantees at:

- Repository: https://github.com/ironbeard21/brew-bruvs
- Issues & questions: https://github.com/ironbeard21/brew-bruvs/issues
