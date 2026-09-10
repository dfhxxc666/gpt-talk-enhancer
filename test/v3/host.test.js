import test from "node:test";
import assert from "node:assert/strict";
import { SURFACE } from "../../src/v3/host/host-interface.js";
import { ConversationCapture, matchConversationRequest, parseConversationPayload } from "../../src/v3/host/codex-desktop/conversation-capture.js";
import { TurnAdapter, TURN_ID_PRIORITY } from "../../src/v3/host/codex-desktop/turn-adapter.js";
import { ConversationAdapter, isStableLocalThreadIdentity, parseSidebarConversationKey } from "../../src/v3/host/codex-desktop/conversation-adapter.js";
import { CodexDesktopHost, computeTailActiveTurnId } from "../../src/v3/host/codex-desktop/codex-host.js";
import { SurfaceDetector } from "../../src/v3/host/codex-desktop/surface-detector.js";
import { OverlayDetector } from "../../src/v3/host/codex-desktop/overlay-detector.js";
import { ComposerAdapter } from "../../src/v3/host/codex-desktop/composer-adapter.js";
import { NavigationAdapter, computeActiveTurnId, chooseHydrationDirection, hydrationStepSize, hydrationJumpScale, chatFarCoalescedJump, workWheelStepSize, predictChatFastLogicalPosition, chatFastSnapshotStable, planChatPredictiveFastPath, rectInActivationZone, hasTurnWindowProgress, turnWindowDistance, createHydrationSnapshot, hasHydrationProgress } from "../../src/v3/host/codex-desktop/navigation-adapter.js";
import { evaluateHostContract, classifyTurnIdMode, HOST_CONTRACT_REVISION } from "../../src/v3/host/codex-desktop/host-contract.js";
import { FakeDocument, FakeElement, fakeWindow } from "./fake-dom.js";

test("conversation capture scope accepts only GET current-conversation endpoint", () => {
  assert.equal(matchConversationRequest("https://chatgpt.com/backend-api/conversation/abc")?.conversationId, "abc");
  assert.equal(matchConversationRequest("/backend-api/conversation/abc?x=1", {}, "https://chatgpt.com/")?.conversationId, "abc");
  assert.equal(matchConversationRequest("/backend-api/conversation/abc", { method: "POST" }, "https://chatgpt.com/"), null);
  assert.equal(matchConversationRequest("/backend-api/conversation/abc/messages", {}, "https://chatgpt.com/"), null);
  assert.equal(matchConversationRequest("/backend-api/conversations", {}, "https://chatgpt.com/"), null);
});

test("conversation mapping follows current_node parent chain and extracts user turns only", () => {
  const payload = {
    current_node: "a2",
    mapping: {
      q1: { id: "q1", parent: null, message: { author: { role: "user" }, content: { parts: ["first"] } } },
      a1: { id: "a1", parent: "q1", message: { author: { role: "assistant" }, content: { parts: ["answer"] } } },
      q2: { id: "q2", parent: "a1", message: { author: { role: "user" }, content: { parts: ["第二个问题", { text: "补充" }] } } },
      a2: { id: "a2", parent: "q2", message: { author: { role: "assistant" }, content: { parts: ["answer2"] } } },
      branch: { id: "branch", parent: "a1", message: { author: { role: "user" }, content: { parts: ["wrong branch"] } } }
    }
  };
  const result = parseConversationPayload(payload);
  assert.deepEqual(result.map((turn) => turn.id), ["q1", "q2"]);
  assert.equal(result[1].text, "第二个问题 补充");
});

test("capture wrapper returns the original response and parses clone asynchronously", async () => {
  let captured = null;
  const response = { clone: () => ({ json: async () => ({ current_node: "q1", mapping: { q1: { id: "q1", parent: null, message: { author: { role: "user" }, content: { parts: ["hello"] } } } } }) }) };
  const win = { location: { href: "https://chatgpt.com/c/abc" }, fetch: async () => response };
  const capture = new ConversationCapture({ window: win, onCapture: (payload) => { captured = payload; } });
  capture.install();
  const returned = await win.fetch("/backend-api/conversation/abc");
  assert.equal(returned, response);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(captured.conversationId, "abc");
  assert.equal(captured.turns[0].id, "q1");
  capture.dispose();
});

test("Turn ID priority prefers stable container UUID attributes", () => {
  const element = new FakeElement();
  element.setAttribute("data-turn-id-container", "container-id");
  element.setAttribute("data-turn-id", "turn-id");
  element.setAttribute("data-content-search-turn-key", "search-id");
  const adapter = new TurnAdapter({ document: new FakeDocument() });
  assert.equal(adapter.getTurnId(element), "container-id");
  assert.deepEqual(TURN_ID_PRIORITY.slice(0, 3), ["data-turn-id-container", "data-turn-id", "data-content-search-turn-key"]);
});


test("TurnAdapter resolves display-contents Local turn keys to a geometry-bearing user anchor", () => {
  const document = new FakeDocument();
  const turnId = "01a07668-7ccc-7bc3-88ae-4aa4741b5560";
  const wrapper = new FakeElement();
  wrapper.setAttribute("data-content-search-turn-key", turnId);
  wrapper.rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  const anchor = new FakeElement();
  anchor.rect = { top: 120, bottom: 180, left: 500, right: 900, width: 400, height: 60 };
  wrapper.append(anchor);
  wrapper.querySelector = (selector) => selector === "[data-local-conversation-user-anchor='true']" ? anchor : null;
  anchor.closest = (selector) => selector === "[data-content-search-turn-key]" ? wrapper : null;
  document.setSelector(`[data-content-search-turn-key="${turnId}"]`, [wrapper]);
  const adapter = new TurnAdapter({ document });
  assert.equal(adapter.resolveTurn(turnId), anchor);
  assert.equal(adapter.verifyTurnElement(turnId, anchor), true);
});
test("ConversationAdapter resolves selected Codex Desktop ChatGPT sidebar key", () => {
  const document = new FakeDocument();
  const row = new FakeElement();
  row.setAttribute("data-sidebar-chatgpt-conversation-key", "chatgpt:conversation:6a9beb3b-2c98-83ea-aa51-e2ff5c52ef78");
  row.querySelector = (selector) => selector === "[aria-current='page']" ? new FakeElement("button") : null;
  document.setSelector("[data-sidebar-chatgpt-conversation-key]", [row]);
  const window = fakeWindow(document);
  window.location.pathname = "/index.html";
  const adapter = new ConversationAdapter({ document, window });
  assert.equal(adapter.getConversationId(), "6a9beb3b-2c98-83ea-aa51-e2ff5c52ef78");
  assert.equal(parseSidebarConversationKey("chatgpt:conversation:abc"), "abc");
});

test("ConversationAdapter accepts only stable namespaced Local Thread identity", () => {
  const document = new FakeDocument();
  const row = new FakeElement();
  const selector = "[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected='true'], [data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active='true']";
  const localId = "local:01a07940-61ad-7650-913c-34d31b4da543";
  row.setAttribute("data-app-action-sidebar-thread-id", localId);
  row.setAttribute("data-app-action-sidebar-thread-host-id", "local");
  row.setAttribute("data-app-action-sidebar-thread-kind", "local");
  row.setAttribute("data-app-action-sidebar-thread-selected", "true");
  document.setSelector(selector, row);
  const window = fakeWindow(document);
  window.location.pathname = "/index.html";
  const adapter = new ConversationAdapter({ document, window });
  assert.equal(adapter.getConversationId(), localId);
  assert.deepEqual(adapter.getConversationIdentity(), { id: localId, source: "sidebar-local", host: "local", kind: "local", stable: true });
  assert.equal(isStableLocalThreadIdentity(localId, { host: "local", kind: "local" }), true);
  assert.equal(isStableLocalThreadIdentity("local:temporary-title", { host: "local", kind: "local" }), false);
});

test("ConversationAdapter exposes visible conversation content without retaining Local identity", () => {
  const document = new FakeDocument();
  const selector = "[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected='true'], [data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active='true']";
  const contentSelector = "[data-markdown-text-tone='user-message'], [data-turn-key], [data-content-search-turn-key], [data-turn-id], [data-turn-id-container]";
  const localId = "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  const row = new FakeElement();
  row.setAttribute("data-app-action-sidebar-thread-id", localId);
  row.setAttribute("data-app-action-sidebar-thread-host-id", "local");
  row.setAttribute("data-app-action-sidebar-thread-kind", "local");
  row.setAttribute("data-app-action-sidebar-thread-selected", "true");
  const conversationRoot = new FakeElement("main");
  conversationRoot.rect = { left: 220, top: 40, right: 1328, bottom: 860, width: 1108, height: 820 };
  document.setSelector(selector, row);
  document.setSelector("[data-thread-find-target='conversation']", conversationRoot);
  document.setSelector(contentSelector, new FakeElement());
  const window = fakeWindow(document);
  window.location.pathname = "/index.html";
  const adapter = new ConversationAdapter({ document, window });

  assert.equal(adapter.getConversationId(), localId);
  assert.equal(adapter.hasVisibleConversationContent(), true);
  document.setSelector(selector, null);
  assert.equal(adapter.getConversationIdentity(), null);
  assert.equal(adapter.hasVisibleConversationContent(), true);

  conversationRoot.hidden = true;
  assert.equal(adapter.hasVisibleConversationContent(), false);
});

