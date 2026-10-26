import os from "node:os";
import path from "node:path";
import fg from "fast-glob";
import type { RunLevel } from "../core/types.js";

export interface CleanerScanContext {
  home?: string;
  tmpDir?: string;
}

export interface ScanCategory {
  category: string;
  risky: boolean;
  system?: boolean;
  managedBy?: "uv" | "gradle";
  globs: string[];
}

/** Never turn an arbitrary TMPDIR (or its parent) into a cleanup root. */
export function isTrustedTemporaryRoot(tmpDir: string): boolean {
  const resolved = path.resolve(tmpDir);
  return (
    resolved === "/tmp" ||
    resolved === "/private/tmp" ||
    /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T$/.test(resolved)
  );
}

const projectRoots = [
  "Developer",
  "Projects",
  "Code",
  "Work",
  "GitHub",
  "dev",
  "Repos",
  "workspace",
  "Workspaces",
];
const projectCaches = [
  "coverage",
  ".vite",
  ".cache",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".next/cache",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
];
const chromiumBrowsers = [
  "Google/Chrome",
  "Google/Chrome Beta",
  "Chromium",
  "BraveSoftware/Brave-Browser",
  "Microsoft Edge",
  "Vivaldi",
];
const electronApps = [
  "Code",
  "Code - Insiders",
  "Cursor",
  "Antigravity",
  "Claude",
  "Codex",
  "com.openai.codex",
  "Electron",
  "Slack",
  "discord",
];
// Explicit Chromium/Electron disposable leaves, never profile/session stores.
const electronCaches = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
];

