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
  return { app, host, shellState, turns, getActive: () => active, setConversationId: (value) => { conversationId = value; }, setSurface: (value) => { surface = value; } };
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
  assert.equal(status.version, "0.5.1");
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
  assert.equal(app.status().navigation.settleMode, "mounted-fast");
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
