import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { runCommand } from "../core/exec.js";
import { CommandProgress } from "../core/progress.js";
import { confirm } from "../core/prompt.js";
import { removePath } from "../core/fs-utils.js";

const BASE_PRIVACY_TARGETS = [
  "~/Library/Application Support/com.apple.sharedfilelist",
];

const BROWSER_TARGETS: Record<string, string[]> = {
  chrome: ["~/Library/Caches/Google/Chrome/Default/Cache"],
  brave: ["~/Library/Caches/BraveSoftware/Brave-Browser/Default/Cache"],
  edge: ["~/Library/Caches/com.microsoft.edgemac"],
  firefox: ["~/Library/Caches/Firefox/Profiles"],
  safari: ["~/Library/Safari/History.db", "~/Library/Caches/com.apple.Safari"],
};

const BROWSER_APP_PATHS: Record<string, string> = {
  chrome: "/Applications/Google Chrome.app",
  brave: "/Applications/Brave Browser.app",
  edge: "/Applications/Microsoft Edge.app",
  firefox: "/Applications/Firefox.app",
  safari: "/Applications/Safari.app",
};

async function detectInstalledBrowsers(): Promise<string[]> {
  const detected: string[] = [];
  for (const [browser, appPath] of Object.entries(BROWSER_APP_PATHS)) {
    const probe = await runCommand("test", ["-d", appPath], {
      allowFailure: true,
    });

    if (probe.code === 0) {
      detected.push(browser);
    }
  }

  return detected;
}

async function isSafariRunning(): Promise<boolean> {
  const probe = await runCommand("pgrep", ["-x", "Safari"], {
    allowFailure: true,
  });
  return probe.code === 0;
}

function expandTargets(targets: string[]): string[] {
  return targets.map((target) =>
    target.replace("~", os.homedir()).replace("~/", `${os.homedir()}/`),
  );
}

export async function privacyClean(dryRun = false, yes = false): Promise<void> {
  const progress = new CommandProgress("Privacy Cleanup", 3);
  console.log(chalk.bold("Privacy cleanup targets:"));

  const browsers = await progress.step("Detecting installed browsers", async () =>
    detectInstalledBrowsers(),
  );

  const targets = [...BASE_PRIVACY_TARGETS];
  for (const browser of browsers) {
    targets.push(...(BROWSER_TARGETS[browser] ?? []));
  }

  const safariRunning = await progress.step("Checking Safari process state", async () =>
    isSafariRunning(),
  );

  if (safariRunning) {
    console.log(
      chalk.yellow(
        "Safari appears to be running. Safari history cleanup targets will be skipped for safety.",
      ),
    );
  }

  const expanded = expandTargets(
    targets.filter((target) => !safariRunning || !target.includes("/Safari/History.db")),
  );

  for (const target of expanded) {
    console.log(`- ${target}`);
  }

  const approved = await confirm("Proceed with privacy cleanup?", yes);
  if (!approved) {
    console.log(chalk.yellow("Cancelled by user."));
    return;
  }

  await progress.step(
    `Removing ${expanded.length} privacy targets`,
    async () => {
      for (const target of expanded) {
        await removePath(path.resolve(target), dryRun);
      }
    },
  );

  progress.tick("Finalizing cleanup");

  console.log(
    chalk.green(`Privacy cleanup complete${dryRun ? " (dry-run)" : ""}.`),
  );
}
