# 实验性补充评审：Codex Goal Progress

状态：EXPERIMENTAL / SOURCE REVIEW ONLY / WINDOWS NOT VERIFIED
日期：2026-09-21
研究对象：[ezra-y/codex-goal-progress](https://github.com/ezra-y/codex-goal-progress)
固定提交：`797dbff152b1b875ea957b12e41440917103b1db`（本轮查询 main）
manifest 版本：0.3.8

## 1. 结论

对 GTE 有较强的架构参考价值，但不是无需注入的官方 UI 扩展 SDK，也不能直接作为 Windows 实验包安装。

它使此前方案中的一条表述需要收窄：**“需要改造并编译 Codex++”只适用于把后台放在 Codex++ 原生进程内部；独立无窗口 Helper 并不要求这样做。** 无窗口 Helper 是后台进程，不是用户已拒绝的独立聊天客户端。

优先借鉴：后台唯一写入者、展示数据模型、独立组件、单实例页面管理、受限 UI 意图与断线恢复。不能照搬：macOS 安装/启动链、App Server 数据查询、宽范围 observer，以及 Goal 专用业务。

这支持增加候选 B，但尚不足以证明 B 在 Windows 上比 A 更可靠。后续先比较 B 的通信、安全和生命周期成本，再决定是否值得维护 Codex++ Rust 补丁。

## 2. 它如何修改页面（已读源码）

```text
Plugin 的 Skill / Hooks / MCP
             |
独立本地 Helper：数据校验、状态写入、计算展示模型
             |
CDP 调试连接：装载页面 bundle、更新页面组件
             |
Page Host：识别锚点、创建/维护唯一组件
             |
Lit Web Component + Shadow DOM：显示进度
```

1. `cdp.ts` 的 `installGoalProgressPageBundle` 调用 `Page.addScriptToEvaluateOnNewDocument`，同时用 `Runtime.evaluate` 把 bundle 执行到当前页面。不是仅靠 MCP/Plugin manifest 获得页面插槽。
2. `browser-entry.ts` 注册组件并安装自己的 Page Host；页面全局入口为 `__CODEX_GOAL_PROGRESS__`。
3. `sidecar-mount.ts` 创建自定义元素，通过 `anchor.parentElement.insertBefore(...)` 插到 Goal 锚点旁；备用展示通过 `document.body.append(host)` 挂载。
4. Lit/Shadow DOM 用于组件渲染和样式封装，布局还依赖宿主 DOM、字体/主题变量和尺寸。Shadow DOM 不是权限或数据保密边界。
5. Page Host 通过 observer 和有界协调处理 root/布局变化、隐藏与重挂载；Renderer Bridge 用 CDP binding 传受限 UI 意图。
6. macOS 启动层配置 loopback remote-debugging 参数；安装/修复可能要求重启 Codex，因此本次不执行安装、启动或 probe。

上述源码足以说明页面修改机制，不证明用户当前 Codex 版本的实机兼容性。

## 3. 值得借鉴的部分

| 设计 | GTE 可能收益 | 限制 |
| --- | --- | --- |
| Helper 唯一写入者 | Prompt/设置/快照不由多个页面实例并发写文件 | 必须设计 revision、幂等和故障恢复 |
| ViewModel 仅展示 | UI 不承担完整索引的重建和修复 | GTE 仍需安全的页面 observation 入口 |
| Page Host 单实例 | 统一 mount/update/unmount 与版本核验 | 不能把 Goal 专用管理器原封不动搬入 Timeline |
| Web Component / Shadow DOM | 样式隔离，减少和宿主 CSS 的冲突 | 不解决宿主锚点变更和虚拟化历史 |
| 受限 UI 意图、超时/断线处理 | 比开放任意页面命令更容易测试 | nonce 和页面自报 userActivated 不是强安全鉴权 |
| Node/TypeScript 后台 | 可能复用现有 JS Core，减少跨语言重写 | Windows 进程、IPC、更新和分发仍需实现/验证 |

UI 可以借鉴“读取宿主公开 DOM 与 CSS”的方式，但 GTE 不增加 Goal 进度产品功能；范围继续限于 Timeline 与 Prompt Library。

## 4. 不能直接照搬的证据

- README 的用户支持范围是 Apple Silicon macOS。虽然输入类型出现 `windows`，`createDefaultCodexNativeGoalLocatorRegistry()` 实际只注册 `macosGoalRowV1Locator`。类型占位不等于 Windows 支持。
- `packages/codex-adapter/src/index.ts` 启动 `codex app-server --stdio`，并调用 `thread/read`、`thread/list`、`thread/turns/list` 等来核验数据。**本项目明确禁止前两者；不复制或执行这条数据链。** 不因它自称使用公开 App Server 就绕过 GTE 更严格的边界，也不将所有这些方法一概误称为私有接口。
- 该项目展示的是 Goal 的自有清单状态，不是完整历史 Timeline；不能据此推断获得了 Chat/Work 全量记录或稳定跳转能力。
- `page-host.ts` 仍观察 `document.documentElement` 子树；浮动障碍检查还观察 body。过滤与去抖值得参考，但并非 GTE 窄范围观察目标的现成解法；性能需要自己的 fixture 和实机证据。
- 插件中的 shell 启动入口、launchd 和 Unix socket 策略是 macOS 路线；移植时不能只改一个 platform 字段。
- 上游描述回归覆盖，并不表示本轮运行过测试。本次只读了文档和相关源码，未完成整个项目安全审计。

## 5. 对 GTE 实验方案的影响

| 路线 | 后台归属 | 页面装载 | 主要新增成本 |
| --- | --- | --- | --- |
| A：原生模块 | Codex++ 内部 Rust 服务 | Codex++ 统一装载 | 上游补丁、Rust 构建、共用桥接回归 |
| B：独立 Helper | GTE 自有无窗口 JS/TS 服务 | 候选为 Codex++ 小型适配入口；独立 CDP 装载暂不选定 | Windows IPC/进程隔离、端点安全、部署生命周期 |
| C：保守页面重构 | 现有 JS 页面 Core | 现有 Codex++ 加载器 | 后台隔离能力有限，但维护成本较低 |

B 在本项目的首选研究形态不是整套复制 Goal Progress，而是“独立 GTE Core/Helper + 最小 Codex++ 页面入口”。**这只是候选**：现有加载器只解决页面代码装载，没有现成证明它能安全访问 Helper。必须证明受限的 Windows 通信方式、端点归属、页面来源校验与失联处理；不得临时开放任意文件/命令 HTTP 服务凑通。

若为连接 Helper 仍需改 Codex++ 原生代码，必须实测补丁规模，与 A 对比，不能宣称 B 已消除 fork 成本。若采用独立 CDP 加载，则是另一个宿主连接所有者，需要验证和 Codex++ 共存、启动参数及升级恢复；本轮不选择或启动这条路径。

共同协议测试先行，不给 Core 写入任何 Codex++ 路由、Goal 数据结构或宿主 selector。只有路线门槛通过后，才进入对应的运行时实现。

## 6. 固定源码引用

- [架构说明](https://github.com/ezra-y/codex-goal-progress/blob/797dbff152b1b875ea957b12e41440917103b1db/docs/ARCHITECTURE.md)
- [权限与启动边界](https://github.com/ezra-y/codex-goal-progress/blob/797dbff152b1b875ea957b12e41440917103b1db/docs/PERMISSIONS.md)
- [页面注入入口 cdp.ts](https://github.com/ezra-y/codex-goal-progress/blob/797dbff152b1b875ea957b12e41440917103b1db/packages/codex-adapter/src/cdp.ts#L580-L622)
- [DOM 挂载 sidecar-mount.ts](https://github.com/ezra-y/codex-goal-progress/blob/797dbff152b1b875ea957b12e41440917103b1db/packages/codex-adapter/src/sidecar-mount.ts#L580-L593)
- [平台注册 anchor-adapter.ts](https://github.com/ezra-y/codex-goal-progress/blob/797dbff152b1b875ea957b12e41440917103b1db/packages/codex-adapter/src/anchor-adapter.ts#L494-L496)
- [App Server 请求实现](https://github.com/ezra-y/codex-goal-progress/blob/797dbff152b1b875ea957b12e41440917103b1db/packages/codex-adapter/src/index.ts#L273-L310)
- [页面 observer](https://github.com/ezra-y/codex-goal-progress/blob/797dbff152b1b875ea957b12e41440917103b1db/packages/codex-adapter/src/page-host.ts#L771-L819)

关系文档：[候选 A 及共用协议、安全门槛](EXPERIMENTAL-CODEXPP-HOSTED-GTE.zh-CN.md)、[实验准备](../experiments/gte-hosted-module/README.md)。