test("ConversationAdapter prefers an explicit stable Local selection over stale ChatGPT selection", () => {
  const document = new FakeDocument();
  const localSelector = "[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected='true'], [data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active='true']";
  const local = new FakeElement();
  const localId = "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  local.setAttribute("data-app-action-sidebar-thread-id", localId);
  local.setAttribute("data-app-action-sidebar-thread-host-id", "local");
  local.setAttribute("data-app-action-sidebar-thread-kind", "local");
  local.setAttribute("data-app-action-sidebar-thread-selected", "true");
  document.setSelector(localSelector, local);
  const chatgpt = new FakeElement();
  chatgpt.setAttribute("data-sidebar-chatgpt-conversation-key", "chatgpt:conversation:stale-chatgpt-id");
  chatgpt.querySelector = (selector) => selector === "[aria-current='page']" ? new FakeElement("button") : null;
  document.setSelector("[data-sidebar-chatgpt-conversation-key]", [chatgpt]);
  const window = fakeWindow(document);
  window.location.pathname = "/index.html";
  const adapter = new ConversationAdapter({ document, window });
  assert.deepEqual(adapter.getConversationIdentity(), { id: localId, source: "sidebar-local", host: "local", kind: "local", stable: true });
});

test("CodexDesktopHost combines host and upstream navigation cancellation", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const host = new CodexDesktopHost({ document, window });
  let upstreamCurrent = true;
  host.navigation.navigateToTurn = async (_turnId, { isCurrent }) => ({ ok: isCurrent(), verified: isCurrent() });
  assert.equal((await host.navigateToTurn("q1", { isCurrent: () => upstreamCurrent })).ok, true);
  upstreamCurrent = false;
  assert.equal((await host.navigateToTurn("q1", { isCurrent: () => upstreamCurrent })).ok, false);
});

test("CodexDesktopHost persists verified scroll only to the explicit current stable Local session", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const localId = "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  const container = new FakeElement();
  container.scrollTop = -1200;
  container.scrollHeight = 6000;
  container.clientHeight = 800;
  const saves = [];
  window.__codexThreadScrollHandlers = { saveNow(sessionId, scroller) { saves.push({ sessionId, scroller }); } };
  const host = new CodexDesktopHost({ document, window });
  host.conversation.getConversationIdentity = () => ({ id: localId, source: "sidebar-local", host: "local", kind: "local", stable: true });
  host.conversation.getScrollContainer = () => container;
  host.navigation.navigateToTurn = async () => ({ ok: true, verified: true, target: "q1" });

  const success = await host.navigateToTurn("q1");
  assert.equal(success.ok, true);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].sessionId, "01a057ce-32ff-75b3-83fb-4179df90399f");
  assert.equal(saves[0].scroller, container);

  host.navigation.navigateToTurn = async () => ({ ok: false, verified: false, target: "q2", reason: "work-wheel-stalled" });
  await host.navigateToTurn("q2");
  assert.equal(saves.length, 1);

  host.navigation.navigateToTurn = async () => {
    host.cancelNavigation();
    return { ok: true, verified: true, target: "q3" };
  };
  await host.navigateToTurn("q3");
  assert.equal(saves.length, 1);

  host.conversation.getConversationIdentity = () => ({ id: "chatgpt-id", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true });
  host.navigation.navigateToTurn = async () => ({ ok: true, verified: true, target: "q4" });
  await host.navigateToTurn("q4");
  assert.equal(saves.length, 1);
});

test("TurnAdapter reads current Desktop user-message tone inside fallback virtual turn", () => {
  const document = new FakeDocument();
  const message = new FakeElement();
  message.setAttribute("data-turn-key", "fallback-turn-0");
  message.innerText = "真实桌面端用户问题";
  document.setSelector("[data-markdown-text-tone='user-message']", [message]);
  const adapter = new TurnAdapter({ document, clock: () => 42 });
  const turns = adapter.getVisibleTurns();
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "fallback-turn-0");
  assert.equal(turns[0].text, "真实桌面端用户问题");
});

test("OverlayDetector treats visible host dialogs as Prompt blockers", () => {
  const document = new FakeDocument();
  const detector = new OverlayDetector({ document });
  assert.equal(detector.isBlockingDialogOpen(), false);

  const dialog = new FakeElement("div");
  dialog.setAttribute("role", "dialog");
  document.setSelector("[role='dialog']", dialog);
  assert.equal(detector.isBlockingDialogOpen(), true);

  dialog.hidden = true;
  assert.equal(detector.isBlockingDialogOpen(), false);
  dialog.hidden = false;
  dialog.setAttribute("aria-hidden", "true");
  assert.equal(detector.isBlockingDialogOpen(), false);

  document.setSelector("[role='dialog']", null);
  const modal = new FakeElement("div");
  modal.setAttribute("aria-modal", "true");
  document.setSelector("[aria-modal='true']", modal);
  assert.equal(detector.isBlockingDialogOpen(), true);
});

test("OverlayDetector blocks Prompt only when a visible floating layer reaches the composer zone", () => {
  const document = new FakeDocument();
  const detector = new OverlayDetector({ document });
  const composerRect = { left: 440, top: 600, right: 1080, bottom: 680, width: 640, height: 80 };
  const floating = new FakeElement("div");
  floating.rect = { left: 120, top: 200, right: 320, bottom: 320, width: 200, height: 120 };
  document.setSelector("[data-radix-popper-content-wrapper]", floating);

  assert.equal(detector.isPromptFloatingLayerOpen({ composerRect }), false);

  floating.rect = { left: 250, top: 520, right: 520, bottom: 650, width: 270, height: 130 };
  assert.equal(detector.isPromptFloatingLayerOpen({ composerRect }), true);

  floating.hidden = true;
  assert.equal(detector.isPromptFloatingLayerOpen({ composerRect }), false);
  floating.hidden = false;
  floating.setAttribute("aria-hidden", "true");
  assert.equal(detector.isPromptFloatingLayerOpen({ composerRect }), false);
});

test("CodexDesktopHost passes the current composer rect into Prompt floating-layer blocking", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const host = new CodexDesktopHost({ document, window });
  const composerRect = { left: 440, top: 600, right: 1080, bottom: 680, width: 640, height: 80 };
  let seen = null;
  host.getComposerRect = () => composerRect;
  host.overlay = {
    isBlockingDialogOpen: () => false,
    isPromptFloatingLayerOpen: (payload) => { seen = payload; return true; }
  };

  assert.equal(host.isPromptOverlayBlocked(), true);
  assert.deepEqual(seen, { composerRect });
});

test("SurfaceDetector covers new chat, conversation, media, settings, plugin manager and other", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const conversation = {
    id: null,
    visibleContent: false,
    getConversationId() { return this.id; },
    hasVisibleConversationContent() { return this.visibleContent; }
  };
  const overlay = { open: false, isMediaViewerOpen() { return this.open; } };
  const detector = new SurfaceDetector({ document, window, conversationAdapter: conversation, overlayDetector: overlay });
  assert.equal(detector.getSurface(), SURFACE.OTHER);
  conversation.visibleContent = true;
  assert.equal(detector.getSurface(), SURFACE.CONVERSATION);
  conversation.visibleContent = false;
  document.setSelector("textarea[placeholder]", new FakeElement("textarea"));
  assert.equal(detector.getSurface(), SURFACE.OTHER);
  document.setSelector("#prompt-textarea", new FakeElement("textarea"));
  assert.equal(detector.getSurface(), SURFACE.NEW_CHAT);
  conversation.id = "abc";
  assert.equal(detector.getSurface(), SURFACE.CONVERSATION);
  overlay.open = true;
  assert.equal(detector.getSurface(), SURFACE.MEDIA_VIEWER);
  overlay.open = false; conversation.id = null;
  window.location.pathname = "/settings/general";
  assert.equal(detector.getSurface(), SURFACE.SETTINGS);
  window.location.pathname = "/plugins";
  assert.equal(detector.getSurface(), SURFACE.PLUGIN_MANAGER);
});

test("ComposerAdapter rejects a page-sized form and uses the local composer container", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const pageForm = new FakeElement("form");
  pageForm.rect = { left: 240, top: 0, right: 1327, bottom: 820, width: 1087, height: 820 };
  const local = new FakeElement("div");
  local.rect = { left: 415, top: 690, right: 1150, bottom: 770, width: 735, height: 80 };
  const composer = new FakeElement("textarea");
  composer.rect = { left: 438, top: 715, right: 1110, bottom: 755, width: 672, height: 40 };
  pageForm.append(local);
  local.append(composer);
  document.setSelector("#prompt-textarea", composer);
  const adapter = new ComposerAdapter({ document, window });
  assert.equal(adapter.getComposerForm(), local);
  assert.deepEqual(adapter.getComposerRect(), local.rect);
});

test("ComposerAdapter inserts with readback repeatedly without sending", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const composer = new FakeElement("textarea");
  composer.value = "";
  composer.selectionStart = composer.selectionEnd = 0;
  document.setSelector("#prompt-textarea", composer);
  const adapter = new ComposerAdapter({ document, window });
  for (let index = 0; index < 10; index += 1) {
    composer.selectionStart = composer.selectionEnd = composer.value.length;
    const result = adapter.insertText(`P${index}`);
    assert.equal(result.ok, true);
  }
  assert.match(composer.value, /P0/);
  assert.match(composer.value, /P9/);
});

