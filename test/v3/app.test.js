import test from "node:test";
import assert from "node:assert/strict";
import { TalkEnhancerV3App, analyzeChatIndexOrderHealth, reconcileChatVisibleTurns, resolvePinnedChatConversationCandidate } from "../../src/v3/bootstrap.js";
import { MemoryStorageAdapter } from "../../src/v3/core/storage.js";
import { SURFACE } from "../../src/v3/host/host-interface.js";
import { TimelineCache } from "../../src/v3/core/timeline-cache.js";
import { WORK_TIMELINE_CACHE_KEY } from "../../src/v3/core/work-timeline-cache.js";
import { TurnIndex } from "../../src/v3/core/turn-index.js";

test("Chat index order health detects duplicate and internal missing orders without flagging a nonzero partial window", () => {
  const duplicate = analyzeChatIndexOrderHealth([
    { id: "a", order: 0 },
    { id: "b", order: 1 },
    { id: "c", order: 1 },
    { id: "d", order: 3 }
  ]);
  assert.equal(duplicate.corrupt, true);
  assert.deepEqual(duplicate.duplicateOrders, [1]);
  assert.deepEqual(duplicate.missingOrders, [2]);

  const partial = analyzeChatIndexOrderHealth([
    { id: "x", order: 11 },
    { id: "y", order: 12 },
    { id: "z", order: 13 }
  ]);
  assert.equal(partial.corrupt, false);
  assert.deepEqual(partial.missingOrders, []);
});

test("Chat reconciliation rejects two staged records that claim the same absolute order", () => {
  const index = new TurnIndex();
  const diagnostics = {};
  const trusted = reconcileChatVisibleTurns(index, [
    { id: "staged-a", order: 4, orderTrust: "absolute", text: "A", source: "dom", visible: true },
    { id: "staged-b", order: 4, orderTrust: "absolute", text: "B", source: "dom", visible: true }
  ], diagnostics);
  assert.equal(trusted.length, 1);
  assert.equal(trusted[0].id, "staged-a");
  assert.equal(diagnostics.turns[1].reason, "staged-order-collision");
});

test("Pinned Chat candidate resolver prefers one unique visible id overlap", () => {
  const visible = [
    { id: "12345678-1234-4234-8234-000000000001", text: "" },
    { id: "12345678-1234-4234-8234-000000000002", text: "" }
  ];
  const resolved = resolvePinnedChatConversationCandidate(visible, [
    { conversationId: "chat-a", turns: [{ id: "12345678-1234-4234-8234-000000000099", text: "" }] },
    { conversationId: "chat-b", turns: [{ id: "12345678-1234-4234-8234-000000000002", text: "" }] }
  ]);
  assert.deepEqual(resolved, { conversationId: "chat-b", evidence: "visible-uuid-overlap", score: 1 });
});

test("Pinned Chat full text sequence beats stale partial UUID overlap from another cache", () => {
  const visible = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000011", text: "Q11" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000012", text: "Q12" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000013", text: "Q13" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000014", text: "Q14" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000015", text: "Q15" }
  ];
  const resolved = resolvePinnedChatConversationCandidate(visible, [
    {
      conversationId: "chat-correct",
      turns: visible.map((turn, order) => ({ ...turn, order }))
    },
    {
      conversationId: "chat-stale",
      turns: visible.slice(0, 4).map((turn, order) => ({ ...turn, text: "stale-" + order, order }))
    }
  ]);
  assert.deepEqual(resolved, {
    conversationId: "chat-correct",
    evidence: "visible-text-sequence",
    score: 5
  });
});

test("Pinned Chat fallback ids cannot create cross-cache identity ambiguity ahead of a full text sequence", () => {
  const visible = Array.from({ length: 6 }, (_, offset) => ({
    id: "fallback-turn-" + (20 + offset),
    text: "Folder Q" + (20 + offset)
  }));
  const resolved = resolvePinnedChatConversationCandidate(visible, [
    {
      conversationId: "project-correct",
      turns: visible.map((turn, order) => ({ ...turn, order }))
    },
    {
      conversationId: "old-cache-a",
      turns: visible.map((turn, order) => ({ ...turn, text: order === 0 ? turn.text : "old-a-" + order, order }))
    },
    {
      conversationId: "old-cache-b",
      turns: visible.map((turn, order) => ({ ...turn, text: order === 0 ? turn.text : "old-b-" + order, order }))
    }
  ]);
  assert.deepEqual(resolved, {
    conversationId: "project-correct",
    evidence: "visible-text-sequence",
    score: 6
  });
});

test("Pinned Chat candidate resolver accepts only one unique two-turn text sequence", () => {
  const visible = [
    { id: "dom-1", text: "Pinned first question" },
    { id: "dom-2", text: "Pinned second question" }
  ];
  const resolved = resolvePinnedChatConversationCandidate(visible, [
    { conversationId: "chat-a", turns: [{ id: "a1", text: "other" }, { id: "a2", text: "Pinned second question" }] },
    { conversationId: "chat-b", turns: [{ id: "b1", text: "start" }, { id: "b2", text: "Pinned first question" }, { id: "b3", text: "Pinned second question" }] }
  ]);
  assert.deepEqual(resolved, { conversationId: "chat-b", evidence: "visible-text-sequence", score: 2 });
});

test("Pinned Chat candidate resolver accepts one unique normalized two-turn request sequence", () => {
  const visible = [
    { id: "dom-1", text: "Selected text:\ncontext one\n\nMy request:\nPinned first question" },
    { id: "dom-2", text: "Selection 2:\ncontext two\n\nMy request: Pinned second question" }
  ];
  const resolved = resolvePinnedChatConversationCandidate(visible, [
    { conversationId: "chat-a", turns: [{ id: "a1", text: "other" }, { id: "a2", text: "Pinned second question" }] },
    { conversationId: "chat-b", turns: [{ id: "b1", text: "Pinned first question" }, { id: "b2", text: "Pinned second question" }] }
  ]);
  assert.deepEqual(resolved, { conversationId: "chat-b", evidence: "visible-normalized-text-sequence", score: 2 });
});

test("Pinned Chat normalized fallback remains fail-closed when two candidates match", () => {
  const visible = [
    { id: "dom-1", text: "My request: same first" },
    { id: "dom-2", text: "My request: same second" }
  ];
  const candidates = [
    { conversationId: "chat-a", turns: [{ id: "a1", text: "same first" }, { id: "a2", text: "same second" }] },
    { conversationId: "chat-b", turns: [{ id: "b1", text: "same first" }, { id: "b2", text: "same second" }] }
  ];
  assert.equal(resolvePinnedChatConversationCandidate(visible, candidates), null);
});

test("Pinned Chat candidate resolver fails closed for ambiguous or weak evidence", () => {
  const repeated = [
    { conversationId: "chat-a", turns: [{ id: "a1", text: "继续" }, { id: "a2", text: "继续" }] },
    { conversationId: "chat-b", turns: [{ id: "b1", text: "继续" }, { id: "b2", text: "继续" }] }
  ];
  assert.equal(resolvePinnedChatConversationCandidate([{ id: "dom-1", text: "继续" }], repeated), null);
  assert.equal(resolvePinnedChatConversationCandidate([
    { id: "dom-1", text: "继续" }, { id: "dom-2", text: "继续" }
  ], repeated), null);
});

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

test("Pinned Chat unique visible evidence restores its inferred conversation Timeline", () => {
  const { app, host, shellState } = createHarness();
  const capturedTurns = [
    { id: "pin-b-1", order: 0, text: "Pinned B first", source: "capture", visible: false },
    { id: "pin-b-2", order: 1, text: "Pinned B second", source: "capture", visible: false },
    { id: "pin-b-3", order: 2, text: "Pinned B third", source: "capture", visible: false }
  ];
  app.handleCapture({ conversationId: "B", turns: capturedTurns });
  const visible = capturedTurns.slice(1).map((turn, windowOrder) => ({
    ...turn, source: "dom", visible: true, order: windowOrder, windowOrder, orderTrust: "window"
  }));
  let inferredId = null;
  host.getDirectConversationIdentity = () => null;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };
  host.getConversationIdentity = () => inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null;
  host.getConversationId = () => inferredId;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => "pin-b-2";
  host.getRoute = () => "/index.html";
  app.currentConversationId = null;
  app.refresh("pinned-chat-inferred");
  assert.equal(inferredId, "B");
  assert.equal(app.currentConversationId, "B");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["Pinned B first", "Pinned B second", "Pinned B third"]);
});

test("Q navigation identity loss recovers the same Timeline from a unique full window despite stale UUID overlap", () => {
  const { app, host, shellState } = createHarness();
  const correctId = "pinned-chat:1111111111111111";
  const staleId = "pinned-chat:2222222222222222";
  const uuid = (n) => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
  const correctTurns = Array.from({ length: 5 }, (_, offset) => ({
    id: uuid(11 + offset),
    order: 11 + offset,
    text: "Q" + (11 + offset),
    source: "dom",
    visible: false
  }));
  const staleTurns = correctTurns.slice(0, 4).map((turn, offset) => ({
    ...turn,
    text: "stale " + offset
  }));
  const correctIndex = new TurnIndex();
  correctIndex.mergeMany(correctTurns);
  const staleIndex = new TurnIndex();
  staleIndex.mergeMany(staleTurns);
  app.turnIndexes.clear();
  app.turnIndexes.set(correctId, correctIndex);
  app.turnIndexes.set(staleId, staleIndex);
  app.currentConversationId = correctId;

  const visible = correctTurns.map((turn, windowOrder) => ({
    ...turn,
    order: windowOrder,
    windowOrder,
    visualOrder: windowOrder,
    orderTrust: "window",
    visible: true
  }));
  let inferredId = null;
  host.getDirectConversationIdentity = () => null;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };
  host.getConversationIdentity = () => inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null;
  host.getConversationId = () => inferredId;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => uuid(13);
  host.getRoute = () => "/index.html";

  app.refresh("q13-post-navigation-identity-gap");

  assert.equal(inferredId, correctId);
  assert.equal(app.lastPinnedChatInference.evidence, "visible-text-sequence");
  assert.equal(app.lastRefreshDiagnostics.branch, "resolved-conversation");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["Q11", "Q12", "Q13", "Q14", "Q15"]);
});

test("Project Chat identity loss recovers from a unique full text window despite shared fallback ids", () => {
  const { app, host, shellState } = createHarness();
  const correctId = "project-chat:3333333333333333";
  const staleA = "project-chat:4444444444444444";
  const staleB = "project-chat:5555555555555555";
  const visible = Array.from({ length: 6 }, (_, offset) => ({
    id: "fallback-turn-" + (20 + offset),
    order: 20 + offset,
    windowOrder: offset,
    visualOrder: offset,
    orderTrust: "absolute",
    text: "Folder Q" + (20 + offset),
    source: "dom",
    visible: true
  }));
  const makeIndex = (turns) => {
    const index = new TurnIndex();
    index.mergeMany(turns);
    return index;
  };
  app.turnIndexes.clear();
  app.turnIndexes.set(correctId, makeIndex(visible.map((turn) => ({ ...turn, visible: false }))));
  app.turnIndexes.set(staleA, makeIndex(visible.map((turn, order) => ({
    ...turn,
    text: order === 0 ? turn.text : "old-a-" + order,
    visible: false
  }))));
  app.turnIndexes.set(staleB, makeIndex(visible.map((turn, order) => ({
    ...turn,
    text: order === 0 ? turn.text : "old-b-" + order,
    visible: false
  }))));
  app.currentConversationId = correctId;

  let inferredId = null;
  host.getDirectConversationIdentity = () => null;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };
  host.getConversationIdentity = () => inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null;
  host.getConversationId = () => inferredId;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => "fallback-turn-22";
  host.getRoute = () => "/index.html";

  app.refresh("project-chat-recover-after-identity-loss");

  assert.equal(inferredId, correctId);
  assert.equal(app.lastPinnedChatInference.evidence, "visible-text-sequence");
  assert.equal(app.lastRefreshDiagnostics.branch, "resolved-conversation");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), visible.map((turn) => turn.text));
});

