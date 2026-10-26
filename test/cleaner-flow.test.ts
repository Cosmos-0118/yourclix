import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { PassThrough } from "node:stream";
import { CliUI } from "../src/core/ui.js";
import { printCleanerResults } from "../src/services/clean/cleaner-scan.js";
import { buildCleanupSummaryPanel } from "../src/services/clean/cleaner-execute.js";
import { stripAnsi, visibleWidth } from "../src/core/format.js";

async function fixture(
  run: (
    home: string,
    invoke: (args: string[]) => Promise<{ code: number; output: string }>,
  ) => Promise<void>,
  uvFails = false,
) {
  const home = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "your-clean-flow-")),
  );
  const bin = path.join(home, "bin");
  try {
    await fs.mkdir(bin);
    await fs.writeFile(path.join(home, "package.json"), '{"type":"module"}');
    for (const [name, source] of Object.entries({
      lsof: "console.log('p123\\nn/usr/bin/node');",
      ps: `console.log('${process.getuid?.()} node fixture-worker');`,
      uv: `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(path.join(home, "uv-calls.jsonl"))}, JSON.stringify({args:process.argv.slice(2),lock:process.env.UV_LOCK_TIMEOUT})+'\\n'); console.error(${JSON.stringify(uvFails ? "Cache locked by another process" : "Pruned mock unreachable entries")}); process.exitCode=${uvFails ? 1 : 0};`,
      launchctl: `throw new Error('launchctl must not be called');`,
    }))
      await fs.writeFile(
        path.join(bin, name),
        `#!${process.execPath}\n${source}`,
        { mode: 0o755 },
      );
    const cache = path.join(home, "Library/Caches/test-app");
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(path.join(cache, "old.bin"), Buffer.alloc(4096));
    const old = new Date(Date.now() - 90 * 86400000);
    await fs.utimes(path.join(cache, "old.bin"), old, old);
    await fs.utimes(cache, old, old);
    await fs.mkdir(path.join(home, ".cache/uv"), { recursive: true });
    await fs.writeFile(path.join(home, ".zshrc"), "# unchanged\n");
    const invoke = (args: string[]) =>
      new Promise<{ code: number; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", ...args], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            HOME: home,
            TMPDIR: home,
            PATH: `${bin}:${process.env.PATH}`,
            NO_COLOR: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, output }));
      });
    await run(home, invoke);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("CLI dry run is noninteractive, changes no data or profiles and never invokes uv pruning", () =>
  fixture(async (home, invoke) => {
    const result = await invoke([
      "src/index.ts",
      "clean",
      "--mode",
      "deep",
      "--days",
      "5",
      "--dry-run",
      "--prune-uv",
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Discovered caches/);
    assert.match(result.output, /Cleanup plan/);
    assert.match(result.output, /Would move to undo backup: 1 path/);
    assert.match(
      result.output,
      /Would run uv cache prune; no command executed/,
    );
    assert.doesNotMatch(
      result.output,
      /no interactive input|Move 1 path.*\?|Potential reclaim|Cleanup complete/,
    );
    assert.doesNotMatch(result.output, /\x1b\[/);
    assert.equal(
      await fs.readFile(path.join(home, ".zshrc"), "utf8"),
      "# unchanged\n",
    );
    for (const file of [".zprofile", ".your-backups", "uv-calls.jsonl"])
      await assert.rejects(fs.lstat(path.join(home, file)), { code: "ENOENT" });
    assert.ok(
      (
        await fs.stat(path.join(home, "Library/Caches/test-app/old.bin"))
      ).isFile(),
    );
  }));

test("native uv pruning requires opt-in and uses locking without force", () =>
  fixture(async (home, invoke) => {
    const source = `import { handleManagedCleanerCaches } from './src/services/clean/cleaner-managed.ts';
const caches=[{category:'uv Cache',paths:[${JSON.stringify(path.join(home, ".cache/uv"))}],bytes:1000,managedBy:'uv'}];
await handleManagedCleanerCaches(caches,{mode:'deep',yes:true});
await handleManagedCleanerCaches(caches,{mode:'deep',yes:true,pruneUv:true});`;
    const result = await invoke(["--input-type=module", "-e", source]);
    assert.equal(result.code, 0, result.output);
    const calls = (await fs.readFile(path.join(home, "uv-calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "--no-config",
      "--offline",
      "--no-progress",
      "--color",
      "never",
      "cache",
      "prune",
      "--cache-dir",
      path.join(home, ".cache/uv"),
    ]);
    assert.equal(calls[0].lock, "1");
    assert.match(result.output, /undo backup do not apply/);
  }));

test("native uv failures stay failures and are never retried with force", () =>
  fixture(async (home, invoke) => {
    const result = await invoke([
      "src/index.ts",
      "clean",
      "--days",
      "5",
      "--prune-uv",
      "-y",
    ]);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Cache locked by another process/);
    assert.match(result.output, /no forced removal attempted/);
    assert.doesNotMatch(result.output, /✓ Done/);
    const calls = (await fs.readFile(path.join(home, "uv-calls.jsonl"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0]).args.includes("--force"), false);
  }, true));

test("backup revalidation keeps a path that was replaced after preflight", () =>
  fixture(async (home, invoke) => {
    const cache = path.join(home, "Library/Caches/test-app");
    const source = `import fs from 'node:fs/promises';
import { preflightCleaner,runCleanerBackup } from './src/services/clean/cleaner-execute.ts';
const cache=${JSON.stringify(cache)};
const plan=await preflightCleaner([{category:'User Cache',paths:[cache],bytes:4096}],{mode:'deep',olderThanDays:5});
if(plan.candidates.length!==1) throw new Error(JSON.stringify(plan.skipped));
await fs.rename(cache,cache+'-old');
await fs.mkdir(cache); await fs.writeFile(cache+'/keep.bin','keep');
const old=new Date(Date.now()-90*86400000); await fs.utimes(cache+'/keep.bin',old,old); await fs.utimes(cache,old,old);
const result=await runCleanerBackup(plan.candidates,{mode:'deep',olderThanDays:5});
console.log('RESULT '+JSON.stringify(result));`;
    const result = await invoke(["--input-type=module", "-e", source]);
    assert.equal(result.code, 0, result.output);
    const backup = JSON.parse(result.output.split("RESULT ")[1]);
    assert.equal(backup.deletedCount, 0);
    assert.equal(backup.status, "failed");
    assert.match(backup.backupWarnings.join(" "), /path-changed-since-preview/);
    assert.equal(
      await fs.readFile(path.join(cache, "keep.bin"), "utf8"),
      "keep",
    );
  }));

test("eligible fixture files survive the actual backup and restore round trip", () =>
  fixture(async (home, invoke) => {
    const source = `import fs from 'node:fs/promises';
import { preflightCleaner,runCleanerBackup } from './src/services/clean/cleaner-execute.ts';
import { undoManager } from './src/core/undo-manager.ts';
const cache=${JSON.stringify(path.join(home, "Library/Caches/test-app"))};
const plan=await preflightCleaner([{category:'User Cache',paths:[cache],bytes:4096}],{mode:'deep',olderThanDays:5});
const result=await runCleanerBackup(plan.candidates,{mode:'deep',olderThanDays:5});
if(result.deletedCount!==1) throw new Error(JSON.stringify(result));
await undoManager.restoreBackup(result.backupId);
console.log('RESULT '+(await fs.readFile(cache+'/old.bin')).length);`;
    const result = await invoke(["--input-type=module", "-e", source]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /RESULT 4096/);
  }));

test("cleaner output uses shared headings and readable narrow-terminal rows", () => {
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 36 });
  const input = Object.assign(new PassThrough(), { isTTY: true });
  let transcript = "";
  output.on("data", (chunk) => {
    transcript += chunk;
  });
  const terminal = new CliUI({ input, output, errorOutput: output, env: {} });
  printCleanerResults(
    [
      {
        category: "Python and Build Tool Caches",
        paths: ["/cache"],
        bytes: 1000,
      },
    ],
    terminal,
  );
  const text = stripAnsi(transcript);
  assert.match(text, /  ▸ Discovered caches\n/);
  assert.match(text, /    Python and Build Tool Caches\n      1000 B · 1 path/);
  assert.ok(text.split("\n").every((line) => visibleWidth(line) <= 36));
  const summary = buildCleanupSummaryPanel(
    {
      deletedCount: 1,
      reclaimedBytes: 1000,
      backupId: null,
      backupWarnings: [],
      status: "success",
    },
    0,
    { olderThanDays: 5 },
    true,
  );
  assert.match(summary.body.join("\n"), /Would move to undo backup/);
  assert.doesNotMatch(summary.body.join("\n"), /Potential reclaim|freed 1/);
});

