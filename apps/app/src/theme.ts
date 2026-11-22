// SPDX-License-Identifier: AGPL-3.0-or-later
export const colors = {
  canvas: "#F8F5F0",
  surface: "#FFFFFF",
  surfaceSubtle: "#F3EDE4",
  border: "#E2D9CC",
  borderStrong: "#C8BBA8",
  text: "#1E1915",
  textMuted: "#5C5248",
  accent: "#B45309",
  accentPressed: "#92400E",
  accentSoft: "#FEF3C7",
  accentText: "#FFFFFF",
  success: "#166534",
  successSoft: "#DCFCE7",
  error: "#B91C1C",
  errorSoft: "#FEE2E2",
} as const;

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
