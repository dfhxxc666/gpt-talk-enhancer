# Codex++ integration for GPT TalkEnhancer 0.5.0

GPT TalkEnhancer 0.5.0 uses Codex++ 1.2.56's existing User Script renderer injection only as a transport/bootstrap mechanism. Codex++ itself is not modified.

## Package layout

Recommended v0.5.0 distribution:

- `dist/market/gpt-talk-enhancer.js`: single-file Codex++ User Script containing the metadata header, complete v3 bundle and thin loader in execution order.

Development / compatibility build:

- `00-gpt-talk-enhancer.v3.bundle.js`: product bundle; registers `window.__GPTTalkEnhancerV3Bundle`.
- `10-gpt-talk-enhancer.v3.loader.js`: thin loader; validates the top-level `app://-/` renderer and invokes `bundle.mount()`.

The two-file layout remains useful for development and compatibility diagnostics. The recommended v0.5.0 user installation is the single file.

## Codex++ mechanism confirmed with version 1.2.56
- Confirmed version: 1.2.56.
- User scripts are stored under `%APPDATA%\Codex++\user_scripts` and are enabled through Codex++ User Scripts configuration.
- Enabled `.js` files are collected by `UserScriptManager`.
- The launcher injects them into the Codex top-level renderer through its existing CDP new-document script path.
- `/user-scripts/reload` rebuilds the enabled bundle and evaluates it in the renderer.
- No separate external renderer-plugin/UI-extension API was found in the inspected 1.2.56 source.

Do not copy these files into the Codex++ data directory without explicit user authorization. The repository build produces the recommended single-file artifact under `dist/market/` and development/compatibility artifacts under `dist/v3/`.
