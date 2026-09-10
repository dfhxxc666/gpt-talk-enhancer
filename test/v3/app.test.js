import test from "node:test";
import assert from "node:assert/strict";
import { TalkEnhancerV3App } from "../../src/v3/bootstrap.js";
import { MemoryStorageAdapter } from "../../src/v3/core/storage.js";
import { SURFACE } from "../../src/v3/host/host-interface.js";
import { TimelineCache } from "../../src/v3/core/timeline-cache.js";

function createHarness({ navigationOk = true, storage = null } = {}) {
  const turns = Array.from({ length: 50 }, (_, i) => ({ id: `q${i + 1}`, order: i, text: `Question ${i + 1}`, source: "dom", visible: i >= 20 && i < 28 }));
  let active = "q22";
  let conversationId = "A";
  let surface = SURFACE.CONVERSATION;
  const host = {
    getSurface: () => surface,
    getConversationId: () => conversationId,
    getConversationIdentity: () => ({ id: conversationId, source: "test", host: "test", kind: "conversation", stable: true }),
    getRoute: () => `/c/${conversationId}`,
    getTheme: () => "dark",
    getVisibleTurns: () => turns.filter((turn) => turn.visible),
    getActiveTurnId: () => active,
    getScrollContainer: () => null,
    getComposer: () => ({}),
    getCompatibilityReport: () => ({ revision: "codex-desktop-v1", status: "ready" }),
    getNavigationCompatibility: () => ({ feature: "codex-plus-thread-scroll-restore", status: "not-needed", notified: false, error: "" }),
    getComposerForm: () => null,
    getComposerRect: () => null,
    navigateToTurn: async (turnId) => {
      if (!navigationOk) return { ok: false, target: turnId, verified: false, reason: "target-not-hydrated" };
      active = turnId;
      return { ok: true, target: turnId, verified: true };
    },
    cancelNavigation() {},
    destroy() {}
  };
  const app = new TalkEnhancerV3App({ host, storage: storage ?? new MemoryStorageAdapter(), document: {}, window: {} });
  const shellState = { active: null, turns: [], toasts: [], navigationUx: [] };
  app.shell = {
    questionList: { getViewState: () => ({ panelOpen: false, manualBrowse: false, anchorTurnId: null, anchorOffset: 0 }), restoreViewState() {} },
    setTheme() {}, setSurface() {}, refreshComposerAnchor() {},
    updateTimeline(nextTurns, activeTurnId) { shellState.turns = nextTurns; shellState.active = activeTurnId; },
    setNavigationState(state) { shellState.navigationUx.push({ ...state }); },
    showToast(message) { shellState.toasts.push(message); },
    getStatus: () => ({ timelineMounted: true, promptMounted: true, questionPanelOpen: false, promptPanelOpen: false, questionRenderCount: 1 }),
    destroy() {}
  };
  app.refresh("test-init");
  return { app, host, shellState, turns, getActive: () => active, setActive: (value) => { active = value; }, setConversationId: (value) => { conversationId = value; }, setSurface: (value) => { surface = value; } };
}

test("Timeline cache restores a complete long-conversation index before DOM hydration catches up", () => {
  const storage = new MemoryStorageAdapter();
  const cache = new TimelineCache({ storage });
  cache.save("A", Array.from({ length: 76 }, (_, index) => ({
    id: `q${index + 1}`, order: index, text: `Cached Question ${index + 1}`, type: "text", lastSeen: index + 1
  })));
  const { app, shellState } = createHarness({ storage });
  assert.equal(shellState.turns.length, 76);
  assert.equal(app.getTurnIndex("A").size(), 76);
  assert.equal(app.status().timeline.cacheRestoredTurns, 76);
  assert.equal(app.getTurnIndex("A").getVisible().length, 8);
});

test("Three-way Navigation Consistency: target, verified host and ActiveTracker converge", async () => {
  const { app, shellState, getActive } = createHarness();
  const result = await app.navigate("q27");
  assert.equal(result.target, "q27");
  assert.equal(result.verified, true);
  assert.equal(getActive(), "q27");
  assert.equal(shellState.active, "q27");
  assert.equal(app.conversations.get("A").activeTurnId, "q27");
  assert.equal(app.lastNavigation.verified, true);
  assert.equal(app.status().navigationUx.state, "success");
  assert.equal(app.status().navigationUx.target, "q27");
  assert.equal(app.status().navigationUx.targetOrder, 26);
  assert.equal(app.status().navigationUx.pendingVisible, false);
});

test("failed navigation remains unverified and emits user-facing toast", async () => {
  const { app, shellState } = createHarness({ navigationOk: false });
  const result = await app.navigate("q27");
  assert.equal(result.ok, false);
  assert.equal(app.lastNavigation.verified, false);
  assert.equal(app.status().navigationUx.state, "failed");
  assert.equal(shellState.toasts.at(-1), "未能定位 Q27，请再试一次");
});

test("superseded navigation never clears or errors the newer pending target", async () => {
  const { app, host, shellState } = createHarness();
  const resolvers = new Map();
  host.navigateToTurn = (turnId) => new Promise((resolve) => resolvers.set(turnId, resolve));
  const first = app.navigate("q1");
  const second = app.navigate("q50");
  assert.equal(app.status().navigationUx.state, "pending");
  assert.equal(app.status().navigationUx.target, "q50");
  resolvers.get("q1")({ ok: false, target: "q1", verified: false, reason: "superseded" });
  await first;
  assert.equal(app.status().navigationUx.state, "pending");
  assert.equal(app.status().navigationUx.target, "q50");
  assert.equal(shellState.toasts.length, 0);
  resolvers.get("q50")({ ok: true, target: "q50", verified: true });
  await second;
  assert.equal(app.status().navigationUx.state, "success");
  assert.equal(app.status().navigationUx.target, "q50");
  assert.equal(shellState.toasts.length, 0);
});

test("navigation pending message waits 650ms before becoming visible", async () => {
  const { app, host, shellState } = createHarness();
  let resolveNavigation;
  let pendingCallback = null;
  let pendingDelay = null;
  host.navigateToTurn = () => new Promise((resolve) => { resolveNavigation = resolve; });
  app.window = {
    setTimeout(callback, delay) { pendingCallback = callback; pendingDelay = delay; return 7; },
    clearTimeout() {}
  };
  const navigation = app.navigate("q50");
  assert.equal(pendingDelay, 650);
  assert.equal(app.status().navigationUx.pendingVisible, false);
  pendingCallback();
  assert.equal(app.status().navigationUx.pendingVisible, true);
  assert.equal(shellState.navigationUx.at(-1).pendingVisible, true);
  resolveNavigation({ ok: true, target: "q50", verified: true });
  await navigation;
  assert.equal(app.status().navigationUx.state, "success");
  assert.equal(app.status().navigationUx.pendingVisible, false);
});

