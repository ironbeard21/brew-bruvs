# SPDX-License-Identifier: AGPL-3.0-or-later
"""Independent Python implementations of the brew-math formulas, used to generate golden
test cases. Written separately from the TypeScript so coding mistakes in either show up.
Published reference values are added by hand and labeled with their source."""
import json, math, os

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
PY = "independent Python implementation of the published formula (test/golden/generate.py)"

GAL = 3.785411784
LB = 0.45359237
def f2c(f): return (f - 32) / 1.8
def c2f(c): return c * 1.8 + 32
def plato(sg): return -616.868 + 1111.14 * sg - 630.272 * sg**2 + 135.997 * sg**3
def sg_from_plato(p): return 1 + p / (258.6 - (p / 258.2) * 227.1)

def write(name, data):
    with open(f"{OUT}/{name}.json", "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")

def case(args, expected, tol, source=PY):
    return {"args": args, "expected": expected, "tolerance": tol, "source": source}

# ---------------------------------------------------------------- units
# The quick-reference table lists SG to 3 decimals; ±0.0005 SG is about ±0.13 °P.
PLATO_TABLE_TOL = 0.15
units = {
    "sgToPlato": [case([1.040], 10.0, PLATO_TABLE_TOL, "Plato table: 1.040 = 10.0 °P (beerandbrewing.com SG-Plato reference)"),
                  case([1.048], 12.0, PLATO_TABLE_TOL, "Plato table: 1.048 = 12.0 °P (beerandbrewing.com SG-Plato reference)"),
                  case([1.056], 13.8, PLATO_TABLE_TOL, "Plato table: 1.056 = 13.8 °P (beerandbrewing.com SG-Plato reference)"),
                  case([1.064], 15.7, PLATO_TABLE_TOL, "Plato table: 1.064 = 15.7 °P (beerandbrewing.com SG-Plato reference)"),
                  case([1.080], 19.3, PLATO_TABLE_TOL, "Plato table: 1.080 = 19.3 °P (beerandbrewing.com SG-Plato reference)"),
                  case([1.000], plato(1.000), 1e-9)],
    "platoToSg": [case([2], 1.0078, 0.00006, "Plato to SG table, calculator.academy: 2 °P = 1.0078"),
                  case([5], 1.0197, 0.00006, "Plato to SG table, calculator.academy: 5 °P = 1.0197"),
                  case([8], 1.0318, 0.00006, "Plato to SG table, calculator.academy: 8 °P = 1.0318"),
                  case([9], 1.0359, 0.00006, "Plato to SG table, calculator.academy: 9 °P = 1.0359"),
                  case([10], 1.0400, 0.00006, "Plato to SG table, calculator.academy: 10 °P = 1.0400"),
                  case([0], 1.0, 1e-12)],
    "cToF": [case([0], 32, 1e-9, "definition"), case([100], 212, 1e-9, "definition"), case([-40], -40, 1e-9, "definition"),
             case([20], 68, 1e-9, "definition"), case([66.7], 152.06, 1e-9, "definition")],
    "fToC": [case([32], 0, 1e-9, "definition"), case([212], 100, 1e-9, "definition"), case([-40], -40, 1e-9, "definition"),
             case([68], 20, 1e-9, "definition"), case([152], f2c(152), 1e-9, "definition")],
    "gallonsToLiters": [case([1], 3.785411784, 1e-12, "US gallon definition"), case([5], 18.92705892, 1e-9, "US gallon definition"),
                        case([0.5], 1.892705892, 1e-9, "US gallon definition"), case([10], 37.85411784, 1e-9, "US gallon definition"),
                        case([0], 0, 0, "definition")],
    "lbToKg": [case([1], 0.45359237, 1e-12, "international pound definition"), case([10], 4.5359237, 1e-9, "definition"),
               case([2.2], 0.997903214, 1e-9, "definition"), case([0.5], 0.226796185, 1e-9, "definition"), case([0], 0, 0, "definition")],
    "ozToG": [case([1], 28.349523125, 1e-9, "avoirdupois ounce definition"), case([2], 56.69904625, 1e-9, "definition"),
              case([0.5], 14.1747615625, 1e-9, "definition"), case([16], 453.59237, 1e-9, "16 oz = 1 lb"), case([0], 0, 0, "definition")],
    "quartsToLiters": [case([1], 0.946352946, 1e-12, "US quart definition"), case([4], 3.785411784, 1e-9, "4 qt = 1 gal"),
                       case([2], 1.892705892, 1e-9, "definition"), case([0.5], 0.473176473, 1e-9, "definition"), case([0], 0, 0, "definition")],
    "psiToKpa": [case([1], 6.894757293, 1e-6, "definition"), case([12], 82.73708752, 1e-6, "definition"),
                 case([14.5038], 100.0, 0.001, "1 bar = 14.5038 psi"), case([30], 206.8427188, 1e-6, "definition"), case([0], 0, 0, "definition")],
    "srmToEbc": [case([1], 1.97, 1e-9, "EBC = SRM × 1.97"), case([10], 19.7, 1e-9, "EBC = SRM × 1.97"), case([40], 78.8, 1e-9, "EBC = SRM × 1.97"),
                 case([4], 7.88, 1e-9, "EBC = SRM × 1.97"), case([0], 0, 0, "EBC = SRM × 1.97")],
    "lovibondToSrm": [case([L], 1.3546 * L - 0.76, 1e-9, "SRM = 1.3546 × °L − 0.76") for L in (2, 10, 40, 120, 500)],
}
write("units", units)

