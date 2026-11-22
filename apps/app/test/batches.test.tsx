// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note, Reading, Reminder } from "../src/api/batches";
import type { RecipeVersion } from "../src/api/recipes";
import { BatchNotesSection } from "../src/components/batches/BatchNotesSection";
import { BrewDayMode } from "../src/components/batches/BrewDayMode";
import {
  BEER_STATUS_FLOW,
  buildBrewDayPlan,
  buildChartSeries,
  FERMENTED_STATUS_FLOW,
  getStatusFlow,
} from "../src/components/batches/batchFlows";
import { FermentationChart } from "../src/components/batches/FermentationChart";
import { ReadingsSection } from "../src/components/batches/ReadingsSection";
import { RemindersSection } from "../src/components/batches/RemindersSection";
import type { KeyValueStorage } from "../src/state/storage";
import { UnitsProvider } from "../src/state/units";

afterEach(cleanup);

const noopStorage: KeyValueStorage = {
  async getItem() {
    return null;
  },
  async setItem() {},
  async removeItem() {},
};

const SAMPLE_BEER_VERSION: RecipeVersion = {
  id: "ver-1",
  version: 1,
  name: "Backyard Pale Ale",
  beverage: "beer",
  styleId: "style-bjcp-2015-18b",
  batchSizeL: 18.927,
  equipmentProfileId: null,
  createdAt: "2026-11-01T12:00:00Z",
  stats: null,
  statsError: null,
  styleFit: null,
  content: {
    schemaVersion: 1,
    efficiencyPct: 72,
    boilTimeMin: 60,
    fermentables: [{ name: "Pale Malt (2 Row)", kind: "grain", amountKg: 4.5, use: "mash" }],
    hops: [
      { name: "Columbus", amountKg: 0.02, alphaAcidPct: 16, use: "boil", timeMin: 60 },
      { name: "Cascade", amountKg: 0.028, alphaAcidPct: 6, use: "boil", timeMin: 15 },
    ],
    yeasts: [{ name: "Safale US-05", form: "dry", packs: 1 }],
    miscs: [],
    mash: [{ name: "Saccharification", type: "infusion", tempC: 66.7, timeMin: 60 }],
    fermentation: [],
  },
};

const SAMPLE_READINGS: Reading[] = [
  {
    id: "r-1",
    batchId: "b-1",
    takenAt: "2026-11-01T14:00:00Z",
    gravitySg: 1.055,
    temperatureC: 20,
    ph: 5.2,
    brix: null,
    titratableAcidityGPerL: null,
    freeSo2MgPerL: null,
    source: "manual",
    note: "Opening gravity",
    createdAt: "2026-11-01T14:00:00Z",
  },
  {
    id: "r-2",
    batchId: "b-1",
    takenAt: "2026-11-08T14:00:00Z",
    gravitySg: 1.012,
    temperatureC: 21,
    ph: 4.3,
    brix: null,
    titratableAcidityGPerL: null,
    freeSo2MgPerL: null,
    source: "manual",
    note: "Terminal gravity",
    createdAt: "2026-11-08T14:00:00Z",
  },
];

