# GPT TalkEnhancer Project Relay 实施问题

本文件记录本项目接入 Project Relay v1.2 架构时的真实缺口、处理决定与复验范围。它不是当前任务数据库，也不授权后续 Git、发布、删除或执行器切换。产品问题继续以 `docs/KNOWN-ISSUES.zh-CN.md` 为主。

## 索引

| ID | 关键词 / 组件 | 状态 | 优先级 | 目标 |
|---|---|---|---|---|
| GTE-RLY-001 | workspace、durable、local、V19 | partial | P1 | 明确执行环境/worktree 绑定 |
| GTE-RLY-002 | target_ref、branch、detached、V07 | resolved | P1 | Restore 真正校验目标分支 |
| GTE-RLY-003 | hash-object、filter、CRLF、V03 | resolved | P1 | 外部 filter fail-closed |
| GTE-RLY-004 | subprocess、timeout、output、V08 | resolved-with-limit | P1 | Git 子进程有界等待/输出 |
| GTE-RLY-005 | HEAD、unborn、Git failure、V04 | resolved | P1 | 区分真实 unborn 与探测失败 |
| GTE-RLY-006 | NUL、rename、path set、V06 | resolved | P2 | 机器格式路径集合 |
| GTE-RLY-007 | TestRoot、fixture、V09 | resolved | P1 | 限制隔离测试输出根 |
| GTE-RLY-008 | Chat + CWapi、V13 | partial | P1 | 显式 CWapi 入口端到端证据 |
| GTE-RLY-009 | token、按需读取、V17 | deferred | P2 | 后续用可比场景测量 |

## GTE-RLY-001：执行环境与 worktree 绑定

- **事实**：v0.5.2 WIP 已记录一次修改落错 checkout；本次架构升级前 CWapi 跨仓库切换又出现活动句柄与 resolved commit 歧义。
- **决定**：AGENTS/Skill 明确要求先报告 executor、root/common dir、branch/HEAD/dirty；不同 checkout 不拼接 State/源码事实。
- **验收**：本次重新关闭并按 `main@1bd2d02...` 打开后，实际 root、HEAD、branch、dirty 与 v0.5.2 基线一致；规则已写入 AGENTS/Skill。完整跨入口矩阵仍未跑完，因此状态保持 partial。
- **限制**：普通 Chat、Codex 项目任务、CWapi durable、本地 checkout 的完整交叉矩阵仍需后续持续实测。

## GTE-RLY-002：target_ref 未参与 Restore 匹配

- **事实**：v0.5.2 validator 只校验 `target_ref` 字符串形状，prepared/committed 判断未对实际 branch。
- **决定**：在 Restore 中把 attached branch 的完整 ref 与 `target_ref` 比较；错误分支或 detached 对目标分支 checkpoint fail closed 为 stale，并给出专用诊断。
- **复验结果**：正确 main 保持匹配；同 HEAD 的其他分支与 detached 均返回 `TARGET_REF_MISMATCH`、`checkpoint_state=stale`、`freshness=head_changed`。扩展套件通过。

## GTE-RLY-003：git-blob-oid 外部 filter 边界

- **事实**：`git hash-object --path` 会应用 Git clean/filter 语义；未知 process/clean filter 可能执行外部程序。
- **决定**：计算 `git-blob-oid` 前使用 `git check-attr -z filter -- <path>` 检查实际 filter。未设置/unspecified/unset 继续；任何有效 filter 均 fail closed，不自动运行、安装或修改 Git 配置。`text/eol` 仍允许用于 CRLF canonicalization。
- **复验结果**：无 filter 与 CRLF canonicalization 保持通过；显式 `filter=relaytest` 在 `hash-object` 前返回 `GIT_FILTER_NOT_ALLOWED` / exit 20。

## GTE-RLY-004：Git 子进程缺少显式边界

