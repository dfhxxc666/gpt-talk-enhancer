# GPT TalkEnhancer real Codex Desktop acceptance prompt

> **历史验收提示词：** 该提示词已完成其历史用途。0.3 当前真实 Runtime 验收结果见 [`V0.3-FINAL-ACCEPTANCE.zh-CN.md`](V0.3-FINAL-ACCEPTANCE.zh-CN.md)。


Status: **PENDING REAL CODEX ACCEPTANCE**.

Use this prompt only in an environment that can load the actual Codex Desktop renderer at `app://-/index.html`. Do not substitute a browser ChatGPT page or the local synthetic fixture.

## Task

Load the built `dist/gpt-talk-enhancer.user.js` as a Codex++ User Script in the real Codex Desktop renderer and perform one bounded acceptance run.

Do not use Pagebuster, internal RPC, `thread/list`, `thread/read`, fetch interception, XMLHttpRequest interception, React Fiber/props, Codex SQLite/database, or any automatic Send action.

## Record before/after evidence

1. Confirm the exact renderer URL is `app://-/index.html`.
2. Confirm the script is loaded and `window.__GPTTalkEnhancer.status()` reports version `0.1.0` with `health: "healthy"`.
3. Record the actual semantic selectors found for conversation root, scroll container, User Turn, Turn key, Composer root, editor, and mount.
4. Record `flex-direction`, raw scroll bounds, logical scroll bounds, rendered Turn count, and any `data-index`, `aria-posinset`, `aria-setsize`, virtual index, or transform metadata.

## Acceptance matrix

### Timeline

- Open a short Conversation and verify the collapsed 40px rail and expanded 280px overlay.
- Verify the collapsed rail and expanded header each expose one lightweight `↑ Earlier` entry without covering Timeline nodes.
- Click `↑ Earlier` once. Confirm the control immediately reports `Loading…`, the real Codex virtualizer moves one bounded logical step toward earlier history, and the control returns to `↑ Earlier` only when a new User Turn key is discovered. If no key appears, record `No more discovered`; do not interpret it as global end-of-history, and confirm a later click retries.
- Confirm repeated user-triggered Earlier clicks grow the registry monotonically, retain evicted Turn metadata, and never start an automatic background scan.
- Verify current-node highlighting and click jump for a rendered Turn.
- Verify a previously discovered unrendered Turn uses approximate position, waits for hydration, and receives exact rectangle correction.
- Use a 100+ Turn Conversation when available. Keep production in Progressive mode and run the virtualization spike only as a bounded DOM-only diagnostic experiment.
- Report the diagnostic only as `PASS`, `NOT PROVEN`, or `BLOCKED`; do not enable automatic Full Scan or infer completion from missing/synthetic total metadata.
- Verify Composer content, focus, selection, and logical scroll restoration. Record the measured restore delta; target is about ±2px.
- Start AI streaming and confirm assistant token mutations do not cause a full Timeline rebuild.
- Add a new User Turn and confirm the registry/UI updates.

### Long-conversation product gate

- Record the number of User Turn nodes visible immediately after opening a real long Conversation, before clicking Earlier.
- Record the registry size after each user-triggered Earlier click and whether the initial view provides a useful immediate overview.
- Report `Long Conversation Immediate Overview` separately from the technical Timeline result. A technically correct Progressive Timeline may still be `FAIL / PARTIAL` for this product gate if the initial real view contains only a small rendered window.

### Conversation switching

- Switch Conversation A → B and confirm the registry, active key, and rendered list belong only to B.
- Switch B → A and confirm A rehydrates progressively without stale B records.

### Prompt Picker

- Open/close Popup, search, keyboard navigate, favorite, create, edit, and delete.
- Confirm data persists after reload under `gpt-talk-enhancer.prompts.v1` with schema version 1.
- Insert into an empty Composer and a Composer with existing content.
- Read the real editor back and confirm framework/editor state is synchronized.
- Confirm no Send event, Enter press, or other automatic submission occurred.
- Force a safe insertion failure and confirm clipboard fallback plus toast.

### Lifecycle

- Call `destroy()`, `init()`, and `refresh()` repeatedly.
- Reload/inject repeatedly.
- At every endpoint confirm exactly one Timeline, one Prompt button, zero abandoned Popups, one active observer/listener set, and no leaked owned styles/toasts.

## Required report

Return:

- exact renderer URL and version;
- Full or Progressive decision and evidence;
- scroll/focus/selection/composer measurements;
- streaming, new User Turn, A → B → A, Prompt Picker, and lifecycle results;
- Earlier state transitions, one-step movement, no-new retry behavior, and long-conversation immediate-overview numbers;
- failures classified as code, host contract, or environment;
- screenshots or DOM snapshots only from the real renderer;
- whether Phase 1 is ready for Codex++ Script Market submission.
