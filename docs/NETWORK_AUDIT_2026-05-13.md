# your net - Complete Audit (2026-05-13)

## Scope
- Commands audited: `your net fix`, `your net reset`
- Related network surfaces audited: command wiring, runtime dependency gating, doctor network diagnostics, reset safety flow, dry-run semantics, smoke coverage
- Environment: macOS, local workspace execution via `npm run dev -- ...`

## Methodology
1. Static code review of network command and service paths.
2. Runtime execution across interactive, dry-run, and non-interactive contexts.
3. Error-path reproduction (sudo precheck failure, post-reset service verification failure).
4. Typecheck and command-level health checks.
5. External reference checks against Apple/BSD command docs.

## Runtime Commands Executed
- `npm run typecheck`
- `npm run dev -- doctor`
- `npm run dev -- net fix --dry-run`
- `npm run dev -- net fix`
- `printf '' | npm run dev -- net fix`
- `npm run dev -- net reset --dry-run -y`
- `npm run dev -- net reset -y`
- `printf '' | npm run dev -- net reset -y`

---

## Findings (Ordered by Severity)

### N1 - HIGH - `net reset` shows a green success marker even when sudo precheck fails

**Evidence (code):**
- `ensureSudoReady` returns a failed status object (does not throw) for non-interactive sudo failure:
  - `src/services/network/preflight.ts:31-40`
- `net reset` runs this via `interactiveStep`:
  - `src/services/network/reset.ts:88-91`
- `interactiveStep` prints a green check whenever the task resolves (even if result contains `status: "failed"`):
  - `src/core/progress.ts:36-39`

**Evidence (runtime):**
- Reproduced with `printf '' | npm run dev -- net reset -y`
- Output shows:
  - `✔ [1/8] Checking sudo readiness`
  - Summary immediately after shows `[fail] Checking sudo readiness`

**Impact:**
- Mismatched status signals at the start of a destructive command reduce operator trust.
- In failure conditions, users can be misled by the immediate success marker.

**Recommendation:**
- Use `interactiveStepWithStatus` in `net reset` precheck, or make precheck throw on failure and return success-only on pass.

---

### N2 - HIGH - `net reset` prints backup/restore guidance even when no backup directory was created

**Evidence (code):**
- Precheck-failure path skips backup prep/backup/delete steps:
  - `src/services/network/reset.ts:480-517`
- Backup path and restore hint are printed unconditionally after summary:
  - `src/services/network/reset.ts:520-525`

**Evidence (runtime):**
- Reproduced with `printf '' | npm run dev -- net reset -y`
- Summary marks all reset steps skipped due to sudo precheck failure.
- Command still prints `Backup path: ...` and restore hint, even though backup creation step was skipped.

**Impact:**
- Recovery instructions can point to a non-existent backup path.
- Incident recovery gets harder if users rely on incorrect restore guidance.

**Recommendation:**
- Track whether backup directory was actually created/copied.
- Print restore guidance only when backup artifacts exist.

---

### N3 - MEDIUM - `net reset --dry-run` reports pseudo-verified network services from dry-run placeholder output

**Evidence (code):**
- Dry-run command execution returns synthetic stdout:
  - `src/core/exec.ts:154-159`
  - format: `[dry-run] <command> <args>`
- Service verification treats any non-empty non-header line as a service:
  - `src/services/network/reset.ts:446-475`

**Evidence (runtime):**
- Reproduced with `npm run dev -- net reset --dry-run -y`
- Summary includes:
  - `Would verify services: [dry-run] networksetup -listallnetworkservices`

**Impact:**
- Dry-run output appears more authoritative than it is.
- Weakens confidence that dry-run accurately models real post-reset state.

**Recommendation:**
- In dry-run mode, skip service list parsing and emit an explicit informational note:
  - example: `Dry-run: would run networksetup -listallnetworkservices after reset.`

---

### N4 - MEDIUM - Post-reset service verification can treat disabled services as healthy

