import { Command } from "commander";
import { registerSetup } from "./setup/setup.js";
import { registerClean } from "./clean/clean.js";
import { registerNet } from "./net/net.js";
import { registerSpotlight } from "./spotlight/spotlight.js";
import { registerBrew } from "./brew/brew.js";
import { registerDoctor } from "./doctor/doctor.js";
import { registerFix } from "./fix/fix.js";
import { registerDev } from "./dev/dev.js";
import { registerSpace } from "./space/space.js";
import { registerPrivacy } from "./privacy/privacy.js";
import { registerStartup } from "./startup/startup.js";
import { registerPlugin } from "./plugin/plugin.js";
import { registerCompletion } from "./completion/completion.js";
import { registerTerminal } from "./terminal/terminal.js";
import { registerBackup } from "./backup/backup.js";
import { registerUndo } from "./undo/undo.js";

export function registerCommands(program: Command): void {
  registerSetup(program);
  registerClean(program);
  registerNet(program);
  registerSpotlight(program);
  registerBrew(program);
  registerDoctor(program);
  registerFix(program);
  registerDev(program);
  registerSpace(program);
  registerPrivacy(program);
  registerStartup(program);
  registerPlugin(program);
  registerCompletion(program);
  registerTerminal(program);
  registerBackup(program);
  registerUndo(program);
}
