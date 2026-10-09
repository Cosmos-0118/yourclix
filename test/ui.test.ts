import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CliUI } from "../src/core/ui.js";
import { stripAnsi } from "../src/core/format.js";

function harness(tty = false, columns = 36, env: NodeJS.ProcessEnv = {}) {
  const output = Object.assign(new PassThrough(), { isTTY: tty, columns });
  const input = Object.assign(new PassThrough(), { isTTY: tty });
  let transcript = "";
  output.on("data", (chunk) => {
    transcript += chunk.toString();
  });
  const terminal = new CliUI({ input, output, errorOutput: output, env });
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
  assert.match(text, /network lost/);
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
  assert.equal(stripAnsi(h.read()), "    Useful detail\n");
});

test("TTY status labels use distinct colours without relying on the host process", () => {
  const h = harness(true, 80);
  h.terminal.heading("Health");
  h.terminal.status("success", "Metadata refreshed");
  h.terminal.status("warn", "Package deprecated", ["Find a replacement"]);
  h.terminal.status("failed", "Upgrade failed", ["Missing application"]);
  h.terminal.status("skipped", "Package kept");
  const output = h.read();
  assert.match(output, /\x1b\[36m[^\n]*Health/);
  assert.match(output, /\x1b\[32m[^\n]*Metadata refreshed/);
  assert.match(output, /\x1b\[33m[^\n]*Package deprecated/);
  assert.match(output, /\x1b\[31m[^\n]*Upgrade failed/);
  assert.match(output, /\x1b\[90m[^\n]*Package kept/);
});

test("NO_COLOR disables both generated and incoming colours while keeping TTY progress", async () => {
  const h = harness(true, 80, { NO_COLOR: "1" });
  h.terminal.heading("Health");
  await h.terminal.task("Refresh", async () => {
    h.terminal.note("\x1b[32mDownloaded\x1b[39m");
  });
  assert.doesNotMatch(h.read(), /\x1b\[[\d;]*m/);
  assert.match(h.read(), /\r\x1b\[2K/);
});

test("detailed steps get breathing room while consecutive short steps stay compact", async () => {
  const h = harness(false, 80);
  h.terminal.heading("Health");
  h.terminal.status("warn", "Package deprecated", ["Find a replacement"]);
  await h.terminal.task("Refresh metadata", async () => undefined);
  h.terminal.status("success", "Targets discovered");
  h.terminal.heading("Cleanup");
  const output = h.read();
  assert.match(output, /Find a replacement\n\n +… Refresh metadata/);
  assert.match(output, /✓ Refresh metadata\n +✓ Targets discovered/);
  assert.match(output, /Targets discovered\n\n +.*Cleanup/);
  assert.doesNotMatch(output, /\n{3}/);
});

test("styled details retain their indentation on every narrow-terminal continuation", () => {
  const h = harness(true, 24);
  h.terminal.status("failed", "Upgrade failed", [
    "Error: /Applications/AReallyLongApplicationName.app is missing",
  ]);
  const lines = stripAnsi(h.read()).trimEnd().split("\n");
  assert.ok(lines.every((line) => line.length <= 24));
  assert.ok(lines.slice(1).every((line) => line.startsWith("    ")));
  assert.match(
    lines
      .slice(1)
      .map((line) => line.trim())
      .join(""),
    /AReallyLongApplicationName.app/,
  );
});

test("outcome summaries count results without replaying successful command output", () => {
  const h = harness(false, 80);
  h.terminal.summary("Reset result", [
    {
      status: "success",
      name: "Disable indexing",
      details: ["RAW SUCCESS OUTPUT"],
    },
    { status: "partial" },
    { status: "failed" },
    { status: "skipped" },
  ]);
  assert.match(h.read(), /1 completed/);
  assert.match(h.read(), /1 warning/);
  assert.match(h.read(), /1 failed/);
  assert.match(h.read(), /1 skipped/);
  assert.doesNotMatch(h.read(), /RAW SUCCESS OUTPUT|Disable indexing/);
});

test("advisories align with steps without changing the operation's final status", () => {
  const h = harness(true, 80);
  h.terminal.start("Reset");
  h.terminal.notice(
    "Rebuilding may affect performance",
    ["Administrator authentication is required."],
    "warn",
  );
  h.terminal.notice("Critical diagnostic finding", [], "error");
  h.terminal.finish();
  const output = stripAnsi(h.read());
  assert.match(h.read(), /\x1b\[31m[^\n]*Critical diagnostic finding/);
  assert.match(output, /\n  ! Rebuilding/);
  assert.match(output, /\n    Administrator/);
  assert.match(output, /✓ Done\./);
  assert.doesNotMatch(output, /Finished with warnings/);
  assert.doesNotMatch(output, /Finished with unresolved/);
});

test("formatted errors keep their cause and recovery guidance on stderr", () => {
  const h = harness(false, 80);
  const errorOutput = new PassThrough();
  let errors = "";
  errorOutput.on("data", (data) => {
    errors += data;
  });
  const terminal = new CliUI({
    input: h.input,
    output: h.output,
    errorOutput,
    env: {},
  });
  terminal.reportError(
    "Reset failed",
    ["Permission denied"],
    ["your spotlight status"],
  );
  assert.match(errors, /Reset failed/);
  assert.match(errors, /Permission denied/);
  assert.match(errors, /Next steps/);
  assert.match(errors, /your spotlight status/);
  assert.doesNotMatch(h.read(), /Reset failed|Permission denied/);
});
