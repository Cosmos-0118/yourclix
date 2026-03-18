# Yourclix Reliable Beginner Roadmap (V2)

Last updated: 2026-03-18
Scope: Improve every current feature with simple, reliable behavior that beginner developers can trust.

## 1) Product Direction

### Primary Goal
Make `your` the safest and easiest "developer machine helper" for macOS beginners.

### Non-Goals
- No complex rollback engine in this phase.
- No hidden background automation that users cannot understand.
- No risky behavior without explicit user confirmation.

### Reliability Rules (applies to all features)
- Every reset/reconfigure flow must include post-action verification.
- If verification fails, print a manual recovery checklist with exact commands.
- Destructive operations must be previewable and explicit.
- Error output must answer:
  - What failed?
  - What should the user do next?
- Keep implementation simple and testable.

## 2) External Benchmark Summary

This roadmap aligns with modern CLI guidance and behavior from leading tools.

### Command-Line Interface Guidelines (clig.dev)
- Human-first output and discoverability.
- Progress feedback for long operations.
- Idempotence and recoverability.
- Consistent flags and clear help.

### GitHub CLI (gh)
- Strong command consistency and clear command families.
- Good defaults with script-friendly behavior.

### Homebrew
- Idempotent shell setup behavior (`shellenv` emits no-op output if already configured).
- Frequent dry-run patterns and safe status commands.
- Clear repair/status command split (`doctor`, `cleanup --dry-run`, `config`).

### Error Message Guidance (Google Tech Writing)
- Actionable, precise error messaging.
- Clear next steps for users, not only technical failures.

## 3) Current Feature Gap Analysis

Maturity scale: H = high, M = medium, L = low

| Feature | Maturity | Biggest gaps | Reliability target |
|---|---|---|---|
| setup | M | no robust re-run verification, weak shell coverage | idempotent setup + verify |
| clean | H | scale limits, missing category depth | chunked scan + verified delete |
| net fix | M | shallow fix set, weak post-checks | fix + post-connectivity checks |
| net reset | M | reset success not fully verified | reset verification + manual checklist |
| spotlight | L-M | weak parsing/status confidence | parse + verify indexing state |
| brew | M-H | failure cascade, low guidance | resilient upgrade flow + hints |
| doctor | M | limited checks and severity cues | richer checks + beginner actions |
| fix | L-M | narrow auto-fix set | actionable suggested fixes |
| dev clean | M | limited ecosystem support | broader language/tool cleanup |
| dev reset | L | partial ecosystem and weak validation | verified tool reset matrix |
| space | M-H | little guidance for next actions | recommendation engine |
| privacy | L | limited browser coverage | auto-detect + safe cleanup |
| startup | M | fragile parsing, missing enable path | robust parse + full lifecycle |
| plugin | L | no registry/discovery | local registry + search/list |
| completion | L | zsh-only, weak install/remove | multi-shell managed blocks |
| terminal | M | history handling edge cases | robust shell-aware backup |
| backup | M | weak filtering/sorting metadata | searchable backup inventory |
| undo | H | weak preview and metadata context | restore preview + command tags |

## 4) Execution Model

### Branch and Delivery Protocol
For each big feature segment:
1. Implement.
2. Validate (`npm run typecheck` + targeted command checks).
3. Commit with one feature-focused message.
4. Push branch to origin.
5. Mark segment as done in this file with commit hash.

### Definition of Done (per segment)
- Reliability improvement implemented.
- Verification path added or upgraded.
- Manual fallback instructions present where needed.
- Typecheck passes.
- Segment status updated in this roadmap.

## 5) Phased Plan

## Phase A: Reliability Foundation (now)

Objective: make all reset/reconfigure operations verify outcomes and provide manual fallback.

- [x] A1. Shared reset verification pattern (result parsing + user-safe fallback messaging)
- [x] A2. Network reset: verify plist reset outcome + service checks + manual recovery checklist
- [x] A3. Spotlight reset: verify indexing state after reset + manual recovery checklist
- [x] A4. Dev reset: verify tool reinstall/reset result and provide manual steps when partial
- [x] A5. Startup reset/disable flows: verify actual login item state changed

## Phase B: Beginner UX and Error Clarity

Objective: beginners always know what happened and what to do next.