test("rendered navigation verifies live UUID", async () => {
  const element = new FakeElement();
  element.rect = { top: 160, bottom: 250, left: 0, right: 800, width: 800, height: 90 };
  const turnAdapter = { resolveTurn: () => element, verifyTurnElement: (_id, candidate) => candidate === element };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  const nav = new NavigationAdapter({ window: fakeWindow(), turnAdapter, conversationAdapter: { getScrollContainer: () => container } });
  const result = await nav.navigateToTurn("q17", { turns: [{ id: "q17", order: 16 }] });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
});

test("already-mounted stable target uses guarded fast settle", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 250, left: 0, right: 800, width: 800, height: 90 };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 5000;
  container.scrollTop = 1200;
  const turnAdapter = {
    resolveTurn: (id) => id === "q17" ? target : null,
    verifyTurnElement: (id, element) => id === "q17" && element === target,
    getVisibleTurns: () => [{ id: "q17", order: 16 }]
  };
  const nav = new NavigationAdapter({
    window, turnAdapter, conversationAdapter: { getScrollContainer: () => container },
    mountedFastSettleWaitMs: 5, postSettleWaitMs: 30, maxPostSettleCorrections: 2
  });
  const started = Date.now();
  const result = await nav.navigateToTurn("q17", { turns: [{ id: "q17", order: 16 }], allowMountedFastSettle: true });
  const wallMs = Date.now() - started;
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.settleMode, "mounted-fast");
  assert.equal(result.settleChecks, 1);
  assert.ok(wallMs < 45, "expected fast settle to avoid two 30ms waits, got " + wallMs + "ms");
});

test("mounted fast settle falls back to full correction when drift appears", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 5000;
  let physicalScrollTop = 1200;
  let corrections = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalScrollTop,
    set: (value) => { physicalScrollTop = value; corrections += 1; target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 }; },
    configurable: true
  });
  const turnAdapter = {
    resolveTurn: (id) => id === "q4" ? target : null,
    verifyTurnElement: (id, element) => id === "q4" && element === target,
    getVisibleTurns: () => [{ id: "q4", order: 3 }]
  };
  window.setTimeout(() => { target.rect = { top: 310, bottom: 410, left: 0, right: 800, width: 800, height: 100 }; }, 2);
  const nav = new NavigationAdapter({
    window, turnAdapter, conversationAdapter: { getScrollContainer: () => container },
    mountedFastSettleWaitMs: 8, postSettleWaitMs: 8, maxPostSettleCorrections: 2
  });
  const result = await nav.navigateToTurn("q4", { turns: [{ id: "q4", order: 3 }], allowMountedFastSettle: true });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.notEqual(result.settleMode, "mounted-fast");
  assert.ok(corrections >= 1);
});

test("target discovered by hydration keeps the full settle path", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 250, left: 0, right: 800, width: 800, height: 90 };
  let stage = 0;
  const turnAdapter = {
    resolveTurn: (id) => stage >= 1 && id === "q1" ? target : null,
    verifyTurnElement: (id, element) => id === "q1" && element === target,
    getVisibleTurns: () => stage >= 1 ? [{ id: "q1", order: 0 }] : [{ id: "q2", order: 1 }]
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 3000;
  let top = 1600;
  Object.defineProperty(container, "scrollTop", {
    get: () => top,
    set: (value) => { top = value; stage = 1; },
    configurable: true
  });
  const nav = new NavigationAdapter({
    window, turnAdapter, conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ host: "chatgpt" }) },
    mountedFastSettleWaitMs: 5, postSettleWaitMs: 2, maxPostSettleCorrections: 1, hydrationWaitMs: 5
  });
  const result = await nav.navigateToTurn("q1", { turns: [{ id: "q1", order: 0 }, { id: "q2", order: 1 }], allowMountedFastSettle: true });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.notEqual(result.settleMode, "mounted-fast");
});

test("ChatGPT Earlier boundary renews only after structural progress", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const delays = [];
  let boundaryCalls = 0;
  let targetReady = false;
  const realSetTimeout = globalThis.setTimeout;
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 5000;
  container.scrollTop = -4199;
  window.setTimeout = (callback, ms) => {
    delays.push(ms);
    return realSetTimeout(() => {
      if (ms === 1800) {
        boundaryCalls += 1;
        if (boundaryCalls === 1) container.scrollHeight = 8000;
        if (boundaryCalls === 2) targetReady = true;
      }
      callback();
    }, 0);
  };
  window.clearTimeout = clearTimeout;
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 250, left: 0, right: 800, width: 800, height: 90 };
  const turnAdapter = {
    resolveTurn: (id) => targetReady && id === "q1" ? target : null,
    verifyTurnElement: (id, element) => id === "q1" && element === target,
    getVisibleTurns: () => targetReady ? [{ id: "q1", order: 0 }, { id: "q2", order: 1 }] : [{ id: "q2", order: 1 }, { id: "q3", order: 2 }]
  };
  const nav = new NavigationAdapter({
    window, turnAdapter,
    conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ host: "chatgpt", source: "sidebar-chatgpt" }) },
    chatMotionProgressWaitMs: 8, chatBoundaryHydrationWaitMs: 1800, hydrationWaitMs: 900, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn("q1", { turns: [{ id: "q1", order: 0 }, { id: "q2", order: 1 }, { id: "q3", order: 2 }] });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(delays.filter((ms) => ms === 1800).length, 2);
  const boundaries = result.steps.filter((step) => step.mode === "chat-boundary");
  assert.equal(boundaries.length, 2);
  assert.equal(boundaries[0]?.progressKind, "extent");
  assert.equal(boundaries[1]?.progressKind, "target");
});

test("ChatGPT Earlier boundary does not renew without structural progress", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const delays = [];
  const realSetTimeout = globalThis.setTimeout;
  window.setTimeout = (callback, ms) => { delays.push(ms); return realSetTimeout(callback, 0); };
  window.clearTimeout = clearTimeout;
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 5000;
  container.scrollTop = -4199;
  const turnAdapter = {
    resolveTurn: () => null,
    verifyTurnElement: () => false,
    getVisibleTurns: () => [{ id: "q2", order: 1 }, { id: "q3", order: 2 }]
  };
  const nav = new NavigationAdapter({
    window, turnAdapter,
    conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ host: "chatgpt", source: "sidebar-chatgpt" }) },
    chatMotionProgressWaitMs: 8, chatBoundaryHydrationWaitMs: 1800, hydrationWaitMs: 900,
    maxConsecutiveStalls: 1, absoluteMaxNavigationMs: 10000, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn("q1", { turns: [{ id: "q1", order: 0 }, { id: "q2", order: 1 }, { id: "q3", order: 2 }] });
  assert.equal(result.ok, false);
  assert.equal(delays.filter((ms) => ms === 1800).length, 1);
  assert.equal(result.steps.filter((step) => step.mode === "chat-boundary").length, 1);
});

test("ChatGPT regular hydration uses the shorter motion gate", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const delays = [];
  let motionReady = false;
  const realSetTimeout = globalThis.setTimeout;
  window.setTimeout = (callback, ms) => {
    delays.push(ms);
    return realSetTimeout(() => { if (ms === 7) motionReady = true; callback(); }, 0);
  };
  window.clearTimeout = clearTimeout;
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 250, left: 0, right: 800, width: 800, height: 90 };
  const turnAdapter = {
    resolveTurn: (id) => motionReady && id === "q1" ? target : null,
    verifyTurnElement: (id, element) => id === "q1" && element === target,
    getVisibleTurns: () => [{ id: "q2", order: 1 }]
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 4000;
  container.scrollTop = 2200;
  const nav = new NavigationAdapter({
    window, turnAdapter,
    conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ host: "chatgpt", source: "sidebar-chatgpt" }) },
    motionProgressWaitMs: 45, chatMotionProgressWaitMs: 7, hydrationWaitMs: 200, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn("q1", { turns: [{ id: "q1", order: 0 }, { id: "q2", order: 1 }] });
  assert.equal(result.ok, true);
  assert.ok(delays.includes(7));
  assert.equal(delays.includes(45), false);
  assert.ok(Array.isArray(result.steps));
  assert.equal(result.steps.at(-1)?.mode, "chat-progressive");
  assert.equal(result.steps.at(-1)?.waitMs, 7);
  assert.equal(result.steps.at(-1)?.progressKind, "target");
  assert.equal(typeof result.steps.at(-1)?.elapsedMs, "number");
});

test("Non-sidebar Local regular hydration keeps the default motion gate", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const delays = [];
  let motionReady = false;
  const realSetTimeout = globalThis.setTimeout;
  window.setTimeout = (callback, ms) => {
    delays.push(ms);
    return realSetTimeout(() => { if (ms === 45) motionReady = true; callback(); }, 0);
  };
  window.clearTimeout = clearTimeout;
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 250, left: 0, right: 800, width: 800, height: 90 };
  const turnAdapter = {
    resolveTurn: (id) => motionReady && id === "q5" ? target : null,
    verifyTurnElement: (id, element) => id === "q5" && element === target,
    getVisibleTurns: () => [{ id: "q1", order: 0 }, { id: "q2", order: 1 }]
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 4000;
  container.scrollTop = -1200;
  const nav = new NavigationAdapter({
    window, turnAdapter,
    conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ host: "local", source: "other-local" }) },
    motionProgressWaitMs: 45, chatMotionProgressWaitMs: 7, hydrationWaitMs: 200, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const turns = Array.from({ length: 8 }, (_, order) => ({ id: "q" + (order + 1), order }));
  const result = await nav.navigateToTurn("q5", { turns });
  assert.equal(result.ok, true);
  assert.ok(delays.includes(45));
  assert.equal(delays.includes(7), false);
  assert.equal(result.steps.at(-1)?.mode, "regular-progressive");
  assert.equal(result.steps.at(-1)?.waitMs, 45);
});

