import React from "react";
import { Box } from "ink";
import { CategoryRow, type DashboardCategory } from "./CategoryRow.js";

export function CategoryList({
  entries,
  cursor,
}: {
  entries: DashboardCategory[];
  cursor: number;
}) {
  const sorted = [...entries].sort((a, b) => b.bytes - a.bytes);
  const maxBytes = Math.max(1, ...sorted.map((entry) => entry.bytes));

  return (
    <Box flexDirection="column">
      {sorted.map((entry, index) => (
        <CategoryRow
          key={entry.category}
          entry={entry}
          maxBytes={maxBytes}
          selected={index === cursor}
        />
      ))}
    </Box>
  );
}
