# Brew-Bruvs seed catalog

Starting ingredient, style and equipment data for Brew-Bruvs, merged from open-licensed sources. Every row has a `sources` column naming where it came from and a `licenses` column with the license(s) that apply.

Built 2026-11-21 from the repo commits listed in `data/sources.csv`.

## What's in `data/`

| File | Rows | What it is |
| --- | --- | --- |
| `hops.csv` | 494 | Hop varieties: alpha/beta acids (with min-max across sources), oils, substitutes |
| `fermentables.csv` | 1,248 | Malts, sugars, extracts, adjuncts, fruit, honey and juices |
| `yeasts.csv` | 842 | Beer, wine, mead and cider yeasts and bacteria from 32 producers |
| `miscs.csv` | 130 | Spices, finings, water agents, wine/mead/cider additives |
| `styles.csv` | 649 | Numeric style ranges: BJCP 2021, 2015 (incl. 13 mead + 11 cider), 2008 (incl. 9 mead + 9 cider), Brewers Association 2017 and an undated BA set |
| `water_profiles.csv` | 29 | Classic brewing water profiles |
| `equipment.csv` | 32 | All-in-one systems and common setups |
| `catalog.json` | all | Same data in one JSON file, plus source and commit info |
| `sources.csv` | 12 | Every source, its license, URL and exact commit |
| `build_report.csv` | 7 | Entries read vs rows after merging |

Units: temperatures in °C, volumes in liters, color in °Lovibond (plus EBC for fermentables), style color in SRM, percentages as 0-100.

Every file has these columns at the end:

- `aliases`: other names this item had in the sources (search should match these)
- `sources`: source keys, highest priority first (see `sources.csv`)
- `source_names`: readable source names
- `licenses`: every license that applies to the row
- `merged_from`: how many source entries were merged into this row

`beverages` (on hops, fermentables, yeasts and miscs) is one or more of `beer;mead;wine;cider`.

## How duplicates were merged

- **Hops:** by variety name plus country of origin, after normalizing spelling and known aliases (CTZ = Columbus = Tomahawk = Zeus; Equinox = Ekuanot; Hallertauer = Hallertau; EKG = East Kent Golding...). The same variety grown in different countries stays separate (Cascade US, NZ, AU, AR). Where sources disagree, the row keeps the highest-priority value and records the spread in `alpha_acid_min_pct` / `alpha_acid_max_pct`.
- **Yeasts:** by producer plus product code (WLP001, US-05, EC-1118...), with producer brand names unified (Lalvin, LalBrew and Danstar are Lallemand). Entries without a code were joined to the matching named product.
- **Fermentables:** by maltster plus name. The same malt name from different maltsters stays separate on purpose, because their specs differ (17 different Vienna malts, for example). Generic sugars were folded together (Dextrose = Corn Sugar, Milk Sugar = Lactose...).
- **Styles:** by guideline edition plus style ID. Different editions are never merged.
- **Field conflicts:** each field takes the value from the highest-priority source that has one (order in `PRIORITY` in `build_catalog.py`).

## What was left out, and why

- **Style descriptions** (aroma, flavor, history...). They are BJCP's and the Brewers Association's own writing, so only names, IDs and numeric ranges were imported. Link to the guidelines for the text.
- **296 yeasts in Brewtarget's DefaultContent003.** Brewtarget's own header says they came from brewerwall/yeasts, which has no formal license. Rebuild with `--include-unlicensed` to add them if that project adds an open license.
- **Recipes** in the Brewtarget files: this is an ingredient catalog; recipes come later through recipe import with credit.
- **UMN hop pedigree data (CC0):** it isn't a Git repository; download it manually from https://hdl.handle.net/11299/267835 to add parentage later.

## Licensing notes

- **GPL-3.0** (Brewtarget): compatible with an AGPL-3.0 project. Keep `LICENSES/Brewtarget-GPL-3.0.txt`.
- **MIT** (Wall Brew, BeerJSON, BeerProto): keep the copyright notices in `LICENSES/`.
- **CC BY-SA 4.0** (beer-analytics.com content inside Brewtarget): requires credit and share-alike. CC BY-SA 4.0 is one-way compatible with GPL-3.0. Rows carrying it say so in `licenses`; filter on that column if you ever want to drop them.
- **CC0** (Brew-Bruvs starter set): hand-entered honeys, juices, wine/mead/cider additives and a few wine yeasts that no open data set covered. Values are typical ranges, not lab specs. Treat them as placeholders for the community to refine.

Show credit in the app (an About page listing `sources.csv`) and keep `ATTRIBUTION.md` in the repo.

## Rebuild

```bash
mkdir src && cd src
git clone --depth 1 https://github.com/beerjson/bjcp-json.git beerjson_bjcp-json
git clone --depth 1 https://github.com/Wall-Brew-Co/common-beer-data.git Wall-Brew-Co_common-beer-data
git clone --depth 1 https://github.com/beerproto/dataset.git beerproto_dataset
git clone --depth 1 --filter=blob:none --sparse https://github.com/Brewtarget/brewtarget.git Brewtarget_brewtarget
git -C Brewtarget_brewtarget sparse-checkout set data
cd ..
python3 build/build_catalog.py --src src --out data
```

Python 3.10+ standard library only; no packages to install.
