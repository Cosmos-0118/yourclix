import React from "react";
import { Box, Text } from "ink";
import { BG, CYAN, DIM } from "../theme.js";

export interface KeyHint {
  key: string;
  label: string;
}

/** Footer shortcut row, keycap pill ported from AgentSweep's theme::shortcut(). */
export function KeyHints({ hints }: { hints: KeyHint[] }) {
  return (
    <Box>
      {hints.map((hint, index) => (
        <Box key={hint.key} marginRight={index === hints.length - 1 ? 0 : 2}>
          <Text backgroundColor={CYAN} color={BG} bold>
            {` ${hint.key} `}
          </Text>
          <Text color={DIM}>{` ${hint.label}`}</Text>
        </Box>
      ))}
    </Box>
  );
}
