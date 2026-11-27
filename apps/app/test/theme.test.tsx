// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Pressable, Text, View } from "react-native";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeGallery, ThemeSwitcherButton } from "../src/components/ThemeGallery";
import { Button, Card } from "../src/components/ui";
import type { KeyValueStorage } from "../src/state/storage";
import { ThemeProvider, useTheme } from "../src/state/theme";
import { DEFAULT_THEME_ID, getThemeById, THEMES, type ThemeCategory } from "../src/theme";

afterEach(() => {
  cleanup();
});

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) {
    throw new Error(`Expected 6-digit hex color, got: ${hex}`);
  }
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

function ThemeHarness() {
  const { theme, setThemeId } = useTheme();
  return (
    <View>
      <Text testID="active-theme-id">{theme.id}</Text>
      <Text testID="active-theme-mode">{theme.mode}</Text>
      <Text testID="active-theme-accent">{theme.colors.accent}</Text>
      <Card testID="themed-sample-card">
        <Button
          label="Switch to Stout"
          onPress={() => setThemeId("imperial-stout")}
          testID="switch-stout"
        />
      </Card>
      <Pressable testID="switch-rose" onPress={() => setThemeId("provence-rose")}>
        <Text>Provence Rosé</Text>
      </Pressable>
    </View>
  );
}

describe("Beverage theme catalog", () => {
  it("provides at least 13 distinct beverage themes spanning beer, wine, mead, and cider with light & dark modes", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(13);
    expect(THEMES.length).toBe(16);

    const ids = new Set(THEMES.map((t) => t.id));
    expect(ids.size).toBe(THEMES.length);

    const categories: ThemeCategory[] = ["beer", "wine", "mead", "cider"];
    for (const cat of categories) {
      const catThemes = THEMES.filter((t) => t.category === cat);
      expect(catThemes.length).toBe(4);
      expect(catThemes.filter((t) => t.mode === "light").length).toBe(2);
      expect(catThemes.filter((t) => t.mode === "dark").length).toBe(2);
    }
  });

  it("falls back safely to the default theme for unknown IDs", () => {
    expect(getThemeById("non-existent-theme").id).toBe(DEFAULT_THEME_ID);
    expect(getThemeById(null).id).toBe(DEFAULT_THEME_ID);
    expect(getThemeById(undefined).id).toBe(DEFAULT_THEME_ID);
  });

  it("meets WCAG AA (>= 4.5:1) contrast on all text, button, banner, chart, and chip pairings across every theme", () => {
    for (const theme of THEMES) {
      const c = theme.colors;
      const checks: [string, string, string, number][] = [
        ["text on canvas", c.text, c.canvas, 7.0],
        ["text on surface", c.text, c.surface, 7.0],
        ["text on surfaceSubtle", c.text, c.surfaceSubtle, 7.0],
        ["textMuted on canvas", c.textMuted, c.canvas, 4.5],
        ["textMuted on surface", c.textMuted, c.surface, 4.5],
        ["textMuted on surfaceSubtle", c.textMuted, c.surfaceSubtle, 4.5],
        ["accentText on accent", c.accentText, c.accent, 4.5],
        ["accentText on accentPressed", c.accentText, c.accentPressed, 4.5],
        ["accent on surface (ghost buttons)", c.accent, c.surface, 4.5],
        ["accentPressed on accentSoft (pills/banners)", c.accentPressed, c.accentSoft, 4.5],
        ["accentPressed on surface", c.accentPressed, c.surface, 4.5],
        ["chartTemp on surface", c.chartTemp, c.surface, 4.5],
        ["success on successSoft", c.success, c.successSoft, 4.5],
        ["success on surface", c.success, c.surface, 4.5],
        ["error on errorSoft", c.error, c.errorSoft, 4.5],
        ["error on surface", c.error, c.surface, 4.5],
        ["secondary on secondarySoft", c.secondary, c.secondarySoft, 4.5],
      ];

      for (const [label, fg, bg, minRatio] of checks) {
        const ratio = contrastRatio(fg, bg);
        expect(
          ratio,
          `${theme.id} (${theme.mode}): ${label} (${fg} on ${bg}) was ${ratio.toFixed(2)}, expected >= ${minRatio}`,
        ).toBeGreaterThanOrEqual(minRatio);
      }
    }
  });
});