test("pending navigation Q label follows a reindexed target and failure toast uses the latest order", async () => {
  const { app, host, shellState, turns } = createHarness();
  let resolveNavigation;
  let capturedContext = null;
  host.navigateToTurn = (_turnId, context) => {
    capturedContext = context;
    return new Promise((resolve) => { resolveNavigation = resolve; });
  };
  const navigation = app.navigate("q27");
  assert.equal(typeof capturedContext?.getTurns, "function");
  assert.equal(app.status().navigationUx.targetOrder, 26);
  const target = app.getTurnIndex("A").get("q27");
  target.order = 40;
  turns.find((turn) => turn.id === "q27").order = 40;
  app.refresh("reindex-during-navigation");
  assert.equal(app.status().navigationUx.targetOrder, 40);
  resolveNavigation({ ok: false, target: "q27", verified: false, reason: "work-wheel-stalled" });
  await navigation;
  assert.equal(shellState.toasts.at(-1), "未能定位 Q41，请再试一次");
});

test("navigation debug preserves detailed failure diagnostics", async () => {
  const { app } = createHarness();
  app.host.navigateToTurn = async (turnId) => ({
    ok: false,
    target: turnId,
    verified: false,
    reason: "navigation-hard-limit",
    probes: 256,
    stalls: 0,
    elapsedMs: 45001,
    budgetLimit: "absolute-time",
    visibleRange: { min: 4, max: 9 },
    scrollHeight: 42000,
    maxLogicalPosition: 41000,
    logicalPosition: 3800,
    steps: [{ mode: "chat-progressive", elapsedMs: 184, jumpPx: 3200, waitMs: 8, progressKind: "extent", before: { visibleRange: { min: 20, max: 25 } }, after: { visibleRange: { min: 17, max: 22 } } }]
  });
  await app.navigate("q1");
  assert.equal(app.lastNavigation.reason, "navigation-hard-limit");
  assert.equal(app.lastNavigation.probes, 256);
  assert.equal(app.lastNavigation.elapsedMs, 45001);
  assert.equal(app.lastNavigation.budgetLimit, "absolute-time");
  assert.deepEqual(app.lastNavigation.visibleRange, { min: 4, max: 9 });
  assert.equal(app.status().navigation.scrollHeight, 42000);
  assert.equal(app.lastNavigation.steps.length, 1);
  assert.equal(app.lastNavigation.steps[0].mode, "chat-progressive");
  assert.equal(app.lastNavigation.steps[0].elapsedMs, 184);
});
test("debug status exposes requested v3 runtime fields", () => {
  const { app } = createHarness();
  const status = app.status();
  assert.equal(status.version, "0.5.2");
  assert.deepEqual(status.conversationIdentity, { id: "A", source: "test", host: "test", kind: "conversation", stable: true });
  assert.equal(status.host, "codex-desktop");
  assert.equal(status.hostContract.revision, "codex-desktop-v1");
  assert.equal(status.hostContract.status, "ready");
  assert.equal(status.health, "healthy");
  assert.equal(status.surface, SURFACE.CONVERSATION);
  assert.equal(status.conversationId, "A");
  assert.equal(typeof status.timeline.knownTurns, "number");
  assert.equal(typeof status.timeline.visibleTurns, "number");
  assert.equal(typeof status.prompt.composerDetected, "boolean");
  assert.equal(typeof status.navigation.verified, "boolean");
  assert.equal(status.navigationUx.state, "idle");
  assert.equal(status.navigationUx.pendingVisible, false);
  assert.equal(status.navigationCompatibility.feature, "codex-plus-thread-scroll-restore");
  assert.equal(status.navigationCompatibility.status, "not-needed");
  assert.ok(["healthy", "degraded"].includes(status.health));
  app.hostInternalDepthProbe = { level1: { present: true }, level2: { reactPropsPresent: false }, level3: { reactFiberPresent: false } };
  app.updateDebug("host-depth-test");
  assert.deepEqual(app.status().hostInternalDepthProbe, app.hostInternalDepthProbe);
  assert.deepEqual(app.window.__GPTTalkEnhancerDebug.hostInternalDepthProbe, app.hostInternalDepthProbe);
});

test("conversation switch invalidates in-flight navigation without stale failure UI", async () => {
  const { app, host, shellState, setConversationId } = createHarness();
  let context = null;
  let resolveNavigation = null;
  let cancellations = 0;
  host.cancelNavigation = () => { cancellations += 1; };
  host.navigateToTurn = (_turnId, nextContext) => {
    context = nextContext;
    return new Promise((resolve) => { resolveNavigation = resolve; });
  };
  const navigation = app.navigate("q1");
  assert.equal(context.isCurrent(), true);
  setConversationId("B");
  assert.equal(context.isCurrent(), false);
  app.refresh("conversation-switch");
  assert.equal(app.currentConversationId, "B");
  assert.equal(app.status().navigationUx.state, "idle");
  assert.ok(cancellations >= 1);
  resolveNavigation({ ok: false, target: "q1", verified: false, reason: "superseded" });
  await navigation;
  assert.equal(shellState.toasts.length, 0);
  assert.equal(app.status().navigationUx.state, "idle");
});

test("transient conversation UI gap preserves the current session without inventing a host identity", () => {
  const { app, host, shellState, setConversationId, setSurface } = createHarness();
  const previousTurns = shellState.turns;
  setConversationId(null);
  setSurface(SURFACE.CONVERSATION);
  app.refresh("conversation-identity-transient");
  assert.equal(host.getConversationId(), null);
  assert.equal(app.currentConversationId, "A");
  assert.equal(shellState.turns, previousTurns);
});

test("Settings surface invalidates in-flight navigation without stale failure UI", async () => {
  const { app, host, shellState, setSurface } = createHarness();
  let context = null;
  let resolveNavigation = null;
  let cancellations = 0;
  host.cancelNavigation = () => { cancellations += 1; };
  host.navigateToTurn = (_turnId, nextContext) => {
    context = nextContext;
    return new Promise((resolve) => { resolveNavigation = resolve; });
  };
  const navigation = app.navigate("q1");
  assert.equal(context.isCurrent(), true);
  setSurface(SURFACE.SETTINGS);
  app.refresh("settings-interrupt");
  assert.equal(context.isCurrent(), false);
  assert.equal(app.currentConversationId, null);
  assert.equal(app.status().navigationUx.state, "idle");
  assert.ok(cancellations >= 1);
  resolveNavigation({ ok: false, target: "q1", verified: false, reason: "superseded" });
  await navigation;
  assert.equal(shellState.toasts.length, 0);
  assert.equal(app.status().navigationUx.state, "idle");
});

