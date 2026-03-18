export type NetworkStepStatus = "success" | "failed" | "skipped";

export interface NetworkStepResult {
  name: string;
  status: NetworkStepStatus;
  critical: boolean;
  details: string[];
}

export interface NetworkLogger {
  path: string;
  log: (message: string) => Promise<void>;
}

export interface NetworkRunOptions {
  dryRun: boolean;
  yes: boolean;
}
