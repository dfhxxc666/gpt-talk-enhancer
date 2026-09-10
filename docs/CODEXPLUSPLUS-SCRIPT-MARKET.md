# CodexPlusPlusScriptMarket 投稿准备

状态：**Stable candidate prepared / Not submitted**。GPT TalkEnhancer v0.5.2 已完成单文件真实 Codex++ 验收，但按当前决定暂不 fork、不创建 PR、不修改 `BigPizzaV3/CodexPlusPlusScriptMarket`。

目标仓库：`https://github.com/BigPizzaV3/CodexPlusPlusScriptMarket`

## 市场兼容策略

v0.5.2 的推荐发行格式已经固定为单文件：

```text
dist/market/gpt-talk-enhancer.js
```

构建命令：

```powershell
npm run build:market
```

该文件包含 `@codex-plus-script` 元数据头、GPL 许可提示、完整 v3 bundle 和 thin loader，并按正确顺序合并，不改变运行逻辑。

双文件：

```text
dist/v3/00-gpt-talk-enhancer.v3.bundle.js
dist/v3/10-gpt-talk-enhancer.v3.loader.js
```

继续保留为开发/兼容构建，不作为 v0.5.2 市场推荐形态。

当前 v0.5.2 正式候选单文件 SHA-256：`706EE6773B04E9CFE20C6364A4100813BE61C02C649A8934251D4891BB5D3EBC`。

## 拟投稿元数据

```json
{
  "id": "gpt-talk-enhancer",
  "name": "GPT TalkEnhancer",
  "description": "为 Codex Desktop 提供 Conversation Timeline / Question List 与 Prompt Library，支持长对话虚拟化导航、当前位置高亮和提示词快捷插入。",
  "version": "0.5.2",
  "author": "dfhxxc666",
  "tags": ["codex", "timeline", "history", "prompt", "productivity", "ui"],
  "homepage": "https://github.com/dfhxxc666/gpt-talk-enhancer",
  "script_url": "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlusScriptMarket/main/scripts/gpt-talk-enhancer.js",
  "sha256": "706EE6773B04E9CFE20C6364A4100813BE61C02C649A8934251D4891BB5D3EBC",
  "requirements": ["Codex++ 用户脚本环境", "Codex / ChatGPT Desktop"],
  "limitations": ["当前主目标为 Desktop；未规划 Web 版", "首次从未探索的长对话需要随宿主虚拟化逐步建立索引"]
}
```

## 投稿前检查

v0.5.2 收口已经完成：

- `npm run check` PASS；
- `npm run build:market` PASS；
- `node --check dist/market/gpt-talk-enhancer.js` PASS；
- 真实 Codex++ single-file only 安装 PASS；
- Chat / Work 真实运行时验收 PASS；
- `NOTICE.md` / `LICENSE` / GPL 归属保持公开。

真正投稿前仍需：

1. 确认届时准备提交的单文件与本仓库 v0.5.2 正式产物一致；
2. 再计算一次 SHA-256 并填入目标仓库 `index.json`；
3. fork `BigPizzaV3/CodexPlusPlusScriptMarket`；
4. 新增 `scripts/gpt-talk-enhancer.js`；
5. 更新 `index.json`；
6. 运行目标仓库测试 / JSON 校验；
7. 再创建 PR。

## 当前决定

**暂不投稿。** v0.5.2 已完成稳定性与快路径收口；继续暂不投稿。后续若决定投稿，以冻结的 v0.5.2 tag 与本文件记录的正式 SHA-256 为准。