test("conversation inherits active capture hook status on activation", () => {
  const { app } = createHarness();
  app.captureStatus = { status: "active", turnCount: 0, lastError: "" };
  app.currentConversationId = null;
  app.refresh("capture-inherit");
  assert.equal(app.conversations.get("A").captureStatus.status, "active");
});

test("ActiveTracker fallback id canonicalizes to capture id by order", () => {
  const { app, host, shellState } = createHarness();
  app.handleCapture({ conversationId: "A", turns: [
    { id: "cap-0", order: 0, text: "Question 1", source: "capture", visible: false },
    { id: "cap-1", order: 1, text: "Question 2", source: "capture", visible: false }
  ] });
  host.getVisibleTurns = () => [
    { id: "fallback-turn-1", order: 1, text: "Question 2", source: "dom", visible: true }
  ];
  host.getActiveTurnId = () => "fallback-turn-1";
  app.refresh("canonical-active");
  assert.equal(shellState.active, "cap-1");
  assert.equal(app.conversations.get("A").activeTurnId, "cap-1");
  assert.deepEqual(app.getTurnIndex("A").getVisible().map((turn) => turn.id), ["cap-1"]);
});

test("sidebar conversation click settles after Desktop selection transition", () => {
  const { app } = createHarness();
  const calls = [];
  app.scheduleRefresh = (reason) => calls.push(reason);
  app.refresh = (reason) => calls.push(reason);
  app.window = { performance: { now: () => 1000 }, setTimeout(callback) { callback(); return 7; }, clearTimeout() {} };
  app.handleConversationSelect({ target: { closest: () => ({ getAttribute: (name) => name === "data-app-action-sidebar-thread-id" ? "local:test" : null }) } });
  assert.deepEqual(calls, ["conversation-select", "conversation-select-settled"]);
  assert.equal(app.localNavigationSettleUntil, 1500);
});

test("Local sidebar switch saves the current thread position before invalidation", () => {
  const { app, host } = createHarness();
  const events = [];
  const currentId = "local:11111111-1111-7111-8111-111111111111";
  const nextId = "local:22222222-2222-7222-8222-222222222222";
  host.getConversationIdentity = () => ({ id: currentId, source: "sidebar-local", host: "local", kind: "local", stable: true });
  host.persistLocalScrollPosition = () => { events.push("save"); return true; };
  app.invalidateNavigation = (reason) => events.push(`invalidate:${reason}`);
  app.scheduleRefresh = () => {};
  app.window = { performance: { now: () => 1000 }, setTimeout() { return 7; }, clearTimeout() {} };
  app.handleConversationSelect({
    target: {
      closest: () => ({
        getAttribute: (name) => name === "data-app-action-sidebar-thread-id" ? nextId : null
      })
    }
  });
  assert.deepEqual(events.slice(0, 2), ["save", "invalidate:conversation-select"]);
});

test("clicking the current Local sidebar thread does not force a duplicate scroll save", () => {
  const { app, host } = createHarness();
  const currentId = "local:11111111-1111-7111-8111-111111111111";
  let saves = 0;
  host.getConversationIdentity = () => ({ id: currentId, source: "sidebar-local", host: "local", kind: "local", stable: true });
  host.persistLocalScrollPosition = () => { saves += 1; return true; };
  app.scheduleRefresh = () => {};
  app.window = { performance: { now: () => 1000 }, setTimeout() { return 7; }, clearTimeout() {} };
  app.handleConversationSelect({
    target: {
      closest: () => ({
        getAttribute: (name) => name === "data-app-action-sidebar-thread-id" ? currentId : null
      })
    }
  });
  assert.equal(saves, 0);
});
test("ChatGPT sidebar click retries delayed identity before restoring Timeline cache", () => {
  const storage = new MemoryStorageAdapter();
  const cache = new TimelineCache({ storage });
  cache.save("B", Array.from({ length: 76 }, (_, order) => ({ id: `q${order + 1}`, order, text: `Cached B ${order + 1}` })));
  const { app, host, shellState, setConversationId } = createHarness({ storage });
  const timers = [];
  const delays = [];
  app.window = {
    performance: { now: () => 1000 },
    requestAnimationFrame(callback) { callback(); return 99; },
    setTimeout(callback, delay) { timers.push(callback); delays.push(delay); return timers.length; },
    clearTimeout() {}
  };
  const row = {
    getAttribute(name) {
      if (name === "data-sidebar-chatgpt-conversation-key") return "chatgpt:conversation:B";
      return null;
    }
  };
  app.handleConversationSelect({ target: { closest: () => row } });
  assert.equal(app.currentConversationId, "A");
  assert.deepEqual(delays, [240]);

  timers.shift()();
  assert.equal(app.currentConversationId, "A");
  assert.deepEqual(delays, [240, 600]);

  setConversationId("B");
  timers.shift()();
  assert.equal(app.currentConversationId, "B");
  assert.equal(shellState.turns.length, 76);
  assert.equal(app.status().timeline.cacheRestoredTurns, 76);
  assert.deepEqual(delays, [240, 600]);
});

