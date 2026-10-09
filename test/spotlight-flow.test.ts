import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

// Exercise the real Spotlight flow; only sudo/mdutil are fake executables.
async function runSpotlight(
  dryRun = false,
  failDisable = false,
  failAuth = false,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "your-spotlight-ui-"));
  const calls = path.join(dir, "calls.txt");
  const script = `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, args.join(' ')+'\\n');
if (args.includes('true') && ${failAuth}) { console.error('Authentication required'); process.exitCode=1; }
else if (args.includes('mdutil') && args.includes('off') && ${failDisable}) {
 console.log('Ordinary stdout context'); console.error('Permission denied during disable'); process.exitCode=1;
} else if (args.includes('-s')) console.log('/:\\n    Indexing enabled.');
else if (args.includes('mdutil')) console.log('/:\\n    RAW_INDEX_OUTPUT');
`;
  await fs.writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  for (const name of ["sudo", "mdutil"])
    await fs.writeFile(path.join(dir, name), script, { mode: 0o755 });
  const source = `import { spotlightReset } from './src/services/spotlight/spotlight.ts';
import { ui } from './src/core/ui.ts';
try { await ui.command('your spotlight reset', () => spotlightReset('/', ${dryRun})); }
catch(e) { ui.error(e.message); process.exitCode=1; }`;
  try {
    const result = await new Promise<{ code: number; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", source],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              PATH: `${dir}:${process.env.PATH}`,
              NO_COLOR: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "";
        child.stdout.on("data", (data) => {
          output += data;
        });
        child.stderr.on("data", (data) => {
          output += data;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, output }));
      },
    );
    return {
      ...result,
      calls: await fs.readFile(calls, "utf8").catch(() => ""),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("Spotlight success keeps one step list and a compact result instead of a raw replay", async () => {
  const result = await runSpotlight();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /6 completed/);
  assert.doesNotMatch(result.output, /RAW_INDEX_OUTPUT|\[ok\]|sudo -n mdutil/);
  assert.match(result.output, /Indexing.*enabled/i);
  assert.match(result.output, /\n  .*Next commands\n    your spotlight status/);
});

test("Spotlight dry-run output never claims the reset occurred and runs no sudo/mdutil", async () => {
  const result = await runSpotlight(true);
  assert.equal(result.code, 0, result.output);
  assert.equal(result.calls, "");
  assert.doesNotMatch(
    result.output,
    /reset triggered|✓ .*Disabling|✓ .*Erasing/,
  );
  assert.match(result.output, /preview|would/i);
});

test("Spotlight failures preserve stderr even alongside stdout and stop later reset steps", async () => {
  const result = await runSpotlight(false, true);
  assert.equal(result.code, 1);
  assert.match(result.output, /Permission denied during disable/);
  assert.doesNotMatch(result.calls, /mdutil -E|mdutil -i on/);
});

test("caught Spotlight precheck failures keep the authentication reason visible", async () => {
  const result = await runSpotlight(false, false, true);
  assert.equal(result.code, 1);
  assert.match(
    result.output,
    /Administrator authentication required in non-interactive session/,
  );
  assert.doesNotMatch(result.calls, /mdutil/);
});