test("Pinned content click waits for a real UUID window transition before inferring an isolated Chat identity", () => {
  const { app, host } = createHarness();
  const rawDropKey = "private-pinned-drop-key-123456789";
  let inferredId = null;
  let directIdentity = { id: "chat-old", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  let visible = [
    { id: "12345678-1234-4234-8234-123456789e01", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Old Q1", source: "dom", visible: true },
    { id: "12345678-1234-4234-8234-123456789e02", order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Old Q2", source: "dom", visible: true }
  ];
  app.currentConversationId = "chat-old";
  app.scheduleConversationSelectRetry = () => {};
  host.getDirectConversationIdentity = () => directIdentity;
  host.getConversationIdentity = () => directIdentity ?? (inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null);
  host.getConversationId = () => host.getConversationIdentity()?.id ?? null;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };

  const row = {
    getAttribute(name) {
      return name === "data-pinned-content-tab-drop-key" ? rawDropKey : null;
    }
  };
  app.handleConversationSelect({ target: { closest: () => row } });

  assert.ok(app.pendingPinnedChatSelection);
  assert.match(app.pendingPinnedChatSelection.conversationId, /^pinned-chat:[0-9a-f]{16}$/);
  assert.equal(app.pendingPinnedChatSelection.conversationId.includes(rawDropKey), false);

  assert.equal(app.refreshPinnedChatInference(SURFACE.CONVERSATION), null);
  assert.equal(inferredId, null);
  assert.equal(app.lastPinnedClickTransition.state, "waiting");

  visible = [
    { id: "12345678-1234-4234-8234-123456789f01", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Pinned Q1", source: "dom", visible: true },
    { id: "12345678-1234-4234-8234-123456789f02", order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Pinned Q2", source: "dom", visible: true }
  ];
  assert.equal(app.refreshPinnedChatInference(SURFACE.CONVERSATION), null);
  assert.equal(inferredId, null);
  assert.equal(app.lastPinnedClickTransition.state, "waiting-stale-direct");

  directIdentity = null;
  const inferred = app.refreshPinnedChatInference(SURFACE.CONVERSATION);
  assert.ok(inferred?.stable);
  assert.equal(inferred?.host, "chatgpt");
  assert.match(inferred?.id ?? "", /^pinned-chat:[0-9a-f]{16}$/);
  assert.equal(inferredId, inferred.id);
  assert.equal(app.pendingPinnedChatSelection, null);
  assert.equal(app.lastPinnedChatInference.result, "pinned-click-visible-window-transition");
  assert.equal(app.lastPinnedClickTransition.overlapCount, 0);
  assert.equal(app.activePinnedChatConversationId, inferred.id);
  assert.equal(JSON.stringify(app.lastPinnedClickTransition).includes(rawDropKey), false);

  visible = [
    { id: "12345678-1234-4234-8234-123456789f11", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Pinned earlier Q", source: "dom", visible: true }
  ];
  const latched = app.refreshPinnedChatInference(SURFACE.CONVERSATION);
  assert.equal(latched?.id, inferred.id);
  assert.equal(inferredId, inferred.id);
  assert.equal(app.lastPinnedChatInference.result, "pinned-click-latched");
  assert.equal(app.activePinnedChatConversationId, inferred.id);
});

test("Project-folder Chat click latches a unique synthetic identity after fallback content changes", () => {
  const { app, host } = createHarness();
  let inferredId = null;
  let visible = [
    { id: "fallback-turn-20", order: 20, orderTrust: "absolute", text: "Old 21", source: "dom", visible: true },
    { id: "fallback-turn-21", order: 21, orderTrust: "absolute", text: "Old 22", source: "dom", visible: true }
  ];
  const titleNode = { textContent: "阶段性完成" };
  let trigger = null;
  const projectScope = {
    getAttribute(name) {
      return name === "data-sidebar-project-container-id" ? "project-private-id" : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-thread-title-trigger]" ? [trigger] : [];
    }
  };
  trigger = {
    textContent: "阶段性完成",
    getAttribute() { return null; },
    querySelector(selector) { return selector === "[data-thread-title]" ? titleNode : null; },
    closest(selector) {
      if (selector.includes(",") && selector.includes("[data-thread-title-trigger]")) return trigger;
      if (selector === "[data-thread-title-trigger]") return trigger;
      if (selector.includes("[data-pinned-content-tab-drop-key]")) return null;
      if (selector.includes("[data-sidebar-project-container-id]")) return projectScope;
      return null;
    }
  };

  app.scheduleConversationSelectRetry = () => {};
  host.getDirectConversationIdentity = () => null;
  host.getConversationIdentity = () => inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null;
  host.getConversationId = () => inferredId;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };

  app.handleConversationSelect({ target: trigger });
  assert.ok(app.pendingPinnedChatSelection);
  assert.equal(app.pendingPinnedChatSelection.kind, "project");
  assert.match(app.pendingPinnedChatSelection.conversationId, /^project-chat:[0-9a-f]{16}$/);

  assert.equal(app.refreshPinnedChatInference(SURFACE.CONVERSATION), null);
  visible = [
    { id: "fallback-turn-20", order: 20, orderTrust: "absolute", text: "New 21", source: "dom", visible: true },
    { id: "fallback-turn-21", order: 21, orderTrust: "absolute", text: "New 22", source: "dom", visible: true }
  ];
  const identity = app.refreshPinnedChatInference(SURFACE.CONVERSATION);
  assert.equal(identity?.host, "chatgpt");
  assert.equal(identity?.stable, true);
  assert.match(identity?.id ?? "", /^project-chat:[0-9a-f]{16}$/);
  assert.equal(app.lastPinnedChatInference.result, "project-chat-click-visible-window-transition");
  assert.equal(app.lastPinnedClickTransition.selectionKind, "project");
  assert.equal(app.lastPinnedClickTransition.signatureChanged, true);
});

test("Project-folder Chat synthetic identity fails closed for duplicate titles in one project", () => {
  const { app } = createHarness();
  const titleNode = { textContent: "重复标题" };
  const duplicate = { querySelector: () => titleNode, textContent: "重复标题" };
  let trigger = null;
  const projectScope = {
    getAttribute(name) {
      return name === "data-sidebar-project-container-id" ? "project-private-id" : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-thread-title-trigger]" ? [trigger, duplicate] : [];
    }
  };
  trigger = {
    textContent: "重复标题",
    getAttribute() { return null; },
    querySelector(selector) { return selector === "[data-thread-title]" ? titleNode : null; },
    closest(selector) {
      if (selector.includes(",") && selector.includes("[data-thread-title-trigger]")) return trigger;
      if (selector === "[data-thread-title-trigger]") return trigger;
      if (selector.includes("[data-pinned-content-tab-drop-key]")) return null;
      if (selector.includes("[data-sidebar-project-container-id]")) return projectScope;
      return null;
    }
  };
  app.scheduleConversationSelectRetry = () => {};
  app.handleConversationSelect({ target: trigger });
  assert.equal(app.pendingPinnedChatSelection, null);
});

test("Pinned content click prefers a new real direct Chat identity over the synthetic namespace", () => {
  const { app, host } = createHarness();
  let inferredId = null;
  let directIdentity = { id: "chat-old", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  let visible = [
    { id: "12345678-1234-4234-8234-123456789a11", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Old", source: "dom", visible: true }
  ];
  app.currentConversationId = "chat-old";
  app.turnIndexes.delete("chat-old");
  app.scheduleConversationSelectRetry = () => {};
  host.getDirectConversationIdentity = () => directIdentity;
  host.getConversationIdentity = () => directIdentity ?? (inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null);
  host.getConversationId = () => host.getConversationIdentity()?.id ?? null;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };

  const row = { getAttribute: (name) => name === "data-pinned-content-tab-drop-key" ? "pinned-direct-win" : null };
  app.handleConversationSelect({ target: { closest: () => row } });

  visible = [
    { id: "12345678-1234-4234-8234-123456789a12", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "New", source: "dom", visible: true }
  ];
  directIdentity = { id: "chat-real-new", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  const resolved = app.refreshPinnedChatInference(SURFACE.CONVERSATION);

  assert.equal(resolved?.id, "chat-real-new");
  assert.equal(inferredId, null);
  assert.equal(app.pendingPinnedChatSelection, null);
  assert.equal(app.activePinnedChatConversationId, null);
  assert.equal(app.lastPinnedClickTransition.state, "direct-transition");
  assert.equal(app.lastPinnedChatInference.result, "direct-stable");
});

test("Explicit null direct identity never clears a latched inferred pinned Chat during virtual-window replacement", () => {
  const { app, host } = createHarness();
  const syntheticId = "pinned-chat:fedcba9876543210";
  let inferredId = syntheticId;
  let clearCount = 0;
  const visible = [
    { id: "12345678-1234-4234-8234-123456789d11", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Earlier pinned turn", source: "dom", visible: true }
  ];
  app.activePinnedChatConversationId = syntheticId;
  app.currentConversationId = syntheticId;
  host.getDirectConversationIdentity = () => null;
  host.getConversationIdentity = () => inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { clearCount += 1; inferredId = null; return true; };
  host.getChatVisibleTurns = () => visible;

  const resolved = app.refreshPinnedChatInference(SURFACE.CONVERSATION);

  assert.equal(resolved?.id, syntheticId);
  assert.equal(inferredId, syntheticId);
  assert.equal(clearCount, 0);
  assert.equal(app.lastPinnedChatInference.result, "pinned-click-latched");
  assert.equal(app.activePinnedChatConversationId, syntheticId);
});

test("Synthetic pinned Chat identity never uses one-text direct rekey evidence", () => {
  const { app } = createHarness();
  const sourceId = "pinned-chat:0123456789abcdef";
  const source = new TurnIndex();
  source.mergeMany([{ id: "pinned-old-q1", order: 0, text: "Same one line", source: "dom", visible: true }]);
  app.turnIndexes.clear();
  app.turnIndexes.set(sourceId, source);
  app.currentConversationId = sourceId;
  app.recentStableChatIdentity = {
    conversationId: sourceId,
    visibleIds: new Set(["pinned-old-q1"]),
    confirmedAt: 1000
  };
  app.window = { performance: { now: () => 1200 } };

  const result = app.adoptDirectChatIdentity(
    { id: "real-chat-id", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true },
    [{ id: "different-live-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "Same one line", source: "dom", visible: true }]
  );

  assert.equal(result.migrated, false);
  assert.equal(result.evidence, null);
  assert.equal(app.getTurnIndex("real-chat-id").size(), 0);
});

test("New Chat bootstrap stays blank on one unanchored user turn and resolves after two-turn evidence", () => {
  const { app, host, shellState } = createHarness();
  app.scheduleChatIdentitySettleRetry = () => false;
  let inferredId = null;
  let visible = [
    { id: "live-new-1", order: 0, windowOrder: 0, orderTrust: "window", text: "First new Chat question", source: "dom", visible: true }
  ];
  host.getDirectConversationIdentity = () => null;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };
  host.getConversationIdentity = () => inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null;
  host.getConversationId = () => inferredId;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => visible.at(-1)?.id ?? null;
  host.getRoute = () => "/index.html";
  app.currentConversationId = null;

  app.refresh("new-chat-one-turn");
  assert.equal(inferredId, null);
  assert.equal(app.currentConversationId, null);
  assert.deepEqual(shellState.turns, []);
  assert.equal(app.lastPinnedChatInference.result, "no-unique-candidate");
  assert.equal(app.lastPinnedChatInference.visibleTurnCount, 1);
  assert.equal(app.lastRefreshDiagnostics.branch, "conversation-without-identity");

  const candidate = new TurnIndex();
  candidate.replaceCapture([
    { id: "capture-new-1", order: 0, text: "First new Chat question", source: "capture", visible: false },
    { id: "capture-new-2", order: 1, text: "Second new Chat question", source: "capture", visible: false }
  ]);
  app.turnIndexes.set("new-chat", candidate);
  visible = [
    { id: "live-new-1", order: 0, windowOrder: 0, orderTrust: "window", text: "First new Chat question", source: "dom", visible: true },
    { id: "live-new-2", order: 1, windowOrder: 1, orderTrust: "window", text: "Second new Chat question", source: "dom", visible: true }
  ];

  app.refresh("new-chat-two-turns");
  assert.equal(inferredId, "new-chat");
  assert.equal(app.currentConversationId, "new-chat");
  assert.equal(app.lastPinnedChatInference.result, "inferred-set");
  assert.equal(app.lastPinnedChatInference.evidence, "visible-text-sequence");
  assert.equal(app.lastRefreshDiagnostics.branch, "resolved-conversation");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["First new Chat question", "Second new Chat question"]);
});

test("New Chat first Question appears after bounded direct-identity settle without waiting for Q2", () => {
  const { app, host, shellState } = createHarness();
  let directIdentity = null;
  let visible = [
    { id: "live-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "First live question", source: "dom", visible: true }
  ];
  const timers = [];
  app.window = {
    setTimeout(callback, delay) {
      const token = { callback, delay, cleared: false };
      timers.push(token);
      return token;
    },
    clearTimeout(token) { if (token) token.cleared = true; }
  };
  host.getSurface = () => SURFACE.CONVERSATION;
  host.getDirectConversationIdentity = () => directIdentity;
  host.getConversationIdentity = () => directIdentity;
  host.getConversationId = () => directIdentity?.id ?? null;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => visible.at(-1)?.id ?? null;
  host.getRoute = () => "/index.html";

  const index = new TurnIndex();
  index.replaceCapture([
    { id: "capture-q1", order: 0, text: "First live question", source: "capture", visible: false }
  ]);
  app.turnIndexes.set("chat-new", index);
  app.currentConversationId = null;

  app.refresh("new-chat-q1-before-identity");
  assert.deepEqual(shellState.turns, []);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 240);

  directIdentity = { id: "chat-new", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  timers[0].callback();
  assert.equal(app.currentConversationId, "chat-new");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["First live question"]);
  assert.equal(app.lastRefreshDiagnostics.branch, "resolved-conversation");

  visible = [
    ...visible,
    { id: "live-q2", order: 1, windowOrder: 1, orderTrust: "window", text: "Second live question", source: "dom", visible: true }
  ];
  app.refresh("new-chat-q2");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["First live question", "Second live question"]);
});

test("New Chat Q1 survives a later identity gap by recent visible UUID continuity", () => {
  const { app, host, shellState, setSurface } = createHarness();
  let directIdentity = { id: "chat-new", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  let inferredId = null;
  const visible = [
    { id: "live-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "First live question", source: "dom", visible: true }
  ];
  const index = new TurnIndex();
  index.replaceCapture([
    { id: "live-q1", order: 0, text: "First live question", source: "capture", visible: false }
  ]);
  app.turnIndexes.set("chat-new", index);
  host.getDirectConversationIdentity = () => directIdentity;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };
  host.getConversationIdentity = () => directIdentity ?? (inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null);
  host.getConversationId = () => host.getConversationIdentity()?.id ?? null;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => "live-q1";
  host.getRoute = () => "/index.html";
  app.currentConversationId = null;

  app.refresh("new-chat-q1-direct");
  assert.equal(app.currentConversationId, "chat-new");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["First live question"]);

  directIdentity = null;
  setSurface(SURFACE.SETTINGS);
  app.refresh("transient-non-conversation");
  assert.equal(app.currentConversationId, null);

  setSurface(SURFACE.CONVERSATION);
  app.refresh("new-chat-q1-identity-gap");
  assert.equal(inferredId, "chat-new");
  assert.equal(app.currentConversationId, "chat-new");
  assert.equal(app.lastPinnedChatInference.result, "recent-visible-id-overlap");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["First live question"]);
});

test("Recent Chat continuity never crosses to a different visible UUID", () => {
  const { app, host, shellState, setSurface } = createHarness();
  let directIdentity = { id: "chat-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  let inferredId = null;
  let visible = [
    { id: "chat-a-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "Same short text", source: "dom", visible: true }
  ];
  const index = new TurnIndex();
  index.replaceCapture([
    { id: "chat-a-q1", order: 0, text: "Same short text", source: "capture", visible: false }
  ]);
  app.turnIndexes.set("chat-a", index);
  host.getDirectConversationIdentity = () => directIdentity;
  host.setInferredChatConversationId = (id) => { inferredId = id; return true; };
  host.clearInferredChatConversationId = () => { inferredId = null; return true; };
  host.getConversationIdentity = () => directIdentity ?? (inferredId
    ? { id: inferredId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true }
    : null);
  host.getConversationId = () => host.getConversationIdentity()?.id ?? null;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => visible.at(-1)?.id ?? null;
  host.getRoute = () => "/index.html";
  app.currentConversationId = null;

  app.refresh("chat-a-direct");
  directIdentity = null;
  setSurface(SURFACE.SETTINGS);
  app.refresh("chat-a-left");
  visible = [
    { id: "chat-b-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "Same short text", source: "dom", visible: true }
  ];
  setSurface(SURFACE.CONVERSATION);
  app.scheduleChatIdentitySettleRetry = () => false;
  app.refresh("different-chat-visible");
  assert.equal(inferredId, null);
  assert.equal(app.currentConversationId, null);
  assert.deepEqual(shellState.turns, []);
  assert.equal(app.lastPinnedChatInference.result, "no-unique-candidate");
});

test("Direct Chat UUID handoff migrates namespaced Q1 and keeps Q2 as order 1", () => {
  const { app, host, shellState } = createHarness();
  const directId = "12345678-1234-4234-8234-123456789abc";
  const namespacedId = `chatgpt:conversation:${directId}`;
  const visible = [
    { id: "live-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "First live question", source: "dom", visible: true },
    { id: "live-q2", order: 1, windowOrder: 1, orderTrust: "window", text: "Second live question", source: "dom", visible: true }
  ];
  const source = new TurnIndex();
  source.mergeMany([
    { id: "live-q1", order: 0, text: "First live question", source: "dom", visible: true }
  ]);
  app.turnIndexes.clear();
  app.turnIndexes.set(namespacedId, source);
  app.currentConversationId = namespacedId;
  host.getDirectConversationIdentity = () => ({ id: directId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  host.getConversationIdentity = host.getDirectConversationIdentity;
  host.getConversationId = () => directId;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => "live-q2";
  host.getRoute = () => "/index.html";

  app.refresh("direct-chat-id-handoff");

  assert.equal(app.currentConversationId, directId);
  assert.equal(app.lastPinnedChatInference.handoffMigrated, true);
  assert.equal(app.lastPinnedChatInference.evidence, "canonical-id-handoff");
  assert.deepEqual(shellState.turns.map((turn) => [turn.text, turn.order]), [
    ["First live question", 0],
    ["Second live question", 1]
  ]);
  assert.equal(app.getTurnIndex(directId).size(), 2);
});

test("Direct Chat handoff refuses a different visible UUID even when text matches", () => {
  const { app, host, shellState } = createHarness();
  const source = new TurnIndex();
  source.mergeMany([{ id: "chat-a-q1", order: 0, text: "Same text", source: "dom", visible: true }]);
  app.turnIndexes.clear();
  app.turnIndexes.set("chat-a", source);
  app.currentConversationId = "chat-a";
  const visible = [{ id: "chat-b-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "Same text", source: "dom", visible: true }];
  host.getDirectConversationIdentity = () => ({ id: "chat-b", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  host.getConversationIdentity = host.getDirectConversationIdentity;
  host.getConversationId = () => "chat-b";
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => "chat-b-q1";
  host.getRoute = () => "/index.html";

  app.refresh("different-direct-chat");

  assert.equal(app.currentConversationId, "chat-b");
  assert.equal(app.lastPinnedChatInference.handoffMigrated, false);
  assert.deepEqual(shellState.turns, []);
  assert.equal(app.getTurnIndex("chat-b").size(), 0);
});

test("Expired pending Chat selection cannot permanently block a stable direct identity", () => {
  const { app, host, shellState } = createHarness();
  let now = 1000;
  app.window.performance = { now: () => now };
  app.pendingConversationSelectionId = "stale-chat";
  app.pendingConversationSelectionStartedAt = now;
  now = 4000;
  const visible = [{ id: "fresh-q1", order: 0, windowOrder: 0, orderTrust: "absolute", text: "Fresh question", source: "dom", visible: true }];
  host.getDirectConversationIdentity = () => ({ id: "fresh-chat", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  host.getConversationIdentity = host.getDirectConversationIdentity;
  host.getConversationId = () => "fresh-chat";
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => "fresh-q1";
  host.getRoute = () => "/index.html";

  app.refresh("expired-pending-direct");

  assert.equal(app.pendingConversationSelectionId, null);
  assert.equal(app.pendingConversationSelectionStartedAt, 0);
  assert.equal(app.lastRefreshDiagnostics.pendingResolution, "expired");
  assert.equal(app.lastRefreshDiagnostics.branch, "resolved-conversation");
  assert.equal(app.currentConversationId, "fresh-chat");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["Fresh question"]);
});

test("New Chat survives provisional direct id rekey plus Q1 UUID remount before Q2", () => {
  const { app, host, shellState } = createHarness();
  let directIdentity = { id: "chat-provisional", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  let visible = [
    { id: "q1-old-uuid", order: 0, windowOrder: 0, orderTrust: "window", text: "Pinned-looking first question", source: "dom", visible: true }
  ];
  host.getDirectConversationIdentity = () => directIdentity;
  host.getConversationIdentity = () => directIdentity;
  host.getConversationId = () => directIdentity?.id ?? null;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => visible.at(-1)?.id ?? null;
  host.getRoute = () => "/index.html";
  app.turnIndexes.clear();
  const provisionalIndex = new TurnIndex();
  provisionalIndex.mergeMany([{ id: "fallback-turn-0", order: 0, text: "Pinned-looking first question", source: "dom", visible: false }]);
  app.turnIndexes.set("chat-provisional", provisionalIndex);
  app.currentConversationId = null;

  app.refresh("new-chat-provisional-q1");
  assert.equal(app.currentConversationId, "chat-provisional");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["Pinned-looking first question"]);

  directIdentity = { id: "chat-final", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  visible = [
    { id: "q1-remounted-uuid", order: 0, windowOrder: 0, orderTrust: "window", text: "Pinned-looking first question", source: "dom", visible: true }
  ];
  app.refresh("new-chat-final-id");
  assert.equal(app.currentConversationId, "chat-final");
  assert.equal(app.lastPinnedChatInference.handoffMigrated, true);
  assert.equal(app.lastPinnedChatInference.evidence, "recent-one-turn-direct-rekey");
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["Pinned-looking first question"]);

  visible = [
    { id: "q1-remounted-uuid", order: 0, windowOrder: 0, orderTrust: "window", text: "Pinned-looking first question", source: "dom", visible: true },
    { id: "q2-live-uuid", order: 1, windowOrder: 1, orderTrust: "window", text: "Second question", source: "dom", visible: true }
  ];
  app.refresh("new-chat-q2-after-rekey");
  assert.deepEqual(shellState.turns.map((turn) => [turn.text, turn.order]), [
    ["Pinned-looking first question", 0],
    ["Second question", 1]
  ]);
  assert.equal(app.lastRefreshDiagnostics.trustedVisibleTurnsCount, 2);
  assert.equal(app.getTurnIndex("chat-final").size(), 2);
});

test("Pending sidebar selection blocks one-turn direct-id text rekey", () => {
  const { app, host } = createHarness();
  let directIdentity = { id: "chat-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  let visible = [{ id: "a-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "Same short text", source: "dom", visible: true }];
  host.getDirectConversationIdentity = () => directIdentity;
  host.getConversationIdentity = () => directIdentity;
  host.getConversationId = () => directIdentity?.id ?? null;
  host.getChatVisibleTurns = () => visible;
  host.getVisibleTurns = () => visible;
  host.getActiveTurnId = () => visible.at(-1)?.id ?? null;
  host.getRoute = () => "/index.html";
  app.turnIndexes.clear();
  app.currentConversationId = null;
  app.refresh("chat-a-q1");

  app.pendingConversationSelectionId = "chat-b";
  app.pendingConversationSelectionStartedAt = Date.now();
  directIdentity = { id: "chat-b", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  visible = [{ id: "b-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "Same short text", source: "dom", visible: true }];
  app.refresh("chat-b-selected");

  assert.equal(app.lastPinnedChatInference.handoffMigrated, false);
  assert.equal(app.currentConversationId, "chat-b");
  assert.equal(app.getTurnIndex("chat-b").size(), 0);
});

test("Chat reconciliation replaces one stale DOM UUID anchor after a remount", () => {
  const index = new TurnIndex();
  index.mergeMany([{ id: "old-q1", order: 0, text: "First", source: "dom", visible: true }]);
  const trusted = reconcileChatVisibleTurns(index, [
    { id: "new-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "First", source: "dom", visible: true },
    { id: "new-q2", order: 1, windowOrder: 1, orderTrust: "window", text: "Second", source: "dom", visible: true }
  ]);
  assert.deepEqual(trusted.map((turn) => [turn.id, turn.order]), [["new-q1", 0], ["new-q2", 1]]);
  index.setVisible(trusted);
  assert.equal(index.get("old-q1")?.id, "new-q1");
  assert.equal(index.size(), 2);
});

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

test("App routes local conversations to the isolated Work cache namespace", () => {
  const storage = new MemoryStorageAdapter();
  const { app } = createHarness({ storage });
  const localId = "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  assert.equal(app.timelineCache, app.chatTimelineCache);
  assert.equal(app.getTimelineCache(localId), app.workTimelineCache);
  assert.equal(app.getTimelineCache("chat-a"), app.chatTimelineCache);
  const index = app.getTurnIndex(localId);
  index.mergeMany([
    { id: "work-a", order: 0, text: "A", source: "dom", visible: false },
    { id: "work-b", order: 0, text: "B", source: "dom", visible: false }
  ]);
  assert.equal(app.persistTimelineCache(localId, index), true);
  const workRoot = storage.read(WORK_TIMELINE_CACHE_KEY);
  assert.equal(workRoot.conversations[localId].turns.length, 2);
  const chatRoot = storage.read("gpt-talk-enhancer.timeline-cache.v1", { conversations: {} });
  assert.equal(chatRoot.conversations[localId], undefined);
});

test("Chat order reconciliation preserves a known UUID global order across window-local remount", () => {
  const index = new TurnIndex();
  index.mergeMany([{ id: "stable-40", order: 40, text: "Question 41", source: "dom", visible: false }]);
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "stable-40", order: 0, windowOrder: 0, orderTrust: "window", text: "Question 41", source: "dom", visible: true }
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].order, 40);
});

test("Chat order reconciliation uses one trusted fallback anchor to map a UUID window without duplicate Q orders", () => {
  const index = new TurnIndex();
  index.mergeMany([{ id: "fallback-turn-40", order: 40, text: "Anchor question", source: "dom", visible: false }]);
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "stable-anchor", order: 0, windowOrder: 0, orderTrust: "window", text: "Anchor question", source: "dom", visible: true },
    { id: "stable-next", order: 1, windowOrder: 1, orderTrust: "window", text: "Next question", source: "dom", visible: true }
  ]);
  index.setVisible(normalized);
  assert.deepEqual(index.getOrdered().map((turn) => [turn.id, turn.order]), [
    ["stable-anchor", 40],
    ["stable-next", 41]
  ]);
  assert.equal(index.resolveCanonicalId("fallback-turn-40"), "stable-anchor");
});

test("Chat order reconciliation promotes stale fallback occupants instead of dropping mapped UUID turns", () => {
  const index = new TurnIndex();
  index.mergeMany([
    { id: "fallback-turn-40", order: 40, text: "Anchor question", source: "dom", visible: false },
    { id: "fallback-turn-41", order: 41, text: "stale cached text 41", source: "dom", visible: false },
    { id: "fallback-turn-42", order: 42, text: "stale cached text 42", source: "dom", visible: false }
  ]);
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "stable-anchor", order: 0, windowOrder: 0, orderTrust: "window", text: "Anchor question", source: "dom", visible: true },
    { id: "stable-41", order: 1, windowOrder: 1, orderTrust: "window", text: "Current question 41", source: "dom", visible: true },
    { id: "stable-42", order: 2, windowOrder: 2, orderTrust: "window", text: "Current question 42", source: "dom", visible: true }
  ]);
  index.setVisible(normalized);
  assert.deepEqual(index.getOrdered().map((turn) => [turn.id, turn.order]), [
    ["stable-anchor", 40],
    ["stable-41", 41],
    ["stable-42", 42]
  ]);
  assert.equal(index.resolveCanonicalId("fallback-turn-41"), "stable-41");
  assert.equal(index.resolveCanonicalId("fallback-turn-42"), "stable-42");
});

test("Chat order reconciliation reverses a two-turn window only when forward mapping would go negative", () => {
  const index = new TurnIndex();
  index.mergeMany([{ id: "known-q1", order: 0, text: "First question", source: "dom", visible: true }]);
  const diagnostics = {};
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "new-q2", order: 0, windowOrder: 0, orderTrust: "window", text: "Second question", source: "dom", visible: true },
    { id: "known-q1", order: 1, windowOrder: 1, orderTrust: "window", text: "First question", source: "dom", visible: true }
  ], diagnostics);

  assert.equal(diagnostics.forwardSharedOffset, -1);
  assert.equal(diagnostics.reverseSharedOffset, 0);
  assert.equal(diagnostics.forwardHasNegative, true);
  assert.equal(diagnostics.reverseAllNonNegative, true);
  assert.equal(diagnostics.orientation, "reverse-window");
  assert.deepEqual(normalized.map((turn) => [turn.id, turn.order]), [["new-q2", 1], ["known-q1", 0]]);
  index.setVisible(normalized);
  assert.deepEqual(index.getOrdered().map((turn) => [turn.id, turn.order]), [["known-q1", 0], ["new-q2", 1]]);
});

test("Chat order reconciliation keeps forward orientation when it already maps nonnegative orders", () => {
  const index = new TurnIndex();
  index.mergeMany([{ id: "known-q1", order: 0, text: "First question", source: "dom", visible: true }]);
  const diagnostics = {};
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "known-q1", order: 0, windowOrder: 0, orderTrust: "window", text: "First question", source: "dom", visible: true },
    { id: "new-q2", order: 1, windowOrder: 1, orderTrust: "window", text: "Second question", source: "dom", visible: true }
  ], diagnostics);

  assert.equal(diagnostics.orientation, "forward-window");
  assert.equal(diagnostics.forwardHasNegative, false);
  assert.deepEqual(normalized.map((turn) => [turn.id, turn.order]), [["known-q1", 0], ["new-q2", 1]]);
});

test("Chat reconciliation repairs a DOM-only cached order that is exactly reversed from visual order", () => {
  const index = new TurnIndex();
  index.mergeMany([
    { id: "12345678-1234-4234-8234-123456789a01", order: 1, text: "First question", source: "dom", visible: false },
    { id: "12345678-1234-4234-8234-123456789a02", order: 0, text: "Second question", source: "dom", visible: false }
  ]);
  const diagnostics = {};
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "12345678-1234-4234-8234-123456789a02", order: 0, windowOrder: 0, visualOrder: 1, orderTrust: "window", text: "Second question", source: "dom", visible: true },
    { id: "12345678-1234-4234-8234-123456789a01", order: 1, windowOrder: 1, visualOrder: 0, orderTrust: "window", text: "First question", source: "dom", visible: true }
  ], diagnostics);

  assert.deepEqual(diagnostics.cacheRepair, {
    repaired: true,
    reason: "visual-order-reversal",
    count: 2,
    minOrder: 0,
    maxOrder: 1
  });
  index.setVisible(normalized);
  assert.deepEqual(index.getOrdered().map((turn) => [turn.text, turn.order]), [
    ["First question", 0],
    ["Second question", 1]
  ]);
});