- **事实**：旧 `Invoke-CapturedProcess` 顺序 `ReadToEnd(stdout) → ReadToEnd(stderr) → WaitForExit()`，无 timeout/output limit。
- **决定**：改为 stdout/stderr 并发异步读取，显式超时；超时终止本次进程树并返回专用失败。对返回结果设置最大字符数，超限 fail closed，不把截断当成完整 Git 协议结果。
- **复验结果**：动态测试证明 helper 在大量 stderr + sleep 场景按超时退出；Probe 在 `git status -z` 输出超过 1024 字符时返回 `PROCESS_OUTPUT_LIMIT` / exit 20。
- **限制**：异步 `ReadToEndAsync` 仍由 .NET 暂存进程实际输出后再做结果上限检查，因此不是严格的流式内存硬上限；本次只声明等待/返回结果有界。真正流式硬限额可在需要时继续演进。

## GTE-RLY-005：HEAD 失败误报 unborn

- **事实**：旧实现把所有 `rev-parse --verify HEAD` 非零都标为 unborn。
- **决定**：先获取 symbolic ref；HEAD 解析失败时，仅当目标 branch ref 明确不存在时认定合法 unborn；ref 存在/损坏或 Git 检查本身失败则返回 Git probe error。
- **复验结果**：正常 attached、detached Probe、合法 unborn 均保持正确；损坏 `refs/heads/main` 不再误报 unborn，而是 Git probe failure / exit 20。

## GTE-RLY-006：路径集合机器格式

- **事实**：旧 changed path / commit path 用换行切分并 `Trim()`，会改变合法路径文本；rename/copy 语义也不够明确。
- **决定**：changed-path 与 commit-path 使用 `-z` NUL 输出，路径规范化只替换目录分隔符、不 Trim；使用 `--no-renames` 让 rename 以 delete+add 的精确路径集合参与 carrier 比较。
- **复验结果**：`docs/路径 with space.txt` rename fixture 在 `--no-renames + -z` 路径集合下 prepared/committed 均 `matches`；删除旧路径允许作为 carrier path 而不要求叶子仍存在。

## GTE-RLY-007：隔离测试 TestRoot 边界

- **事实**：旧测试脚本接受任意绝对 `TestRoot` 后直接创建 run 目录。
- **决定**：从 probe 所属 Git 仓库解析项目根，要求 TestRoot 位于 `runtime/context/test-fixtures/` 内，拒绝项目外、项目根本身和重解析逃逸。测试仍不自动删除夹具。
- **复验结果**：项目内 `runtime/context/test-fixtures/` 通过；项目外 TestRoot 在创建前以 `TEST_ROOT_OUTSIDE_PROJECT` 拒绝。长 durable 根首次触发 Windows `Filename too long` 后，将 run/fixture 名缩短为 `r-xxxxxxxx/fNN`，重跑 26/26 PASS；失败夹具未删除且被现有 `.gitignore` 忽略。

## GTE-RLY-008：普通 Chat + 明确 CWapi

- **状态**：partial。
- **本次事实**：用户在普通 Chat 中明确要求按 `my-tech-docs/docs/codex` 新架构更新项目，并确认实施方案；CWapi 已作为实际执行器。已读取 committed `cwapi-runtime-policy` revision 3 与所需 permissions/git refs，再绑定 GPT TalkEnhancer 目标 workspace。
- **覆盖**：证明“显式选择 CWapi → 读取正式策略 → 读取同一项目 Relay → 在目标 workspace 工作”这一路径可执行。
- **未覆盖**：未选择 CWapi 时不激活、策略不可用、Fresh Codex 自动发现、执行器并发交接等场景。

## GTE-RLY-009：按需读取/token 测量

- **状态**：deferred，非阻塞。
- **决定**：入口与 Skill 已改为索引/摘要优先；暂不声称节省百分比。后续在可比恢复任务中记录读取文件数、返回字符量/可靠 token 统计、耗时和漏检情况，再决定是否增加摘要 API。

## 更新规则

- 先读索引，命中后读取对应正文及证据。
- resolved 必须有实际复验范围；代码改了但未跑场景不得关闭。
- deferred 说明重新评估条件；记录本身不触发自动继续。
- 成熟防错动作提炼到 `docs/LESSONS-LEARNED.zh-CN.md`，本文件保留实施证据和未覆盖项。