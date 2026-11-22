// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import type { BatchStatus, Reading, ReminderKind } from "../../api/batches";
import type { Beverage, RecipeVersion } from "../../api/recipes";
import type { UnitSystem } from "../../state/units";

export const BEER_STATUS_FLOW: readonly BatchStatus[] = [
  "planned",
  "brewing",
  "fermenting",
  "conditioning",
  "packaged",
  "finished",
] as const;

export const FERMENTED_STATUS_FLOW: readonly BatchStatus[] = [
  "planned",
  "primary",
  "secondary",
  "bulk_aging",
  "stabilized",
  "bottled",
  "bottle_aging",
  "finished",
] as const;

export function getStatusFlow(beverage: Beverage): readonly BatchStatus[] {
  return beverage === "beer" ? BEER_STATUS_FLOW : FERMENTED_STATUS_FLOW;
}

const STATUS_LABELS: Record<BatchStatus, string> = {
  planned: "Planned",
  brewing: "Brewing",
  fermenting: "Fermenting",
  conditioning: "Conditioning",
  packaged: "Packaged",
  primary: "Primary",
  secondary: "Secondary",
  bulk_aging: "Bulk Aging",
  stabilized: "Stabilized",
  bottled: "Bottled",
  bottle_aging: "Bottle Aging",
  finished: "Finished",
};

export function formatBatchStatus(status: BatchStatus): string {
  return STATUS_LABELS[status];
}

const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  nutrient: "Nutrient",
  rack: "Rack",
  sulfite: "Sulfite",
  taste: "Taste",
  ready: "Ready",
  custom: "Custom",
};

export function formatReminderKind(kind: ReminderKind): string {
  return REMINDER_KIND_LABELS[kind];
}

export function formatVolume(liters: number | null | undefined, unitSystem: UnitSystem): string {
  if (liters == null || !Number.isFinite(liters)) return "—";
  if (unitSystem === "us") {
    return `${units.litersToGallons(liters).toFixed(2)} gal`;
  }
  return `${liters.toFixed(1)} L`;
}

export function formatTemperature(tempC: number, unitSystem: UnitSystem): string {
  if (unitSystem === "us") {
    return `${units.cToF(tempC).toFixed(1)} °F`;
  }
  return `${tempC.toFixed(1)} °C`;
}

export function formatMass(kg: number, unitSystem: UnitSystem): string {
  if (unitSystem === "us") {
    const lb = units.kgToLb(kg);
    if (lb < 1) {
      return `${units.gToOz(kg * 1000).toFixed(2)} oz`;
    }
    return `${lb.toFixed(2)} lb`;
  }
  if (kg < 1) {
    return `${Math.round(kg * 1000)} g`;
  }
  return `${kg.toFixed(2)} kg`;
}

export function formatShortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

// ── Brew-day checklist & timers from RecipeVersion ────────────────────

export interface BrewDayStep {
  id: string;
  phase: "prep" | "mash" | "boil" | "hop" | "chill" | "ferment";
  title: string;
  detail: string;
  timerSec?: number;
}

export interface BrewDayAlertOffset {
  id: string;
  label: string;
  fireAfterSec: number;
}

export interface BrewDayTimerSpec {
  id: string;
  kind: "mash" | "boil" | "hop" | "whirlpool" | "custom";
  label: string;
  detail: string;
  durationSec: number;
  /** Optional intermediate alerts (e.g. boil hop additions while the boil timer counts down). */
  alerts: BrewDayAlertOffset[];
}

export interface BrewDayPlan {
  steps: BrewDayStep[];
  timers: BrewDayTimerSpec[];
}

