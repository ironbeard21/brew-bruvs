// SPDX-License-Identifier: AGPL-3.0-or-later
// Inventory unit conversions and formatting at the UI edge using @brew-bruvs/brew-math only.
import { units } from "@brew-bruvs/brew-math";
import type { InventoryItem, QuantityUnit, ShoppingList } from "../../api/inventory";
import type { UnitSystem } from "../../state/units";

export type DisplayUnit = "lb" | "oz" | "kg" | "g" | "gal" | "floz" | "l" | "ml" | "each";

export interface DisplayUnitOption {
  value: DisplayUnit;
  label: string;
  siUnit: QuantityUnit;
}

const US_UNITS: readonly DisplayUnitOption[] = [
  { value: "lb", label: "lb", siUnit: "kg" },
  { value: "oz", label: "oz", siUnit: "kg" },
  { value: "gal", label: "gal", siUnit: "l" },
  { value: "floz", label: "fl oz", siUnit: "l" },
  { value: "each", label: "each", siUnit: "each" },
];

const METRIC_UNITS: readonly DisplayUnitOption[] = [
  { value: "kg", label: "kg", siUnit: "kg" },
  { value: "g", label: "g", siUnit: "kg" },
  { value: "l", label: "L", siUnit: "l" },
  { value: "ml", label: "mL", siUnit: "l" },
  { value: "each", label: "each", siUnit: "each" },
];

export function displayUnitsForSystem(unitSystem: UnitSystem): readonly DisplayUnitOption[] {
  return unitSystem === "us" ? US_UNITS : METRIC_UNITS;
}

export function siUnitOf(displayUnit: DisplayUnit): QuantityUnit {
  if (displayUnit === "lb" || displayUnit === "oz" || displayUnit === "kg" || displayUnit === "g") {
    return "kg";
  }
  if (
    displayUnit === "gal" ||
    displayUnit === "floz" ||
    displayUnit === "l" ||
    displayUnit === "ml"
  ) {
    return "l";
  }
  return "each";
}

export function defaultDisplayUnitFor(
  siUnit: QuantityUnit,
  unitSystem: UnitSystem,
  sampleAmountSi?: number | null,
): DisplayUnit {
  if (siUnit === "each") return "each";
  if (siUnit === "kg") {
    const abs = sampleAmountSi != null ? Math.abs(sampleAmountSi) : null;
    if (unitSystem === "us") {
      return abs !== null && abs > 0 && abs < 0.25 ? "oz" : "lb";
    }
    return abs !== null && abs > 0 && abs < 0.5 ? "g" : "kg";
  }
  const abs = sampleAmountSi != null ? Math.abs(sampleAmountSi) : null;
  if (unitSystem === "us") {
    return abs !== null && abs > 0 && abs < 0.5 ? "floz" : "gal";
  }
  return abs !== null && abs > 0 && abs < 0.5 ? "ml" : "l";
}

export function convertDisplayUnitForSystem(
  current: DisplayUnit,
  nextSystem: UnitSystem,
): DisplayUnit {
  if (current === "each") return "each";
  if (nextSystem === "us") {
    if (current === "kg") return "lb";
    if (current === "g") return "oz";
    if (current === "l") return "gal";
    if (current === "ml") return "floz";
    return current;
  }
  if (current === "lb") return "kg";
  if (current === "oz") return "g";
  if (current === "gal") return "l";
  if (current === "floz") return "ml";
  return current;
}

export function displayUnitToSi(
  value: number,
  displayUnit: DisplayUnit,
): { amount: number; unit: QuantityUnit } {
  switch (displayUnit) {
    case "lb":
      return { amount: units.lbToKg(value), unit: "kg" };
    case "oz":
      return { amount: units.massToKg(value, "oz"), unit: "kg" };
    case "g":
      return { amount: units.massToKg(value, "g"), unit: "kg" };
    case "kg":
      return { amount: value, unit: "kg" };
    case "gal":
      return { amount: units.gallonsToLiters(value), unit: "l" };
    case "floz":
      return { amount: units.volumeToLiters(value, "floz"), unit: "l" };
    case "ml":
      return { amount: units.volumeToLiters(value, "ml"), unit: "l" };
    case "l":
      return { amount: value, unit: "l" };
    case "each":
      return { amount: value, unit: "each" };
  }
}

