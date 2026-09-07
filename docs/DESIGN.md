# GPT TalkEnhancer Phase 1 design

> **历史文档提示：** 本文件记录早期 Phase 1/2 设计。GPT TalkEnhancer 0.3 当前架构与最终事实请以 [`V0.3-FINAL-ACCEPTANCE.zh-CN.md`](V0.3-FINAL-ACCEPTANCE.zh-CN.md) 为准。


## Product boundary

GPT TalkEnhancer is a Codex++ User Script with two user-facing surfaces: a Conversation Timeline and a Prompt Picker / Prompt Library. The app reads the semantic DOM contract exposed by the host page. It does not read host application internals or use a backend.

The production timeline mode is `progressive`. A diagnostic `runVirtualizationSpike()` remains available for an explicit validation run, but it never enables a production full scan.

Phase 1.6 behavior is formally `Progressive Timeline + User-triggered Earlier Discovery`. Opening a Conversation indexes only the User Turns currently rendered by the Codex virtualizer. The user may click `↑ Earlier` to request one logical movement toward earlier history. The app never loops over the entire range, guesses a total from synthetic metadata, or claims that all history is loaded.

## Runtime composition

```text
RootObserver
  ├─ conversation root replacement
  ├─ scroll container replacement
  └─ composer replacement
       │
       ├─ ConversationObserver ──> RenderedTracker ──> TurnRegistry
       │                                  │                 │
       │                                  └──────────────> TimelineRenderer
       │                                                    ▲
       └─ ActiveTracker (IntersectionObserver + geometry) ──┘

PromptPicker ──> ComposerAdapter ──> semantic contenteditable Composer
      │
      └──── PromptStore ──> StorageAdapter ──> localStorage

NoOpBridgeAdapter is present as a future extension point and is not required by v1.
```

## CodexAdapter

`CodexAdapter` owns all host-page assumptions:

- Semantic selectors and fallbacks.
- Conversation, scroll container, composer, editor, and mount discovery.
- Turn key and metadata extraction.
- `column-reverse` and negative `scrollTop` conversion.
- Approximate position calculation and exact `getBoundingClientRect()` correction.

Timeline business code only receives logical top-origin positions. It does not inspect raw `scrollTop` or decide whether the host uses a reversed column.

## TurnRegistry

`TurnRegistry` stores `Map<turnKey, TurnRecord>`. A record contains:

- `key`
- `text`
- `shortText`
- `element`
- `rendered`
- `approximatePosition`
- `discoveredAt`
- `lastSeenAt`
- `logicalOrder`

When a Turn leaves the virtual window, its `element` reference is cleared but metadata remains. A conversation identity change clears the registry so Conversation A data cannot appear in Conversation B.

## Observers and streaming

`RootObserver` watches the document for host anchor replacement and also owns a low-frequency context reconciliation timer for host DOM changes that do not deliver a usable mutation callback. The timer is cleared by `dispose()`. `ConversationObserver` is bound to the current conversation root and filters mutations to User Turn additions/removals and User message text changes. Assistant streaming character mutations are ignored. `RenderedTracker` also fingerprints key/text/order and does not re-render the Timeline when a host re-render replaces identical User Turn nodes.

`ActiveTracker` uses the exact scroll container as the `IntersectionObserver` root and applies a 114px bottom exclusion for the Composer footer. It also performs geometry-based active selection so the UI remains useful when IntersectionObserver callbacks are delayed.

## Earlier discovery

The Timeline exposes a lightweight `↑ Earlier` control in both collapsed and expanded states. `CodexAdapter.moveEarlier()` is the only operation that knows how `column-reverse` and negative `scrollTop` map to the logical coordinate. It moves one clamped step of approximately `0.9 * clientHeight` toward the earlier-history boundary.

The app changes the control to `Loading…`, waits for the existing `RenderedTracker` to observe a new User Turn or for the hydration window to settle/timeout, then returns to `↑ Earlier` when new keys were found. If the attempt finds no new key it displays `No more discovered`. This is retryable and is not a global end-of-history claim. Conversation changes and host context replacement cancel the pending wait and reset the state.

