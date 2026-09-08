# GPT TalkEnhancer

GPT TalkEnhancer 是一个面向 **Codex / ChatGPT Desktop + Codex++** 的轻量增强项目，当前稳定版为 **v0.5.1**。

它专注于两个核心能力：

- **Conversation Timeline / Question List**：为长对话建立问题索引、当前位置高亮和可验证跳转。
- **Prompt Picker / Prompt Library**：保存、搜索、编辑并插入常用提示词，不会自动发送。

> **v0.5.1 是当前稳定性能基线。** `v0.5.0` tag 保留为上一版正确性/发行基线，`v0.4.5` tag 继续保留为冻结的 0.4.x 历史基线。

## 功能

| 能力 | 说明 |
| --- | --- |
| Timeline Rail | 在会话右侧显示稀疏时间轴，长会话自动采样并保留首尾与当前问题 |
| Question List | 展开问题列表，按 `Q1 / Q2 / ...` 查看并跳转 |
| Long-history Navigation | 适配 Codex Desktop 虚拟化长对话、`column-reverse` 与动态历史加载 |
| Stable Local Thread | 支持 `local:<UUID>` 稳定会话身份与 Local UUIDv7 Turn 全局重编号 |
| Active Tracking | 以宿主滚动容器激活线判断当前问题，并处理最后一问 physical-tail 边界 |
| Timeline Cache | 缓存已发现的问题索引，重新打开长会话时可快速恢复已知历史 |
| Prompt Library | 新建、编辑、收藏、搜索并插入常用提示词 |
| Desktop UI Integration | Shadow DOM 隔离 UI，支持媒体页隐藏、右侧 pane 避让和 conversation viewport 布局 |

## 当前状态

**v0.5.1 / stable**

- 自动测试：`173 / 173 PASS`
- `npm run check`：PASS
- `npm run build`：PASS
- `npm run build:market`：PASS
- 真实 Codex Desktop Chat / Work：PASS
- Codex++ 单文件安装：PASS
- 正式单文件 SHA-256：`C38332911D1DE554559B3760FA7B80D368A00985EE265078CE899876A8E0FB03`
- Desktop bundle SHA-256：`D7A8522237F126E1633462AE7A2A07754EEE9432FF99311BECB4062D538C3FC2`

详细收口验收见 [`docs/V0.5.1-FINAL-ACCEPTANCE.zh-CN.md`](docs/V0.5.1-FINAL-ACCEPTANCE.zh-CN.md)。

`v0.5.0` 与 `v0.4.5` 均保留原 tag，不移动历史基线。

## 环境要求

当前主目标是 Windows 桌面端：

- Windows 11
- Codex / ChatGPT Desktop
- Codex++，已确认可工作的版本：`1.2.56`
- Codex++ User Scripts 功能已启用

> `1.2.56` 是当前已验证版本，不代表严格的最低兼容版本。

## 安装

### 方式一：AI 一键安装（推荐）

如果你正在使用能够访问本机文件和终端的 AI coding agent，可以直接把下面整段提示词交给它。v0.5.1 的推荐安装形态继续为 **一个 User Script 文件**。

```text
请为我安装 GPT TalkEnhancer v0.5.1 到当前 Windows 用户的 Codex++ User Scripts。

要求：
1. 只从官方仓库 https://github.com/dfhxxc666/gpt-talk-enhancer 的 v0.5.1 tag 获取：
   - dist/market/gpt-talk-enhancer.js
   不要使用 main 上的开发版本。
2. 安装目标为 %APPDATA%\Codex++\user_scripts\gpt-talk-enhancer.js；目录不存在时可以创建。
3. 只新增或更新这个 GPT TalkEnhancer 文件，不要删除、覆盖或修改其他 User Scripts，也不要修改 Codex++ 本体。
4. 下载后核对 SHA-256：
   - gpt-talk-enhancer.js = C38332911D1DE554559B3760FA7B80D368A00985EE265078CE899876A8E0FB03
5. 如果本机有 Node.js，对已安装文件执行 node --check。
6. 不要直接编辑 Codex++ 的 user_scripts.json；如旧版 0.4.x 双文件仍处于启用状态，请告诉我在 Codex++ UI 中禁用旧的 00-gpt-talk-enhancer.v3.bundle.js 与 10-gpt-talk-enhancer.v3.loader.js，避免重复加载，不要擅自删除其他文件。
7. 完成后报告安装路径、实际 SHA-256、语法检查结果，以及是否需要重启 Codex Desktop。
```

