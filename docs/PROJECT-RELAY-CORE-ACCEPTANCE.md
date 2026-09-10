# Project Relay Phase 1 Core 验收记录

日期：2026-09-09；v1.2 架构增量验收：2026-09-10
状态：**PASS / SCHEMA V2 CORE SEALED + V1.2 INCREMENTAL HARDENING**
当前产品基线：**GPT TalkEnhancer v0.5.2 / `1bd2d02f42dc3586e052629ef4d2d0f8a22f1590`**

## 1. 验收结论

Project Relay Phase 1 Core 已在当前 v0.5.1 主线重新实施并升级为 **Protocol Schema v2**。F01–F08 的恢复核心保持不变：恢复入口、Continuity Skill、只读 Probe/Validate/Restore、隔离测试套件、Bootstrap、状态快照、README 入口和验收文档均已落盘。

Schema v2 修复了 v1 的 Git 自引用缺口：版本化的 `state.json` 不再要求精确预测“包含它自己的 commit hash”。状态改为记录 `base_head + carrier_paths`，Restore 同时识别 `prepared` 与 `committed` 两种稳定 checkpoint 形态。

本次仍不安装 Hooks，不增加 Guard 策略，不创建自定义 Agent 配置，也不激活任何工具。产品源码、产品测试、构建产物、扩展、集成和既有产品脚本均未修改。

## 2. 交付清单

| 编号 | 路径 | 作用 | 验收结果 |
| --- | --- | --- | --- |
| F01 | `AGENTS.md` | 增加 Project Relay 恢复入口，并明确状态记录不产生授权 | 通过 |
| F02 | `.agents/skills/project-continuity/SKILL.md` | 定义恢复流程、schema v2 checkpoint 语义、证据边界与手工降级 | 通过 |
| F03 | `.agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1` | 提供只读 `Probe`、`Validate`、`Restore` 三种模式 | 通过 |
| F04 | `.agents/skills/project-continuity/tests/Test-ProjectContinuity.Tests.ps1` | 提供无需新增依赖的隔离 Git 仓库验证套件 | 通过 |
| F05 | `runtime/context/bootstrap.json` | 提供固定协议入口、项目身份和状态引用 | 通过 |
| F06 | `runtime/context/state.json` | 保存 carrier checkpoint、任务范围、验证证据和未决项 | 通过 |
| F07 | `README.md` | 在开发章节提供简短恢复命令 | 通过 |
| F08 | `docs/PROJECT-RELAY-CORE-ACCEPTANCE.md` | 固化实施范围、结果、限制与复验方式 | 通过 |

协议硬化项：`.gitignore` 新增 `runtime/context/test-fixtures/`，使隔离测试仍留在项目目录内，但不污染 Git dirty 统计或 checkpoint freshness。

## 3. Schema v2 checkpoint 模型

### 3.1 Bootstrap

`runtime/context/bootstrap.json` 只保存稳定入口：协议版本、项目身份检查、state 引用和少量入口文档。它不保存当前任务、版本号、绝对路径或本机状态。

### 3.2 State

`runtime/context/state.json` 的 checkpoint 核心字段为：

```text
mode = carrier_commit
base_head = carrier commit 的直接父提交
carrier_paths = carrier commit 应包含的精确路径集合
target_ref = 预期目标分支，通常为 refs/heads/main
```

`revision` 表示明确创建/刷新 checkpoint 的次数；`schema_version` 只在协议结构变化时升级。

### 3.3 Restore 稳定状态

Schema v2 定义两种可以返回 `freshness=matches` 的状态：

- `checkpoint_state=prepared`：当前 HEAD 等于 `base_head`，live changed-path 集合与 `carrier_paths` 精确一致，内容校验通过；
- `checkpoint_state=committed`：当前 HEAD 为单父 carrier commit，父提交等于 `base_head`，该 commit 的路径集合与 `carrier_paths` 精确一致，内容校验通过，且工作区干净。

因此 stage 不会改变 checkpoint 语义；carrier commit 形成后也不需要改写 `state.json` 来追逐新的 HEAD。