test("stable ChatGPT identity authorizes mounted fast settle", async () => {
  const { app, host } = createHarness();
  host.getConversationIdentity = () => ({ id: "chatgpt-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  let received = null;
  host.navigateToTurn = async (_turnId, context) => { received = context; return { ok: true, verified: true, target: "q22", settleMode: "mounted-fast" }; };
  await app.navigate("q22");
  assert.equal(received.allowMountedFastSettle, true);
  assert.equal(received.allowChatPredictiveFastPath, false);
  assert.equal(app.status().navigation.settleMode, "mounted-fast");
});

test("restored ChatGPT cache authorizes predictive fast path and exposes result diagnostics", async () => {
  const storage = new MemoryStorageAdapter();
  const cache = new TimelineCache({ storage });
  cache.save("A", Array.from({ length: 50 }, (_, order) => ({ id: `q${order + 1}`, order, text: `Cached ${order + 1}`, type: "text" })));
  const { app, host } = createHarness({ storage });
  host.getConversationIdentity = () => ({ id: "chatgpt-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  let received = null;
  host.navigateToTurn = async (_turnId, context) => {
    received = context;
    return { ok: true, verified: true, target: "q22", fastAttempted: true, fastSucceeded: true, fallbackReason: null };
  };
  await app.navigate("q22");
  assert.equal(app.status().timeline.cacheRestoredTurns, 50);
  assert.equal(received.allowChatPredictiveFastPath, true);
  assert.equal(app.status().navigation.fastAttempted, true);
  assert.equal(app.status().navigation.fastSucceeded, true);
  assert.equal(app.status().navigation.fallbackReason, null);
});

test("slow navigation diagnostics persist automatically without conversation identifiers", async () => {
  const storage = new MemoryStorageAdapter();
  const { app, host } = createHarness({ storage });
  host.getConversationIdentity = () => ({ id: "private-conversation-id", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  const step = {
    mode: "chat-progressive", direction: -1, elapsedMs: 181, jumpPx: 4320, waitMs: 8, targetOrder: 21, progressKind: "window",
    before: { visibleRange: { min: 12, max: 17 }, scrollHeight: 50000, logicalPosition: 12000 },
    after: { visibleRange: { min: 9, max: 14 }, scrollHeight: 53000, logicalPosition: 7680 }
  };
  host.navigateToTurn = async (_turnId, context) => {
    context.onTraceStep?.(step, [step]);
    return { ok: true, verified: true, reason: "ok", steps: [step] };
  };
  await app.navigate("q22");
  const saved = storage.read("gte.v3.navigation-diagnostics", []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].host, "chatgpt");
  assert.equal(saved[0].targetOrder, 21);
  assert.equal(saved[0].targetLabel, "Q22");
  assert.equal(saved[0].slowSteps[0].elapsedMs, 181);
  assert.equal("conversationId" in saved[0], false);
  assert.equal("target" in saved[0], false);
  assert.equal(app.status().lastSlowNavigation.slowestStep.elapsedMs, 181);

  const { app: restored } = createHarness({ storage });
  assert.equal(restored.status().slowNavigationHistory.length, 1);
  assert.equal(restored.status().lastSlowNavigation.targetLabel, "Q22");
});

test("fast navigation does not pollute persisted slow diagnostics", async () => {
  const storage = new MemoryStorageAdapter();
  const { app, host } = createHarness({ storage });
  host.getConversationIdentity = () => ({ id: "chat-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  const step = { mode: "chat-progressive", direction: -1, elapsedMs: 62, jumpPx: 4320, waitMs: 8, targetOrder: 0, progressKind: "window", before: null, after: null };
  host.navigateToTurn = async (_turnId, context) => { context.onTraceStep?.(step, [step]); return { ok: true, verified: true, reason: "ok", steps: [step] }; };
  await app.navigate("q1");
  assert.deepEqual(storage.read("gte.v3.navigation-diagnostics", []), []);
  assert.equal(app.status().lastSlowNavigation, null);
});

test("official navigation diagnostics persist and restore without conversation content", () => {
  const storage = new MemoryStorageAdapter();
  const { app } = createHarness({ storage });
  app.document = {
    querySelectorAll(selector) {
      if (selector !== "[data-thread-user-message-navigation-item-id]") return [];
      return Array.from({ length: 8 }, (_, offset) => ({ getAttribute: () => `q${offset + 21}` }));
    }
  };
  app.handleOfficialNavigationRecord({
    probeId: 7, host: "local", source: "sidebar-local", stable: true, startedAt: "2026-09-08T00:00:00.000Z", finishedReason: "settled",
    trigger: { trusted: true, path: [{ tag: "button", role: "button", classes: ["official-marker"], hasId: false, ariaLabel: { present: true, length: 12, kind: "text" }, dataAttributes: [{ name: "data-turn-id", kind: "uuid-like" }] }] },
    marker: { markerIndex: 21, markerCount: 50 },
    totalElapsedMs: 41, clickToFirstScrollMs: 5, clickToFirstWindowMs: 6, clickToFirstExtentMs: null, scrollEventCount: 1, mutationCount: 2,
    classification: "single-jump-window-swap",
    metrics: { logicalDelta: -8400, absoluteLogicalDelta: 8400, maxSingleLogicalDelta: 8400, distinctMotionSteps: 1, extentDelta: 0, windowChanged: true, containerChanged: false },
    before: { physicalScrollTop: 9000, scrollHeight: 20000, clientHeight: 800, logicalPosition: 9000, maxLogicalPosition: 19200, isColumnReverse: false, visibleRange: { min: 60, max: 75, count: 16 } },
    after: { physicalScrollTop: 600, scrollHeight: 20000, clientHeight: 800, logicalPosition: 600, maxLogicalPosition: 19200, isColumnReverse: false, visibleRange: { min: 0, max: 15, count: 16 } },
    samples: []
  });
  const saved = storage.read("gte.v3.official-navigation-diagnostics", []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].classification, "single-jump-window-swap");
  assert.equal(saved[0].mapping.oneToOneExact, true);
  assert.equal(saved[0].mapping.recommendedBridgeMode, "direct-exact-id");
  assert.equal(app.status().officialNavigationMapping.exactIdMatches, 8);
  assert.equal("conversationId" in saved[0], false);
  assert.equal("text" in saved[0], false);
  assert.equal(app.status().lastOfficialNavigation.host, "local");
  assert.equal(app.status().lastOfficialNavigation.learningSample.markerIndex, 21);
  assert.equal(app.status().lastOfficialNavigation.learningSample.targetOrder, 21);
  assert.equal(app.status().officialNavigationLearning.sampleCount, 1);
  assert.equal(app.status().officialNavigationLearning.observedPairs[0].markerIndex, 21);
  assert.equal(app.status().officialNavigationLearning.observedPairs[0].targetOrder, 21);
  const learned = storage.read("gte.v3.official-navigation-learning", []);
  assert.equal(learned.length, 1);
  assert.equal("turnId" in learned[0], false);
  const { app: restored } = createHarness({ storage });
  assert.equal(restored.status().officialNavigationHistory.length, 1);
  assert.equal(restored.status().lastOfficialNavigation.probeId, 7);
  assert.equal(restored.status().officialNavigationLearning.sampleCount, 1);
  assert.equal(restored.status().officialNavigationMapping.recommendedBridgeMode, "direct-exact-id");
});



test("Work official bridge stays runtime-disabled even when auto mapping would be ready", async () => {
  const storage = new MemoryStorageAdapter();
  const cache = new TimelineCache({ storage });
  cache.save("A", Array.from({ length: 50 }, (_, order) => ({ id: `q${order + 1}`, order, text: `Question ${order + 1}`, type: "text", lastSeen: order + 1 })));
  const { app, host, setActive } = createHarness({ storage });
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  let fallbackCalls = 0;
  host.navigateToTurn = async () => { fallbackCalls += 1; return { ok: true, verified: true, reason: "fallback" }; };
  const markers = [
    { getAttribute: (name) => name === "data-thread-user-message-navigation-item-id" ? "extra-top" : name === "aria-label" ? "Pinned" : null, click() {} },
    ...Array.from({ length: 50 }, (_, order) => ({
      getAttribute: (name) => name === "data-thread-user-message-navigation-item-id" ? `official-q${order + 1}` : name === "aria-label" ? `Jump to Q${order + 1}` : null,
      click() { setActive(`q${order + 1}`); }
    }))
  ];
  app.document = { querySelectorAll: (selector) => selector === '[data-thread-user-message-navigation-item-id]' ? markers : [], getElementById: () => null };
  const index = app.getTurnIndex("A");
  app.refreshOfficialWorkAutoBridge({ conversationId: "A", index, identity });
  app.refreshOfficialWorkAutoBridge({ conversationId: "A", index, identity });
  assert.equal(app.status().officialBridgeAuto.status, "auto-official-ready");
  assert.equal(app.status().officialBridgeAuto.coverage, 1);
  const result = await app.navigate("q23");
  assert.equal(result.reason, "fallback", JSON.stringify(result));
  assert.equal(Boolean(result.officialBridgeAttempted), false);
  assert.equal(Boolean(result.officialBridgeSucceeded), false);
  assert.equal(fallbackCalls, 1);
});

test("manual official learning never unlocks Work bridge when auto mapping is unavailable", () => {
  const { app, host } = createHarness();
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  app.document = { querySelectorAll: () => [], getElementById: () => null };
  const index = app.getTurnIndex("A");
  app.handleOfficialPrivateMarker({ probeId: 1, sessionKey: "A", markerKey: "manual-key" });
  app.recordOfficialPrivateMarkerLearning({ probeId: 1, targetOrder: 22, knownTurnCount: index.size() });
  app.handleOfficialPrivateMarker({ probeId: 2, sessionKey: "A", markerKey: "manual-key" });
  app.recordOfficialPrivateMarkerLearning({ probeId: 2, targetOrder: 22, knownTurnCount: index.size() });
  app.refreshOfficialWorkAutoBridge({ conversationId: "A", index, identity });
  assert.equal(app.status().officialBridgeAuto.status, "fallback-self");
  assert.equal(app.hasTrustedOfficialWorkBridgeCandidate({ targetOrder: 22, index, identity }), false);
});

test("disabled official bridge hooks cannot intercept the existing Work navigation", async () => {
  const { app, host } = createHarness();
  host.getConversationIdentity = () => ({ id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true });
  app.hasTrustedOfficialWorkBridgeCandidate = () => true;
  app.tryOfficialWorkBridge = async () => ({ attempted: true, succeeded: false, fallbackReason: "verify-timeout", elapsedMs: 90 });
  let fallbackCalls = 0;
  host.navigateToTurn = async (turnId) => { fallbackCalls += 1; return { ok: true, verified: true, target: turnId, reason: "ok" }; };
  const result = await app.navigate("q22");
  assert.equal(result.ok, true);
  assert.equal(fallbackCalls, 1);
  assert.equal(Boolean(result.officialBridgeAttempted), false);
  assert.equal(Boolean(result.officialBridgeSucceeded), false);
  assert.equal(result.officialBridgeFallbackReason ?? null, null);
});

test("L3 exact key-join dry-run stays stable across marker DOM rebuild and keeps diagnostics independent", async () => {
  const { app, host } = createHarness();
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  let sharedItems = Array.from({ length: 50 }, (_, order) => ({ turnKey: `q${order + 1}`, navKey: `dry-nav-${order + 1}` }));
  let markerClicks = 0;
  const makeMarker = (markerKey, items = sharedItems) => {
    const marker = {
      isConnected: true,
      getAttribute(name) { return name === "data-thread-user-message-navigation-item-id" ? markerKey : null; },
      click() { markerClicks += 1; }
    };
    const parent = { tag: 0, memoizedProps: { items }, pendingProps: null, memoizedState: null, return: null };
    const fiber = { tag: 5, key: markerKey, memoizedProps: { onClick() {} }, pendingProps: null, memoizedState: null, return: parent };
    Object.defineProperty(marker, "__reactFiber$dry", { value: fiber, configurable: true });
    return marker;
  };
  let currentMarkers = sharedItems.map((item) => makeMarker(item.navKey));
  currentMarkers.push(makeMarker("dry-nav-extra"));
  app.document = { querySelectorAll: (selector) => selector === "[data-thread-user-message-navigation-item-id]" ? currentMarkers : [] };
  const index = app.getTurnIndex("A");

  let adaptiveSchedules = 0;
  const originalScheduleAdaptive = app.scheduleL3AdaptiveRescan.bind(app);
  app.scheduleL3AdaptiveRescan = () => { adaptiveSchedules += 1; };
  const oneShot = app.runL3ResearchScan({ targetOrder: 22 });
  assert.equal(oneShot.status, "research-one-shot");
  assert.equal(oneShot.currentCoverage, 1);
  assert.equal(oneShot.currentOneToOne, true);
  assert.equal(oneShot.adaptiveRescanState, "research-frozen");
  assert.equal(adaptiveSchedules, 0);
  app.scheduleL3AdaptiveRescan = originalScheduleAdaptive;

  const first = app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity });
  assert.equal(first.status, "dry-run-scanning");
  assert.equal(first.stableScans, 1);
  assert.equal(first.summary.coverage, 1);
  assert.equal(first.summary.conflicts, 0);

  const second = app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity });
  assert.equal(second.status, "dry-run-ready");
  assert.equal(second.stableScans, 2);
  assert.equal(second.pairsByTarget.size, index.size());
  assert.equal(app.status().l3KeyJoinDryRun.status, "dry-run-ready");

  // Simulate Work rebuilding/reordering official markers while preserving exact join identities.
  const rebuilt = sharedItems.map((item) => makeMarker(item.navKey)).reverse();
  currentMarkers = [makeMarker("dry-nav-extra"), ...rebuilt];

  let hostCalls = 0;
  host.navigateToTurn = async (turnId) => { hostCalls += 1; return { ok: true, verified: true, target: turnId, reason: "work-self" }; };
  const result = await app.navigate("q23");
  assert.equal(result.reason, "work-self");
  assert.equal(hostCalls, 1);
  assert.equal(markerClicks, 0);
  app.clearL3PostNavigationScanTimer();
  app.recordL3KeyJoinDryRunTarget({ targetOrder: 22, index, identity });
  let dryRun = app.status().l3KeyJoinDryRun;
  assert.equal(dryRun.status, "dry-run-ready");
  assert.equal(dryRun.stableScans, 2);
  assert.equal(dryRun.mappingStable, true);
  assert.equal(dryRun.targetResolvable, true);
  assert.equal(dryRun.markerConnected, true);
  assert.equal(dryRun.currentMarkerCount, 51);
  assert.equal(dryRun.currentKnownTurnCount, index.size());
  assert.ok(dryRun.currentExactPatternCount >= 1);
  assert.ok(dryRun.currentRelationPatternCount >= dryRun.currentExactPatternCount);
  assert.ok(dryRun.currentMarkersWithKeyJoinCandidates >= index.size());
  assert.equal(dryRun.currentKeyJoinMappedMarkers, index.size());
  assert.equal(dryRun.currentKeyJoinUniqueTurns, index.size());
  assert.equal(dryRun.currentBestKeyJoinCoverage, 1);
  assert.equal(dryRun.currentBestKeyJoinConflicts, 0);
  assert.equal(dryRun.currentBestKeyJoinOneToOne, true);
  assert.equal(dryRun.currentMappedTurnCount, index.size());
  assert.equal(dryRun.currentCoverage, 1);
  assert.equal(dryRun.currentConflicts, 0);
  assert.equal(dryRun.currentOneToOne, true);
  assert.equal(dryRun.preferredPatternPresent, true);
  assert.equal(typeof dryRun.alternateExactPatternAvailable, "boolean");

  // Change only private join identities. Current target is still resolvable and connected, but mapping stability must fail independently.
  sharedItems = Array.from({ length: 50 }, (_, order) => ({ turnKey: `q${order + 1}`, navKey: `dry-new-${order + 1}` }));
  currentMarkers = [makeMarker("dry-new-extra", sharedItems), ...sharedItems.map((item) => makeMarker(item.navKey, sharedItems)).reverse()];
  const changed = await app.navigate("q23");
  assert.equal(changed.reason, "work-self");
  assert.equal(markerClicks, 0);
  app.clearL3PostNavigationScanTimer();
  app.recordL3KeyJoinDryRunTarget({ targetOrder: 22, index, identity });
  dryRun = app.status().l3KeyJoinDryRun;
  assert.equal(dryRun.mappingStable, false);
  assert.equal(dryRun.targetResolvable, true);
  assert.equal(dryRun.markerConnected, true);
  assert.equal(dryRun.currentMarkerCount, 51);
  assert.equal(dryRun.currentKnownTurnCount, index.size());
  assert.ok(dryRun.currentExactPatternCount >= 1);
  assert.ok(dryRun.currentRelationPatternCount >= dryRun.currentExactPatternCount);
  assert.ok(dryRun.currentMarkersWithKeyJoinCandidates >= index.size());
  assert.equal(dryRun.currentKeyJoinMappedMarkers, index.size());
  assert.equal(dryRun.currentKeyJoinUniqueTurns, index.size());
  assert.equal(dryRun.currentBestKeyJoinCoverage, 1);
  assert.equal(dryRun.currentBestKeyJoinConflicts, 0);
  assert.equal(dryRun.currentBestKeyJoinOneToOne, true);
  assert.equal(dryRun.currentMappedTurnCount, index.size());
  assert.equal(dryRun.currentCoverage, 1);
  assert.equal(dryRun.currentConflicts, 0);
  assert.equal(dryRun.currentOneToOne, true);
  assert.equal(dryRun.preferredPatternPresent, true);
  const publicJson = JSON.stringify(dryRun);
  assert.equal(publicJson.includes("dry-nav"), false);
  assert.equal(publicJson.includes("dry-new"), false);
  assert.equal(publicJson.includes("q23"), false);
});


test("L3 fresh diagnostics still run while the dry-run session is unstable", async () => {
  const { app, host } = createHarness();
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  const sharedItems = Array.from({ length: 50 }, (_, order) => ({ turnKey: `q${order + 1}`, navKey: `unstable-nav-${order + 1}` }));
  let markerClicks = 0;
  const makeMarker = (markerKey) => {
    const marker = {
      isConnected: true,
      getAttribute(name) { return name === "data-thread-user-message-navigation-item-id" ? markerKey : null; },
      click() { markerClicks += 1; }
    };
    const parent = { tag: 0, memoizedProps: { items: sharedItems }, pendingProps: null, memoizedState: null, return: null };
    const fiber = { tag: 5, key: markerKey, memoizedProps: { onClick() {} }, pendingProps: null, memoizedState: null, return: parent };
    Object.defineProperty(marker, "__reactFiber$unstable", { value: fiber, configurable: true });
    return marker;
  };
  const markers = [...sharedItems.map((item) => makeMarker(item.navKey)), makeMarker("unstable-nav-extra")];
  app.document = { querySelectorAll: (selector) => selector === "[data-thread-user-message-navigation-item-id]" ? markers : [] };
  const index = app.getTurnIndex("A");
  const session = app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity, finalAttempt: true });
  assert.equal(session.status, "dry-run-unstable");
  assert.equal(session.stableScans, 1);
  assert.ok(session.patternKey);

  host.navigateToTurn = async (turnId) => ({ ok: true, verified: true, target: turnId, reason: "work-self" });
  const result = await app.navigate("q23");
  assert.equal(result.reason, "work-self");
  assert.equal(markerClicks, 0);
  app.clearL3PostNavigationScanTimer();
  app.recordL3KeyJoinDryRunTarget({ targetOrder: 22, index, identity });

  const dryRun = app.status().l3KeyJoinDryRun;
  assert.equal(dryRun.status, "dry-run-ready");
  assert.equal(dryRun.stableScans, 2);
  assert.equal(dryRun.mappingStable, false);
  assert.equal(dryRun.targetResolvable, true);
  assert.equal(dryRun.markerConnected, true);
  assert.equal(dryRun.currentMarkerCount, 51);
  assert.equal(dryRun.currentKnownTurnCount, index.size());
  assert.ok(dryRun.currentExactPatternCount >= 1);
  assert.ok(dryRun.currentRelationPatternCount >= dryRun.currentExactPatternCount);
  assert.ok(dryRun.currentMarkersWithKeyJoinCandidates >= index.size());
  assert.equal(dryRun.currentKeyJoinMappedMarkers, index.size());
  assert.equal(dryRun.currentKeyJoinUniqueTurns, index.size());
  assert.equal(dryRun.currentBestKeyJoinCoverage, 1);
  assert.equal(dryRun.currentBestKeyJoinConflicts, 0);
  assert.equal(dryRun.currentBestKeyJoinOneToOne, true);
  assert.equal(dryRun.currentMappedTurnCount, index.size());
  assert.equal(dryRun.currentCoverage, 1);
  assert.equal(dryRun.currentConflicts, 0);
  assert.equal(dryRun.currentOneToOne, true);
  assert.equal(dryRun.preferredPatternPresent, true);
  assert.equal(typeof dryRun.alternateExactPatternAvailable, "boolean");
  const publicJson = JSON.stringify(dryRun);
  assert.equal(publicJson.includes("unstable-nav"), false);
  assert.equal(publicJson.includes("q23"), false);
});
test("L3 research runtime stays frozen during normal Local Work refresh and navigation", async () => {
  const { app, host } = createHarness();
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  let depthSchedules = 0;
  let postNavigationSchedules = 0;
  app.scheduleHostInternalDepthProbe = () => { depthSchedules += 1; };
  app.scheduleL3PostNavigationScan = () => { postNavigationSchedules += 1; };
  app.refresh("local-work-runtime-freeze");
  assert.equal(depthSchedules, 0);
  assert.equal(app.status().l3RuntimeEnabled, false);
  host.navigateToTurn = async (turnId) => {
    assert.equal(app.isLocalWorkNavigationActive(), true);
    return { ok: true, verified: true, target: turnId, reason: "work-self" };
  };
  const result = await app.navigate("q23");
  assert.equal(result.ok, true);
  assert.equal(app.activeNavigation, null);
  assert.equal(postNavigationSchedules, 0);
});

