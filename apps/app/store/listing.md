# Store Listing Copy — Brew-Bruvs

Ready-to-paste metadata for **Apple App Store Connect (TestFlight & App Store)** and **Google Play Console (Internal Testing & Production)**.

---

## Core Metadata

- **App Name:** Brew-Bruvs
- **Subtitle (iOS, ≤30 chars):** Self-Hosted Brewing Companion _(29 chars)_
- **Short Description (Google Play, ≤80 chars):** Self-hosted recipes, calculators, batch tracking & inventory for brewers. _(73 chars)_
- **Primary Category:** Food & Drink (iOS) / Food & Drink or Tools (Google Play)
- **Secondary Category (iOS):** Utilities
- **Bundle ID (iOS) / Application ID (Android):** `org.brewbruvs.app`
- **License:** GNU AGPL-3.0-or-later (free, open source, no ads, no IAPs)
- **Support URL:** `https://github.com/ironbeard21/brew-bruvs/issues`
- **Marketing / Source URL:** `https://github.com/ironbeard21/brew-bruvs`
- **Privacy Policy URL:** `https://github.com/ironbeard21/brew-bruvs/blob/main/docs/privacy-policy.md`

---

## Promotional Text (iOS, ≤170 chars)

> Build recipes, track batches, run offline brewing calculators, manage shared brewery inventory, and sync reminders locally — all on your own self-hosted server.

---

## Keywords (iOS, ≤100 chars)

`homebrew,brewing,beer,mead,wine,cider,recipe,calculator,abv,ibu,fermentation,hydrometer,selfhosted`

_(98 chars)_

---

## Full Description (iOS & Google Play)

Brew-Bruvs is a free, open-source, self-hosted companion app for making beer, mead, wine, and cider. Connect it to your own Brew-Bruvs server (or your homebrew club's server) — or use all 18+ brewing calculators completely offline with no account required.

### Offline Brewing Calculators (No Server Required)

- ABV (standard & alternate formulas), Tinseth IBU, Morey SRM/EBC color
- Hydrometer temperature correction and refractometer fermentation correction
- Strike & sparge water temperature and volume, mash infusion steps
- Mead & wine TOSNA / YAN nutrient schedules, chaptalization, acid adjustment, SO2 / sulfite dosing, stabilization & backsweetening
- Priming sugar & keg carbonation PSI, dilution, blending, yeast pitch rate, and unit conversions
- US customary (default) and Metric SI units everywhere, with tap-to-inspect formulas

### Recipes, Imports & Brew-Day Mode

- Build and version recipes for beer, mead, wine, and cider with live OG, FG, ABV, IBU, color, and BJCP style-fit ranges
- Import BeerXML and BeerJSON files directly from your device or via public recipe URLs, with a review draft before saving and permanent source credit
- Export to BeerXML/BeerJSON and print clean brew sheets

### Batch Tracking & Local Reminders

- Track beer and aged-fermentation (mead, wine, cider) stages from Planned to Finished
- Log manual readings or plot readings from connected hydrometers on a fermentation chart
- Run brew-day checklists with background timers and sync batch reminders locally on your device — no cloud push service required
- Record general notes and BJCP 50-point tasting score sheets

### Breweries, Shared Inventory & Equipment

- Create shared breweries with Owner, Brewer, Member, and Viewer roles
- Track personal or brewery ingredient inventory, reserve ingredients on batch start, and generate shopping lists from shortfalls and low-stock thresholds
- Track club equipment with "Held by" lending and a brewery activity feed

### Privacy First

- **No tracking, no analytics, no ads.**
- **Your data stays on the server you choose.** Brew-Bruvs has no central cloud server and never sells or collects your data.
- **Open source:** Licensed under GNU AGPL-3.0-or-later.

---

## What's New (1.0.0 TestFlight / Play Internal Testing)

- Offline calculators for beer, mead, wine, and cider
- Recipe builder with live style-fit stats, versioning, and native BeerXML/BeerJSON file import
- Batch workflows, fermentation charts, brew-day timers, and automatic on-open reminder syncing
- Shared breweries with roles, inventory reservations, shopping lists, equipment lending, and activity feed

---

## App Store Privacy Nutrition Label & Google Play Data Safety

Use these answers in App Store Connect (**App Privacy**) and Google Play Console (**Data safety**):

- **Does this app collect or share any of the required user data types?** **No.**
- **Does this app use third-party analytics, ad SDKs, or tracking?** **No.**
- **Data linked to you / Data not linked to you / Data used to track you:** **None.**
- **Explanation note for reviewers:** Brew-Bruvs is a self-hosted client (like Home Assistant or Immich). Users connect only to a server URL they enter themselves, or use the built-in calculators offline. No data is sent to the app developer.

### App Review Notes (TestFlight / App Store / Play Review)

> Brew-Bruvs is a self-hosted homebrewing utility (similar to Home Assistant or Immich).
>
> 1. **Offline review path:** Tap **"Use calculators offline"** on the first screen to explore all 18+ brewing calculators with no server or login required.
> 2. **Server review path:** To test account, recipe, batch, and brewery screens, connect to a Brew-Bruvs server (run locally via `docker compose up` from https://github.com/ironbeard21/brew-bruvs, or enter the test server URL & credentials provided in the review credentials field).
> 3. **No alcohol sales or trading:** Brew-Bruvs is strictly a recipe, calculator, and batch-logging tool for hobbyist brewers. It does not sell, deliver, or facilitate trading of alcoholic beverages.

---

## Screenshots Included (`apps/app/store/screenshots/`)

Captured at `1290×2796` (iPhone 6.7" / 9:16 high-DPI phone format, accepted by both App Store Connect and Google Play Console):

1. `01-calculators.png` — Offline brewing calculators (ABV & live formulas)
2. `02-recipe-builder.png` — Recipe builder with live OG/FG/ABV/IBU/color & BJCP style-fit ranges
3. `03-batch-fermentation.png` — Batch workflow stages & fermentation gravity chart
4. `04-inventory-shopping.png` — Inventory tracking & low-stock / shopping list
5. `05-breweries.png` — Shared brewery workspace, roles, and members
