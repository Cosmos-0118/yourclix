import { Command } from "commander";
import { registerSetup } from "./setup.js";
import { registerClean } from "./clean.js";
import { registerNet } from "./net.js";
import { registerSpotlight } from "./spotlight.js";
import { registerBrew } from "./brew.js";
import { registerDoctor } from "./doctor.js";
import { registerFix } from "./fix.js";
import { registerDev } from "./dev.js";
import { registerSpace } from "./space.js";
import { registerPrivacy } from "./privacy.js";
import { registerStartup } from "./startup.js";
import { registerPlugin } from "./plugin.js";
import { registerCompletion } from "./completion.js";

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
}