describe("batchFlows helpers", () => {
  it("returns beverage-specific status flows", () => {
    expect(getStatusFlow("beer")).toEqual(BEER_STATUS_FLOW);
    expect(getStatusFlow("mead")).toEqual(FERMENTED_STATUS_FLOW);
    expect(getStatusFlow("wine")).toEqual(FERMENTED_STATUS_FLOW);
    expect(getStatusFlow("cider")).toEqual(FERMENTED_STATUS_FLOW);
  });

  it("builds mash, boil, and hop-addition steps and alerts from a recipe version", () => {
    const plan = buildBrewDayPlan(SAMPLE_BEER_VERSION, "beer", "us");
    expect(plan.steps.some((s) => s.title.includes("Mash: Saccharification"))).toBe(true);
    expect(plan.steps.some((s) => s.title.includes("Cascade") && s.title.includes("15 min"))).toBe(
      true,
    );
    const boilTimer = plan.timers.find((t) => t.kind === "boil");
    expect(boilTimer).toBeDefined();
    expect(boilTimer?.durationSec).toBe(3600);
    // 60 - 15 = 45 min after boil start = 2700s
    expect(boilTimer?.alerts).toHaveLength(1);
    expect(boilTimer?.alerts[0]?.fireAfterSec).toBe(2700);
  });

  it("builds normalized chart series in US and Metric units", () => {
    const usSeries = buildChartSeries(SAMPLE_READINGS, "us");
    expect(usSeries.gravityPoints).toHaveLength(2);
    expect(usSeries.tempPoints).toHaveLength(2);
    expect(usSeries.tempUnit).toBe("°F");
    expect(usSeries.tempPoints[0]?.tempDisplay).toBeCloseTo(68, 1);

    const metricSeries = buildChartSeries(SAMPLE_READINGS, "metric");
    expect(metricSeries.tempUnit).toBe("°C");
    expect(metricSeries.tempPoints[0]?.tempDisplay).toBeCloseTo(20, 1);
  });
});

describe("FermentationChart", () => {
  it("renders empty state when no readings exist", () => {
    render(
      <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
        <FermentationChart readings={[]} />
      </UnitsProvider>,
    );
    expect(screen.getByTestId("fermentation-chart-empty")).toBeTruthy();
  });

  it("plots gravity and temperature points and computes ABV via brew-math", () => {
    render(
      <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
        <FermentationChart readings={SAMPLE_READINGS} />
      </UnitsProvider>,
    );
    expect(screen.getByTestId("fermentation-chart")).toBeTruthy();
    expect(screen.getByTestId("chart-gravity-point-0")).toBeTruthy();
    expect(screen.getByTestId("chart-gravity-point-1")).toBeTruthy();
    expect(screen.getByTestId("chart-temp-point-0")).toBeTruthy();
    expect(screen.getByTestId("chart-temp-point-1")).toBeTruthy();
    expect(screen.getByTestId("chart-latest-sg").textContent).toBe("1.012");
    // (1.055 - 1.012) * 131.25 = 5.64375 -> 5.64%
    expect(screen.getByTestId("chart-est-abv").textContent).toBe("5.64%");
  });
});

describe("BrewDayMode", () => {
  it("renders recipe steps, toggles checkmarks, and starts/pauses a timer", async () => {
    render(
      <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
        <BrewDayMode
          batchId="b-1"
          batchName="Backyard Pale Ale"
          beverage="beer"
          recipeVersion={SAMPLE_BEER_VERSION}
        />
      </UnitsProvider>,
    );

    const firstStep = screen.getByTestId("brew-step-0");
    fireEvent.click(firstStep);
    expect(screen.getByText(/1 of \d+ steps checked/)).toBeTruthy();

    const startBtn = screen.getByTestId("brew-timer-start-0");
    fireEvent.click(startBtn);
    await waitFor(() => {
      expect(screen.getByTestId("brew-timer-pause-0")).toBeTruthy();
    });
  });
});

describe("ReadingsSection", () => {
  it("converts US temperature to SI °C on submit and shows extended fields for mead", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(
      <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
        <ReadingsSection
          beverage="mead"
          readings={[]}
          canEdit
          onAddReading={onAdd}
          onUpdateReading={vi.fn().mockResolvedValue(undefined)}
          onDeleteReading={vi.fn().mockResolvedValue(undefined)}
        />
      </UnitsProvider>,
    );

    // Mead shows Brix, TA, and Free SO2 fields directly
    expect(screen.getByTestId("reading-brix-input")).toBeTruthy();
    expect(screen.getByTestId("reading-ta-input")).toBeTruthy();
    expect(screen.getByTestId("reading-so2-input")).toBeTruthy();

    fireEvent.change(screen.getByTestId("reading-gravity-input"), { target: { value: "1.105" } });
    fireEvent.change(screen.getByTestId("reading-temp-input"), { target: { value: "68" } });
    fireEvent.change(screen.getByTestId("reading-ph-input"), { target: { value: "3.6" } });
    fireEvent.change(screen.getByTestId("reading-ta-input"), { target: { value: "6.2" } });
    fireEvent.change(screen.getByTestId("reading-so2-input"), { target: { value: "35" } });

    fireEvent.click(screen.getByTestId("reading-submit-button"));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledTimes(1);
    });
    const payload = onAdd.mock.calls[0]?.[0];
    expect(payload.gravitySg).toBe(1.105);
    expect(payload.temperatureC).toBeCloseTo(20, 2);
    expect(payload.ph).toBe(3.6);
    expect(payload.titratableAcidityGPerL).toBe(6.2);
    expect(payload.freeSo2MgPerL).toBe(35);
  });
});