# ---------------------------------------------------------------- gravity
def abv_std(og, fg): return (og - fg) * 131.25
def abv_alt(og, fg): return (76.08 * (og - fg) / (1.775 - og)) * (fg / 0.794)
def app_att(og, fg): return (og - fg) / (og - 1) * 100
def real_att(og, fg):
    oe, ae = plato(og), plato(fg); re = 0.1808 * oe + 0.8192 * ae
    return (oe - re) / oe * 100
def cals(og, fg):
    a = 1881.22 * fg * (og - fg) / (1.775 - og)
    c = 3550.0 * fg * ((0.1808 * og) + (0.8192 * fg) - 1.0004)
    return a + max(c, 0)
pairs = [(1.050, 1.010), (1.040, 1.008), (1.065, 1.012), (1.090, 1.020), (1.120, 1.000), (1.035, 1.035)]
gravity = {
    "abvStandard": [case([1.050, 1.010], 5.25, 1e-9, "worked example: (1.050 − 1.010) × 131.25")] + [case([o, f], abv_std(o, f), 1e-9) for o, f in pairs],
    "abvAlternate": [case([o, f], abv_alt(o, f), 1e-9) for o, f in pairs],
    "apparentAttenuation": [case([1.050, 1.010], 80.0, 1e-9, "worked example: 40 of 50 points")] + [case([o, f], app_att(o, f), 1e-9) for o, f in pairs],
    "realAttenuation": [case([o, f], real_att(o, f), 1e-9) for o, f in pairs],
    "caloriesPer355ml": [case([o, f], cals(o, f), 1e-6) for o, f in pairs],
}
write("gravity", gravity)

# ---------------------------------------------------------------- hydrometer
def dens(t): return 1.00130346 - 0.000134722124 * t + 0.00000204052596 * t**2 - 0.00000000232820948 * t**3
def hyd(sg, tc, cc=15.56): return sg * dens(c2f(tc)) / dens(c2f(cc))
hydro = {"correctHydrometer": [case([1.050, 15.56], 1.050, 1e-9, "no correction at the calibration temperature")] +
         [case([sg, t], hyd(sg, t), 1e-9) for sg, t in ((1.050, 26.7), (1.060, 37.8), (1.010, 4.4), (1.080, 50), (1.040, 20))] +
         [case([1.050, 20, 20], 1.050, 1e-9, "no correction when sample equals calibration temperature")]}
write("hydrometer", hydro)

# ---------------------------------------------------------------- refractometer
def terrill(ob, fb, w=1.04):
    ob, fb = ob / w, fb / w
    return 1 - 0.0044993 * ob + 0.011774 * fb + 0.00027581 * ob**2 - 0.0012717 * fb**2 - 0.0000072800 * ob**3 + 0.000063293 * fb**3
