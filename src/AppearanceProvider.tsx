import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { CssBaseline, useMediaQuery } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createAppTheme, systemPaletteMode } from "./theme";
import type { SystemPalette } from "./theme";

type ThemePreference = "system" | "light" | "dark";
const storageKey = "spendtrax-theme-mode";
const AppearanceContext = createContext<{
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}>({ preference: "system", setPreference: () => {} });

function savedPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export const useAppearance = () => useContext(AppearanceContext);

export default function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(savedPreference);
  const [systemPalette, setSystemPalette] = useState<SystemPalette | null>(null);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, preference);
    } catch {
      // The selected theme still works when webview storage is unavailable.
    }
  }, [preference]);

  useEffect(() => {
    if (preference !== "system" || !isTauri()) return;
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (disposed || pending || document.hidden) return;
      pending = true;
      try {
        const palette = await invoke<SystemPalette | null>("get_system_palette");
        if (!disposed) {
          setSystemPalette((previous) =>
            JSON.stringify(previous) === JSON.stringify(palette) ? previous : palette,
          );
        }
      } catch {
        // Other platforms and unavailable theme files use the OS light/dark preference.
        if (!disposed) setSystemPalette(null);
      } finally {
        pending = false;
      }
    };
    void refresh();
    // Re-read the path because Omarchy replaces the theme directory when switching.
    const interval = window.setInterval(() => void refresh(), 2000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [preference]);

  const palette = preference === "system" ? systemPalette : null;
  const mode = preference === "system"
    ? (palette ? systemPaletteMode(palette) : prefersDark ? "dark" : "light")
    : preference;
  const theme = useMemo(() => createAppTheme(mode, palette), [mode, palette]);
  const context = useMemo(() => ({ preference, setPreference }), [preference]);

  return (
    <AppearanceContext.Provider value={context}>
      <ThemeProvider theme={theme} storageManager={null} noSsr>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </AppearanceContext.Provider>
  );
}