test("ChatGPT Earlier jump adapts to target distance without affecting Work", () => {
  assert.equal(hydrationJumpScale({ host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 8, chatEarlierJumpScale: 1.35 }), 1.35);
  assert.equal(hydrationJumpScale({ host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 28, chatEarlierJumpScale: 1.35 }), 1.55);
  assert.equal(hydrationJumpScale({ host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 60, chatEarlierJumpScale: 1.35 }), 1.75);
  assert.equal(hydrationJumpScale({ host: "chatgpt", direction: 1, targetBeforeVisible: false, targetDistance: 60, chatEarlierJumpScale: 1.35 }), 1);
  assert.equal(hydrationJumpScale({ host: "local", direction: -1, targetBeforeVisible: true, targetDistance: 60, chatEarlierJumpScale: 1.35 }), 1);
});

test("ChatGPT far Earlier coalesces only while far from target and boundary", () => {
  const far = chatFarCoalescedJump({ baseJump: 5600, host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 60, logicalPosition: 40000, minLogicalPosition: 0, stalled: false });
  assert.equal(far.coalesced, true);
  assert.equal(far.jumpPx, 7560);
  const capped = chatFarCoalescedJump({ baseJump: 7000, host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 60, logicalPosition: 40000, minLogicalPosition: 0, stalled: false });
  assert.equal(capped.jumpPx, 7600);
  assert.equal(chatFarCoalescedJump({ baseJump: 5600, host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 20, logicalPosition: 40000 }).coalesced, false);
  assert.equal(chatFarCoalescedJump({ baseJump: 5600, host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 60, logicalPosition: 8000 }).coalesced, false);
  assert.equal(chatFarCoalescedJump({ baseJump: 5600, host: "chatgpt", direction: -1, targetBeforeVisible: true, targetDistance: 60, logicalPosition: 40000, stalled: true }).coalesced, false);
  assert.equal(chatFarCoalescedJump({ baseJump: 5600, host: "local", direction: -1, targetBeforeVisible: true, targetDistance: 60, logicalPosition: 40000 }).coalesced, false);
});

test("Chat predictive fast-path planning is Chat-only, contiguous and far-Earlier", () => {
  const orderById = new Map(Array.from({ length: 76 }, (_, order) => ["q" + (order + 1), order]));
  const indexState = { targetOrder: 0, maxKnownOrder: 75, orderById };
  const snapshot = { visibleOrders: [69, 70, 71, 72, 73, 74, 75], scrollHeight: 76000, clientHeight: 800, maxLogicalPosition: 75200, logicalPosition: 75200 };
  const plan = planChatPredictiveFastPath({ allowed: true, identity: { host: "chatgpt", stable: true }, indexState, snapshot });
  assert.equal(plan.eligible, true);
  assert.equal(plan.predictedLogical, 0);
  assert.equal(predictChatFastLogicalPosition({ targetOrder: 19, maxKnownOrder: 75, maxLogicalPosition: 75200 }), 19051);
  assert.equal(planChatPredictiveFastPath({ allowed: true, identity: { host: "local", stable: true }, indexState, snapshot }).eligible, false);
  const gapped = new Map(orderById); gapped.delete("q25");
  assert.equal(planChatPredictiveFastPath({ allowed: true, identity: { host: "chatgpt", stable: true }, indexState: { ...indexState, orderById: gapped }, snapshot }).reason, "non-contiguous-index");
});

test("Chat fast-path stability rejects moving extent or virtual window", () => {
  const base = { visibleOrders: [69, 70, 71], scrollHeight: 76000, clientHeight: 800, maxLogicalPosition: 75200, logicalPosition: 75200 };
  assert.equal(chatFastSnapshotStable(base, { ...base }), true);
  assert.equal(chatFastSnapshotStable(base, { ...base, scrollHeight: 77000, maxLogicalPosition: 76200 }), false);
  assert.equal(chatFastSnapshotStable(base, { ...base, visibleOrders: [68, 69, 70] }), false);
});

test("Chat predictive fast path verifies an unmounted Q1 after one predicted jump", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const target = new FakeElement();
  target.rect = { top: 150, bottom: 250, left: 0, right: 800, width: 800, height: 100 };
  const container = new FakeElement();
  container.rect = { top: 30, bottom: 830, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 76000;
  let physicalTop = 0;
  let writes = 0;
  Object.defineProperty(container, "scrollTop", { get: () => physicalTop, set: (value) => { writes += 1; physicalTop = value; } });
  const visible = Array.from({ length: 7 }, (_, i) => ({ id: "q" + (70 + i), order: 69 + i }));
  const turnAdapter = {
    resolveTurn: (id) => writes >= 1 && id === "q1" ? target : null,
    verifyTurnElement: (id, element) => id === "q1" && element === target,
    getVisibleTurns: () => visible
  };
  const nav = new NavigationAdapter({
    window, turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "chat-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true })
    },
    chatFastPathWaitMs: 5, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const turns = Array.from({ length: 76 }, (_, order) => ({ id: "q" + (order + 1), order }));
  const result = await nav.navigateToTurn("q1", { turns, allowChatPredictiveFastPath: true });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.fastAttempted, true);
  assert.equal(result.fastSucceeded, true);
  assert.equal(result.fallbackReason, null);
  assert.equal(result.steps[0]?.mode, "chat-fast");
  assert.equal(result.steps[0]?.jumpPx, 75200);
  assert.equal(result.steps.some((step) => step.mode === "chat-progressive" || step.mode === "chat-coalesced"), false);
});

test("Chat predictive fast miss falls back to the stable coalesced path", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const target = new FakeElement();
  target.rect = { top: 150, bottom: 250, left: 0, right: 800, width: 800, height: 100 };
  const container = new FakeElement();
  container.rect = { top: 30, bottom: 830, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 76000;
  let physicalTop = 0;
  let writes = 0;
  Object.defineProperty(container, "scrollTop", { get: () => physicalTop, set: (value) => { writes += 1; physicalTop = value; } });
  const visible = Array.from({ length: 7 }, (_, i) => ({ id: "q" + (70 + i), order: 69 + i }));
  const turnAdapter = {
    resolveTurn: (id) => writes >= 2 && id === "q20" ? target : null,
    verifyTurnElement: (id, element) => id === "q20" && element === target,
    getVisibleTurns: () => visible
  };
  const nav = new NavigationAdapter({
    window, turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "chat-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true })
    },
    chatFastPathWaitMs: 0, chatMotionProgressWaitMs: 1, hydrationWaitMs: 5, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const turns = Array.from({ length: 76 }, (_, order) => ({ id: "q" + (order + 1), order }));
  const result = await nav.navigateToTurn("q20", { turns, allowChatPredictiveFastPath: true });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.fastAttempted, true);
  assert.equal(result.fastSucceeded, false);
  assert.equal(result.fallbackReason, "no-structural-progress");
  assert.equal(result.steps[0]?.mode, "chat-fast");
  assert.ok(result.steps.slice(1).some((step) => step.mode === "chat-coalesced" || step.mode === "chat-progressive"));
});

test("Work Earlier wheel step adapts to distance while preserving short-history and boundary safety", () => {
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 10, targetDistance: 60, logicalPosition: 5000 }), 400);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 40, targetDistance: 10, logicalPosition: 5000 }), 720);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 40, targetDistance: 30, logicalPosition: 5000 }), 864);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 80, targetDistance: 60, logicalPosition: 5000 }), 972);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 80, targetDistance: 60, logicalPosition: 500 }), 500);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 80, targetDistance: 60, logicalPosition: 1000, minLogicalPosition: 0, maxLogicalPosition: 1500, direction: 1 }), 500);
});

test("accelerated Work cadence keeps the conservative boundary wait", () => {
  const nav = new NavigationAdapter({ window: fakeWindow(), turnAdapter: {}, conversationAdapter: {} });
  assert.equal(nav.workWheelWaitMs, 120);
  assert.equal(nav.hydrationWaitMs, 900);
});