export function getCleanerScanCategories(
  mode: RunLevel,
  context: CleanerScanContext = {},
): ScanCategory[] {
  const home = context.home ?? os.homedir();
  const tmpDir = context.tmpDir ?? os.tmpdir();
  const j = (target: string) =>
    `${fg.escapePath(path.resolve(home))}/${target}`;
  const tmp = isTrustedTemporaryRoot(tmpDir)
    ? `${fg.escapePath(path.resolve(tmpDir))}/*`
    : undefined;
  const categories: ScanCategory[] = [
    { category: "User Cache", risky: false, globs: [j("Library/Caches/*")] },
    {
      category: "App Container Cache",
      risky: false,
      globs: [
        j("Library/Containers/*/Data/Library/Caches/*"),
        j("Library/Group Containers/*/Library/Caches/*"),
      ],
    },
    {
      category: "User Logs",
      risky: false,
      globs: [
        j("Library/Logs/*"),
        j("Library/Containers/*/Data/Library/Logs/*"),
      ],
    },
    {
      category: "Browser Caches",
      risky: false,
      globs: [
        ...chromiumBrowsers.flatMap((browser) =>
          electronCaches.map((cache) =>
            j(
              `Library/Application Support/${browser}/{Default,Profile *}/${cache}/*`,
            ),
          ),
        ),
        ...electronCaches.map((cache) =>
          j(`Library/Application Support/com.operasoftware.Opera/${cache}/*`),
        ),
        j("Library/Application Support/Firefox/Profiles/*/cache2/*"),
        j("Library/Safari/Favicon Cache/*"),
      ],
    },
    {
      category: "Node and JS Caches",
      risky: false,
      globs: [
        j(".npm/_cacache/*"),
        j(".npm/_logs/*"),
        j(".pnpm-store/*"),
        j("Library/pnpm/store/*"),
        j(".yarn/cache/*"),
        j(".cache/yarn/*"),
        j(".cache/node-gyp/*"),
        j(".cache/esbuild/*"),
        j(".cache/webpack/*"),
        j(".cache/vite/*"),
        j(".cache/nx/*"),
      ],
    },
    {
      category: "Bun Package Cache",
      risky: true,
      globs: [j(".bun/install/cache/*")],
    },
    { category: "npx Package Cache", risky: true, globs: [j(".npm/_npx/*")] },
    {
      category: "Python and Build Tool Caches",
      risky: false,
      globs: [
        j(".cache/pip/*"),
        j("Library/Caches/pip/*"),
        j("Library/Caches/pypoetry/*"),
        j("Library/Caches/pipenv/*"),
        j(".ivy2/cache/*"),
        j(".cache/sbt/*"),
        j(".cache/bazel/*"),
        j(".carthage/Cache/*"),
        j("Library/Caches/CocoaPods/*"),
        j("Library/Caches/org.carthage.CarthageKit/*"),
      ],
    },
    {
      category: "uv Cache",
      risky: false,
      managedBy: "uv",
      globs: [j(".cache/uv"), j("Library/Caches/uv")],
    },
    {
      category: "Gradle Managed Cache",
      risky: false,
      managedBy: "gradle",
      globs: [j(".gradle/caches")],
    },
    {
      category: "Gradle Temporary Files",
      risky: true,
      globs: [j(".gradle/.tmp/*"), j(".gradle/daemon/*/*.out.log")],
    },
    {
      category: "Android Download Cache",
      risky: false,
      globs: [j(".android/cache/*")],
    },
    {
      category: "Rust and Go Caches",
      risky: false,
      globs: [
        j(".cargo/registry/cache/*"),
        j(".cache/go-build/*"),
        j("go/pkg/mod/cache/download/*"),
      ],
    },
    {
      category: "Xcode and Simulator Caches",
      risky: false,
      globs: [
        j("Library/Developer/Xcode/DerivedData/*"),
        j("Library/Developer/Xcode/Logs/*"),
        j("Library/Developer/CoreSimulator/Caches/*"),
        j("Library/Developer/CoreSimulator/Logs/*"),
        j("Library/Developer/CoreSimulator/Devices/*/data/Library/Caches/*"),
      ],
    },
    {
      category: "Editor and App Caches",
      risky: false,
      globs: [
        ...electronApps.flatMap((app) =>
          electronCaches.map((cache) =>
            j(`Library/Application Support/${app}/${cache}/*`),
          ),
        ),
        ...["Code", "Code - Insiders", "Cursor", "Antigravity"].flatMap(
          (app) => [
            j(`Library/Application Support/${app}/CachedData/*`),
            j(`Library/Application Support/${app}/logs/*`),
          ],
        ),
      ],
    },
    {
      category: "Package Manager Artifacts",
      risky: false,
      globs: [
        j("Library/Logs/Homebrew/*"),
        j(".cache/Homebrew/*"),
        j("Library/Caches/composer/*"),
        j(".composer/cache/*"),
        j(".gem/cache/*"),
      ],
    },
    // Credential and authentication token caches are deliberately excluded.
    {
      category: "Cloud CLI Logs",
      risky: false,
      globs: [
        j(".config/gcloud/logs/*"),
        j(".config/gcloud/access_logs/*"),
        j(".config/gcloud/legacy_logs/*"),
      ],
    },
    {
      category: "Container Download Caches",
      risky: false,
      globs: [
        j("Library/Caches/com.docker.docker/*"),
        j("Library/Logs/Docker Desktop/*"),
        j(".colima/_cache/*"),
      ],
    },
    {
      category: "Temporary Workspace Data",
      risky: true,
      globs: [
        j("Library/Application Support/CrashReporter/*"),
        ...(tmp ? [tmp] : []),
      ],
    },
    {
      category: "Developer Project Caches",
      risky: true,
      globs: projectRoots.flatMap((root) =>
        projectCaches.map((cache) => j(`${root}/**/${cache}`)),
      ),
    },
    { category: "Trash", risky: true, globs: [j(".Trash/*")] },
    {
      category: "System Diagnostic Reports",
      risky: true,
      system: true,
      globs: [
        "/Library/Logs/DiagnosticReports/*.crash",
        "/Library/Logs/DiagnosticReports/*.ips",
      ],
    },
  ];
  return categories.filter((entry) =>
    mode === "basic"
      ? !entry.risky && !entry.system
      : mode === "deep"
        ? !entry.system
        : true,
  );
}

/** Avoid walking dependencies, VCS data, runtimes, and backups for project caches. */
export function getCleanerScanIgnores(home = os.homedir()): string[] {
  const h = fg.escapePath(path.resolve(home));
  return [
    "**/node_modules/**",
    "**/.git/**",
    "**/.venv/**",
    "**/venv/**",
    "**/.your-backups/**",
    `${h}/.your/**`,
  ];
}
