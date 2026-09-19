import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCleanerHeuristics,
  getCleanerHeuristicPolicy,
} from "../src/services/clean/clean-heuristics.js";
import { dedupeCleanerScanResults } from "../src/services/clean/cleaner-scan.js";
import { isProtectedCleanupPath } from "../src/managers/clean-heuristics-manager.js";
import { collectNodeModulesTargets } from "../src/services/dev/clean-scan.js";
import { getProjectArtifactSkipReason } from "../src/services/clean/cleaner-project-guard.js";

test("deduplicates overlapping scan categories and measures roots once", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "yourclix-clean-"));
  const nested = path.join(root, "browser-cache");

  try {
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "payload.bin"), Buffer.alloc(1024));

    const results = await dedupeCleanerScanResults([
      { category: "User Cache", paths: [root], bytes: 0 },
      { category: "Browser Caches", paths: [nested], bytes: 0 },
    ]);

    assert.deepEqual(results.map((result) => result.category), ["User Cache"]);
    assert.deepEqual(results[0]?.paths, [root]);
    assert.ok((results[0]?.bytes ?? 0) > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("protected paths and retention-gated paths never become candidates", () => {
  const policy = getCleanerHeuristicPolicy("deep", 30);
  const old = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const result = applyCleanerHeuristics(
    [
      {
        path: path.join(process.cwd(), "node_modules"),
        category: "Developer Project Junk",
        bytes: 10,
        mtimeMs: old,
      },
      {
        path: path.join(os.homedir(), "Developer", "project", "dist"),
        category: "Developer Project Junk",
        bytes: 20,
        mtimeMs: Date.now(),
      },
      {
        path: path.join(os.homedir(), "Developer", "project", "old-dist"),
        category: "Developer Project Junk",
        bytes: 30,
        mtimeMs: old,
      },
    ],
    policy,
  );

  assert.deepEqual(result.candidates.map((candidate) => candidate.bytes), [30]);
  assert.deepEqual(
    result.skipped.map((entry) => entry.reason),
    ["protected-path", "newer-than-30d"],
  );
  assert.equal(
    isProtectedCleanupPath(process.cwd(), policy.protectedPaths),
    false,
  );
});

test("developer scan does not add an out-of-home working directory", async () => {
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "yourclix-home-"));

  try {
    const result = await collectNodeModulesTargets(fakeHome);
    assert.ok(
      result.paths.every((target) =>
        target === fakeHome || target.startsWith(`${fakeHome}${path.sep}`),
      ),
    );
  } finally {
    await fs.rm(fakeHome, { recursive: true, force: true });
  }
});

test("tracked files inside a project artifact are protected", async () => {
  assert.equal(
    await getProjectArtifactSkipReason(path.join(process.cwd(), "src")),
    "tracked-project-artifact",
  );
});
