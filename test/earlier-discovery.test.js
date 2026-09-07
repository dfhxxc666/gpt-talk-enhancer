import test from "node:test";
import assert from "node:assert/strict";
import { TalkEnhancerApp } from "../src/app.js";
import { MemoryStorageAdapter } from "../src/core/storage-adapter.js";
import { FakeDocument, FakeElement } from "./fake-dom.js";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeScrollContainer(id) {
  const listeners = new Map();
  return {
    id,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 520, left: 0, right: 800, height: 520 };
    }
  };
}

function makeProgressiveFixtureAdapter() {
  const definitions = {
    a: { count: 120, start: 110 },
    b: { count: 28, start: 18 }
  };
  const roots = {};
  const scrollContainers = {};
  for (const id of Object.keys(definitions)) {
    const root = new FakeElement("main");
    root.setAttribute("data-thread-id", id);
    root.dataset.fixtureConversation = id;
    const scroll = makeScrollContainer(id);
    root.appendChild(scroll);
    roots[id] = root;
    scrollContainers[id] = scroll;
  }

  let currentId = "a";
  let moveCount = 0;
  const makeTurns = (id) => {
    const definition = definitions[id];
    const start = definition.start;
    const end = Math.min(definition.count, start + 10);
    return Array.from({ length: end - start }, (_value, offset) => {
      const index = start + offset;
      return {
        key: `${id}-turn-${index}`,
        text: `${id.toUpperCase()} user question ${index + 1}`,
        logicalOrder: index,
        element: { getBoundingClientRect: () => ({ top: 0, bottom: 40, height: 40 }) }
      };
    });
  };

  const adapter = {
    getContext() {
      return {
        root: roots[currentId],
        rootIdentity: `fixture:${currentId}`,
        scrollContainer: scrollContainers[currentId],
        composerRoot: null,
        editor: null,
        mount: null
      };
    },
    contextChanged(previous, next) {
      return !previous
        || previous.root !== next.root
        || previous.rootIdentity !== next.rootIdentity
        || previous.scrollContainer !== next.scrollContainer;
    },
    getRenderedUserTurns(root) {
      const id = root.dataset.fixtureConversation;
      return makeTurns(id);
    },
    moveEarlier({ container }) {
      const id = container.id;
      const definition = definitions[id];
      const before = definition.start;
      definition.start = Math.max(0, before - 10);
      moveCount += 1;
      return {
        ok: true,
        from: before,
        to: definition.start,
        step: 10,
        moved: definition.start !== before,
        atBoundary: definition.start === before && definition.start === 0
      };
    },
    get moveCount() {
      return moveCount;
    },
    switchConversation(id) {
      currentId = id;
    }
  };
  return { adapter, definitions };
}

function makeApp() {
  const documentRef = new FakeDocument();
  const windowRef = {
    document: documentRef,
    setTimeout,
    clearTimeout
  };
  const fixture = makeProgressiveFixtureAdapter();
  const app = new TalkEnhancerApp({
    document: documentRef,
    window: windowRef,
    adapter: fixture.adapter,
    storageAdapter: new MemoryStorageAdapter()
  });
  app.init();
  return { app, fixture, documentRef };
}

test("Earlier progressively discovers 120 turns without duplicates and reports retryable no-new state", async () => {
  const { app, fixture, documentRef } = makeApp();
  app.timeline.setExpanded(true);
  assert.equal(app.registry.size, 10);
  assert.equal(app.timeline.getItems().length, 10);

  const first = await app.discoverEarlier({ timeoutMs: 200, intervalMs: 1, stableMs: 10 });
  assert.equal(first.ok, true);
  assert.equal(first.discovered, true);
  assert.equal(app.registry.size, 20);
  assert.equal(app.timeline.getItems().length, 20);

  const sizes = [app.registry.size];
  while (app.registry.size < 120) {
    const result = await app.discoverEarlier({ timeoutMs: 200, intervalMs: 1, stableMs: 10 });
    assert.equal(result.ok, true);
    assert.equal(result.discovered, true);
    sizes.push(app.registry.size);
  }
  assert.deepEqual(sizes, [...sizes].sort((left, right) => left - right));
  assert.equal(new Set(app.registry.getAll().map((record) => record.key)).size, 120);
  assert.deepEqual(
    app.registry.getAll().map((record) => record.key),
    Array.from({ length: 120 }, (_value, index) => `a-turn-${index}`)
  );
  assert.equal(app.timeline.getItems().length, 120);

  const movesBeforeNoNew = fixture.adapter.moveCount;
  const noNew = await app.discoverEarlier({ timeoutMs: 200, intervalMs: 1, stableMs: 10 });
  assert.equal(noNew.ok, true);
  assert.equal(noNew.discovered, false);
  assert.equal(app.timeline.earlierState, "No more discovered");
  assert.equal(app.status().earlierPending, false);
  assert.equal(app.status().earlierTimerActive, false);
  const retry = await app.discoverEarlier({ timeoutMs: 200, intervalMs: 1, stableMs: 10 });
  assert.equal(retry.ok, true);
  assert.equal(retry.discovered, false);
  assert.equal(fixture.adapter.moveCount, movesBeforeNoNew + 2);
  assert.equal(app.timeline.earlierState, "No more discovered");
  assert.equal(documentRef.querySelectorAll(".gte-timeline__earlier").length, 1);
  app.destroy();
});

test("Earlier state and registry remain isolated across A to B to A", async () => {
  const { app, fixture } = makeApp();
  const switchTo = (id) => {
    fixture.adapter.switchConversation(id);
    app.refresh();
  };

  await app.discoverEarlier({ timeoutMs: 200, intervalMs: 1, stableMs: 10 });
  assert.equal(app.timeline.earlierState, "↑ Earlier");

  switchTo("b");
  assert.equal(app.timeline.earlierState, "↑ Earlier");
  assert.ok(app.registry.getAll().every((record) => record.key.startsWith("b-")));

  const pending = app.discoverEarlier({ timeoutMs: 500, intervalMs: 5, stableMs: 300 });
  assert.equal(app.timeline.earlierState, "Loading…");
  switchTo("a");
  const stale = await pending;
  assert.equal(stale.ok, false);
  assert.equal(app.timeline.earlierState, "↑ Earlier");
  assert.ok(app.registry.getAll().every((record) => record.key.startsWith("a-")));
  assert.ok(app.registry.getAll().every((record) => !record.key.startsWith("b-")));
  assert.equal(app.status().earlierPending, false);
  assert.equal(app.status().earlierTimerActive, false);
  app.destroy();
});

test("destroy and init release an Earlier wait and restore one control", async () => {
  const { app, fixture, documentRef } = makeApp();
  fixture.definitions.a.start = 0;
  app.refresh();
  const pending = app.discoverEarlier({ timeoutMs: 1000, intervalMs: 10, stableMs: 600 });
  await wait(5);
  assert.equal(app.timeline.earlierState, "Loading…");
  assert.equal(app.status().earlierTimerActive, true);

  app.destroy();
  const cancelled = await pending;
  assert.equal(cancelled.ok, false);
  assert.equal(app.status().earlierPending, false);
  assert.equal(app.status().earlierTimerActive, false);
  assert.equal(documentRef.querySelectorAll('[data-gte-component="timeline"]').length, 0);

  app.init();
  app.init();
  assert.equal(documentRef.querySelectorAll('[data-gte-component="timeline"]').length, 1);
  assert.equal(documentRef.querySelectorAll(".gte-timeline__earlier").length, 1);
  app.destroy();
});