Schema v2 的版本化文本证据使用 `git-blob-oid` 做内容身份校验：通过 Git clean filter 计算 canonical blob identity，而不是直接哈希工作树原始字节。这样 Windows `core.autocrlf`、LF/CRLF checkout 规范化等 Git 认可的等价转换不会制造假 `worktree_changed`。

正常后续开发产生新的 descendant commit，或 carrier commit 后工作区出现额外改动时，Restore 会返回 stale 并 fail closed。

## 4. 实际验证结果

### 4.1 PowerShell 与结构

- `Test-ProjectContinuity.ps1`：PowerShell 解析器 0 errors；
- `Test-ProjectContinuity.Tests.ps1`：PowerShell 解析器 0 errors；
- Skill frontmatter、脚本目录与测试目录结构完整；
- Bootstrap / State 使用严格 JSON 解析，拒绝注释、尾随逗号、重复键和未知协议版本。

### 4.2 隔离测试套件

Schema v2 最终结果：**PASS=18、FAIL=0、BLOCKED=0**。

覆盖：

1. prepared checkpoint 正常恢复；
2. 精确 stage carrier 路径后仍保持 `prepared + matches`；
3. carrier commit 后无需预测自身 HEAD 仍保持 matches；
4. committed 后额外 worktree 改动会 stale；
5. carrier 后新增 descendant commit 会 `head_changed`；
6. prepared 状态出现非 carrier 路径会 stale；
7. unborn repository Probe；
8. detached HEAD Probe；
9. staged / unstaged / untracked 独立统计；
10. 非法 JSON；
11. 重复 JSON key；
12. 未知 schema；
13. 项目身份不匹配；
14. 相对路径越界；
15. Bootstrap 大小限制；
16. Restore 只读内容不变；
17. reparse/symlink 越界拒绝；
18. Windows `core.autocrlf=true` 下 raw LF/CRLF 字节发生变化、Git 工作区仍 clean 时，`git-blob-oid` 内容校验保持 `committed + matches`。

测试 fixture 生成在 `runtime/context/test-fixtures/`，该目录已 Git ignore。测试本身不自动删除 fixture。

### 4.3 Fresh Codex Skill 自动发现实机验收

2026-09-09，用户在一个全新启动的 Codex 任务中，以当前仓库为工作目录执行只读恢复验收，未手工指定 Skill 路径。新任务报告：

- `project-continuity` Skill：**自动发现并使用**；
- branch / HEAD：`main` / `d3dfb60bc4662beb412ed7dbe68bb3f43261a441`；
- staged / unstaged / untracked：`0 / 0 / 0`；
- `metadata_status=valid`；
- `checkpoint_state=committed`；
- `freshness=matches`；
- 当前任务状态正确恢复为 Project Relay Phase 1 Core / schema v2 迁移已完成；
- 授权边界正确保持为只读恢复，没有把 state、handoff 或历史任务状态解释为新的写操作授权。

该结果完成了此前唯一未覆盖的 Fresh Codex repository Skill 自动发现宿主集成检查。此项证据来自用户在独立新 Codex 任务中的实机验收报告，不冒充为隔离脚本或当前会话直接执行结果。

## 5. v0.5.1 产品基线

当前公开产品基线为 v0.5.1，正式验收见 `docs/V0.5.1-FINAL-ACCEPTANCE.zh-CN.md`：历史记录为 **173 / 173 PASS**，Chat/Work Navigation 性能与可靠性真实验收通过。

Project Relay 本次没有修改任何产品执行路径，因此没有把这份历史结果声明成新的产品测试。Relay 的 verification 会明确区分当前检查与 historical document claim。

## 6. 安全与脱敏

正式交付文件只使用仓库相对路径和公开项目标识，不持久化本机用户名、绝对项目目录、会话标识、访问令牌、密码或密钥。运行 Probe 时可以即时报告用户选择的本地项目根目录，但该绝对路径不进入版本化 state 或验收文档。

状态引用只能指向已确认 Git 根目录内的文件；路径遍历和 Windows reparse point 越界会失败。Project identity 同时由 Bootstrap `project_id` 与 `package.json/name` 验证。

