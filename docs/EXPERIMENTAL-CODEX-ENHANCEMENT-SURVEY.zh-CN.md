# 实验性调研：Codex 客户端增强项目比较

状态：EXPERIMENTAL / SOURCE REVIEW / NOT AN INSTALLATION RECOMMENDATION
日期：2026-09-21

## 结论

在用户提供 Goal Progress 后，又搜索并筛查了五个相关项目的 README、架构说明和对应关键实现。这里不是全生态穷举，也不是完整安全审计；所有结论限定于下列提交，未安装、构建或在本机运行这些项目。

最值得组合借鉴的不是一个“大而全替代 Codex++”，而是：

- Goal Progress：后台唯一写入者 + 只读展示模型 + 独立页面组件。
- Codexion：进程/连接/业务/UI 的分层，目标归属核验与可撤销 UI。
- Codex Styler：Windows 装载入口、用户确认的重启边界、版本化根和旧响应防回写。
- b-nnett/codex-plusplus：明确的模块 scope、start/stop 和按模块隔离的数据设计，仅作契约参考。

**建议先验证“无窗口 GTE Helper + 最小内嵌组件”的成本，而不是立即改写 Codex++ Rust 后台。** 这是研究优先级，不是已确认可在当前 Windows Codex 中无补丁运行。Codex++ 内部原生模块继续作为候选 A，现有纯页面重构保留为低成本退路。

## 项目比较

