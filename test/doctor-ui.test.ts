import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("critical doctor findings preserve recovery guidance without becoming failed operations", () => {
  const source = `import { ui } from './src/core/ui.ts';
import { printDoctorSummary } from './src/managers/doctor-manager.ts';
ui.start('your doctor');
printDoctorSummary({issues:[{title:'Low disk space',description:'Free space is below threshold.',severity:'critical',safeToFix:false,recommendedCommand:'your space'}],largeDirectories:[],developerCaches:[],diskFreePercent:3});
ui.finish();`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source],
    {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Critical: Low disk space/);
  assert.match(result.stdout, /Next: your space/);
  assert.match(result.stdout, /✓ Done\./);
  assert.doesNotMatch(result.stdout, /Finished with unresolved/);
});
