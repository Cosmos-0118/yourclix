export type RunLevel = "basic" | "deep" | "system";

export interface GlobalOptions {
  dryRun?: boolean;
  yes?: boolean;
}

export interface CleanerOptions extends GlobalOptions {
  mode: RunLevel;
  olderThanDays?: number;
  /** Show full filesystem paths in skipped-item output */
  verbose?: boolean;
}

export interface FixContext {
  /** Exact paths diagnosed for remediation (e.g. broken symlinks). */
  brokenSymlinkPaths?: string[];
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  command?: string;
  severity?: "info" | "warn" | "critical";
  recommendedCommand?: string;
  safeToFix: boolean;
  /** Optional structured data so `your fix` applies the same scope as diagnosis. */
  fixContext?: FixContext;
}

export interface ScanResult {
  category: string;
  paths: string[];
  bytes: number;
}

export interface UndoOptions extends GlobalOptions {
  id?: string;
  retentionDays?: number;
}
