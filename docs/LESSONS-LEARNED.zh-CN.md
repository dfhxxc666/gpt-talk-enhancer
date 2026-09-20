# GPT TalkEnhancer 项目错题本

仅在相关任务、同类故障或准备重试已失败路线时检索本索引，再读取命中条目及证据。这里保存可复用的防错动作，不复制产品问题全文，不保存会话日志，也不产生任何操作授权。

## 索引

| ID | 触发关键词 / 组件 | 适用范围 | 状态 | 条目 |
|---|---|---|---|---|
| ENV-WORKSPACE-001 | CWapi durable、本地 checkout、同仓库不同 HEAD、落错工作区 | 开发/恢复/执行器交接 | 有效 | [绑定实际执行环境与 worktree](#env-workspace-001绑定实际执行环境与-worktree) |
| PERF-L3-001 | L3、Fiber、official navigation、卡顿、deep scan | Codex Desktop 导航研究 | 有效/冻结 | [研究代码不等于运行时功能](#perf-l3-001研究代码不等于运行时功能) |
| COMPAT-SCROLL-001 | Codex++、切换对话保留位置、回弹、Q54、saveNow | Local Work 滚动恢复 | 有效 | [协调宿主滚动恢复所有权](#compat-scroll-001协调宿主滚动恢复所有权) |
| SHELL-PS-001 | PowerShell、$Host、别名 r、脚本补丁 | Windows 开发命令 | 有效 | [避免 PowerShell 保留变量和短别名](#shell-ps-001避免-powershell-保留变量和短别名) |
| TEST-PATH-001 | Project Relay、fixture、Windows、Filename too long、CWapi durable | Relay 隔离测试 | 有效 | [长工作区下缩短 fixture 路径](#test-path-001长工作区下缩短-fixture-路径) |
| NAV-TAIL-001 | Work、最后一问、physical tail、长 assistant 回复、Q71、未能定位 | Local Work Timeline 导航 | 有效 | [最后一问不等于对话最底部](#nav-tail-001最后一问不等于对话最底部) |
| CACHE-ORDER-001 | cache、duplicate order、missing Q、occupied-order | Chat Timeline Cache | 有效 | 坏 cache 必须在恢复边界被拦截 |
| SCROLL-OWNER-001 | bootstrap、repair、Earlier、navigation、上下跳动 | Chat scroll ownership | 有效 | 同一时刻只能有一个滚动所有者 |

## ENV-WORKSPACE-001：绑定实际执行环境与 worktree

- **状态**：有效。
- **触发**：同一仓库同时存在 CWapi durable workspace、本地 checkout、不同 HEAD/dirty，或执行器切换。
- **错误做法**：仅凭仓库名/项目名判断写入位置，把一边的 State、HEAD 或测试结果套到另一边；曾发生 Work Later 修改先落到错误 checkout，后经 diff 核对才恢复。
- **原因与证据**：`docs/V0.5.2-WIP-CHECKPOINT.zh-CN.md` 记录了 durable `0.5.2-dev` 与实际 local main 并存及落错工作区事故。2026-09-10 架构升级前，CWapi 跨仓库切换还出现过 active session / resolved commit 歧义，关闭句柄并用目标 `main@1bd2d02...` 重开后恢复正确。
- **正确动作**：每次执行器/仓库切换先核实实际 cwd/root、Git common dir、branch/HEAD、dirty 和用户目标；两边分别报告，禁止拼接。目标不清楚时只做独立只读检查。
- **最小验证**：`git rev-parse --show-toplevel`、`git rev-parse --git-common-dir`、`git rev-parse HEAD`、`git branch --show-current`、`git status --short`。
- **适用**：所有后续版本；尤其 CWapi / 本地 checkout 并存。
- **最后验证**：2026-09-10。
- **失效条件**：未来若只有一个明确 worktree，也仍应核实，但无需额外双工作区比较。

## PERF-L3-001：研究代码不等于运行时功能

- **状态**：有效 / 路线冻结。
- **触发**：准备重新启用 L3/Fiber/Official Navigation 自动扫描或 adaptive recovery。
- **错误做法**：把高成本只读研究扫描挂到正常 Timeline 点击、post-navigation 或 DOM mutation 路径，以为“不写 scrollTop”就没有 UX 成本。
- **原因与证据**：`docs/V0.5.2-FAST-PATH-CHECKPOINT.zh-CN.md` 与 `docs/V0.5.2-FINAL-ACCEPTANCE.zh-CN.md` 记录 64–67 marker × Fiber/key-join 深扫造成 Codex 主线程明显卡顿；冻结自动运行后实机卡顿消失。
- **正确动作**：保持 `OFFICIAL_NAVIGATION_RUNTIME_ENABLED=false`、`L3_RUNTIME_ENABLED=false`。研究需要时只手动单次执行，并用新的性能证据证明收益大于成本后再讨论产品化。
- **最小验证**：普通 Timeline 点击不得触发自动 L3 深扫；完整产品门禁 + 实机导航性能回归。
- **适用**：v0.5.2 起的当前架构。
- **最后验证**：2026-09-10。
- **失效条件**：宿主提供稳定公开接口，或新算法在真实长会话证明近零主线程成本且不破坏现有快路径。

## COMPAT-SCROLL-001：协调宿主滚动恢复所有权

- **状态**：有效。
- **触发**：Codex++“切换对话保留位置”、Local Work Timeline 导航、切换 thread 后位置回退。
- **错误做法**：只优化 wheel 导航，不考虑 Codex++ 已排队的 scroll restore/save 时序。
- **原因与证据**：`docs/V0.5.2-FINAL-ACCEPTANCE.zh-CN.md` 记录 A/B：关闭 Codex++ 保留位置后回弹消失。最终通过导航前 `markPointerIntent`、verified 后 `saveNow`，以及离开 Local thread 前 pre-switch `saveNow` 修复。
- **正确动作**：保留 `markPointerIntent → Work navigation → verified saveNow` 顺序；thread 切换前保存旧 thread 最新位置。不要用额外 Fiber 扫描替代宿主恢复协调。
- **最小验证**：保留位置开启；Earlier/Later 往返无底部回弹；Q63 切走再回来不恢复旧 Q54。
- **适用**：当前 Codex++ Local Work 兼容层。
- **最后验证**：2026-09-10。
- **失效条件**：Codex++ 删除/改变该恢复机制时重新实测，不永久假定 handler 语义。

## SHELL-PS-001：避免 PowerShell 保留变量和短别名

- **状态**：有效。
- **触发**：使用 PowerShell 做文本补丁或临时辅助函数。
- **错误做法**：把 `$Host` 当普通可写变量，或使用 `r` 作为自定义函数/命令名；前者是只读自动变量，后者可能命中 PowerShell alias。
- **原因与证据**：v0.5.2-dev 调试期间这两类壳层冲突都实际发生过，并曾生成一个误命名临时文件；最终经用户授权清理。
- **正确动作**：使用语义明确且不与自动变量/别名冲突的名称，例如 `$hostSource`、`ReplaceExact`。写文件优先 `.NET WriteAllText(..., UTF8Encoding(false))`，补丁后立即 `node --check`/语法检查和 Git diff。
- **最小验证**：补丁锚点存在才写；写后语法检查；`git status --short` 确认没有意外文件。
- **适用**：Windows 11 + PowerShell 7 项目维护。
- **最后验证**：2026-09-10。
- **失效条件**：换用其他 shell/补丁机制时仅保留“避免环境保留名并立即核对副作用”的原则。

## TEST-PATH-001：长工作区下缩短 fixture 路径

- **状态**：有效。
- **触发**：在 Windows/CWapi durable 等较长项目根下运行 Project Relay 隔离测试。
- **错误做法**：使用长时间戳 + 完整 GUID + 长场景名作为嵌套 Git fixture 路径。
- **现象与证据**：2026-09-10 首轮扩展套件出现多次 `Filename too long`，Git 无法创建 `.git/objects/...`；缩短为 `runtime/context/test-fixtures/r-xxxxxxxx/fNN` 后相同套件 26/26 PASS。
- **正确动作**：TestRoot 仍限制在项目内专用目录，但 run/fixture 目录使用短、唯一 ID；不要为了绕过长度限制把测试移到未授权项目外路径。
- **最小验证**：长根目录环境下完成 baseline commit、carrier commit 和 Unicode rename fixture；测试输出报告实际 fixture 根。
- **适用**：Windows 11 + 长 workspace 路径。
- **最后验证**：2026-09-10。
- **失效条件**：宿主/文件系统明确提供可靠长路径支持后可重新评估，但项目内 TestRoot 边界仍保留。

## NAV-TAIL-001：最后一问不等于对话最底部

- **状态**：有效。
- **触发**：Local Work 在整段对话物理最底部点击最后一问，最后一问后方存在较长 assistant 回复，目标 user turn 已被虚拟化或位于视口上方。
- **错误做法**：因为目标 `targetOrder === maxKnownOrder` 就把“最后一问”与“physical tail”视为同一个位置，无条件向 `maxLogicalPosition` 吸底。
- **现象与证据**：2026-09-10 实机在物理最底部点击 Q71，Timeline 已知 Q71 但提示“未能定位 Q71，请再试一次”。代码检查确认 Later 路径对最后一问无条件 `endpointLogical = model.maxLogicalPosition`；若最后一问的 user turn 位于长 assistant 回复上方，吸底不会让目标重新挂载。
- **正确动作**：只有目标本身已在 tail 可见时才接受 physical-tail endpoint。Local Work 已在 physical tail、最后一问 DOM 未挂载且其 order 在当前已渲染 user-turn 之后时，使用有界 `work-tail-backtrack` 负向 wheel 回探，目标重新挂载后立即恢复正常 geometry alignment。
- **最小验证**：保留普通 Work Later 正向 wheel；非最后一问不得使用 tail 放宽；最后一问已可见时仍允许 tail verification；最后一问被长回复虚拟化时从 physical bottom 回探后 `verified=true`。
- **适用**：v0.5.2 后续 main 的 Local Work Navigation。
- **最后验证**：2026-09-10 自动回归；真实修复后的宿主复验待本次安装后确认。
- **失效条件**：Codex Desktop 改变 Local Work 虚拟化/scroll model，或未来有公开稳定的 turn navigation API 时重新评估。
## CACHE-ORDER-001：坏 cache 必须在恢复边界被拦截

- 状态：有效
- 触发：Timeline 缺 Q、duplicate order、stale cache、occupied-order 冲突。
- 错误做法：先把 cache 全量灌入 TurnIndex，再等待 reconcile 或 navigation 在后续阶段发现污染。
- 正确动作：TimelineCache load/save 先验证 id/order 不变量；duplicate、invalid 或内部 gap 视为 corrupt。仅 self-describing fallback anchor 可以 salvage，其余 fail-closed。
- 原子性要求：repair snapshot 必须先完整验证，再替换旧 TurnIndex；验证失败不得先 clear。
- 最小验证：gapped UUID cache 返回 rejected；duplicate cache 只保留可信 anchor；非法 snapshot 替换失败后旧 index 内容不变。
- 适用：v0.5.3 及后续 Chat Timeline。
- 最后验证：2026-09-20，自动回归 PASS。

## SCROLL-OWNER-001：同一时刻只能有一个滚动所有者

- 状态：有效
- 触发：bootstrap、repair、manual Earlier / Load All、Timeline navigation 同时可能驱动虚拟列表。
- 错误做法：只靠各自 promise 或局部 flag 判断，不定义统一 ownership，导致两个控制器都认为自己可以继续写 scrollTop。
- 正确动作：汇总 scrollOwnership；正常状态只能是 idle 或单一 owner。出现 conflict 视为诊断异常。bootstrap 持有 scroll 时 manual Load All fail-closed；repair 期间 navigation 不启动。
- v0.5.4 约束：任何 fast path candidate 只能在 order health healthy、identity stable、scroll owner idle 时启动；否则直接走 v0.5.3 baseline。
- 最小验证：bootstrap + manual Load All 不产生第二次 hydration；人工构造双 owner 时 diagnostics.conflict=true。
- 适用：v0.5.3 及后续所有导航/快路径研究。
- 最后验证：2026-09-20，自动回归 PASS。

## 维护规则

- 只记录有证据、可复用的失误、防错动作或冻结路线；不保存每轮尝试。
- 同一原因合并，正文链接 KNOWN-ISSUES、release/fast-path 或测试证据，不复制全文。
- 每条注明适用版本、最后验证时间、失效条件；发现反证时保留旧条目并标记替代关系。
- 只读检索不写文件；仅在用户已授权的实施/收口或明确记录任务中更新。