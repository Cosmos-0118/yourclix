import assert from "node:assert/strict";
import test from "node:test";
import {
  compactPath,
  fitText,
  pluralize,
  terminalRule,
  visibleWidth,
  wrapAnsiText,
  wrapText,
} from "../src/core/format.js";

test("measures styled terminal text without counting ANSI escapes", () => {
  assert.equal(visibleWidth("\u001b[32mgreen\u001b[39m"), 5);
  assert.equal(visibleWidth("one\ntwo words"), 9);
});

test("wraps raw and styled lines to a narrow terminal width", () => {
  assert.deepEqual(wrapText("one two three four", 8), ["one two", "three", "four"]);

  const wrapped = wrapAnsiText("\u001b[31mone two three\u001b[39m", 7);
  assert.equal(wrapped.map((line) => visibleWidth(line)).every((width) => width <= 7), true);
  assert.equal(wrapped.length, 2);
  assert.equal(visibleWidth(wrapped[0] ?? ""), 7);
  assert.equal(visibleWidth(wrapped[1] ?? ""), 5);
});

test("keeps compact paths and fitted labels readable", () => {
  assert.equal(compactPath("/Users/tester/Library/Caches/app", "/Users/tester"), "~/Library/Caches/app");
  assert.equal(fitText("abcdefghijkl", 8), "abcdefg…");
  assert.equal(pluralize(1, "path"), "1 path");
  assert.equal(pluralize(3045, "path"), "3,045 paths");
});

test("rules never exceed the terminal width budget", () => {
  assert.equal(terminalRule(72, 40).length, 38);
  assert.equal(terminalRule(72, 120).length, 72);
});
