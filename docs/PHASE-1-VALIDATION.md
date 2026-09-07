# Phase 1 validation

> **历史文档提示：** 本文件中的 “PENDING REAL CODEX ACCEPTANCE” 等状态属于早期阶段。0.3 已完成真实 Codex Desktop 最终验收，当前结论见 [`V0.3-FINAL-ACCEPTANCE.zh-CN.md`](V0.3-FINAL-ACCEPTANCE.zh-CN.md)。


Validation separates the local synthetic fixture from the real Codex Desktop renderer. Browser/Faithful results below are ordinary DOM/UI integration evidence only.

## Final implementation decision

Production mode: **Progressive Timeline**.

Reason: this is the safe default while the real Codex Desktop `app://-/index.html` virtualizer has not yet been loaded in an acceptance-capable environment. The code keeps Turn metadata after virtual eviction and supports an explicit diagnostic spike, but does not silently enable Full Timeline.

Real Codex Desktop Full Scan status: **NOT YET VALIDATED**.

This status is intentionally not inferred from the browser fixture. The current Work environment does not expose a direct Codex Desktop renderer page to the available browser control surface. The logged-in web page and local fixture are not substitutes for `app://-/index.html`.

## Phase 2 implementation scope

Phase 2.1 keeps the observer business rules unchanged and normalizes `MutationRecord.addedNodes` / `removedNodes` through a small `Array.from`-based helper. Synthetic coverage includes non-iterable NodeList-like collections and verifies that `RootObserver.isRelevantMutation()` no longer throws.

Phase 2.2 keeps the product boundary at **Progressive Timeline + Earlier Discovery + Prompt Picker / Prompt Library**. The Timeline now uses a 32px slim glass rail with icon-only Earlier state, compact turn hit areas, active-dot ring, left-side summary tooltips, and a floating expanded list. The Prompt Library now uses an icon trigger, a 320–340px clamped glass card, an accent-underlined header with adjacent add action, a centered empty state, thresholded search for larger libraries, compact two-line previews, and the existing in-panel editor/delete behavior. These synthetic DOM changes do not constitute real Desktop renderer acceptance.

Phase 1.5 real-runtime status: **REAL CODEX ACCEPTANCE BLOCKED BY ENVIRONMENT**. The current Work tool surface does not provide DOM access to the Codex Desktop `app://-/index.html` renderer or a Codex++ loader status channel. No browser fixture result is promoted to real-runtime evidence.

## Synthetic Virtualization Spike PASS

Fixture: `test/fixtures/virtualized-codex.html`.

The fixture is a synthetic integration test with 120 logical User Turns in Conversation A. It renders only a small window, exposes `data-index`, `aria-posinset`, and `aria-setsize`, uses `flex-direction: column-reverse`, and produces negative `scrollTop` values. The explicit diagnostic ran with a 500ms hydration settle interval and a bounded 256-step target plan.

A separate anti-overfitting variant is available at `test/fixtures/virtualized-codex-no-metadata.html`. It keeps the same 120-Turn virtualized geometry but omits `aria-setsize`, `aria-posinset`, and all total-count metadata. Its automated diagnostic test confirms that even when all 120 synthetic keys are observed, completion remains unproven and the result stays Progressive.

Observed synthetic evidence:

- `flexDirection`: `column-reverse`.
- Raw scroll bounds: `scrollTop` from `-11480` to `0`; logical bounds `0` to `11480`.
- Full scan visited 29 logical sample positions from both ends.
- All 120 User Turns were discovered across the virtualized windows.
- `aria-setsize`: 120 supplied a reliable synthetic completion signal.
- Composer text was unchanged.
- Focus and selection were restored.
- Scroll restore delta was `0px` in the fixture run.
- No persistent observer was created by the spike itself.

Result: **Synthetic Virtualization Spike PASS**.

This proves the adapter/fixture coordinate and hydration mechanics only. It does not prove real Codex Desktop Full Scan readiness.

## Synthetic Progressive Earlier discovery

The dependency-free test suite exercises the user-triggered Earlier path with the same virtualized model shape: 120 logical User Turns, an initial rendered window of 10, `column-reverse` coordinates, and one bounded move per click.

