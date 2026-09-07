import test from "node:test";
import assert from "node:assert/strict";
import { ChatGPTExtensionAdapter } from "../src/core/chatgpt-extension-adapter.js";

function makeTurn(id, role, { text = "", top = 0, empty = false } = {}) {
  const attrs = new Map([
    ["data-turn-id-container", id],
    ["data-is-intersecting", "true"]
  ]);
  const roleNode = role ? { getAttribute(name) { return name === "data-turn" ? role : null; } } : null;
  return {
    nodeType: 1,
    isConnected: true,
    childElementCount: empty ? 0 : 1,
    style: {},
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    querySelector(selector) {
      if (selector === "[data-turn]") return roleNode;
      if (selector === ".whitespace-pre-wrap" && text) return { textContent: text };
      return null;
    },
    querySelectorAll() { return []; },
    matches() { return false; },
    getBoundingClientRect() { return { top, bottom: top + 60, left: 0, right: 800, width: 800, height: 60 }; }
  };
}

test("ChatGPTExtensionAdapter extracts ChatGPT conversation ids", () => {
  const adapter = new ChatGPTExtensionAdapter({ document: {}, window: { location: { pathname: "/" } } });
  assert.equal(adapter.extractConversationId("/c/abc-123"), "abc-123");
  assert.equal(adapter.extractConversationId("/g/gpt-foo/c/conv-9"), "conv-9");
  assert.equal(adapter.extractConversationId("/share/e/share-1"), "share-1");
  assert.equal(adapter.extractConversationId("/"), null);
  adapter.window.location.pathname = "/c/identity-1";
  assert.equal(adapter.getConversationIdentity(null), "chatgpt:identity-1");
});

test("ChatGPTExtensionAdapter uses stable turn UUIDs and captured text for virtualized user shells", () => {
  const userOne = makeTurn("user-uuid-1", "user", { empty: true, top: 100 });
  const assistant = makeTurn("assistant-uuid-1", "assistant", { top: 240 });
  const userTwo = makeTurn("user-uuid-2", "user", { text: "第二个真实问题", top: 380 });
  const turns = [userOne, assistant, userTwo];
  const documentRef = {
    querySelectorAll(selector) {
      return selector === '[data-turn-id-container][data-is-intersecting]' ? turns : [];
    },
    querySelector() { return null; }
  };
  const windowRef = { location: { pathname: "/" }, getComputedStyle: () => ({ flexDirection: "column" }) };
  const adapter = new ChatGPTExtensionAdapter({ document: documentRef, window: windowRef });
  adapter._turnTextCache.set("user-uuid-1", "第一个来自 MAIN world 捕获的问题");
  const container = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    style: { flexDirection: "column" },
    getBoundingClientRect() { return { top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500 }; }
  };
  adapter.getScrollContainer = () => container;
  const records = adapter.getRenderedUserTurns({});
  assert.deepEqual(records.map((record) => record.key), ["user-uuid-1", "user-uuid-2"]);
  assert.equal(records[0].text, "第一个来自 MAIN world 捕获的问题");
  assert.equal(records[1].text, "第二个真实问题");
  assert.equal(userOne.getAttribute("data-gte-turn"), "user");
  assert.equal(assistant.getAttribute("data-gte-turn"), "assistant");
});
