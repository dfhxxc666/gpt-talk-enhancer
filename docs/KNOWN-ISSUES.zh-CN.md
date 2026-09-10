# GPT TalkEnhancer Known Issues

本文记录 GPT TalkEnhancer Desktop 已确认的问题与历史修复结果。v0.5.2 为当前稳定性与快路径基线；v0.5.1 保留为上一版 Navigation Performance 基线。

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

## OPT-002：Work Later 向下加载慢且有顿挫

- 类型：Performance / Local Work virtualization
- 状态：Fixed / Real runtime PASS
- 版本：0.5.2
- 收口：2026-09-10

v0.5.1 的 Local Work Earlier 已使用专用 wheel hydration，但 Later 仍回退到通用 progressive path。v0.5.2 将 stable `sidebar-local + column-reverse` 的 Later 纳入同一 Work wheel engine，使用正方向 wheel、约 120ms cadence、距离自适应 step，并在 physical tail 附近收敛。

真实验收：**向下卡顿感消失。**

## WORK-002：Codex++ 保留位置与 GPT TalkEnhancer 导航发生 restore 冲突

- 类型：Codex++ interoperability / scroll restore
- 状态：Fixed / Real runtime PASS
- 版本：0.5.2
- 收口：2026-09-10

两个相关现象已分别修复：

1. Codex++ 开启“切换对话保留位置”后，Timeline 导航完成发生底部回弹。当前在 Local Work 导航进入 settle 前先 `markPointerIntent`，verified 后继续 `saveNow`。
2. 用户手动浏览到新位置后切换 thread，再返回可能恢复旧保存点。当前在离开 stable Local thread 前，于 sidebar click capture phase 先 `saveNow(current thread, current scroll)`。

真实验收：**底部回弹消失；`Q63 → 切走 → 返回 Q54` 不再出现。**

## UI-003：宿主临时浮层覆盖 Prompt Trigger

- 类型：Desktop UI / Prompt overlay compatibility
- 状态：Fixed for reproduced hover-card case / Real runtime PASS
- 版本：0.5.2
- 收口：2026-09-10

Prompt Trigger 使用宿主浮层 blocker：visible dialog / aria-modal 直接阻止；非模态 popper/menu/listbox/tooltip 只有进入 composer/Prompt 邻近区域时阻止，远处普通 tooltip 不受影响。

真实验收：左侧 thread hover card 场景 **PASS**，浮层出现时 Prompt 隐藏，关闭后恢复。

Work 模型选择 popup 本轮未再次稳定复现，因此该具体场景不单独记作真实验收；当前通用 blocker 已覆盖同类宿主浮层条件。

## RESEARCH-001：Official Navigation / Fiber 自动深扫造成主线程卡顿

- 类型：Research / performance guard
- 状态：Runtime frozen in v0.5.2
- 版本：0.5.2
- 收口：2026-09-10

L3 exact key-join、adaptive rescan 和 mutation recovery 在研究阶段保留，但真实 Codex Desktop 证明自动 Fiber/key-join 深扫会明显拖慢主线程。

v0.5.2 固定：

```js
const OFFICIAL_NAVIGATION_RUNTIME_ENABLED = false;
const L3_RUNTIME_ENABLED = false;
```

正常 Timeline 点击不自动运行这些研究扫描；只保留手动 one-shot 研究入口。详细基线见 `V0.5.2-FAST-PATH-CHECKPOINT.zh-CN.md`。