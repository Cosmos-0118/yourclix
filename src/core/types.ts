export type RunLevel = "basic" | "deep" | "system";

export interface GlobalOptions {
  dryRun?: boolean;
  yes?: boolean;
}

export interface CleanerOptions extends GlobalOptions {
  mode: RunLevel;
  olderThanDays?: number;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  command?: string;
  severity?: "info" | "warn" | "critical";
  recommendedCommand?: string;
  safeToFix: boolean;
}

export interface ScanResult {
  category: string;
  paths: string[];
  bytes: number;
}