- Initial registry and Timeline size: 10.
- One Earlier request: registry and Timeline grow to 20 with no duplicate key.
- Repeated requests: registry size is monotonic and reaches all 120 synthetic Turns in discrete user-triggered steps; order remains `turn-0` through `turn-119`.
- At the synthetic earlier boundary, the control reports `No more discovered`; a second click is accepted and retries the same bounded operation.
- A → B → A resets the Earlier state and registry to the active Conversation; no stale keys or pending timer cross the switch.
- Destroy during `Loading…` cancels the wait; a subsequent init restores exactly one Timeline and one Earlier control.

These are synthetic fixture/model results, not Real Codex Desktop acceptance and not evidence that a real Codex Full Scan is complete.

An auxiliary browser spot check of `virtualized-codex.html?no-total-metadata=true` used the generated userscript and the actual fixture DOM. It started with 10 rendered/registered User Turns, captured `Loading…` with an active Earlier wait, and one click moved the fixture to `scrollTop=-468` while the registry grew to 14. After 23 more user-triggered clicks, the registry and Timeline reached 120 unique keys with monotonic sizes. At `scrollTop=-11480`, two further clicks both returned `No more discovered` with the registry unchanged at 120 and no active timer. This is browser fixture evidence only.

The same auxiliary run recorded a no-metadata A → B → A switch with 10 B-only keys and then 10 A-only keys, one Prompt button and one Timeline throughout. During 500ms of fixture assistant streaming, `streamCount` increased to 310 while `RenderedTracker.changeCount` stayed unchanged; the new User Turn fixture action increased the registry from 10 to 11 without a duplicate Prompt button. Destroy/init/repeated init restored one Timeline, one Earlier control, one Prompt button, zero Popup elements, and active observers with no Earlier timer.

## Synthetic DOM/UI integration

The browser fixture was used to exercise:

- One Timeline and one Prompt button after injection.
- Collapsed rail and expanded Timeline list.
- Progressive registry accumulation while different virtual windows were rendered.
- Current-node highlighting and semantic-key jump to a previously discovered Turn.
- Assistant streaming-style DOM churn: `RenderedTracker` performed refreshes but did not change the Timeline fingerprint for identical User Turns.
- Prompt Popup open/search/create/edit/favorite/insert behavior.
- Two-step local delete confirmation without a blocking native dialog.
- Composer insertion into empty and pre-filled contenteditable content without sending.
- Local persistence under the versioned prompt key.

The real Codex Desktop-specific checks remain pending: actual script loading, real virtualizer behavior, AI streaming, new User Turn, A → B → A switching, real Composer state synchronization, and repeated reload/destroy/init.

The real long-conversation product gate is therefore still `PENDING REAL CODEX ACCEPTANCE`. The synthetic initial window demonstrates progressive growth, but it does not establish that a real long Conversation opens with an immediate full overview.

### Long Conversation Immediate Overview

Real Codex Desktop: **PENDING REAL CODEX ACCEPTANCE**; no real-renderer number is available in this environment. Synthetic fixture reference: 10 rendered User Turns at initial load, growing to 120 only after user-triggered Earlier clicks. This synthetic number must not be used as a real product-gate result.

## Automated tests

The dependency-free Node built-in test runner covers:

- TurnRegistry eviction metadata, conversation reset, and Earlier discovery accumulation.
- Normal and `column-reverse` coordinate conversion.
- Single-step Earlier direction/bounds behavior and Timeline control state.
- Prompt schema, persistence, CRUD, favorite, search, and order.
- Composer insertion composition/read-back behavior.
- Lifecycle idempotency and owned UI cleanup.
- Root/Conversation observer handling of NodeList-like mutation collections.
- Timeline rail node/active-state DOM structure and Prompt Library empty/non-empty/editor DOM structure.

Latest automated result: `npm run check` — **27 passed, 0 failed**; the build generated the userscript successfully and `node --check dist/gpt-talk-enhancer.user.js` passed. Forbidden-interface and unresolved-marker scans both reported zero matches.

## Known risks

- The real Codex Desktop semantic selector contract can change.
- Full Scan cannot be enabled safely without a real completion signal and an acceptance run against the Desktop renderer.
- Approximate positions are only as good as the most recent rendered rectangle/metadata observation.
- The current userscript build is intentionally dependency-free and uses a small static module wrapper rather than a general bundler.
- The local fixture models the supplied selectors and virtualization behavior; it cannot validate host-specific framework state beyond the tested DOM surface.
