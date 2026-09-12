// SPDX-License-Identifier: MPL-2.0
export const palettes = {
  dark: {
    base: "#19191c",
    surface: "#242427",
    raised: "#303034",
    inset: "#1d1d20",
    text: "#f2f2f5",
    muted: "#b0b0ba",
    accent: "#7ab8ff",
    onAccent: "#102745",
    border: "#48484f",
    hover: "#39393f",
    selection: "#293f5b",
    danger: "#f1a7a7",
    dangerSoft: "#462d33",
    warning: "#f2c572",
    warningSoft: "#413527",
    success: "#91d6a3",
  },
  light: {
    base: "#f0f0f3",
    surface: "#fafafa",
    raised: "#f0f0f3",
    inset: "#e8e8ed",
    text: "#202024",
    muted: "#585861",
    accent: "#005fb8",
    onAccent: "#ffffff",
    border: "#c9c9d1",
    hover: "#e2e2e8",
    selection: "#d6e7fb",
    danger: "#a02f3d",
    dangerSoft: "#f8e6e5",
    warning: "#805400",
    warningSoft: "#fff1d6",
    success: "#26733b",
  },
};

/** Older SDK/desktop versions may omit appearance. Accept only known hex tokens. */
export function resolveAppearance(environment: unknown, fallbackDark: boolean) {
  const appearance = (
    environment as { appearance?: { mode?: unknown; colors?: unknown } } | null
  )?.appearance;
  const mode =
    appearance?.mode === "light" || appearance?.mode === "dark"
      ? appearance.mode
      : fallbackDark
        ? "dark"
        : "light";
  const colors = { ...palettes[mode] };
  if (appearance?.colors && typeof appearance.colors === "object") {
    const supplied = appearance.colors as Record<string, unknown>;
    for (const key of Object.keys(colors) as (keyof typeof colors)[]) {
      const value = supplied[key];
      if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value))
        colors[key] = value;
    }
  }
  return { mode, colors };
}

export function applyAppearance(environment: unknown) {
  const { mode, colors } = resolveAppearance(
    environment,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.style.colorScheme = mode;
  for (const [key, value] of Object.entries(colors))
    root.style.setProperty(`--canvas-${key}`, value);
}
