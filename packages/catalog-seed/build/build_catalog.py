#!/usr/bin/env python3
"""
Brew-Bruvs seed catalog builder.

Reads open-licensed brewing data sets, normalizes them into one schema per
catalog type, merges duplicates, and writes CSV + JSON with a source column on
every row.

Usage:
    python3 build_catalog.py --src <dir with cloned repos> --out <output dir>
                             [--include-unlicensed]

Expected repos under --src (git clone --depth 1):
    Brewtarget_brewtarget          https://github.com/Brewtarget/brewtarget   (GPL-3.0; data/ folder)
    Wall-Brew-Co_common-beer-data  https://github.com/Wall-Brew-Co/common-beer-data (MIT)
    beerjson_bjcp-json             https://github.com/beerjson/bjcp-json       (MIT)
    beerproto_dataset              https://github.com/beerproto/dataset        (MIT)

Licensing rules applied:
  * Style guideline prose (aroma, flavor, history...) is NOT imported: it is the
    guideline publisher's writing. Only names, IDs and numeric ranges are kept.
  * Brewtarget's DefaultContent003 yeast list says it was taken from
    brewerwall/yeasts, which has no formal license. Those yeasts are skipped
    unless --include-unlicensed is given.
  * Every row lists its sources and their licenses.
"""
import argparse, csv, json, os, re, subprocess, unicodedata, xml.etree.ElementTree as ET
from collections import defaultdict, Counter

# --------------------------------------------------------------------------- sources
SOURCES = {
    "bt003":   dict(name="Brewtarget DefaultContent003 (hops)", repo="Brewtarget_brewtarget", url="https://github.com/Brewtarget/brewtarget/blob/develop/data/DefaultContent003-Ingredients-Hops-Yeasts.json", license="GPL-3.0"),
    "bt003y":  dict(name="Brewtarget DefaultContent003 (yeasts, derived from brewerwall/yeasts)", repo="Brewtarget_brewtarget", url="https://github.com/brewerwall/yeasts", license="UNCLEAR (upstream has no formal license)"),
    "bt004":   dict(name="Brewtarget DefaultContent004 (more yeasts)", repo="Brewtarget_brewtarget", url="https://github.com/Brewtarget/brewtarget/blob/develop/data/DefaultContent004-MoreYeasts.json", license="GPL-3.0"),
    "bt005ba": dict(name="beer-analytics.com via Brewtarget DefaultContent005", repo="Brewtarget_brewtarget", url="https://www.beer-analytics.com/", license="CC-BY-SA-4.0"),
    "bt005sw": dict(name="The Swaen malthouse via Brewtarget DefaultContent005", repo="Brewtarget_brewtarget", url="https://theswaen.com/", license="GPL-3.0"),
    "bt005ch": dict(name="Canadian Homebrewers Association via Brewtarget DefaultContent005", repo="Brewtarget_brewtarget", url="https://canadahomebrews.ca/recipes/", license="GPL-3.0"),
    "bt005db": dict(name="DotBeer example library via Brewtarget DefaultContent005", repo="Brewtarget_brewtarget", url="https://github.com/Brewken/DotBeer", license="GPL-3.0"),
    "bt001":   dict(name="Brewtarget DefaultContent001 (original BeerXML defaults)", repo="Brewtarget_brewtarget", url="https://github.com/Brewtarget/brewtarget/blob/develop/data/DefaultContent001-OriginalDefaultData.xml", license="GPL-3.0"),
    "wallbrew":dict(name="Wall Brew Co common-beer-data", repo="Wall-Brew-Co_common-beer-data", url="https://github.com/Wall-Brew-Co/common-beer-data", license="MIT"),
    "beerproto":dict(name="BeerProto dataset", repo="beerproto_dataset", url="https://github.com/beerproto/dataset", license="MIT"),
    "starter": dict(name="Brew-Bruvs starter set (hand-entered; values approximate)", repo="", url="build_catalog.py (STARTER_* lists)", license="CC0-1.0"),
    "bjcpjson":dict(name="BeerJSON bjcp-json (numeric ranges only)", repo="beerjson_bjcp-json", url="https://github.com/beerjson/bjcp-json", license="MIT"),
}

# Field-priority order per catalog type (first source with a value wins).
PRIORITY = {
    "hops":         ["bt003", "bt005ba", "bt005ch", "beerproto", "wallbrew", "bt001"],
    "yeasts":       ["bt004", "bt005ba", "bt005ch", "beerproto", "wallbrew", "bt001", "bt003y", "starter"],
    "fermentables": ["bt005sw", "bt005ba", "bt005ch", "beerproto", "wallbrew", "bt001", "starter"],
    "miscs":        ["bt005db", "bt005ba", "bt005ch", "bt001", "starter"],
    "styles":       ["bjcpjson", "wallbrew", "beerproto", "bt005ch", "bt001"],
    "water_profiles": ["bt005db", "bt005ba", "bt005ch", "beerproto", "bt001"],
    "equipment":    ["bt005db", "bt005ba", "beerproto", "bt001"],
}

# --------------------------------------------------------------------------- helpers
def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))

def clean(s):
    if s is None: return ""
    s = str(s).replace("®", "").replace("™", "").strip()
    return re.sub(r"\s+", " ", s)

