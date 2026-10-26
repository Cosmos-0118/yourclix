import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  getCleanerScanCategories,
  isTrustedTemporaryRoot,
} from "../src/managers/clean-scan-manager.js";
import { scanCleanerTargets } from "../src/services/clean/cleaner-scan.js";
import { getProjectArtifactSkipReason } from "../src/services/clean/cleaner-project-guard.js";

test("scanner finds verified cache leaves, additional browser profiles and escaped home paths", async () => {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "your-clean-catalog-"),
  );
  const home = path.join(await fs.realpath(parent), "home [test]");
  const candidates = [
    ".bun/install/cache/pkg@1",
    ".npm/_npx/test",
    ".gradle/.tmp/build.tmp",
    ".android/cache/repository.xml",
    "Library/Application Support/Google/Chrome/Profile 2/Code Cache/js/old",
    "Library/Application Support/Cursor/GPUCache/data_0",
    "Library/Application Support/Claude/Code Cache/js/old",
  ];
  const kept = [
    "Library/Application Support/Cursor/User/workspaceStorage/session",
    "Library/Application Support/Cursor/Backups/edit",
    "Library/Application Support/Google/Chrome/Default/Service Worker/CacheStorage/offline",
    "Library/Application Support/Google/Chrome/Default/Local Storage/leveldb/data",
    "Library/Developer/Xcode/Archives/app.xcarchive/archive",
    "Library/Developer/CoreSimulator/Profiles/Runtimes/iOS.simruntime/binary",
    "Library/Application Support/MobileSync/Backup/phone/file",
    "Library/Messages/Attachments/message/file",
    ".android/avd/phone/data",
    ".cache/codex-runtimes/node/bin/node",
    ".m2/repository/local-only.jar",
    ".aws/cli/cache/token.json",
    "Developer/project/node_modules/package/.cache/file",
    "Developer/project/dist/release",
    "Desktop/project/build/artifact",
  ];
  try {
    for (const relative of [
      ...candidates,
      ...kept,
      ".cache/uv/archive-v0/wheel",
      ".gradle/caches/modules/module",
    ]) {
      const target = path.join(home, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, "data");
    }
    const results = await scanCleanerTargets(
      "deep",
      {},
      { home, tmpDir: home },
    );
    const paths = results
      .filter((result) => !result.managedBy)
      .flatMap((result) => result.paths);
    const covered = (relative: string) =>
      paths.some(
        (root) =>
          path.join(home, relative) === root ||
          path.join(home, relative).startsWith(`${root}/`),
      );
    for (const candidate of candidates)
      assert.ok(covered(candidate), `Missing ${candidate}`);
    for (const item of kept)
      assert.equal(covered(item), false, `Matched persistent data: ${item}`);
    assert.ok(
      results.some(
        (result) =>
          result.managedBy === "uv" &&
          result.paths.includes(path.join(home, ".cache/uv")),
      ),
    );
    assert.ok(results.some((result) => result.managedBy === "gradle"));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("basic mode excludes package executables, project caches, trash and arbitrary temp roots", () => {
  const basic = getCleanerScanCategories("basic", { tmpDir: "/" });
  for (const category of [
    "Bun Package Cache",
    "npx Package Cache",
    "Developer Project Caches",
    "Trash",
    "Temporary Workspace Data",
  ])
    assert.ok(!basic.some((entry) => entry.category === category));
  for (const unsafe of [
    "/",
    "/Users/me",
    "/var/folders",
    "/var/folders/a/b",
    "/var/folders/a/b/T/child",
    "/private/var/folders/a/b/C",
  ])
    assert.equal(isTrustedTemporaryRoot(unsafe), false);
  for (const safe of [
    "/tmp",
    "/private/tmp",
    "/var/folders/ab/user/T",
    "/private/var/folders/ab/user/T/",
  ])
    assert.equal(isTrustedTemporaryRoot(safe), true);
  assert.ok(
    !getCleanerScanCategories("deep", { tmpDir: "/" })
      .flatMap((entry) => entry.globs)
      .includes("/*"),
  );
});

test("only untracked, explicitly ignored project caches pass the Git guard", async () => {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "your-clean-git-")),
  );
  const repo = path.join(home, "Developer/project");
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    await fs.mkdir(repo, { recursive: true });
    git("init", "-q");
    await fs.writeFile(path.join(repo, ".gitignore"), ".cache/\n");
    for (const directory of [".cache", "coverage", "dist"]) {
      await fs.mkdir(path.join(repo, directory));
      await fs.writeFile(path.join(repo, directory, "file"), "keep");
    }
    git("add", "dist/file");
    assert.equal(
      await getProjectArtifactSkipReason(path.join(repo, ".cache"), home),
      null,
    );
    assert.equal(
      await getProjectArtifactSkipReason(path.join(repo, "coverage"), home),
      "not-ignored-project-artifact",
    );
    assert.equal(
      await getProjectArtifactSkipReason(path.join(repo, "dist"), home),
      "tracked-project-artifact",
    );
    assert.equal(
      await getProjectArtifactSkipReason(path.join(home, "other"), home),
      "unverified-project-artifact",
    );
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
