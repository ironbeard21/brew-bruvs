// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AbvCalculator } from "../src/components/calculators/AbvCalculator";
import { HydrometerCalculator } from "../src/components/calculators/HydrometerCalculator";
import { RefractometerCalculator } from "../src/components/calculators/RefractometerCalculator";
import { UnitConverter } from "../src/components/calculators/UnitConverter";
import { UnitToggle } from "../src/components/UnitToggle";
import type { KeyValueStorage } from "../src/state/storage";
import { type UnitSystem, UnitsProvider } from "../src/state/units";

afterEach(cleanup);

function createNoopStorage(): KeyValueStorage {
  return {
    async getItem() {
      return null;
    },
    async setItem() {},
    async removeItem() {},
  };
}

function renderWithUnits(ui: ReactElement, initialUnitSystem: UnitSystem = "us") {
  return render(
    <UnitsProvider initialUnitSystem={initialUnitSystem} storage={createNoopStorage()}>
      <UnitToggle />
      {ui}
    </UnitsProvider>,
  );
}

describe("AbvCalculator", () => {
  it("computes ABV, attenuation, and calories from OG and FG", () => {
    renderWithUnits(<AbvCalculator />);

    // Standard: (1.055 - 1.012) * 131.25 = 5.64375 -> 5.64%
    // Alternate: (76.08 * 0.043 / (1.775 - 1.055)) * (1.012 / 0.794) = 5.79%
    expect(screen.getByTestId("abv-standard-result").textContent).toBe("5.64%");
    expect(screen.getByTestId("abv-alternate-result").textContent).toBe("5.79%");
    expect(screen.getByTestId("abv-apparent-attenuation").textContent).toBe("78.2%");
    expect(screen.getByTestId("abv-real-attenuation").textContent).toBe("63.4%");
    expect(screen.getByText("per 12 US fl oz")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Use Metric units"));
    expect(screen.getByText("per 355 mL")).toBeTruthy();
  });

  it("validates when FG exceeds OG and supports Plato scale conversion", () => {
    renderWithUnits(<AbvCalculator />);

    fireEvent.change(screen.getByTestId("abv-fg-input"), { target: { value: "1.070" } });
    expect(screen.getByTestId("abv-error").textContent).toContain("Final gravity");

    fireEvent.change(screen.getByTestId("abv-fg-input"), { target: { value: "1.012" } });
    fireEvent.click(screen.getByLabelText("Input in Plato or Brix"));
    expect(screen.getByTestId("abv-standard-result").textContent).toBe("5.65%");
  });
});

describe("HydrometerCalculator", () => {
  it("corrects hydrometer readings in US units and converts temperatures on Metric toggle", () => {
    renderWithUnits(<HydrometerCalculator />, "us");

    // 1.050 measured at 75 °F with 60 °F calibration corrects to ~1.052
    expect(screen.getByTestId("hydro-corrected-result").textContent).toBe("1.052");

    fireEvent.click(screen.getByLabelText("Use Metric units"));
    const sampleInput = screen.getByTestId("hydro-sample-temp-input") as HTMLInputElement;
    expect(sampleInput.value).toBe("23.9");
    expect(screen.getByTestId("hydro-corrected-result").textContent).toBe("1.052");
  });

  it("shows a validation error when sample temperature is out of range", () => {
    renderWithUnits(<HydrometerCalculator />, "metric");
    fireEvent.change(screen.getByTestId("hydro-sample-temp-input"), { target: { value: "90" } });
    expect(screen.getByTestId("hydro-error").textContent).toContain("Sample temperature");
  });
});

describe("RefractometerCalculator", () => {
  it("calculates Terrill final gravity and switches to unfermented wort mode", () => {
    renderWithUnits(<RefractometerCalculator />);

    // Default: 13.5 OG Brix, 6.8 current Brix, WCF 1.04
    expect(screen.getByTestId("refrac-fg-result").textContent).toBe("1.012");
    expect(screen.getByTestId("refrac-og-sg-result").textContent).toBe("1.053");

    fireEvent.click(screen.getByText("Unfermented Wort"));
    expect(screen.getByTestId("refrac-unfermented-sg").textContent).toBe("1.053");
  });
});

describe("UnitConverter", () => {
  it("converts across gravity, temperature, mass, volume, color, and pressure", () => {
    renderWithUnits(<UnitConverter />);

    expect(screen.getByTestId("converter-result-plato").textContent).toBe("12.39");

    fireEvent.click(screen.getByText("Temp"));
    expect(screen.getByTestId("converter-result-c").textContent).toBe("20.0");

    fireEvent.click(screen.getByText("Mass"));
    expect(screen.getByTestId("converter-result-kg").textContent).toBe("4.536");

    fireEvent.click(screen.getByText("Volume"));
    expect(screen.getByTestId("converter-result-l").textContent).toBe("18.93");

    fireEvent.click(screen.getByText("Color"));
    expect(screen.getByTestId("converter-result-ebc").textContent).toBe("19.7");

    fireEvent.click(screen.getByText("Pressure"));
    expect(screen.getByTestId("converter-result-kpa").textContent).toBe("82.7");
  });
});
