import { execFile, type ChildProcess } from "node:child_process";

/** Find descendants before terminating the parent so pipes cannot outlive it. */
function descendants(parent: number): Promise<number[]> {
  if (process.platform === "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid="],
      { timeout: 300 },
      (error, output) => {
        if (error) {
          resolve([]);
          return;
        }
        const relationships = output
          .trim()
          .split("\n")
          .map((line) => line.trim().split(/\s+/).map(Number));
        const found = new Set<number>([parent]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const [pid, ppid] of relationships) {
            if (found.has(ppid) && !found.has(pid)) {
              found.add(pid);
              grew = true;
            }
          }
        }
        resolve([...found].filter((pid) => pid !== parent && pid > 1));
      },
    );
  });
}

/** Ctrl-C gets a grace period, then a bounded fallback also releases open pipes. */
export function watchCancellation(
  child: ChildProcess,
  signal: AbortSignal,
  onCancelled: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let children: number[] = [];
  const killChildren = (kind: NodeJS.Signals) => {
    for (const pid of children.reverse()) {
      try {
        process.kill(pid, kind);
      } catch {
        /* A descendant may have exited already. */
      }
    }
  };
  const abort = () => {
    timer = setTimeout(() => {
      if (closed) return;
      killChildren("SIGKILL");
      child.kill("SIGKILL");
      if (process.platform === "win32" && child.pid) {
        try {
          execFile(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            { timeout: 500 },
            () => {},
          );
        } catch {
          /* Sandboxed process enumeration may be unavailable. */
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      child.unref();
      onCancelled();
    }, 1000);
    // Keep the foreground session/controlling terminal intact (sudo needs it).
    void descendants(child.pid ?? -1)
      .catch(() => [])
      .then((pids) => {
        if (closed) return;
        children = pids;
        killChildren("SIGINT");
        child.kill("SIGINT");
      });
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return () => {
    closed = true;
    signal.removeEventListener("abort", abort);
    if (timer) clearTimeout(timer);
  };
}
