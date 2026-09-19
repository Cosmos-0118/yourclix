import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../../core/exec.js";

/**
 * Generated-looking names are not proof that a directory is disposable. A
 * project may intentionally commit dist/, build/, or target/ as release
 * inputs. If the artifact belongs to a Git worktree and contains tracked
 * files, fail closed and leave it for the project owner to review.
 */
export async function getProjectArtifactSkipReason(
  targetPath: string,
): Promise<string | null> {
  const gitRoot = await findNearestGitRoot(targetPath);
  if (!gitRoot) {
    return null;
  }

  const relativeTarget = path.relative(gitRoot, path.resolve(targetPath));
  if (
    !relativeTarget ||
    relativeTarget.startsWith("..") ||
    path.isAbsolute(relativeTarget)
  ) {
    return "project-boundary";
  }

  const result = await runCommand(
    "git",
    ["-C", gitRoot, "ls-files", "--cached", "--", relativeTarget],
    { allowFailure: true },
  );

  if (result.code !== 0) {
    return "git-check-failed";
  }

  return result.stdout.trim() ? "tracked-project-artifact" : null;
}

async function findNearestGitRoot(targetPath: string): Promise<string | null> {
  const home = path.resolve(os.homedir());
  let current = path.resolve(targetPath);

  try {
    const stats = await fs.lstat(current);
    if (!stats.isDirectory()) {
      current = path.dirname(current);
    }
  } catch {
    current = path.dirname(current);
  }

  while (
    current === home ||
    current.startsWith(`${home}${path.sep}`)
  ) {
    try {
      await fs.lstat(path.join(current, ".git"));
      return current;
    } catch {
      // Keep walking toward the home boundary.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}