export function siToDisplayValue(amountSi: number, displayUnit: DisplayUnit): number {
  switch (displayUnit) {
    case "lb":
      return units.kgToLb(amountSi);
    case "oz":
      return units.gToOz(amountSi * 1000);
    case "g":
      return amountSi * 1000;
    case "kg":
      return amountSi;
    case "gal":
      return units.litersToGallons(amountSi);
    case "floz":
      return units.litersToGallons(amountSi) * 128;
    case "ml":
      return amountSi * 1000;
    case "l":
      return amountSi;
    case "each":
      return amountSi;
  }
}

export function formatNumberInput(value: number, displayUnit: DisplayUnit): string {
  if (!Number.isFinite(value)) return "";
  if (displayUnit === "each") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
  }
  if (displayUnit === "g" || displayUnit === "ml") {
    return Math.round(value) === value ? String(value) : value.toFixed(1);
  }
  return value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
}

export function formatInventoryAmount(
  amountSi: number,
  quantityUnit: QuantityUnit,
  unitSystem: UnitSystem,
): string {
  if (quantityUnit === "each") {
    return `${Number.isInteger(amountSi) ? amountSi : amountSi.toFixed(1)} each`;
  }
  const abs = Math.abs(amountSi);
  if (quantityUnit === "kg") {
    if (unitSystem === "us") {
      if (abs > 0 && abs < 0.25) {
        return `${units.gToOz(amountSi * 1000).toFixed(2)} oz`;
      }
      return `${units.kgToLb(amountSi).toFixed(2)} lb`;
    }
    if (abs > 0 && abs < 0.5) {
      return `${(amountSi * 1000).toFixed(0)} g`;
    }
    return `${amountSi.toFixed(2)} kg`;
  }
  if (unitSystem === "us") {
    if (abs > 0 && abs < 0.5) {
      return `${(units.litersToGallons(amountSi) * 128).toFixed(1)} fl oz`;
    }
    return `${units.litersToGallons(amountSi).toFixed(2)} gal`;
  }
  if (abs > 0 && abs < 0.5) {
    return `${(amountSi * 1000).toFixed(0)} mL`;
  }
  return `${amountSi.toFixed(2)} L`;
}

export function isLowStock(item: Pick<InventoryItem, "available" | "lowStockThreshold">): boolean {
  return item.lowStockThreshold != null && item.available < item.lowStockThreshold;
}

export function formatShoppingListText(
  shopping: ShoppingList,
  unitSystem: UnitSystem,
  scopeLabel: string,
): string {
  const lines: string[] = [`Brew-Bruvs Shopping List (${scopeLabel})`];
  if (shopping.short.length > 0) {
    lines.push("", "Short for planned batches:");
    for (const s of shopping.short) {
      const batchNames = s.batches.map((b) => b.name).join(", ");
      lines.push(
        `- [ ] ${s.name}: need ${formatInventoryAmount(s.short, s.unit, unitSystem)}${batchNames ? ` (${batchNames})` : ""}`,
      );
    }
  }
  if (shopping.lowStock.length > 0) {
    lines.push("", "Low stock:");
    for (const item of shopping.lowStock) {
      const avail = formatInventoryAmount(item.available, item.quantityUnit, unitSystem);
      const thresh =
        item.lowStockThreshold != null
          ? formatInventoryAmount(item.lowStockThreshold, item.quantityUnit, unitSystem)
          : "";
      lines.push(`- [ ] ${item.name}: ${avail} available${thresh ? ` (threshold ${thresh})` : ""}`);
    }
  }
  if (shopping.short.length === 0 && shopping.lowStock.length === 0) {
    lines.push("", "All stocked up — nothing to buy.");
  }
  return lines.join("\n");
}
