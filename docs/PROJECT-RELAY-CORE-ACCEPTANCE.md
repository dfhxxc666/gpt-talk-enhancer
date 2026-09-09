# Project Relay Phase 1 Core 验收记录

日期：2026-09-09
状态：**PASS / SEALED / SCHEMA V2 + FRESH CODEX DISCOVERY**
产品基线：**GPT TalkEnhancer v0.5.1 / `cd1023bde0bf81460ffd65076b87f13bc2127562`**

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
