import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Braille spinner frame ticker, mirroring AgentSweep's src/ui/anim.rs. */
export function useSpinnerFrame(active: boolean, intervalMs = 80): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return FRAMES[frame] ?? FRAMES[0]!;
}
