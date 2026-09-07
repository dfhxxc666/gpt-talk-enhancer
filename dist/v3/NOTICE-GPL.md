# GPT TalkEnhancer GPL-derived work notice

GPT TalkEnhancer uses and adapts interaction/visual ideas and selected implementation details from:

- **Timeline - AI Chat Enhancer / chatgpt-gemini-timeline**
- Repository: `https://github.com/houyanchao/chatgpt-gemini-timeline`
- Copyright (C) 2025 hou / houyanchao
- License: GNU General Public License v3.0 or later

The upstream project states that it is based on `chatgpt-conversation-timeline`, Copyright (C) 2025 Reborn14, originally released under the MIT License.

For GPT TalkEnhancer, the derived/adapted scope includes the Question List / Timeline interaction baseline, selected UI implementation details, and portions of the early browser-extension prototype. GPT TalkEnhancer substantially modifies these areas for Codex Desktop with a Host Adapter architecture, Shadow DOM shell, stable conversation/turn identity, virtualized navigation, timeline cache, sampled rail, prompt integration, and desktop-specific layout behavior.

No clean-room rewrite was performed for the 0.4.x line. The derived portions must not be described as wholly original or clean-room work.

The complete upstream GPL license text is included as `reference/THIRD_PARTY_GPL-3.0.txt` and copied into relevant distribution directories by the build.

See the repository root `NOTICE.md` and `LICENSE` for the public distribution notice and project license.
