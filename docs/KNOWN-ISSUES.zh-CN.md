# GPT TalkEnhancer Known Issues

本文记录 GPT TalkEnhancer Desktop 已确认的问题、0.5.0 修复结果与 0.5.1 性能收口。`v0.5.0` 保留为上一版正确性基线，`v0.4.5` 仍是冻结的 0.4.x 历史基线。

## UI-001：全屏 + 折叠左侧栏时 Timeline 跟随侧栏 hover 隐显

- 类型：Desktop UI compatibility
- 状态：Fixed / Real runtime PASS
- 版本：0.5.0
- 首次记录：2026-09-07

### 原现象

窗口化 Codex 中折叠左侧栏后再最大化/全屏，Timeline 会跟随左侧栏 hover overlay 一起出现/消失；固定展开左侧栏后恢复。

### 0.5.0 最终修复

不再为了维持 Timeline 可见性而保留或猜测 Local Conversation identity。最终采用“UI 可见性与会话身份解耦”：

- `ConversationAdapter` 可判断真实可见的 conversation root / user turn；
- 左侧 selected row 短暂消失但正文仍可见时，Surface 仍保持 `CONVERSATION`；
- Bootstrap 只保留当前 Timeline 视图与 scroll binding；
- 不 reindex、不写 cache、不 `saveNow`、不启动新的导航身份；
- 真实 identity 恢复后回到正常路径。

真实验收覆盖窗口化、最大化、侧栏折叠、hover overlay、右侧移出和固定展开往返，未再复现。

## UI-002：Codex Settings 页面错误显示 Prompt 按钮

- 类型：Surface / Prompt visibility
- 状态：Fixed / Real runtime PASS
- 版本：0.5.0
- 首次记录：2026-09-07

### 0.5.0 最终修复

- Settings 一律视为 Prompt 禁用 Surface；
- 收紧 New Chat Composer 判定，不再把普通 `textarea[placeholder]` 当成 Composer；
- Prompt 只允许在 `NEW_CHAT` / `CONVERSATION` 出现；
- 进入 `SETTINGS` 时已打开的 Prompt Panel 会直接关闭；
- 返回 Conversation / New Chat 后正常恢复。

真实验收通过。

## NAV-001：长 Chat `Q76 → Q1` 提前报未定位到

- 类型：Navigation correctness / virtualization timing
- 状态：Fixed / Real runtime PASS
- 版本：0.5.0
- 首次记录：2026-09-07
- 原复现：长 Chat 从后段点击 Q1，曾在 Q17/Q16、随后 Q13/Q14 附近提前失败

### 最终根因

真实运行时诊断先后显示：

- `probes=256`
- `stalls=0`
- `budgetLimit="probes"`
- 放宽 probe 后变为 `budgetLimit="absolute-time"`
- `conversationIdentity.host="chatgpt"`
- Chat 实际同样使用 `column-reverse`

旧逻辑把“`column-reverse + Earlier`”一律送进 Local Work 专用 wheel hydration，因此 Chat 被错误使用较慢的 Work 路径。导航一直有真实进展，但先耗尽 256 probe，随后又撞到 45 秒 absolute hard limit。

### 0.5.0 最终修复

- Earlier 路径改为按真实 Host identity 区分，而不是用 `column-reverse` 猜宿主；
- 只有 `host=local + source=sidebar-local` 才进入 Local Work wheel hydration；
- `host=chatgpt` 即使是 `column-reverse`，也走通用 progressive logical jump；
- Chat Q1 在持续产生真实 hydration progress 时可超过 256 probe；
- 仍保留 consecutive stall、约 5 秒 inactivity、45 秒 absolute hard limit、`verifyAndAlign` 与 post-settle 安全边界；
- Settings / Surface 中断仍通过 `superseded` 取消，不回滚已提交给宿主的最后一次滚动。

最终真实复测：`Q76 → Q1` 明显加速，并连续往返测试通过。

## WORK-001：刚进入 Local Work 后点击靠近 tail 的目标发生回弹

- 类型：Host restore timing
- 状态：Fixed / Real runtime PASS
- 版本：0.5.0
- 首次记录：2026-09-07

### 原现象

刚点击进入 Local Work 会话后立即点击 Timeline，例如 Q1～Q6 会话点 Q4，或点击最后一问的上一问，正文会在目标与最后一问之间来回跳。

### 0.5.0 最终修复

保留既有 `saveNow(explicitLocalSessionUuid, exactScrollContainer)` Restore 机制，不回退 0.4.4 已验证的持久化修复。

仅新增一个窄的 Local Work restore settle gate：

- 点击 Local Work sidebar row 后记录 500ms settle window；
- 若用户在该窗口内立即发起 Timeline 导航，先等待宿主自己的 scroll restore 落稳；
- Chat 不走此 gate；
- 已经打开超过该窗口的 Work 不增加延迟；
- Work wheel、tail verification、post-settle 与 Restore persistence 不变。

最终真实复测未再出现回弹。

## OPT-001：Chat / Work Timeline Navigation 提速

- 类型：Performance / UX Optimization
- 状态：**Resolved in v0.5.1 / residual host virtualization**
- 优先级：Closed
- 首次记录：2026-09-07
- 收口：2026-09-08

### v0.5.1 结果

在 v0.5.0 正确性基线上完成并真实验收：

- 已挂载稳定目标使用 guarded mounted fast settle；
- Chat Earlier 使用 8ms motion gate、自适应 jump scale、远距离 `chat-coalesced` 与 progress-renewed boundary hydration；
- Work Earlier 保留独立 wheel / restore 语义，仅对长距离 wheel step 做保守自适应；
- Local Work 500ms restore settle、`saveNow`、tail verification、post-settle 与 fail-closed 全部保留；
- 自动慢导航诊断用于区分 GPT TalkEnhancer pacing 与宿主 virtualization / hydration。

真实验收：

- Chat `Q76 → Q1` 明显提速并正确定位；
- Work 长距离 Earlier 提速；
- Work 无回弹；
- Chat 多次长距离尝试中偶尔仍可能出现 1～2 次宿主虚拟化卡顿，也可能全程无明显卡顿。该残余主要来自 Codex / ChatGPT 宿主窗口重建，不再通过继续压低脚本等待时间追求速度。

### 结论

0.5.1 以当前参数冻结 Navigation 性能基线。继续激进提速的边际收益已不足以抵消正确性与 Restore 回归风险。