test("Chat reconciliation never visually reorders capture-backed anchors", () => {
  const index = new TurnIndex();
  index.mergeMany([
    { id: "12345678-1234-4234-8234-123456789b01", order: 1, text: "First", source: "capture", visible: false },
    { id: "12345678-1234-4234-8234-123456789b02", order: 0, text: "Second", source: "capture", visible: false }
  ]);
  const diagnostics = {};
  reconcileChatVisibleTurns(index, [
    { id: "12345678-1234-4234-8234-123456789b02", order: 0, windowOrder: 0, visualOrder: 1, orderTrust: "window", text: "Second", source: "dom", visible: true },
    { id: "12345678-1234-4234-8234-123456789b01", order: 1, windowOrder: 1, visualOrder: 0, orderTrust: "window", text: "First", source: "dom", visible: true }
  ], diagnostics);
  assert.equal(diagnostics.cacheRepair.repaired, false);
  assert.equal(diagnostics.cacheRepair.reason, "not-dom-only-known-set");
});

test("Mobile-created Chat bootstraps Q order only after true-top history exhaustion and restores scrollTop", async () => {
  const { app, host, shellState } = createHarness();
  const conversationId = "mobile-chat";
  const container = { scrollTop: -12, isConnected: true };
  let currentWindow = [
    { id: "12345678-1234-4234-8234-123456789c03", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q3", source: "dom", visible: true },
    { id: "12345678-1234-4234-8234-123456789c04", order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q4", source: "dom", visible: true }
  ];
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async ({ isCurrent, onProgress }) => {
    assert.equal(isCurrent(), true);
    container.scrollTop = -120;
    currentWindow = [
      { id: "12345678-1234-4234-8234-123456789c02", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q2", source: "dom", visible: true },
      { id: "12345678-1234-4234-8234-123456789c03", order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q3", source: "dom", visible: true }
    ];
    onProgress?.();
    container.scrollTop = -240;
    currentWindow = [
      { id: "12345678-1234-4234-8234-123456789c01", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q1", source: "dom", visible: true },
      { id: "12345678-1234-4234-8234-123456789c02", order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q2", source: "dom", visible: true }
    ];
    onProgress?.();
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  const index = app.getTurnIndex(conversationId);
  const started = app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  });
  assert.equal(started, true);
  assert.deepEqual(shellState.toasts, ["正在加载时间线…"]);
  await app.chatBootstrapHydrationPromise;

  assert.equal(container.scrollTop, -12);
  assert.deepEqual(app.getTurnIndex(conversationId).getOrdered().map((turn) => [turn.text, turn.order]), [
    ["Q1", 0],
    ["Q2", 1],
    ["Q3", 2],
    ["Q4", 3]
  ]);
  assert.equal(app.lastChatBootstrapDiagnostics.result, "earlier-boundary-exhausted");
  assert.equal(app.lastChatBootstrapDiagnostics.connectedWindows, 3);
  assert.equal(app.lastChatBootstrapDiagnostics.stitchedTurnCount, 4);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Chat true-top bootstrap fails closed when UUID windows cannot form a contiguous overlap chain", async () => {
  const { app, host } = createHarness();
  const conversationId = "mobile-gap";
  const container = { scrollTop: 0, isConnected: true };
  let currentWindow = [
    { id: "12345678-1234-4234-8234-123456789d03", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q3", source: "dom", visible: true }
  ];
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async ({ onProgress }) => {
    currentWindow = [
      { id: "12345678-1234-4234-8234-123456789d01", order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q1", source: "dom", visible: true }
    ];
    onProgress?.();
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({ conversationId, index, identity, visibleRecords: currentWindow, trustedVisible: [] }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(app.getTurnIndex(conversationId).getOrdered(), []);
  assert.equal(app.lastChatBootstrapDiagnostics.connectedWindows, 1);
  assert.equal(app.lastChatBootstrapDiagnostics.stitchedTurnCount, 0);
  assert.equal(app.lastChatBootstrapDiagnostics.completeChain, false);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, false);
});

test("Chat true-top bootstrap captures intermediate virtual windows from scroll or mutation events", async () => {
  const { app, host } = createHarness();
  const conversationId = "mobile-event-collector";
  const container = { scrollTop: -20, isConnected: true };
  const makeWindow = (a, b) => [
    { id: "12345678-1234-4234-8234-123456789" + a, order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + Number(a), source: "dom", visible: true },
    { id: "12345678-1234-4234-8234-123456789" + b, order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + Number(b), source: "dom", visible: true }
  ];
  let currentWindow = makeWindow("005", "006");
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => {
    currentWindow = makeWindow("004", "005");
    app.captureActiveChatBootstrapWindow();
    currentWindow = makeWindow("003", "004");
    app.captureActiveChatBootstrapWindow();
    currentWindow = makeWindow("002", "003");
    app.captureActiveChatBootstrapWindow();
    currentWindow = makeWindow("001", "002");
    app.captureActiveChatBootstrapWindow();
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((turn) => turn.text), ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
  assert.equal(app.lastChatBootstrapDiagnostics.windowCount, 5);
  assert.equal(app.lastChatBootstrapDiagnostics.connectedWindows, 5);
  assert.equal(app.lastChatBootstrapDiagnostics.completeChain, true);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Chat bootstrap ignores stale routed visible turns and samples the explicit Chat adapter", async () => {
  const { app, host } = createHarness();
  const conversationId = "pinned-chat:explicit-chat-source";
  const container = { scrollTop: -100, isConnected: true };
  const uuid = (n) => "12345678-1234-4234-8234-" + String(n).padStart(12, "0");
  const makeWindow = (a, b) => [
    { id: uuid(a), order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + a, source: "dom", visible: true },
    { id: uuid(b), order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + b, source: "dom", visible: true }
  ];
  const staleRouted = makeWindow(90, 91);
  let chatWindow = makeWindow(5, 6);
  const identity = { id: conversationId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true };

  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.activePinnedChatConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => staleRouted;
  host.getChatVisibleTurns = () => chatWindow;
  host.hydrateChatEarlierHistory = async () => {
    for (let n = 4; n >= 1; n -= 1) {
      chatWindow = makeWindow(n, n + 1);
      app.captureActiveChatBootstrapWindow(app.getChatBootstrapVisibleTurns());
    }
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: staleRouted,
    trustedVisible: []
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((turn) => turn.text), ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
  assert.equal(app.lastChatBootstrapDiagnostics.completeChain, true);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
  assert.ok(app.lastChatBootstrapDiagnostics.windowCount >= 5);
});

test("Chat bootstrap active sampler captures post-event windows between host callbacks", () => {
  const { app, host } = createHarness();
  const conversationId = "chat-sampler";
  const timers = [];
  const cleared = [];
  app.window = {
    setTimeout(callback, delay) {
      const token = { callback, delay, cleared: false };
      timers.push(token);
      return token;
    },
    clearTimeout(token) {
      if (token) token.cleared = true;
      cleared.push(token);
    }
  };
  app.currentConversationId = conversationId;
  app.chatBootstrapHydrationGeneration = 9;
  host.getChatVisibleTurns = () => [{ id: "chat-live-a" }, { id: "chat-live-b" }];
  const samples = [];
  app.chatBootstrapCollector = {
    conversationId,
    capture(records) {
      samples.push(Array.isArray(records) ? records.map((turn) => turn.id).join("|") : "timer-sample");
      return true;
    }
  };

  app.startChatBootstrapSampleLoop(conversationId, 9, 24);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 24);

  timers[0].callback();
  assert.deepEqual(samples, ["chat-live-a|chat-live-b"]);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 24);

  app.captureActiveChatBootstrapWindow([{ id: "stable-a" }, { id: "stable-b" }]);
  assert.deepEqual(samples, ["chat-live-a|chat-live-b", "stable-a|stable-b"]);

  app.cancelChatBootstrapHydration();
  assert.equal(app.chatBootstrapCollector, null);
  assert.ok(cleared.length >= 1);
});

test("Chat true-top bootstrap keeps transient UUID fragments when text or visual geometry is incomplete", async () => {
  const { app, host } = createHarness();
  const conversationId = "mobile-transient-fragments";
  const container = { scrollTop: -30, isConnected: true };
  const uuid = (n) => "12345678-1234-4234-8234-" + String(n).padStart(12, "0");
  const visual = (a, b) => [
    { id: uuid(a), order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + a, source: "dom", visible: true },
    { id: uuid(b), order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + b, source: "dom", visible: true }
  ];
  let currentWindow = visual(5, 6);
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => {
    currentWindow = [
      { id: uuid(5), order: 0, windowOrder: 0, visualOrder: null, orderTrust: "window", text: "", source: "dom", visible: true },
      { id: uuid(4), order: 1, windowOrder: 1, visualOrder: null, orderTrust: "window", text: "Q4", source: "dom", visible: true }
    ];
    app.captureActiveChatBootstrapWindow();

    currentWindow = [
      { id: "fallback-turn-99", order: 0, windowOrder: 0, visualOrder: null, orderTrust: "absolute", text: "", source: "dom", visible: true },
      { id: uuid(3), order: 1, windowOrder: 1, visualOrder: null, orderTrust: "window", text: "", source: "dom", visible: true },
      { id: uuid(4), order: 2, windowOrder: 2, visualOrder: null, orderTrust: "window", text: "Q4 richer", source: "dom", visible: true }
    ];
    app.captureActiveChatBootstrapWindow();

    currentWindow = [
      { id: uuid(2), order: 0, windowOrder: 0, visualOrder: null, orderTrust: "window", text: "Q2", source: "dom", visible: true },
      { id: uuid(3), order: 1, windowOrder: 1, visualOrder: null, orderTrust: "window", text: "Q3", source: "dom", visible: true }
    ];
    app.captureActiveChatBootstrapWindow();

    currentWindow = [
      { id: uuid(1), order: 0, windowOrder: 0, visualOrder: null, orderTrust: "window", text: "Q1", source: "dom", visible: true },
      { id: uuid(2), order: 1, windowOrder: 1, visualOrder: null, orderTrust: "window", text: "Q2", source: "dom", visible: true }
    ];
    app.captureActiveChatBootstrapWindow();
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((turn) => turn.text), ["Q1", "Q2", "Q3", "Q4 richer", "Q5", "Q6"]);
  assert.equal(app.lastChatBootstrapDiagnostics.completeChain, true);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
  assert.ok(app.lastChatBootstrapDiagnostics.partialWindows >= 1);
  assert.ok(app.lastChatBootstrapDiagnostics.fallbackOrderWindows >= 1);
  assert.ok(app.lastChatBootstrapDiagnostics.collectorAttempts >= 5);
});

test("Chat true-top bootstrap still requires a stable visual-order starting window", () => {
  const { app, host } = createHarness();
  const conversationId = "mobile-unstable-start";
  const container = { scrollTop: 0, isConnected: true };
  const visible = [
    { id: "12345678-1234-4234-8234-000000000001", order: 0, windowOrder: 0, visualOrder: null, orderTrust: "window", text: "Q1", source: "dom", visible: true },
    { id: "12345678-1234-4234-8234-000000000002", order: 1, windowOrder: 1, visualOrder: null, orderTrust: "window", text: "Q2", source: "dom", visible: true }
  ];
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => visible;
  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: visible,
    trustedVisible: []
  }), false);
});

test("Mobile Chat can bootstrap from windowOrder when column-reverse supplies the logical direction", async () => {
  const { app, host } = createHarness();
  const conversationId = "mobile-window-order-reverse";
  const container = { scrollTop: -30, isConnected: true };
  app.window.getComputedStyle = () => ({ flexDirection: "column-reverse", backgroundColor: "transparent" });
  const uuid = (n) => "dddddddd-dddd-4ddd-8ddd-" + String(n).padStart(12, "0");
  const reverseWindow = (later, earlier) => [
    { id: uuid(later), order: 0, windowOrder: 0, visualOrder: null, orderTrust: "window", text: "Q" + later, source: "dom", visible: true },
    { id: uuid(earlier), order: 1, windowOrder: 1, visualOrder: null, orderTrust: "window", text: "Q" + earlier, source: "dom", visible: true }
  ];
  let currentWindow = reverseWindow(4, 3);
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  app.startChatBootstrapSampleLoop = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getSurface = () => SURFACE.CONVERSATION;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.getChatVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => {
    currentWindow = reverseWindow(3, 2);
    app.captureActiveChatBootstrapWindow();
    currentWindow = reverseWindow(2, 1);
    app.captureActiveChatBootstrapWindow();
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((turn) => turn.text), ["Q1", "Q2", "Q3", "Q4"]);
  assert.equal(app.lastChatBootstrapDiagnostics.coversInitialWindow, true);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Incomplete Chat bootstrap does not lock attempted and schedules only a bounded retry", async () => {
  const { app, host } = createHarness();
  const conversationId = "mobile-incomplete-retry";
  const container = { scrollTop: -30, isConnected: true };
  const uuid = (n) => "eeeeeeee-eeee-4eee-8eee-" + String(n).padStart(12, "0");
  const makeVisual = (a, b) => [
    { id: uuid(a), order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + a, source: "dom", visible: true },
    { id: uuid(b), order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + b, source: "dom", visible: true }
  ];
  let currentWindow = makeVisual(5, 6);
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  const retryDelays = [];
  let timerId = 0;
  app.window.setTimeout = (_callback, delay) => {
    retryDelays.push(Number(delay));
    timerId += 1;
    return timerId;
  };
  app.window.clearTimeout = () => {};
  app.startChatBootstrapSampleLoop = () => {};
  app.scheduleRefresh = () => {};
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getSurface = () => SURFACE.CONVERSATION;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.getChatVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => {
    currentWindow = makeVisual(1, 2);
    app.captureActiveChatBootstrapWindow();
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };
  host.sweepLoadedChatHistory = async ({ onWindow }) => {
    onWindow?.({ turns: makeVisual(1, 2) });
    return { ok: true, started: true, reason: "sweep-complete", steps: 0, windowCount: 1 };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.equal(index.size(), 0);
  assert.equal(app.lastChatBootstrapDiagnostics.coversInitialWindow, false);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, false);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapFailureCount, 1);
  assert.equal(app.chatBootstrapAttempted.has(conversationId), false);
  assert.ok(retryDelays.includes(220));
});

test("Project-folder Chat bootstraps the full Timeline from absolute fallback orders", async () => {
  const { app, host } = createHarness();
  const conversationId = "project-chat:0123456789abcdef";
  const container = { scrollTop: -120, isConnected: true };
  const makeWindow = (start, end) => Array.from({ length: end - start + 1 }, (_, offset) => {
    const order = start + offset;
    return {
      id: "fallback-turn-" + order,
      order,
      windowOrder: offset,
      visualOrder: offset,
      orderTrust: "absolute",
      text: "Q" + (order + 1),
      source: "dom",
      visible: true
    };
  });
  let currentWindow = makeWindow(20, 24);
  const identity = { id: conversationId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.activePinnedChatConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.getChatVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => ({ ok: true, started: true, reason: "earlier-boundary-exhausted" });
  host.sweepLoadedChatHistory = async ({ onWindow }) => {
    for (let start = 0; start <= 24; start += 5) {
      currentWindow = makeWindow(start, Math.min(start + 4, 24));
      onWindow?.({ turns: currentWindow });
    }
    return { ok: true, started: true, reason: "sweep-complete", steps: 5, windowCount: 5 };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: makeWindow(20, 24)
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.equal(index.size(), 25);
  assert.deepEqual(index.getOrdered().map((turn) => [turn.text, turn.order]), Array.from({ length: 25 }, (_, order) => ["Q" + (order + 1), order]));
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapMode, "absolute");
  assert.equal(app.lastChatBootstrapDiagnostics.collectionMode, "loaded-sweep");
  assert.equal(app.lastChatBootstrapDiagnostics.sweepResult, "sweep-complete");
  assert.equal(app.lastChatBootstrapDiagnostics.sweepTurnCount, 25);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Chat true-top bootstrap visually freezes the transcript until original scroll is restored", async () => {
  const { app, host } = createHarness();
  const conversationId = "mobile-silent";
  const styleState = new Map();
  const style = {
    setProperty(name, value, priority = "") { styleState.set(name, { value, priority }); },
    removeProperty(name) { styleState.delete(name); },
    getPropertyValue(name) { return styleState.get(name)?.value ?? ""; },
    getPropertyPriority(name) { return styleState.get(name)?.priority ?? ""; }
  };
  let overlayMounted = false;
  let overlayRemoved = false;
  const cloneStyleState = new Map();
  const clone = {
    style: {
      setProperty(name, value, priority = "") { cloneStyleState.set(name, { value, priority }); }
    },
    scrollTop: 0,
    inert: false,
    setAttribute() {},
    removeAttribute() {},
    querySelectorAll: () => [],
    remove() { overlayRemoved = true; overlayMounted = false; }
  };
  const container = {
    scrollTop: -42,
    isConnected: true,
    style,
    cloneNode: () => clone,
    getBoundingClientRect: () => ({ left: 100, top: 80, width: 720, height: 640 }),
    parentElement: null
  };
  app.document = {
    body: {
      appendChild(node) {
        assert.equal(node, clone);
        overlayMounted = true;
      }
    }
  };
  app.window = {
    getComputedStyle: () => ({ backgroundColor: "rgb(20, 20, 20)" }),
    requestAnimationFrame(callback) { callback(); return 1; },
    setTimeout,
    clearTimeout
  };

  const uuid = (n) => "cccccccc-cccc-4ccc-8ccc-" + String(n).padStart(12, "0");
  const makeWindow = (a, b) => [
    { id: uuid(a), order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + a, source: "dom", visible: true },
    { id: uuid(b), order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + b, source: "dom", visible: true }
  ];
  let currentWindow = makeWindow(3, 4);
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  app.turnIndexes.clear();
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.getChatVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => {
    assert.equal(styleState.get("visibility")?.value, "hidden");
    assert.equal(overlayMounted, true);
    container.scrollTop = -900;
    currentWindow = makeWindow(1, 2);
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };
  host.sweepLoadedChatHistory = async ({ onWindow }) => {
    onWindow?.({ turns: makeWindow(1, 2) });
    onWindow?.({ turns: makeWindow(2, 3) });
    onWindow?.({ turns: makeWindow(3, 4) });
    container.scrollTop = 0;
    return { ok: true, started: true, reason: "sweep-complete", steps: 3, windowCount: 3 };
  };

  const index = app.getTurnIndex(conversationId);
  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  }), true);
  assert.equal(overlayMounted, true);
  assert.equal(styleState.get("visibility")?.value, "hidden");
  await app.chatBootstrapHydrationPromise;

  assert.equal(container.scrollTop, -42);
  assert.equal(styleState.has("visibility"), false);
  assert.equal(overlayRemoved, true);
  assert.equal(overlayMounted, false);
  assert.equal(app.lastChatBootstrapDiagnostics.visualFreezeApplied, true);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Pinned Chat bootstrap uses a deterministic loaded sweep when event sampling cannot form a chain", async () => {
  const { app, host } = createHarness();
  const conversationId = "pinned-chat:loaded-sweep";
  const container = { scrollTop: 0, isConnected: true };
  const oldUuid = (n) => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
  const newUuid = (n) => "bbbbbbbb-bbbb-4bbb-8bbb-" + String(n).padStart(12, "0");
  const makeWindow = (a, b) => [
    { id: newUuid(a), order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + a, source: "dom", visible: true },
    { id: newUuid(b), order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + b, source: "dom", visible: true }
  ];
  let currentWindow = makeWindow(9, 10);
  const identity = { id: conversationId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true };
  const index = new TurnIndex();
  index.mergeMany(Array.from({ length: 7 }, (_, offset) => ({
    id: oldUuid(offset + 1),
    order: offset,
    text: "old Q" + (offset + 1),
    source: "dom",
    visible: false
  })));

  app.turnIndexes.clear();
  app.turnIndexes.set(conversationId, index);
  app.currentConversationId = conversationId;
  app.activePinnedChatConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.getChatVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => ({ ok: true, started: true, reason: "earlier-boundary-exhausted" });
  host.sweepLoadedChatHistory = async ({ onWindow }) => {
    for (let n = 1; n < 10; n += 1) onWindow?.({ turns: makeWindow(n, n + 1) });
    return { ok: true, started: true, reason: "sweep-complete", steps: 9, windowCount: 9 };
  };

  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((turn) => [turn.text, turn.order]), Array.from({ length: 10 }, (_, offset) => ["Q" + (offset + 1), offset]));
  assert.equal(app.lastChatBootstrapDiagnostics.collectionMode, "loaded-sweep");
  assert.equal(app.lastChatBootstrapDiagnostics.sweepResult, "sweep-complete");
  assert.equal(app.lastChatBootstrapDiagnostics.sweepWindowCount, 9);
  assert.equal(app.lastChatBootstrapDiagnostics.sweepTurnCount, 10);
  assert.equal(app.lastChatBootstrapDiagnostics.repairedIncompleteCache, true);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Direct mobile Chat rebuilds a healthy but stale DOM cache when the live UUID window hits occupied orders", async () => {
  const { app, host } = createHarness();
  const conversationId = "12345678-1234-4234-8234-888888888888";
  const container = { scrollTop: -120, isConnected: true };
  const uuid = (n) => "bbbbbbbb-bbbb-4bbb-8bbb-" + String(n).padStart(12, "0");
  const oldId = (n) => "cccccccc-cccc-4ccc-8ccc-" + String(n).padStart(12, "0");
  const turn = (id, text, windowOrder) => ({
    id,
    order: windowOrder,
    windowOrder,
    visualOrder: windowOrder,
    orderTrust: "window",
    text,
    source: "dom",
    visible: true
  });
  const index = new TurnIndex();
  index.mergeMany([
    { id: oldId(1), order: 0, text: "stale Q1", source: "dom", visible: false },
    { id: oldId(2), order: 1, text: "stale Q2", source: "dom", visible: false },
    { id: oldId(3), order: 2, text: "stale Q3", source: "dom", visible: false },
    { id: uuid(4), order: 3, text: "Q4", source: "dom", visible: false }
  ]);
  let currentWindow = [
    turn(uuid(2), "Q2", 0),
    turn(uuid(3), "Q3", 1),
    turn(uuid(4), "Q4", 2)
  ];
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  const reconcileDiagnostics = {};
  const trustedVisible = reconcileChatVisibleTurns(index, currentWindow, reconcileDiagnostics);
  assert.equal(analyzeChatIndexOrderHealth(index.getOrdered()).corrupt, false);
  assert.equal(trustedVisible.length, 1);
  assert.equal(reconcileDiagnostics.turns.filter((entry) => entry.reason === "occupied-order").length, 2);

  app.turnIndexes.clear();
  app.turnIndexes.set(conversationId, index);
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  app.startChatBootstrapSampleLoop = () => {};
  app.stopChatBootstrapSampleLoop = () => {};
  app.chatBootstrapAttempted.add(conversationId);
  host.getSurface = () => SURFACE.CONVERSATION;
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.getChatVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => ({ ok: true, started: true, reason: "earlier-boundary-exhausted" });
  host.sweepLoadedChatHistory = async ({ onWindow }) => {
    const windows = [
      [turn(uuid(1), "Q1", 0), turn(uuid(2), "Q2", 1)],
      [turn(uuid(2), "Q2", 0), turn(uuid(3), "Q3", 1)],
      [turn(uuid(3), "Q3", 0), turn(uuid(4), "Q4", 1)]
    ];
    for (const window of windows) {
      currentWindow = window;
      onWindow?.({ turns: window });
    }
    return { ok: true, started: true, reason: "sweep-complete", steps: 3, windowCount: 3 };
  };

  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible,
    reconcileDiagnostics
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((item) => [item.text, item.order]), [
    ["Q1", 0], ["Q2", 1], ["Q3", 2], ["Q4", 3]
  ]);
  assert.equal(app.lastChatBootstrapDiagnostics.repairReason, "conflicted-dom-orders");
  assert.equal(app.lastChatBootstrapDiagnostics.repairedConflictedDomIndex, true);
  assert.equal(app.lastChatBootstrapDiagnostics.repairConflictCount, 2);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Direct mobile Chat bootstrap replaces a corrupt pure-DOM index with one contiguous full sweep", async () => {
  const { app, host } = createHarness();
  const conversationId = "12345678-1234-4234-8234-999999999999";
  const container = { scrollTop: -120, isConnected: true };
  const uuid = (n) => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
  const makeWindow = (a, b) => [
    { id: uuid(a), order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + a, source: "dom", visible: true },
    { id: uuid(b), order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + b, source: "dom", visible: true }
  ];
  const index = new TurnIndex();
  index.mergeMany([
    { id: uuid(1), order: 0, text: "Q1", source: "dom", visible: false },
    { id: uuid(2), order: 1, text: "Q2", source: "dom", visible: false },
    { id: uuid(3), order: 1, text: "Q3", source: "dom", visible: false },
    { id: uuid(4), order: 3, text: "Q4", source: "dom", visible: false }
  ]);
  let currentWindow = makeWindow(3, 4);
  const identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };

  app.turnIndexes.clear();
  app.turnIndexes.set(conversationId, index);
  app.currentConversationId = conversationId;
  app.scheduleRefresh = () => {};
  app.startChatBootstrapSampleLoop = () => {};
  app.stopChatBootstrapSampleLoop = () => {};
  app.chatBootstrapAttempted.add(conversationId);
  host.getSurface = () => SURFACE.CONVERSATION;
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.getChatVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => ({ ok: true, started: true, reason: "earlier-boundary-exhausted" });
  host.sweepLoadedChatHistory = async ({ onWindow }) => {
    for (let n = 1; n < 4; n += 1) {
      currentWindow = makeWindow(n, n + 1);
      onWindow?.({ turns: currentWindow });
    }
    return { ok: true, started: true, reason: "sweep-complete", steps: 3, windowCount: 3 };
  };

  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: [currentWindow[1]]
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((turn) => [turn.text, turn.order]), [
    ["Q1", 0], ["Q2", 1], ["Q3", 2], ["Q4", 3]
  ]);
  assert.equal(analyzeChatIndexOrderHealth(index.getOrdered()).corrupt, false);
  assert.equal(app.lastChatBootstrapDiagnostics.repairReason, "corrupt-dom-orders");
  assert.equal(app.lastChatBootstrapDiagnostics.repairedCorruptDomIndex, true);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Pinned Chat bootstrap replaces an old disconnected Q1-Q7 DOM cache with the complete chain", async () => {
  const { app, host } = createHarness();
  const conversationId = "pinned-chat:0123456789abcdef";
  const container = { scrollTop: -200, isConnected: true };
  const uuid = (n) => "12345678-1234-4234-8234-" + String(n).padStart(12, "0");
  const makeWindow = (a, b) => [
    { id: uuid(a), order: 0, windowOrder: 0, visualOrder: 0, orderTrust: "window", text: "Q" + a, source: "dom", visible: true },
    { id: uuid(b), order: 1, windowOrder: 1, visualOrder: 1, orderTrust: "window", text: "Q" + b, source: "dom", visible: true }
  ];
  let currentWindow = makeWindow(9, 10);
  const identity = { id: conversationId, source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true };
  const index = new TurnIndex();
  index.mergeMany(Array.from({ length: 7 }, (_, offset) => ({
    id: uuid(offset + 1),
    order: offset,
    text: "Q" + (offset + 1),
    source: "dom",
    visible: false
  })));
  app.turnIndexes.clear();
  app.turnIndexes.set(conversationId, index);
  app.currentConversationId = conversationId;
  app.activePinnedChatConversationId = conversationId;
  app.scheduleRefresh = () => {};
  host.getConversationId = () => conversationId;
  host.getConversationIdentity = () => identity;
  host.getScrollContainer = () => container;
  host.getVisibleTurns = () => currentWindow;
  host.hydrateChatEarlierHistory = async () => {
    for (let n = 8; n >= 1; n -= 1) {
      currentWindow = makeWindow(n, n + 1);
      app.captureActiveChatBootstrapWindow();
    }
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  assert.equal(app.maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords: currentWindow,
    trustedVisible: []
  }), true);
  await app.chatBootstrapHydrationPromise;

  assert.deepEqual(index.getOrdered().map((turn) => [turn.text, turn.order]), Array.from({ length: 10 }, (_, offset) => ["Q" + (offset + 1), offset]));
  assert.equal(app.lastChatBootstrapDiagnostics.completeChain, true);
  assert.equal(app.lastChatBootstrapDiagnostics.repairedIncompleteCache, true);
  assert.equal(app.lastChatBootstrapDiagnostics.stitchedTurnCount, 10);
  assert.equal(app.lastChatBootstrapDiagnostics.bootstrapped, true);
});

