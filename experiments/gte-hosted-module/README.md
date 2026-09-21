# GTE 嵌入式增强：实验准备

状态：EXPERIMENTAL / PREPARATION ONLY / NO EXECUTABLE PROTOTYPE
日期：2026-09-21

本目录是用例与门槛说明，不是已可运行的插件或 Helper。不要把它复制到 Codex++ 脚本目录，也不要运行第三方安装器。

## 固定输入

- GTE baseline：`6edb4a7b8cc5ee79e7e51ea51543c4434d945ae1`。
- Codex++ A 候选源码：`be6a45852f9992a688f33be933f444ee098fc67a`（v1.3.0）。
- Goal Progress 参考源码：`797dbff152b1b875ea957b12e41440917103b1db`（manifest 0.3.8）。
- [候选 A 与共同协议](../../docs/EXPERIMENTAL-CODEXPP-HOSTED-GTE.zh-CN.md)。
- [候选 B 的证据、限制与比较](../../docs/EXPERIMENTAL-GOAL-PROGRESS-REVIEW.zh-CN.md)。
- [同类增强项目比较与最终研究优先级](../../docs/EXPERIMENTAL-CODEX-ENHANCEMENT-SURVEY.zh-CN.md)。该文固定了另五个参考项目的 SHA，仅借鉴契约，不安装或整包复用。

## 当前准备结果

| 项目 | 本轮结果 |
| --- | --- |
| 方案与安全审核 | 已完成本轮源码层评审，生产可用性未验收 |
| 隔离 GTE 文档 worktree | 已从 baseline 建立；原 main 与用户 AGENTS.md 修改未并入 |
| Node / npm | 本机可用：v24.19.0 / 11.17.0 |
| Rust cargo/rustc | PATH 与当前用户常用 `.cargo/bin` 未发现；未穷举磁盘，不声称绝对未安装 |
| MSVC | 标准 vswhere 路径未发现；C++ 编译环境未验证 |
| pnpm | 本轮未验证；不为只读源码研究安装 |
| 第三方源码 | 已通过固定 SHA 在线阅读；未下载成完整 checkout，待路线选择后再准备 |
| 可执行原型/测试 | 未实现、未运行；下方仅为验收用例规格 |
| 应用运行时 | 未连接调试端口、未加载/启用脚本、未启动 Helper、未重启 Codex |

原工作区 Relay：metadata valid / checkpoint committed / freshness worktree_changed；实验 worktree Relay：metadata valid / checkpoint stale / freshness both_changed。是旧 checkpoint 与新分支不匹配，并非本次实验验证结果。未修改 Relay 元数据。

## 首批合成用例

所有会话 ID、Prompt 和 Turn 均由 fixture 生成，不从真实 Codex 读取。

| ID | 输入/故障 | 验收断言 |
| --- | --- | --- |
| LIFE-01 | 同页 mount 两次，再卸载 | 仅 1 个自有根；自有监听/计时器/pending 为 0 |
| LIFE-02 | A 会话请求在切换 B 后才返回 | B 不接收 A 的视图或持久写入 |
| IPC-01 | 无应答、迟到、重连和旧代响应 | 有界失败、pending 清空、无跨代应用 |
| IPC-02 | 非白名单路由、路径、超大/深层 payload | 拒绝且无副作用 |
| STORE-01 | 写入已完成但应答丢失后重试 | 相同 operationId 只生效一次；重启后仍可核对 |
| STORE-02 | 两个写入竞争相同 revision | 仅一个成功；另一个明确冲突 |
| STORE-03 | 提交中断、损坏快照、未知 schema | 旧版本不被破坏；不自动删除或清空 |
| INDEX-01 | 已知 q001..q102，随后仅观察 q098..q102 | 已知 ID 仍保留，visible 独立变化 |
| INDEX-02 | {a,b,c} 随后观察 {a,b,d} | 不得以数量相等为由把 c 覆盖掉；仅可有依据地增量合并 |
| INDEX-03 | 乱序/重复、错 conversation、未知 branch | 幂等、身份隔离；不确定时不写持久全局索引 |
| INDEX-04 | 编辑/删除证据不足 | 标记待确认或隔离旧 revision，不伪造权威历史 |
| UI-01 | 选 Prompt、目标不可定位、连续点击 | 仅预览/填入；不自动发送/全历史扫描/双重滚动 |
| PERF-01 | 200 个合成 Turn、1000 次 assistant 更新 | 记录计时；不连续触发完整 Timeline 扫描 |

用例规格不是测试结果。后续创建 harness 时必须将用例逐项映射到实际断言，记录命令、版本、结果与未覆盖项，不通过复制 PASS 文案代替执行。

## 下一步门槛

1. 先决定 A/B 的离线通信验证路径；当前建议先验证 B 能否在不改 Codex++ 的条件下安全通信，不预设它已成立。
2. 确认路径后，固定 SHA 的第三方源码仅放项目内隔离目录；不覆盖本机安装，不整包纳入 GTE 提交。未知依赖脚本先审查，再决定是否运行。
3. 工具链安装、宿主注入、进程/服务注册和重启均不属于本轮准备动作。若为下一阶段所需，先说明范围并取得对应授权。
4. 第一原型只针对合成数据、纯协议与伪页面；不得因运行依赖触达真实用户配置、数据库或会话 API。
5. 真机测试须另约窗口和独立授权；不能证明隔离则停止。阶段性材料保留，不自动清理文件。
