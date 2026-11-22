// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AcidCalculator } from "../src/components/calculators/AcidCalculator";
import { BlendingCalculator } from "../src/components/calculators/BlendingCalculator";
import { CarbonationCalculator } from "../src/components/calculators/CarbonationCalculator";
import { ChaptalizationCalculator } from "../src/components/calculators/ChaptalizationCalculator";
import { ColorCalculator } from "../src/components/calculators/ColorCalculator";
import { DilutionCalculator } from "../src/components/calculators/DilutionCalculator";
import { HoneySugarCalculator } from "../src/components/calculators/HoneySugarCalculator";
import { IbuCalculator } from "../src/components/calculators/IbuCalculator";
import { InfusionCalculator } from "../src/components/calculators/InfusionCalculator";
import { NutrientsCalculator } from "../src/components/calculators/NutrientsCalculator";
import { StabilizeBacksweetenCalculator } from "../src/components/calculators/StabilizeBacksweetenCalculator";
import { StrikeSpargeCalculator } from "../src/components/calculators/StrikeSpargeCalculator";
import { SulfiteCalculator } from "../src/components/calculators/SulfiteCalculator";
import { YeastCalculator } from "../src/components/calculators/YeastCalculator";
import { UnitToggle } from "../src/components/UnitToggle";
import type { KeyValueStorage } from "../src/state/storage";
import { type UnitSystem, UnitsProvider } from "../src/state/units";

afterEach(cleanup);

const noopStorage: KeyValueStorage = {
  async getItem() {
    return null;
  },
  async setItem() {},
  async removeItem() {},
};

function renderWithUnits(ui: ReactElement, initialUnitSystem: UnitSystem = "us") {
  return render(
    <UnitsProvider initialUnitSystem={initialUnitSystem} storage={noopStorage}>
      <UnitToggle />
      {ui}
    </UnitsProvider>,
  );
}

function expectFormulaToggle(expectedSubstring: string) {
  expect(screen.queryByTestId("formula-content")).toBeNull();
  fireEvent.click(screen.getByTestId("formula-toggle"));
  expect(screen.getByTestId("formula-content").textContent).toContain(expectedSubstring);
}

describe("StrikeSpargeCalculator", () => {
  it("calculates strike temperature and sparge volume, toggles units, and reveals formula", () => {
    renderWithUnits(<StrikeSpargeCalculator />);

    expect(screen.getByTestId("strike-temp-result").textContent).toContain("°F");
    expectFormulaToggle("0.41 / r");

    fireEvent.click(screen.getByLabelText("Use Metric units"));
    expect(screen.getByTestId("strike-temp-result").textContent).toContain("°C");

    fireEvent.click(screen.getByLabelText("Sparge water volume"));
    expect(screen.getByTestId("sparge-volume-result").textContent).toContain("L");
    expect(screen.getByTestId("sparge-runoff-result").textContent).toContain("L");

    fireEvent.change(screen.getByTestId("sparge-preboil-input"), { target: { value: "-5" } });
    expect(screen.getByTestId("sparge-error").textContent).toContain("Pre-boil volume");
  });
});

describe("InfusionCalculator", () => {
  it("computes infusion volume, validates target > current, and reveals formula", () => {
    renderWithUnits(<InfusionCalculator />);
    expect(screen.getByTestId("infusion-volume-result").textContent).toContain("US gal");
    expectFormulaToggle("0.41 × G");

    fireEvent.change(screen.getByTestId("infusion-target-temp-input"), {
      target: { value: "140" },
    });
    expect(screen.getByTestId("infusion-error").textContent).toContain("above current");
  });
});

describe("IbuCalculator", () => {
  it("computes Tinseth and Rager IBUs, adds hop rows, and reveals formula", () => {
    renderWithUnits(<IbuCalculator />);
    const tinseth = screen.getByTestId("ibu-total-result").textContent;
    expect(tinseth).toContain("IBU");
    expectFormulaToggle("1.65 × 0.000125");

    fireEvent.click(screen.getByLabelText("Rager IBU formula"));
    expect(screen.getByTestId("ibu-total-result").textContent).not.toBe(tinseth);

    fireEvent.click(screen.getByTestId("ibu-add-hop"));
    expect(screen.getByTestId("ibu-hop-2-weight")).toBeTruthy();
  });
});

describe("ColorCalculator", () => {
  it("computes Morey SRM/EBC/MCU with swatch and supports adding fermentables", () => {
    renderWithUnits(<ColorCalculator />);
    expect(screen.getByTestId("color-srm-result").textContent).toContain("SRM");
    expect(screen.getByTestId("color-ebc-result").textContent).toContain("EBC");
    expect(screen.getByTestId("color-swatch")).toBeTruthy();
    expectFormulaToggle("1.4922 × MCU");

    fireEvent.click(screen.getByTestId("color-add-grain"));
    expect(screen.getByTestId("color-grain-2-weight")).toBeTruthy();
  });
});

describe("DilutionCalculator", () => {
  it("handles both dilution (water to add) and boil-off (concentrate)", () => {
    renderWithUnits(<DilutionCalculator />);
    expect(screen.getByTestId("dilution-change-result").textContent).toContain("US gal");
    expectFormulaToggle("V2 = V1");

    // Target higher than current => boil off
    fireEvent.change(screen.getByTestId("dilution-target-sg-input"), {
      target: { value: "1.080" },
    });
    expect(screen.getByText("Volume to Boil Off")).toBeTruthy();
  });
});

