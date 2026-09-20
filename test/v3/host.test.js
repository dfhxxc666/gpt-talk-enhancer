import test from "node:test";
import assert from "node:assert/strict";
import { SURFACE } from "../../src/v3/host/host-interface.js";
import { ConversationCapture, matchConversationRequest, parseConversationPayload } from "../../src/v3/host/codex-desktop/conversation-capture.js";
import { TurnAdapter, TURN_ID_PRIORITY } from "../../src/v3/host/codex-desktop/turn-adapter.js";
import { WorkTurnAdapter } from "../../src/v3/host/codex-desktop/work-turn-adapter.js";
import { ConversationAdapter, isStableLocalThreadIdentity, parseSidebarConversationKey } from "../../src/v3/host/codex-desktop/conversation-adapter.js";
import { CodexDesktopHost, computeTailActiveTurnId } from "../../src/v3/host/codex-desktop/codex-host.js";
import { SurfaceDetector } from "../../src/v3/host/codex-desktop/surface-detector.js";
import { OverlayDetector } from "../../src/v3/host/codex-desktop/overlay-detector.js";
import { ComposerAdapter } from "../../src/v3/host/codex-desktop/composer-adapter.js";
import { NavigationAdapter, computeActiveTurnId, chooseHydrationDirection, hydrationStepSize, hydrationJumpScale, chatFarCoalescedJump, workWheelStepSize, rectInActivationZone, hasTurnWindowProgress, turnWindowDistance, createHydrationSnapshot, hasHydrationProgress } from "../../src/v3/host/codex-desktop/navigation-adapter.js";
import { WorkNavigationAdapter } from "../../src/v3/host/codex-desktop/work-navigation-adapter.js";
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


test("TurnAdapter marks explicit fallback order absolute and UUID fallback order window-local", () => {
  const document = new FakeDocument();
  const fallback = new FakeElement();
  fallback.setAttribute("data-turn-key", "fallback-turn-40");
  fallback.innerText = "absolute";
  const stable = new FakeElement();
  stable.setAttribute("data-turn-key", "550e8400-e29b-41d4-a716-446655440000");
  stable.innerText = "window";
  document.setSelector("[data-markdown-text-tone='user-message']", [fallback, stable]);
  const adapter = new TurnAdapter({ document, clock: () => 42 });
  const turns = adapter.getVisibleTurns();
  const absolute = turns.find((turn) => turn.id === "fallback-turn-40");
  const windowLocal = turns.find((turn) => turn.id === "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(absolute.order, 40);
  assert.equal(absolute.orderTrust, "absolute");
  assert.equal(absolute.windowOrder, 0);
  assert.equal(windowLocal.order, 1);
  assert.equal(windowLocal.orderTrust, "window");
  assert.equal(windowLocal.windowOrder, 1);
});

test("TurnAdapter discovers explicit data-turn user containers without legacy user-message markers", () => {
  const document = new FakeDocument();
  const wrapper = new FakeElement();
  wrapper.setAttribute("data-content-search-turn-key", "uuid-explicit-user");
  const user = new FakeElement();
  user.setAttribute("data-turn", "user");
  user.innerText = "explicit user turn";
  user.closest = (selector) => selector === "[data-content-search-turn-key]" ? wrapper : null;
  document.setSelector("[data-turn='user']", [user]);
  const adapter = new TurnAdapter({ document, clock: () => 42 });
  const turns = adapter.getVisibleTurns();
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "uuid-explicit-user");
  assert.equal(turns[0].text, "explicit user turn");
});

test("TurnAdapter keeps attachment-only explicit user turns with a stable placeholder", () => {
  const document = new FakeDocument();
  const wrapper = new FakeElement();
  wrapper.setAttribute("data-content-search-turn-key", "uuid-attachment-user");
  const user = new FakeElement();
  user.setAttribute("data-turn", "user");
  user.innerText = "";
  user.childElementCount = 1;
  user.closest = (selector) => selector === "[data-content-search-turn-key]" ? wrapper : null;
  document.setSelector("[data-turn='user']", [user]);
  const adapter = new TurnAdapter({ document, clock: () => 42 });
  const turns = adapter.getVisibleTurns();
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "uuid-attachment-user");
  assert.equal(turns[0].text, "[图片或文件]");
});
test("TurnAdapter discovers image-only fallback question shells without user markers", () => {
  const document = new FakeDocument();
  const shell = new FakeElement();
  shell.setAttribute("data-turn-key", "fallback-turn-2");
  shell.innerText = "assistant text must not become question text";
  shell.querySelector = (selector) => selector === "img" ? new FakeElement("img") : null;
  document.setSelector("[data-turn-key^='fallback-turn-']", [shell]);
  const turns = new TurnAdapter({ document, clock: () => 42 }).getVisibleTurns();
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "fallback-turn-2");
  assert.equal(turns[0].order, 2);
  assert.equal(turns[0].orderTrust, "absolute");
  assert.equal(turns[0].text, "[图片或文件]");
});

