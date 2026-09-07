# CodexPlusPlusScriptMarket 投稿准备

状态：**Prepared / Not submitted**。当前只准备本仓库产物和元数据，不 fork、不创建 PR、不修改 `BigPizzaV3/CodexPlusPlusScriptMarket`。**正式投稿推迟到 0.5.0 稳定后。**

目标仓库：`https://github.com/BigPizzaV3/CodexPlusPlusScriptMarket`

## 市场兼容策略

目标市场当前以 `scripts/<name>.js` 单文件 + `index.json` 元数据发布，而 GPT TalkEnhancer Desktop 正式发行物是：

```text
00-gpt-talk-enhancer.v3.bundle.js
10-gpt-talk-enhancer.v3.loader.js
```

因此本仓库提供一个**市场单文件构建**，按既有运行顺序直接拼接 bundle 与 loader，不修改任何运行逻辑。0.5.0 稳定后，Codex++ Script Market 的正式发行格式固定为单文件，不再以双文件安装作为市场发布形态：

```powershell
npm run build:market
```

输出：

```text
dist/market/gpt-talk-enhancer.js
```

该文件包含 `@codex-plus-script` 元数据头、GPL 许可提示、完整 v3 bundle 和 thin loader。

当前 0.4.5 技术验证产物 SHA-256：`0D636D798B59DBCCDFB70D590CAFD86456B07748DDCCF7D58F9DC45123F76596`。它只用于证明单文件路线可行，**不是最终市场投稿产物**。正式投稿必须等待 0.5.0 稳定后重新构建、实机验收并重新计算 SHA-256。

## 拟投稿元数据

```json
{
  "id": "gpt-talk-enhancer",
  "name": "GPT TalkEnhancer",
  "description": "为 Codex Desktop 提供 Conversation Timeline / Question List 与 Prompt Library，支持长对话虚拟化导航、当前位置高亮和提示词快捷插入。",
  "version": "<0.5.0-or-later-stable>",
  "author": "dfhxxc666",
  "tags": ["codex", "timeline", "history", "prompt", "productivity", "ui"],
  "homepage": "https://github.com/dfhxxc666/gpt-talk-enhancer",
  "script_url": "https://raw.githubusercontent.com/BigPizzaV3/CodexPlusPlusScriptMarket/main/scripts/gpt-talk-enhancer.js",
  "sha256": "<rebuild-and-fill-before-submission>",
  "requirements": ["Codex++ 用户脚本环境", "Codex / ChatGPT Desktop"],
  "limitations": ["当前主目标为 Desktop；未规划 Web 版", "首次从未探索的长对话需要随宿主虚拟化逐步建立索引"]
}
```

## 投稿时机

- 不在 0.4.x 冻结线上投稿。
- 等 0.5.0 功能与兼容性稳定后，再以市场单文件作为正式候选。
- 单文件必须完成真实 Codex++ 单文件安装验收后才能提交 PR。

## 投稿前检查

1. `npm run check` PASS。
2. `npm run build:market` PASS。
3. 对 `dist/market/gpt-talk-enhancer.js` 执行 `node --check`。
4. 计算市场单文件 SHA-256，并写入目标仓库 `index.json`。
5. 确认 `NOTICE.md` / `LICENSE` / 上游 GPL 归属仍可从 homepage 清晰访问。
6. 在真实 Codex++ 中用市场单文件单独安装一次，确认无需两文件排序也能正常挂载。
7. 只有上述验收通过后再 fork / PR。