test("persistent uv exclusions prevent native pruning even with explicit opt-in", () =>
  fixture(async (home, invoke) => {
    await fs.mkdir(path.join(home, ".your-config"));
    await fs.writeFile(
      path.join(home, ".your-config/cleaner-excludes.json"),
      JSON.stringify(["~/.cache/uv"]),
    );
    const result = await invoke([
      "src/index.ts",
      "clean",
      "--days",
      "5",
      "--prune-uv",
      "-y",
    ]);
    assert.equal(result.code, 0, result.output);
    await assert.rejects(fs.lstat(path.join(home, "uv-calls.jsonl")), {
      code: "ENOENT",
    });
  }));

test("permanent mode preview deletes nothing and creates no undo backup", () =>
  fixture(async (home, invoke) => {
    const result = await invoke([
      "src/index.ts",
      "clean",
      "--mode",
      "deep",
      "--days",
      "5",
      "--permanent",
      "--dry-run",
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Would permanently delete: 1 path/);
    assert.match(result.output, /no undo backup is created/);
    assert.doesNotMatch(
      result.output,
      /Would move to undo backup|no interactive input/,
    );
    assert.ok(
      (
        await fs.stat(path.join(home, "Library/Caches/test-app/old.bin"))
      ).isFile(),
    );
    await assert.rejects(fs.lstat(path.join(home, ".your-backups")), {
      code: "ENOENT",
    });
  }));

test("explicit permanent mode deletes only eligible fixture paths with no backup history", () =>
  fixture(async (home, invoke) => {
    const recent = path.join(home, "Library/Caches/recent-app");
    await fs.mkdir(recent);
    await fs.writeFile(path.join(recent, "keep.bin"), "keep");
    const result = await invoke([
      "src/index.ts",
      "clean",
      "--days",
      "5",
      "--permanent",
      "-y",
    ]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Permanent deletion selected/);
    assert.match(result.output, /Permanently deleted: 1 path/);
    assert.match(result.output, /Measured free-space change:/);
    assert.doesNotMatch(
      result.output,
      /Moved to undo backup|Restore: your undo/,
    );
    await assert.rejects(fs.lstat(path.join(home, "Library/Caches/test-app")), {
      code: "ENOENT",
    });
    await assert.rejects(fs.lstat(path.join(home, ".your-backups")), {
      code: "ENOENT",
    });
    assert.equal(
      await fs.readFile(path.join(recent, "keep.bin"), "utf8"),
      "keep",
    );
    assert.ok((await fs.stat(path.join(home, ".cache/uv"))).isDirectory());
  }));

test("yes alone retains the default undo backup behavior", () =>
  fixture(async (home, invoke) => {
    const result = await invoke(["src/index.ts", "clean", "--days", "5", "-y"]);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Undo backup selected/);
    assert.match(result.output, /Moved to undo backup: 1 path/);
    assert.doesNotMatch(result.output, /Permanently deleted/);
    assert.ok(
      (await fs.stat(path.join(home, ".your-backups/.registry.json"))).isFile(),
    );
  }));