test("TurnAdapter keeps semantic user text when a fallback question shell also contains media", () => {
  const document = new FakeDocument();
  const shell = new FakeElement();
  shell.setAttribute("data-turn-key", "fallback-turn-3");
  shell.querySelector = (selector) => selector === "img" ? new FakeElement("img") : null;
  const user = new FakeElement();
  user.setAttribute("data-markdown-text-tone", "user-message");
  user.innerText = "real user text";
  user.closest = (selector) => selector === "[data-turn-key]" ? shell : null;
  document.setSelector("[data-markdown-text-tone='user-message']", [user]);
  document.setSelector("[data-turn-key^='fallback-turn-']", [shell]);
  const turns = new TurnAdapter({ document, clock: () => 42 }).getVisibleTurns();
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "fallback-turn-3");
  assert.equal(turns[0].text, "real user text");
});

test("TurnAdapter assigns mixed-selector user turns window order from DOM order", () => {
  const document = new FakeDocument();
  const firstWrapper = new FakeElement();
  firstWrapper.setAttribute("data-content-search-turn-key", "uuid-first");
  const secondWrapper = new FakeElement();
  secondWrapper.setAttribute("data-content-search-turn-key", "uuid-second");
  const first = new FakeElement();
  first.setAttribute("data-markdown-text-tone", "user-message");
  first.innerText = "first";
  first.closest = (selector) => selector === "[data-content-search-turn-key]" ? firstWrapper : null;
  const second = new FakeElement();
  second.setAttribute("data-turn", "user");
  second.innerText = "second";
  second.closest = (selector) => selector === "[data-content-search-turn-key]" ? secondWrapper : null;
  first.compareDocumentPosition = (other) => other === second ? 4 : 0;
  second.compareDocumentPosition = (other) => other === first ? 2 : 0;
  document.setSelector("[data-turn='user']", [second]);
  document.setSelector("[data-markdown-text-tone='user-message']", [first]);
  const turns = new TurnAdapter({ document, clock: () => 42 }).getVisibleTurns();
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  assert.equal(byId.get("uuid-first")?.windowOrder, 0);
  assert.equal(byId.get("uuid-second")?.windowOrder, 1);
});
test("TurnAdapter exposes visualOrder independently from reverse DOM window order", () => {
  const document = new FakeDocument();
  const q2Wrapper = new FakeElement();
  q2Wrapper.setAttribute("data-content-search-turn-key", "uuid-q2");
  const q1Wrapper = new FakeElement();
  q1Wrapper.setAttribute("data-content-search-turn-key", "uuid-q1");

  const q2 = new FakeElement();
  q2.setAttribute("data-turn", "user");
  q2.innerText = "Q2";
  q2.rect = { top: 320, bottom: 380, left: 0, right: 500, width: 500, height: 60 };
  q2.closest = (selector) => selector === "[data-content-search-turn-key]" ? q2Wrapper : null;

  const q1 = new FakeElement();
  q1.setAttribute("data-markdown-text-tone", "user-message");
  q1.innerText = "Q1";
  q1.rect = { top: 180, bottom: 240, left: 0, right: 500, width: 500, height: 60 };
  q1.closest = (selector) => selector === "[data-content-search-turn-key]" ? q1Wrapper : null;

  q2.compareDocumentPosition = (other) => other === q1 ? 4 : 0;
  q1.compareDocumentPosition = (other) => other === q2 ? 2 : 0;
  document.setSelector("[data-turn='user']", [q2]);
  document.setSelector("[data-markdown-text-tone='user-message']", [q1]);

  const turns = new TurnAdapter({ document, clock: () => 42 }).getVisibleTurns();
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  assert.equal(byId.get("uuid-q2")?.windowOrder, 0);
  assert.equal(byId.get("uuid-q1")?.windowOrder, 1);
  assert.equal(byId.get("uuid-q1")?.visualOrder, 0);
  assert.equal(byId.get("uuid-q2")?.visualOrder, 1);
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

test("ConversationAdapter uses inferred pinned Chat identity only when direct identity is unavailable", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const root = new FakeElement();
  root.rect = { top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 };
  const user = new FakeElement();
  const rootSelector = "[data-thread-find-target='conversation']";
  const contentSelector = "[data-markdown-text-tone='user-message'], [data-turn-key], [data-content-search-turn-key], [data-turn-id], [data-turn-id-container]";
  document.setSelector(rootSelector, root);
  document.setSelector(contentSelector, user);
  const adapter = new ConversationAdapter({ document, window });
  assert.equal(adapter.setInferredChatConversationId("chatgpt:conversation:inferred-chat"), true);
  assert.deepEqual(adapter.getConversationIdentity(), {
    id: "inferred-chat", source: "inferred-visible-chat", host: "chatgpt", kind: "conversation", stable: true
  });
  window.location.pathname = "/c/direct-chat";
  assert.deepEqual(adapter.getConversationIdentity(), {
    id: "direct-chat", source: "route", host: "chatgpt", kind: "conversation", stable: true
  });
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

test("WorkTurnAdapter stays isolated from Chat-only media fallback and order metadata", () => {
  const document = new FakeDocument();
  const shell = new FakeElement();
  shell.setAttribute("data-turn-key", "fallback-turn-9");
  shell.querySelector = (selector) => selector === "img" ? new FakeElement("img") : null;
  document.setSelector("[data-turn-key^='fallback-turn-']", [shell]);
  const work = new WorkTurnAdapter({ document, clock: () => 42 });
  assert.deepEqual(work.getVisibleTurns(), []);

  const message = new FakeElement();
  message.setAttribute("data-content-search-turn-key", "01a057ce-32ff-75b3-83fb-4179df90399f");
  message.innerText = "work question";
  document.setSelector("[data-markdown-text-tone='user-message']", [message]);
  const [turn] = work.getVisibleTurns();
  assert.equal(turn.id, "01a057ce-32ff-75b3-83fb-4179df90399f");
  assert.equal(Object.hasOwn(turn, "orderTrust"), false);
  assert.equal(Object.hasOwn(turn, "windowOrder"), false);
});

test("CodexDesktopHost hard-routes Chat and Work to separate turn adapters", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const shell = new FakeElement();
  shell.setAttribute("data-turn-key", "fallback-turn-2");
  shell.querySelector = (selector) => selector === "img" ? new FakeElement("img") : null;
  document.setSelector("[data-turn-key^='fallback-turn-']", [shell]);
  const host = new CodexDesktopHost({ document, window });
  assert.notEqual(host.chatTurns, host.workTurns);
  host.conversation.getConversationIdentity = () => ({ id: "chat-a", host: "chatgpt", source: "sidebar-chatgpt", stable: true });
  host.conversation.getConversationId = () => "chat-a";
  assert.equal(host.getTurnAdapter(), host.chatTurns);
  assert.equal(host.getVisibleTurns().length, 1);

  host.conversation.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", host: "local", source: "sidebar-local", stable: true, kind: "local" });
  host.conversation.getConversationId = () => "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  assert.equal(host.getTurnAdapter(), host.workTurns);
  assert.equal(host.getVisibleTurns().length, 0);
});

test("CodexDesktopHost hard-routes Chat and Work to separate navigation adapters", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const host = new CodexDesktopHost({ document, window });
  assert.notEqual(host.chatNavigation, host.workNavigation);
  assert.equal(host.chatNavigation.turnAdapter, host.chatTurns);
  assert.equal(host.workNavigation.turnAdapter, host.workTurns);
  const calls = [];
  host.chatNavigation.navigateToTurn = async () => { calls.push("chat"); return { ok: true, verified: true }; };
  host.workNavigation.navigateToTurn = async () => { calls.push("work"); return { ok: true, verified: true }; };

  host.conversation.getConversationIdentity = () => ({ id: "chat-a", host: "chatgpt", source: "sidebar-chatgpt", stable: true });
  host.conversation.getConversationId = () => "chat-a";
  await host.navigateToTurn("q1");

  host.conversation.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", host: "local", source: "sidebar-local", stable: true, kind: "local" });
  host.conversation.getConversationId = () => "local:01a057ce-32ff-75b3-83fb-4179df90399f";
  await host.navigateToTurn("q1");
  assert.deepEqual(calls, ["chat", "work"]);
});

test("CodexDesktopHost keeps the last stable host mode through a transient identity gap", () => {
  const host = new CodexDesktopHost({ document: new FakeDocument(), window: fakeWindow() });
  let identity = { id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", host: "local", source: "sidebar-local", stable: true, kind: "local" };
  let id = identity.id;
  host.conversation.getConversationIdentity = () => identity;
  host.conversation.getConversationId = () => id;
  assert.equal(host.getHostMode(), "work");
  identity = null;
  id = null;
  assert.equal(host.getHostMode(), "work");
  assert.equal(host.getTurnAdapter(), host.workTurns);
  assert.equal(host.getNavigationAdapter(), host.workNavigation);
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

test("Local regular hydration keeps the default motion gate", async () => {
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
    conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ host: "local", source: "sidebar-local" }) },
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

test("Work Earlier wheel step adapts to distance while preserving short-history and boundary safety", () => {
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 10, targetDistance: 60, logicalPosition: 5000 }), 400);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 40, targetDistance: 10, logicalPosition: 5000 }), 720);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 40, targetDistance: 30, logicalPosition: 5000 }), 864);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 80, targetDistance: 60, logicalPosition: 5000 }), 972);
  assert.equal(workWheelStepSize({ configuredStep: 720, viewport: 800, turnCount: 80, targetDistance: 60, logicalPosition: 500 }), 500);
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
test("Chat navigation ignores window-local UUID orders unless the global index knows them", () => {
  const turnAdapter = {
    getVisibleTurns: () => [
      { id: "uuid-window-a", order: 0, orderTrust: "window" },
      { id: "uuid-known", order: 1, orderTrust: "window" },
      { id: "fallback-turn-40", order: 40, orderTrust: "absolute" }
    ]
  };
  const nav = new NavigationAdapter({
    window: fakeWindow(),
    turnAdapter,
    conversationAdapter: {
      getConversationIdentity: () => ({ host: "chatgpt", source: "sidebar-chatgpt" })
    }
  });
  assert.deepEqual(nav.readVisibleOrders(new Map([["uuid-known", 55]])), [40, 55]);
});