refr = {
    "refractometerSg": [case([b], sg_from_plato(b / 1.04), 1e-12) for b in (5, 10, 12.5, 15, 20, 25)] + [case([12, 1.0], sg_from_plato(12), 1e-12)],
    "refractometerFinalGravity": [case([o, f], terrill(o, f), 1e-12) for o, f in ((12, 6, ), (15, 7.5), (20, 9), (10, 5), (25, 12))] +
                                 [case([12, 12], terrill(12, 12), 1e-12), case([18, 8, 1.0], terrill(18, 8, 1.0), 1e-12)],
}
write("refractometer", refr)

# ---------------------------------------------------------------- mash water
def strike(r, t1, t2): return 0.41 / r * (t2 - t1) + t2
QT_PER_LB_TO_L_PER_KG = 0.946352946 / LB
palmer = strike(1.5 * QT_PER_LB_TO_L_PER_KG, f2c(70), f2c(156))
def infuse(t1, t2, g, wm, tw=100): return (t2 - t1) * (0.41 * g + wm) / (tw - t2)
mash = {
    "strikeTemperature": [case([1.5 * QT_PER_LB_TO_L_PER_KG, f2c(70), f2c(156)], f2c(167.5), 0.3,
                               "Palmer, How to Brew: 1.5 qt/lb, grain 70 °F, target 156 °F → strike 167.5 °F (metric constant 0.41 differs by <0.3 °C)")] +
                         [case([r, t1, t2], strike(r, t1, t2), 1e-9) for r, t1, t2 in ((3, 20, 67), (2.5, 18, 65), (4, 22, 68), (2.6, 10, 66), (3.5, 25, 72))],
    "infusionVolume": [case([{"currentTempC": a, "targetTempC": b, "grainKg": g, "waterInMashL": w}], infuse(a, b, g, w), 1e-9)
                       for a, b, g, w in ((40, 52, 5, 15), (52, 63, 5, 15), (63, 72, 4.5, 13.5), (50, 66, 10, 30), (45, 55, 2, 6))] +
                      [case([{"currentTempC": 63, "targetTempC": 72, "grainKg": 5, "waterInMashL": 15, "infusionTempC": 95}], infuse(63, 72, 5, 15, 95), 1e-9)],
}
write("mash-water", mash)

# ---------------------------------------------------------------- dilution
def adj(v, a, b):
    v2 = v * (a - 1) / (b - 1); return {"finalVolumeL": v2, "changeL": v2 - v}
dil = {"gravityAdjustment": [case([20, 1.060, 1.050], {"finalVolumeL": 24.0, "changeL": 4.0}, 1e-9, "worked example: 20 L × 60 points = 24 L × 50 points")] +
       [case([v, a, b], adj(v, a, b), 1e-9) for v, a, b in ((25, 1.040, 1.048), (19, 1.070, 1.060), (10, 1.100, 1.080), (30, 1.045, 1.045), (5, 1.030, 1.050))]}
write("dilution", dil)

# ---------------------------------------------------------------- carbonation
def resid(tc): t = c2f(tc); return 3.0378 - 0.050062 * t + 0.00026555 * t**2
def prime(v, tc, vol, f=1.0): return 15.195 * (v / GAL) * (vol - resid(tc)) * f
def keg(tc, v):
    t = c2f(tc)
    psi = -16.6999 - 0.0101059 * t + 0.00116512 * t**2 + 0.173354 * t * v + 4.24267 * v - 0.0684226 * v**2
    return psi * 6.894757293168361
carb = {
    "residualCo2": [case([t], resid(t), 1e-9) for t in (2, 10, 18, 20, 24)],
    "primingSugar": [case([{"volumeL": v, "beerTempC": t, "targetVolumes": vol, "sugar": s}], prime(v, t, vol, 1.0 if s == "corn-sugar" else 0.91), 1e-9)
                     for v, t, vol, s in ((19, 20, 2.4, "corn-sugar"), (19, 20, 2.4, "table-sugar"), (23, 18, 2.6, "corn-sugar"), (10, 22, 3.0, "corn-sugar"), (40, 15, 2.2, "table-sugar"))],
    "kegPressure": [case([t, v], keg(t, v), 1e-9) for t, v in ((3.3, 2.5), (1, 2.4), (4, 2.7), (7, 2.2), (2, 3.0))],
}
write("carbonation", carb)

