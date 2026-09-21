# GPT TalkEnhancer 项目暂停交接

状态：PAUSED / WAITING FOR FUTURE SESSION HANDOFF
日期：2026-09-21
稳定发布基线：v0.5.3
暂停时开发线：v0.6 Architecture Reset / Phase 0 Chat Safety

## 1. 用户当前决定

- 暂停 GPT TalkEnhancer 开发与测试。
- 用户已在 Codex++ 中手动禁用 GPT TalkEnhancer 相关脚本。
- 后续会话不得主动重新启用 Codex++ 脚本，除非用户再次明确要求。
- 暂停期间不继续 Chat capability、Official Marker、Plugin 或 Architecture Reset 实现。
- 本文档用于后续会话接手，避免重新推断历史状态。

## 2. 稳定发布状态

当前最后稳定 release：

- v0.5.3
- release commit：43dd6d038f6ccac0afbdf7bcc2a67c97a69e7402
- v0.5.4 没有 release tag，也没有正式 runtime release。

v0.5.4 已作为 research 收口，见：

- V0.5.4-RESEARCH-CLOSEOUT.zh-CN.md
- V0.5.4-OFFICIAL-MARKER-RESEARCH-CHECKPOINT.zh-CN.md

## 3. v0.5.4 最终研究结果

Work Official Marker 已完成 3 个独立真实 Work 会话验证：

- trusted manual：21/21 verified
- HTMLElement.click()：12/12 verified
- MouseEvent：12/12 verified
- PointerEvent：12/12 verified
- programmatic total：36/36 verified
- wrong target：0
- wrong conversation：0

结论：

- Work Official Marker Direct Bridge 是 A 级候选。
- raw marker 不稳定，生产只能按当前 DOM 即时 canonical join。
- canonical Turn 对应 marker 数量恰好为 1 时才允许 fast path。
- Fiber / L3 deep scan 继续冻结。

## 4. Chat 阻断项

### CHAT-START-STALL-001

现象：

- 新建普通 Chat。
- 第一问提交后界面会卡住数秒，随后恢复。

高可信候选根因：

- document.body 全局 MutationObserver。
- mutation 驱动 refresh。
- fresh Chat 可能启动 true-top bootstrap。
- Chat boundary hydration 默认等待 1800ms，可经历多次 stall。

尚未完成实机因果确认。

### CHAT-REPAIR-COLLAPSE-001

现象：

- 一个约 102Q 的普通 Chat 长时间显示“正在修复时间线”。
- 修复后期 Timeline 错误收缩到约 5Q。

源码已确认存在结构性风险：

- repair snapshot 可以进入 replaceDomSnapshot()。
- 原 complete snapshot 校验只验证 candidate 自身 order 连续。
- candidate 不需要证明覆盖既有完整 Timeline。
- replace 成功后会 records.clear() 并 persist cache。

因此 102Q -> 5Q 不能视为单纯 UI 问题。

## 5. v0.6 Architecture Reset 决定

主方案：

- Safety first
- Core / Host boundary
- Thin Host Injector
- Work OfficialMarkerBridge
- Optional Official Plugin

不采用 Plugin-only 重写。

详细方案：

- V0.6-ARCHITECTURE-RESET.zh-CN.md
- V0.6-ARCHITECTURE-RESET-REVIEW.zh-CN.md

旧 V0.6.0 Product Features 计划已降为 post-reset backlog。

## 6. Phase 0 Chat Safety 当前 WIP

暂停前已经实现一版候选 hotfix，但尚未完成真实机器验收。

候选行为：

1. fresh Chat 只有一个未锚定 visible Q 时，不自动启动 true-top bootstrap。
2. Chat repair candidate 小于当前 existing index 时拒绝 destructive replacement。
3. shrinking repair 被拒绝后，该会话暂停后续自动 repair，避免持续“正在修复时间线”循环。
4. 被阻断的导航返回 chat-index-auto-repair-blocked，而不是再次强行启动 repair。
5. Work 相关源码未修改。

新增回归用例：

- Chat auto bootstrap stays idle for one unanchored visible turn
- Chat repair rejects a shrinking sweep and preserves the larger existing index

暂停前验证结果：

- app.test.js：91/91 PASS
- npm run test:v3-regression：228/228 PASS
- npm run build:market：PASS
- CHAT_PREDICTIVE_FAST_PATH：ABSENT
- Work 核心文件 diff：NONE

注意：

> 这些结果只证明自动化回归通过，不等于真实 Codex Desktop 问题已经修复。

## 7. 实机候选状态

暂停前曾把 Phase 0 候选 market userscript 覆盖到 Codex++：

- candidate SHA-256：09C9C80318D5A1E2BF4BD40923A6DEA8B3E2B50076498C2A5AB5E39BDB127AA4
- v0.5.3 稳定安装 SHA-256：576B45744AD682405C42831670906059A5E4EE60E8CC601E0C42E699C26A9627

随后用户已手动禁用 Codex++ 中的项目脚本。

后续会话不要假设候选正在运行，也不要未经用户确认重新启用。

## 8. 恢复开发时的第一步

后续会话接手时：

1. 先读取本文档。
2. 读取 V0.5.4 Research Closeout 和 V0.6 Architecture Reset。
3. 检查 Git HEAD / origin/main / working tree。
4. 确认 Codex++ 脚本仍为用户禁用状态。
5. 未经用户明确同意，不恢复运行时功能。
6. 如果用户决定继续 Phase 0，先做两项实机验收：
   - fresh Chat 第一问是否仍有数秒冻结；
   - 约 102Q Chat 是否仍发生 repair collapse。
7. 如果 Phase 0 实机失败，先采诊断，不继续 Plugin/fast-path。
8. 如果 Phase 0 实机通过，再决定是否进入 Core/Host 解耦。

## 9. 当前禁止事项

暂停/接手阶段禁止：

- 自动启用 Codex++ 用户脚本。
- 新建 v0.5.4 tag。
- 把 Phase 0 WIP 宣称为稳定 release。
- 继续 Chat marker programmatic 测试。
- 启动 Plugin skeleton。
- 引入 Fiber / Pagebuster / 网络拦截。
- 修改 Work 已冻结稳定行为。
- 删除历史文档或 cache 迁移代码。

## 10. 接手一句话

> v0.5.3 是稳定回滚线；v0.5.4 已研究收口；v0.6 架构方案已完成并经过反向评审；当前只存在一版尚未实机验收的 Phase 0 Chat Safety WIP。项目已暂停，Codex++ 脚本由用户禁用，等待后续会话明确恢复。
