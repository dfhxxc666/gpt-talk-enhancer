# Codex++ integration for GPT TalkEnhancer 0.4.5

GPT TalkEnhancer 0.4.5 uses Codex++ 1.2.56's existing User Script renderer injection only as a transport/bootstrap mechanism. Codex++ itself is not modified.

## Package layout

- `00-gpt-talk-enhancer.v3.bundle.js`: the GPT TalkEnhancer product bundle. It registers `window.__GPTTalkEnhancerV3Bundle` but does not mount itself.
- `10-gpt-talk-enhancer.v3.loader.js`: the thin loader. It validates the top-level `app://-/` renderer and invokes `bundle.mount()`.

The numeric prefixes are intentional. Codex++ `UserScriptManager` sorts enabled script file names before building the injected bundle, so the product bundle is registered before the loader executes.

## Codex++ mechanism confirmed with version 1.2.56

- Confirmed version: 1.2.56.
- User scripts are stored under `%APPDATA%\Codex++\user_scripts` and are enabled through Codex++ User Scripts configuration.
- Enabled `.js` files are collected by `UserScriptManager`.
- The launcher injects them into the Codex top-level renderer through its existing CDP new-document script path.
- `/user-scripts/reload` rebuilds the enabled bundle and evaluates it in the renderer.
- No separate external renderer-plugin/UI-extension API was found in the inspected 1.2.56 source.

Do not copy these files into the Codex++ data directory without explicit user authorization. The repository build only produces installer-ready artifacts under `dist/v3/`.