test("Chat Earlier keeps its direction through unknown UUID windows until the target mounts", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 240, left: 0, right: 800, width: 800, height: 80 };
  const windows = [
    ["uuid-a1", "uuid-a2"],
    ["uuid-b1", "uuid-b2"],
    ["uuid-c1", "uuid-c2"],
    ["target-q3", "uuid-d2"]
  ];
  let stage = 0;
  const turnAdapter = {
    resolveTurn: (id) => stage >= 3 && id === "target-q3" ? target : null,
    verifyTurnElement: (id, element) => id === "target-q3" && element === target,
    getVisibleTurns: () => windows[stage].map((id, order) => ({ id, order, orderTrust: "window" }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 12000;
  let physicalTop = 0;
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
      getConversationIdentity: () => ({ id: "chat-a", host: "chatgpt", source: "sidebar-chatgpt", stable: true })
    },
    maxHydrationSteps: 8,
    maxConsecutiveStalls: 2,
    hydrationWaitMs: 10,
    chatMotionProgressWaitMs: 1,
    postSettleWaitMs: 0,
    maxPostSettleCorrections: 0,
    maxNavigationMs: 500
  });
  const turns = Array.from({ length: 70 }, (_, order) => ({ id: order === 2 ? "target-q3" : `known-${order}`, order }));
  const result = await nav.navigateToTurn("target-q3", { turns });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.equal(stage, 3);
  assert.ok(result.steps.length >= 3);
  assert.ok(result.steps.every((step) => step.direction === -1));
});