| 项目 | 实现路径与已核实证据 | 借鉴价值 | 不直接采用的原因 |
| --- | --- | --- | --- |
| [Goal Progress](https://github.com/ezra-y/codex-goal-progress/tree/797dbff152b1b875ea957b12e41440917103b1db) | Plugin/Helper + CDP + Lit/Shadow DOM | 后台状态与页面生命周期分离 | 默认 locator 仅 macOS；数据链调用项目禁止的 thread/list、thread/read |
| [Codexion](https://github.com/lyuai/codexion/tree/3ab2fb8d4a91cba503313445bd56f1a954d04654) | 无窗口 Node 后台 + CDP 标题栏/UI 增强 | 进程归属核验、分层、注入节点唯一标识和 cleanup | macOS；默认启动链可能退出/强制终止再启动 Codex；通用扩展接口仍是文档提案 |
| [Codex Styler](https://github.com/xuhuanstudio/codex-styler/tree/ee3dce2e69cc2ec884f0567d4475eb33722054e5) | Tauri 管理器 + 受控 CDP + 独立主题层；有 Windows 打包应用启动代码 | Windows 生命周期、恢复、配置 revision 与数据白名单 | 是主题产品，不是 Timeline/后台数据 SDK；管理 UI 不属于 GTE 目标 |
| [ShimX](https://github.com/dugongzi/ShimX/tree/33a92c6f1d622f1ff66ffa02bbba3b3aab5b45fb) | Flutter/Dart 后台 + CDP + window.shimxApi | 用户脚本可用的桥接包装、订阅取消和 DOM 助手 | 部分内置功能使用 React 内部属性、导入私有运行时、改写请求链；范围过宽 |
| [b-nnett/codex-plusplus](https://github.com/b-nnett/codex-plusplus/tree/f98e7e9d1fa068dde9e0dddfb43b128acb4e2fd7) | 修改 app.asar loader + main/preload + 第三方 tweak SDK | start/stop、main/renderer scope、热重载清理、模块存储边界 | 修改应用包/签名与更新维护成本；文档还暴露 Fiber 能力；不适合作为当前默认安装路线 |
| [Explodex](https://github.com/dan-dr/explodex/tree/ab0aeab4299bf1dc8da94ebd9abe77a0f8c771ac) | CDP SDK、DOM 区域挂载、插件目录与设置入口 | 小型挂载契约、组件外观和插件销毁职责 | macOS；作者脆弱性清单确认 AppServer 捕获/全局 monkeypatch/Fiber 依赖，与本项目规则冲突 |

特别注意：`b-nnett/codex-plusplus` 与用户已安装的 `BigPizzaV3/CodexPlusPlus` 是不同仓库和实现。前者的 tweak SDK 不能被当成后者现成具备的功能。

## 关键源码发现

### 1. Codexion：可借分层，不照搬启动与扫描

[架构说明](https://github.com/lyuai/codexion/blob/3ab2fb8d4a91cba503313445bd56f1a954d04654/docs/ARCHITECTURE.md)将生命周期、CDP、数据提供者和 UI 分开。其文档要求端口属于目标 PID；“端口能连上”不算目标验证。

[EXTENSIONS.md](https://github.com/lyuai/codexion/blob/3ab2fb8d4a91cba503313445bd56f1a954d04654/docs/EXTENSIONS.md)中的通用 install/update/uninstall 接口明确是 future contract，不能描述为成熟可接入的插件平台。

[实际注入实现](https://github.com/lyuai/codexion/blob/3ab2fb8d4a91cba503313445bd56f1a954d04654/src/ui/injected-meter.ts)在安装前调用旧 cleanup 并按固定 ID 替换自有节点；但也使用 body 子树 observer。前者可借，后者不能视为已经解决 GTE streaming 扫描成本。

其自动重启/退出策略不复制到 GTE。实验中已有进程不具备接入条件时，只报告 restart-required，等待用户安排窗口，不强制修复。

### 2. Codex Styler：补足 Windows 与恢复证据

[ADR](https://github.com/xuhuanstudio/codex-styler/blob/ee3dce2e69cc2ec884f0567d4475eb33722054e5/docs/adr/0001-managed-cdp-runtime.md)选择 CDP 而非 app.asar 修改，要求用户批准的启动与可移除根。

[架构](https://github.com/xuhuanstudio/codex-styler/blob/ee3dce2e69cc2ec884f0567d4475eb33722054e5/docs/architecture.md)记录配置 revision、防旧响应覆盖、保守/增强/阻断模式，并明确只有真实硬件结果才能填兼容性矩阵。

[cdp.rs](https://github.com/xuhuanstudio/codex-styler/blob/ee3dce2e69cc2ec884f0567d4475eb33722054e5/apps/desktop/src-tauri/src/cdp.rs)有 Windows packaged-app 激活代码和 loopback 调试参数；这证明存在 Windows 实现，不证明当前 Codex 26.915.4065.0 与 Codex++ 共存通过。

借鉴恢复边界与适配器组织，不引入皮肤、宠物、素材管理或它的整套 Tauri UI。

### 3. ShimX：SDK 包装有用，但 SDK 不等于安全与可靠性

[shimx_api.js](https://github.com/dugongzi/ShimX/blob/33a92c6f1d622f1ff66ffa02bbba3b3aab5b45fb/assets/inject/shimx_api.js)提供 ready、bridge.call、onMount、observe、subscribe；部分返回 stop/cancel 能力。GTE 可以采用同类有限接口，但不直接暴露任意 bridge path。

其 fallback 超时包装使用 Promise.race；[bridge_bootstrap.js](https://github.com/dugongzi/ShimX/blob/33a92c6f1d622f1ff66ffa02bbba3b3aab5b45fb/assets/inject/bridge_bootstrap.js)的底层 callback Map 没有对应超时删除。不能认为包装超时等于原请求已取消或回调已清理。

[runtime/plugins.js](https://github.com/dugongzi/ShimX/blob/33a92c6f1d622f1ff66ffa02bbba3b3aab5b45fb/assets/inject/codex_enhance/runtime/plugins.js)包含私有模块查找、sendRequest 改写和 React 内部属性操作，这些功能不进入 GTE 方案。这里只读源码，未调用。

### 4. 另一款 Codex++：最接近模块平台，代价也最明显

[模块生命周期](https://github.com/b-nnett/codex-plusplus/blob/f98e7e9d1fa068dde9e0dddfb43b128acb4e2fd7/docs/tweaks/runtime-lifecycle.md)已定义 scope、start/stop、按模块数据目录；[tweak-lifecycle.ts](https://github.com/b-nnett/codex-plusplus/blob/f98e7e9d1fa068dde9e0dddfb43b128acb4e2fd7/packages/runtime/src/tweak-lifecycle.ts)明确先停旧模块、清缓存、再加载并广播重载。

这提供了“真正模块化”应具备什么的对照，但[架构](https://github.com/b-nnett/codex-plusplus/blob/f98e7e9d1fa068dde9e0dddfb43b128acb4e2fd7/docs/ARCHITECTURE.md)依赖修改应用包 loader 和 preload。借鉴启停/隔离契约，不据此推荐替换现有安装，也不采用其默认启用或自动修补策略。

### 5. Explodex：借 UI 插槽思想，不借私有状态访问

[README](https://github.com/dan-dr/explodex/blob/ab0aeab4299bf1dc8da94ebd9abe77a0f8c771ac/README.md)示例是 `mount("aboveComposer", ...)` 加注册与销毁；这样的调用面比各功能自行查找和改造宿主更清楚。

但[作者自身的脆弱性分析](https://github.com/dan-dr/explodex/blob/ab0aeab4299bf1dc8da94ebd9abe77a0f8c771ac/docs/sdk-fragility.md)明确列出 Function.prototype 包装、AppServer 捕获与 Fiber，不能把这个 SDK 的“稳定接口”误认为官方支持的宿主协议。其 Windows 文档是 feasibility 而非正式支持声明。

## 收敛到 GTE 的具体准备动作

不是新建通用插件平台，而是只定义 GTE 一个组件的最小契约：

1. `mount / update / dispose / health`；独立根、版本与能力检查。
2. 页面只接展示数据、采集授权 observation、上报有限用户动作；后台拥有自有持久状态。
3. 所有 disposer 集中登记，重复关闭安全；不让定时器、observer、回调和请求在重挂载时遗留。
4. 后台与页面传输可替换：先做伪传输验证，不将 Codex++ 私有全局对象或某个平台启动命令写入领域 Core。
5. Windows Helper 通信的安全可行性是下一道门槛；没有证据前不承诺“零 Codex++ 修改”。
6. 页面历史完整性继续单独评估。没有任何本轮研究证据证明能在当前禁止接口边界内获得全量历史和稳定 navigateToTurn。

继续适用[候选 A 的共同安全门槛](EXPERIMENTAL-CODEXPP-HOSTED-GTE.zh-CN.md)、[候选 B 评审](EXPERIMENTAL-GOAL-PROGRESS-REVIEW.zh-CN.md)和[合成测试准备](../experiments/gte-hosted-module/README.md)。

发布本调研仅表示文档审查通过。不能据此安装工具、连接宿主、放宽项目禁止项或宣称原型已通过。