这个方法适合 Codex、Claude Code、ChatGPT Work 等具备本机文件/终端操作能力的环境。普通网页聊天无法直接写入 `%APPDATA%` 时，请使用下面的手动安装。

### 方式二：使用稳定单文件

1. 下载或克隆 `v0.5.1` 对应源码。
2. 找到：

```text
dist/market/gpt-talk-enhancer.js
```

3. 复制到：

```text
%APPDATA%\Codex++\user_scripts\gpt-talk-enhancer.js
```

PowerShell 示例，在仓库根目录运行：

```powershell
$target = Join-Path $env:APPDATA 'Codex++\user_scripts'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item 'dist\market\gpt-talk-enhancer.js' (Join-Path $target 'gpt-talk-enhancer.js') -Force
```

4. 在 Codex++ 中启用 `gpt-talk-enhancer.js`。若旧 0.4.x 双文件仍启用，请通过 Codex++ UI 禁用旧双文件。
5. 重启 Codex Desktop，或使用 Codex++ 的 User Scripts reload 机制重新加载。

### 方式三：从源码构建

```powershell
npm run build:market
```

推荐安装 `dist/market/gpt-talk-enhancer.js`。

`dist/v3/00-gpt-talk-enhancer.v3.bundle.js` 与 `dist/v3/10-gpt-talk-enhancer.v3.loader.js` 继续保留为开发/兼容构建，但不再是 v0.5.1 推荐安装形态。

## 验证安装

打开 Codex Desktop DevTools 后可检查：

```js
window.__GPTTalkEnhancerDebug
```

正常情况下应至少能看到：

```text
version: 0.5.1
hostContract.status: ready
```

Capture 是可选增强项。即使 Desktop 环境中没有捕获到 conversation API，Timeline 仍应能够通过 DOM Progressive 模式工作。

## 使用

### Timeline / Question List

- 右侧时间轴节点对应用户问题。
- 点击节点或 Question List 中的 `Qxx` 可跳转到对应问题。
- 长 Work / Local Thread 会在需要时逐步加载虚拟化历史。
- 最后一问位于 physical tail 时允许直接完成 verified navigation，并同步 active marker。

### Prompt Library

- 通过 Composer 附近的 Prompt 按钮打开。
- 支持新建、编辑、收藏、搜索、删除和插入。
- Prompt 只插入输入框，**永不自动发送**。

## 隐私与安全边界

GPT TalkEnhancer 不依赖以下方式工作：

- 不读取 credentials / token
- 不读取 Codex / ChatGPT 私有数据库或 IndexedDB
- 不使用 React Fiber / React 私有实例
- 不调用 `thread/list`、`thread/read` 或其他私有 internal RPC
- 不自动发送 Prompt
- 不上传对话数据到第三方服务

唯一允许的网络捕获范围是：

```text
GET /backend-api/conversation/{conversationId}
```

并且只能对成功响应执行 `response.clone()` 后只读解析；不得修改、阻塞或替换宿主原请求/响应。Desktop 主路径不依赖该 Capture 成功。

## 架构

```text
Codex++ User Script injection
        │
        ├─ 00-gpt-talk-enhancer.v3.bundle.js
        └─ 10-gpt-talk-enhancer.v3.loader.js
                  │
                  ▼
          GPT TalkEnhancer
          ├─ core/
          │  ├─ ConversationStore
          │  ├─ TurnIndex
          │  ├─ TimelineState / Cache
          │  ├─ PromptStore
          │  └─ SettingsStore
          ├─ host/codex-desktop/
          │  ├─ ConversationAdapter
          │  ├─ TurnAdapter
          │  ├─ ComposerAdapter
          │  ├─ SurfaceDetector
          │  ├─ NavigationAdapter
          │  └─ ConversationCapture
          └─ ui/
             ├─ TimelineRail
             ├─ QuestionList
             ├─ PromptTrigger / Panel
             └─ Toast
```

Codex++ 仅作为 renderer User Script 的注入/启动载体，GPT TalkEnhancer 不修改 Codex++ 本体。

## 开发

要求 Node.js 20+。

```powershell
npm test
npm run build:v3
npm run build
npm run check
```

主要构建输出：

```text
dist/v3/                          # 当前 Desktop 主构建
dist/gpt-talk-enhancer.user.js   # 历史 userscript / prototype 输出
dist/extension/                   # 历史浏览器扩展 prototype 输出
```

