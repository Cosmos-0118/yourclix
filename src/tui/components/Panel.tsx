import React from "react";
import { Box, Text } from "ink";
import { DIM, FG } from "../theme.js";

interface PanelProps {
  title?: string;
  borderColor?: string;
  children: React.ReactNode;
}

/** Bordered box sized to its own content, mirroring core/task-ui.ts's panel(). */
export function Panel({ title, borderColor = DIM, children }: PanelProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      {title ? <Text bold color={FG}>{title}</Text> : null}
      {children}
    </Box>
  );
}
