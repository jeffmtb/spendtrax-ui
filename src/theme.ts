import { alpha, createTheme, getContrastRatio, getLuminance } from "@mui/material/styles";
import type { PaletteMode, PaletteOptions } from "@mui/material/styles";
import type {} from "@mui/material/themeCssVarsAugmentation";

export interface SystemPalette {
  mode: PaletteMode | null;
  background: string;
  foreground: string;
  accent: string;
  lighter_background: string | null;
  selection: string | null;
  red: string | null;
  green: string | null;
  yellow: string | null;
  cyan: string | null;
}

const presets: Record<PaletteMode, PaletteOptions> = {
  light: {
    primary: { main: "#1565c0" },
    background: { default: "#f1f4f8", paper: "#ffffff" },
    text: { primary: "#1c2533", secondary: "#526174" },
    divider: "#dce2eb",
    success: { main: "#2e7d32" },
    error: { main: "#c62828" },
  },
  dark: {
    primary: { main: "#90caf9" },
    background: { default: "#151a22", paper: "#202733" },
    text: { primary: "#e8edf5", secondary: "#aebacc" },
    divider: "#394557",
    success: { main: "#81c784" },
    error: { main: "#ef9a9a" },
  },
};

export function systemPaletteMode(palette: SystemPalette): PaletteMode {
  return palette.mode ?? (getLuminance(palette.background) > 0.5 ? "light" : "dark");
}

function mix(base: string, foreground: string, weight: number): string {
  const channels = [1, 3, 5].map((offset) => Math.round(
    parseInt(base.slice(offset, offset + 2), 16) * (1 - weight) +
    parseInt(foreground.slice(offset, offset + 2), 16) * weight,
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function readable(color: string, background: string, foreground: string): string {
  for (let step = 0; step <= 10; step++) {
    const candidate = mix(color, foreground, step / 10);
    if (getContrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return foreground;
}

// All application colors live here; Omarchy supplies values only for System mode.
export function createAppTheme(mode: PaletteMode, systemPalette: SystemPalette | null = null) {
  let palette: PaletteOptions = { ...presets[mode], mode };
  if (systemPalette) {
    const colors = systemPalette;
    const background = colors.background;
    const foreground = getContrastRatio(colors.foreground, background) >= 4.5
      ? colors.foreground
      : (getContrastRatio("#ffffff", background) > getContrastRatio("#000000", background) ? "#ffffff" : "#000000");
    const suggestedPaper = colors.lighter_background ?? mix(background, foreground, 0.04);
    const paper = getContrastRatio(foreground, suggestedPaper) >= 4.5 ? suggestedPaper : background;
    const primary = readable(colors.accent, paper, foreground);
    palette = {
      mode,
      primary: { main: primary },
      secondary: { main: primary },
      background: { default: background, paper },
      text: {
        primary: foreground,
        secondary: readable(mix(paper, foreground, 0.72), paper, foreground),
      },
      divider: mix(paper, foreground, 0.22),
      success: { main: readable(colors.green ?? colors.accent, paper, foreground) },
      error: { main: readable(colors.red ?? (mode === "dark" ? "#ef9a9a" : "#c62828"), paper, foreground) },
      warning: { main: readable(colors.yellow ?? colors.accent, paper, foreground) },
      info: { main: readable(colors.cyan ?? colors.accent, paper, foreground) },
      action: { hover: alpha(primary, 0.08), selected: alpha(primary, 0.16) },
    };
  }

  return createTheme({
    cssVariables: true,
    palette,
    typography: {
      fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif",
      button: { textTransform: "none", fontWeight: 600 },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    },
  });
}