describe("CarbonationCalculator", () => {
  it("computes bottle priming sugar and keg PSI, respecting US/Metric toggle", () => {
    renderWithUnits(<CarbonationCalculator />);
    expect(screen.getByTestId("carb-priming-result").textContent).toContain("oz");
    expect(screen.getByTestId("carb-residual-result").textContent).toContain("vol");
    expectFormulaToggle("15.195");

    fireEvent.click(screen.getByLabelText("Keg force carbonation pressure"));
    expect(screen.getByTestId("carb-keg-result").textContent).toContain("PSI");

    fireEvent.click(screen.getByLabelText("Use Metric units"));
    expect(screen.getByTestId("carb-keg-result").textContent).toContain("bar");
  });
});

describe("YeastCalculator", () => {
  it("computes ale/lager pitch cells, packs needed, and stir-plate starter growth", () => {
    renderWithUnits(<YeastCalculator />);
    const aleCells = screen.getByTestId("yeast-cells-needed-result").textContent;
    expect(aleCells).toContain("B");
    expect(screen.getByTestId("yeast-starter-total-result").textContent).toContain("B");
    expectFormulaToggle("Troester");

    fireEvent.click(screen.getByLabelText("Lager pitch rate 1.50"));
    expect(screen.getByTestId("yeast-cells-needed-result").textContent).not.toBe(aleCells);
  });
});

describe("HoneySugarCalculator", () => {
  it("computes honey or sugar weight for target gravity and validates target >= current", () => {
    renderWithUnits(<HoneySugarCalculator />);
    expect(screen.getByTestId("honey-weight-result").textContent).toBe("15.00 lb");
    expectFormulaToggle("PPG");

    fireEvent.change(screen.getByTestId("honey-target-sg-input"), { target: { value: "0.990" } });
    expect(screen.getByTestId("honey-error").textContent).toContain("at least");
  });
});

describe("NutrientsCalculator", () => {
  it("computes YAN target and staggered 24h + 1/3 sugar break doses", () => {
    renderWithUnits(<NutrientsCalculator />);
    expect(screen.getByTestId("nutrients-total-result").textContent).toContain("g");
    expect(screen.getByTestId("nutrients-dose-1").textContent).toContain("g");
    expect(screen.getByTestId("nutrients-dose-2").textContent).toContain("g");
    expectFormulaToggle("YAN_target");
  });
});

describe("SulfiteCalculator", () => {
  it("computes free SO2 target and K-Meta dose from pH", () => {
    renderWithUnits(<SulfiteCalculator />);
    expect(screen.getByTestId("sulfite-free-result").textContent).toContain("ppm");
    expect(screen.getByTestId("sulfite-kmeta-result").textContent).toContain("g");
    expectFormulaToggle("10^(pH − 1.81)");

    fireEvent.change(screen.getByTestId("sulfite-ph-input"), { target: { value: "5.5" } });
    expect(screen.getByTestId("sulfite-error").textContent).toContain("pH");
  });
});

describe("StabilizeBacksweetenCalculator", () => {
  it("computes potassium sorbate and backsweetening weight with sulfite reminder", () => {
    renderWithUnits(<StabilizeBacksweetenCalculator />);
    expect(screen.getByTestId("stabilize-sorbate-result").textContent).toContain("g");
    expect(screen.getByTestId("stabilize-sweetener-result").textContent).toContain("lb");
    expect(screen.getByTestId("stabilize-sulfite-reminder").textContent).toContain("sulfite");
    expectFormulaToggle("150 − 25");

    fireEvent.change(screen.getByTestId("stabilize-abv-input"), { target: { value: "20" } });
    expect(screen.getByTestId("stabilize-error").textContent).toContain("ABV");
  });
});

describe("AcidCalculator", () => {
  it("computes acid addition by type and validates target >= current TA", () => {
    renderWithUnits(<AcidCalculator />);
    const tartaric = screen.getByTestId("acid-grams-result").textContent;
    expect(tartaric).toContain("g");
    expectFormulaToggle("equivalent_factor");

    fireEvent.click(screen.getByLabelText("Malic acid"));
    expect(screen.getByTestId("acid-grams-result").textContent).not.toBe(tartaric);

    fireEvent.change(screen.getByTestId("acid-target-ta-input"), { target: { value: "2.0" } });
    expect(screen.getByTestId("acid-error").textContent).toContain("Target TA");
  });
});

describe("ChaptalizationCalculator", () => {
  it("computes sugar weight and potential ABV boost", () => {
    renderWithUnits(<ChaptalizationCalculator />);
    expect(screen.getByTestId("chaptal-sugar-result").textContent).toContain("lb");
    expect(screen.getByTestId("chaptal-abv-boost").textContent).toContain("+");
    expectFormulaToggle("PPG");
  });
});

describe("BlendingCalculator", () => {
  it("computes volume-weighted blend across lots and allows adding lots", () => {
    renderWithUnits(<BlendingCalculator />);
    expect(screen.getByTestId("blend-volume-result").textContent).toBe("5.00 US gal");
    expect(screen.getByTestId("blend-abv-result").textContent).toBe("12.00%");
    expectFormulaToggle("Property_blend");

    fireEvent.click(screen.getByTestId("blend-add-lot"));
    expect(screen.getByTestId("blend-lot-2-volume")).toBeTruthy();
    // New lot leaves optional ABV blank, so blended ABV is omitted until all lots specify it.
    expect(screen.queryByTestId("blend-abv-result")).toBeNull();
  });
});