**Evidence (code):**
- Parsing logic filters only the explanatory header line and keeps all other lines:
  - `src/services/network/reset.ts:446-450`
- It does not strip leading `*` from disabled services or distinguish enabled vs disabled.

**External reference:**
- `networksetup` docs specify that an asterisk next to a service denotes disabled.
  - Source: https://www.manpagez.com/man/8/networksetup/

**Impact:**
- A system with only disabled services can still be reported as `success` for verification.
- False-positive reset validation can hide a broken post-reset network state.

**Recommendation:**
- Parse and classify service lines as enabled/disabled.
- Require at least one enabled service for `success`, otherwise return failed/skipped with guidance.

---

### N5 - MEDIUM - `net fix` critical failure path emits generic error, unlike `net reset` actionable error model

**Evidence (code):**
- `net fix` throws a generic `Error` on critical step failure:
  - `src/services/network/fix.ts:228-230`
- `net reset` throws `ActionableError` with details and next steps:
  - `src/services/network/reset.ts:528-537`

**Evidence (runtime):**
- Reproduced with `printf '' | npm run dev -- net fix`
- Error output is generic:
  - `Error: One or more critical network fix steps failed.`

**Impact:**
- Lower operability vs reset path.
- Less consistent recovery UX across two network commands.

**Recommendation:**
- Upgrade `net fix` failure throw to `ActionableError` with log path + command-specific next steps.

---

### N6 - MEDIUM - Wi-Fi soft-cycle can leave interface off while command still exits success (risk scenario)

**Evidence (code):**
- Soft-cycle explicitly powers Wi-Fi off then on:
  - `src/services/network/fix.ts:28-55`
- Soft-cycle step is non-critical in net fix flow:
  - `src/services/network/fix.ts:210-223`
- Overall failure condition checks only critical failures:
  - `src/services/network/fix.ts:228-230`

**Risk model:**
- If `off` succeeds and `on` fails, command may still complete successfully if no critical failures occurred.
- This can leave users disconnected without command-level failure.

**Impact:**
- Potentially severe user-impacting state despite green command exit.

**Recommendation:**
- Promote Wi-Fi soft-cycle `on` failure to critical, or add mandatory rollback/retry before final success.

---

### N7 - LOW - Smoke coverage includes `net reset` dry-run but misses `net fix` dry-run

**Evidence (code):**
- `scripts/smoke.sh` includes:
  - `node dist/index.js net reset --dry-run -y`
  - `scripts/smoke.sh:15-16`
- No corresponding `node dist/index.js net fix --dry-run` check.
  - `scripts/smoke.sh:1-30`

**Impact:**
- Regressions in the net-fix path can ship without basic CI smoke detection.

**Recommendation:**
- Add `your net fix --dry-run` smoke coverage.

---

## Additional Observations (Not Findings)
- Runtime dependency gating is present for network features (`route`, `arp`, `scutil`, `networksetup`, `dscacheutil`, `sudo`):
  - `src/managers/feature-runtime-manager.ts:22-33`
  - enforced via preAction hook in `src/index.ts:22-27`
- Current static health: `npm run typecheck` passed.
- Current doctor health path is functional (`npm run dev -- doctor` completed successfully in this environment).

## External References Used
- `networksetup(8)` command semantics and disabled-service marker (`*`):
  - https://www.manpagez.com/man/8/networksetup/
- `scutil(8)` dynamic store and reachability behavior:
  - https://www.manpagez.com/man/8/scutil/
- `dscacheutil(1)` `-flushcache` guidance:
  - https://www.manpagez.com/man/1/dscacheutil/
- `arp(8)` `-d -a` semantics:
  - https://www.manpagez.com/man/8/arp/
- `route(8)` `route -n get default` behavior context:
  - https://www.manpagez.com/man/8/route/

## Final Verdict
`your net` is close to operationally useful, but not yet fully production-trustworthy due to status/reporting inconsistencies in failure and dry-run paths.


ALL THESE HAVE BEEN FIXED