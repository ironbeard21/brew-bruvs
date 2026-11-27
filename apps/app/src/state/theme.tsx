// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import {
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  getThemeById,
  isThemeId,
  THEMES,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeId,
} from "../theme";
import { appStorage, type KeyValueStorage } from "./storage";

const STORAGE_KEY = "brewbruvs.theme";

export interface ThemeContextValue {
  themeId: ThemeId;
  theme: ThemeDefinition;
  colors: ThemeColors;
  themes: readonly ThemeDefinition[];
  setThemeId: (next: ThemeId) => void;
}

const DEFAULT_CONTEXT: ThemeContextValue = {
  themeId: DEFAULT_THEME_ID,
  theme: DEFAULT_THEME,
  colors: DEFAULT_THEME.colors,
  themes: THEMES,
  setThemeId: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CONTEXT);

export interface ThemeProviderProps {
  children: ReactNode;
  initialThemeId?: ThemeId;
  storage?: KeyValueStorage;
}

export function ThemeProvider({
  children,
  initialThemeId = DEFAULT_THEME_ID,
  storage = appStorage,
}: ThemeProviderProps) {
  const [themeId, setThemeIdState] = useState<ThemeId>(initialThemeId);

  useEffect(() => {
    let active = true;
    void storage.getItem(STORAGE_KEY).then((saved) => {
      if (!active) return;
      if (isThemeId(saved)) {
        setThemeIdState(saved);
      }
    });
    return () => {
      active = false;
    };
  }, [storage]);

  const setThemeId = useCallback(
    (next: ThemeId) => {
      setThemeIdState(next);
      void storage.setItem(STORAGE_KEY, next);
    },
    [storage],
  );

  const theme = getThemeById(themeId);

  // Sync browser canvas background and native scrollbar color scheme on web
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.colorScheme = theme.mode;
    document.documentElement.style.backgroundColor = theme.colors.canvas;
    document.body.style.backgroundColor = theme.colors.canvas;
  }, [theme.mode, theme.colors.canvas]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId: theme.id,
      theme,
      colors: theme.colors,
      themes: THEMES,
      setThemeId,
    }),
    [theme, setThemeId],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Memoizes a `StyleSheet.create` factory against the active theme palette so
 * styles only recompute when the user switches themes.
 */
export function useThemedStyles<T>(createStyles: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [createStyles, colors]);
}
