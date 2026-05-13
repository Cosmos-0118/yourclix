import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { runCommand } from "../../core/exec.js";
import { CommandProgress } from "../../core/progress.js";

interface PluginManifest {
  installed: string[];
}

const pluginDir = path.join(os.homedir(), ".your", "plugins");
const manifestPath = path.join(pluginDir, "plugins.json");

async function loadManifest(): Promise<PluginManifest> {
  try {
    const content = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(content) as PluginManifest;
  } catch {
    return { installed: [] };
  }
}

async function saveManifest(manifest: PluginManifest): Promise<void> {
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export async function listPlugins(): Promise<void> {
  const progress = new CommandProgress("Plugin Manager", 1);
  const manifest = await progress.step("Loading plugin manifest", async () =>
    loadManifest(),
  );

  if (manifest.installed.length === 0) {
    console.log(chalk.yellow("No plugins installed."));
    return;
  }

  console.log(chalk.bold("Installed plugins:"));
  for (const plugin of manifest.installed) {
    console.log(`- ${plugin}`);
  }
}

export async function searchPlugins(query: string): Promise<void> {
  const progress = new CommandProgress("Plugin Manager", 1);
  const result = await progress.step(`Searching plugins for '${query}'`, async () =>
    runCommand("npm", ["search", "--parseable", query], {
      allowFailure: true,
    }),
  );

  const rows = (result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("your-plugin-"));

  if (rows.length === 0) {
    console.log(chalk.yellow(`No matching plugins found for '${query}'.`));
    return;
  }

  console.log(chalk.bold("Matching plugins:"));
  for (const row of rows.slice(0, 10)) {
    const [name, description] = row.split(":", 2);
    console.log(`- ${name}${description ? `: ${description}` : ""}`);
  }
}

export async function installPlugin(
  name: string,
  dryRun = false,
): Promise<void> {
  const progress = new CommandProgress("Plugin Manager", 3);
  const packageName =
    name.startsWith("your-plugin-") ? name : `your-plugin-${name}`;
  await progress.step(`Installing plugin package ${packageName}`, async () =>
    runCommand("npm", ["install", "-g", packageName], {
      dryRun,
      allowFailure: true,
    }),
  );

  const manifest = await progress.step("Loading plugin manifest", async () =>
    loadManifest(),
  );
  if (!manifest.installed.includes(packageName)) {
    manifest.installed.push(packageName);
    if (!dryRun) {
      await progress.step("Saving plugin manifest", async () =>
        saveManifest(manifest),
      );
    } else {
      progress.tick("Skipping manifest write (dry-run)");
    }
  } else {
    progress.tick("Plugin already recorded in manifest");
  }

  console.log(chalk.green(`Plugin installed: ${packageName}`));
}

export async function removePlugin(
  name: string,
  dryRun = false,
): Promise<void> {
  const progress = new CommandProgress("Plugin Manager", 3);
  const packageName =
    name.startsWith("your-plugin-") ? name : `your-plugin-${name}`;
  await progress.step(`Removing plugin package ${packageName}`, async () =>
    runCommand("npm", ["remove", "-g", packageName], {
      dryRun,
      allowFailure: true,
    }),
  );

  const manifest = await progress.step("Loading plugin manifest", async () =>
    loadManifest(),
  );
  manifest.installed = manifest.installed.filter(
    (plugin) => plugin !== packageName,
  );
  if (!dryRun) {
    await progress.step("Saving plugin manifest", async () =>
      saveManifest(manifest),
    );
  } else {
    progress.tick("Skipping manifest write (dry-run)");
  }

  console.log(chalk.green(`Plugin removed: ${packageName}`));
}
