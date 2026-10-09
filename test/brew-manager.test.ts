import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBrewOutdatedJson,
  suppressBrewPourNoise,
  runBrewStep,
} from "../src/managers/brew-manager.js";
import { normalizeDoctorStep } from "../src/services/brew/brew.js";

test("parses and normalizes Homebrew outdated JSON v2", () => {
  const result = parseBrewOutdatedJson(
    JSON.stringify({
      formulae: [{ name: "zlib" }, { name: "git" }, { name: "zlib" }],
      casks: [{ name: "visual-studio-code" }, { name: "" }],
    }),
  );

  assert.deepEqual(result, {
    formulae: ["git", "zlib"],
    casks: ["visual-studio-code"],
  });
});

test("rejects malformed Homebrew outdated JSON", () => {
  assert.throws(
    () => parseBrewOutdatedJson("[]"),
    /unexpected outdated-package shape/i,
  );
  assert.throws(
    () => parseBrewOutdatedJson('{"formulae":"not-an-array"}'),
    /invalid formulae list/i,
  );
});

test("filters low-value brew filesystem noise without hiding warnings", () => {
  assert.equal(suppressBrewPourNoise("  ln -s /tmp/a /tmp/b", "stdout"), true);
  assert.equal(suppressBrewPourNoise("Warning: a keg is not linked", "stderr"), false);
  assert.equal(suppressBrewPourNoise("🍺  git was upgraded", "stdout"), false);
});

test("streamed failures retain actual stderr rather than referring to vanished output", async () => {
  const result = await runBrewStep("Upgrade", process.execPath, ["-e", "console.error('Error: monolingual: App source is missing'); process.exitCode = 1"], true, false, true, { onLine() {} });
  assert.equal(result.status, "failed");
  assert.match(result.details.join("\n"), /monolingual: App source is missing/);
});

test("doctor warning normalization does not mistake the word failed in a warning for a fatal error", () => {
  const step = normalizeDoctorStep({ name: "Doctor", command: "brew doctor", critical: false, status: "failed", details: ["Warning: Some installed formulae are deprecated or disabled.\npython@3.10\nWarning: A check failed to find an optional tool."] });
  assert.equal(step.status, "warn");
  assert.match(step.details.join("\n"), /python@3.10/);
});

test("doctor errors in stderr remain failures even if stdout contains a warning", async () => {
  const result = await runBrewStep("Doctor", process.execPath, ["-e", "console.log('Warning: deprecated package'); console.error('Error: cannot read prefix'); process.exitCode = 2"], false, false);
  assert.equal(normalizeDoctorStep(result).status, "failed");
  assert.match(result.details.join("\n"), /cannot read prefix/);
});
