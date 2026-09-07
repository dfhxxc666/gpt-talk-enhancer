import test from "node:test";
import assert from "node:assert/strict";
import { TalkEnhancerApp } from "../src/app.js";
import { MemoryStorageAdapter } from "../src/core/storage-adapter.js";
import { FakeDocument } from "./fake-dom.js";

class FakeIntersectionObserver {
  static instances = [];

  constructor(_callback, options) {
    this.options = options;
    this.observed = [];
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element) { this.observed.push(element); }
  disconnect() { this.disconnected = true; }
}

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
  }
  observe(element) { this.observed.push(element); }
  disconnect() {}
}

function createRuntimeFixture() {
  FakeIntersectionObserver.instances = [];
  const documentRef = new FakeDocument();
  const windowRef = {
    document: documentRef,
    IntersectionObserver: FakeIntersectionObserver,
    ResizeObserver: FakeResizeObserver,
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout
  };

  const root = documentRef.createElement("main");
  const scrollOne = documentRef.createElement("div");
  const scrollTwo = documentRef.createElement("div");
  const composerOne = documentRef.createElement("form");
  const composerTwo = documentRef.createElement("form");
  scrollOne.appendChild(root);
  documentRef.body.append(scrollOne, scrollTwo, composerOne, composerTwo);
  composerOne.getBoundingClientRect = () => ({ top: 600, bottom: 700, left: 400, right: 900, width: 500, height: 100 });
  composerTwo.getBoundingClientRect = () => ({ top: 580, bottom: 680, left: 420, right: 900, width: 480, height: 100 });

  let context = {
    root,
    rootIdentity: "fixture:a",
    scrollContainer: scrollOne,
    composerRoot: composerOne,
    editor: null,
    mount: { anchor: composerOne, kind: "external" }
  };
  const adapter = {
    getContext() { return context; },
    contextChanged(previous, next) {
      return !previous
        || previous.root !== next.root
        || previous.rootIdentity !== next.rootIdentity
        || previous.scrollContainer !== next.scrollContainer
        || previous.composerRoot !== next.composerRoot
        || previous.mount?.anchor !== next.mount?.anchor;
    },
    getRenderedUserTurns() { return []; }
  };

  const app = new TalkEnhancerApp({
    document: documentRef,
    window: windowRef,
    adapter,
    storageAdapter: new MemoryStorageAdapter()
  });
  app.init();

  return {
    app,
    documentRef,
    root,
    scrollOne,
    scrollTwo,
    composerOne,
    composerTwo,
    setContext(next) { context = next; },
    getContext() { return context; }
  };
}

test("scrollContainer replacement rebinds ActiveTracker and keeps runtime status aligned", () => {
  const fixture = createRuntimeFixture();
  const { app, root, scrollOne, scrollTwo, composerOne } = fixture;
  const initial = app.status();
  assert.equal(initial.health, "healthy");
  assert.equal(initial.scrollContainerDetected, true);
  assert.equal(initial.activeTracker.bound, true);
  assert.equal(initial.activeTracker.intersectionObserverActive, true);
  assert.equal(app.activeTracker.scrollContainer, scrollOne);
  const oldObserver = app.activeTracker.intersectionObserver;

  scrollTwo.appendChild(root);
  fixture.setContext({
    root,
    rootIdentity: "fixture:a",
    scrollContainer: scrollTwo,
    composerRoot: composerOne,
    editor: null,
    mount: { anchor: composerOne, kind: "external" }
  });
  app.refresh();

  const rebound = app.status();
  assert.equal(rebound.health, "healthy");
  assert.equal(rebound.scrollContainerDetected, true);
  assert.equal(rebound.activeTracker.bound, true);
  assert.equal(rebound.activeTracker.intersectionObserverActive, true);
  assert.equal(app.renderedTracker.scrollContainer, scrollTwo);
  assert.equal(app.activeTracker.scrollContainer, scrollTwo);
  assert.equal(oldObserver.disconnected, true);
  assert.notEqual(app.activeTracker.intersectionObserver, oldObserver);
  app.destroy();
});

test("missing scroll dependency degrades health and restoring it rebinds ActiveTracker", () => {
  const fixture = createRuntimeFixture();
  const { app, root, scrollTwo, composerOne } = fixture;
  fixture.setContext({
    root,
    rootIdentity: "fixture:a",
    scrollContainer: null,
    composerRoot: composerOne,
    editor: null,
    mount: { anchor: composerOne, kind: "external" }
  });
  app.refresh();
  const degraded = app.status();
  assert.equal(degraded.health, "degraded");
  assert.equal(degraded.scrollContainerDetected, false);
  assert.equal(degraded.activeTracker.bound, false);
  assert.equal(degraded.activeTracker.intersectionObserverActive, false);

  scrollTwo.appendChild(root);
  fixture.setContext({
    root,
    rootIdentity: "fixture:a",
    scrollContainer: scrollTwo,
    composerRoot: composerOne,
    editor: null,
    mount: { anchor: composerOne, kind: "external" }
  });
  app.refresh();
  assert.equal(app.status().health, "healthy");
  assert.equal(app.status().activeTracker.intersectionObserverActive, true);
  app.destroy();
});

test("conversation and composer replacement rebinds the external prompt trigger and first click works", () => {
  const fixture = createRuntimeFixture();
  const { app, documentRef, root, scrollTwo, composerTwo } = fixture;
  const firstButton = app.promptPicker.button;
  scrollTwo.appendChild(root);
  fixture.setContext({
    root,
    rootIdentity: "fixture:b",
    scrollContainer: scrollTwo,
    composerRoot: composerTwo,
    editor: null,
    mount: { anchor: composerTwo, kind: "external" }
  });
  app.refresh();

  const reboundButton = app.promptPicker.button;
  assert.notEqual(reboundButton, firstButton);
  assert.equal(firstButton.isConnected, false);
  assert.equal(reboundButton.parentElement, documentRef.body);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-button"]').length, 1);
  const icon = reboundButton.querySelector(".gte-prompt-button__icon");
  app.promptPicker.boundDocumentPointerDown({ target: icon, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(app.promptPicker.opened, true);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="prompt-popup"]').length, 1);
  app.destroy();
});

test("jumpToTurn owns a finite navigation request and lets real geometry decide active state", async () => {
  const fixture = createRuntimeFixture();
  const { app } = fixture;
  app.registry.upsert({ key: "turn-target", text: "Target", logicalOrder: 1, rendered: false, approximatePosition: 120 });
  let continueWasTrue = false;
  app.adapter.scrollToTurn = async (_record, options) => {
    continueWasTrue = options.shouldContinue();
    return { ok: true, corrected: true };
  };
  let refreshes = 0;
  app.activeTracker.refresh = () => { refreshes += 1; return null; };
  assert.equal(app.jumpRequestId, 0);
  const result = await app.jumpToTurn("turn-target");
  assert.equal(result.ok, true);
  assert.equal(continueWasTrue, true);
  assert.equal(Number.isFinite(app.jumpRequestId), true);
  assert.equal(app.jumpRequestId, 1);
  assert.equal(app.activeKey, null, "clicked key must not be forced active before scroll geometry confirms it");
  assert.equal(refreshes, 1);
  app.destroy();
});
