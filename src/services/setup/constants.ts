import type { AppsMode } from "./types.js";

export const CORE_FORMULAE = ["git", "node", "python", "pnpm", "oven-sh/bun/bun"];
export const SHELL_FORMULAE = [
  "zsh-autosuggestions",
  "zsh-syntax-highlighting",
  "starship",
];
export const EXTRA_CLI_FORMULAE = [
  "jq",
  "ripgrep",
  "fd",
  "fzf",
  "htop",
  "gh",
  "awscli",
  "kubectl",
];

export const APP_BUNDLES: Record<AppsMode, string[]> = {
  none: [],
  minimal: ["visual-studio-code", "google-chrome"],
  webdev: [
    "visual-studio-code",
    "google-chrome",
    "firefox",
    "docker",
    "postman",
    "raycast",
  ],
  full: [
    "visual-studio-code",
    "google-chrome",
    "firefox",
    "iterm2",
    "docker",
    "postman",
    "slack",
    "notion",
    "rectangle",
    "raycast",
  ],
};

/** Friendly names for Homebrew casks (shown before install confirmation). */
export const CASK_LABELS: Record<string, string> = {
  "visual-studio-code": "Visual Studio Code",
  "google-chrome": "Google Chrome",
  firefox: "Mozilla Firefox",
  docker: "Docker Desktop",
  postman: "Postman",
  raycast: "Raycast",
  iterm2: "iTerm2",
  slack: "Slack",
  notion: "Notion",
  rectangle: "Rectangle",
};

export const ZSH_SETUP_BLOCK_START = "# >>> setup.ts managed block >>>";
export const ZSH_SETUP_BLOCK_END = "# <<< setup.ts managed block <<<";
export const BASH_SETUP_BLOCK_START = "# >>> setup.ts managed block >>>";
export const BASH_SETUP_BLOCK_END = "# <<< setup.ts managed block <<<";
export const FISH_SETUP_BLOCK_START = "# >>> setup.ts managed block >>>";
export const FISH_SETUP_BLOCK_END = "# <<< setup.ts managed block <<<";