test("navigation resolves canonical capture id through fallback-turn order", async () => {
  const element = new FakeElement();
  element.rect = { top: 120, bottom: 220, left: 0, right: 800, width: 800, height: 100 };
  const turnAdapter = {
    resolveTurn: (id) => id === "fallback-turn-2" ? element : null,
    verifyTurnElement: (id, candidate) => id === "fallback-turn-2" && candidate === element,
    getVisibleTurns: () => [{ id: "fallback-turn-2", order: 2 }]
  };
  const container = new FakeElement();
  container.rect = { top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 };
  const nav = new NavigationAdapter({ window: fakeWindow(), turnAdapter, conversationAdapter: { getScrollContainer: () => container } });
  const result = await nav.navigateToTurn("q3", { turns: [
    { id: "q1", order: 0 }, { id: "q2", order: 1 }, { id: "q3", order: 2 }, { id: "q4", order: 3 }
  ] });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.target, "q3");
  assert.equal(result.domId, "fallback-turn-2");
});
test("stale/recycled DOM is rejected", async () => {
  const stale = new FakeElement();
  const turnAdapter = { resolveTurn: () => null, verifyTurnElement: () => false };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  const nav = new NavigationAdapter({ window: fakeWindow(), turnAdapter, conversationAdapter: { getScrollContainer: () => container } });
  const result = await nav.verifyAndCenter("q17", stale, () => true, 0);
  assert.equal(result.reason, "stale-or-recycled-dom");
});

test("progressive hydration follows fallback order and stays bounded", async () => {
  const document = new FakeDocument();
  let frames = 0;
  const window = fakeWindow(document);
  window.requestAnimationFrame = (callback) => { frames += 1; callback(); return frames; };
  const target = new FakeElement();
  target.rect = { top: 120, bottom: 230, left: 0, right: 800, width: 800, height: 110 };
  const turnAdapter = {
    resolveTurn: (id) => frames >= 4 && (id === "q27" || id === "fallback-turn-26") ? target : null,
    verifyTurnElement: (_id, element) => element === target,
    getVisibleTurns: () => [{ id: "fallback-turn-31", order: 31 }, { id: "fallback-turn-32", order: 32 }]
  };
  const container = new FakeElement();
  container.rect = { top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 };
  container.scrollHeight = 5000;
  container.clientHeight = 800;
  container.scrollTop = 3000;
  const nav = new NavigationAdapter({ window, turnAdapter, conversationAdapter: { getScrollContainer: () => container }, maxHydrationSteps: 8 });
  const all = Array.from({ length: 50 }, (_, i) => ({ id: `q${i + 1}`, order: i }));
  const result = await nav.navigateToTurn("q27", { turns: all });
  assert.equal(result.ok, true);
  assert.ok(result.probes <= 8);
  assert.equal(chooseHydrationDirection(26, [31, 32], { logicalPosition: 3000, maxLogicalPosition: 4200 }), -1);
  assert.ok(hydrationStepSize({ clientHeight: 800, maxLogicalPosition: 4200 }, [31, 32], 26) >= 900);
});

test("navigation hydrates stable Local UUID windows using canonical global turn order", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 };
  const ranges = [[30, 31], [20, 21], [5, 6]];
  let stage = 0;
  const ids = Array.from({ length: 40 }, (_, index) => "stable-" + index);
  const turnAdapter = {
    resolveTurn: (id) => stage >= 2 && id === ids[5] ? target : null,
    verifyTurnElement: (id, element) => id === ids[5] && element === target,
    getVisibleTurns: () => ranges[stage].map((globalOrder, localOrder) => ({
      id: ids[globalOrder],
      order: localOrder
    }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.scrollHeight = 5000;
  container.clientHeight = 800;
  let physicalScrollTop = 3000;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalScrollTop,
    set: (value) => {
      const previous = physicalScrollTop;
      physicalScrollTop = value;
      if (value < previous && stage < ranges.length - 1) stage += 1;
    },
    configurable: true
  });
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    maxHydrationSteps: 8,
    maxConsecutiveStalls: 2,
    hydrationWaitMs: 20,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const turns = ids.map((id, order) => ({ id, order }));
  const result = await nav.navigateToTurn(ids[5], { turns });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(stage, 2);
});


test("navigation snaps a known Local tail target to the exact column-reverse boundary", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  const target = new FakeElement();
  target.rect = { top: 150, bottom: 220, left: 0, right: 800, width: 800, height: 70 };
  let tailMounted = false;
  const turnAdapter = {
    resolveTurn: (id) => tailMounted && id === ids[39] ? target : null,
    verifyTurnElement: (id, element) => id === ids[39] && element === target,
    getVisibleTurns: () => (tailMounted ? [36, 37, 38, 39] : [32, 33, 34, 35, 36, 37, 38])
      .map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 777, left: 0, right: 800, width: 800, height: 737 };
  container.scrollHeight = 7548;
  container.clientHeight = 737;
  const writes = [];
  let scrollTop = -1414;
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    set: (value) => {
      scrollTop = value;
      writes.push(value);
      if (value === 0) tailMounted = true;
    },
    configurable: true
  });
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    hydrationWaitMs: 20,
    maxHydrationSteps: 4,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[39], { turns: ids.map((id, order) => ({ id, order })) });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.ok(writes.includes(0));
});
test("last reverse turn verifies at the physical tail when it is visible but cannot reach the activation line", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  const target = new FakeElement();
  target.rect = { top: 680, bottom: 750, left: 0, right: 800, width: 800, height: 70 };
  const turnAdapter = {
    resolveTurn: (id) => id === ids[39] ? target : null,
    verifyTurnElement: (id, element) => id === ids[39] && element === target,
    getVisibleTurns: () => [{ id: ids[39], order: 0 }]
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 777, left: 0, right: 800, width: 800, height: 737 };
  container.scrollHeight = 7548;
  container.clientHeight = 737;
  container.scrollTop = 0;
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[39], { turns: ids.map((id, order) => ({ id, order })) });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.endpoint, "tail");
  assert.equal(result.targetOrder, 39);
});

test("tail verification never relaxes activation-line verification for a non-last turn", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  const target = new FakeElement();
  target.rect = { top: 680, bottom: 750, left: 0, right: 800, width: 800, height: 70 };
  const turnAdapter = {
    resolveTurn: (id) => id === ids[38] ? target : null,
    verifyTurnElement: (id, element) => id === ids[38] && element === target,
    getVisibleTurns: () => [{ id: ids[38], order: 0 }]
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 777, left: 0, right: 800, width: 800, height: 737 };
  container.scrollHeight = 7548;
  container.clientHeight = 737;
  container.scrollTop = 0;
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.verifyAndAlign(ids[38], { element: target, domId: ids[38] }, () => true, 0, 38, 39);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "post-settle-drift");
});
test("navigation uses logical positions for column-reverse scroll model", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  let frames = 0;
  window.requestAnimationFrame = (callback) => { frames += 1; callback(); return frames; };
  const target = new FakeElement();
  target.rect = { top: 140, bottom: 220, left: 0, right: 800, width: 800, height: 80 };
  const turnAdapter = {
    resolveTurn: (id) => frames >= 2 && id === "q1" ? target : null,
    verifyTurnElement: (id, element) => id === "q1" && element === target,
    getVisibleTurns: () => [{ id: "fallback-turn-2", order: 2 }]
  };
  const values = [];
  const container = new FakeElement();
  container.rect = { top: 20, bottom: 220, left: 0, right: 800, width: 800, height: 200 };
  container.scrollHeight = 1000;
  container.clientHeight = 200;
  let scrollTop = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    set: (value) => { scrollTop = value; values.push(value); },
    configurable: true
  });
  const nav = new NavigationAdapter({ window, turnAdapter, conversationAdapter: { getScrollContainer: () => container } });
  const result = await nav.navigateToTurn("q1", { turns: [{ id: "q1", order: 0 }, { id: "q2", order: 1 }, { id: "q3", order: 2 }] });
  assert.ok(values.some((value) => value < 0));
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
});
test("navigation supersession is fail-safe", async () => {
  const nav = new NavigationAdapter({ window: fakeWindow(), turnAdapter: { resolveTurn: () => null, verifyTurnElement: () => false }, conversationAdapter: { getScrollContainer: () => new FakeElement() } });
  const result = await nav.navigateToTurn("q2", { turns: [{ id: "q1" }, { id: "q2" }], isCurrent: () => false });
  assert.equal(result.reason, "superseded");
});

test("navigation stops when its originating scroll container is replaced", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const containerA = new FakeElement();
  const containerB = new FakeElement();
  containerA.scrollHeight = 5000;
  containerA.clientHeight = 800;
  containerA.rect = { top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 };
  containerB.scrollHeight = 5000;
  containerB.clientHeight = 800;
  containerB.rect = { top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 };
  let currentContainer = containerA;
  let scrollTop = 3000;
  Object.defineProperty(containerA, "scrollTop", {
    get: () => scrollTop,
    set: (value) => { scrollTop = value; currentContainer = containerB; },
    configurable: true
  });
  const turnAdapter = {
    resolveTurn: () => null,
    verifyTurnElement: () => false,
    getVisibleTurns: () => [{ id: "fallback-turn-10", order: 10 }]
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => currentContainer },
    hydrationWaitMs: 20,
    maxHydrationSteps: 4
  });
  const result = await nav.navigateToTurn("q1", { turns: [{ id: "q1", order: 0 }], isCurrent: () => true });
  assert.equal(result.reason, "superseded");
  assert.equal(currentContainer, containerB);
});

