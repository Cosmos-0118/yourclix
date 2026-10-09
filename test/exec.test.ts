import assert from "node:assert/strict";
import test from "node:test";
import { runCommand, runCommandFilteredStream } from "../src/core/exec.js";

test("aborting a streamed child stops it and reports cancellation despite allowFailure", async () => {
  const controller = new AbortController();
  const task = runCommandFilteredStream(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { allowFailure: true, signal: controller.signal, onLine() {} },
  );
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(task, /Cancelled/);
});

test("aborting a captured child stops it and reports cancellation", async () => {
  const controller = new AbortController();
  const task = runCommand(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(task, /Cancelled/);
});

test("carriage-return download progress is emitted as separate lines", async () => {
  const lines: string[] = [];
  await runCommandFilteredStream(
    process.execPath,
    ["-e", "process.stdout.write('10%\\r50%\\r100%\\n')"],
    { onLine: (line) => lines.push(line) },
  );
  assert.deepEqual(lines, ["10%", "50%", "100%"]);
});

test(
  "cancellation terminates a child that ignores SIGINT within a bounded grace period",
  { timeout: 4000 },
  async () => {
    const controller = new AbortController();
    const started = Date.now();
    const task = runCommandFilteredStream(
      process.execPath,
      [
        "-e",
        "process.on('SIGINT',()=>{}); console.log('ready'); setInterval(()=>{},1000)",
      ],
      {
        signal: controller.signal,
        allowFailure: true,
        onLine(line) {
          if (line === "ready") controller.abort();
        },
      },
    );
    await assert.rejects(task, /Cancelled/);
    assert.ok(Date.now() - started < 3000);
  },
);
