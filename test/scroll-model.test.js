import test from "node:test";
import assert from "node:assert/strict";
import { CodexAdapter } from "../src/core/codex-adapter.js";
import { parseTranslateOffset } from "../src/core/dom-utils.js";
import {
  createScrollModel,
  logicalFromScrollTop,
  scrollTopFromLogical
} from "../src/core/scroll-model.js";

test("column-reverse maps negative scrollTop into a top-origin logical position", () => {
  const model = createScrollModel({
    scrollTop: -300,
    scrollHeight: 1000,
    clientHeight: 400,
    flexDirection: "column-reverse"
  });
  assert.equal(model.maxLogicalPosition, 600);
  assert.equal(model.logicalPosition, 300);
  assert.equal(scrollTopFromLogical(0, 600, true), -600);
  assert.equal(scrollTopFromLogical(600, 600, true), 0);
  assert.equal(logicalFromScrollTop(-600, 600, true), 0);
});

test("normal scroll containers remain top-origin and clamp values", () => {
  const model = createScrollModel({
    scrollTop: 999,
    scrollHeight: 600,
    clientHeight: 400,
    flexDirection: "column"
  });
  assert.equal(model.maxLogicalPosition, 200);
  assert.equal(model.logicalPosition, 200);
  assert.equal(scrollTopFromLogical(-10, 200, false), 0);
});

test("translate metadata reads the vertical component", () => {
  assert.equal(parseTranslateOffset("translateY(-24px)"), -24);
  assert.equal(parseTranslateOffset("translate3d(4px, 96px, 0)"), 96);
  assert.equal(parseTranslateOffset("matrix(1, 0, 0, 1, 4, 96)"), 96);
});

test("CodexAdapter moves one viewport-sized step toward earlier history", () => {
  const container = {
    scrollTop: -900,
    scrollHeight: 2000,
    clientHeight: 500,
    style: { flexDirection: "column-reverse" },
    scrollTo({ top }) {
      this.scrollTop = top;
    }
  };
  const adapter = new CodexAdapter({
    document: {},
    window: { getComputedStyle: () => ({ flexDirection: "column-reverse" }) }
  });

  const result = adapter.moveEarlier({ container });

  assert.equal(result.ok, true);
  assert.equal(result.step, 450);
  assert.equal(result.from, 600);
  assert.equal(result.to, 150);
  assert.equal(container.scrollTop, -1350);
  assert.equal(result.moved, true);
  assert.equal(result.atBoundary, false);
});

test("CodexAdapter resolves the real timeline scroll selector when it wraps the conversation root", () => {
  const scrollContainer = {
    nodeType: 1,
    parentElement: null,
    matches(selector) { return selector === '[data-app-action-timeline-scroll]'; },
    querySelector() { return null; }
  };
  const root = {
    nodeType: 1,
    parentElement: scrollContainer,
    matches() { return false; },
    querySelector() { return null; }
  };
  const adapter = new CodexAdapter({ document: { querySelector: () => null }, window: {} });
  assert.equal(adapter.getScrollContainer(root), scrollContainer);
});

test("CodexAdapter falls back to a document-level real scroll selector outside the conversation subtree", () => {
  const scrollContainer = { id: "real-scroll" };
  const root = {
    nodeType: 1,
    parentElement: null,
    matches() { return false; },
    querySelector() { return null; }
  };
  const documentRef = {
    querySelector(selector) {
      return selector === '[data-app-action-timeline-scroll]' ? scrollContainer : null;
    }
  };
  const adapter = new CodexAdapter({ document: documentRef, window: {} });
  assert.equal(adapter.getScrollContainer(root), scrollContainer);
});

test("CodexAdapter unrendered jump probes around the approximate position, resolves the exact key, then corrects", async () => {
  const scrollCalls = [];
  const container = {
    scrollTop: 0,
    scrollHeight: 1200,
    clientHeight: 400,
    style: { flexDirection: "column" },
    scrollTo({ top }) { this.scrollTop = top; scrollCalls.push(top); },
    getBoundingClientRect() { return { top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400 }; }
  };
  const hydrated = {
    isConnected: true,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "turn-virtual" : null; },
    getBoundingClientRect() {
      const top = 500 - container.scrollTop;
      return { top, bottom: top + 60, left: 0, right: 800, width: 800, height: 60 };
    }
  };
  const adapter = new CodexAdapter({
    document: {},
    window: { getComputedStyle: () => ({ flexDirection: "column" }) }
  });
  adapter.getScrollContainer = () => container;
  let lookupCount = 0;
  adapter.findRenderedTurn = (key) => {
    assert.equal(key, "turn-virtual");
    lookupCount += 1;
    return lookupCount >= 3 ? hydrated : null;
  };

  const result = await adapter.scrollToTurn({ key: "turn-virtual", element: null, approximatePosition: 300 }, { correctionTimeoutMs: 300 });
  assert.equal(result.ok, true);
  assert.equal(result.corrected, true);
  assert.ok(lookupCount >= 3);
  assert.equal(scrollCalls[0], 300);
  assert.equal(scrollCalls.at(-1), 488);
});

test("CodexAdapter rejects a connected recycled turn node and resolves the live exact-key element", async () => {
  const container = {
    scrollTop: 100, scrollHeight: 1200, clientHeight: 400, style: { flexDirection: "column" },
    scrollTo({ top }) { this.scrollTop = top; },
    getBoundingClientRect() { return { top: 0, bottom: 400, left: 0, right: 800, width: 800, height: 400 }; }
  };
  const recycled = {
    isConnected: true,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "turn-reused" : null; },
    getBoundingClientRect() { return { top: 20, bottom: 70, height: 50 }; }
  };
  const live = {
    isConnected: true,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "turn-target" : null; },
    getBoundingClientRect() { const top = 260 - container.scrollTop; return { top, bottom: top + 50, height: 50 }; }
  };
  const adapter = new CodexAdapter({ document: {}, window: { getComputedStyle: () => ({ flexDirection: "column" }) } });
  adapter.getScrollContainer = () => container;
  adapter.findRenderedTurn = (key) => key === "turn-target" ? live : null;
  const result = await adapter.scrollToTurn({ key: "turn-target", element: recycled, approximatePosition: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.element, live);
  assert.equal(container.scrollTop, 248);
});

test("CodexAdapter finds the new-conversation composer from its editor even without thread placement", () => {
  const form = { isConnected: true, querySelector: () => null };
  const editor = {
    isConnected: true,
    closest(selector) { if (selector === "form") return form; return null; }
  };
  const documentRef = {
    querySelector(selector) { if (selector.includes("contenteditable")) return editor; return null; }
  };
  const adapter = new CodexAdapter({ document: documentRef, window: {} });
  assert.equal(adapter.getComposerRoot(), form);
  assert.deepEqual(adapter.getComposerMount(form, editor), { anchor: form, editor, footer: null, kind: "external" });
});