test("tail active selects the visually latest visible turn at a scrollable column-reverse physical tail", () => {
  const rects = new Map([
    ["q62", { top: 180, bottom: 260 }],
    ["q63", { top: 680, bottom: 750 }]
  ]);
  const container = {
    scrollTop: 0,
    scrollHeight: 7548,
    clientHeight: 737,
    style: { flexDirection: "column-reverse" },
    getBoundingClientRect: () => ({ top: 40, bottom: 777, height: 737 })
  };
  const active = computeTailActiveTurnId({
    visibleTurns: [{ id: "q62" }, { id: "q63" }],
    resolveTurn: (id) => ({ getBoundingClientRect: () => rects.get(id) }),
    container,
    windowRef: { getComputedStyle: () => ({ flexDirection: "column-reverse" }) }
  });
  assert.equal(active, "q63");
});

test("CodexDesktopHost tail active overrides a previous turn crossing the activation line", () => {
  const rects = new Map([
    ["q62", { top: 120, bottom: 220 }],
    ["q63", { top: 680, bottom: 750 }]
  ]);
  const container = {
    scrollTop: 0,
    scrollHeight: 7548,
    clientHeight: 737,
    style: { flexDirection: "column-reverse" },
    getBoundingClientRect: () => ({ top: 40, bottom: 777, height: 737 })
  };
  const resolveTurn = (id) => ({ getBoundingClientRect: () => rects.get(id) });
  const visibleTurns = [{ id: "q62" }, { id: "q63" }];
  assert.equal(computeActiveTurnId({ visibleTurns, resolveTurn, container, activationOffset: 120 }), "q62");

  const host = Object.create(CodexDesktopHost.prototype);
  host.window = { getComputedStyle: () => ({ flexDirection: "column-reverse" }) };
  host.getVisibleTurns = () => visibleTurns;
  host.getScrollContainer = () => container;
  host.resolveTurn = resolveTurn;
  assert.equal(host.getActiveTurnId(), "q63");
});
test("tail active stays disabled away from the column-reverse physical tail", () => {
  const container = {
    scrollTop: -120,
    scrollHeight: 7548,
    clientHeight: 737,
    style: { flexDirection: "column-reverse" },
    getBoundingClientRect: () => ({ top: 40, bottom: 777, height: 737 })
  };
  const active = computeTailActiveTurnId({
    visibleTurns: [{ id: "q62" }, { id: "q63" }],
    resolveTurn: (id) => ({ getBoundingClientRect: () => id === "q62" ? { top: 180, bottom: 260 } : { top: 680, bottom: 750 } }),
    container,
    windowRef: { getComputedStyle: () => ({ flexDirection: "column-reverse" }) }
  });
  assert.equal(active, null);
});

test("tail active stays disabled for non-column-reverse containers", () => {
  const container = {
    scrollTop: 0,
    scrollHeight: 7548,
    clientHeight: 737,
    style: { flexDirection: "column" },
    getBoundingClientRect: () => ({ top: 40, bottom: 777, height: 737 })
  };
  const active = computeTailActiveTurnId({
    visibleTurns: [{ id: "q62" }, { id: "q63" }],
    resolveTurn: (id) => ({ getBoundingClientRect: () => id === "q62" ? { top: 180, bottom: 260 } : { top: 680, bottom: 750 } }),
    container,
    windowRef: { getComputedStyle: () => ({ flexDirection: "column" }) }
  });
  assert.equal(active, null);
});

test("tail active fails closed when a later turn remains below the viewport", () => {
  const container = {
    scrollTop: 0,
    scrollHeight: 7548,
    clientHeight: 737,
    style: { flexDirection: "column-reverse" },
    getBoundingClientRect: () => ({ top: 40, bottom: 777, height: 737 })
  };
  const active = computeTailActiveTurnId({
    visibleTurns: [{ id: "q62" }, { id: "q63" }],
    resolveTurn: (id) => ({ getBoundingClientRect: () => id === "q62" ? { top: 180, bottom: 260 } : { top: 800, bottom: 870 } }),
    container,
    windowRef: { getComputedStyle: () => ({ flexDirection: "column-reverse" }) }
  });
  assert.equal(active, null);
});
test("ActiveTracker uses the scroll-container activation line", () => {
  const rects = new Map([
    ["q1", { top: 60, bottom: 170 }],
    ["q2", { top: 180, bottom: 310 }],
    ["q3", { top: 400, bottom: 520 }]
  ]);
  const container = { getBoundingClientRect: () => ({ top: 100, bottom: 700, height: 600 }) };
  const active = computeActiveTurnId({
    visibleTurns: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
    resolveTurn: (id) => ({ getBoundingClientRect: () => rects.get(id) }),
    container,
    activationOffset: 120
  });
  assert.equal(active, "q2");
  assert.equal(rectInActivationZone({ top: 220, bottom: 300 }, container.getBoundingClientRect(), 120), true);
});








test("ActiveTracker ignores a previous turn that is merely still visible above the activation line", () => {
  const rects = new Map([
    ["q75", { top: 150, bottom: 205 }],
    ["q76", { top: 224, bottom: 360 }]
  ]);
  const container = { getBoundingClientRect: () => ({ top: 100, bottom: 700, height: 600 }) };
  const active = computeActiveTurnId({
    visibleTurns: [{ id: "q75" }, { id: "q76" }],
    resolveTurn: (id) => ({ getBoundingClientRect: () => rects.get(id) }),
    container,
    activationOffset: 120
  });
  assert.equal(active, "q76");
});

test("ActiveTracker keeps the previous turn active when it truly spans the activation line", () => {
  const rects = new Map([
    ["q75", { top: 180, bottom: 260 }],
    ["q76", { top: 270, bottom: 390 }]
  ]);
  const container = { getBoundingClientRect: () => ({ top: 100, bottom: 700, height: 600 }) };
  const active = computeActiveTurnId({
    visibleTurns: [{ id: "q75" }, { id: "q76" }],
    resolveTurn: (id) => ({ getBoundingClientRect: () => rects.get(id) }),
    container,
    activationOffset: 120
  });
  assert.equal(active, "q75");
});
test("hydration continuation waits for delayed virtual-window progress in one navigation", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const observers = [];
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  };
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 };
  let stage = 0;
  const ranges = [
    [31, 32],
    [27, 28],
    [23, 24],
    [19, 20],
    [16, 17]
  ];
  const turnAdapter = {
    resolveTurn: (id) => stage >= 4 && (id === "q17" || id === "fallback-turn-16") ? target : null,
    verifyTurnElement: (_id, element) => element === target,
    getVisibleTurns: () => ranges[stage].map((order) => ({ id: `fallback-turn-${order}`, order }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.scrollHeight = 20000;
  container.clientHeight = 800;
  let physicalScrollTop = 12000;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalScrollTop,
    set: (value) => {
      physicalScrollTop = value;
      if (stage >= 4) return;
      window.setTimeout(() => {
        stage += 1;
        for (const observer of observers) if (observer.active) observer.callback([{ type: "childList", target: container }]);
      }, 5);
    },
    configurable: true
  });
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    maxHydrationSteps: 12,
    maxConsecutiveStalls: 3,
    hydrationWaitMs: 50,
    maxNavigationMs: 1000
  });
  const all = Array.from({ length: 50 }, (_, i) => ({ id: `q${i + 1}`, order: i }));
  const result = await nav.navigateToTurn("q17", { turns: all });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.ok(result.probes >= 4 && result.probes <= 8);
  assert.equal(stage, 4);
  assert.equal(hasTurnWindowProgress(16, [31, 32], [27, 28]), true);
  assert.equal(turnWindowDistance(16, [27, 28]), 11);
});

test("column-reverse ChatGPT Q1 can outlive the probe budget while hydration keeps progressing", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 240, left: 0, right: 800, width: 800, height: 80 };
  let stage = 0;
  const ranges = [[13, 14], [9, 10], [5, 6], [0, 1]];
  const turnAdapter = {
    resolveTurn: (id) => stage >= 3 && (id === "q1" || id === "fallback-turn-0") ? target : null,
    verifyTurnElement: (_id, element) => element === target,
    getVisibleTurns: () => ranges[Math.min(stage, 3)].map((order) => ({ id: `fallback-turn-${order}`, order }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.scrollHeight = 12000;
  container.clientHeight = 800;
  let wheelCalls = 0;
  container.dispatchEvent = (event) => { if (event?.type === "wheel") wheelCalls += 1; return true; };
  let physicalTop = -4000;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => {
      physicalTop = value;
      if (stage < 3) stage += 1;
    },
    configurable: true
  });
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "chatgpt-test", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true })
    },
    maxHydrationSteps: 2,
    maxConsecutiveStalls: 2,
    hydrationWaitMs: 5,
    workWheelWaitMs: 2,
    maxNavigationMs: 500,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const all = Array.from({ length: 20 }, (_, i) => ({ id: `q${i + 1}`, order: i }));
  const result = await nav.navigateToTurn("q1", { turns: all });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.ok(result.probes > 2);
  assert.equal(wheelCalls, 0);
});

test("hydration continuation stops after bounded consecutive stalls", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const turnAdapter = {
    resolveTurn: () => null,
    verifyTurnElement: () => false,
    getVisibleTurns: () => [{ id: "fallback-turn-31", order: 31 }, { id: "fallback-turn-32", order: 32 }]
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.scrollHeight = 12000;
  container.clientHeight = 800;
  container.scrollTop = 7000;
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    maxHydrationSteps: 20,
    maxConsecutiveStalls: 2,
    hydrationWaitMs: 5,
    maxNavigationMs: 200
  });
  const all = Array.from({ length: 50 }, (_, i) => ({ id: `q${i + 1}`, order: i }));
  const result = await nav.navigateToTurn("q17", { turns: all });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hydration-stalled");
  assert.equal(result.stalls, 2);
  assert.ok(result.probes <= 20);
  assert.deepEqual(result.visibleRange, { min: 31, max: 32 });
  assert.equal(hasTurnWindowProgress(16, [31, 32], [32, 33]), false);
});