- [x] B1. Normalize actionable error format across commands
- [x] B2. Add "next command" guidance on success/failure summaries
- [x] B3. Add concise help examples for high-traffic commands (`setup`, `clean`, `doctor`, `net`)
- [x] B4. Add severity conventions for doctor output and fix suggestions

## Phase C: Feature Depth Upgrades

Objective: make each feature genuinely useful day-to-day.

- [ ] C1. setup: multi-shell idempotent install/uninstall blocks with verification
- [ ] C2. clean: remove scale limits, add chunked progress and larger category coverage
- [ ] C3. doctor/fix: expand checks and auto-fix mappings
- [ ] C4. dev: broaden ecosystem coverage (node/python/ruby/rust/go basics)
- [ ] C5. completion/plugin/privacy/startup: fill core missing workflows

## Phase D: Quality Guardrails

Objective: reduce regressions while keeping implementation simple.

- [ ] D1. Add targeted smoke tests for destructive and reset commands
- [ ] D2. Add command-level verification helpers where duplicated
- [ ] D3. Add docs page: "If reset fails, do this manually"

## 6) Feature-by-Feature Upgrade Backlog

Each item below is intentionally short for maintainability.

### setup
- Add deterministic shell block markers and re-run verification.
- Add post-setup check for command visibility/path.

### clean
- Replace hard caps with chunked scanning and deterministic summaries.
- Add category-level verification counts after deletion.

### net fix/reset
- Validate pre-state, apply change, verify post-state.
- Always print manual network recovery steps on verification failure.

### spotlight
- Parse `mdutil -s` output into state and confidence.
- If not enabled post-reset, print a manual re-enable checklist.

### brew
- Improve resilience around update/upgrade failure chains.
- Provide next-step command hints for common brew issues.

### doctor/fix
- Expand checks and map each issue to clear fix path.
- Keep fixes conservative and reversible where possible.

### dev
- Improve reset and clean coverage across common language ecosystems.
- Verify tool versions after reset to confirm expected state.

### privacy
- Detect installed browsers and apply only safe targets.
- Warn about app-locked files before deletion.

### startup
- Harden parser and support enable/disable/list symmetry.
- Verify target state by re-reading startup source of truth.

### plugin/completion
- Add minimal reliable registry/list/install/remove paths.
- Ensure shell completion install/uninstall is idempotent.

### space/terminal/backup/undo
- Improve discoverability and actionable output.
- Keep output script-friendly where possible.

## 7) Work Log

Use this section to track completed segments.

- [x] Segment A1: Shared reset verification pattern
  - Commit: fb79fc0
  - Notes: Added reusable manual recovery detail builder for reset/reconfigure flows.

- [x] Segment A2: Network reset verification and manual fallback
  - Commit: fb79fc0
  - Notes: Added post-delete plist verification and explicit manual recovery checklist on verification failures.

- [x] Segment A3: Spotlight reset verification and manual fallback
  - Commit: fb79fc0
  - Notes: Added indexing-state verification after reset with actionable manual recovery steps.

- [x] Segment A4: Dev reset verification and manual fallback
  - Commit: cb7a281
  - Notes: Added post-reset verification for node/python and manual recovery checklist on partial failure.

- [x] Segment A5: Startup disable verification and manual fallback
  - Commit: bd0fdba
  - Notes: Added before/after login item verification and manual recovery checklist when disable verification fails.

- [x] Segment B1: Normalized actionable error format
  - Commit: 84e8610
  - Notes: Added shared actionable error model and formatter, integrated in reset/reconfigure failure paths.

- [x] Segment B2: Next-command guidance in summaries
  - Commit: a390a18
  - Notes: Added reusable next-command helper and integrated guidance into dev/startup/network/spotlight success paths.

- [x] Segment B3: Concise command help examples
  - Commit: to be filled from git history
  - Notes: Added practical examples to setup/clean/doctor/net help output for beginner discoverability.

- [x] Segment B4: Doctor severity conventions and fix guidance
  - Commit: to be filled from git history
  - Notes: Added severity legend, standardized severity markers, and explicit next-step command hints in doctor report output.

## 8) Immediate Next Segment

Start now with Segment A1 + A2 + A3 together as the first high-impact reliability release.