## 7. 授权边界

Project Relay 是事实与证据层，不是授权层。State、handoff、历史 `approved`、`next action` 或验收结论均不能单独授权：

- commit / push / tag；
- 删除文件；
- 强推或远端历史改写；
- Hooks / Guard / 自定义 Agent；
- 权限提升或工具激活；
- 自动继续历史任务。

执行权限仍由当时用户请求和更高优先级规则决定。

## 8. 剩余限制

- 本次没有实施下一阶段 Hooks、Guard、自动写回或自定义 Agent。
- 本次没有重新运行产品 `npm run check` 或真实宿主验收，因为产品代码、产品测试和构建路径未修改。

## 9. 后续复验命令

在仓库根目录使用 PowerShell 7：

```powershell
pwsh -NoProfile -NonInteractive -File .agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1 -Mode Probe -ProjectRoot .
pwsh -NoProfile -NonInteractive -File .agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1 -Mode Validate -ProjectRoot .
pwsh -NoProfile -NonInteractive -File .agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1 -Mode Restore -ProjectRoot .
```

准备 carrier commit 时，Restore 应为：

```text
checkpoint_state=prepared
freshness=matches
```

carrier commit 形成后，同一份 state 应为：

```text
checkpoint_state=committed
freshness=matches
```

这两个状态都不产生任何写操作或后续任务授权。
## 10. 2026-09-10 Project Relay v1.2 增量架构升级

### 10.1 升级范围

本轮依据 `my-tech-docs/docs/codex` 的 Project Relay 实施与持续优化方案 v1.2，对 GPT TalkEnhancer 已有 schema v2 做**增量升级**，没有重建协议、没有升级 `schema_version`，也没有把 Relay 接入产品运行依赖。

新增/调整职责：

- `AGENTS.md`：恢复前先绑定实际 executor / root / worktree / common dir / branch / HEAD / dirty；禁止拼接 CWapi durable 与本地 checkout 状态。
- `.agents/skills/project-continuity/SKILL.md`：按需读取、三类新鲜度、错题索引、target branch 语义、CWapi executor-gated 边界和手工降级。
- `runtime/context/bootstrap.json`：增加 `lessons` 与 `relay_issues` 稳定入口。
- `docs/LESSONS-LEARNED.zh-CN.md`：建立项目错题本，只保存可复用防错动作与冻结路线。
- `docs/PROJECT-RELAY-IMPLEMENTATION-ISSUES.zh-CN.md`：保存本项目 v1.2 实施缺口、处理决定和未覆盖项。
- README：恢复章节改为摘要/索引/按需证据路径，并明确 local / remote / runtime 三类新鲜度分开解释。

当前产品 `src/`、`test/v3`、版本号与运行开关均未修改。

### 10.2 Validator 硬化

`.agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1` 保持 `Probe / Validate / Restore` 和 schema v2 默认接口，新增以下 fail-closed 边界：

1. **target_ref**：Restore 现在要求当前 attached branch 的完整 ref 与 checkpoint `target_ref` 一致；错误分支或 detached 返回 `TARGET_REF_MISMATCH`，checkpoint stale。
2. **HEAD / unborn**：不再把所有 `rev-parse HEAD` 失败都解释成 unborn；只有 attached branch ref 明确不存在时才认定合法 unborn，损坏/不可用 ref 返回 Git probe failure。
3. **Git filter**：`git-blob-oid` 前先读取该路径实际 `filter` attribute。未设置/`unset` 可继续；有效 filter 值 fail closed，不自动执行未知 clean/process filter。
4. **子进程边界**：stdout/stderr 并发异步读取，默认 15 秒 timeout，超时仅终止本次进程树；返回总输出超过默认 1,048,576 字符 fail closed。
5. **路径集合**：changed/commit paths 使用 NUL 输出与 `--no-renames`，不再 Trim 合法路径；rename 按 delete + add 的精确 carrier path 集合处理。
6. **删除路径**：carrier path 可表示已删除旧路径，因此 schema 安全校验不再要求每个 carrier path 当前仍是存在的叶子文件。