test("permanent deletion revalidates changed paths just like backup", () =>
  fixture(async (home, invoke) => {
    const cache = path.join(home, "Library/Caches/test-app");
    const source = `import fs from 'node:fs/promises';
import {preflightCleaner} from './src/services/clean/cleaner-execute.ts';
import {runCleanerPermanentDeletion} from './src/services/clean/cleaner-permanent.ts';
const cache=${JSON.stringify(cache)};
const plan=await preflightCleaner([{category:'User Cache',paths:[cache],bytes:4096}],{mode:'deep',olderThanDays:5});
await fs.rename(cache,cache+'-old'); await fs.mkdir(cache); await fs.writeFile(cache+'/keep.bin','keep');
const old=new Date(Date.now()-90*86400000); await fs.utimes(cache+'/keep.bin',old,old); await fs.utimes(cache,old,old);
const result=await runCleanerPermanentDeletion(plan.candidates,{mode:'deep',olderThanDays:5});
console.log('RESULT '+JSON.stringify(result));`;
    const result = await invoke(["--input-type=module", "-e", source]);
    assert.equal(result.code, 0, result.output);
    const cleanup = JSON.parse(result.output.split("RESULT ")[1]);
    assert.equal(cleanup.deletedCount, 0);
    assert.equal(cleanup.status, "failed");
    assert.match(
      cleanup.backupWarnings.join(" "),
      /path-changed-since-preview/,
    );
    assert.equal(
      await fs.readFile(path.join(cache, "keep.bin"), "utf8"),
      "keep",
    );
    await assert.rejects(fs.lstat(path.join(home, ".your-backups")), {
      code: "ENOENT",
    });
  }));

