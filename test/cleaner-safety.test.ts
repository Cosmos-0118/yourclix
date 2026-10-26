import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCleanerHeuristicPolicy,
  isProtectedCleanupPath,
} from "../src/managers/clean-heuristics-manager.js";
import { inspectCleanerTarget } from "../src/services/clean/cleaner-safety.js";
import {
  parseFixedRetentionDays,
  applyCleanerHeuristics,
} from "../src/services/clean/clean-heuristics.js";
import { preflightCleaner } from "../src/services/clean/cleaner-execute.js";

const idle = { paths: [], commands: [], available: true };
const old = new Date(Date.now() - 90 * 86400000);
async function fixture(run: (home: string, cache: string) => Promise<void>) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "your-clean-safety-")),
  );
  const cache = path.join(home, "Library/Caches/app");
  try {
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(path.join(cache, "old.bin"), Buffer.alloc(4096));
    await fs.utimes(path.join(cache, "old.bin"), old, old);
    await fs.utimes(cache, old, old);
    await run(home, cache);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}
const policy = (home: string) =>
  buildCleanerHeuristicPolicy("deep", 14, { home, tmpDir: home });

test("retention checks nested files even when the matched directory is old", () =>
  fixture(async (home, cache) => {
    await fs.writeFile(path.join(cache, "recent.bin"), "keep");
    await fs.utimes(cache, old, old);
    assert.equal(
      (await inspectCleanerTarget(cache, policy(home), idle)).reason,
      "newer-than-14d",
    );
  }));

test("fully old, owned, unused caches are eligible and measured", () =>
  fixture(async (home, cache) => {
    const result = await inspectCleanerTarget(cache, policy(home), idle);
    assert.equal(result.reason, null);
    assert.ok(result.bytes >= 4096);
    assert.ok(result.ino > 0);
  }));

test("active files and process command paths protect caches", () =>
  fixture(async (home, cache) => {
    assert.equal(
      (
        await inspectCleanerTarget(cache, policy(home), {
          ...idle,
          paths: [path.join(cache, "old.bin")],
        })
      ).reason,
      "in-use",
    );
    assert.equal(
      (
        await inspectCleanerTarget(cache, policy(home), {
          ...idle,
          commands: [`node ${cache}/index.js`],
        })
      ).reason,
      "in-use",
    );
  }));

test("unavailable activity checks keep everything", () =>
  fixture(async (home, cache) => {
    assert.equal(
      (
        await inspectCleanerTarget(cache, policy(home), {
          paths: [],
          available: false,
        })
      ).reason,
      "activity-check-unavailable",
    );
  }));

test("symlinked parents and symlink descendants are never traversed", () =>
  fixture(async (home, cache) => {
    const alias = path.join(home, "alias");
    await fs.symlink(path.dirname(cache), alias);
    assert.equal(
      (await inspectCleanerTarget(path.join(alias, "app"), policy(home), idle))
        .reason,
      "symlink-path",
    );
    await fs.symlink(path.join(home, "private-data"), path.join(cache, "link"));
    await fs.utimes(cache, old, old);
    assert.equal(
      (await inspectCleanerTarget(cache, policy(home), idle)).reason,
      "symlink-path",
    );
  }));

test("protected descendants protect their ancestors and inspection limits fail closed", () =>
  fixture(async (home, cache) => {
    const protectedPath = path.join(cache, "old.bin");
    assert.equal(isProtectedCleanupPath(cache, [protectedPath]), true);
    const protectedPolicy = {
      ...policy(home),
      protectedPaths: [protectedPath],
    };
    assert.equal(
      (await inspectCleanerTarget(cache, protectedPolicy, idle)).reason,
      "protected-path",
    );
    assert.equal(
      (await inspectCleanerTarget(cache, policy(home), idle, { maxEntries: 1 }))
        .reason,
      "inspection-limit",
    );
  }));

test("retention applies to ordinary caches and logs, not only formerly risky categories", () => {
  const result = applyCleanerHeuristics(
    ["User Cache", "User Logs", "Bun Package Cache"].map((category) => ({
      path: `/cache/${category}`,
      category,
      bytes: 1,
      mtimeMs: Date.now(),
    })),
    buildCleanerHeuristicPolicy("deep", 14),
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.skipped.length, 3);
});

test("days accepts only whole numbers within the documented range", () => {
  for (const value of ["5days", "1.5", "0", "-1", "3651", "NaN", "", "1e2"])
    assert.throws(() => parseFixedRetentionDays("deep", value), /whole number/);
  assert.equal(parseFixedRetentionDays("deep", "5"), 5);
  assert.equal(parseFixedRetentionDays("deep", undefined), undefined);
});

test("preflight excludes managed caches and unmeasured paths from eligible bytes", () =>
  fixture(async (home, cache) => {
    const result = await preflightCleaner(
      [
        {
          category: "User Cache",
          paths: [cache],
          bytes: 100,
          issues: [{ path: cache, reason: "size-unavailable" }],
        },
        {
          category: "uv Cache",
          paths: [path.join(home, ".cache/uv")],
          bytes: 900,
          managedBy: "uv",
        },
      ],
      { mode: "deep", olderThanDays: 14 },
      { context: { home, tmpDir: home }, activity: idle },
    );
    assert.equal(result.eligibleBytes, 0);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.managedCaches.length, 1);
    assert.equal(result.discoveredBytes, 1000);
    assert.equal(result.skipped[0]?.reason, "size-unavailable");
  }));

test("nested Git repositories inside an otherwise disposable cache are kept", () =>
  fixture(async (home, cache) => {
    await fs.mkdir(path.join(cache, ".git"));
    await fs.utimes(cache, old, old);
    assert.equal(
      (await inspectCleanerTarget(cache, policy(home), idle)).reason,
      "nested-project",
    );
  }));

test("persistent exclusions protect ordinary caches and invalid config stops preflight", () =>
  fixture(async (home, cache) => {
    const config = path.join(home, ".your-config/cleaner-excludes.json");
    await fs.mkdir(path.dirname(config));
    await fs.writeFile(
      config,
      JSON.stringify(["~/Library/Caches/app/old.bin"]),
    );
    const results = [{ category: "User Cache", paths: [cache], bytes: 4096 }];
    const dependencies = { context: { home, tmpDir: home }, activity: idle };
    const excluded = await preflightCleaner(
      results,
      { mode: "deep", olderThanDays: 14 },
      dependencies,
    );
    assert.equal(excluded.candidates.length, 0);
    assert.equal(excluded.skipped[0]?.reason, "protected-path");
    await fs.writeFile(config, '{"invalid":true}');
    await assert.rejects(
      preflightCleaner(
        results,
        { mode: "deep", olderThanDays: 14 },
        dependencies,
      ),
      /Cleanup stopped/,
    );
    await fs.rm(config);
    await fs.symlink(path.join(home, "missing-config"), config);
    await assert.rejects(
      preflightCleaner(
        results,
        { mode: "deep", olderThanDays: 14 },
        dependencies,
      ),
      /cleanup stopped/,
    );
  }));
