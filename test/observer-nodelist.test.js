import test from "node:test";
import assert from "node:assert/strict";
import { ConversationObserver } from "../src/core/conversation-observer.js";
import { RootObserver } from "../src/core/root-observer.js";
import { toNodeArray } from "../src/core/dom-utils.js";
import { FakeDocument } from "./fake-dom.js";

function nodeListLike(...nodes) {
  return Object.assign({ length: nodes.length }, nodes);
}

test("toNodeArray safely normalizes a non-iterable NodeList-like value", () => {
  const first = { nodeType: 1 };
  const second = { nodeType: 1 };
  assert.deepEqual(toNodeArray(nodeListLike(first, second)), [first, second]);
  assert.deepEqual(toNodeArray(null), []);
});

test("RootObserver handles MutationRecord NodeList-like nodes without throwing", () => {
  const documentRef = new FakeDocument();
  const root = documentRef.createElement("main");
  const observer = new RootObserver({
    adapter: { getContext: () => null },
    document: documentRef
  });
  observer.lastContext = {
    root,
    scrollContainer: null,
    composerRoot: null,
    editor: null,
    mount: null
  };

  const mutation = {
    type: "childList",
    addedNodes: nodeListLike(),
    removedNodes: nodeListLike(root)
  };
  assert.doesNotThrow(() => observer.isRelevantMutation(mutation));
  assert.equal(observer.isRelevantMutation(mutation), true);
});

test("ConversationObserver normalizes added and removed NodeList-like values", () => {
  const userMessage = {
    nodeType: 1,
    matches: () => true,
    querySelector: () => null
  };
  const target = {
    nodeType: 1,
    parentElement: null,
    matches: () => false,
    querySelector: () => null
  };
  const observer = new ConversationObserver({
    tracker: {},
    document: new FakeDocument()
  });
  const mutation = {
    type: "childList",
    target,
    addedNodes: nodeListLike(userMessage),
    removedNodes: nodeListLike()
  };
  assert.doesNotThrow(() => observer.isRelevantMutation(mutation));
  assert.equal(observer.isRelevantMutation(mutation), true);
});
