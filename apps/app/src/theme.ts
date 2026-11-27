// SPDX-License-Identifier: AGPL-3.0-or-later

export type ThemeCategory = "beer" | "wine" | "mead" | "cider";
export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  canvas: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  accent: string;
  accentPressed: string;
  accentSoft: string;
  accentText: string;
  secondary: string;
  secondarySoft: string;
  chartTemp: string;
  success: string;
  successSoft: string;
  error: string;
  errorSoft: string;
  shadow: string;
  overlay: string;
}

export type ThemeId =
  | "amber-ale"
  | "czech-pilsner"
  | "west-coast-ipa"
  | "imperial-stout"
  | "oaked-chardonnay"
  | "provence-rose"
  | "cabernet-cellar"
  | "pinot-noir"
  | "wildflower-honey"
  | "berry-melomel"
  | "nordic-braggot"
  | "caramelized-bochet"
  | "crisp-orchard"
  | "heirloom-scrumpy"
  | "winter-perry"
  | "autumn-cyser";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  category: ThemeCategory;
  mode: ThemeMode;
  tagline: string;
  /** Three representative colors [liquid/accent, foam/soft, cellar/canvas] for swatch badges. */
  swatches: readonly [string, string, string];
  colors: ThemeColors;
}

export const THEME_CATEGORY_LABELS: Record<ThemeCategory, string> = {
  beer: "Beer",
  wine: "Wine",
  mead: "Mead",
  cider: "Cider",
};