test("Local Work active navigation blocks L3 diagnostic scans and timers", () => {
  const { app, host } = createHarness();
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  const index = app.getTurnIndex("A");
  let queryCalls = 0;
  app.document = { querySelectorAll() { queryCalls += 1; return []; } };
  const session = app.getL3KeyJoinDryRunSession("A");
  session.patternKey = "private-pattern";
  const run = app.beginNavigationRun({ targetOrder: 22, identity });
  const before = app.l3KeyJoinDryRun;
  assert.equal(app.isLocalWorkNavigationActive(), true);
  assert.equal(app.recordL3KeyJoinDryRunTarget({ targetOrder: 22, index, identity }), before);
  assert.equal(app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity }), null);
  app.scheduleL3AdaptiveRescan({ conversationId: "A", targetOrder: 22, attempt: 0 });
  app.scheduleHostInternalDepthProbe("A", index, identity);
  app.startL3EventRecoveryWatch({ conversationId: "A", targetOrder: 22 });
  app.handleL3EventRecoveryMutation([{ type: "childList" }]);
  assert.equal(queryCalls, 0);
  assert.equal(app.l3AdaptiveRescanTimer, null);
  assert.equal(app.hostInternalDepthProbeTimer, null);
  assert.equal(app.l3EventRecoveryTimer, null);
  app.completeNavigationRun(run, { ok: true, verified: true, reason: "work-self" });
  assert.equal(app.isLocalWorkNavigationActive(), false);
});

