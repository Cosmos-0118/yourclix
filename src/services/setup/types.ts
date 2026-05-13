export type SetupProfile = "minimal" | "webdev" | "full";
export type AppsMode = "none" | "minimal" | "webdev" | "full";
export type StepStatus = "success" | "partial" | "failed" | "skipped";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface SetupOptions {
  fast?: boolean;
  dryRun?: boolean;
  apps?: boolean;
  profile?: SetupProfile;
  appMode?: AppsMode;
  config?: string;
  debug?: boolean;
}

export interface SetupConfig {
  profile?: SetupProfile;
  appMode?: AppsMode;
  coreFormulae?: string[];
  shellFormulae?: string[];
  extraCliFormulae?: string[];
  casks?: string[];
}

export interface EffectiveSetupConfig {
  profile: SetupProfile;
  appMode: AppsMode;
  coreFormulae: string[];
  shellFormulae: string[];
  extraCliFormulae: string[];
  casks: string[];
  fast: boolean;
  dryRun: boolean;
  debug: boolean;
}

export interface StepResult {
  name: string;
  status: StepStatus;
  details: string[];
}

export interface SetupLogger {
  path: string;
  log: (level: LogLevel, message: string) => Promise<void>;
}

export interface InstallTarget {
  name: string;
  type: "formula" | "cask";
}

export interface ShellBlockConfig {
  shell: "zsh" | "bash" | "fish";
  filePath: string;
  blockStart: string;
  blockEnd: string;
  lines: string[];
}