export const THEMES: readonly ThemeDefinition[] = [
  // ── Beer (2 Light, 2 Dark) ───────────────────────────────────────────
  {
    id: "amber-ale",
    name: "Amber Ale",
    category: "beer",
    mode: "light",
    tagline: "Toasted crystal malt, copper glow, and warm brewhouse parchment",
    swatches: ["#B45309", "#FEF3C7", "#FAF6F0"],
    colors: {
      canvas: "#FAF6F0",
      surface: "#FFFFFF",
      surfaceSubtle: "#F3ECE2",
      border: "#E4D9CA",
      borderStrong: "#C8B8A2",
      text: "#1F1914",
      textMuted: "#5E5247",
      accent: "#B45309",
      accentPressed: "#8A3B08",
      accentSoft: "#FEF3C7",
      accentText: "#FFFFFF",
      secondary: "#2D6A4F",
      secondarySoft: "#E3F2EA",
      chartTemp: "#0F766E",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#3B2816",
      overlay: "rgba(31, 25, 20, 0.48)",
    },
  },
  {
    id: "czech-pilsner",
    name: "Czech Pilsner",
    category: "beer",
    mode: "light",
    tagline: "Crisp pale straw, sunlit golden foam, and noble Saaz hops",
    swatches: ["#8E5B00", "#FEF4C8", "#FBF9F1"],
    colors: {
      canvas: "#FBF9F1",
      surface: "#FFFFFF",
      surfaceSubtle: "#F3EEDB",
      border: "#E3DBC0",
      borderStrong: "#C4B78E",
      text: "#1D1B12",
      textMuted: "#5A5542",
      accent: "#8E5B00",
      accentPressed: "#6B4300",
      accentSoft: "#FEF4C8",
      accentText: "#FFFFFF",
      secondary: "#2E6F40",
      secondarySoft: "#E2F4E6",
      chartTemp: "#1D6A7B",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#3B3210",
      overlay: "rgba(29, 27, 18, 0.46)",
    },
  },
  {
    id: "west-coast-ipa",
    name: "West Coast IPA",
    category: "beer",
    mode: "dark",
    tagline: "Deep hop-cone spruce, resinous pine, and bright citrus amber",
    swatches: ["#F5A623", "#2E2410", "#0E1713"],
    colors: {
      canvas: "#0E1713",
      surface: "#15231D",
      surfaceSubtle: "#1D2F27",
      border: "#2A4237",
      borderStrong: "#3F6051",
      text: "#F3F5F0",
      textMuted: "#B0C4B8",
      accent: "#F5A623",
      accentPressed: "#FFC35B",
      accentSoft: "#2F250F",
      accentText: "#161107",
      secondary: "#4ADE80",
      secondarySoft: "#143122",
      chartTemp: "#38BDF8",
      success: "#6EE7B7",
      successSoft: "#113025",
      error: "#FCA5A5",
      errorSoft: "#3B171A",
      shadow: "#000000",
      overlay: "rgba(5, 10, 8, 0.72)",
    },
  },
  {
    id: "imperial-stout",
    name: "Imperial Stout",
    category: "beer",
    mode: "dark",
    tagline: "Roasted espresso, dark cacao, and velvety nitro caramel",
    swatches: ["#E09348", "#342214", "#130F0D"],
    colors: {
      canvas: "#130F0D",
      surface: "#1E1815",
      surfaceSubtle: "#2A221D",
      border: "#3D3129",
      borderStrong: "#59483D",
      text: "#F7EFE7",
      textMuted: "#C6B4A6",
      accent: "#E09348",
      accentPressed: "#F4B474",
      accentSoft: "#342214",
      accentText: "#170F08",
      secondary: "#D4A373",
      secondarySoft: "#2D2218",
      chartTemp: "#5EEAD4",
      success: "#6EE7B7",
      successSoft: "#132E22",
      error: "#FCA5A5",
      errorSoft: "#3D1719",
      shadow: "#000000",
      overlay: "rgba(8, 5, 4, 0.74)",
    },
  },

  // ── Wine (2 Light, 2 Dark) ───────────────────────────────────────────
  {
    id: "oaked-chardonnay",
    name: "Oaked Chardonnay",
    category: "wine",
    mode: "light",
    tagline: "Sunlit vineyard limestone, French oak staves, and antique gold",
    swatches: ["#876012", "#FBF0D1", "#FAF8F2"],
    colors: {
      canvas: "#FAF8F2",
      surface: "#FFFFFF",
      surfaceSubtle: "#F1ECE0",
      border: "#E1D9C6",
      borderStrong: "#C2B59A",
      text: "#1E1B16",
      textMuted: "#5B5447",
      accent: "#876012",
      accentPressed: "#65460B",
      accentSoft: "#FBF0D1",
      accentText: "#FFFFFF",
      secondary: "#4A6B41",
      secondarySoft: "#E6EFE3",
      chartTemp: "#1D6D72",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#362C19",
      overlay: "rgba(30, 27, 22, 0.46)",
    },
  },
  {
    id: "provence-rose",
    name: "Provence Rosé",
    category: "wine",
    mode: "light",
    tagline: "Coastal Grenache blush, crushed granite, and crisp summer rosé",
    swatches: ["#AE2D54", "#FCE3EB", "#FDF6F7"],
    colors: {
      canvas: "#FDF6F7",
      surface: "#FFFFFF",
      surfaceSubtle: "#F7E9EC",
      border: "#EBD5DA",
      borderStrong: "#D1B0B9",
      text: "#22161A",
      textMuted: "#634C53",
      accent: "#AE2D54",
      accentPressed: "#871E3E",
      accentSoft: "#FCE3EB",
      accentText: "#FFFFFF",
      secondary: "#3D6E59",
      secondarySoft: "#E4F2EB",
      chartTemp: "#0F766E",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#421A27",
      overlay: "rgba(34, 22, 26, 0.46)",
    },
  },
  {
    id: "cabernet-cellar",
    name: "Cabernet Cellar",
    category: "wine",
    mode: "dark",
    tagline: "Candlelit Bordeaux barrel room, deep claret, and garnet glow",
    swatches: ["#EC6D8A", "#3D1825", "#160E12"],
    colors: {
      canvas: "#160E12",
      surface: "#23161C",
      surfaceSubtle: "#301E26",
      border: "#472C38",
      borderStrong: "#643E50",
      text: "#FAF0F3",
      textMuted: "#CBAFB9",
      accent: "#EC6D8A",
      accentPressed: "#F893AA",
      accentSoft: "#3D1825",
      accentText: "#1E0910",
      secondary: "#E2B26B",
      secondarySoft: "#332615",
      chartTemp: "#5EEAD4",
      success: "#6EE7B7",
      successSoft: "#132E23",
      error: "#FDA4AF",
      errorSoft: "#42161E",
      shadow: "#000000",
      overlay: "rgba(10, 5, 7, 0.74)",
    },
  },
  {
    id: "pinot-noir",
    name: "Pinot Noir Reserve",
    category: "wine",
    mode: "dark",
    tagline: "Burgundy twilight, dark cherry skins, and velvet plum",
    swatches: ["#CF80E8", "#331D3D", "#141019"],
    colors: {
      canvas: "#141019",
      surface: "#1F1927",
      surfaceSubtle: "#2B2335",
      border: "#403450",
      borderStrong: "#5B4A72",
      text: "#F5EFFB",
      textMuted: "#C2B3D1",
      accent: "#CF80E8",
      accentPressed: "#E1A5F4",
      accentSoft: "#331D3D",
      accentText: "#190B20",
      secondary: "#F0A37E",
      secondarySoft: "#362219",
      chartTemp: "#67E8F9",
      success: "#6EE7B7",
      successSoft: "#122E24",
      error: "#FCA5A5",
      errorSoft: "#3E161E",
      shadow: "#000000",
      overlay: "rgba(9, 6, 14, 0.74)",
    },
  },

  // ── Mead (2 Light, 2 Dark) ───────────────────────────────────────────
  {
    id: "wildflower-honey",
    name: "Wildflower Honey",
    category: "mead",
    mode: "light",
    tagline: "Sunlit apiary beeswax, raw golden comb, and meadow clover",
    swatches: ["#9C5806", "#FDEBC3", "#FDF9EE"],
    colors: {
      canvas: "#FDF9EE",
      surface: "#FFFFFF",
      surfaceSubtle: "#F6EDD4",
      border: "#E8D9B1",
      borderStrong: "#CCB67E",
      text: "#1F190E",
      textMuted: "#5E513A",
      accent: "#9C5806",
      accentPressed: "#774103",
      accentSoft: "#FDEBC3",
      accentText: "#FFFFFF",
      secondary: "#3A6B45",
      secondarySoft: "#E4F1E6",
      chartTemp: "#0F766E",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#42310E",
      overlay: "rgba(31, 25, 14, 0.46)",
    },
  },
  {
    id: "berry-melomel",
    name: "Berry Melomel",
    category: "mead",
    mode: "light",
    tagline: "Crushed wild blackberries, raw honey bloom, and violet must",
    swatches: ["#7B24BF", "#F2E6FE", "#FAF6FC"],
    colors: {
      canvas: "#FAF6FC",
      surface: "#FFFFFF",
      surfaceSubtle: "#F1E8F7",
      border: "#E1D0EE",
      borderStrong: "#C1A4D8",
      text: "#1E1526",
      textMuted: "#5D4B6B",
      accent: "#7B24BF",
      accentPressed: "#5E1994",
      accentSoft: "#F2E6FE",
      accentText: "#FFFFFF",
      secondary: "#915004",
      secondarySoft: "#FDECC8",
      chartTemp: "#0F766E",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#2D1542",
      overlay: "rgba(30, 21, 38, 0.46)",
    },
  },
  {
    id: "nordic-braggot",
    name: "Nordic Braggot",
    category: "mead",
    mode: "dark",
    tagline: "Mead-hall slate, forged iron, smoked barley, and gilded honey",
    swatches: ["#EAB308", "#332B10", "#10151C"],
    colors: {
      canvas: "#10151C",
      surface: "#18202B",
      surfaceSubtle: "#222C3B",
      border: "#324055",
      borderStrong: "#4A5E7A",
      text: "#F2F5F9",
      textMuted: "#B0BED0",
      accent: "#EAB308",
      accentPressed: "#FACC15",
      accentSoft: "#332B10",
      accentText: "#161204",
      secondary: "#60A5FA",
      secondarySoft: "#16263E",
      chartTemp: "#5EEAD4",
      success: "#6EE7B7",
      successSoft: "#112E24",
      error: "#FCA5A5",
      errorSoft: "#3B181D",
      shadow: "#000000",
      overlay: "rgba(6, 9, 14, 0.74)",
    },
  },
  {
    id: "caramelized-bochet",
    name: "Caramelized Bochet",
    category: "mead",
    mode: "dark",
    tagline: "Scorched kettle honey, toasted cinnamon bark, and clove ember",
    swatches: ["#F0873E", "#3D2212", "#18100C"],
    colors: {
      canvas: "#18100C",
      surface: "#251812",
      surfaceSubtle: "#332219",
      border: "#4A3226",
      borderStrong: "#694837",
      text: "#FBF1E8",
      textMuted: "#CCB3A1",
      accent: "#F0873E",
      accentPressed: "#FAA66A",
      accentSoft: "#3D2212",
      accentText: "#1B0D04",
      secondary: "#E6C15A",
      secondarySoft: "#352C12",
      chartTemp: "#5EEAD4",
      success: "#6EE7B7",
      successSoft: "#142E22",
      error: "#FCA5A5",
      errorSoft: "#3F1718",
      shadow: "#000000",
      overlay: "rgba(10, 6, 4, 0.74)",
    },
  },

  // ── Cider (2 Light, 2 Dark) ──────────────────────────────────────────
  {
    id: "crisp-orchard",
    name: "Crisp Orchard",
    category: "cider",
    mode: "light",
    tagline: "Fresh-pressed Granny Smith, morning dew, and orchard foliage",
    swatches: ["#216A39", "#DCFCE7", "#F4FAF3"],
    colors: {
      canvas: "#F4FAF3",
      surface: "#FFFFFF",
      surfaceSubtle: "#E7F2E5",
      border: "#CFE2CC",
      borderStrong: "#A7C7A3",
      text: "#142017",
      textMuted: "#475E4C",
      accent: "#216A39",
      accentPressed: "#174F2A",
      accentSoft: "#DCFCE7",
      accentText: "#FFFFFF",
      secondary: "#A8560D",
      secondarySoft: "#FCECD5",
      chartTemp: "#0F766E",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#193822",
      overlay: "rgba(20, 32, 23, 0.46)",
    },
  },
  {
    id: "heirloom-scrumpy",
    name: "Heirloom Scrumpy",
    category: "cider",
    mode: "light",
    tagline: "Farmhouse rack-and-cloth press, russet apples, and oak tannin",
    swatches: ["#B5391B", "#FDE5DC", "#FAF5EF"],
    colors: {
      canvas: "#FAF5EF",
      surface: "#FFFFFF",
      surfaceSubtle: "#F3E7DC",
      border: "#E4D3C3",
      borderStrong: "#C8AF99",
      text: "#221712",
      textMuted: "#614E44",
      accent: "#B5391B",
      accentPressed: "#8B2912",
      accentSoft: "#FDE5DC",
      accentText: "#FFFFFF",
      secondary: "#3B6B40",
      secondarySoft: "#E4F1E5",
      chartTemp: "#0F766E",
      success: "#166534",
      successSoft: "#DCFCE7",
      error: "#B91C1C",
      errorSoft: "#FEE2E2",
      shadow: "#3E1E12",
      overlay: "rgba(34, 23, 18, 0.46)",
    },
  },
  {
    id: "winter-perry",
    name: "Winter Perry",
    category: "cider",
    mode: "dark",
    tagline: "Chilled cellar pear cider, frosted glass, and glacial slate",
    swatches: ["#43D9A3", "#12342B", "#0E1719"],
    colors: {
      canvas: "#0E1719",
      surface: "#152326",
      surfaceSubtle: "#1E3136",
      border: "#2D474E",
      borderStrong: "#426670",
      text: "#EFF8F9",
      textMuted: "#ABC6CB",
      accent: "#43D9A3",
      accentPressed: "#74E8BE",
      accentSoft: "#12342B",
      accentText: "#061D15",
      secondary: "#A3E635",
      secondarySoft: "#223314",
      chartTemp: "#38BDF8",
      success: "#6EE7B7",
      successSoft: "#113328",
      error: "#FCA5A5",
      errorSoft: "#3B181C",
      shadow: "#000000",
      overlay: "rgba(5, 11, 13, 0.74)",
    },
  },
  {
    id: "autumn-cyser",
    name: "Autumn Cyser",
    category: "cider",
    mode: "dark",
    tagline: "Apple-honey harvest moon, mulled spice, and warm mahogany",
    swatches: ["#F27057", "#3D1D18", "#181210"],
    colors: {
      canvas: "#181210",
      surface: "#241B18",
      surfaceSubtle: "#322520",
      border: "#4A362E",
      borderStrong: "#684D42",
      text: "#FAF0EB",
      textMuted: "#CBB4AA",
      accent: "#F27057",
      accentPressed: "#FA947F",
      accentSoft: "#3D1D18",
      accentText: "#1E0B07",
      secondary: "#EAB308",
      secondarySoft: "#342A10",
      chartTemp: "#5EEAD4",
      success: "#6EE7B7",
      successSoft: "#142E22",
      error: "#FCA5A5",
      errorSoft: "#42181A",
      shadow: "#000000",
      overlay: "rgba(10, 7, 5, 0.74)",
    },
  },
] as const;

export const DEFAULT_THEME_ID: ThemeId = "amber-ale";

export const THEME_BY_ID: Readonly<Record<ThemeId, ThemeDefinition>> = Object.fromEntries(
  THEMES.map((theme) => [theme.id, theme]),
) as Record<ThemeId, ThemeDefinition>;

export const DEFAULT_THEME: ThemeDefinition = THEME_BY_ID[DEFAULT_THEME_ID];

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && value in THEME_BY_ID);
}

export function getThemeById(id: string | null | undefined): ThemeDefinition {
  return isThemeId(id) ? THEME_BY_ID[id] : DEFAULT_THEME;
}

/** Static default palette kept for fallbacks and non-provider utilities. */
export const colors: ThemeColors = DEFAULT_THEME.colors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const DESKTOP_BREAKPOINT = 768;