test("Chat unknown UUID window replacement counts as structural hydration progress", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  let stage = 0;
  const windows = [
    ["uuid-a1", "uuid-a2"],
    ["uuid-b1", "uuid-b2"]
  ];
  const turnAdapter = {
    resolveTurn: () => null,
    verifyTurnElement: () => false,
    getVisibleTurns: () => windows[stage].map((id, order) => ({ id, order, orderTrust: "window" }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 840, left: 0, right: 800, width: 800, height: 800 };
  container.clientHeight = 800;
  container.scrollHeight = 12000;
  container.scrollTop = -11200;
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ host: "chatgpt", source: "sidebar-chatgpt" })
    },
    hydrationWaitMs: 40
  });
  const before = nav.readHydrationSnapshot(container, 2, new Map());
  window.setTimeout(() => { stage = 1; }, 5);
  const outcome = await nav.awaitHydrationProgress({
    turnId: "target-q3",
    targetOrder: 2,
    previousSnapshot: before,
    direction: -1,
    container,
    isCurrent: () => true,
    orderById: new Map(),
    waitMs: 40,
    allowMotionProgress: false
  });
  assert.equal(outcome.state, "progress", JSON.stringify(outcome));
  assert.equal(outcome.progressed, true);
});

test("Restored v0.5.2 Work Later uses positive wheel hydration on the isolated Work navigator", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 40 }, (_, index) => `work-${index}`);
  const ranges = [[0,1,2,3],[8,9,10,11],[20,21,22,23],[36,37,38,39]];
  let stage = 0;
  const wheelDeltas = [];
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
  Object.defineProperty(container, "scrollTop", { get: () => physicalTop, set: (value) => { physicalTop = value; }, configurable: true });
  container.dispatchEvent = (event) => { if (event?.type === "wheel") { wheelDeltas.push(event.deltaY); if (stage < 3) stage += 1; } return true; };
  window.__codexThreadScrollHandlers = { markPointerIntent() {} };
  const nav = new WorkNavigationAdapter({
    window, turnAdapter,
    conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true }) },
    workWheelStepPx: 200, workWheelWaitMs: 2, hydrationWaitMs: 20, maxNavigationMs: 1000, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const result = await nav.navigateToTurn(ids[39], { turns: ids.map((id, order) => ({ id, order })) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.ok(wheelDeltas.length >= 3);
  assert.ok(wheelDeltas.every((value) => value > 0));
});