export function buildBrewDayPlan(
  recipeVersion: RecipeVersion | null | undefined,
  beverage: Beverage,
  unitSystem: UnitSystem,
): BrewDayPlan {
  const steps: BrewDayStep[] = [];
  const timers: BrewDayTimerSpec[] = [];

  steps.push({
    id: "prep-sanitize",
    phase: "prep",
    title: "Clean, sanitize & measure ingredients",
    detail: recipeVersion
      ? `Target batch volume: ${formatVolume(recipeVersion.batchSizeL, unitSystem)}`
      : "Prepare fermenter, hydrometer, thermometer, and sanitizer.",
  });

  if (!recipeVersion) {
    if (beverage === "beer") {
      timers.push(
        {
          id: "timer-mash-default",
          kind: "mash",
          label: "Mash rest",
          detail: "60 min mash timer",
          durationSec: 60 * 60,
          alerts: [],
        },
        {
          id: "timer-boil-default",
          kind: "boil",
          label: "Boil",
          detail: "60 min boil timer",
          durationSec: 60 * 60,
          alerts: [],
        },
      );
    }
    return { steps, timers };
  }

  const { content } = recipeVersion;

  // 1. Mash steps (mostly beer)
  if (content.mash.length > 0) {
    const mashGrains = content.fermentables
      .filter((f) => f.use === "mash" || f.kind === "grain")
      .map((f) =>
        f.amountKg != null ? `${f.name} (${formatMass(f.amountKg, unitSystem)})` : f.name,
      );
    if (mashGrains.length > 0) {
      steps.push({
        id: "mash-dough-in",
        phase: "mash",
        title: "Dough in grains",
        detail: mashGrains.join(" · "),
      });
    }
    content.mash.forEach((step, idx) => {
      const tempText = formatTemperature(step.tempC, unitSystem);
      const infuseText =
        step.infuseL != null ? ` · Infuse ${formatVolume(step.infuseL, unitSystem)}` : "";
      const durationSec = Math.round(step.timeMin * 60);
      steps.push({
        id: `mash-${idx}`,
        phase: "mash",
        title: `Mash: ${step.name}`,
        detail: `${tempText} for ${step.timeMin} min (${step.type})${infuseText}`,
        ...(durationSec > 0 ? { timerSec: durationSec } : {}),
      });
      if (durationSec > 0) {
        timers.push({
          id: `timer-mash-${idx}`,
          kind: "mash",
          label: `Mash: ${step.name}`,
          detail: `${tempText} · ${step.timeMin} min`,
          durationSec,
          alerts: [],
        });
      }
    });
  } else if (beverage === "beer") {
    const mashGrains = content.fermentables.filter((f) => f.kind === "grain" || f.use === "mash");
    if (mashGrains.length > 0) {
      steps.push({
        id: "mash-single-infusion",
        phase: "mash",
        title: "Mash grains",
        detail: mashGrains
          .map((f) =>
            f.amountKg != null ? `${f.name} (${formatMass(f.amountKg, unitSystem)})` : f.name,
          )
          .join(" · "),
        timerSec: 60 * 60,
      });
      timers.push({
        id: "timer-mash-default",
        kind: "mash",
        label: "Mash rest",
        detail: "60 min single infusion",
        durationSec: 60 * 60,
        alerts: [],
      });
    }
  }

  // First-wort hops
  const fwh = content.hops.filter((h) => h.use === "first_wort");
  if (fwh.length > 0) {
    steps.push({
      id: "hop-first-wort",
      phase: "hop",
      title: "Add first-wort hops",
      detail: fwh.map((h) => `${h.name} (${formatMass(h.amountKg, unitSystem)})`).join(" · "),
    });
  }

  // 2. Boil & boil hop additions
  const boilHops = content.hops
    .filter((h) => h.use === "boil")
    .slice()
    .sort((a, b) => (b.timeMin ?? 0) - (a.timeMin ?? 0));
  const boilMiscs = content.miscs.filter((m) => m.use === "boil");
  const boilTimeMin = content.boilTimeMin ?? (beverage === "beer" || boilHops.length > 0 ? 60 : 0);

  if (boilTimeMin > 0) {
    const boilSec = Math.round(boilTimeMin * 60);
    const hopAlerts: BrewDayAlertOffset[] = [];

    steps.push({
      id: "boil-start",
      phase: "boil",
      title: `Bring wort to a rolling boil (${boilTimeMin} min)`,
      detail:
        boilHops.length > 0
          ? `${boilHops.length} boil hop addition${boilHops.length === 1 ? "" : "s"} scheduled`
          : "Start boil timer once hot break clears.",
      timerSec: boilSec,
    });

    boilHops.forEach((hop, idx) => {
      const remainingMin = hop.timeMin ?? 0;
      const fireAfterMin = Math.max(0, boilTimeMin - remainingMin);
      const amountLabel = formatMass(hop.amountKg, unitSystem);
      const title = `Add ${hop.name} (${amountLabel}) at ${remainingMin} min left`;
      steps.push({
        id: `hop-boil-${idx}`,
        phase: "hop",
        title,
        detail:
          fireAfterMin > 0
            ? `${fireAfterMin} min into boil${hop.alphaAcidPct != null ? ` · ${hop.alphaAcidPct}% AA` : ""}`
            : `At boil start${hop.alphaAcidPct != null ? ` · ${hop.alphaAcidPct}% AA` : ""}`,
        ...(remainingMin > 0 ? { timerSec: Math.round(remainingMin * 60) } : {}),
      });

      if (fireAfterMin > 0 && fireAfterMin < boilTimeMin) {
        hopAlerts.push({
          id: `boil-alert-${idx}`,
          label: `Hop addition: ${hop.name} (${amountLabel}) — ${remainingMin} min left`,
          fireAfterSec: Math.round(fireAfterMin * 60),
        });
      }

      if (remainingMin > 0) {
        timers.push({
          id: `timer-hop-${idx}`,
          kind: "hop",
          label: `Hop: ${hop.name} (${remainingMin} min)`,
          detail: `${amountLabel} · ${fireAfterMin} min after boil start`,
          durationSec: Math.round(remainingMin * 60),
          alerts: [],
        });
      }
    });

    boilMiscs.forEach((misc, idx) => {
      const atMin = misc.timeMin != null ? ` at ${misc.timeMin} min left` : " during boil";
      steps.push({
        id: `misc-boil-${idx}`,
        phase: "boil",
        title: `Add ${misc.name}${atMin}`,
        detail: misc.note ?? misc.kind,
      });
    });

    timers.push({
      id: "timer-boil-main",
      kind: "boil",
      label: `Boil (${boilTimeMin} min)`,
      detail:
        hopAlerts.length > 0
          ? `Includes ${hopAlerts.length} hop alert${hopAlerts.length === 1 ? "" : "s"}`
          : "Main boil countdown",
      durationSec: boilSec,
      alerts: hopAlerts,
    });
  }

  // Whirlpool hops
  const whirlpoolHops = content.hops.filter((h) => h.use === "whirlpool");
  whirlpoolHops.forEach((hop, idx) => {
    const mins = hop.timeMin ?? 15;
    const tempPart = hop.tempC != null ? ` at ${formatTemperature(hop.tempC, unitSystem)}` : "";
    const amountLabel = formatMass(hop.amountKg, unitSystem);
    steps.push({
      id: `hop-whirlpool-${idx}`,
      phase: "hop",
      title: `Whirlpool ${hop.name} (${amountLabel})`,
      detail: `${mins} min${tempPart}`,
      timerSec: Math.round(mins * 60),
    });
    timers.push({
      id: `timer-whirlpool-${idx}`,
      kind: "whirlpool",
      label: `Whirlpool: ${hop.name}`,
      detail: `${amountLabel} · ${mins} min${tempPart}`,
      durationSec: Math.round(mins * 60),
      alerts: [],
    });
  });

  // 3. Non-mash / must / fermentation fermentables (mead, wine, cider, sugar additions)
  const fermIngredients = content.fermentables.filter(
    (f) =>
      f.use === "fermentation" || (beverage !== "beer" && f.use !== "mash" && f.use !== "boil"),
  );
  if (fermIngredients.length > 0) {
    steps.push({
      id: "ferment-mix-must",
      phase: "ferment",
      title: beverage === "beer" ? "Add fermenter sugars / adjuncts" : "Mix must & check OG",
      detail: fermIngredients
        .map((f) => {
          const amt =
            f.amountKg != null
              ? formatMass(f.amountKg, unitSystem)
              : f.amountL != null
                ? formatVolume(f.amountL, unitSystem)
                : "";
          return amt ? `${f.name} (${amt})` : f.name;
        })
        .join(" · "),
    });
  }

  // Primary miscs (nutrients, sulfite, enzymes, acid)
  const primaryMiscs = content.miscs.filter((m) => m.use === "primary");
  if (primaryMiscs.length > 0) {
    steps.push({
      id: "ferment-primary-miscs",
      phase: "ferment",
      title: "Add primary additions",
      detail: primaryMiscs
        .map((m) => `${m.name}${m.dayOffset != null ? ` (day ${m.dayOffset})` : ""}`)
        .join(" · "),
    });
  }

  // 4. Chill, take OG & pitch yeast
  const yeastNames = content.yeasts.map((y) =>
    y.packs != null ? `${y.name} (${y.packs}x)` : y.name,
  );
  steps.push({
    id: "chill-and-pitch",
    phase: "chill",
    title:
      beverage === "beer"
        ? "Chill wort, measure OG & pitch yeast"
        : "Check must temperature, measure OG & pitch yeast",
    detail:
      yeastNames.length > 0
        ? `Yeast: ${yeastNames.join(" · ")}`
        : "Log your opening gravity and temperature in the Readings tab.",
  });

  // Dry hops reminder step
  const dryHops = content.hops.filter((h) => h.use === "dry_hop");
  if (dryHops.length > 0) {
    steps.push({
      id: "ferment-dry-hops",
      phase: "ferment",
      title: "Schedule dry-hop additions",
      detail: dryHops
        .map(
          (h) =>
            `${h.name} (${formatMass(h.amountKg, unitSystem)}${h.days != null ? `, ${h.days}d` : ""})`,
        )
        .join(" · "),
    });
  }

  return { steps, timers };
}