# ---------------------------------------------------------------- yeast
def cells(v, og, r): return r * v * 1000 * plato(og) / 1000
def starter(c0, v, sg=1.036):
    ext = v * 1000 * sg * plato(sg) / 100; ir = c0 / ext
    g = 1.4 if ir < 1.4 else (2.33 - 0.67 * ir if ir < 3.5 else 0.0)
    return {"extractG": ext, "newCellsBillion": g * ext, "totalCellsBillion": c0 + g * ext}
yeast = {
    "cellsNeeded": [case([v, og, r], cells(v, og, r), 1e-9) for v, og, r in ((20, 1.050, 0.75), (20, 1.050, 1.5), (23, 1.065, 0.75), (19, 1.040, 0.75), (40, 1.080, 1.0))],
    "packsNeeded": [case([c, p], n, 0, "ceiling of cells needed / cells per pack") for c, p, n in ((180, 100, 2), (200, 100, 2), (201, 100, 3), (90, 100, 1), (450, 90, 5))],
    "starterCells": [case([{"initialCellsBillion": c, "starterVolumeL": v}], starter(c, v), 1e-9) for c, v in ((100, 1), (100, 2), (200, 1), (300, 1), (50, 2))] +
                    [case([{"initialCellsBillion": 150, "starterVolumeL": 1.5, "starterSg": 1.040}], starter(150, 1.5, 1.040), 1e-9)],
}
write("yeast", yeast)

# ---------------------------------------------------------------- IBU
TINSETH_TABLE = {  # Glenn Tinseth, realbeer.com/hops/research.html, decimal utilization
    (1.030, 30): 0.212, (1.050, 60): 0.231, (1.050, 30): 0.177, (1.050, 15): 0.114, (1.070, 60): 0.193,
    (1.080, 90): 0.188, (1.040, 45): 0.232, (1.100, 120): 0.161, (1.060, 9): 0.070, (1.120, 70): 0.127,
}
def tins_u(g, t): return 1.65 * 0.000125**(g - 1) * (1 - math.exp(-0.04 * t)) / 4.15
def tins(a, w, t, v, g): return tins_u(g, t) * (a / 100 * w * 1000 / v)
def rag_u(t): return (18.11 + 13.86 * math.tanh((t - 31.32) / 18.27)) / 100
def rag(a, w, t, v, g):
    ga = (g - 1.050) / 0.2 if g > 1.050 else 0
    return rag_u(t) * (a / 100 * w * 1000 / v) / (1 + ga)
hops = [(12, 28, 60, 20, 1.050), (5.5, 30, 15, 20, 1.045), (14, 20, 90, 23, 1.080), (6, 50, 5, 19, 1.060), (4, 40, 0, 20, 1.050)]
ibu = {
    "tinsethUtilization": [case([g, t], u, 0.0006, "Tinseth utilization table (realbeer.com/hops/research.html)") for (g, t), u in TINSETH_TABLE.items()],
    "tinsethIbu": [case([{"alphaAcidPct": a, "hopGrams": w, "minutes": t}, {"volumeL": v, "boilSg": g}], tins(a, w, t, v, g), 1e-9) for a, w, t, v, g in hops],
    "ragerUtilization": [case([t], rag_u(t), 1e-12) for t in (0, 15, 30, 60, 90)],
    "ragerIbu": [case([{"alphaAcidPct": a, "hopGrams": w, "minutes": t}, {"volumeL": v, "boilSg": g}], rag(a, w, t, v, g), 1e-9) for a, w, t, v, g in hops],
    "totalIbu": [case([[{"alphaAcidPct": a, "hopGrams": w, "minutes": t} for a, w, t, _, _ in hops[:3]], {"volumeL": 20, "boilSg": 1.050}],
                      sum(tins(a, w, t, 20, 1.050) for a, w, t, _, _ in hops[:3]), 1e-9),
                 case([[{"alphaAcidPct": a, "hopGrams": w, "minutes": t} for a, w, t, _, _ in hops[:3]], {"volumeL": 20, "boilSg": 1.060}, "rager"],
                      sum(rag(a, w, t, 20, 1.060) for a, w, t, _, _ in hops[:3]), 1e-9),
                 case([[], {"volumeL": 20, "boilSg": 1.050}], 0, 0, "no hops, no IBUs"),
                 case([[{"alphaAcidPct": 12, "hopGrams": 28, "minutes": 60}], {"volumeL": 20, "boilSg": 1.050}], tins(12, 28, 60, 20, 1.050), 1e-9),
                 case([[{"alphaAcidPct": a, "hopGrams": w, "minutes": t} for a, w, t, _, _ in hops], {"volumeL": 40, "boilSg": 1.070}, "rager"],
                      sum(rag(a, w, t, 40, 1.070) for a, w, t, _, _ in hops), 1e-9)],
}
write("ibu", ibu)

