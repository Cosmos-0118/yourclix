import assert from "node:assert/strict";
import test from "node:test";
import { runStepCommand } from "../src/services/network/runner.js";

test("network diagnostics retain stderr alongside stdout and keep full output in the log", async () => {
  const log: string[] = [];
  const result = await runStepCommand(
    "Probe",
    process.execPath,
    [
      "-e",
      "console.log('ordinary context'); console.error('Permission denied'); process.exitCode=1;",
    ],
    true,
    false,
    {
      path: "/tmp/test-network.log",
      log: async (line) => {
        log.push(line);
      },
    },
  );
  assert.equal(result.status, "failed");
  assert.match(result.details.join("\n"), /Permission denied/);
  assert.match(result.details.join("\n"), /ordinary context/);
  assert.match(log.join("\n"), /Permission denied/);
});
