import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBrewOutdatedJson,
  suppressBrewPourNoise,
} from "../src/managers/brew-manager.js";

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
