import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

async function installFixture(dryRun = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "your-install-ui-"));
  const calls = path.join(dir, "calls.txt");
  const log = path.join(dir, "setup.log");
  await fs.writeFile(path.join(dir, "package.json"), '{"type":"module"}');
  await fs.writeFile(
    path.join(dir, "brew"),
    `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, args.join(' ')+'\\n');
if(args[0]==='list') { if(args.includes('existing')) console.log('existing 1.0'); else process.exitCode=1; }
else if(args.includes('broken')) { console.error('Download checksum mismatch'); process.exitCode=1; }
else console.log('RAW_SUCCESS_OUTPUT');
`,
    { mode: 0o755 },
  );
  const source = `import fs from 'node:fs';
import { installBatch } from './src/services/setup/install.ts';
await installBatch('Packages', ['existing','fresh','broken'].map(name=>({name,type:'formula'})),
{dryRun:${dryRun}}, {log:async(level,message)=>fs.appendFileSync(${JSON.stringify(log)},message+'\\n')});`;
  try {
    const output = await new Promise<string>((resolve, reject) => {
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
      let transcript = "";
      child.stdout.on("data", (data) => {
        transcript += data;
      });
      child.stderr.on("data", (data) => {
        transcript += data;
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(transcript) : reject(new Error(transcript)),
      );
    });
    return {
      output,
      calls: await fs.readFile(calls, "utf8"),
      log: await fs.readFile(log, "utf8"),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("package installation renders one outcome, keeps diagnostics, and logs successful raw output", async () => {
  const result = await installFixture();
  assert.equal((result.output.match(/✓ .*Install fresh/g) ?? []).length, 1);
  assert.doesNotMatch(
    result.output,
    /RAW_SUCCESS_OUTPUT|Checking fresh|Installed fresh/,
  );
  assert.match(result.log, /RAW_SUCCESS_OUTPUT/);
  assert.match(result.output, /✗ .*Install broken/);
  assert.match(result.output, /Download checksum mismatch/);
  assert.match(result.output, /already installed/i);
});

test("installation preview shows planned work without success claims or install calls", async () => {
  const result = await installFixture(true);
  assert.doesNotMatch(result.calls, /^install/m);
  assert.doesNotMatch(result.output, /✓ .*Install/);
  assert.match(result.output, /Would install fresh/);
});
