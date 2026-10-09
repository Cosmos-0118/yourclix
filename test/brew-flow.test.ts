import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { CliUI } from "../src/core/ui.js";
import {
  brewOptimize,
  brewUpgrade,
  brewDoctor,
} from "../src/services/brew/brew.js";
import { parseInstalledBrewPackages } from "../src/managers/brew-issues.js";

// Substitute only the external package manager; run the real services/renderer.
async function fixture(
  options: {
    disabled?: boolean;
    dependents?: string[];
    caskError?: boolean;
    badMetadata?: boolean;
    interactive?: boolean;
    repairFails?: boolean;
    removeFails?: boolean;
    dependencyCheckFails?: boolean;
    unchangedPackage?: string;
    sameNameCask?: boolean;
    unchangedKind?: "formula" | "cask";
  } = {},
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "your-brew-test-"));
  const log = path.join(dir, "calls.jsonl");
  const script = `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n');
const options = ${JSON.stringify(options)};
const calls = fs.readFileSync(${JSON.stringify(log)},'utf8').trim().split('\\n').map(line=>JSON.parse(line));
const completed = (name,kind) => calls.some(call => call.includes('--'+kind) && call.includes(name) && ((call[0]==='upgrade' && !(name===options.unchangedPackage && (!options.unchangedKind || kind===options.unchangedKind)) && name!=='monolingual') || (call[0]==='uninstall' && !options.removeFails) || (call[0]==='reinstall' && !options.repairFails)));
const formula = { name:'python@3.10', full_name:'python@3.10', deprecated:!options.disabled, disabled:!!options.disabled, deprecation_reason:'unsupported', disable_reason:'unsupported', installed:[{version:'3.10.0'}] };
if (args[0]==='info') { console.log(options.badMetadata ? 'invalid json' : JSON.stringify({formulae:[formula],casks:[]})); }
else if (args[0]==='outdated') console.log(JSON.stringify({formulae:[{name:'python@3.10'},{name:'git'}].filter(pkg=>!completed(pkg.name,'formula')),casks:[...(options.caskError ? [{name:'monolingual'}] : []),...(options.sameNameCask ? [{name:'python@3.10'}] : [])].filter(pkg=>!completed(pkg.name,'cask'))}));
else if (args[0]==='uses') { console.log((options.dependents ?? []).join('\\n')); if(options.dependencyCheckFails) { console.error('Error: dependency metadata unavailable'); process.exitCode=1; } }
else if (args[0]==='doctor') { console.error('Warning: Some installed formulae are deprecated or disabled.\\npython@3.10'); process.exitCode=1; }
else if (args[0]==='upgrade' && args.includes('monolingual')) { console.error("Error: monolingual: It seems the App source '/Applications/Monolingual.app' is not there."); process.exitCode=1; }
else if ((args[0]==='reinstall' && options.repairFails) || (args[0]==='uninstall' && options.removeFails)) { console.error('Error: permission denied'); process.exitCode=1; }
else console.log('Completed '+args.join(' '));
`;
  await fs.writeFile(path.join(dir, "brew"), script, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}:${previousPath}`;
  const output = Object.assign(new PassThrough(), {
    isTTY: Boolean(options.interactive),
    columns: 80,
  });
  let transcript = "";
  output.on("data", (data) => {
    transcript += data.toString();
  });
  const terminal = new CliUI({
    output,
    input: Object.assign(new PassThrough(), {
      isTTY: Boolean(options.interactive),
    }),
    errorOutput: output,
    env: {},
  });
  return {
    terminal,
    read: () => transcript,
    calls: async () =>
      (await fs.readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
    cleanup: async () => {
      process.env.PATH = previousPath;
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

test("installed metadata preserves package lifecycle and rejects malformed package lists", () => {
  assert.deepEqual(
    parseInstalledBrewPackages(
      JSON.stringify({
        formulae: [
          {
            name: "python@3.10",
            deprecated: true,
            disabled: false,
            deprecation_reason: "unsupported",
          },
        ],
        casks: [
          {
            token: "old-app",
            deprecated: false,
            disabled: true,
            disable_reason: "discontinued",
          },
        ],
      }),
    ).map((pkg) => [pkg.name, pkg.kind, pkg.reason]),
    [
      ["python@3.10", "formula", "unsupported"],
      ["old-app", "cask", "discontinued"],
    ],
  );
  assert.throws(
    () => parseInstalledBrewPackages('{"formulae":"oops","casks":[]}'),
    /invalid/i,
  );
  assert.throws(
    () => parseInstalledBrewPackages('{"formulae":[{}],"casks":[]}'),
    /invalid/i,
  );
});

test("noninteractive deprecated packages are kept, disabled packages are excluded from upgrades", async () => {
  const f = await fixture({ disabled: true });
  try {
    await brewUpgrade(false, false, false, f.terminal);
    const calls = await f.calls();
    assert.equal(
      calls.some((args) => args[0] === "uninstall"),
      false,
    );
    assert.equal(
      calls.some(
        (args) => args[0] === "upgrade" && args.includes("python@3.10"),
      ),
      false,
    );
    assert.equal(
      calls.some((args) => args[0] === "upgrade" && args.includes("git")),
      true,
    );
    assert.match(f.read(), /disabled/);
  } finally {
    await f.cleanup();
  }
});

test("approved removal uses ordinary Homebrew uninstall", async () => {
  const f = await fixture({ interactive: true });
  f.terminal.confirm = async () => true;
  try {
    await brewDoctor(false, f.terminal);
    const calls = await f.calls();
    assert.deepEqual(
      calls.find((args) => args[0] === "uninstall"),
      ["uninstall", "--formula", "python@3.10"],
    );
  } finally {
    await f.cleanup();
  }
});

test("installed dependents prevent offering removal", async () => {
  const f = await fixture({ dependents: ["some-tool"], interactive: true });
  f.terminal.confirm = async () => {
    throw new Error("Removal must not be offered");
  };
  try {
    await brewDoctor(false, f.terminal);
    assert.equal(
      (await f.calls()).some((args) => args[0] === "uninstall"),
      false,
    );
    assert.match(f.read(), /some-tool/);
  } finally {
    await f.cleanup();
  }
});

test("optimize preserves cask diagnostics and still runs cleanup and final doctor", async () => {
  const f = await fixture({ caskError: true });
  try {
    await assert.rejects(
      brewOptimize(false, f.terminal),
      /monolingual|unresolved/i,
    );
    const calls = await f.calls();
    assert.equal(
      calls.some(
        (args) => args[0] === "cleanup" && !args.includes("--dry-run"),
      ),
      true,
    );
    assert.equal(calls.filter((args) => args[0] === "doctor").length, 2);
    assert.match(f.read(), /Monolingual\.app/);
    assert.match(f.read(), /reinstall.*monolingual/i);
  } finally {
    await f.cleanup();
  }
});

test("dry run never upgrades, removes, or repairs packages", async () => {
  const f = await fixture({ caskError: true });
  f.terminal.confirm = async () => {
    throw new Error("Dry run must not prompt to remove");
  };
  try {
    await brewOptimize(true, f.terminal);
    assert.equal(
      (await f.calls()).some(
        (args) =>
          ["upgrade", "uninstall", "reinstall", "update-if-needed"].includes(
            args[0],
          ) ||
          (args[0] === "cleanup" && !args.includes("--dry-run")),
      ),
      false,
    );
    assert.match(f.read(), /Would upgrade/);
  } finally {
    await f.cleanup();
  }
});

test("invalid installed metadata prevents upgrades instead of treating the query as empty", async () => {
  const f = await fixture({ badMetadata: true });
  try {
    await assert.rejects(
      brewUpgrade(false, false, false, f.terminal),
      /metadata|installed|JSON/i,
    );
    assert.equal(
      (await f.calls()).some((args) => args[0] === "upgrade"),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("declining removal keeps the deprecated package without blocking supported upgrades", async () => {
  const f = await fixture({ interactive: true });
  f.terminal.confirm = async () => false;
  try {
    await brewUpgrade(false, false, false, f.terminal);
    const calls = await f.calls();
    assert.equal(
      calls.some((args) => args[0] === "uninstall"),
      false,
    );
    assert.equal(
      calls.some(
        (args) => args[0] === "upgrade" && args.includes("python@3.10"),
      ),
      true,
    );
    assert.match(f.read(), /Keeping python@3\.10/);
  } finally {
    await f.cleanup();
  }
});

test("failed dependency checks preserve the package and never offer removal", async () => {
  const f = await fixture({ interactive: true, dependencyCheckFails: true });
  f.terminal.confirm = async () => {
    throw new Error("Removal must not be offered");
  };
  try {
    await brewDoctor(false, f.terminal);
    assert.equal(
      (await f.calls()).some((args) => args[0] === "uninstall"),
      false,
    );
    assert.match(f.read(), /dependency check failed/);
  } finally {
    await f.cleanup();
  }
});

test("missing cask reinstall succeeds without losing the original diagnostic", async () => {
  const f = await fixture({ interactive: true, caskError: true });
  f.terminal.confirm = async () => false;
  f.terminal.select = async () => "reinstall";
  try {
    await brewOptimize(false, f.terminal);
    assert.deepEqual(
      (await f.calls()).find((args) => args[0] === "reinstall"),
      ["reinstall", "--cask", "monolingual"],
    );
    assert.match(f.read(), /Monolingual\.app/);
    assert.match(f.read(), /0 unresolved failures/);
  } finally {
    await f.cleanup();
  }
});

test("failed cask repair remains a failure after cleanup", async () => {
  const f = await fixture({
    interactive: true,
    caskError: true,
    repairFails: true,
  });
  f.terminal.confirm = async () => false;
  f.terminal.select = async () => "reinstall";
  try {
    await assert.rejects(brewOptimize(false, f.terminal), /unresolved/i);
    assert.match(f.read(), /permission denied/);
    assert.equal(
      (await f.calls()).some((args) => args[0] === "cleanup"),
      true,
    );
  } finally {
    await f.cleanup();
  }
});

test("failed unsupported-package removal does not claim it was removed", async () => {
  const f = await fixture({ interactive: true, removeFails: true });
  f.terminal.confirm = async () => true;
  try {
    await assert.rejects(brewDoctor(false, f.terminal), /unresolved/i);
    assert.match(f.read(), /permission denied/);
  } finally {
    await f.cleanup();
  }
});

test("an exit-zero upgrade that leaves its package outdated is reported as unresolved", async () => {
  const f = await fixture({ unchangedPackage: "git" });
  try {
    await assert.rejects(
      brewUpgrade(false, false, false, f.terminal),
      /unresolved/i,
    );
    assert.match(f.read(), /git.*still outdated|still outdated.*git/i);
    assert.match(f.read(), /1 unresolved failure/);
  } finally {
    await f.cleanup();
  }
});

test("removing a formula does not skip an unrelated cask with the same token", async () => {
  const f = await fixture({ interactive: true, sameNameCask: true });
  f.terminal.confirm = async () => true;
  try {
    await brewUpgrade(false, false, false, f.terminal);
    const calls = await f.calls();
    assert.ok(
      calls.some(
        (args) =>
          args[0] === "upgrade" &&
          args.includes("--cask") &&
          args.includes("python@3.10"),
      ),
    );
  } finally {
    await f.cleanup();
  }
});

test("verification distinguishes an unchanged cask from its successfully upgraded same-name formula", async () => {
  const f = await fixture({
    sameNameCask: true,
    unchangedPackage: "python@3.10",
    unchangedKind: "cask",
  });
  try {
    await assert.rejects(
      brewUpgrade(false, false, false, f.terminal),
      /unresolved/i,
    );
    assert.match(f.read(), /1 unresolved failure/);
  } finally {
    await f.cleanup();
  }
});
