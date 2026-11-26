// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import type { EquipmentCondition } from "../../api/equipment";
import type { UnitSystem } from "../../state/units";
import { formatFixed } from "../calculators/parseNumber";

export const EQUIPMENT_CONDITIONS: readonly {
  value: EquipmentCondition;
  label: string;
}[] = [
  { value: "new", label: "New" },
  { value: "good", label: "Good" },
  { value: "worn", label: "Worn" },
  { value: "needs_repair", label: "Needs repair" },
  { value: "retired", label: "Retired" },
];

export const CONDITION_LABELS: Record<EquipmentCondition, string> = {
  new: "New",
  good: "Good",
  worn: "Worn",
  needs_repair: "Needs repair",
  retired: "Retired",
};

export function volumeSiToDisplay(liters: number, unitSystem: UnitSystem): number {
  return unitSystem === "us" ? units.litersToGallons(liters) : liters;
}

export function volumeDisplayToSi(value: number, unitSystem: UnitSystem): number {
  return unitSystem === "us" ? units.gallonsToLiters(value) : value;
}

export function absorptionSiToDisplay(lPerKg: number, unitSystem: UnitSystem): number {
  return unitSystem === "us" ? units.litersToQuarts(units.lbToKg(lPerKg)) : lPerKg;
}

export function absorptionDisplayToSi(value: number, unitSystem: UnitSystem): number {
  return unitSystem === "us" ? units.kgToLb(units.quartsToLiters(value)) : value;
}

export function formatEquipmentVolume(liters: number, unitSystem: UnitSystem): string {
  const val = volumeSiToDisplay(liters, unitSystem);
  return `${formatFixed(val, 2)} ${unitSystem === "us" ? "gal" : "L"}`;
}

export function formatBoilRate(lPerHr: number, unitSystem: UnitSystem): string {
  const val = volumeSiToDisplay(lPerHr, unitSystem);
  return `${formatFixed(val, 2)} ${unitSystem === "us" ? "gal/hr" : "L/hr"}`;
}

export function formatGrainAbsorption(lPerKg: number, unitSystem: UnitSystem): string {
  const val = absorptionSiToDisplay(lPerKg, unitSystem);
  return `${formatFixed(val, 2)} ${unitSystem === "us" ? "qt/lb" : "L/kg"}`;
}

export function formatEditableNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}
