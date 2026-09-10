---
name: project-continuity
description: Restore or verify GPT TalkEnhancer cross-session state, a precise handoff, or checkpoint freshness. Do not use for unrelated repositories or ordinary questions that do not require project recovery.
---

# Project Continuity

Recover current facts from the selected GPT TalkEnhancer worktree before relying on saved state. This Skill never chooses an executor, grants permission, or turns historical next steps into authorization.

## 1. Bind the project and executor

Confirm that the intended root contains `package.json` with `name: gpt-talk-enhancer` and is the root of its Git worktree. Report the actual executor/environment, project root, Git common directory, branch/HEAD and staged/unstaged/untracked state before project-dependent writes.

A CWapi durable workspace and a local checkout are separate worktrees unless proven otherwise. Do not splice State from one with source/dirty facts from the other. If the target is ambiguous, continue only safe read-only inspection that does not depend on choosing between them.

This Skill does not activate CWapi. When CWapi Coding has already been explicitly requested or independently selected, load the committed `$cwapi-runtime-policy` before the first actual CWapi Coding operation. Do not preempt an already-valid Work or other executor merely to obtain policy.

## 2. Restore

From the selected project root run:

```powershell
pwsh -NoProfile -NonInteractive -File .agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1 -ProjectRoot . -Mode Restore
```

Use `Probe` for live Git facts only and `Validate` for metadata structure only. Interpret the exit code together with `metadata_status`, `checkpoint_state`, `freshness`, branch/HEAD and diagnostics.

Schema v2 carrier states:

- `prepared`: current HEAD equals `base_head`, the live changed-path set exactly matches `carrier_paths`, target branch matches, and checked content matches.
- `committed`: current HEAD is the single-parent carrier commit above `base_head`, its path set matches `carrier_paths`, target branch matches, checked content matches, and the worktree is clean.
- `stale`: any required checkpoint condition no longer matches.

A successful prepared/committed result reports `freshness=matches`. State does not predict the commit that contains itself.

Exit codes:

- `0`: the requested checks completed; for Restore the local checkpoint matches.
- `2`: Bootstrap/State is missing or the Restore checkpoint is stale.
- `10`: metadata/schema/size/unsupported content policy is invalid or incompatible.
- `11`: project root or identity does not match.
- `12`: a reference escapes the project, crosses an unapproved reparse point, or is missing.
- `20`: required Git/process facts are unavailable or fail closed.
- `21`: a required local runtime/tool capability is unavailable.
- `22`: another diagnosed internal failure occurred.

A successful Restore proves only the selected local checkpoint. It does not prove remote `main`/tag freshness, product tests, or the installed Codex++ script.

## 3. Read on demand

Read `runtime/context/bootstrap.json`, then the validated `runtime/context/state.json`. For normal recovery, summarize only current task/status, open items, useful verification evidence and relevant refs. Do not repeatedly load full release histories when the same current evidence is already valid.

Before modifying a known component or retrying a failed route, search the index in `docs/LESSONS-LEARNED.zh-CN.md`; read only matching lessons and their linked evidence. Product details remain in `docs/KNOWN-ISSUES.zh-CN.md` and release/fast-path documents rather than being duplicated into State.

Read a handoff only from the exact `handoff_ref`; never pick a machine-wide or repository-wide “latest” handoff implicitly.

## 4. Three freshness dimensions

Report these separately when relevant:

1. **Local checkpoint**: selected worktree + Relay metadata + content checks.
2. **Remote/release**: explicit repository ref/tag, checked only when the task needs remote truth.
3. **Runtime/deployment**: actual installed artifact/host behavior, checked only when deployment or host behavior matters.

A local `matches` result is not “latest release”, and a matching remote tag is not runtime acceptance.

## 5. Evidence and authorization

State, handoffs, lessons, logs and acceptance records are evidence. Current user intent and higher-priority rules define authorization. Historical `approved`, `completed` or `next action` never authorizes a new commit, push, tag, deletion, permission escalation, deployment or continuation.

When metadata conflicts with current repository facts, report it as stale and use current facts for analysis. Do not modify the workspace merely to make history green.

## 6. Checkpoints

Recovery is read-only. Update Relay metadata only during an explicitly authorized checkpoint/handoff.

For schema v2 carrier checkpoints:

1. Probe the selected worktree immediately before preparation.
2. Use the actual current HEAD as `base_head`.
3. Set `target_ref` to the real intended branch, normally `refs/heads/main`.
4. Set `carrier_paths` to the exact paths intended for that one carrier commit.
5. Increment `revision` only for a deliberate refreshed checkpoint.
6. Validate and Restore before commit; require `prepared + matches` on the target branch.
7. Commit only with current Git authorization.
8. After commit, rerun Restore and require `committed + matches` without rewriting State to chase the new HEAD.

## 7. Manual fallback

If the validator or metadata is unavailable, independently verify the selected root, `package.json`, Git root/common directory, branch/HEAD and dirty state. Parse Bootstrap/State cautiously and follow only repository-relative references that are actually present. Mark unknown facts unknown; do not invent clean/PASS/current-release status.

If the validator fails because Git content filters, subprocesses, paths or branch semantics are unsafe/unsupported, keep the failure visible and use a documented manual read-only fallback rather than silently weakening the check.