test("navigation refreshes target order when dynamic TurnIndex reindexes during hydration", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  const inserted = ["inserted-a", "inserted-b"];
  let stage = 0;
  let getTurnsCalls = 0;
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 240, left: 0, right: 800, width: 800, height: 80 };
  const getTurns = () => {
    getTurnsCalls += 1;
    if (stage === 0) return ids.map((id, order) => ({ id, order }));
    return [
      ...inserted.map((id, order) => ({ id, order })),
      ...ids.map((id, order) => ({ id, order: order + inserted.length }))
    ];
  };
  const ranges = [[36, 37, 38, 39], [20, 21, 22, 23], [0, 1, 2, 3]];
  const turnAdapter = {
    resolveTurn: (id) => stage >= 2 && id === ids[0] ? target : null,
    verifyTurnElement: (id, element) => id === ids[0] && element === target,
    getVisibleTurns: () => ranges[Math.min(stage, 2)].map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 240, left: 0, right: 800, width: 800, height: 200 };
  container.clientHeight = 200;
  container.scrollHeight = 1800;
  container.scrollTop = 0;
  container.dispatchEvent = (event) => {
    if (event?.type === "wheel" && stage < 2) {
      stage += 1;
      container.scrollHeight += 600;
    }
    return true;
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelStepPx: 200,
    workWheelWaitMs: 2,
    maxNavigationMs: 1000,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[0], { turns: getTurns(), getTurns });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.targetOrder, 2);
  assert.equal(stage, 2);
  assert.ok(getTurnsCalls > 3);
});

test("long reverse Work uses monotonic wheel-progressive hydration for earlier history", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  const ranges = [[36, 37, 38, 39], [28, 29, 30, 31], [20, 21, 22, 23], [0, 1, 2, 3]];
  let stage = 0;
  let compatCalls = 0;
  const wheelDeltas = [];
  window.__codexThreadScrollHandlers = { markPointerIntent(event) { if (event?.target) compatCalls += 1; } };
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 240, left: 0, right: 800, width: 800, height: 80 };
  const turnAdapter = {
    resolveTurn: (id) => stage >= 3 && id === ids[0] ? target : null,
    verifyTurnElement: (id, element) => id === ids[0] && element === target,
    getVisibleTurns: () => ranges[stage].map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 240, left: 0, right: 800, width: 800, height: 200 };
  container.clientHeight = 200;
  container.scrollHeight = 1800;
  let physicalTop = 0;
  const writes = [];
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; writes.push(value); },
    configurable: true
  });
  container.dispatchEvent = (event) => {
    if (event?.type === "wheel") {
      wheelDeltas.push(event.deltaY);
      if (stage < 3) {
        stage += 1;
        container.scrollHeight += 600;
      }
    }
    return true;
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelStepPx: 200,
    workWheelWaitMs: 2,
    maxNavigationMs: 1000,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[0], {
    turns: ids.map((id, order) => ({ id, order }))
  });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(stage, 3);
  assert.equal(compatCalls, 1);
  assert.ok(wheelDeltas.length >= 3);
  assert.ok(wheelDeltas.every((value) => value < 0));
  assert.ok(writes.every((value, index) => index === 0 || value <= writes[index - 1]));
});

test("long forward Work uses wheel-progressive hydration for later history", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  const ranges = [[0, 1, 2, 3], [8, 9, 10, 11], [20, 21, 22, 23], [36, 37, 38, 39]];
  let stage = 0;
  let compatCalls = 0;
  const wheelDeltas = [];
  window.__codexThreadScrollHandlers = { markPointerIntent(event) { if (event?.target) compatCalls += 1; } };
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 240, left: 0, right: 800, width: 800, height: 80 };
  const turnAdapter = {
    resolveTurn: (id) => stage >= 3 && id === ids[39] ? target : null,
    verifyTurnElement: (id, element) => id === ids[39] && element === target,
    getVisibleTurns: () => ranges[stage].map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 240, left: 0, right: 800, width: 800, height: 200 };
  container.clientHeight = 200;
  container.scrollHeight = 1800;
  let physicalTop = -1600;
  const writes = [];
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; writes.push(value); },
    configurable: true
  });
  container.dispatchEvent = (event) => {
    if (event?.type === "wheel") {
      wheelDeltas.push(event.deltaY);
      if (stage < 3) stage += 1;
    }
    return true;
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelStepPx: 200,
    workWheelWaitMs: 2,
    hydrationWaitMs: 20,
    maxNavigationMs: 1000,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const trace = [];
  const result = await nav.navigateToTurn(ids[39], {
    turns: ids.map((id, order) => ({ id, order })),
    onTraceStep: (entry) => trace.push(entry)
  });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(stage, 3);
  assert.equal(compatCalls, 1);
  assert.ok(wheelDeltas.length >= 3);
  assert.ok(wheelDeltas.every((value) => value > 0));
  assert.ok(writes.every((value, index) => index === 0 || value >= writes[index - 1]));
  assert.ok(trace.some((entry) => entry.mode === "work-wheel" && entry.direction === 1));
});

test("reverse Work keeps moving through delayed DOM updates instead of failing after two wheel steps", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  let wheelSignals = 0;
  let compatCalls = 0;
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 240, left: 0, right: 800, width: 800, height: 80 };
  window.__codexThreadScrollHandlers = { markPointerIntent() { compatCalls += 1; } };
  const currentRange = () => wheelSignals >= 5 ? [0, 1, 2, 3] : wheelSignals >= 3 ? [20, 21, 22, 23] : [36, 37, 38, 39];
  const turnAdapter = {
    resolveTurn: (id) => wheelSignals >= 5 && id === ids[0] ? target : null,
    verifyTurnElement: (id, element) => id === ids[0] && element === target,
    getVisibleTurns: () => currentRange().map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 240, left: 0, right: 800, width: 800, height: 200 };
  container.clientHeight = 200;
  container.scrollHeight = 2200;
  let physicalTop = 0;
  const writes = [];
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; writes.push(value); },
    configurable: true
  });
  container.dispatchEvent = (event) => { if (event?.type === "wheel") wheelSignals += 1; return true; };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelStepPx: 200,
    workWheelWaitMs: 2,
    hydrationWaitMs: 20,
    maxNavigationMs: 1000,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[0], { turns: ids.map((id, order) => ({ id, order })) });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.ok(wheelSignals >= 5);
  assert.equal(compatCalls, 1);
  assert.ok(writes.every((value, index) => index === 0 || value <= writes[index - 1]));
});

test("Q4 to Q1 stays on the same reverse-wheel path until Q1 is mounted", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 8 }, (_, index) => `stable-${index}`);
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 220, left: 0, right: 800, width: 800, height: 60 };
  let wheelSignals = 0;
  let compatCalls = 0;
  window.__codexThreadScrollHandlers = { markPointerIntent() { compatCalls += 1; } };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 240, left: 0, right: 800, width: 800, height: 200 };
  container.clientHeight = 200;
  container.scrollHeight = 1000;
  let physicalTop = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; },
    configurable: true
  });
  container.dispatchEvent = (event) => { if (event?.type === "wheel") wheelSignals += 1; return true; };
  const turnAdapter = {
    resolveTurn: (id) => physicalTop <= -180 && id === ids[0] ? target : null,
    verifyTurnElement: (id, element) => id === ids[0] && element === target,
    getVisibleTurns: () => [3, 4, 5, 6].map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelWaitMs: 2,
    hydrationWaitMs: 20,
    maxNavigationMs: 500,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[0], { turns: ids.map((id, order) => ({ id, order })) });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.ok(wheelSignals >= 1);
  assert.equal(compatCalls, 1);
});

test("reverse Work fails closed only after reaching the loaded earlier boundary without structural progress", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `stable-${index}`);
  const turnAdapter = {
    resolveTurn: () => null,
    verifyTurnElement: () => false,
    getVisibleTurns: () => [20, 21, 22, 23].map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 240, left: 0, right: 800, width: 800, height: 200 };
  container.clientHeight = 200;
  container.scrollHeight = 1000;
  let physicalTop = -800;
  let wheelSignals = 0;
  const writes = [];
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; writes.push(value); },
    configurable: true
  });
  container.dispatchEvent = (event) => { if (event?.type === "wheel") wheelSignals += 1; return true; };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelWaitMs: 1,
    hydrationWaitMs: 15,
    maxNavigationMs: 500,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[0], { turns: ids.map((id, order) => ({ id, order })) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "work-wheel-stalled");
  assert.equal(result.stalls, 1);
  assert.equal(wheelSignals, 1);
  assert.deepEqual(writes, []);
});
test("hydration continuation treats scroll extent growth as progress before the turn window changes", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 200;
  container.scrollHeight = 1000;
  let physicalScrollTop = -800;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalScrollTop,
    set: (value) => { physicalScrollTop = value; },
    configurable: true
  });
  const turnAdapter = {
    resolveTurn: (id) => physicalScrollTop <= -1599 && (id === "q1" || id === "fallback-turn-0") ? target : null,
    verifyTurnElement: (_id, element) => element === target,
    getVisibleTurns: () => [{ id: "fallback-turn-10", order: 10 }, { id: "fallback-turn-11", order: 11 }]
  };
  window.setTimeout(() => { container.scrollHeight = 1400; }, 5);
  window.setTimeout(() => { container.scrollHeight = 1800; }, 25);
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    maxHydrationSteps: 10,
    maxConsecutiveStalls: 3,
    hydrationWaitMs: 80,
    maxNavigationMs: 1000,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const all = Array.from({ length: 20 }, (_, i) => ({ id: `q${i + 1}`, order: i }));
  const result = await nav.navigateToTurn("q1", { turns: all });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.ok(result.probes >= 1);
  const before = createHydrationSnapshot(0, [10, 11], { scrollHeight: 1000, clientHeight: 200, maxLogicalPosition: 800, logicalPosition: 0 });
  const afterExtent = createHydrationSnapshot(0, [10, 11], { scrollHeight: 1400, clientHeight: 200, maxLogicalPosition: 1200, logicalPosition: 400 });
  assert.equal(hasHydrationProgress(0, before, afterExtent, -1), true);
});

