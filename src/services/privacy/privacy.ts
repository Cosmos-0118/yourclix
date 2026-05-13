import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { ActionableError } from "../../core/actionable-error.js";
import { runCommand } from "../../core/exec.js";
import { CommandProgress } from "../../core/progress.js";
import { confirm } from "../../core/prompt.js";
import { removePath } from "../../core/fs-utils.js";

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
  const progress = new CommandProgress("Privacy Cleanup", 4);
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
      const blocked: string[] = [];
      const failed: string[] = [];

      for (const target of expanded) {
        const absoluteTarget = path.resolve(target);

        try {
          await removePath(absoluteTarget, dryRun);
        } catch (error) {
          const errno = error as NodeJS.ErrnoException;
          if (errno.code === "EPERM" || errno.code === "EACCES") {
            blocked.push(absoluteTarget);
            continue;
          }

          failed.push(`${absoluteTarget}: ${errno.message}`);
        }
      }

      if (blocked.length > 0 || failed.length > 0) {
        const details: string[] = [];

        if (blocked.length > 0) {
          details.push(
            `Permission denied for ${blocked.length} target(s):`,
            ...blocked.map((target) => `  ${target}`),
          );
        }

        if (failed.length > 0) {
          details.push("Failed to remove:", ...failed.map((entry) => `  ${entry}`));
        }

        throw new ActionableError({
          code: "PRIVACY_CLEAN_PARTIAL",
          summary: "Privacy cleanup completed with blocked targets.",
          details,
          nextSteps: [
            "Run the command again after closing related apps.",
            "Grant Full Disk Access to your terminal app in System Settings > Privacy & Security > Full Disk Access.",
            "Re-run: your privacy clean --yes",
          ],
        });
      }
    },
  );

  progress.tick("Finalizing cleanup");

  console.log(
    chalk.green(`Privacy cleanup complete${dryRun ? " (dry-run)" : ""}.`),
  );
}
