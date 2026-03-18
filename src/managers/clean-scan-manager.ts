import os from "node:os";
import path from "node:path";
import type { RunLevel } from "../core/types.js";

export interface ScanCategory {
  category: string;
  risky: boolean;
  system?: boolean;
  globs: string[];
}

function join(home: string, target: string): string {
  return path.join(home, target);
}

function filterByRunLevel(
  mode: RunLevel,
  categories: ScanCategory[],
): ScanCategory[] {
  return categories.filter((entry) => {
    if (mode === "basic") {
      return !entry.risky && !entry.system;
    }

    if (mode === "deep") {
      return !entry.system;
    }

    return true;
  });
}

export function getCleanerScanCategories(mode: RunLevel): ScanCategory[] {
  const home = os.homedir();
  const tmpDir = process.env.TMPDIR ?? "/tmp";

  const categories: ScanCategory[] = [
    {
      category: "User Cache",
      risky: false,
      globs: [join(home, "Library/Caches/*")],
    },
    {
      category: "App Container Cache",
      risky: false,
      globs: [
        join(home, "Library/Containers/*/Data/Library/Caches/*"),
        join(home, "Library/Group Containers/*/Library/Caches/*"),
      ],
    },
    {
      category: "User Logs",
      risky: false,
      globs: [
        join(home, "Library/Logs/*"),
        join(home, "Library/Containers/*/Data/Library/Logs/*"),
      ],
    },
    {
      category: "Trash",
      risky: false,
      globs: [join(home, ".Trash/*")],
    },
    {
      category: "Browser Caches",
      risky: false,
      globs: [
        join(home, "Library/Caches/Google/Chrome/*"),
        join(home, "Library/Caches/BraveSoftware/Brave-Browser/*"),
        join(home, "Library/Caches/com.microsoft.edgemac/*"),
        join(home, "Library/Caches/Mozilla/Firefox/*"),
        join(home, "Library/Application Support/Google/Chrome/Default/Cache/*"),
        join(
          home,
          "Library/Application Support/Google/Chrome/Default/Code Cache/*",
        ),
        join(
          home,
          "Library/Application Support/Google/Chrome/Default/GPUCache/*",
        ),
        join(
          home,
          "Library/Application Support/Google/Chrome/Default/Service Worker/CacheStorage/*",
        ),
        join(
          home,
          "Library/Application Support/BraveSoftware/Brave-Browser/Default/Cache/*",
        ),
        join(
          home,
          "Library/Application Support/BraveSoftware/Brave-Browser/Default/Code Cache/*",
        ),
        join(
          home,
          "Library/Application Support/BraveSoftware/Brave-Browser/Default/GPUCache/*",
        ),
        join(
          home,
          "Library/Application Support/Microsoft Edge/Default/Cache/*",
        ),
        join(
          home,
          "Library/Application Support/Microsoft Edge/Default/Code Cache/*",
        ),
        join(
          home,
          "Library/Application Support/Microsoft Edge/Default/GPUCache/*",
        ),
        join(home, "Library/Application Support/Firefox/Profiles/*/cache2/*"),
        join(
          home,
          "Library/Application Support/Firefox/Profiles/*/thumbnails/*",
        ),
        join(home, "Library/Caches/com.apple.Safari/*"),
        join(home, "Library/Safari/Favicon Cache/*"),
      ],
    },
    {
      category: "Node and JS Caches",
      risky: false,
      globs: [
        join(home, ".npm/_cacache/*"),
        join(home, ".pnpm-store/*"),
        join(home, "Library/pnpm/store/*"),
        join(home, ".yarn/cache/*"),
        join(home, ".cache/yarn/*"),
        join(home, ".cache/node-gyp/*"),
        join(home, ".cache/esbuild/*"),
        join(home, ".cache/webpack/*"),
        join(home, ".cache/vite/*"),
        join(home, ".cache/nx/*"),
      ],
    },
    {
      category: "Python and Build Tool Caches",
      risky: false,
      globs: [
        join(home, ".cache/pip/*"),
        join(home, "Library/Caches/pip/*"),
        join(home, "Library/Caches/pypoetry/*"),
        join(home, "Library/Caches/pipenv/*"),
        join(home, ".gradle/caches/*"),
        join(home, ".gradle/daemon/*"),
        join(home, ".gradle/native/*"),
        join(home, ".m2/repository/*"),
        join(home, ".ivy2/cache/*"),
        join(home, ".cache/sbt/*"),
        join(home, ".cache/bazel/*"),
        join(home, "Library/Caches/CocoaPods/*"),
        join(home, ".cocoapods/repos/*"),
        join(home, ".carthage/Cache/*"),
        join(home, "Library/Caches/org.carthage.CarthageKit/*"),
      ],
    },
    {
      category: "Rust and Go Caches",
      risky: false,
      globs: [
        join(home, ".cargo/registry/cache/*"),
        join(home, ".cargo/git/checkouts/*"),
        join(home, ".cache/go-build/*"),
        join(home, "go/pkg/mod/cache/*"),
      ],
    },
    {
      category: "Xcode and Simulator Caches",
      risky: false,
      globs: [
        join(home, "Library/Developer/Xcode/DerivedData/*"),
        join(home, "Library/Developer/Xcode/DerivedData/ModuleCache.noindex/*"),
        join(home, "Library/Developer/Xcode/Logs/*"),
        join(home, "Library/Developer/Xcode/Archives/*"),
        join(home, "Library/Developer/Xcode/iOS DeviceSupport/*"),
        join(home, "Library/Developer/Xcode/watchOS DeviceSupport/*"),
        join(home, "Library/Developer/CoreSimulator/Caches/*"),
        join(home, "Library/Developer/CoreSimulator/Logs/*"),
        join(
          home,
          "Library/Developer/CoreSimulator/Devices/*/data/Library/Caches/*",
        ),
        join(home, "Library/Developer/CoreSimulator/Profiles/Runtimes/*"),
        join(home, "Library/Caches/com.apple.dt.Xcode/*"),
      ],
    },
    {
      category: "Editor and Tooling Caches",
      risky: false,
      globs: [
        join(home, "Library/Application Support/Code/Cache/*"),
        join(home, "Library/Application Support/Code/CachedData/*"),
        join(home, "Library/Application Support/Code/Crashpad/completed/*"),
        join(
          home,
          "Library/Application Support/Code/Service Worker/CacheStorage/*",
        ),
        join(home, "Library/Application Support/Cursor/Cache/*"),
        join(home, "Library/Application Support/Cursor/CachedData/*"),
        join(home, "Library/Application Support/JetBrains/*/caches/*"),
        join(home, "Library/Application Support/JetBrains/*/index/*"),
        join(home, "Library/Caches/JetBrains/*"),
        join(home, "Library/Caches/com.microsoft.VSCode/*"),
      ],
    },
    {
      category: "Package Manager Artifacts",
      risky: false,
      globs: [
        join(home, "Library/Caches/Homebrew/*"),
        join(home, "Library/Logs/Homebrew/*"),
        join(home, ".cache/Homebrew/*"),
        join(home, "Library/Caches/composer/*"),
        join(home, ".composer/cache/*"),
        join(home, ".gem/cache/*"),
      ],
    },
    {
      category: "Cloud and CLI Caches",
      risky: false,
      globs: [
        join(home, ".aws/cli/cache/*"),
        join(home, ".azure/*/cache/*"),
        join(home, ".config/gcloud/logs/*"),
        join(home, ".config/gcloud/access_logs/*"),
        join(home, ".config/gcloud/legacy_logs/*"),
      ],
    },
    {
      category: "Container and VM Caches",
      risky: false,
      globs: [
        join(home, "Library/Caches/com.docker.docker/*"),
        join(home, "Library/Logs/Docker Desktop/*"),
        join(home, ".colima/_cache/*"),
        join(home, ".lima/*/cache/*"),
      ],
    },
    {
      category: "Temporary Workspace Data",
      risky: true,
      globs: [
        join(home, "Library/Application Support/CrashReporter/*"),
        join(home, "Library/Logs/DiagnosticReports/*"),
        join(home, "Library/Caches/com.apple.nsurlsessiond/*"),
        join(home, "Library/Caches/com.apple.finder/*"),
        path.join(tmpDir, "*"),
      ],
    },
    {
      category: "Temporary and Crash Data",
      risky: false,
      globs: [
        join(home, "Library/Caches/com.apple.Spotlight/*"),
        join(home, "Library/Caches/com.apple.quicklook.thumbnailcache/*"),
      ],
    },
    {
      category: "Developer Project Junk",
      risky: true,
      globs: [
        join(home, "Developer/**/node_modules"),
        join(home, "Projects/**/node_modules"),
        join(home, "Code/**/node_modules"),
        join(home, "Work/**/node_modules"),
        join(home, "Desktop/**/node_modules"),
        join(home, "Downloads/**/node_modules"),
        join(home, "**/dist"),
        join(home, "**/build"),
        join(home, "**/.cache"),
        join(home, "**/.parcel-cache"),
        join(home, "**/.svelte-kit"),
        join(home, "**/.turbo"),
        join(home, "**/.next/cache"),
        join(home, "**/__pycache__"),
        join(home, "**/.pytest_cache"),
        join(home, "**/.mypy_cache"),
      ],
    },
    {
      category: "App Media Caches",
      risky: false,
      globs: [
        join(home, "Library/Application Support/Slack/Cache/*"),
        join(home, "Library/Application Support/Slack/Code Cache/*"),
        join(home, "Library/Application Support/Slack/GPUCache/*"),
        join(home, "Library/Caches/com.tinyspeck.slackmacgap/*"),
        join(home, "Library/Application Support/discord/Cache/*"),
        join(home, "Library/Application Support/discord/Code Cache/*"),
        join(home, "Library/Application Support/discord/GPUCache/*"),
        join(home, "Library/Caches/com.spotify.client/*"),
        join(
          home,
          "Library/Application Support/Spotify/PersistentCache/Storage/*",
        ),
      ],
    },
    {
      category: "Communications Attachments",
      risky: true,
      globs: [
        join(home, "Library/Messages/Attachments/*"),
        join(
          home,
          "Library/Containers/com.apple.mail/Data/Library/Mail Downloads/*",
        ),
        join(home, "Library/Mail/Attachments/*"),
      ],
    },
    {
      category: "iOS and Device Backups",
      risky: true,
      globs: [join(home, "Library/Application Support/MobileSync/Backup/*")],
    },
    {
      category: "System Logs and Temp",
      risky: true,
      system: true,
      globs: [
        path.join("/", "Library/Logs/*"),
        path.join("/", "private/var/log/*"),
        path.join(tmpDir, "..", "C", "com.apple.QuickLook.thumbnailcache/*"),
      ],
    },
  ];

  return filterByRunLevel(mode, categories);
}