// ── Fermentation chart data builder ───────────────────────────────────

export interface ChartGravityPoint {
  id: string;
  takenAt: string;
  takenMs: number;
  label: string;
  sg: number;
  xNorm: number;
  yNorm: number;
}

export interface ChartTempPoint {
  id: string;
  takenAt: string;
  takenMs: number;
  label: string;
  tempC: number;
  tempDisplay: number;
  xNorm: number;
  yNorm: number;
}

export interface FermentationChartSeries {
  gravityPoints: ChartGravityPoint[];
  tempPoints: ChartTempPoint[];
  sgMin: number;
  sgMax: number;
  tempMin: number;
  tempMax: number;
  tempUnit: "°F" | "°C";
  minMs: number;
  maxMs: number;
}

export function buildChartSeries(
  readings: readonly Reading[],
  unitSystem: UnitSystem,
): FermentationChartSeries {
  const sorted = readings
    .map((r) => ({ reading: r, ms: Date.parse(r.takenAt) }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => a.ms - b.ms);

  const rawGravity = sorted.filter((item) => item.reading.gravitySg != null);
  const rawTemp = sorted.filter((item) => item.reading.temperatureC != null);

  const allMs = [...rawGravity.map((x) => x.ms), ...rawTemp.map((x) => x.ms)];
  const minMs = allMs.length > 0 ? Math.min(...allMs) : 0;
  const maxMs = allMs.length > 0 ? Math.max(...allMs) : 0;
  const msSpan = maxMs - minMs;

  const normalizeX = (ms: number, idx: number, total: number): number => {
    if (msSpan > 0) return (ms - minMs) / msSpan;
    if (total <= 1) return 0.5;
    return idx / (total - 1);
  };

  // Gravity domain with sensible padding
  const sgValues = rawGravity.map((x) => x.reading.gravitySg as number);
  let sgMin = sgValues.length > 0 ? Math.min(...sgValues) : 1.0;
  let sgMax = sgValues.length > 0 ? Math.max(...sgValues) : 1.06;
  const sgPad = Math.max(0.005, (sgMax - sgMin) * 0.12);
  sgMin = Math.max(0.98, Math.floor((sgMin - sgPad) * 1000) / 1000);
  sgMax = Math.ceil((sgMax + sgPad) * 1000) / 1000;
  const sgSpan = Math.max(0.001, sgMax - sgMin);

  // Temperature domain in user's display units
  const tempUnit: "°F" | "°C" = unitSystem === "us" ? "°F" : "°C";
  const toDisplayTemp = (c: number) => (unitSystem === "us" ? units.cToF(c) : c);
  const tempValues = rawTemp.map((x) => toDisplayTemp(x.reading.temperatureC as number));
  let tempMin = tempValues.length > 0 ? Math.min(...tempValues) : unitSystem === "us" ? 60 : 15;
  let tempMax = tempValues.length > 0 ? Math.max(...tempValues) : unitSystem === "us" ? 75 : 24;
  const tempPad = Math.max(2, (tempMax - tempMin) * 0.15);
  tempMin = Math.floor(tempMin - tempPad);
  tempMax = Math.ceil(tempMax + tempPad);
  const tempSpan = Math.max(1, tempMax - tempMin);

  const gravityPoints: ChartGravityPoint[] = rawGravity.map((item, idx) => {
    const sg = item.reading.gravitySg as number;
    return {
      id: item.reading.id,
      takenAt: item.reading.takenAt,
      takenMs: item.ms,
      label: formatShortDate(item.reading.takenAt),
      sg,
      xNorm: normalizeX(item.ms, idx, rawGravity.length),
      yNorm: (sg - sgMin) / sgSpan,
    };
  });

  const tempPoints: ChartTempPoint[] = rawTemp.map((item, idx) => {
    const tempC = item.reading.temperatureC as number;
    const tempDisplay = toDisplayTemp(tempC);
    return {
      id: item.reading.id,
      takenAt: item.reading.takenAt,
      takenMs: item.ms,
      label: formatShortDate(item.reading.takenAt),
      tempC,
      tempDisplay,
      xNorm: normalizeX(item.ms, idx, rawTemp.length),
      yNorm: (tempDisplay - tempMin) / tempSpan,
    };
  });

  return {
    gravityPoints,
    tempPoints,
    sgMin,
    sgMax,
    tempMin,
    tempMax,
    tempUnit,
    minMs,
    maxMs,
  };
}
