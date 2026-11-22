// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { useEffect, useRef } from "react";
import type { UnitSystem } from "../../state/units";

export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatFixed(value: number, digits: number): string {
  return value.toFixed(digits);
}

/** Converts a numeric string through `convert`, leaving non-numeric strings untouched. */
export function convertText(raw: string, convert: (n: number) => number, digits: number): string {
  const n = parseNumber(raw);
  return n === null ? raw : formatFixed(convert(n), digits);
}

/** Runs `onChange` only when `unitSystem` actually changes after mount. */
export function useOnUnitSystemChange(
  unitSystem: UnitSystem,
  onChange: (next: UnitSystem) => void,
): void {
  const prevRef = useRef<UnitSystem>(unitSystem);
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (prevRef.current === unitSystem) return;
    prevRef.current = unitSystem;
    cbRef.current(unitSystem);
  }, [unitSystem]);
}

// Derived composite unit conversions built strictly on @brew-bruvs/brew-math/units.
export const qtPerLbToLPerKg = (qtPerLb: number): number =>
  units.quartsToLiters(qtPerLb) / units.lbToKg(1);
export const lPerKgToQtPerLb = (lPerKg: number): number =>
  units.litersToQuarts(lPerKg) / units.kgToLb(1);
export const galPerLbToLPerKg = (galPerLb: number): number =>
  units.gallonsToLiters(galPerLb) / units.lbToKg(1);
export const lPerKgToGalPerLb = (lPerKg: number): number =>
  units.litersToGallons(lPerKg) / units.kgToLb(1);

export function formatWeight(kg: number, unitSystem: UnitSystem): string {
  if (unitSystem === "us") {
    const lb = units.kgToLb(kg);
    return lb >= 1 ? `${formatFixed(lb, 2)} lb` : `${formatFixed(units.gToOz(kg * 1000), 2)} oz`;
  }
  return kg >= 1 ? `${formatFixed(kg, 3)} kg` : `${formatFixed(kg * 1000, 1)} g`;
}

export function formatSmallGrams(grams: number, unitSystem: UnitSystem): string {
  if (unitSystem === "us") {
    return `${formatFixed(units.gToOz(grams), 2)} oz (${formatFixed(grams, 1)} g)`;
  }
  return `${formatFixed(grams, 1)} g`;
}

export function formatVolume(liters: number, unitSystem: UnitSystem): string {
  return unitSystem === "us"
    ? `${formatFixed(units.litersToGallons(liters), 2)} US gal`
    : `${formatFixed(liters, 2)} L`;
}

export function formatTemp(tempC: number, unitSystem: UnitSystem): string {
  return unitSystem === "us"
    ? `${formatFixed(units.cToF(tempC), 1)} °F`
    : `${formatFixed(tempC, 1)} °C`;
}