# ---------------------------------------------------------------- color
def mcu(grains, v): return sum(kg / LB * l for kg, l in grains) / (v / GAL)
def morey(grains, v): return 1.4922 * mcu(grains, v)**0.6859
bills = [([(4.5, 2)], 20), ([(4.5, 2), (0.3, 60)], 20), ([(5, 3), (0.5, 40), (0.2, 350)], 23), ([(3.6, 1.8)], 19), ([(6, 4), (0.4, 120), (0.3, 500)], 25)]
color = {
    "mcu": [case([[{"kg": k, "lovibond": l} for k, l in g], v], mcu(g, v), 1e-9) for g, v in bills] +
           [case([[{"kg": LB * 10, "lovibond": 10}], GAL * 10], 10.0, 1e-9, "worked example: 10 lb of 10 °L in 10 gal = 10 MCU")],
    "moreySrm": [case([[{"kg": k, "lovibond": l} for k, l in g], v], morey(g, v), 1e-9) for g, v in bills],
}
write("color", color)

# ---------------------------------------------------------------- mead / wine / cider
def sugar(v, a, b, ppg): return (b - a) * 1000 * (v / GAL) / ppg * LB
FACT = {"low": 0.75, "medium": 0.9, "high": 1.25}
SCOTT = {20: (150, 180, 250), 22: (165, 200, 275), 24: (180, 220, 300), 26: (195, 240, 325), 28: (210, 260, 350), 30: (225, 280, 375)}
def kmeta(ppm, v): return ppm * v / 576
def free_so2(ph, m=0.8): return m * (1 + 10**(ph - 1.81))
EQ = {"tartaric": 1.0, "malic": 67.05 / 75.04, "citric": 64.04 / 75.04}
def plan(v, og, fg, need, yan, frac):
    tgt = plato(og) * 10 * FACT[need]; short = max(tgt - yan, 0); g = short * v / (frac * 1000)
    return {"yanTarget": tgt, "shortfall": short, "totalGrams": g,
            "doses": [{"when": "24h-after-pitch", "grams": g / 2}, {"when": "one-third-sugar-break", "grams": g / 2}],
            "oneThirdBreakSg": og - (og - fg) / 3}
yan_cases = []
for brix, (lo, me, hi) in SCOTT.items():
    og = sg_from_plato(brix)
    src = f"Scott Labs Winemaking Handbook table: {brix} °Brix → {lo}/{me}/{hi} ppm (input SG from {brix} °Brix via platoToSg)"
    yan_cases.append(case([og, "low"], lo, 2, src))
    yan_cases.append(case([og, "high"], hi, 3, src))
    # The 2022 table's medium column runs above sugar x 0.90 at 26-30 Brix (240/260/280 vs 234/252/270),
    # so medium is tested against the formula as quoted from the Scott Labs 2016 handbook.
    yan_cases.append(case([og, "medium"], plato(og) * 10 * 0.9, 1e-9,
                          "Scott Labs Winemaking Handbook 2016 formula: sugar (g/L) x 0.90 for medium-need strains"))
