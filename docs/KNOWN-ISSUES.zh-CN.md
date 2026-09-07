# GPT TalkEnhancer Known Issues

本文记录已经确认存在、但不会回填到 0.4.x 冻结基线的问题。除非问题升级为阻塞性回归，否则修复进入 0.5.x。

## UI-001：全屏 + 折叠左侧栏时 Timeline 跟随侧栏 hover 隐显

- 状态：Open
- 优先级：Medium
- 计划版本：0.5.x
- 首次记录：2026-09-07
- 影响范围：Codex Desktop；当前仅在“窗口化 → 折叠左侧栏 → 再最大化/全屏”路径中复现
- 0.4.x：不修，保持 `v0.4.5` 冻结

### 复现步骤

1. 以窗口化方式打开 Codex Desktop。
2. 折叠左侧侧边栏。
3. 将 Codex Desktop 最大化/全屏。
4. 此时右侧 GPT TalkEnhancer Timeline 会跟随左侧侧边栏一起自动隐藏。
5. 鼠标移动到左侧边缘，Codex 左侧侧边栏以 hover/overlay 方式显示时，Timeline 也跟随出现。
6. 鼠标移到右侧，左侧侧边栏收起，Timeline 随之再次隐藏；右侧本身没有独立 hover 响应。
7. 重新把左侧侧边栏设置为展开/固定状态后，Timeline 自动恢复正常显示。

### 对照行为

- 在窗口化状态下折叠左侧侧边栏，不会出现该问题。
- 展开/固定左侧侧边栏后，Timeline 正常。

### 期望行为

Timeline 的可见性应由当前 Surface、Conversation viewport 和自身显示状态决定，不应依赖左侧侧边栏当前是固定展开、折叠还是 hover overlay。

### 后续排查范围

优先检查以下边界，不先修改 Navigation / TurnIndex / Timeline Cache：

- `AppShell.syncTimelineLayoutObserver()` / `refreshTimelineLayout()` 的 viewport 绑定是否在窗口模式切换后指向错误或暂时隐藏的节点；
- Codex Desktop Host 的 `getConversationViewportElement()` / `getConversationViewportRect()` 在“最大化 + collapsed sidebar overlay”状态下是否发生身份或几何变化；
- ResizeObserver / visualViewport resize 是否遗漏最大化后侧栏 overlay 状态切换；
- Timeline host/root 是否意外继承了宿主侧栏相关的 display / visibility / clipping 状态。

修复验收必须至少覆盖：窗口化、最大化、侧栏固定展开、侧栏折叠、左侧 hover overlay、右侧鼠标移入，以及状态之间往返切换。
## UI-002：Codex Settings 页面错误显示 Prompt 按钮

- 状态：Open
- 优先级：Medium
- 计划版本：0.5.x
- 首次记录：2026-09-07
- 影响范围：Codex Desktop Settings surface
- 0.4.x：不修，保持 `v0.4.5` 冻结

### 现象

进入 Codex 设置页面后，GPT TalkEnhancer 的 Prompt Trigger 仍可能显示在页面左下/输入区域附近。Settings 页面不是对话输入 Surface，这个按钮在此处没有合理交互目标。

### 期望行为

采用明确的一刀切策略：

- `SETTINGS` surface 永远不显示 Prompt Trigger；
- `SETTINGS` surface 永远不显示 Prompt Panel；
- Prompt 仅允许在 `NEW_CHAT` 与 `CONVERSATION` surface 出现；
- 进入 Settings 时若 Prompt Panel 已打开，应立即关闭/隐藏；
- 离开 Settings 回到 New Chat / Conversation 后，Prompt 能正常恢复。

### 后续排查范围

优先检查 Surface 识别和 UI visibility 同步，不先改 Prompt Library 核心：

- `SurfaceDetector` 是否在 Codex 设置页被误判为 `NEW_CHAT` / `CONVERSATION`；
- `AppShell.setSurface()` 是否在 surface 切换后存在漏更新或异步竞态；
- Prompt Trigger 的 composer anchor/rebind 是否会在 Settings 中绕过 `setVisible(false)`；
- Settings 页面 DOM 更新后是否触发了错误的 Prompt 重新挂载。

### 修复边界

0.5.x 默认不为 Settings 页面适配 Prompt 功能。除非后续出现明确产品需求，否则 Settings 直接视为 Prompt 禁用 Surface。

修复验收至少覆盖：Conversation → Settings → Conversation、New Chat → Settings → New Chat、Settings 页面内部切换不同设置项，以及 Prompt Panel 打开状态下进入 Settings。