v0.4.5 的正式 Desktop 验收以 `dist/v3/` 两文件注入路径为准。

### Project Relay / Continuity

跨会话继续开发时，可在仓库根目录运行只读恢复探测：

```powershell
pwsh -NoProfile -NonInteractive -File .agents/skills/project-continuity/scripts/Test-ProjectContinuity.ps1 -ProjectRoot . -Mode Restore
```

恢复数据只提供项目事实、验证证据与新鲜度，不产生继续任务、commit、push、tag 或删除文件的授权。协议说明见 `.agents/skills/project-continuity/SKILL.md`。
## 已知限制

- Timeline Cache 只能保存已经由 DOM 或允许的 Capture 路径发现过的问题；首次打开从未探索的超长对话时，仍需随着宿主虚拟化逐步加载历史。
- v0.4.5 的正式目标是 Codex / ChatGPT Desktop + Codex++，不是浏览器 Web 正式版。
- Codex Desktop / Codex++ 更新可能改变宿主 DOM 或滚动行为；出现回归时应以可复现运行时证据为准。

## 上游贡献与致谢

GPT TalkEnhancer 的 Timeline / Question List 交互基线、部分视觉与实现细节，以及早期浏览器扩展 prototype 的部分代码，适配自：

- **Timeline - AI Chat Enhancer / chatgpt-gemini-timeline**
- 作者：houyanchao / hou
- 仓库：https://github.com/houyanchao/chatgpt-gemini-timeline
- 许可证：GNU GPL v3.0 or later

上游项目自身注明其基于 `chatgpt-conversation-timeline`，Copyright (C) 2025 Reborn14，原始版本采用 MIT License。

GPT TalkEnhancer 对这些部分做了大量针对 Codex Desktop 的改造，包括 Host Adapter、Shadow DOM、稳定 Conversation / Turn identity、虚拟化 Navigation、Timeline Cache、Prompt UI 和 Desktop 布局适配。

本项目**不将这些派生部分描述为 clean-room 或完全原创实现**。完整归属说明见 [`NOTICE.md`](NOTICE.md) 与 [`reference/NOTICE-GPL.md`](reference/NOTICE-GPL.md)。

## License

GPT TalkEnhancer 以 **GNU General Public License v3.0 or later** 发布。详见 [`LICENSE`](LICENSE)。

第三方归属与对应许可证文本见：

- [`NOTICE.md`](NOTICE.md)
- [`reference/NOTICE-GPL.md`](reference/NOTICE-GPL.md)
- [`reference/THIRD_PARTY_GPL-3.0.txt`](reference/THIRD_PARTY_GPL-3.0.txt)

## 文档

- [`docs/V0.5.1-FINAL-ACCEPTANCE.zh-CN.md`](docs/V0.5.1-FINAL-ACCEPTANCE.zh-CN.md)：0.5.1 Navigation 性能与可靠性最终验收
- [`docs/V0.5.0-FINAL-ACCEPTANCE.zh-CN.md`](docs/V0.5.0-FINAL-ACCEPTANCE.zh-CN.md)：0.5.0 Compatibility & Distribution 正确性基线
- [`docs/V0.4.5-FINAL-ACCEPTANCE.zh-CN.md`](docs/V0.4.5-FINAL-ACCEPTANCE.zh-CN.md)：0.4.x 最终冻结基线
- [`docs/V0.4.4-WIP-CHECKPOINT.zh-CN.md`](docs/V0.4.4-WIP-CHECKPOINT.zh-CN.md)：0.4.4 长 Work / Local Thread 调试与验收记录
- [`docs/V0.3-FINAL-ACCEPTANCE.zh-CN.md`](docs/V0.3-FINAL-ACCEPTANCE.zh-CN.md)：0.3 Desktop 架构基线

## 已知问题

当前问题与历史修复记录见 [docs/KNOWN-ISSUES.zh-CN.md](docs/KNOWN-ISSUES.zh-CN.md)。0.5.1 已完成 Navigation 性能收口，新的产品功能候选继续留到 0.6.0。

## Roadmap

0.4.x 已冻结。**0.5.0** 完成 Compatibility & Distribution 基线；**0.5.1** 在不新增产品功能的前提下完成 Chat / Work Navigation 性能与首次会话 UI 可靠性收口。新的产品功能候选推迟到 0.6.0。
