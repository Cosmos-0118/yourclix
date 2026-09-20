/**
 * Color theme ported from AgentSweep's `src/ui/theme.rs` so the two tools
 * read as one family. Ink consumes plain hex strings via `<Text color="">`.
 */

export const BG = "#0c0e14";
export const FG = "#e2e8f0";
export const DIM = "#64748b";
export const CYAN = "#22d3ee";
export const MAGENTA = "#e879f9";
export const GREEN = "#34d399";
export const YELLOW = "#fbbf24";
export const ORANGE = "#fb923c";
export const RED = "#f87171";
export const GREY = "#475569";

export type Risk = "safe" | "review" | "userdata" | "critical" | "unknown";

export function riskColor(risk: Risk): string {
  switch (risk) {
    case "safe":
      return GREEN;
    case "review":
      return YELLOW;
    case "userdata":
      return ORANGE;
    case "critical":
      return RED;
    default:
      return GREY;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Gradient from cyan to magenta across `t` in 0..=1. */
export function gradient(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  return toHex(
    lerp(34, 232, clamped),
    lerp(211, 121, clamped),
    lerp(238, 249, clamped),
  );
}

export function amberToRed(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  return toHex(
    lerp(251, 248, clamped),
    lerp(191, 113, clamped),
    lerp(36, 113, clamped),
  );
}
