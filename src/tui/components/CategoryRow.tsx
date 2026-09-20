import React from "react";
import { Box, Text } from "ink";
import { bytesToHuman, pluralize } from "../../core/format.js";
import { CYAN, DIM, FG, GREY, gradient } from "../theme.js";

export interface DashboardCategory {
  category: string;
  bytes: number;
  pathCount: number;
}

const NAME_WIDTH = 28;
const BAR_WIDTH = 20;
const SIZE_WIDTH = 9;
const COUNT_WIDTH = 12;

export function CategoryRow({
  entry,
  maxBytes,
  selected,
}: {
  entry: DashboardCategory;
  maxBytes: number;
  selected: boolean;
}) {
  const ratio = maxBytes > 0 ? entry.bytes / maxBytes : 0;
  const filled = Math.max(entry.bytes > 0 ? 1 : 0, Math.round(ratio * BAR_WIDTH));
  const empty = Math.max(0, BAR_WIDTH - filled);

  return (
    <Box>
      <Box width={2}>
        <Text color={CYAN}>{selected ? "›" : " "}</Text>
      </Box>
      <Box width={NAME_WIDTH}>
        <Text color={selected ? FG : DIM} bold={selected}>
          {entry.category}
        </Text>
      </Box>
      <Box width={BAR_WIDTH}>
        <Text color={gradient(ratio)}>{"█".repeat(filled)}</Text>
        <Text color={GREY}>{"─".repeat(empty)}</Text>
      </Box>
      <Box width={SIZE_WIDTH} justifyContent="flex-end">
        <Text color={CYAN} bold>
          {bytesToHuman(entry.bytes)}
        </Text>
      </Box>
      <Box width={COUNT_WIDTH} justifyContent="flex-end">
        <Text color={DIM}>{pluralize(entry.pathCount, "path")}</Text>
      </Box>
    </Box>
  );
}
