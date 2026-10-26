import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function checkInstaller(version: string | null, brewVersion = "26.0.0") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "your-installer-node-"));
  const calls = path.join(dir, "brew-calls.txt");
  const nodePath = path.join(dir, "node");
  const nodeStub = (value: string) => `#!${process.execPath}
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args[0] === '-p') {
  console.log(${JSON.stringify(`v${value}`)});
} else if (args[0] === '-e') {
  const result = spawnSync(process.execPath, ['-e',
    ${JSON.stringify(`Object.defineProperty(process.versions, 'node', { value: '${value}' });`)} + args[1],
    ...args.slice(2)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else {
  process.exit(1);
}
`;
  try {
    await fs.writeFile(path.join(dir, "package.json"), '{"type":"module"}');
    if (version !== null) {
      await fs.writeFile(nodePath, nodeStub(version), { mode: 0o755 });
    }
    const brewPath = path.join(dir, "brew");
    await fs.writeFile(brewPath, `#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');
fs.writeFileSync(${JSON.stringify(nodePath)}, ${JSON.stringify(nodeStub(brewVersion))}, { mode: 0o755 });
`, { mode: 0o755 });
    const installer = await fs.readFile(new URL("../scripts/install.sh", import.meta.url), "utf8");
    // Load the real installer functions, but run only the Node prerequisite check.
    assert.match(installer, /\nmain "\$@"\s*$/);
    const harness = installer.replace(/\nmain "\$@"\s*$/, '\nYOUR_BREW_BIN="$YOUR_TEST_BREW_BIN"\nensure_node\n');
    const result = spawnSync("/bin/bash", [], {
      input: harness,
      encoding: "utf8",
      env: { ...process.env, PATH: dir, NO_COLOR: "1", YOUR_TEST_BREW_BIN: brewPath },
    });
    assert.ifError(result.error);
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      calls: await fs.readFile(calls, "utf8").catch(() => ""),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("installer rejects unsupported active Node versions before installing packages", async () => {
  for (const version of ["20.20.0", "22.11.99"]) {
    const result = await checkInstaller(version);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /22\.12\.0 or newer is required/);
    assert.match(result.output, /Update the active Node\.js installation/);
    assert.equal(result.calls, "");
  }
});

test("installer accepts the minimum Node version and newer releases", async () => {
  for (const version of ["22.12.0", "22.22.3", "24.0.0", "26.0.0"]) {
    const result = await checkInstaller(version);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /present/);
    assert.equal(result.calls, "");
  }
});

test("installer installs Node when missing and validates the resulting runtime", async () => {
  const result = await checkInstaller(null);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.calls, "install node\n");
  assert.match(result.output, /Node\.js installed/);

  const unsupported = await checkInstaller(null, "20.20.0");
  assert.equal(unsupported.status, 1, unsupported.output);
  assert.match(unsupported.output, /22\.12\.0 or newer is required/);
  assert.doesNotMatch(unsupported.output, /✓ Node\.js installed/);
});