test("L3 adaptive rescan follows official marker rebuild without clicking markers", () => {
  const { app, host } = createHarness();
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  let sharedItems = Array.from({ length: 50 }, (_, order) => ({ turnKey: `q${order + 1}`, navKey: `adaptive-nav-${order + 1}` }));
  let markerClicks = 0;
  const makeMarker = (markerKey, items = sharedItems) => {
    const marker = {
      isConnected: true,
      getAttribute(name) { return name === "data-thread-user-message-navigation-item-id" ? markerKey : null; },
      click() { markerClicks += 1; }
    };
    const parent = { tag: 0, memoizedProps: { items }, pendingProps: null, memoizedState: null, return: null };
    const fiber = { tag: 5, key: markerKey, memoizedProps: { onClick() {} }, pendingProps: null, memoizedState: null, return: parent };
    Object.defineProperty(marker, "__reactFiber$adaptive", { value: fiber, configurable: true });
    return marker;
  };
  let currentMarkers = [...sharedItems.map((item) => makeMarker(item.navKey)), makeMarker("adaptive-extra")];
  app.document = { querySelectorAll: (selector) => selector === "[data-thread-user-message-navigation-item-id]" ? currentMarkers : [] };
  const index = app.getTurnIndex("A");
  app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity });
  const ready = app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity });
  assert.equal(ready.status, "dry-run-ready");

  const scheduled = [];
  app.window = {
    setTimeout(callback, delay) {
      const token = { callback, delay, cancelled: false };
      scheduled.push(token);
      return token;
    },
    clearTimeout(token) { if (token) token.cancelled = true; }
  };

  currentMarkers = [
    ...sharedItems.map((item) => makeMarker(item.navKey)),
    makeMarker(sharedItems[20].navKey),
    makeMarker(sharedItems[21].navKey),
    makeMarker(sharedItems[22].navKey),
    makeMarker("adaptive-extra")
  ];
  const pending = app.recordL3KeyJoinDryRunTarget({ targetOrder: 22, index, identity });
  assert.equal(pending.adaptiveRescanState, "pending");
  assert.equal(pending.adaptiveRescanAttempt, 0);
  assert.equal(pending.freshMapAccepted, false);
  assert.equal(pending.currentExactPatternCount, 0);
  assert.ok(pending.currentBestKeyJoinConflicts >= 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 50);
  assert.equal(markerClicks, 0);

  sharedItems = Array.from({ length: 50 }, (_, order) => ({ turnKey: `q${order + 1}`, navKey: `adaptive-new-${order + 1}` }));
  currentMarkers = [...sharedItems.map((item) => makeMarker(item.navKey, sharedItems)), makeMarker("adaptive-new-extra", sharedItems)];
  scheduled[0].callback();

  const recovered = app.status().l3KeyJoinDryRun;
  assert.equal(recovered.adaptiveRescanState, "recovered");
  assert.equal(recovered.adaptiveRescanAttempt, 1);
  assert.equal(recovered.freshMapAccepted, true);
  assert.equal(recovered.currentCoverage, 1);
  assert.equal(recovered.currentConflicts, 0);
  assert.equal(recovered.currentOneToOne, true);
  assert.equal(recovered.targetResolvable, true);
  assert.equal(recovered.markerConnected, true);
  assert.equal(recovered.mappingStable, false);
  assert.equal(markerClicks, 0);

  const stable = app.recordL3KeyJoinDryRunTarget({ targetOrder: 22, index, identity });
  assert.equal(stable.mappingStable, true);
  assert.equal(stable.adaptiveRescanState, "stable");
  assert.equal(stable.freshMapAccepted, false);
  assert.equal(markerClicks, 0);
});
test("L3 exhausted adaptive scan recovers on a later official DOM mutation without polling", () => {
  const { app, host } = createHarness();
  const identity = { id: "local:A", source: "sidebar-local", host: "local", kind: "local", stable: true };
  host.getConversationIdentity = () => identity;
  let sharedItems = Array.from({ length: 50 }, (_, order) => ({ turnKey: `q${order + 1}`, navKey: `event-nav-${order + 1}` }));
  let markerClicks = 0;
  const makeMarker = (markerKey, items = sharedItems) => {
    const marker = {
      isConnected: true,
      getAttribute(name) { return name === "data-thread-user-message-navigation-item-id" ? markerKey : null; },
      click() { markerClicks += 1; }
    };
    const parent = { tag: 0, memoizedProps: { items }, pendingProps: null, memoizedState: null, return: null };
    const fiber = { tag: 5, key: markerKey, memoizedProps: { onClick() {} }, pendingProps: null, memoizedState: null, return: parent };
    Object.defineProperty(marker, "__reactFiber$event", { value: fiber, configurable: true });
    return marker;
  };
  let currentMarkers = [...sharedItems.map((item) => makeMarker(item.navKey)), makeMarker("event-extra")];
  app.document = { querySelectorAll: (selector) => selector === "[data-thread-user-message-navigation-item-id]" ? currentMarkers : [] };
  const index = app.getTurnIndex("A");
  app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity });
  assert.equal(app.refreshL3KeyJoinDryRun({ conversationId: "A", index, identity }).status, "dry-run-ready");

  const scheduled = [];
  app.window = {
    setTimeout(callback, delay) {
      const token = { callback, delay, cancelled: false };
      scheduled.push(token);
      return token;
    },
    clearTimeout(token) { if (token) token.cancelled = true; }
  };

  currentMarkers = [
    ...sharedItems.map((item) => makeMarker(item.navKey)),
    makeMarker(sharedItems[20].navKey),
    makeMarker(sharedItems[21].navKey),
    makeMarker(sharedItems[22].navKey),
    makeMarker("event-extra")
  ];
  const pending = app.recordL3KeyJoinDryRunTarget({ targetOrder: 22, index, identity });
  assert.equal(pending.adaptiveRescanState, "pending");
  assert.equal(scheduled[0].delay, 50);

  scheduled[0].callback();
  assert.equal(scheduled[1].delay, 120);
  scheduled[1].callback();
  assert.equal(scheduled[2].delay, 250);
  scheduled[2].callback();

  let state = app.status().l3KeyJoinDryRun;
  assert.equal(state.adaptiveRescanState, "exhausted-watching");
  assert.equal(state.adaptiveRescanAttempt, 3);
  assert.equal(state.freshMapAccepted, false);
  assert.ok(app.l3EventRecoveryWatch);
  assert.equal(app.l3EventRecoveryTimer, null);

  sharedItems = Array.from({ length: 50 }, (_, order) => ({ turnKey: `q${order + 1}`, navKey: `event-new-${order + 1}` }));
  currentMarkers = [...sharedItems.map((item) => makeMarker(item.navKey, sharedItems)), makeMarker("event-new-extra", sharedItems)];
  app.handleL3EventRecoveryMutation([{ type: "childList" }]);
  assert.equal(scheduled[3].delay, 140);
  app.handleL3EventRecoveryMutation([{ type: "attributes" }]);
  assert.equal(scheduled.length, 4);
  scheduled[3].callback();

  state = app.status().l3KeyJoinDryRun;
  assert.equal(state.adaptiveRescanState, "recovered-event");
  assert.equal(state.adaptiveRescanAttempt, 3);
  assert.equal(state.freshMapAccepted, true);
  assert.equal(state.currentCoverage, 1);
  assert.equal(state.currentConflicts, 0);
  assert.equal(state.currentOneToOne, true);
  assert.equal(state.targetResolvable, true);
  assert.equal(state.markerConnected, true);
  assert.equal(app.l3EventRecoveryWatch, null);
  assert.equal(app.l3EventRecoveryTimer, null);
  assert.equal(markerClicks, 0);
});

