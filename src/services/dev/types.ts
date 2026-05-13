export interface CleanupTargetInfo {
  path: string;
  bytes: number;
  category: "node_modules" | "xcode_derived_data" | "other";
}

export interface DevResetPlan {
  brewPackage: string;
  verifyCommand: string;
  verifyArgs: string[];
}

export interface ProtectedTargetsFilter {
  filtered: string[];
  skippedProtected: number;
}