test("Restored Work tail backtracks from physical bottom to the final user turn", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const ids = Array.from({ length: 71 }, (_, index) => `work-tail-${index}`);
  let backtracks = 0;
  const target = new FakeElement();
  target.rect = { top: 160, bottom: 240, left: 0, right: 800, width: 800, height: 80 };
  const turnAdapter = {
    resolveTurn: (id) => backtracks >= 3 && id === ids[70] ? target : null,
    verifyTurnElement: (id, element) => id === ids[70] && element === target,
    getVisibleTurns: () => (backtracks >= 3 ? [67,68,69,70] : [60,61,62,63,64,65,66,67,68,69]).map((globalOrder, localOrder) => ({ id: ids[globalOrder], order: localOrder }))
  };
  const container = new FakeElement();
  container.rect = { top: 40, bottom: 240, left: 0, right: 800, width: 800, height: 200 };
  container.clientHeight = 200;
  container.scrollHeight = 6400;
  let physicalTop = 0;
  Object.defineProperty(container, "scrollTop", { get: () => physicalTop, set: (value) => { physicalTop = value; }, configurable: true });
  container.dispatchEvent = (event) => { if (event?.type === "wheel" && event.deltaY < 0) backtracks += 1; return true; };
  window.__codexThreadScrollHandlers = { markPointerIntent() {} };
  const nav = new WorkNavigationAdapter({
    window, turnAdapter,
    conversationAdapter: { getScrollContainer: () => container, getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true }) },
    workWheelStepPx: 200, workWheelWaitMs: 2, hydrationWaitMs: 20, maxNavigationMs: 1000, postSettleWaitMs: 0, maxPostSettleCorrections: 0
  });
  const trace = [];
  const result = await nav.navigateToTurn(ids[70], { turns: ids.map((id, order) => ({ id, order })), onTraceStep: (entry) => trace.push(entry) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.verified, true);
  assert.equal(backtracks, 3);
  assert.ok(trace.some((entry) => entry.mode === "work-tail-backtrack" && entry.direction === -1));
});

test("CodexDesktopHost restored navigation intent uses only the active Work navigator", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const host = new CodexDesktopHost({ document, window });
  const container = new FakeElement();
  container.isConnected = true;
  host.conversation.getScrollContainer = () => container;
  host.conversation.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", source: "sidebar-local", host: "local", kind: "local", stable: true });
  let workCalls = 0;
  let chatCalls = 0;
  host.workNavigation.notifyCodexPlusScrollIntent = (received) => { if (received === container) workCalls += 1; return true; };
  host.chatNavigation.notifyCodexPlusScrollIntent = () => { chatCalls += 1; return true; };
  assert.equal(host.notifyNavigationIntent(), true);
  assert.equal(workCalls, 1);
  assert.equal(chatCalls, 0);
});

test("ComposerAdapter restored v0.5.2 anchor rejects a page-sized form", () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  const pageForm = new FakeElement("form");
  pageForm.rect = { left: 240, top: 0, right: 1327, bottom: 820, width: 1087, height: 820 };
  const local = new FakeElement("div");
  local.rect = { left: 415, top: 690, right: 1150, bottom: 770, width: 735, height: 80 };
  const composer = new FakeElement("textarea");
  composer.rect = { left: 438, top: 715, right: 1110, bottom: 755, width: 672, height: 40 };
  pageForm.append(local); local.append(composer);
  composer.closest = (selector) => selector === "form" ? pageForm : null;
  document.setSelector("#prompt-textarea", composer);
  const adapter = new ComposerAdapter({ document, window });
  assert.equal(adapter.getComposerForm(), local);
});

