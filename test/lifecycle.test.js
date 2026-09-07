import test from "node:test";
import assert from "node:assert/strict";
import { bootstrap } from "../src/index.js";
import { RootObserver } from "../src/core/root-observer.js";
import { FakeDocument } from "./fake-dom.js";

test("bootstrap is idempotent and replaces the previous UI instance", () => {
  const documentRef = new FakeDocument();
  const windowRef = { document: documentRef };
  const adapter = {
    getContext: () => ({ root: null, rootIdentity: null, scrollContainer: null, composerRoot: null, editor: null, mount: null }),
    contextChanged: (previous, next) => !previous || previous.rootIdentity !== next.rootIdentity
  };

  const first = bootstrap({ document: documentRef, window: windowRef, adapter });
  assert.equal(documentRef.querySelectorAll('[data-gte-component="timeline"]').length, 1);
  const second = bootstrap({ document: documentRef, window: windowRef, adapter });
  assert.notEqual(first, second);
  assert.equal(first.destroyed, true);
  assert.equal(second.status().health, "degraded");
  assert.equal(documentRef.querySelectorAll('[data-gte-component="timeline"]').length, 1);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-button"]').length, 0);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 0);
  second.destroy();
  assert.equal(documentRef.querySelectorAll('[data-gte-component="timeline"]').length, 0);
});

test("RootObserver uses MutationObserver rebinds without a reconciliation polling timer", () => {
  const documentRef = new FakeDocument();
  let observedTarget = null;
  let observedOptions = null;
  let disconnected = false;
  let intervalCalled = false;
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) {
      observedTarget = target;
      observedOptions = options;
    }
    disconnect() { disconnected = true; }
  }
  const windowRef = {
    MutationObserver: FakeMutationObserver,
    setInterval() {
      intervalCalled = true;
      throw new Error("RootObserver must not poll");
    }
  };
  const context = { root: null, rootIdentity: null, scrollContainer: null, composerRoot: null, editor: null, mount: null };
  const adapter = {
    getContext: () => context,
    contextChanged: (previous) => !previous
  };
  const observer = new RootObserver({ adapter, document: documentRef, window: windowRef });

  assert.equal(observer.start(), true);
  assert.equal(intervalCalled, false);
  assert.equal(observedTarget, documentRef);
  assert.equal(observedOptions.childList, true);
  assert.equal(observedOptions.subtree, true);
  assert.equal(observedOptions.attributes, true);
  assert.ok(observedOptions.attributeFilter.includes("data-app-action-timeline-scroll"));
  assert.ok(observedOptions.attributeFilter.includes("data-thread-id"));
  assert.equal(observer.status().observerActive, true);
  assert.equal(observer.status().reconciliationActive, false);
  assert.equal(observer.status().eventDriven, true);
  observer.dispose();
  assert.equal(disconnected, true);
  assert.equal(observer.status().observerActive, false);
});