def norm(s):
    s = re.sub(r"\s*\(\d+\)\s*$", "", clean(s))          # Brewtarget "(1)" duplicate markers
    s = strip_accents(s).lower()
    s = s.replace("&", " and ").replace("’", "'").replace("'", "")
    s = re.sub(r"[^a-z0-9#.]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def load_jsonc(path):
    txt = open(path, encoding="utf-8").read()
    txt = "\n".join(l for l in txt.splitlines() if not l.lstrip().startswith("//"))
    return json.loads(txt)

def q(x, default_unit=None):
    """BeerJSON/BeerProto quantity -> (value, unit)."""
    if x is None: return (None, None)
    if isinstance(x, (int, float)): return (float(x), default_unit)
    if isinstance(x, dict):
        v = x.get("value")
        return (float(v) if v is not None else None, x.get("unit"))
    try: return (float(x), default_unit)
    except Exception: return (None, None)

def to_c(v, unit):
    if v is None: return None
    if unit and unit.upper().startswith("F"): return round((v - 32) * 5 / 9, 1)
    return round(v, 1)

def pct(v):
    """Accept 0.18 or 18 -> 18.0"""
    if v is None: return None
    v = float(v)
    return round(v * 100, 2) if 0 < v <= 1.0 else round(v, 2)

def num(x):
    try:
        v = float(x)
        return v
    except Exception:
        return None

def color_to_lovibond(v, unit):
    if v is None: return None
    u = (unit or "L").upper()
    if u.startswith("EBC"):
        srm = v / 1.97
        return round((srm + 0.76) / 1.3546, 1)
    if u.startswith("SRM"):
        return round((v + 0.76) / 1.3546, 1)
    return round(v, 1)  # Lovibond

def lovibond_to_ebc(l):
    if l is None: return None
    return round((1.3546 * l - 0.76) * 1.97, 1)

def yield_to_ppg(y):
    return None if y is None else round(y * 46.214 / 100, 1)

# --------------------------------------------------------------------------- name normalizers
HOP_ALIASES = {
    "ctz": "columbus", "zeus": "columbus", "tomahawk": "columbus", "columbus tomahawk zeus": "columbus",
    "columbus ctz": "columbus", "columbus zeus": "columbus",
    "equinox": "ekuanot", "hbc 366": "ekuanot",
    "hercules": "herkules",
    "zatec": "saaz", "czech saaz": "saaz", "saaz czech": "saaz", "zatecky polorany cerveny": "saaz",
    "savinjski golding": "styrian golding", "styrian goldings": "styrian golding", "savinja golding": "styrian golding",
    "b saaz": "motueka",
    "ekg": "east kent golding", "east kent goldings": "east kent golding", "kent golding": "east kent golding",
    "fuggles": "fuggle", "goldings": "golding", "us goldings": "us golding",
    "hallertau mittelfruh": "hallertau mittelfruh", "hallertauer mittelfruh": "hallertau mittelfruh",
    "hallertau mittelfrueh": "hallertau mittelfruh", "mittelfruh": "hallertau mittelfruh", "hallertau hallertauer mittelfruh": "hallertau mittelfruh",
    "hallertau magnum": "magnum", "hallertauer magnum": "magnum",
    "hallertauer": "hallertau", "hallertauer tradition": "hallertau tradition", "hallertauer hersbrucker": "hersbrucker",
    "hallertau hersbrucker": "hersbrucker", "hersbrucker hallertau": "hersbrucker",
    "tettnanger": "tettnang", "spalter": "spalt", "spalter select": "spalt select",
    "waiiti": "wai iti", "idaho #7": "idaho 7", "idaho no 7": "idaho 7",
    "sabro hbc 438": "sabro", "hbc 438": "sabro", "hbc 394": "citra", "hbc 369": "mosaic",
    "pacific jade": "pacific jade", "nz cascade": "cascade (nz)",
}
COUNTRY_TAGS = {"us": "US", "usa": "US", "nz": "NZ", "uk": "UK", "gb": "UK", "ger": "DE", "german": "DE", "de": "DE",
                "aus": "AU", "au": "AU", "czech": "CZ", "cz": "CZ", "slo": "SI", "si": "SI", "fr": "FR", "french": "FR",
                "pol": "PL", "polish": "PL", "arg": "AR", "argentina": "AR", "ja": "JP", "jp": "JP", "sa": "ZA", "za": "ZA",
                "canada": "CA", "ca": "CA"}

ORIGIN_MAP = [("united states", "US"), ("usa", "US"), ("u.s", "US"), ("america", "US"), ("german", "DE"), ("(ger)", "DE"),
              ("czech", "CZ"), ("united kingdom", "UK"), ("great britain", "UK"), ("england", "UK"), ("(uk)", "UK"),
              ("new zealand", "NZ"), ("australia", "AU"), ("sloven", "SI"), ("france", "FR"), ("french", "FR"), ("poland", "PL"),
              ("argentin", "AR"), ("japan", "JP"), ("south africa", "ZA"), ("canada", "CA"), ("belgi", "BE"), ("china", "CN"),
              ("ukrain", "UA"), ("russia", "RU"), ("spain", "ES"), ("brazil", "BR"), ("austria", "AT"), ("serbia", "RS")]
def origin_code(o):
    t = " " + strip_accents(clean(o)).lower() + " "
    for k, v in ORIGIN_MAP:
        if k in t: return v
    t = t.strip()
    if t in ("us", "de", "gr", "ger", "uk", "nz", "cz", "au", "si", "fr"): return {"gr": "DE", "ger": "DE"}.get(t, t.upper())
    return ""

def hop_key(name):
    raw = re.sub(r"\s*\(\d+\)\s*$", "", clean(name))
    n = norm(re.sub(r"\([^)]*\)", " ", raw))
    n = re.sub(r"\bhbc\s*\d+\b", "", n)                       # breeder codes
    n = re.sub(r"\b(hops?|pellets?|leaf|whole|brand|cv|variety)\b", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    variant = ""
    m = re.search(r"\(([^)]*)\)\s*$", raw)
    if m:
        tag = norm(m.group(1))
        if tag in COUNTRY_TAGS: variant = COUNTRY_TAGS[tag]
        else: variant = origin_code(m.group(1))
    n = re.sub(r"\([^)]*\)", " ", n) if "(" in n else n
    n = re.sub(r"\s+", " ", n).strip()
    words = n.split()
    if words and words[-1] in COUNTRY_TAGS and len(words) > 1:
        variant = variant or COUNTRY_TAGS[words[-1]]
        n = " ".join(words[:-1])
    n = re.sub(r"^hallertauer\b", "hallertau", n)
    n = re.sub(r"\bmittelfr(ue|u)h(er)?\b", "mittelfruh", n)
    n = re.sub(r"^tettnanger\b", "tettnang", n)
    n = re.sub(r"^spalter\b", "spalt", n)
    n = HOP_ALIASES.get(n, n)
    if n.startswith("cascade (nz)"): n, variant = "cascade", "NZ"
    return (n, variant)

PRODUCER_ALIASES = {
    "danstar": "lallemand", "lalvin": "lallemand", "lalbrew": "lallemand", "lallemand lalbrew": "lallemand",
    "lallemand brewing": "lallemand",
    "safale": "fermentis", "saflager": "fermentis", "lesaffre": "fermentis", "fermentis lesaffre": "fermentis",
    "imperial organic": "imperial", "white": "white labs", "whitelabs": "white labs", "wyeast": "wyeast",
    "omega": "omega", "escarpment": "escarpment", "yeast bay": "the yeast bay", "bay": "the yeast bay",
    "mangrove jacks": "mangrove jacks", "mangrove jack s": "mangrove jacks", "mangrove jack": "mangrove jacks",
    "red star": "red star", "bootleg biology": "bootleg biology", "gigayeast": "gigayeast",
}
PRODUCER_DISPLAY = {"lallemand": "Lallemand", "fermentis": "Fermentis", "imperial": "Imperial Yeast", "white labs": "White Labs",
                    "wyeast": "Wyeast", "omega": "Omega Yeast", "escarpment": "Escarpment Labs", "the yeast bay": "The Yeast Bay",
                    "mangrove jacks": "Mangrove Jack's", "red star": "Red Star", "bootleg biology": "Bootleg Biology",
                    "gigayeast": "GigaYeast"}

def producer_key(p):
    n = norm(p)
    n = re.sub(r"\b(the|labs?|laboratories|yeast|yeasts|inc|ltd|llc|co|company|organic)\b", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return PRODUCER_ALIASES.get(n, n)

def product_id_key(pid, producer):
    p = re.sub(r"[^A-Z0-9]", "", strip_accents(clean(pid)).upper())
    if producer == "wyeast": p = re.sub(r"^WY", "", p)
    if producer == "fermentis": p = re.sub(r"^(SAFALE|SAFLAGER|SAFBREW|SAFCIDER|SAFOENO)", "", p)
    if producer == "lallemand":
        p = re.sub(r"^(LALBREW|LALVIN)", "", p)
        p = {"71B1122": "71B", "V1116": "K1V1116", "RC212": "RC212"}.get(p, p)
    return p

FERM_ALIASES = {"corn sugar dextrose": "corn sugar", "dextrose": "corn sugar", "lactose milk sugar": "lactose", "milk sugar": "lactose",
                "sucrose": "table sugar", "sugar table sucrose": "table sugar", "sugar": "table sugar", "cane sugar": "table sugar",
                "cane beet sugar": "table sugar", "dememera sugar": "demerara sugar", "candi sugar clear": "clear candi sugar",
                "pilsen": "pilsner", "pilsen malt": "pilsner malt", "cara malt": "caramalt"}
def ferm_key(name, producer):
    pk = producer_key(producer) if producer else ""
    n = norm(name)
    n = FERM_ALIASES.get(n, n)
    n = re.sub(r"\b(2|two)\s*-?\s*row\b", "2row", n)
    n = re.sub(r"\b(6|six)\s*-?\s*row\b", "6row", n)
    n = re.sub(r"\b(\d+)\s*l\b", r"\1", n)              # Crystal 60L -> crystal 60
    n = re.sub(r"\bcaramel\s*/\s*crystal\b", "crystal", n)
    toks = [t for t in n.replace("(", " ").replace(")", " ").split() if t not in ("malt", "malts", "grain", "the")]
    if pk: toks = [t for t in toks if t not in pk.split()]
    return (pk, " ".join(sorted(set(toks))))

# --------------------------------------------------------------------------- beverage tags
WINE_WORDS = ("wine", "champagne", "mead", "cider", "perry", "sake", "honey", "apple", "pear", "grape", "must", "juice",
              "pectic", "pectinase", "sorbate", "metabisulfite", "campden", "tannin", "acid blend", "malic", "tartaric",
              "fermaid", "nutrient", "dap", "diammonium", "bentonite", "sparkolloid", "chitosan", "kieselsol", "oak", "go-ferm",
              "kmeta", "k-meta")

def beverages_for(text, base="beer"):
    t = (text or "").lower()
    t = re.sub(r"(barley|wheat|rye)\s*-?\s*wine", " ", t)
    tags = {base} if base else set()
    if any(w in t for w in ("mead", "honey", "fermaid", "go-ferm")): tags.add("mead")
    if any(w in t for w in ("wine", "champagne", "grape", "tartaric", "bentonite", "sparkolloid", "kieselsol", "oak", "metabisulfite", "campden", "sorbate", "pectic", "tannin", "acid blend")): tags.add("wine")
    if any(w in t for w in ("cider", "perry", "apple", "pear", "malic")): tags.add("cider")
    if any(w in t for w in ("nutrient", "dap", "diammonium", "sorbate", "metabisulfite", "campden", "pectic", "pectinase")):
        tags.update({"mead", "wine", "cider"})
    order = ["beer", "mead", "wine", "cider"]
    return ";".join(o for o in order if o in tags)

# --------------------------------------------------------------------------- merge store
class Store:
    def __init__(self, kind):
        self.kind = kind
        self.items = {}            # key -> {"fields": {src: dict}, "names": [(src, name)]}
    def add(self, key, src, fields, original_name):
        if self.kind == "hops" and not key[1]:
            key = (key[0], origin_code(fields.get("origin")))
        it = self.items.setdefault(key, {"fields": defaultdict(list), "names": []})
        it["fields"][src].append(fields)
        it["names"].append((src, original_name))
    def _fold(self, src_key, dst_key):
        a, b = self.items.pop(src_key), self.items[dst_key]
        for sk, fl in a["fields"].items(): b["fields"][sk].extend(fl)
        b["names"].extend(a["names"])

    def consolidate(self):
        if self.kind == "hops":
            # entries with no known country join the most-documented country for that hop name
            by_name = defaultdict(list)
            for k in self.items: by_name[k[0]].append(k)
            for name, keys in by_name.items():
                blanks = [k for k in keys if not k[1]]
                withc = [k for k in keys if k[1]]
                if blanks and withc:
                    dom = max(withc, key=lambda k: len(self.items[k]["names"]))
                    for b in blanks: self._fold(b, dom)
        if self.kind == "yeasts":
            # entries with no product id join the same producer's entry whose core name matches
            def core(n, prod):
                n = norm(n)
                n = re.sub(r"\b(lalbrew|lalvin|safale|saflager|safbrew|safcider|yeast|ale|dry|liquid|strain)\b", " ", n)
                for t in prod.split(): n = re.sub(r"\b%s\b" % re.escape(t), " ", n)
                n = re.sub(r"\b[a-z]{0,4}-?\d{2,5}[a-z]?\b", " ", n)   # product codes inside names
                return re.sub(r"\s+", " ", n).strip()
            index = {}
            for k, it in self.items.items():
                if k[1].startswith("id:"):
                    for _, nm in it["names"]:
                        c = core(nm, k[0])
                        if c: index.setdefault((k[0], c), k)
            for k in [k for k in self.items if k[1].startswith("name:")]:
                c = core(self.items[k]["names"][0][1], k[0])
                tgt = index.get((k[0], c))
                if tgt and tgt in self.items: self._fold(k, tgt)
            # name-only entries whose name is another entry's name plus generic descriptors
            DESCRIPTORS = {"kolsch", "style", "belgian", "english", "beer", "wheat", "kveik", "lager", "german", "american", "wine", "abbey", "abbaye"}
            cores = {k: core(self.items[k]["names"][0][1], k[0]) for k in self.items}
            for k in sorted([k for k in self.items if k[1].startswith("name:")], key=lambda k: len(cores[k])):
                if k not in self.items or not cores[k]: continue
                for o in list(self.items):
                    if o == k or o[0] != k[0] or o not in self.items: continue
                    oc = cores.get(o, "")
                    if oc.startswith(cores[k] + " ") and set(oc[len(cores[k]):].split()) <= DESCRIPTORS:
                        self._fold(k, o); break
            # name-only duplicates within a producer
            seen = {}
            for k in [k for k in self.items if k[1].startswith("name:")]:
                c = (k[0], core(self.items[k]["names"][0][1], k[0]))
                if c[1] and c in seen and seen[c] in self.items: self._fold(k, seen[c])
                else: seen[c] = k

    def rows(self):
        self.consolidate()
        pri = PRIORITY[self.kind]
        out = []
        for key, it in self.items.items():
            srcs = sorted(it["fields"].keys(), key=lambda s: pri.index(s) if s in pri else 99)
            merged = {}
            for s in srcs:
                for f in it["fields"][s]:
                    for k, v in f.items():
                        if k.startswith("_"): continue
                        if merged.get(k) in (None, "") and v not in (None, ""):
                            merged[k] = v
            if self.kind == "yeasts":
                names = [f.get("name") for s_ in srcs for f in it["fields"][s_] if f.get("name")]
                if names: merged["name"] = max(names, key=len)
            merged["_srcs"] = srcs
            merged["_names"] = it["names"]
            merged["_all"] = it["fields"]
            merged["_key"] = key
            out.append(merged)
        return out

def finish(row, cols, extra=None):
    srcs = row["_srcs"]
    names = sorted({n for _, n in row["_names"] if n and n != row.get("name")})
    r = {c: row.get(c, "") for c in cols}
    if extra: r.update(extra)
    r["aliases"] = "; ".join(names)
    r["sources"] = "; ".join(srcs)
    r["source_names"] = "; ".join(SOURCES[s]["name"] for s in srcs)
    r["licenses"] = "; ".join(sorted({SOURCES[s]["license"] for s in srcs}))
    r["merged_from"] = len(row["_names"])
    for k, v in list(r.items()):
        if v is None: r[k] = ""
        elif isinstance(v, float): r[k] = round(v, 3)
    return r

def slug(*parts):
    s = "-".join(norm(p) for p in parts if p)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

# --------------------------------------------------------------------------- loaders
def load_brewtarget(src, stores, include_unlicensed):
    base = os.path.join(src, "Brewtarget_brewtarget", "data")
    # 003 hops (+ yeasts from brewerwall)
    d = load_jsonc(os.path.join(base, "DefaultContent003-Ingredients-Hops-Yeasts.json"))["beerjson"]
    for h in d.get("hop_varieties", []):
        add_hop_beerjson(stores, "bt003", h)
    if include_unlicensed:
        for c in d.get("cultures", []):
            add_yeast_beerjson(stores, "bt003y", c)
    d = load_jsonc(os.path.join(base, "DefaultContent004-MoreYeasts.json"))["beerjson"]
    for c in d.get("cultures", []):
        add_yeast_beerjson(stores, "bt004", c)
    d = load_jsonc(os.path.join(base, "DefaultContent005-Fermentables-Recipes.beer"))["DotBeer"]
    def src005(x):
        fp = (x.get("folder_path") or "")
        if fp == "The Swaen": return "bt005sw"
        if fp == "Canadian Homebrewers Association": return "bt005ch"
        if fp.startswith("All-in-one systems") or fp.startswith("Water Agents"): return "bt005db"
        return "bt005ba"
    for x in d.get("fermentables", []): add_ferm_beerjson(stores, src005(x), x)
    for x in d.get("hops", []): add_hop_beerjson(stores, src005(x), x)
    for x in d.get("cultures", []): add_yeast_beerjson(stores, src005(x), x)
    for x in d.get("miscs", []): add_misc_beerjson(stores, src005(x), x)
    for x in d.get("styles", []): add_style_beerjson(stores, src005(x), x, x.get("style_guide"))
    for x in d.get("waters", []): add_water_beerjson(stores, src005(x), x)
    for x in d.get("equipments", []): add_equipment_beerjson(stores, src005(x), x)
    # 001 BeerXML
    raw = open(os.path.join(base, "DefaultContent001-OriginalDefaultData.xml"), encoding="iso-8859-1").read()
    raw = re.sub(r"<\?xml[^>]*\?>", "", raw)
    root = ET.fromstring("<ROOT>" + raw + "</ROOT>")
    for sec in root:
        for el in sec:
            x = {c.tag: (c.text or "").strip() for c in el}
            t = sec.tag
            if t == "HOPS": add_hop_beerxml(stores, "bt001", x)
            elif t == "FERMENTABLES": add_ferm_beerxml(stores, "bt001", x)
            elif t == "YEASTS": add_yeast_beerxml(stores, "bt001", x)
            elif t == "MISCS": add_misc_beerxml(stores, "bt001", x)
            elif t == "STYLES": add_style_beerxml(stores, "bt001", x)
            elif t == "WATERS": add_water_beerxml(stores, "bt001", x)
            elif t == "EQUIPMENTS": add_equipment_beerxml(stores, "bt001", x)

def load_wallbrew(src, stores):
    base = os.path.join(src, "Wall-Brew-Co_common-beer-data", "exports", "json")
    for h in json.load(open(os.path.join(base, "hops.json")))["hops"]:
        h = h["hop"]
        stores["hops"].add(hop_key(h["name"]), "wallbrew", dict(
            name=clean(h["name"]), hop_type=clean(h.get("type")).lower(), alpha_acid_pct=pct(h.get("alpha")),
            beta_acid_pct=pct(h.get("beta")), cohumulone_pct=pct(h.get("cohumulone")), myrcene_pct=pct(h.get("myrcene")),
            humulene_pct=pct(h.get("humulene")), caryophyllene_pct=pct(h.get("caryophyllene")),
            hsi=h.get("hsi"), substitutes=clean(h.get("substitutes")), origin=clean(h.get("origin")), notes=clean(h.get("notes"))), h["name"])
    for y in json.load(open(os.path.join(base, "yeasts.json")))["yeasts"]:
        y = y["yeast"]
        add_yeast_common(stores, "wallbrew", name=y["name"], producer=y.get("laboratory"), product_id=y.get("product-id"),
                         ytype=y.get("type"), form=y.get("form"), tmin=y.get("min-temperature"), tmax=y.get("max-temperature"),
                         att_min=pct(y.get("attenuation")), att_max=None, floc=y.get("flocculation"), tol=None,
                         best_for=y.get("best-for"), notes=y.get("notes"))
    for f in json.load(open(os.path.join(base, "fermentables.json")))["fermentables"]:
        f = f["fermentable"]
        y = pct(f.get("yield"))
        stores["fermentables"].add(ferm_key(f["name"], f.get("supplier")), "wallbrew", dict(
            name=clean(f["name"]), fermentable_type=clean(f.get("type")).lower(), producer=clean(f.get("supplier")),
            origin=clean(f.get("origin")), color_lovibond=color_to_lovibond(num(f.get("color")), "L"), yield_pct=y,
            potential_ppg=yield_to_ppg(y), max_in_batch_pct=pct(f.get("max-in-batch")), diastatic_power_lintner=num(f.get("diastatic-power")),
            protein_pct=num(f.get("protein")), moisture_pct=num(f.get("moisture")), notes=clean(f.get("notes"))), f["name"])
    for s in json.load(open(os.path.join(base, "styles.json")))["styles"]:
        s = s["style"]
        add_style_common(stores, "wallbrew", guide=s.get("style-guide") or "BJCP 2015", name=s["name"], category=s.get("category"),
                         category_number=s.get("category-number"), letter=s.get("style-letter"), style_id=None, beverage=s.get("type"),
                         og=(num(s.get("og-min")), num(s.get("og-max"))), fg=(num(s.get("fg-min")), num(s.get("fg-max"))),
                         ibu=(num(s.get("ibu-min")), num(s.get("ibu-max"))), srm=(num(s.get("color-min")), num(s.get("color-max"))),
                         abv=(pct(s.get("abv-min")), pct(s.get("abv-max"))), carb=(num(s.get("carb-min")), num(s.get("carb-max"))))

def load_beerproto(src, stores):
    base = os.path.join(src, "beerproto_dataset", "json")
    for h in json.load(open(os.path.join(base, "hops.json")))["hopVarieties"]:
        oil = h.get("oilContent") or {}
        stores["hops"].add(hop_key(h["name"]), "beerproto", dict(
            name=clean(h["name"]), origin=clean(h.get("origin")), alpha_acid_pct=q(h.get("alphaAcid"))[0], beta_acid_pct=q(h.get("betaAcid"))[0],
            cohumulone_pct=q(oil.get("cohumulone"))[0], total_oil_ml_per_100g=oil.get("totalOilMlPer100g"),
            myrcene_pct=q(oil.get("myrcene"))[0], humulene_pct=q(oil.get("humulene"))[0], caryophyllene_pct=q(oil.get("caryophyllene"))[0],
            farnesene_pct=q(oil.get("farnesene"))[0], substitutes=clean(", ".join(h["substitutes"]) if isinstance(h.get("substitutes"), list) else h.get("substitutes")),
            hop_type=clean(h.get("type")).lower(), notes=clean(h.get("notes"))), h["name"])
    for c in json.load(open(os.path.join(base, "culture.json")))["cultures"]:
        tr = c.get("temperatureRange") or {}
        ar = c.get("attenuationRange") or {}
        mn, mu = q(tr.get("minimum")); mx, xu = q(tr.get("maximum"))
        add_yeast_common(stores, "beerproto", name=c["name"], producer=c.get("producer"), product_id=c.get("productId"),
                         ytype=c.get("type"), form=c.get("form"), tmin=to_c(mn, mu), tmax=to_c(mx, xu),
                         att_min=q(ar.get("minimum"))[0], att_max=q(ar.get("maximum"))[0], floc=c.get("flocculation"),
                         tol=q(c.get("alcoholTolerance"))[0], best_for=c.get("bestFor"), notes=c.get("notes"))
    for f in json.load(open(os.path.join(base, "fermentable.json")))["fermentables"]:
        cv, cu = q(f.get("color"))
        pot = q((f.get("yield") or {}).get("potential"))[0]
        y = round((pot - 1) * 1000 / 46.214 * 100, 1) if pot and pot > 1 else None
        dp, du = q(f.get("diastaticPower"))
        if dp is not None and du and du.upper().startswith("WK"): dp = round((dp + 16) / 3.5, 0)
        stores["fermentables"].add(ferm_key(f["name"], f.get("producer")), "beerproto", dict(
            name=clean(f["name"]), fermentable_type=clean(f.get("type")).lower(), producer=clean(f.get("producer")),
            origin=clean(f.get("origin")), color_lovibond=color_to_lovibond(cv, cu), yield_pct=y, potential_ppg=yield_to_ppg(y),
            max_in_batch_pct=q(f.get("maxInBatch"))[0], diastatic_power_lintner=dp, protein_pct=q(f.get("protein"))[0],
            moisture_pct=q(f.get("moisture"))[0], notes=clean(f.get("notes"))), f["name"])
    for s in json.load(open(os.path.join(base, "styles.json")))["styles"]:
        r = lambda k: (q((s.get(k) or {}).get("minimum"))[0], q((s.get(k) or {}).get("maximum"))[0])
        add_style_common(stores, "beerproto", guide="Brewers Association (BeerProto, edition not stated)", name=s["name"],
                         category=s.get("category"), category_number=None, letter=None, style_id=None, beverage="beer",
                         og=r("originalGravity"), fg=r("finalGravity"), ibu=r("internationalBitternessUnits"), srm=r("color"),
                         abv=r("alcoholByVolume"), carb=(None, None))
    for w in json.load(open(os.path.join(base, "water.json")))["profiles"]:
        add_water_common(stores, "beerproto", w["name"], {k: q(w.get(k))[0] for k in ("calcium", "magnesium", "sodium", "sulfate", "chloride", "bicarbonate")}, w.get("notes"))

def load_bjcpjson(src, stores):
    base = os.path.join(src, "beerjson_bjcp-json", "styles")
    for fn in ("bjcp_styleguide-2015.json", "bjcp_styleguide-2021.json", "ba_styleguide-2017.json"):
        guide_default = {"bjcp_styleguide-2015.json": "BJCP 2015", "bjcp_styleguide-2021.json": "BJCP 2021", "ba_styleguide-2017.json": "Brewers Association 2017"}[fn]
        for s in json.load(open(os.path.join(base, fn)))["beerjson"]["styles"]:
            add_style_beerjson(stores, "bjcpjson", s, guide_default)

# ---- per-format adders
def add_hop_beerjson(stores, src, h):
    oil = h.get("oil_content") or {}
    stores["hops"].add(hop_key(h["name"]), src, dict(
        name=clean(h["name"]), origin=clean(h.get("origin")), hop_type=clean(h.get("type") or h.get("hop_type")).lower(),
        alpha_acid_pct=q(h.get("alpha_acid"))[0], beta_acid_pct=q(h.get("beta_acid"))[0],
        cohumulone_pct=q(oil.get("cohumulone"))[0], total_oil_ml_per_100g=q(oil.get("total_oil_ml_per_100g"))[0],
        myrcene_pct=q(oil.get("myrcene"))[0], humulene_pct=q(oil.get("humulene"))[0], caryophyllene_pct=q(oil.get("caryophyllene"))[0],
        farnesene_pct=q(oil.get("farnesene"))[0], substitutes=clean(h.get("substitutes")), notes=clean(h.get("notes"))), h["name"])

def add_hop_beerxml(stores, src, x):
    stores["hops"].add(hop_key(x["NAME"]), src, dict(
        name=clean(x["NAME"]), origin=clean(x.get("ORIGIN")), hop_type=clean(x.get("TYPE")).lower(),
        alpha_acid_pct=num(x.get("ALPHA")), beta_acid_pct=num(x.get("BETA")) or None,
        cohumulone_pct=num(x.get("COHUMULONE")) or None, myrcene_pct=num(x.get("MYRCENE")) or None,
        humulene_pct=num(x.get("HUMULENE")) or None, caryophyllene_pct=num(x.get("CARYOPHYLLENE")) or None,
        hsi=num(x.get("HSI")) or None, substitutes=clean(x.get("SUBSTITUTES")), notes=clean(x.get("NOTES"))), x["NAME"])

def add_yeast_common(stores, src, name, producer, product_id, ytype, form, tmin, tmax, att_min, att_max, floc, tol, best_for, notes):
    pk = producer_key(producer or "")
    pid = product_id_key(product_id or "", pk)
    key = (pk, "id:" + pid) if pid else (pk, "name:" + norm(name))
    text = " ".join(str(v) for v in (name, ytype, best_for) if v)
    stores["yeasts"].add(key, src, dict(
        name=clean(name), producer=PRODUCER_DISPLAY.get(pk, clean(producer)), product_id=clean(product_id),
        yeast_type=clean(ytype).lower(), form=clean(form).lower(), temp_min_c=tmin, temp_max_c=tmax,
        attenuation_min_pct=att_min, attenuation_max_pct=att_max, flocculation=clean(floc).lower(),
        alcohol_tolerance_pct=tol, best_for=clean(best_for), notes=clean(notes),
        _bev=beverages_for(text, base="")), name)

def add_yeast_beerjson(stores, src, c):
    tr = c.get("temperature_range") or {}
    ar = c.get("attenuation_range") or {}
    mn, mu = q(tr.get("minimum")); mx, xu = q(tr.get("maximum"))
    att = c.get("attenuation")
    add_yeast_common(stores, src, name=c["name"], producer=c.get("producer"), product_id=c.get("product_id"),
                     ytype=c.get("type") or c.get("culture_type"), form=c.get("form"), tmin=to_c(mn, mu), tmax=to_c(mx, xu),
                     att_min=q(ar.get("minimum"))[0] if ar else q(att)[0], att_max=q(ar.get("maximum"))[0] if ar else None,
                     floc=c.get("flocculation"), tol=q(c.get("alcohol_tolerance"))[0], best_for=c.get("best_for"), notes=c.get("notes"))

def add_yeast_beerxml(stores, src, x):
    add_yeast_common(stores, src, name=x["NAME"], producer=x.get("LABORATORY"), product_id=x.get("PRODUCT_ID"), ytype=x.get("TYPE"),
                     form=x.get("FORM"), tmin=num(x.get("MIN_TEMPERATURE")), tmax=num(x.get("MAX_TEMPERATURE")),
                     att_min=num(x.get("ATTENUATION")), att_max=None, floc=x.get("FLOCCULATION"), tol=None,
                     best_for=x.get("BEST_FOR"), notes=x.get("NOTES"))

def add_ferm_beerjson(stores, src, f):
    cv, cu = q(f.get("color"))
    y = q(f.get("yield_fine_grind") or (f.get("yield") or {}).get("fine_grind"))[0]
    pot = q((f.get("yield") or {}).get("potential"))[0]
    if y is None and pot and pot > 1: y = round((pot - 1) * 1000 / 46.214 * 100, 1)
    stores["fermentables"].add(ferm_key(f["name"], f.get("producer")), src, dict(
        name=clean(f["name"]), fermentable_type=clean(f.get("fermentable_type") or f.get("type")).lower(), producer=clean(f.get("producer")),
        product_id=clean(f.get("product_id")), origin=clean(f.get("origin")), color_lovibond=color_to_lovibond(cv, cu), yield_pct=y,
        potential_ppg=yield_to_ppg(y), max_in_batch_pct=q(f.get("max_in_batch"))[0], diastatic_power_lintner=q(f.get("diastatic_power"))[0],
        protein_pct=q(f.get("protein"))[0], moisture_pct=q(f.get("moisture"))[0], notes=clean(f.get("notes")),
        category=clean(f.get("folder_path"))), f["name"])

def add_ferm_beerxml(stores, src, x):
    y = num(x.get("YIELD"))
    stores["fermentables"].add(ferm_key(x["NAME"], x.get("SUPPLIER") or x.get("PRODUCER")), src, dict(
        name=clean(x["NAME"]), fermentable_type=clean(x.get("TYPE")).lower(), producer=clean(x.get("SUPPLIER") or x.get("PRODUCER")),
        origin=clean(x.get("ORIGIN")), color_lovibond=color_to_lovibond(num(x.get("COLOR")), "L"), yield_pct=y, potential_ppg=yield_to_ppg(y),
        max_in_batch_pct=num(x.get("MAX_IN_BATCH")), diastatic_power_lintner=num(x.get("DIASTATIC_POWER")) or None,
        protein_pct=num(x.get("PROTEIN")) or None, moisture_pct=num(x.get("MOISTURE")) or None, notes=clean(x.get("NOTES"))), x["NAME"])

MISC_ALIASES = {"whirlfloc tablet": "whirlfloc", "irish moss flake": "irish moss", "coriander seed": "coriander",
                "whole coriander": "coriander", "ginger root": "ginger", "juniper berry": "juniper", "vanilla bean": "vanilla",
                "campden tablet": "campden tablets", "lactic acid 88%": "lactic acid", "potassium metabisulphite": "potassium metabisulfite",
                "k meta": "potassium metabisulfite", "pectinase": "pectic enzyme", "grape tannin": "wine tannin",
                "chipotle pepper": "chipotle chile", "peppercorns black": "black peppercorn", "white pepper": "peppercorns white"}
def misc_key(name):
    n = norm(name)
    n = " ".join(w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w for w in n.split())
    return MISC_ALIASES.get(n, n)

def add_misc_beerjson(stores, src, m):
    stores["miscs"].add(misc_key(m["name"]), src, dict(
        name=clean(m["name"]), misc_type=clean(m.get("misc_type") or m.get("type")).lower(),
        water_agent_type=clean(m.get("water_agent_type")), use_for=clean(m.get("use_for")), notes=clean(m.get("notes")),
        category=clean(m.get("folder_path"))), m["name"])

def add_misc_beerxml(stores, src, x):
    stores["miscs"].add(misc_key(x["NAME"]), src, dict(
        name=clean(x["NAME"]), misc_type=clean(x.get("TYPE")).lower(), use=clean(x.get("USE")).lower(),
        use_for=clean(x.get("USE_FOR")), notes=clean(x.get("NOTES"))), x["NAME"])

def guide_norm(g):
    g = clean(g)
    m = re.match(r"(?i)bjcp\s*(\d{4})", g)
    if m: return "BJCP " + m.group(1)
    if g.upper() == "BJCP": return "BJCP 2008"
    return g or "Unknown"

def add_style_common(stores, src, guide, name, category, category_number, letter, style_id, beverage, og, fg, ibu, srm, abv, carb):
    g = guide_norm(guide)
    sid = clean(style_id) or (f"{clean(category_number)}{clean(letter)}" if category_number else "")
    key = (g, sid.upper()) if sid else (g, "name:" + norm(name))
    bev = norm(beverage)
    bev = "mead" if "mead" in bev else "cider" if ("cider" in bev or "perry" in bev) else "wine" if "wine" in bev else "beer"
    stores["styles"].add(key, src, dict(
        style_guide=g, style_id=sid, name=clean(name), category=clean(category), beverage=bev,
        og_min=og[0], og_max=og[1], fg_min=fg[0], fg_max=fg[1], ibu_min=ibu[0], ibu_max=ibu[1],
        color_srm_min=srm[0], color_srm_max=srm[1], abv_min_pct=abv[0], abv_max_pct=abv[1],
        carb_vols_min=carb[0], carb_vols_max=carb[1]), name)

def add_style_beerjson(stores, src, s, guide_default):
    r = lambda k: (q((s.get(k) or {}).get("minimum"))[0], q((s.get(k) or {}).get("maximum"))[0])
    sid = s.get("style_id") or (f"{s.get('category_number','')}{s.get('style_letter','')}" if s.get("category_number") else None)
    add_style_common(stores, src, guide=s.get("style_guide") or guide_default, name=s["name"], category=s.get("category"),
                     category_number=None, letter=None, style_id=sid, beverage=s.get("type") or s.get("style_type"),
                     og=r("original_gravity"), fg=r("final_gravity"), ibu=r("international_bitterness_units") if s.get("international_bitterness_units") else r("ibu"),
                     srm=r("color"), abv=r("alcohol_by_volume"), carb=r("carbonation"))

def add_style_beerxml(stores, src, x):
    t = (x.get("TYPE") or "").lower()
    cat = (x.get("CATEGORY") or "").lower()
    bev = "mead" if ("mead" in t or "mead" in cat) else "cider" if ("cider" in t or "cider" in cat or "perry" in cat) else "beer"
    add_style_common(stores, src, guide=x.get("STYLE_GUIDE"), name=x["NAME"], category=x.get("CATEGORY"),
                     category_number=x.get("CATEGORY_NUMBER"), letter=x.get("STYLE_LETTER"), style_id=None, beverage=bev,
                     og=(num(x.get("OG_MIN")), num(x.get("OG_MAX"))), fg=(num(x.get("FG_MIN")), num(x.get("FG_MAX"))),
                     ibu=(num(x.get("IBU_MIN")), num(x.get("IBU_MAX"))), srm=(num(x.get("COLOR_MIN")), num(x.get("COLOR_MAX"))),
                     abv=(num(x.get("ABV_MIN")), num(x.get("ABV_MAX"))), carb=(num(x.get("CARB_MIN")) or None, num(x.get("CARB_MAX")) or None))

def add_water_common(stores, src, name, ions, notes):
    stores["water_profiles"].add(norm(name), src, dict(name=clean(name), **{f"{k}_ppm": v for k, v in ions.items()}, notes=clean(notes)), name)

def add_water_beerjson(stores, src, w):
    add_water_common(stores, src, w["name"], {k: q(w.get(k))[0] for k in ("calcium", "magnesium", "sodium", "sulfate", "chloride", "bicarbonate")}, w.get("notes"))

def add_water_beerxml(stores, src, x):
    add_water_common(stores, src, x["NAME"], {k: num(x.get(k.upper())) for k in ("calcium", "magnesium", "sodium", "sulfate", "chloride", "bicarbonate")}, x.get("NOTES"))

def add_equipment_beerjson(stores, src, e):
    k = e.get("kettle") or {}
    stores["equipment"].add(norm(e["name"]), src, dict(
        name=clean(e["name"]), category=clean(e.get("folder_path")), batch_size_l=q(e.get("default_batch_size"))[0],
        kettle_volume_l=q(k.get("max_volume"))[0], kettle_loss_l=q(k.get("loss"))[0], boil_rate_l_per_hr=q(k.get("boil_rate_per_hour"))[0],
        grain_absorption_l_per_kg=q(e.get("grain_absorption_rate"))[0], notes=clean(e.get("notes") or k.get("notes"))), e["name"])

def add_equipment_beerxml(stores, src, x):
    stores["equipment"].add(norm(x["NAME"]), src, dict(
        name=clean(x["NAME"]), batch_size_l=num(x.get("BATCH_SIZE")), boil_size_l=num(x.get("BOIL_SIZE")),
        kettle_loss_l=num(x.get("TRUB_CHILLER_LOSS")), boil_rate_l_per_hr=num(x.get("REAL_EVAP_RATE")),
        mash_tun_volume_l=num(x.get("TUN_VOLUME")), notes=clean(x.get("NOTES"))), x["NAME"])


# --------------------------------------------------------------------------- hand-entered starter set (CC0)
# Mead, wine and cider basics that none of the open data sets cover. Values are typical
# ranges, not lab specs; the community should refine them.
STARTER_HONEY = ["Wildflower", "Clover", "Orange Blossom", "Buckwheat", "Tupelo", "Mesquite", "Sage", "Alfalfa",
                 "Avocado", "Blackberry", "Meadowfoam", "Raspberry Blossom", "Tulip Poplar", "Fireweed"]
STARTER_JUICE = [
    ("Apple Juice (fresh-pressed)", "Typical SG 1.045-1.060 depending on apple varieties; measure every batch."),
    ("Apple Juice (store-bought)", "Typical SG 1.045-1.050. Use juice without sorbate or benzoate preservatives."),
    ("Apple Juice Concentrate (frozen)", "Used to raise gravity or backsweeten cider; check the label for preservatives."),
    ("Pear Juice", "For perry. Contains sorbitol, which yeast doesn't ferment, so perry finishes slightly sweet."),
    ("Grape Must (fresh, red)", "Crushed red grapes with skins. Typical 20-25 Brix at harvest; measure Brix, pH and TA."),
    ("Grape Must (fresh, white)", "Pressed white grape juice. Typical 19-24 Brix at harvest; measure Brix, pH and TA."),
    ("Grape Juice Concentrate (wine kit)", "Follow the kit's water volume; gravity is set by the kit."),
    ("White Grape Juice (store-bought)", "Typical SG about 1.060-1.070; use juice without preservatives."),
]
STARTER_MISCS = [
    ("Pectic Enzyme", "other", "Breaks down fruit pectin for clearer wine, cider and fruit mead."),
    ("Potassium Sorbate", "other", "Stops renewed fermentation before backsweetening; use together with sulfite."),
    ("Potassium Metabisulfite", "other", "Source of SO2 for sanitizing and protecting wine, cider and mead; dose by pH."),
    ("Campden Tablets", "other", "Pre-measured potassium or sodium metabisulfite tablets."),
    ("Wine Tannin", "other", "Adds structure and mouthfeel, especially to fruit wines, cider and mead."),
    ("Acid Blend", "other", "Mix of tartaric, malic and citric acids for raising acidity."),
    ("Malic Acid", "other", "The main acid in apples; used to raise acidity in cider and wine."),
    ("Tartaric Acid", "other", "The main acid in grapes; used to raise acidity in wine."),
    ("Bentonite", "fining", "Clay fining agent that removes proteins and haze."),
    ("Kieselsol", "fining", "Silica fining agent, usually used with chitosan."),
    ("Chitosan", "fining", "Fining agent, usually used with kieselsol."),
    ("Fermaid O", "other", "Organic yeast nutrient used in staggered nutrient schedules for mead and wine."),
    ("Fermaid K", "other", "Blended yeast nutrient for wine and mead."),
    ("Go-Ferm", "other", "Yeast rehydration nutrient."),
    ("Diammonium Phosphate (DAP)", "other", "Inorganic nitrogen nutrient; add early in fermentation only."),
    ("Yeast Hulls", "other", "Helps restart and prevent stuck fermentations."),
    ("Oak Spirals", "wood", "Oak infusion for aging wine, mead and cider."),
    ("Potassium Bicarbonate", "other", "Lowers acidity in wine and cider."),
]
STARTER_YEASTS = [
    ("Lallemand", "D47", "Lalvin ICV-D47", "wine"), ("Lallemand", "QA23", "Lalvin QA23", "wine"),
    ("Lallemand", "RC212", "Lalvin RC212", "wine"), ("Lallemand", "ICVD254", "Lalvin ICV-D254", "wine"),
("Red Star", "PREMIERCUVEE", "Premier Cuvee", "wine"),
    ("Red Star", "COTEDESBLANCS", "Cote des Blancs", "wine"), ("Red Star", "PREMIERCLASSIQUE", "Premier Classique", "wine"),
]

def load_starter(stores):
    for h in STARTER_HONEY:
        name = f"{h} Honey"
        stores["fermentables"].add(ferm_key(name, ""), "starter", dict(
            name=name, fermentable_type="honey", potential_ppg=35.0,
            notes="About 35 gravity points per pound per US gallon; varies with moisture content."), name)
    for name, note in STARTER_JUICE:
        stores["fermentables"].add(ferm_key(name, ""), "starter", dict(name=name, fermentable_type="juice", notes=note), name)
    for name, mtype, note in STARTER_MISCS:
        stores["miscs"].add(misc_key(name), "starter", dict(name=name, misc_type=mtype, notes=note), name)
    for prod, pid, name, ytype in STARTER_YEASTS:
        add_yeast_common(stores, "starter", name=name, producer=prod, product_id=pid, ytype=ytype, form="dry",
                         tmin=None, tmax=None, att_min=None, att_max=None, floc=None, tol=None,
                         best_for="Wine, mead and cider", notes="Specs to be filled in from the producer's data sheet.")

# --------------------------------------------------------------------------- outputs
COLS = {
    "hops": ["id", "name", "origin", "hop_type", "alpha_acid_pct", "alpha_acid_min_pct", "alpha_acid_max_pct", "beta_acid_pct",
             "cohumulone_pct", "total_oil_ml_per_100g", "myrcene_pct", "humulene_pct", "caryophyllene_pct", "farnesene_pct",
             "hsi", "substitutes", "beverages", "notes"],
    "fermentables": ["id", "name", "fermentable_type", "producer", "product_id", "origin", "category", "color_lovibond", "color_ebc",
                     "yield_pct", "potential_ppg", "max_in_batch_pct", "diastatic_power_lintner", "protein_pct", "moisture_pct",
                     "beverages", "notes"],
    "yeasts": ["id", "name", "producer", "product_id", "yeast_type", "form", "temp_min_c", "temp_max_c", "attenuation_min_pct",
               "attenuation_max_pct", "flocculation", "alcohol_tolerance_pct", "best_for", "beverages", "notes"],
    "miscs": ["id", "name", "misc_type", "water_agent_type", "use", "use_for", "category", "beverages", "notes"],
    "styles": ["id", "style_guide", "style_id", "name", "category", "beverage", "og_min", "og_max", "fg_min", "fg_max", "ibu_min",
               "ibu_max", "color_srm_min", "color_srm_max", "abv_min_pct", "abv_max_pct", "carb_vols_min", "carb_vols_max"],
    "water_profiles": ["id", "name", "calcium_ppm", "magnesium_ppm", "sodium_ppm", "sulfate_ppm", "chloride_ppm", "bicarbonate_ppm", "notes"],
    "equipment": ["id", "name", "category", "batch_size_l", "boil_size_l", "kettle_volume_l", "kettle_loss_l", "boil_rate_l_per_hr",
                  "mash_tun_volume_l", "grain_absorption_l_per_kg", "notes"],
}
TRAILER = ["aliases", "sources", "source_names", "licenses", "merged_from"]

def build_rows(kind, store):
    rows = []
    merged = store.rows()
    hop_countries = Counter(r["_key"][0] for r in merged) if kind == "hops" else Counter()
    for r in merged:
        extra = {}
        if kind == "hops":
            name, variant = r["_key"]
            if hop_countries[name] < 2: variant = ""
            alphas = [f.get("alpha_acid_pct") for fl in r["_all"].values() for f in fl if f.get("alpha_acid_pct")]
            extra["alpha_acid_min_pct"] = min(alphas) if alphas else None
            extra["alpha_acid_max_pct"] = max(alphas) if alphas else None
            extra["id"] = slug("hop", name, variant)
            base_name = re.sub(r"\s*\([^)]*\)\s*$", "", r.get("name") or "")
            base_name = re.sub(r"\s*\([^)]*\)\s*$", "", base_name)
            r["name"] = f"{base_name} ({variant})" if variant else base_name
            extra["beverages"] = "beer;mead" if "mead" in (r.get("notes") or "").lower() else "beer"
        elif kind == "fermentables":
            extra["id"] = slug("ferm", r.get("producer"), r.get("name"))
            extra["color_ebc"] = lovibond_to_ebc(r.get("color_lovibond"))
            t = (r.get("fermentable_type") or "")
            if t in ("fruit", "sugar", "other"): bev = "beer;mead;wine;cider"
            elif t == "honey": bev = "beer;mead;cider"
            elif t == "juice": bev = beverages_for(r.get("name"), base="") or "wine;cider"
            else: bev = "beer"
            extra["beverages"] = bev
        elif kind == "yeasts":
            extra["id"] = slug("yeast", r.get("producer"), r.get("product_id") or r.get("name"))
            bevs = {b for fl in r["_all"].values() for f in fl for b in (f.get("_bev") or "").split(";") if b}
            yt = (r.get("yeast_type") or "")
            if yt in ("wine", "champagne"): bevs |= {"wine", "mead", "cider"}
            if yt in ("cider",): bevs.add("cider")
            if yt in ("mead",): bevs.add("mead")
            if not bevs or yt in ("ale", "lager", "kveik", "brett", "bacteria", "wheat", "lambic", "mixed-culture", "mixed culture", "other", ""):
                bevs.add("beer")
            nm = (r.get("name") or "").lower()
            if "lalvin" in nm or (r.get("producer") == "Red Star" and "dady" not in nm):
                bevs = {"mead", "wine", "cider"}
            extra["beverages"] = ";".join(b for b in ["beer", "mead", "wine", "cider"] if b in bevs)
        elif kind == "miscs":
            extra["id"] = slug("misc", r.get("name"))
            extra["beverages"] = beverages_for(" ".join(str(r.get(k) or "") for k in ("name", "misc_type", "use_for", "notes")), base="beer")
        elif kind == "styles":
            extra["id"] = slug("style", r.get("style_guide"), r.get("style_id") or r.get("name"))
        else:
            extra["id"] = slug(kind[:5], r.get("name"))
        rows.append(finish(r, COLS[kind], extra))
    # guarantee unique ids
    seen = Counter()
    for row in rows:
        seen[row["id"]] += 1
        if seen[row["id"]] > 1: row["id"] = f"{row['id']}-{seen[row['id']]}"
    rows.sort(key=lambda x: (x.get("style_guide", ""), x.get("producer", "") if kind in ("yeasts",) else "", x["name"].lower()))
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--include-unlicensed", action="store_true")
    a = ap.parse_args()
    stores = {k: Store(k) for k in COLS}
    load_brewtarget(a.src, stores, a.include_unlicensed)
    load_wallbrew(a.src, stores)
    load_beerproto(a.src, stores)
    load_bjcpjson(a.src, stores)
    load_starter(stores)

    os.makedirs(a.out, exist_ok=True)
    catalog, report = {}, []
    for kind, store in stores.items():
        rows = build_rows(kind, store)
        catalog[kind] = rows
        cols = COLS[kind] + TRAILER
        with open(os.path.join(a.out, f"{kind}.csv"), "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
            w.writeheader(); w.writerows(rows)
        raw_in = sum(len(it["names"]) for it in store.items.values())
        report.append((kind, raw_in, len(rows), sum(1 for r in rows if r["merged_from"] > 1)))

    commits = {}
    for repo in sorted({s["repo"] for s in SOURCES.values()}):
        try:
            commits[repo] = subprocess.run(["git", "-C", os.path.join(a.src, repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        except Exception:
            commits[repo] = ""
    with open(os.path.join(a.out, "sources.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["source_key", "name", "license", "url", "repo_commit", "included"])
        for k, s in SOURCES.items():
            inc = "no (excluded: upstream unlicensed)" if k == "bt003y" and not a.include_unlicensed else "yes"
            w.writerow([k, s["name"], s["license"], s["url"], commits.get(s["repo"], ""), inc])
    with open(os.path.join(a.out, "catalog.json"), "w", encoding="utf-8") as fh:
        json.dump({"sources": SOURCES, "commits": commits, "catalog": catalog}, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, "build_report.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh); w.writerow(["catalog", "entries_read", "entries_after_merge", "rows_merged_from_2plus"]); w.writerows(report)
    for r in report: print("%-15s read %5d  ->  %5d rows  (%d merged)" % r)

if __name__ == "__main__":
    main()