test("OverlayDetector restored v0.5.2 blocks visible host dialog", () => {
  const document = new FakeDocument();
  const dialog = new FakeElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.rect = { left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 };
  document.setSelector("[role='dialog']", dialog);
  const detector = new OverlayDetector({ document });
  assert.equal(detector.isBlockingDialogOpen(), true);
});


test("Chat Load All history hydrator reaches the true top across lazy-loaded batches", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column" });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 240;
  container.scrollHeight = 1040;
  let scrollTop = 400;
  Object.defineProperty(container, "scrollTop", {
    get: () => scrollTop,
    set: (value) => { scrollTop = value; },
    configurable: true
  });
  let batches = 0;
  let visibleCount = 4;
  const nativeSetTimeout = setTimeout;
  window.setTimeout = (callback, delayMs) => nativeSetTimeout(() => {
    if (Number(delayMs) === 4 && scrollTop === 0 && batches < 2) {
      batches += 1;
      visibleCount += 3;
      container.scrollHeight += 300;
      scrollTop = 300;
    }
    callback();
  }, 0);
  window.clearTimeout = clearTimeout;
  const turnAdapter = {
    getVisibleTurns: () => Array.from({ length: visibleCount }, (_, index) => ({ id: `chat-${index}`, order: index, orderTrust: "absolute" })),
    resolveTurn: () => null,
    verifyTurnElement: () => false
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "chat-a", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true })
    },
    hydrationWaitMs: 1,
    chatBoundaryHydrationWaitMs: 4
  });
  let progress = 0;
  const result = await nav.hydrateEarlierHistory({
    isCurrent: () => true,
    maxSteps: 20,
    maxBoundaryStalls: 2,
    onProgress: () => { progress += 1; }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reason, "earlier-boundary-exhausted");
  assert.equal(batches, 2);
  assert.ok(progress >= 2);
  assert.equal(scrollTop, 0);
});

test("Chat loaded-history sweep covers the full column-reverse range with bounded viewport steps", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 700;
  container.scrollHeight = 4900;
  container.scrollTop = -4200;
  const maxLogical = 4200;
  const samples = [];
  const turnAdapter = {
    getVisibleTurns: () => {
      const logical = Math.max(0, Math.min(maxLogical, maxLogical + Number(container.scrollTop || 0)));
      const bucket = Math.min(8, Math.floor(logical / 525));
      return [
        { id: "sweep-q-" + (bucket + 1), order: bucket, orderTrust: "absolute" },
        { id: "sweep-q-" + (bucket + 2), order: bucket + 1, orderTrust: "absolute" }
      ];
    },
    resolveTurn: () => null,
    verifyTurnElement: () => false
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "chat-sweep", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true })
    },
    hydrationWaitMs: 1
  });

  const result = await nav.sweepLoadedChatHistory({
    isCurrent: () => true,
    stepRatio: 0.75,
    settleWaitMs: 0,
    onWindow: ({ logicalPosition, turns }) => samples.push({ logicalPosition, ids: turns.map((turn) => turn.id) })
  });

  assert.equal(result.reason, "sweep-complete");
  assert.equal(result.ok, true);
  assert.ok(samples.length >= 8);
  assert.equal(samples[0].logicalPosition, 0);
  assert.equal(samples.at(-1).logicalPosition, maxLogical);
  for (let i = 1; i < samples.length; i += 1) {
    assert.ok(samples[i].logicalPosition >= samples[i - 1].logicalPosition);
    assert.ok(samples[i].logicalPosition - samples[i - 1].logicalPosition <= 700 * 0.75 + 1);
  }
});

test("Chat loaded-history sweep tolerates a transient null identity only when the caller still owns the operation", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 700;
  container.scrollHeight = 700;
  container.scrollTop = 0;
  const turnAdapter = {
    getVisibleTurns: () => [
      { id: "12345678-1234-4234-8234-000000000001", order: 0, orderTrust: "window", text: "Q1" }
    ],
    resolveTurn: () => null,
    verifyTurnElement: () => false
  };
  const conversationAdapter = {
    getScrollContainer: () => container,
    getConversationIdentity: () => null
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter,
    hydrationWaitMs: 1
  });

  const owned = await nav.sweepLoadedChatHistory({
    isCurrent: () => true,
    settleWaitMs: 0
  });
  assert.equal(owned.reason, "sweep-complete");
  assert.equal(owned.ok, true);

  const rejected = await nav.sweepLoadedChatHistory({
    isCurrent: () => false,
    settleWaitMs: 0
  });
  assert.equal(rejected.reason, "not-chat");
  assert.equal(rejected.ok, false);
});

