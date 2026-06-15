/** Theme từ design system. "luma" = brand warm-neutral + teal (mặc định). */
export const themes = ["luma", "ocean", "terra", "emerald", "violet"] as const;
export type Theme = (typeof themes)[number];
export const defaultTheme: Theme = "luma";
export const THEME_COOKIE = "ui_theme";

/** Chế độ sáng/tối. "system" = theo hệ điều hành. */
export const modes = ["light", "dark", "system"] as const;
export type Mode = (typeof modes)[number];
export const defaultMode: Mode = "system";
export const MODE_COOKIE = "ui_mode";

export const themeMeta: Record<Theme, { label: string; swatch: string }> = {
  luma:    { label: "Luma",       swatch: "oklch(0.52 0.10 180)" },
  ocean:   { label: "Ocean",      swatch: "oklch(0.546 0.245 262.881)" },
  terra:   { label: "Terracotta", swatch: "oklch(0.55 0.155 38)" },
  emerald: { label: "Emerald",    swatch: "oklch(0.596 0.145 163.225)" },
  violet:  { label: "Violet",     swatch: "oklch(0.541 0.281 293.009)" },
};