test("Chat order reconciliation refuses a second realtime UUID at an occupied global order", () => {
  const index = new TurnIndex();
  index.mergeMany([
    { id: "fallback-turn-40", order: 40, text: "Anchor question", source: "dom", visible: false },
    { id: "stable-existing", order: 41, text: "Existing realtime question", source: "dom", visible: false }
  ]);
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "stable-anchor", order: 0, windowOrder: 0, orderTrust: "window", text: "Anchor question", source: "dom", visible: true },
    { id: "stable-conflict", order: 1, windowOrder: 1, orderTrust: "window", text: "Different realtime question", source: "dom", visible: true }
  ]);
  index.setVisible(normalized);
  assert.equal(index.get("stable-existing")?.order, 41);
  assert.equal(index.has("stable-conflict"), false);
  assert.equal(index.getOrdered().filter((turn) => turn.order === 41).length, 1);
});
test("Chat order reconciliation refuses an unanchored UUID-only window", () => {
  const index = new TurnIndex();
  const normalized = reconcileChatVisibleTurns(index, [
    { id: "uuid-a", order: 0, windowOrder: 0, orderTrust: "window", text: "A", source: "dom", visible: true },
    { id: "uuid-b", order: 1, windowOrder: 1, orderTrust: "window", text: "B", source: "dom", visible: true }
  ]);
  assert.deepEqual(normalized, []);
});

