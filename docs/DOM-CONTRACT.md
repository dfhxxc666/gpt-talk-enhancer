# Semantic DOM contract

This file records the host DOM contract used by GPT TalkEnhancer. Selectors are semantic attributes supplied by the host and are kept in `src/core/constants.js`.

## Conversation and Timeline

| Purpose | Primary selector | Fallback |
| --- | --- | --- |
| Conversation root | `[data-thread-find-target="conversation"]` | `[data-chatgpt-conversation-selection-target="true"]` |
| Scroll container | `[data-app-action-timeline-scroll]` | `.thread-scroll-container` |
| User message | `[data-user-message-bubble="true"]` | `[data-markdown-text-tone="user-message"]` |
| Turn key | `[data-content-search-turn-key]` | `[data-turn-key]` |

The Turn key must be stable for the lifetime of a conversation. User message text is read from the semantic User message node, not from generated CSS class names.

Optional metadata inspected only when present:

- `data-index`
- `data-virtual-index`
- `data-turn-index`
- `aria-posinset`
- `aria-setsize`
- `data-set-size`
- `data-total-count`
- inline/computed transform translation

No React Fiber, React props, private component fields, or generated class names are inspected.

## Composer

| Purpose | Primary selector | Fallback |
| --- | --- | --- |
| Composer root | `form[data-thread-find-composer="true"][data-composer-placement="thread"]` | `[data-codex-composer-root][data-composer-placement="thread"]` |
| Editor | `[data-thread-find-composer="true"] [contenteditable="true"][role="textbox"][data-composer-markdown]` | `[contenteditable="true"][role="textbox"][aria-label="给 ChatGPT 发消息"]` |
| Prompt mount | `[data-thread-find-composer="true"] [data-composer-footer-responsive]` | sibling position before `button[data-composer-navigation-target="add-context"]` |

The fallback mount inserts the Prompt button next to the Add context anchor. It does not replace or mutate the host button.

## Virtualization assumptions

The host may use `flex-direction: column-reverse`, negative `scrollTop`, a large `scrollHeight`, and a small rendered DOM window. GPT TalkEnhancer never assumes that all historical Turns exist in the DOM. Turn metadata is retained in the registry after eviction.

The full-scan diagnostic requires either reliable total metadata or another host-provided completion signal before it can be considered a Full Timeline candidate. In the absence of that evidence, production stays Progressive.

The `↑ Earlier` action does not require total metadata. It asks `CodexAdapter` for one logical step of approximately `0.9 * clientHeight` toward earlier history, then lets the existing rendered-window tracker inspect the DOM after hydration. A no-new-key result is reported as `No more discovered` and remains retryable; it is not a claim that the history boundary was reached.

## Forbidden host integration

The script must not:

- use Pagebuster;
- call `thread/list` or `thread/read`;
- call Codex internal RPC;
- intercept `fetch` or `XMLHttpRequest`;
- inspect React Fiber, `__reactProps`, or `__reactFiber`;
- open or read Codex SQLite/database files;
- auto-send prompt content.

## Style boundary

All injected classes use the `gte-` prefix. CSS is scoped under GPT TalkEnhancer-owned classes and does not use unscoped `button`, `div`, or `textarea` rules. Timeline is a 40px rail and a 280px overlay with z-index 40. Prompt Popup is at most 360px by 420px with z-index 50.
