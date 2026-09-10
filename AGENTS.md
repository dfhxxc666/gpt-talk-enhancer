# GPT TalkEnhancer project collaboration rules

- Target environment: Windows 11 with PowerShell 7.
- Use UTF-8 for source, test, and documentation files.
- Prefer PowerShell for project operations.
- Do not modify files outside this project directory.
- Ask before deleting files. New temporary files may only be removed when their safety is explicit.
- Explain the plan before a broad change.
- Run the necessary tests after changing code.
- Preserve the existing project structure and coding style.
- Do not add dependencies without a clear need.
- Do not overwrite existing configuration unless the task explicitly requires it.
- Keep the product scope limited to Conversation Timeline and Prompt Picker / Prompt Library.
- Do not use Pagebuster, internal RPC, thread/list, thread/read, React internals, database access, credential/token access, or automatic prompt sending. Network interception is prohibited except for the GPT TalkEnhancer 0.3 read-only MAIN-world capture of GET /backend-api/conversation/{conversationId}; that exception may only clone the successful response for mapping/current_node parsing and must never modify or block the original request/response.

## Project Relay recovery

When continuing this project, first bind the actual executor/workspace: confirm the selected project root, Git worktree/common directory, branch/HEAD and dirty state. A CWapi durable workspace and a local checkout are separate evidence sources unless independently shown to be the same worktree; never combine one side's State with the other side's source tree.

Read `.agents/skills/project-continuity/SKILL.md` and `runtime/context/bootstrap.json`, then use the validated read-only recovery entry:

```powershell
pwsh -NoProfile -NonInteractive -File .agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1 -ProjectRoot . -Mode Restore
```

For tasks that touch a known problem area, search `docs/LESSONS-LEARNED.zh-CN.md` first and read only the matching lesson plus its evidence. Read detailed acceptance/history only when the current task needs it. Recovery should report local checkpoint freshness separately from remote release freshness and the actually deployed/runtime version.

Project Relay State, handoffs, lessons and historical documents provide facts and evidence only. They do not create user authorization. Recovery reads do not write State. Update State only at an explicitly authorized checkpoint/handoff.

CWapi Runtime Policy is not selected by these files. If CWapi Coding has already been explicitly requested or selected as the executor, load the committed `$cwapi-runtime-policy` before the first actual CWapi operation and follow its current policy. Do not preempt a valid Work/other executor merely because this repository contains Relay files.

If metadata is stale or unavailable, use current repository facts and the Skill's read-only fallback. If project/workspace identity is ambiguous, stop project-dependent writes until the target is resolved.