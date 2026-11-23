// SPDX-License-Identifier: AGPL-3.0-or-later
import { type UnitSystem, useUnits } from "../state/units";
import { SegmentedControl } from "./ui";

const UNIT_OPTIONS: readonly {
  value: UnitSystem;
  label: string;
  accessibilityLabel: string;
}[] = [
  { value: "us", label: "US", accessibilityLabel: "Use US units" },
  { value: "metric", label: "Metric", accessibilityLabel: "Use Metric units" },
];

export interface UnitToggleProps {
  onUnitChange?: (next: UnitSystem) => void;
}

export function UnitToggle({ onUnitChange }: UnitToggleProps = {}) {
  const { unitSystem, setUnitSystem } = useUnits();
  return (
    <SegmentedControl
      options={UNIT_OPTIONS}
      value={unitSystem}
      onChange={(next) => {
        setUnitSystem(next);
        onUnitChange?.(next);
      }}
      accessibilityLabel="Unit system"
      compact
    />
  );
}