限制：当前输出上限是在 `ReadToEndAsync()` 完成后检查，因此约束的是等待时间与返回结果大小，不是严格的流式内存硬上限。若未来需要处理不可信超大子进程输出，应另行实现流式 hard cap 并独立验收。

### 10.3 隔离测试升级

原 schema v2 18 项继续保留，并新增 8 项边界测试：

- 同 HEAD 但错误 attached branch 拒绝；
- detached checkpoint 与 `target_ref=main` 拒绝；
- active Git filter 在 content hash 前 fail closed；
- 损坏 branch ref 不误报 unborn；
- Unicode + 空格路径与 rename carrier 的 NUL path set；
- Probe 子进程输出上限；
- 大量 stderr + sleep 的 subprocess timeout；
- 项目外 TestRoot 在创建前拒绝。

最终结果：

```text
Project Relay isolated suite
PASS = 26
FAIL = 0
BLOCKED = 0
```

测试根被限制到项目内 `runtime/context/test-fixtures/`。第一次扩展运行沿用长时间戳/GUID/场景名，在 CWapi durable 的长 Windows 根路径下实际触发 `Filename too long`。该失败没有通过把夹具搬到项目外规避，而是缩短为：

```text
runtime/context/test-fixtures/r-xxxxxxxx/fNN
```

随后同一套测试 26/26 PASS。历史失败夹具和成功夹具都未自动删除，并由现有 `.gitignore` 精确忽略。

### 10.4 产品层回归

本轮架构修改完成后运行：

```text
npm run check
234 / 234 PASS
build PASS
```

产品源码范围在运行前为 clean，运行后源码仍 clean。构建发现一个既有可再现性小差异：当前源码重新生成 `dist/v3/00-gpt-talk-enhancer.v3.bundle.js` 时会比 v0.5.2 已发布 bundle 少 3 个空白行，语义 diff 为零业务代码变化。该正式 bundle 已恢复到 v0.5.2 HEAD blob，未把产物差异并入本次 Relay 架构修改。本轮不把这一发现解释为产品功能回归。

### 10.5 跨入口与工作区证据

本次普通 Chat 中用户明确选择使用新架构更新 GPT TalkEnhancer，CWapi Coding 作为实际执行器。按 v1.2 要求补读了 committed `cwapi-runtime-policy` revision 3 和本任务所需 lazy refs，再操作项目。

切换 `my-tech-docs → gpt-talk-enhancer` 时，实际观察到一次 CWapi active session / resolved commit 歧义。没有把另一仓库/旧 workspace 的状态继续用于写入，而是关闭目标句柄后按 GPT TalkEnhancer `main@1bd2d02...` 重新绑定并核实 root / common dir / HEAD / dirty。该案例已提炼为 `ENV-WORKSPACE-001`。

因此本次可作为 **V13（普通 Chat + 明确选择 CWapi）与 V19（durable / checkout 绑定）部分真实证据**，但不宣称覆盖“未选择 CWapi”“策略不可用”“Fresh Codex 自动发现重测”“并发写入者”等完整矩阵。

### 10.6 当前完成与未完成边界

本轮已完成：入口架构、错题本、项目实施问题记录、主要 validator P1/P2 硬化、26 项隔离测试和产品自动回归。

仍保留为非阻塞/后续验证：

- token/读取量优化尚未在可比场景测量，不声明节省百分比；
- subprocess 输出上限尚不是流式内存硬限；
- V01–V19 并非整表全部重新实测，实际覆盖范围以项目实施问题记录为准；
- v0.5.2 既有 Work 模型 popup 独立复现项与外部 Script Market 投稿决定保持原状态。

本轮后续在用户要求“修一下这个再提交”后，又修复了 Local Work physical tail 点击最后一问失败（WORK-003）：增加 bounded `work-tail-backtrack`，完整产品回归更新为 234/234 PASS。该产品修复与本次 Relay 架构修改将由同一新的 carrier checkpoint 精确记录。`r`n`r`n本轮没有 push、tag、Hooks/Guard/Agent 安装或删除测试夹具；commit 仅在当前用户已明确授权的本次 carrier 范围内执行。