describe("ThemeProvider persistence and dynamic re-theming", () => {
  it("hydrates saved theme from storage, persists changes, and updates live UI surface colors", async () => {
    const storage = createMemoryStorage({ "brewbruvs.theme": "cabernet-cellar" });

    render(
      <ThemeProvider storage={storage}>
        <ThemeHarness />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("active-theme-id").textContent).toBe("cabernet-cellar");
      expect(screen.getByTestId("active-theme-mode").textContent).toBe("dark");
    });

    const cardEl = screen.getByTestId("themed-sample-card") as HTMLElement;
    const darkClass = cardEl.className;
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.body.style.backgroundColor.toLowerCase()).toBe("#160e12");

    fireEvent.click(screen.getByTestId("switch-rose"));
    await waitFor(() => {
      expect(screen.getByTestId("active-theme-id").textContent).toBe("provence-rose");
      expect(screen.getByTestId("active-theme-mode").textContent).toBe("light");
    });
    expect(cardEl.className).not.toBe(darkClass);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.body.style.backgroundColor.toLowerCase()).toBe("#fdf6f7");
    expect(await storage.getItem("brewbruvs.theme")).toBe("provence-rose");
  });

  it("gracefully defaults to Amber Ale when rendered without a ThemeProvider", () => {
    render(<ThemeHarness />);
    expect(screen.getByTestId("active-theme-id").textContent).toBe(DEFAULT_THEME_ID);
  });
});

describe("ThemeGallery and ThemeSwitcherButton", () => {
  it("filters all 16 themes by beverage category and light/dark mode and applies selections", async () => {
    const storage = createMemoryStorage();
    render(
      <ThemeProvider storage={storage}>
        <ThemeGallery />
      </ThemeProvider>,
    );

    // All 16 theme cards are initially visible
    for (const t of THEMES) {
      expect(screen.getByTestId(`theme-card-${t.id}`)).toBeTruthy();
    }

    // Filter to Mead -> 4 mead themes only
    fireEvent.click(screen.getByRole("tab", { name: "Mead (4)" }));
    expect(screen.getByTestId("theme-card-wildflower-honey")).toBeTruthy();
    expect(screen.getByTestId("theme-card-nordic-braggot")).toBeTruthy();
    expect(screen.queryByTestId("theme-card-amber-ale")).toBeNull();
    expect(screen.queryByTestId("theme-card-crisp-orchard")).toBeNull();

    // Combine with Dark filter -> only 2 dark mead themes
    fireEvent.click(screen.getByRole("tab", { name: "Dark" }));
    expect(screen.getByTestId("theme-card-nordic-braggot")).toBeTruthy();
    expect(screen.getByTestId("theme-card-caramelized-bochet")).toBeTruthy();
    expect(screen.queryByTestId("theme-card-wildflower-honey")).toBeNull();

    // Select Caramelized Bochet -> badge updates and persists
    fireEvent.click(screen.getByTestId("theme-card-caramelized-bochet"));
    await waitFor(() => {
      expect(screen.getByTestId("theme-current-badge").textContent).toContain("Caramelized Bochet");
      expect(screen.getByTestId("theme-current-badge").textContent).toContain("Dark");
    });
    expect(await storage.getItem("brewbruvs.theme")).toBe("caramelized-bochet");
  });

  it("opens the quick theme picker modal from the header button and switches themes live", async () => {
    const storage = createMemoryStorage();
    render(
      <ThemeProvider storage={storage}>
        <ThemeSwitcherButton />
      </ThemeProvider>,
    );

    expect(screen.queryByTestId("theme-picker-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("header-theme-button"));

    await waitFor(() => {
      expect(screen.getByTestId("theme-picker-modal")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("theme-card-winter-perry"));
    expect(await storage.getItem("brewbruvs.theme")).toBe("winter-perry");

    fireEvent.click(screen.getByTestId("close-theme-modal-button"));
    await waitFor(() => {
      expect(screen.queryByTestId("theme-picker-modal")).toBeNull();
    });
    expect(screen.getByTestId("header-theme-button").getAttribute("aria-label")).toContain(
      "Winter Perry",
    );
  });
});