describe("RemindersSection", () => {
  it("displays reminders, completes one, and creates a new reminder", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn().mockResolvedValue(undefined);
    const reminders: Reminder[] = [
      {
        id: "rem-1",
        batchId: "b-1",
        batchName: "Traditional Mead",
        kind: "nutrient",
        dueAt: "2026-11-25T12:00:00Z",
        note: "Add 2.5g Fermaid O (24h)",
        doneAt: null,
        createdAt: "2026-11-22T12:00:00Z",
      },
    ];

    render(
      <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
        <RemindersSection
          reminders={reminders}
          canEdit
          onAddReminder={onAdd}
          onCompleteReminder={onDone}
        />
      </UnitsProvider>,
    );

    expect(screen.getByTestId("reminder-pending-0")).toBeTruthy();
    fireEvent.click(screen.getByTestId("reminder-done-button-0"));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith("rem-1");
    });

    fireEvent.change(screen.getByTestId("reminder-note-input"), {
      target: { value: "Rack to secondary" },
    });
    fireEvent.click(screen.getByTestId("reminder-submit-button"));
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledTimes(1);
    });
    expect(onAdd.mock.calls[0]?.[0]?.note).toBe("Rack to secondary");
  });
});

describe("BatchNotesSection", () => {
  it("submits a BJCP tasting note with live total and renders existing tasting scores", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const existing: Note[] = [
      {
        id: "n-1",
        uri: "http://localhost/notes/n-1",
        kind: "tasting",
        body: "Crisp piney pale ale",
        recipeId: null,
        batchId: "b-1",
        scores: {
          aroma: 10,
          appearance: 3,
          flavor: 16,
          mouthfeel: 4,
          overall: 8,
          total: 41,
        },
        visibility: "private",
        owner: { type: "user", id: "u-1" },
        createdAt: "2026-11-20T12:00:00Z",
        updatedAt: "2026-11-20T12:00:00Z",
      },
    ];

    render(
      <UnitsProvider initialUnitSystem="us" storage={noopStorage}>
        <BatchNotesSection
          batchId="b-1"
          notes={existing}
          canEdit
          onCreateNote={onCreate}
          onDeleteNote={vi.fn().mockResolvedValue(undefined)}
        />
      </UnitsProvider>,
    );

    expect(screen.getByText("41/50 BJCP")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Tasting Note (BJCP /50)" }));
    fireEvent.change(screen.getByTestId("tasting-score-aroma"), { target: { value: "11" } });
    fireEvent.change(screen.getByTestId("tasting-score-appearance"), { target: { value: "3" } });
    fireEvent.change(screen.getByTestId("tasting-score-flavor"), { target: { value: "18" } });
    fireEvent.change(screen.getByTestId("tasting-score-mouthfeel"), { target: { value: "4" } });
    fireEvent.change(screen.getByTestId("tasting-score-overall"), { target: { value: "9" } });
    expect(screen.getByTestId("tasting-score-total").textContent).toBe("45 / 50");

    fireEvent.change(screen.getByTestId("note-body-input"), {
      target: { value: "Bright citrus hops, dry finish" },
    });
    fireEvent.click(screen.getByTestId("note-submit-button"));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate.mock.calls[0]?.[0]).toEqual({
      kind: "tasting",
      batchId: "b-1",
      body: "Bright citrus hops, dry finish",
      scores: { aroma: 11, appearance: 3, flavor: 18, mouthfeel: 4, overall: 9 },
    });
  });
});
