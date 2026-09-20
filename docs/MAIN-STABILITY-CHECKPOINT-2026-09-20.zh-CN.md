# GPT TalkEnhancer main 稳定检查点（2026-09-20）

状态：PASS / v0.5.2 rollback stabilization checkpoint

本文记录 v0.5.2 因后续实机问题回退后，main 在 v0.5.1 runtime 线上继续完成的稳定性修复。它不是新 release，不移动任何历史 tag。

## 1. 基线与范围

- 当前稳定发布线：v0.5.1
- 历史问题版本：v0.5.2（tag 保留，但已回退）
- 当前开发分支：main
- 当前稳定目标仍是两个核心能力：
  1. Conversation Timeline / Question List
  2. Prompt Picker / Prompt Library
- Work Timeline 的已验收行为保持冻结；后续 Chat 修复不得改变 Work 专用路径。
- Chat predictive fast path 保持 ABSENT；不恢复旧 Official Bridge / Fiber / L3 自动运行时实验。

## 2. 本轮收口的 Chat 稳定性

### 2.1 Pinned Chat

已完成并实机通过：

- 置顶 Chat 点击后可建立稳定 synthetic identity。
- identity 在虚拟窗口替换期间保持 latch。
- direct identity 一旦真实出现，优先接管并清理 synthetic latch。
- 置顶 Chat 首次完整历史通过 true-top bootstrap + loaded sweep 建立 Timeline。
- 旧的残缺 DOM-only Q1～Q7 cache 可在证据充分时自愈替换。
- bootstrap 不完整时不再永久写死 attempted 状态。

### 2.2 Project / 文件夹 Chat

已完成并实机通过：

- 文件夹 Chat 使用 project-chat synthetic identity。
- 项目容器 + 项目内唯一标题用于点击态身份建立；重复标题 fail-closed。
- UUID 不可用时，可使用可信 absolute fallback order 构建完整 Timeline。
- 历史 cache 里共享的 fallback-turn-* 不再作为跨会话身份主证据。

### 2.3 手机 / 其他设备创建的 Chat

已完成并实机通过：

- 无本机历史 cache 时，可从 true-top bootstrap 建立 Timeline。
- column-reverse 且缺少 visualOrder 时，可在容器方向已确认的前提下使用 windowOrder 建立逻辑顺序。
- bootstrap 必须覆盖启动时可见窗口，避免只扫到两条却判成功。
- bootstrap 失败只做有限重试，不无限循环。
- 扫描使用视觉冻结：内部仍驱动虚拟列表，但用户不再看到页面从顶部一路滚到底；恢复原 scrollTop 并稳定后再解除冻结。

### 2.4 快速到顶与 Q 导航后的身份恢复

已完成并实机通过：

- GPT TalkEnhancer 自己持有的 Chat Load All / bootstrap 期间，短暂 identity gap 不再清空已有 Timeline。
- 真正切换会话时仍 fail-closed，不保留旧会话 Questions。
- Q 导航后 direct / host identity 短暂消失时，可从当前可见窗口与 cache 重新恢复正确 inferred identity。
- Candidate resolver 的证据优先级现在是：
  1. 至少 2 条的完整原始文本连续序列唯一命中；
  2. 至少 2 条的规范化文本连续序列唯一命中；
  3. 最后才使用 UUID-like 稳定 ID overlap。
- 单条文本恢复仍禁止。
- fallback-turn-* 不再压过完整多条文本序列，也不再制造跨 cache 的假歧义。

## 3. Work 冻结状态

本轮 Chat 收口未改变已验收的 Work 行为：

- Work Earlier：独立 Work wheel hydration。
- Work Later：独立 Work wheel hydration。
- physical tail / final user turn backtrack。
- post-settle verification。
- Codex++ markPointerIntent -> navigate -> saveNow 兼容顺序。
- sidebar 切换前保存当前 Local Work scroll。
- Work Timeline cache 与 Chat Timeline cache 物理隔离。

## 4. 仍然保持的安全边界

- 不使用 Pagebuster。
- 不使用 Codex 内部 RPC。
- 不使用网络拦截作为正常运行路径。
- 不恢复 React Fiber / L3 自动深扫。
- 不允许单文本候选恢复 Chat identity。
- 不允许不完整 bootstrap 写成完整 Timeline。
- 不允许 Chat / Work 共享导航器或 Timeline cache。
- 删除文件前仍需显式确认；本次已删除项属于此前冻结研究路径的既有 dirty 状态，当前收尾只同步已通过的完整项目快照。

## 5. 实机验收结果

截至 2026-09-20，用户实机复测已确认：

- 普通 Chat Timeline：正常。
- Pinned Chat Timeline：正常。
- Project / 文件夹 Chat Timeline：正常。
- 手机创建 Chat：当前测试正常。
- 快速到顶后继续点击 Q：当前测试正常。
- Timeline identity 恢复：当前测试正常。
- 静默 bootstrap / 视觉冻结：当前测试正常。
- Work Timeline：保持此前 PASS 状态。

## 6. 自动门禁

最终同步前保持：

- npm run check
- npm run build:market
- node --check src/v3/bootstrap.js
- node --check src/v3/host/codex-desktop/navigation-adapter.js
- node --check dist/market/gpt-talk-enhancer.js
- git diff --check
- CHAT_PREDICTIVE_FAST_PATH=ABSENT

最终门禁结果：

- 自动测试：273 / 273 PASS
- npm run check：PASS
- npm run build：PASS
- npm run build:market：PASS
- node --check：PASS
- git diff --check：PASS
- CHAT_PREDICTIVE_FAST_PATH=ABSENT

## 7. 最终同步记录

- Runtime version：0.5.1
- main market SHA-256：98151AB7148A020654E1E585B2690847947C162FFA5B122EA6B16F1F05865B82
- Desktop bundle SHA-256：51D4548E787CD004370DFE5DD87F7CBAC0C09EF179229B7AC18E51D786C9D1E0
- Codex++ 单文件安装目标：%APPDATA%/Codex++/user_scripts/gpt-talk-enhancer.js
- Release tags：v0.5.1 / v0.5.2 均保持不动；当前推荐稳定发布线为 v0.5.1
- 本检查点对应 v0.5.2 回退后的 main 稳定快照，不创建新 tag。