The wait only refreshes the existing DOM tracker; it does not read historical data, focus the Composer, modify Composer content or selection, call `ComposerAdapter.write()`, or send a message. `TurnRegistry` continues to retain evicted metadata and only replaces `element` with `null` when a Turn leaves the virtual window.

## Phase 2 visual specification

The product remains **Progressive Timeline + Earlier Discovery + Prompt Picker / Prompt Library**. Phase 2 changes presentation and runtime compatibility only; it does not add a scan mode, persistence surface, or host integration.

The collapsed Timeline is a fixed 32px glass rail placed below the host header and above the Composer footer. It uses a translucent `#181818`-aligned surface, a light border, a small blur, and a restrained shadow. The rail contains an icon-only Earlier control, a one-pixel track, low-opacity 4px turn dots, a 6px active dot with a soft accent ring, and an icon-only expand/collapse control. Each dot keeps a larger transparent hit area and exposes a left-side, maximum-width summary tooltip. Earlier uses an up chevron, a spinner while loading, and a muted chevron with a retry tooltip after a no-new result. The expanded view floats to the left of the rail and preserves the existing text list, keyboard navigation, and semantic-key jump behavior.

The Prompt Library trigger is a 30px icon button mounted at the existing safe Composer footer point. Its panel is a 320–340px glass card with a roughly 400px viewport-clamped height, scoped light/dark variables, a compact `提示词` header, adjacent plus entry point, accent underline, and icon-only close action. An empty library centers the explanation and `＋ 添加提示词` action without showing search. Search appears only for libraries with at least five items. Prompt rows keep favorite-first ordering and existing insert/edit/delete behavior while showing a one-line title and a two-line content preview. Create/edit stays in the same panel and keeps the non-blocking two-step delete flow.

## Observer runtime compatibility

Browser `MutationRecord.addedNodes` and `removedNodes` are `NodeList` values, not arrays. `toNodeArray()` normalizes those collections with `Array.from` before any array methods are used. Both `RootObserver` and `ConversationObserver` use the helper, preserving their existing relevance filters while avoiding a `.some()`/spread assumption about host collection shape. Synthetic tests cover both iterable-equivalent and non-iterable NodeList-like values.

## Scroll and jump behavior

The adapter exposes a top-origin logical coordinate. For a `column-reverse` container with maximum logical position `M`, raw `scrollTop` is converted as `logical = clamp(M + scrollTop, 0, M)`. Reverse writes use `scrollTop = logical - M`. Normal containers use the ordinary top-origin mapping.

Rendered jump:

1. Read the container and Turn rectangles.
2. Adjust the logical position by the rectangle delta.
3. Apply a small correction offset.

Unrendered jump:

1. Move to the retained approximate position.
2. Wait briefly for virtualizer hydration.
3. Re-find the Turn by semantic key.
4. Apply the same exact rectangle correction.

## Prompt data and adapters

`PromptStore` is the only business-facing prompt persistence layer. It uses `StorageAdapter` and the versioned localStorage key `gpt-talk-enhancer.prompts.v1`. Settings use `gpt-talk-enhancer.settings.v1` through the same adapter.

`BridgeAdapter` has `available()` and `request()` as a future extension point. v1 uses `NoOpBridgeAdapter`; no production feature calls `request()`.

`ComposerAdapter` focuses the current semantic editor, calls `execCommand("insertText", false, text)`, then reads the editor back. It never writes `textContent` to force state and never presses Send. On failure it attempts a clipboard copy and reports a toast.

Prompt deletion uses a local two-step row state: the first click changes the row action to `确认`, and the second click deletes the item. It does not use a blocking native `window.confirm()` or introduce a general modal system.

## Lifecycle

The global API is `window.__GPTTalkEnhancer`. A second injection disposes the old observers/listeners, removes only GPT TalkEnhancer-owned UI, and starts one new instance. `destroy()` cancels any pending Earlier hydration timer, disconnects observers, removes listeners, removes the Timeline, Prompt button, Popup, styles, and any owned toast. The observer objects retain their injected dependencies so the same app instance can safely `init()` again after `destroy()`.

`status()` exposes `health: "healthy"` while the app is initialized and `health: "not-ready"` after destruction, alongside component and observer counts.