test("Chat history hydrator advances on early structural progress without waiting the full boundary ceiling", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column" });
  let fakeNow = 0;
  window.performance = { now: () => fakeNow };
  const delays = [];
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 240;
  container.scrollHeight = 1000;
  container.scrollTop = 0;
  let visibleCount = 2;
  let pollCount = 0;
  window.setTimeout = (callback, ms) => {
    const delayMs = Number(ms) || 0;
    delays.push(delayMs);
    fakeNow += delayMs;
    if (delayMs === 5) {
      pollCount += 1;
      if (pollCount === 2) {
        visibleCount = 3;
        container.scrollHeight = 1200;
      }
    }
    callback();
    return 1;
  };
  window.clearTimeout = () => {};
  const turnAdapter = {
    getVisibleTurns: () => Array.from({ length: visibleCount }, (_, index) => ({
      id: "chat-fast-" + index,
      order: index,
      orderTrust: "absolute"
    })),
    resolveTurn: () => null,
    verifyTurnElement: () => false
  };
  const nav = new NavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "chat-fast", source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true })
    },
    hydrationWaitMs: 1,
    chatBoundaryHydrationWaitMs: 40
  });

  const result = await nav.hydrateEarlierHistory({
    isCurrent: () => true,
    maxSteps: 4,
    maxBoundaryStalls: 1,
    boundaryWaitMs: 40,
    boundaryPollMs: 5
  });

  assert.equal(result.reason, "earlier-boundary-exhausted");
  assert.ok(pollCount >= 2);
  assert.deepEqual(delays.slice(0, 2), [5, 5]);
  assert.equal(delays.includes(40), false);
});

test("Work history hydrator keeps sending Earlier wheel across lazy-loaded batches until the true top", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 240;
  container.scrollHeight = 1040;
  let physicalTop = -800;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; },
    configurable: true
  });
  let batches = 0;
  let visibleCount = 4;
  const wheelDeltas = [];
  const turnAdapter = {
    getVisibleTurns: () => Array.from({ length: visibleCount }, (_, index) => ({ id: `work-history-${index}`, order: index })),
    resolveTurn: () => null,
    verifyTurnElement: () => false
  };
  container.dispatchEvent = (event) => {
    if (event?.type !== "wheel") return true;
    wheelDeltas.push(event.deltaY);
    const max = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
    const logical = Math.max(0, Math.min(max, max + Number(physicalTop)));
    if (event.deltaY < 0 && logical <= 24 && batches < 2) {
      batches += 1;
      visibleCount += 4;
      container.scrollHeight += 400;
    }
    return true;
  };
  window.__codexThreadScrollHandlers = { markPointerIntent() {} };
  const nav = new WorkNavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelStepPx: 240,
    workWheelWaitMs: 1,
    hydrationWaitMs: 4
  });
  assert.equal(nav.isEarlierBoundary(), true);
  let progressEvents = 0;
  const result = await nav.hydrateEarlierHistory({
    maxSteps: 24,
    maxBoundaryStalls: 2,
    isCurrent: () => true,
    onProgress: () => { progressEvents += 1; }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reason, "earlier-boundary-exhausted");
  assert.equal(batches, 2);
  assert.ok(progressEvents >= 2);
  assert.ok(wheelDeltas.length >= 4);
  assert.ok(wheelDeltas.every((delta) => delta < 0));
});


test("Work history hydrator can start away from the Earlier boundary after explicit intent", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 240;
  container.scrollHeight = 1040;
  let physicalTop = -400;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; },
    configurable: true
  });
  let batches = 0;
  const turnAdapter = {
    getVisibleTurns: () => [{ id: "work-earliest", order: 0 }],
    resolveTurn: () => null,
    verifyTurnElement: () => false
  };
  container.dispatchEvent = (event) => {
    if (event?.type !== "wheel") return true;
    const max = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
    const logical = Math.max(0, Math.min(max, max + Number(physicalTop)));
    if (event.deltaY < 0 && logical <= 24 && batches < 1) {
      batches += 1;
      container.scrollHeight += 400;
    }
    return true;
  };
  window.__codexThreadScrollHandlers = { markPointerIntent() {} };
  const nav = new WorkNavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelStepPx: 240,
    workWheelWaitMs: 1,
    hydrationWaitMs: 4
  });
  assert.equal(nav.isEarlierBoundary(), false);
  const result = await nav.hydrateEarlierHistory({ maxSteps: 16, maxBoundaryStalls: 2, isCurrent: () => true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(batches, 1);
  assert.equal(result.reason, "earlier-boundary-exhausted");
});