test("progress-renewed budget survives longer total navigation while progress continues", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const observers = [];
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  };
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 };
  let stage = 0;
  const ranges = [[36, 37], [30, 31], [24, 25], [18, 19], [10, 11], [0, 1]];
  const turnAdapter = {
    resolveTurn: (id) => stage >= 5 && (id === "q1" || id === "fallback-turn-0") ? target : null,
    verifyTurnElement: (_id, element) => element === target,
    getVisibleTurns: () => ranges[stage].map((order) => ({ id: "fallback-turn-" + order, order }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.scrollHeight = 30000;
  container.clientHeight = 800;
  let physicalScrollTop = 18000;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalScrollTop,
    set: (value) => {
      physicalScrollTop = value;
      if (stage >= 5) return;
      window.setTimeout(() => {
        stage += 1;
        for (const observer of observers) if (observer.active) observer.callback([{ type: "childList", target: container }]);
      }, 8);
    },
    configurable: true
  });
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    maxHydrationSteps: 50,
    maxConsecutiveStalls: 3,
    hydrationWaitMs: 40,
    inactivityNavigationMs: 15,
    absoluteMaxNavigationMs: 500,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0
  });
  const all = Array.from({ length: 38 }, (_, i) => ({ id: "q" + (i + 1), order: i }));
  const started = Date.now();
  const result = await nav.navigateToTurn("q1", { turns: all });
  const wallMs = Date.now() - started;
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(stage, 5);
  assert.ok(wallMs >= 30, "expected total navigation to outlive inactivity window, got " + wallMs + "ms");
});
test("post-settle verification corrects asynchronous drift before reporting success", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 5000;
  let physicalScrollTop = 1200;
  let corrections = 0;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalScrollTop,
    set: (value) => {
      physicalScrollTop = value;
      corrections += 1;
      target.rect = { top: 160, bottom: 260, left: 0, right: 800, width: 800, height: 100 };
    },
    configurable: true
  });
  const turnAdapter = {
    resolveTurn: (id) => (id === "q4" || id === "fallback-turn-3") ? target : null,
    verifyTurnElement: (_id, element) => element === target,
    getVisibleTurns: () => [{ id: "fallback-turn-3", order: 3 }]
  };
  window.setTimeout(() => {
    target.rect = { top: 310, bottom: 410, left: 0, right: 800, width: 800, height: 100 };
  }, 2);
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: { getScrollContainer: () => container },
    postSettleWaitMs: 8,
    maxPostSettleCorrections: 2
  });
  const result = await nav.navigateToTurn("q4", { turns: [{ id: "q1", order: 0 }, { id: "q2", order: 1 }, { id: "q3", order: 2 }, { id: "q4", order: 3 }] });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.ok(corrections >= 1);
  assert.ok(result.settleChecks >= 2);
});

test("Host contract reports a healthy conversation without requiring capture data", () => {
  const report = evaluateHostContract({
    surface: SURFACE.CONVERSATION,
    rendererScheme: "app:",
    conversationId: "abc",
    conversationRoot: {},
    scrollContainer: { scrollHeight: 2000, clientHeight: 700 },
    visibleTurns: [{ id: "fallback-turn-7" }, { id: "fallback-turn-8" }],
    composer: {},
    flexDirection: "column-reverse",
    captureInstalled: false,
    fetchAvailable: true
  });
  assert.equal(report.revision, HOST_CONTRACT_REVISION);
  assert.equal(report.status, "ready");
  assert.equal(report.scroll.status, "ready");
  assert.equal(report.turns.idMode, "fallback");
  assert.equal(report.navigation.status, "ready");
  assert.equal(report.capture.status, "optional-unavailable");
});

test("Host contract treats NEW_CHAT without conversation primitives as healthy when composer exists", () => {
  const report = evaluateHostContract({
    surface: SURFACE.NEW_CHAT,
    rendererScheme: "app:",
    composer: {}
  });
  assert.equal(report.status, "ready");
  assert.equal(report.conversation.required, false);
  assert.equal(report.scroll.required, false);
  assert.equal(report.composer.status, "ready");
});

test("Host contract fails closed when a conversation loses its scroll container", () => {
  const report = evaluateHostContract({
    surface: SURFACE.CONVERSATION,
    rendererScheme: "app:",
    conversationId: "abc",
    conversationRoot: {},
    scrollContainer: null,
    visibleTurns: [{ id: "fallback-turn-1" }],
    composer: {}
  });
  assert.equal(report.status, "unavailable");
  assert.equal(report.scroll.status, "unavailable");
  assert.equal(report.navigation.status, "unavailable");
});

test("Host contract marks a missing NEW_CHAT composer unavailable", () => {
  const report = evaluateHostContract({ surface: SURFACE.NEW_CHAT, rendererScheme: "app:" });
  assert.equal(report.status, "unavailable");
  assert.equal(report.composer.status, "unavailable");
});

test("Host contract does not treat a zero-turn virtualization transition as a hard failure", () => {
  const report = evaluateHostContract({
    surface: SURFACE.CONVERSATION,
    rendererScheme: "app:",
    conversationId: "abc",
    conversationRoot: {},
    scrollContainer: { scrollHeight: 2000, clientHeight: 700 },
    visibleTurns: [],
    composer: {},
    flexDirection: "column-reverse",
    captureInstalled: true,
    fetchAvailable: true
  });
  assert.equal(report.status, "ready");
  assert.equal(report.turns.status, "unknown");
  assert.equal(report.navigation.status, "unknown");
  assert.equal(report.capture.status, "ready");
});

test("Host contract classifies stable, fallback and mixed turn id modes", () => {
  assert.equal(classifyTurnIdMode([]), "unknown");
  assert.equal(classifyTurnIdMode([{ id: "fallback-turn-1" }]), "fallback");
  assert.equal(classifyTurnIdMode([{ id: "uuid-a" }, { id: "uuid-b" }]), "stable");
  assert.equal(classifyTurnIdMode([{ id: "fallback-turn-1" }, { id: "uuid-b" }]), "mixed");
});
// Auto official-bridge / Work active-line regression coverage.
test("CodexDesktopHost resolves an official marker key through a current turn DOM reference", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const node = new FakeElement("div");
  node.setAttribute("data-turn-id", "turn-q23");
  document.getElementById = (id) => id === "official-marker-q23" ? node : null;
  const host = new CodexDesktopHost({ document, window });
  assert.equal(host.resolveOfficialNavigationMarkerKey("official-marker-q23"), "turn-q23");
});

test("Local Work active tracking samples inside the target instead of the exact navigation edge", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const host = new CodexDesktopHost({ document, window });
  const container = new FakeElement("div");
  container.rect = { top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800 };
  container.style.flexDirection = "column";
  const q22 = new FakeElement("div"); q22.rect = { top: 80, bottom: 126, left: 0, right: 800, width: 800, height: 46 };
  const q23 = new FakeElement("div"); q23.rect = { top: 126, bottom: 176, left: 0, right: 800, width: 800, height: 50 };
  host.getVisibleTurns = () => [{ id: "q22" }, { id: "q23" }];
  host.resolveTurn = (id) => id === "q22" ? q22 : q23;
  host.getScrollContainer = () => container;
  host.getConversationIdentity = () => ({ id: "local:A", host: "local", source: "sidebar-local", stable: true, kind: "local" });
  assert.equal(host.getActiveTurnId(), "q23");
  host.getConversationIdentity = () => ({ id: "chat:A", host: "chatgpt", source: "sidebar-chatgpt", stable: true, kind: "conversation" });
  assert.equal(host.getActiveTurnId(), "q22");
});

test("CodexDesktopHost forwards explicit navigation intent to Codex++ scroll restore handlers", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const container = new FakeElement();
  container.isConnected = true;
  const calls = [];
  window.__codexThreadScrollHandlers = {
    markPointerIntent(event) { calls.push(event); }
  };
  const host = new CodexDesktopHost({ document, window });
  host.conversation.getScrollContainer = () => container;
  assert.equal(host.notifyNavigationIntent(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.target, container);
  assert.equal(calls[0]?.type, "pointerdown");
});