test("Chat never invokes official Work markers even when learned data exists", async () => {
  const { app, host } = createHarness();
  host.getConversationIdentity = () => ({ id: "chat:A", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  let markerClicks = 0;
  app.document = { querySelectorAll: () => [{ click() { markerClicks += 1; } }] };
  app.officialNavigationSessionLearning = { markerCount: 1, knownTurnCount: 8, markerConflicts: 0, targetConflicts: 0, oneToOneObserved: true, monotonic: true, observedPairs: [{ markerIndex: 0, targetOrder: 21, hits: 3 }] };
  let hostCalls = 0;
  host.navigateToTurn = async (turnId) => { hostCalls += 1; return { ok: true, verified: true, target: turnId, reason: "ok" }; };
  const result = await app.navigate("q22");
  assert.equal(result.ok, true);
  assert.equal(hostCalls, 1);
  assert.equal(markerClicks, 0);
  assert.equal(result.officialBridgeAttempted, undefined);
});

test("Local Work navigation waits for the short host restore settle window", async () => {
  const { app, host } = createHarness();
  host.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", source: "sidebar-local", host: "local", kind: "local", stable: true });
  let calledAt = 0;
  host.navigateToTurn = async (turnId) => { calledAt = Date.now(); return { ok: true, target: turnId, verified: true }; };
  const startedAt = Date.now();
  app.localNavigationSettleUntil = startedAt + 25;
  const result = await app.navigate("q4");
  assert.equal(result.ok, true);
  assert.ok(calledAt - startedAt >= 15, `expected Local navigation to wait for host settle, got ${calledAt - startedAt}ms`);
});

test("Local Work notifies Codex++ scroll intent before waiting for host restore settle", async () => {
  const { app, host } = createHarness();
  host.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", source: "sidebar-local", host: "local", kind: "local", stable: true });
  const events = [];
  host.notifyNavigationIntent = () => { events.push({ kind: "intent", at: Date.now() }); return true; };
  host.navigateToTurn = async (turnId) => { events.push({ kind: "navigate", at: Date.now() }); return { ok: true, target: turnId, verified: true }; };
  const startedAt = Date.now();
  app.localNavigationSettleUntil = startedAt + 25;
  const result = await app.navigate("q4");
  assert.equal(result.ok, true);
  assert.equal(events[0]?.kind, "intent");
  assert.equal(events[1]?.kind, "navigate");
  assert.ok(events[1].at - startedAt >= 15);
});