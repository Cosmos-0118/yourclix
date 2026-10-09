import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CliUI } from "../src/core/ui.js";
import { stripAnsi } from "../src/core/format.js";

function harness(tty = false, columns = 36) {
  const output = Object.assign(new PassThrough(), { isTTY: tty, columns });
  const input = Object.assign(new PassThrough(), { isTTY: tty });
  let transcript = "";
  output.on("data", (chunk) => {
    transcript += chunk.toString();
  });
  const terminal = new CliUI({ input, output, errorOutput: output, env: {} });
  return { terminal, output, input, read: () => transcript };
}

test("static tasks preserve returned failures and release ownership after throws", async () => {
  const h = harness();
  await h.terminal.task("Upgrade cask", async () => ({
    status: "failed",
    details: ["Missing app"],
  }));
  await assert.rejects(
    h.terminal.task("Throwing task", async () => {
      throw new Error("network lost");
    }),
    /network lost/,
  );
  h.terminal.write("Next task can write");
  const text = h.read();
  assert.match(text, /✗ Upgrade cask/);
  assert.match(text, /Missing app/);
  assert.doesNotMatch(text, /✓ Upgrade cask/);
  assert.match(text, /✗ Throwing task/);
  assert.match(text, /Next task can write/);
  assert.doesNotMatch(text, /\x1b\[/);
});

test("nested task output is serialized into one progress line", async () => {
  const h = harness(true);
  await h.terminal.task("Maintenance", async () => {
    h.terminal.write("A diagnostic line");
    await h.terminal.task("Upgrade", async () => {
      h.terminal.write("Download complete");
      return { status: "warn", details: ["One package kept"] };
    });
  });
  assert.match(h.read(), /\r\x1b\[2K/);
  assert.match(stripAnsi(h.read()), /! Upgrade/);
  assert.match(stripAnsi(h.read()), /Download complete/);
  assert.equal(h.terminal.activeTasks, 0);
});

test("redirected input disables animation and prompts even when output is a TTY", async () => {
  const h = harness(true);
  h.input.isTTY = false;
  assert.equal(h.terminal.interactive, false);
  assert.equal(await h.terminal.confirm("Remove package?"), false);
  assert.equal(
    await h.terminal.select(
      "Repair?",
      [{ value: "skip", label: "Skip" }],
      "skip",
    ),
    "skip",
  );
  await h.terminal.task("Check", async () => undefined);
  assert.doesNotMatch(h.read(), /\x1b\[/);
});

test("terminal handoff suppresses rendering until the child returns, even on failure", async () => {
  const h = harness(true);
  await h.terminal.task("Parent", async () => {
    await assert.rejects(
      h.terminal.suspend(async () => {
        const start = h.read();
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(h.read(), start);
        throw new Error("child failed");
      }),
      /child failed/,
    );
  });
  assert.equal(h.terminal.activeTasks, 0);
});

test("human output wraps without dropping long paths", () => {
  const h = harness(false, 24);
  const path = "/Applications/SomeVeryLongApplicationName.app";
  h.terminal.write(path);
  const lines = h.read().trimEnd().split("\n");
  assert.ok(lines.every((line) => line.length <= 24));
  assert.equal(lines.join(""), path);
});

test("command cancellation stops progress and prevents later tasks from running", async () => {
  const h = harness(true);
  let ranLaterTask = false;
  await assert.rejects(
    h.terminal.task("Work", async () => {
      h.terminal.cancel();
      await h.terminal.task("Must not start", async () => {
        ranLaterTask = true;
      });
    }),
    /Cancelled/,
  );
  assert.equal(ranLaterTask, false);
  assert.equal(h.terminal.activeTasks, 0);
});

test("subprocess control sequences cannot move the shared renderer's cursor", () => {
  const h = harness(true);
  h.terminal.write("Downloading\rComplete\x1b[2J\x1b[H");
  assert.doesNotMatch(h.read(), /\x1b\[2J|\x1b\[H/);
  assert.match(h.read(), /Complete/);
});

test("process exit codes and failed queries show failures instead of false success markers", async () => {
  const h = harness();
  await h.terminal.task("Disable login item", async () => ({
    code: 1,
    stdout: "",
    stderr: "Access denied",
  }));
  await h.terminal.task("Discover targets", async () => ({
    ok: false,
    error: "Invalid JSON",
  }));
  assert.match(h.read(), /✗ Disable login item/);
  assert.match(h.read(), /Access denied/);
  assert.match(h.read(), /✗ Discover targets/);
  assert.match(h.read(), /Invalid JSON/);
  assert.doesNotMatch(h.read(), /✓/);
});

test("interactive output preserves color codes and note indentation", () => {
  const h = harness(true);
  h.terminal.note("\x1b[31mUseful detail\x1b[39m");
  assert.match(h.read(), /\x1b\[31m/);
  assert.equal(stripAnsi(h.read()), "  Useful detail\n");
});
