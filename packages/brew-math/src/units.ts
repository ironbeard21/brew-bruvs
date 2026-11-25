// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit conversions. The only place in Brew-Bruvs that knows about non-SI units.

export const KG_PER_LB = 0.45359237;
export const G_PER_OZ = 28.349523125;
export const L_PER_US_GALLON = 3.785411784;
export const L_PER_US_QUART = 0.946352946;
export const KPA_PER_PSI = 6.894757293168361;

export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const gToOz = (g: number): number => g / G_PER_OZ;
export const ozToG = (oz: number): number => oz * G_PER_OZ;

export const litersToGallons = (l: number): number => l / L_PER_US_GALLON;
export const gallonsToLiters = (gal: number): number => gal * L_PER_US_GALLON;
export const litersToQuarts = (l: number): number => l / L_PER_US_QUART;
export const quartsToLiters = (qt: number): number => qt * L_PER_US_QUART;

const MASS_KG = { mg: 0.000001, g: 0.001, kg: 1, lb: KG_PER_LB, oz: G_PER_OZ / 1_000 };
const L_PER_IMPERIAL_GALLON = 4.54609;
const VOLUME_L = {
  ml: 0.001,
  l: 1,
  tsp: L_PER_US_GALLON / 768,
  tbsp: L_PER_US_GALLON / 256,
  floz: L_PER_US_GALLON / 128,
  cup: L_PER_US_GALLON / 16,
  pt: L_PER_US_GALLON / 8,
  qt: L_PER_US_QUART,
  gal: L_PER_US_GALLON,
  bbl: L_PER_US_GALLON * 31,
  ifloz: L_PER_IMPERIAL_GALLON / 160,
  ipt: L_PER_IMPERIAL_GALLON / 8,
  iqt: L_PER_IMPERIAL_GALLON / 4,
  igal: L_PER_IMPERIAL_GALLON,
  ibbl: L_PER_IMPERIAL_GALLON * 36,
};
const TIME_MINUTES = { sec: 1 / 60, min: 1, hr: 60, day: 1_440, week: 10_080 };

export const massToKg = (value: number, unit: keyof typeof MASS_KG) => value * MASS_KG[unit];
export const volumeToLiters = (value: number, unit: keyof typeof VOLUME_L) =>
  value * VOLUME_L[unit];
export const timeToMinutes = (value: number, unit: keyof typeof TIME_MINUTES) =>
  value * TIME_MINUTES[unit];
export const minutesToDays = (value: number) => value / TIME_MINUTES.day;

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const fToC = (f: number): number => ((f - 32) * 5) / 9;

export const psiToKpa = (psi: number): number => psi * KPA_PER_PSI;
export const kpaToPsi = (kpa: number): number => kpa / KPA_PER_PSI;
export const barToKpa = (bar: number): number => bar * 100;
export const kpaToBar = (kpa: number): number => kpa / 100;

/** Specific gravity → °Plato. ASBC best-fit polynomial. Valid for SG 1.000–1.170. */
export const sgToPlato = (sg: number): number =>
  ((135.997 * sg - 630.272) * sg + 1111.14) * sg - 616.868;

/** °Plato → specific gravity. Common inverse approximation used with the ASBC polynomial. */
export const platoToSg = (plato: number): number => 1 + plato / (258.6 - (plato / 258.2) * 227.1);

/** Scaled specific gravity from devices that transmit SG × 1000. */
export const milliSgToSg = (scaled: number): number => scaled / 1_000;

/** Gravity points per pound per gallon → SG potential for one pound in one US gallon. */
export const ppgToPotentialSg = (ppg: number): number => 1 + ppg / 1000;

/** Brix and Plato are interchangeable for brewing, wine and mead purposes. */
export const sgToBrix = sgToPlato;
export const brixToSg = platoToSg;

/** SRM ↔ EBC (EBC = SRM × 1.97). */
export const srmToEbc = (srm: number): number => srm * 1.97;
export const ebcToSrm = (ebc: number): number => ebc / 1.97;

/** Malt color: °Lovibond ↔ SRM (SRM = 1.3546 × °L − 0.76). */
export const lovibondToSrm = (lovibond: number): number => 1.3546 * lovibond - 0.76;
export const srmToLovibond = (srm: number): number => (srm + 0.76) / 1.3546;