test("CodexDesktopHost protects the official Work scroll-to-bottom button from Codex++ restore rebound", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const host = new CodexDesktopHost({ document, window });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 800;
  container.scrollHeight = 6400;
  container.rect = { left: 240, right: 1240, top: 80, bottom: 760, width: 1000, height: 680 };
  let physicalTop = -2800;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; },
    configurable: true
  });
  host.conversation.getScrollContainer = () => container;
  host.conversation.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", source: "sidebar-local", host: "local", kind: "local", stable: true });
  let intentCalls = 0;
  let saveCalls = 0;
  window.__codexThreadScrollHandlers = {
    markPointerIntent() { intentCalls += 1; },
    saveNow() { saveCalls += 1; }
  };
  const button = new FakeElement("button");
  button.rect = { left: 720, right: 760, top: 650, bottom: 690, width: 40, height: 40 };
  assert.equal(host.handleHostPointerDown({ target: button }), true);
  physicalTop = 0;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(intentCalls, 1);
  assert.equal(saveCalls, 1);

  const sideButton = new FakeElement("button");
  sideButton.rect = { left: 1100, right: 1140, top: 650, bottom: 690, width: 40, height: 40 };
  assert.equal(host.handleHostPointerDown({ target: sideButton }), false);
  assert.equal(intentCalls, 1);
});


test("Work Load Earlier stops after exactly one lazy-loaded history batch", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 240;
  container.scrollHeight = 1040;
  let physicalTop = -400;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; },
    configurable: true
  });
  let batches = 0;
  let visibleCount = 4;
  const turnAdapter = {
    getVisibleTurns: () => Array.from({ length: visibleCount }, (_, index) => ({ id: `work-batch-${index}`, order: index })),
    resolveTurn: () => null,
    verifyTurnElement: () => false
  };
  container.dispatchEvent = (event) => {
    if (event?.type !== "wheel") return true;
    const max = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
    const logical = Math.max(0, Math.min(max, max + Number(physicalTop)));
    if (event.deltaY < 0 && logical <= 24 && batches < 2) {
      batches += 1;
      visibleCount += 4;
      container.scrollHeight += 400;
    }
    return true;
  };
  window.__codexThreadScrollHandlers = { markPointerIntent() {} };
  const nav = new WorkNavigationAdapter({
    window,
    turnAdapter,
    conversationAdapter: {
      getScrollContainer: () => container,
      getConversationIdentity: () => ({ id: "local:test", source: "sidebar-local", host: "local", kind: "local", stable: true })
    },
    workWheelStepPx: 240,
    workWheelWaitMs: 1,
    hydrationWaitMs: 4
  });
  const result = await nav.hydrateEarlierHistory({
    maxSteps: 24,
    maxBoundaryStalls: 2,
    stopAfterBatch: true,
    isCurrent: () => true
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reason, "earlier-batch-loaded");
  assert.equal(batches, 1);
});

test("CodexDesktopHost snaps a near-tail official Work bottom jump to the exact physical tail before saving", async () => {
  const document = new FakeDocument();
  const window = fakeWindow(document);
  window.getComputedStyle = () => ({ flexDirection: "column-reverse" });
  const host = new CodexDesktopHost({ document, window });
  const container = new FakeElement();
  container.isConnected = true;
  container.clientHeight = 800;
  container.scrollHeight = 6400;
  container.rect = { left: 240, right: 1240, top: 80, bottom: 760, width: 1000, height: 680 };
  let physicalTop = -2800;
  Object.defineProperty(container, "scrollTop", {
    get: () => physicalTop,
    set: (value) => { physicalTop = value; },
    configurable: true
  });
  host.conversation.getScrollContainer = () => container;
  host.conversation.getConversationIdentity = () => ({ id: "local:01a057ce-32ff-75b3-83fb-4179df90399f", source: "sidebar-local", host: "local", kind: "local", stable: true });
  let intentCalls = 0;
  let saveCalls = 0;
  window.__codexThreadScrollHandlers = {
    markPointerIntent() { intentCalls += 1; },
    saveNow() { saveCalls += 1; }
  };
  const button = new FakeElement("button");
  button.rect = { left: 720, right: 760, top: 650, bottom: 690, width: 40, height: 40 };
  assert.equal(host.handleHostPointerDown({ target: button }), true);
  setTimeout(() => { physicalTop = -24; }, 20);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(intentCalls, 1);
  assert.equal(physicalTop, 0);
  assert.equal(saveCalls, 1);
});