test("interactive removal choice defaults to backup and is not persisted", async () => {
  const { chooseCleanerDisposition } =
    await import("../src/services/clean/cleaner-execute.js");
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80 });
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const terminal = new CliUI({ input, output, errorOutput: output, env: {} });
  let choices = 0;
  Object.defineProperty(terminal, "select", {
    value: async (
      _message: string,
      options: { value: string }[],
      initial: string,
    ) => {
      choices++;
      assert.equal(initial, "backup");
      assert.deepEqual(
        options.map((option) => option.value),
        ["backup", "permanent", "cancel"],
      );
      return "permanent";
    },
  });
  assert.equal(
    await chooseCleanerDisposition({ mode: "deep" }, terminal),
    "permanent",
  );
  assert.equal(
    await chooseCleanerDisposition({ mode: "deep", yes: true }, terminal),
    "backup",
  );
  assert.equal(
    await chooseCleanerDisposition({ mode: "deep", dryRun: true }, terminal),
    "backup",
  );
  assert.equal(
    await chooseCleanerDisposition({ mode: "deep", permanent: true }, terminal),
    "permanent",
  );
  assert.equal(choices, 1);
});

for (const choice of ["cancel", "permanent"] as const)
  test(`cancelling at ${choice === "cancel" ? "removal choice" : "final confirmation"} keeps all files and skips native pruning`, () =>
    fixture(async (home, invoke) => {
      const cache = path.join(home, "Library/Caches/test-app");
      const source = `import {CliUI} from './src/core/ui.ts';
import {executeCleaner} from './src/services/clean/cleaner-execute.ts';
const terminal=new CliUI();
Object.defineProperty(terminal,'interactive',{value:true});
terminal.select=async()=>${JSON.stringify(choice)};
terminal.confirm=async()=>false;
await executeCleaner([
{category:'User Cache',paths:[${JSON.stringify(cache)}],bytes:4096},
{category:'uv Cache',paths:[${JSON.stringify(path.join(home, ".cache/uv"))}],bytes:1000,managedBy:'uv'}
],{mode:'deep',olderThanDays:5,pruneUv:true},terminal);`;
      const result = await invoke(["--input-type=module", "-e", source]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /Cleanup cancelled; files kept/);
      assert.ok((await fs.stat(path.join(cache, "old.bin"))).isFile());
      for (const file of [".your-backups", "uv-calls.jsonl"])
        await assert.rejects(fs.lstat(path.join(home, file)), {
          code: "ENOENT",
        });
    }));