mead = {
    "sugarToRaiseGravity": [case([{"volumeL": GAL, "currentSg": 1.0, "targetSg": 1.035, "pointsPerPoundPerGallon": 35}], LB, 1e-9,
                                 "worked example: 1 lb honey at 35 PPG in 1 gal raises gravity 35 points")] +
                           [case([{"volumeL": v, "currentSg": a, "targetSg": b, "pointsPerPoundPerGallon": p}], sugar(v, a, b, p), 1e-9)
                            for v, a, b, p in ((19, 1.0, 1.100, 35), (23, 1.080, 1.090, 46), (20, 0.996, 1.010, 46), (5, 1.0, 1.130, 35), (60, 1.050, 1.060, 46))],
    "yanTarget": yan_cases,
    "nutrientPlan": [case([{"volumeL": v, "og": og, "expectedFg": fg, "need": n, "measuredYan": y, "nitrogenFraction": fr}], plan(v, og, fg, n, y, fr), 1e-9)
                     for v, og, fg, n, y, fr in ((19, 1.100, 1.000, "medium", 0, 0.21), (23, 1.090, 0.996, "high", 50, 0.13),
                                                 (5, 1.120, 1.010, "low", 0, 0.21), (20, 1.095, 0.995, "medium", 400, 0.21), (10, 1.080, 1.000, "high", 20, 0.13))] +
                    [case([{"volumeL": 10, "og": 1.080, "expectedFg": 1.000, "need": "low", "nitrogenFraction": 0.21}], plan(10, 1.080, 1.000, "low", 0, 0.21), 1e-9)],
    "freeSo2Needed": [case([3.4], free_so2(3.4), 1e-9), case([3.2], free_so2(3.2), 1e-9), case([3.6], free_so2(3.6), 1e-9),
                      case([3.5, 0.5], free_so2(3.5, 0.5), 1e-9), case([3.0], free_so2(3.0), 1e-9),
                      case([3.81, 1.0], 101.0, 1e-9, "worked example: pH 3.81 is 2 above pKa 1.81, so free = molecular × 101")],
    "potassiumMetabisulfite": [case([50, 23], 50 * 23 / 576, 1e-12, "57.6% SO2 by weight: 50 mg/L × 23 L / 576"),
                               case([30, 19], kmeta(30, 19), 1e-12), case([25, 100], kmeta(25, 100), 1e-12), case([10, 5], kmeta(10, 5), 1e-12),
                               case([0, 20], 0, 0, "no increase, no metabisulfite")],
    "acidAddition": [case([{"volumeL": v, "currentTa": a, "targetTa": b, "acid": acid}], (b - a) * v * EQ[acid], 1e-9)
                     for v, a, b, acid in ((19, 5.0, 6.5, "tartaric"), (19, 4.0, 6.0, "malic"), (23, 5.5, 7.0, "citric"), (100, 6.0, 6.0, "tartaric"), (10, 3.0, 7.0, "malic"))],
    "blend": [case([[{"volumeL": 10, "abv": 12, "sg": 1.000, "ta": 6}, {"volumeL": 10, "abv": 8, "sg": 1.010, "ta": 8}]],
                   {"volumeL": 20, "abv": 10, "sg": 1.005, "ta": 7}, 1e-9, "worked example: equal volumes average")] +
             [case([[{"volumeL": a, "abv": x}, {"volumeL": b, "abv": y}]], {"volumeL": a + b, "abv": (a * x + b * y) / (a + b)}, 1e-9)
              for a, x, b, y in ((5, 14, 15, 6), (19, 11.5, 4, 13), (100, 12.5, 25, 9))] +
             [case([[{"volumeL": 5, "abv": 10, "ta": 6}, {"volumeL": 5, "abv": 12}, {"volumeL": 10, "abv": 9}]], {"volumeL": 20, "abv": 10.0}, 1e-9,
                   "TA dropped because one lot has none; ABV weighted (50 + 60 + 90) / 20")],
}
write("mead-wine", mead)
for f in sorted(x for x in os.listdir(OUT) if x.endswith(".json")):
    d = json.load(open(f"{OUT}/{f}"))
    print(f, {k: len(v) for k, v in d.items()})