test("Chat navigation refuses to fight a repairable corrupt DOM index and schedules repair first", async () => {
  const { app, host, shellState } = createHarness();
  const conversationId = "A";
  const corrupt = new TurnIndex();
  corrupt.mergeMany([
    { id: "repair-q1", order: 0, text: "Q1", source: "dom", visible: false },
    { id: "repair-q2", order: 1, text: "Q2", source: "dom", visible: false },
    { id: "repair-q3", order: 1, text: "Q3", source: "dom", visible: false }
  ]);
  app.turnIndexes.set(conversationId, corrupt);
  app.currentConversationId = conversationId;
  let refreshReason = null;
  let navigateCalls = 0;
  app.scheduleRefresh = (reason) => { refreshReason = reason; };
  host.getConversationIdentity = () => ({ id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  host.getConversationId = () => conversationId;
  host.navigateToTurn = async () => { navigateCalls += 1; return { ok: true, verified: true }; };

  const result = await app.navigate("repair-q2");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "chat-index-repairing");
  assert.equal(navigateCalls, 0);
  assert.equal(refreshReason, "chat-index-repair-before-navigation");
  assert.equal(shellState.toasts.at(-1), "正在修复时间线…");
  assert.equal(app.navigationUx.state, "idle");
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

test("transient conversation identity gap hides stale Questions while preserving the current session cache", () => {
  const { app, host, shellState, setConversationId, setSurface } = createHarness();
  const previousIndexSize = app.getTurnIndex("A").size();
  setConversationId(null);
  setSurface(SURFACE.CONVERSATION);
  app.refresh("conversation-identity-transient");
  assert.equal(host.getConversationId(), null);
  assert.equal(app.currentConversationId, "A");
  assert.deepEqual(shellState.turns, []);
  assert.equal(app.getTurnIndex("A").size(), previousIndexSize);
});

test("owned Chat Load All keeps the Timeline visible through a transient identity gap", async () => {
  const { app, host, shellState } = createHarness();
  const conversationId = "chat-owned-gap";
  let identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  const index = new TurnIndex();
  index.mergeMany([
    { id: "owned-q1", order: 0, text: "Q1", source: "dom", visible: false },
    { id: "owned-q2", order: 1, text: "Q2", source: "dom", visible: false },
    { id: "owned-q3", order: 2, text: "Q3", source: "dom", visible: false }
  ]);
  app.turnIndexes.set(conversationId, index);
  app.currentConversationId = conversationId;
  app.shell.updateTimeline(index.getOrdered(), null);
  app.shell.getStatus = () => ({
    timelineMounted: true,
    promptMounted: true,
    questionPanelOpen: true,
    promptPanelOpen: false,
    questionRenderCount: 1
  });
  host.getConversationIdentity = () => identity;
  host.getDirectConversationIdentity = () => identity;
  host.getConversationId = () => identity?.id ?? null;
  host.getChatVisibleTurns = () => [];
  host.getVisibleTurns = () => [];
  host.getSurface = () => SURFACE.CONVERSATION;
  host.hydrateChatEarlierHistory = async ({ isCurrent }) => {
    await Promise.resolve();
    identity = null;
    assert.equal(isCurrent(), true);
    app.refresh("chat-load-all-owned-identity-gap");
    assert.deepEqual(shellState.turns.map((turn) => turn.text), ["Q1", "Q2", "Q3"]);
    assert.equal(app.lastRefreshDiagnostics.branch, "identity-transient-preserve-chat-operation");
    identity = { id: conversationId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };

  assert.equal(app.loadAllEarlierHistory(), true);
  await app.chatEarlierHydrationPromise;
  assert.deepEqual(shellState.turns.map((turn) => turn.text), ["Q1", "Q2", "Q3"]);
});

test("conversation surface with no host or internal identity clears stale Questions UI", () => {
  const { app, shellState, setConversationId, setSurface } = createHarness();
  shellState.turns = [{ id: "stale-q", order: 87, text: "stale" }];
  app.currentConversationId = null;
  setConversationId(null);
  setSurface(SURFACE.CONVERSATION);
  app.refresh("conversation-without-any-identity");
  assert.equal(app.currentConversationId, null);
  assert.deepEqual(shellState.turns, []);
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


test("Restored v0.5.2 saves current Work scroll before switching threads", () => {
  const { app, host } = createHarness();
  let saved = 0;
  host.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", source: "sidebar-local", host: "local", kind: "local", stable: true });
  host.persistLocalScrollPosition = () => { saved += 1; return true; };
  app.invalidateNavigation = () => {};
  app.scheduleRefresh = () => {};
  app.clearConversationSelectTimer = () => {};
  app.scheduleConversationSelectRetry = () => {};
  const row = { getAttribute(name) { return name === "data-app-action-sidebar-thread-id" ? "local:01a07940-61ad-7650-913c-34d31b4da543" : null; } };
  app.handleConversationSelect({ target: { closest: () => row } });
  assert.equal(saved, 1);
});

test("Restored v0.5.2 notifies Codex++ before isolated Work navigation", async () => {
  const { app, host } = createHarness();
  host.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", source: "sidebar-local", host: "local", kind: "local", stable: true });
  app.localNavigationSettleUntil = 0;
  let intentCalls = 0;
  let navigateCalls = 0;
  host.notifyNavigationIntent = () => { intentCalls += 1; return true; };
  host.navigateToTurn = async (turnId) => { navigateCalls += 1; return { ok: true, target: turnId, verified: true }; };
  const result = await app.navigate("q4");
  assert.equal(result.ok, true);
  assert.equal(intentCalls, 1);
  assert.equal(navigateCalls, 1);
});


test("Work earliest Question loads one batch while the header Load All action hydrates to the true top", async () => {
  const { app, host, setConversationId } = createHarness();
  const localId = "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  setConversationId(localId);
  host.getConversationIdentity = () => ({ id: localId, source: "sidebar-local", host: "local", kind: "local", stable: true });
  app.shell.getStatus = () => ({ timelineMounted: true, promptMounted: true, questionPanelOpen: true, promptPanelOpen: false, questionRenderCount: 1 });
  const calls = [];
  host.hydrateWorkEarlierHistory = async ({ isCurrent, stopAfterBatch }) => {
    calls.push(Boolean(stopAfterBatch));
    assert.equal(isCurrent(), true);
    return { ok: true, started: true, reason: stopAfterBatch ? "earlier-batch-loaded" : "earlier-boundary-exhausted" };
  };

  app.refresh("questions-open-without-load-action");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, []);

  const localEarliest = app.getTurnIndex(localId).getOrdered()[0];
  assert.ok(localEarliest);
  const result = await app.navigate(localEarliest.id);
  assert.equal(result.ok, true);
  await app.workEarlierHydrationPromise;
  assert.deepEqual(calls, [true]);

  assert.equal(app.loadAllEarlierHistory(), true);
  await app.workEarlierHydrationPromise;
  assert.deepEqual(calls, [true, false]);
});

test("Chat header Load All action uses the isolated Chat history hydrator", async () => {
  const { app, host, setConversationId } = createHarness();
  setConversationId("chat-a");
  host.getConversationIdentity = () => ({ id: "chat-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  app.shell.getStatus = () => ({ timelineMounted: true, promptMounted: true, questionPanelOpen: true, promptPanelOpen: false, questionRenderCount: 1 });
  let chatCalls = 0;
  let workCalls = 0;
  host.hydrateChatEarlierHistory = async ({ isCurrent }) => {
    chatCalls += 1;
    assert.equal(isCurrent(), true);
    return { ok: true, started: true, reason: "earlier-boundary-exhausted" };
  };
  host.hydrateWorkEarlierHistory = async () => { workCalls += 1; return { ok: true }; };
  app.refresh("chat-load-all");
  assert.equal(app.loadAllEarlierHistory(), true);
  await app.chatEarlierHydrationPromise;
  assert.equal(chatCalls, 1);
  assert.equal(workCalls, 0);
});


test("Work thread selection clears stale Questions until the new stable identity arrives", () => {
  const { app, host, shellState, setConversationId } = createHarness();
  const oldId = "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  const newId = "local:01a07940-61ad-7650-913c-34d31b4da543";
  setConversationId(oldId);
  host.getConversationIdentity = () => ({ id: oldId, source: "sidebar-local", host: "local", kind: "local", stable: true });
  app.refresh("old-work");
  assert.ok(shellState.turns.length > 0);
  app.scheduleConversationSelectRetry = () => {};
  const row = { getAttribute(name) { return name === "data-app-action-sidebar-thread-id" ? newId : null; } };
  app.handleConversationSelect({ target: { closest: () => row } });
  assert.equal(app.pendingConversationSelectionId, newId);
  assert.equal(shellState.turns.length, 0);
  app.refresh("still-old-during-transition");
  assert.equal(shellState.turns.length, 0);
});


test("Pinned Chat probe captures real click structure without exposing opaque identifiers", () => {
  const { app, host } = createHarness();
  host.getConversationIdentity = () => ({ id: "chat-old-private-id", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  const anchor = {
    tagName: "A",
    parentElement: null,
    getAttributeNames: () => ["href", "data-conversation-id", "data-pinned"],
    getAttribute(name) {
      if (name === "href") return "/c/12345678-1234-4234-8234-123456789abc";
      if (name === "data-conversation-id") return "12345678-1234-4234-8234-123456789abc";
      if (name === "data-pinned") return "true";
      return null;
    },
    closest(selector) { return selector === "a[href]" ? this : null; }
  };
  const target = {
    tagName: "SPAN",
    parentElement: anchor,
    getAttributeNames: () => ["data-testid"],
    getAttribute(name) { return name === "data-testid" ? "sidebar-item-label" : null; },
    closest(selector) {
      if (selector === "a[href]") return anchor;
      return null;
    }
  };
  assert.deepEqual(app.armPinnedChatProbe(), { armed: true });
  app.capturePinnedChatProbe({ type: "pointerdown", target, composedPath: () => [target, anchor] });
  const probe = app.pinnedChatProbe;
  assert.equal(probe.captured, true);
  assert.equal(probe.eventType, "pointerdown");
  assert.equal(probe.pathSource, "composedPath");
  assert.equal(probe.selectorMatches.knownChatKey, false);
  assert.equal(probe.selectorMatches.anchor, true);
  assert.equal(probe.ancestry[1].hrefShape, "/c/<id>");
  assert.match(probe.ancestry[1].data["data-conversation-id"], /^<redacted:/);
  assert.equal(probe.ancestry[1].data["data-pinned"], "true");
  assert.equal(JSON.stringify(probe).includes("12345678-1234-4234-8234-123456789abc"), false);
  app.stopPinnedChatProbe();
});

test("Pinned Chat probe observes an eventless identity or route transition", () => {
  const { app, host } = createHarness();
  let identity = { id: "chat-old-private-id", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  let route = "/c/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  host.getConversationIdentity = () => identity;
  host.getRoute = () => route;
  assert.deepEqual(app.armPinnedChatProbe(), { armed: true });
  assert.equal(app.pinnedChatProbe.eventCaptured, false);
  identity = { id: "chat-new-private-id", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
  route = "/c/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(app.samplePinnedChatProbe(80), true);
  const probe = app.pinnedChatProbe;
  assert.equal(probe.captured, true);
  assert.equal(probe.eventCaptured, false);
  assert.equal(probe.transitionObserved, true);
  assert.equal(probe.identityTimeline.at(-1).idState, "changed");
  assert.equal(probe.identityTimeline.at(-1).routeChanged, true);
  assert.equal(JSON.stringify(probe).includes("chat-new-private-id"), false);
  assert.equal(JSON.stringify(probe).includes("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), false);
  app.stopPinnedChatProbe();
});


test("Pinned Chat state snapshot compares host, selected row, visible turns and cache without exposing ids", () => {
  const { app, host } = createHarness();
  const privateId = "12345678-1234-4234-8234-123456789abc";
  app.currentConversationId = privateId;
  host.getConversationId = () => privateId;
  host.getConversationIdentity = () => ({ id: privateId, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  host.getRoute = () => `/c/${privateId}`;
  host.getVisibleTurns = () => [{ id: "fallback-turn-4", order: 4 }, { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", order: 5 }];
  app.turnIndexes.set(privateId, { getOrdered: () => [{ id: "private-turn-key", order: 0 }, { id: "fallback-turn-5", order: 5 }] });
  app.cacheHydrationCounts.set(privateId, 2);
  app.document.querySelectorAll = (selector) => {
    if (selector === "[data-sidebar-chatgpt-conversation-key]") return [{
      getAttribute(name) {
        if (name === "aria-current") return "page";
        if (name === "data-sidebar-chatgpt-conversation-key") return `chatgpt:conversation:${privateId}`;
        return null;
      },
      querySelector() { return null; }
    }];
    if (selector === "[data-conversation-id], [data-thread-id]") return [];
    return [];
  };
  const snapshot = app.capturePinnedChatState();
  assert.equal(snapshot.hostIdentity.present, true);
  assert.equal(snapshot.internalConversation.relationToHost, "matches-host");
  assert.equal(snapshot.selectedChatRows.selected, 1);
  assert.equal(snapshot.selectedChatRows.relationToHost, "matches-host");
  assert.deepEqual(snapshot.visibleTurns, { count: 2, orderedCount: 2, min: 4, max: 5, idModes: { fallback: 1, uuidLike: 1, other: 0 } });
  assert.equal(snapshot.timelineIndex.cacheRestoredTurns, 2);
  assert.ok(snapshot.pinnedCandidateDiagnostics.candidateCount >= 1);
  assert.ok(snapshot.pinnedCandidateDiagnostics.candidates.some((candidate) => candidate.source === "memory"));
  assert.ok(snapshot.pinnedCandidateDiagnostics.candidates.every((candidate) => Number.isFinite(candidate.idOverlap)));
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(privateId), false);
  assert.equal(serialized.includes("private-turn-key"), false);
});

test("Capture diagnostics reveal when a new payload replaces the previous captured Question", () => {
  const { app } = createHarness();
  app.currentConversationId = "A";
  app.handleCapture({
    conversationId: "A",
    turns: [{ id: "capture-q1", order: 0, text: "First", source: "capture", visible: false }],
    payload: { mapping: { a: {}, b: {} }, current_node: "b" }
  });
  app.handleCapture({
    conversationId: "A",
    turns: [{ id: "capture-q2", order: 0, text: "Second", source: "capture", visible: false }],
    payload: { mapping: { c: {} }, current_node: "c" }
  });
  const diagnostic = app.status().captureDiagnostics.at(-1);
  assert.equal(diagnostic.incomingTurnCount, 1);
  assert.equal(diagnostic.incomingOrderMin, 0);
  assert.equal(diagnostic.incomingOrderMax, 0);
  assert.equal(diagnostic.previousCaptureCount, 1);
  assert.equal(diagnostic.retainedCaptureCount, 0);
  assert.equal(diagnostic.removedCaptureCount, 1);
  assert.equal(diagnostic.addedCaptureCount, 1);
  assert.equal(diagnostic.afterIndexCount, diagnostic.previousIndexCount);
  const serialized = JSON.stringify(diagnostic);
  assert.equal(serialized.includes("capture-q1"), false);
  assert.equal(serialized.includes("capture-q2"), false);
  assert.equal(serialized.includes("First"), false);
  assert.equal(serialized.includes("Second"), false);
});

test("Chat scroll diagnostics record real transcript movement and active Question order", () => {
  const { app, host } = createHarness();
  const container = { scrollTop: 500, scrollHeight: 4000, clientHeight: 800, style: { flexDirection: "column" } };
  let activeId = "q5";
  host.getConversationIdentity = () => ({ id: "A", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  host.getConversationId = () => "A";
  host.getScrollContainer = () => container;
  host.getChatVisibleTurns = () => [
    { id: "q4", order: 3, orderTrust: "absolute", text: "Question 4", source: "dom", visible: true },
    { id: "q5", order: 4, orderTrust: "absolute", text: "Question 5", source: "dom", visible: true }
  ];
  host.getActiveTurnId = () => activeId;
  app.currentConversationId = "A";
  const index = app.getTurnIndex("A");
  index.mergeMany([
    { id: "q4", order: 3, text: "Question 4", source: "dom", visible: true },
    { id: "q5", order: 4, text: "Question 5", source: "dom", visible: true }
  ]);

  assert.equal(app.recordChatScrollDiagnostic("before-switch", { force: true }), true);
  container.scrollTop = 360;
  activeId = "q4";
  assert.equal(app.recordChatScrollDiagnostic("after-restore", { force: true }), true);

  const diagnostics = app.status().chatScrollDiagnostics;
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].activeOrder, 4);
  assert.equal(diagnostics[0].scrollTop, 500);
  assert.equal(diagnostics[1].activeOrder, 3);
  assert.equal(diagnostics[1].scrollTop, 360);
  assert.equal(diagnostics[0].conversationOrdinal, diagnostics[1].conversationOrdinal);
  assert.equal(JSON.stringify(diagnostics).includes('"A"'), false);
});

test("Pinned Chat sidebar structure diagnostics expose shapes without opaque values", () => {
  const { app } = createHarness();
  const privateId = "12345678-1234-4234-8234-123456789abc";
  const link = {
    tagName: "A",
    getAttributeNames: () => ["href", "data-conversation-key", "aria-current"],
    getAttribute(name) {
      if (name === "href") return "/c/" + privateId;
      if (name === "data-conversation-key") return privateId;
      if (name === "aria-current") return "page";
      return null;
    },
    querySelectorAll: () => []
  };
  const nav = {
    tagName: "NAV",
    getAttributeNames: () => ["data-testid"],
    getAttribute(name) { return name === "data-testid" ? "sidebar" : null; },
    querySelectorAll: () => [link]
  };
  app.document.querySelectorAll = (selector) => {
    if (selector === "aside, nav, [role='navigation']") return [nav];
    if (selector === "[data-sidebar-chatgpt-conversation-key]") return [];
    if (selector === "[data-conversation-id], [data-thread-id]") return [];
    return [];
  };
  const snapshot = app.capturePinnedChatState();
  assert.equal(snapshot.sidebarStructure.rootCount, 1);
  assert.equal(snapshot.sidebarStructure.scannedNodeCount, 2);
  assert.ok(snapshot.sidebarStructure.dataAttributeNames.some((item) => item.name === "data-conversation-key"));
  assert.ok(snapshot.sidebarStructure.hrefShapes.some((item) => item.shape === "/c/<id>"));
  assert.equal(JSON.stringify(snapshot.sidebarStructure).includes(privateId), false);
});

test("Pinned relation diagnostics expose parent-child shapes without pinned or conversation values", () => {
  const { app } = createHarness();
  const privateId = "12345678-1234-4234-8234-123456789abc";
  const privateDropKey = "private-pinned-drop-key";
  const nav = {
    tagName: "NAV",
    parentElement: null,
    getAttributeNames: () => ["data-testid"],
    getAttribute(name) { return name === "data-testid" ? "sidebar" : null; },
    querySelectorAll(selector) { return selector === "*" ? [chatRow, pinned] : []; }
  };
  const chatRow = {
    tagName: "DIV",
    parentElement: nav,
    getAttributeNames: () => ["data-sidebar-chatgpt-conversation-key"],
    getAttribute(name) { return name === "data-sidebar-chatgpt-conversation-key" ? privateId : null; },
    querySelectorAll() { return []; }
  };
  const pinned = {
    tagName: "DIV",
    parentElement: chatRow,
    getAttributeNames: () => ["data-pinned-content-tab-drop-key", "role"],
    getAttribute(name) {
      if (name === "data-pinned-content-tab-drop-key") return privateDropKey;
      if (name === "role") return "listitem";
      return null;
    },
    querySelectorAll() { return []; }
  };
  app.document.querySelectorAll = (selector) => {
    if (selector === "aside, nav, [role='navigation']") return [nav];
    if (selector === "[data-pinned-content-tab-drop-key]") return [pinned];
    if (selector === "[data-sidebar-chatgpt-conversation-key]") return [];
    if (selector === "[data-conversation-id], [data-thread-id]") return [];
    return [];
  };

  const snapshot = app.capturePinnedChatState();
  const relation = snapshot.sidebarStructure.pinnedRelations[0];
  assert.equal(relation.chatAncestorDepth, 1);
  assert.equal(relation.appThreadAncestorDepth, null);
  assert.ok(relation.parentShapes[0].dataNames.includes("data-pinned-content-tab-drop-key"));
  assert.ok(relation.parentShapes[1].dataNames.includes("data-sidebar-chatgpt-conversation-key"));
  const serialized = JSON.stringify(relation);
  assert.equal(serialized.includes(privateId), false);
  assert.equal(serialized.includes(privateDropKey), false);
});
