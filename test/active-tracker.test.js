import test from "node:test";
import assert from "node:assert/strict";
import { ActiveTracker } from "../src/core/active-tracker.js";

class FakeIntersectionObserver {
  static instances = [];

  constructor(_callback, options) {
    this.options = options;
    this.observed = [];
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element) { this.observed.push(element); }
  unobserve(element) { this.observed = this.observed.filter((candidate) => candidate !== element); }
  disconnect() { this.disconnected = true; }
}

function makeScrollContainer() {
  return {
    isConnected: true,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { top: 0, bottom: 700, left: 0, right: 900, width: 900, height: 700 };
    }
  };
}

test("ActiveTracker re-observes the same rendered turn after scrollContainer rebind", () => {
  FakeIntersectionObserver.instances = [];
  const element = {
    isConnected: true,
    getBoundingClientRect() {
      return { top: 120, bottom: 180, left: 0, right: 900, width: 900, height: 60 };
    }
  };
  const registry = { getRenderedRecords: () => [{ key: "turn-1", element }] };
  const tracker = new ActiveTracker({
    registry,
    window: { IntersectionObserver: FakeIntersectionObserver },
    footerHeight: 0
  });
  const firstScroll = makeScrollContainer();
  const secondScroll = makeScrollContainer();

  tracker.bind(firstScroll);
  const firstObserver = FakeIntersectionObserver.instances[0];
  assert.deepEqual(firstObserver.observed, [element]);
  assert.equal(tracker.status().observedCount, 1);

  tracker.bind(secondScroll);
  const secondObserver = FakeIntersectionObserver.instances[1];
  assert.equal(firstObserver.disconnected, true);
  assert.deepEqual(secondObserver.observed, [element]);
  assert.equal(secondObserver.options.root, secondScroll);
  assert.equal(tracker.status().bound, true);
  assert.equal(tracker.status().intersectionObserverActive, true);
  assert.equal(tracker.status().observedCount, 1);

  tracker.dispose();
  assert.equal(tracker.status().observedCount, 0);
});

test("ActiveTracker uses a top activation line instead of largest visible area", () => {
  const shortTurn = {
    isConnected: true,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "turn-short" : null; },
    getBoundingClientRect() { return { top: 110, bottom: 150, left: 0, right: 900, width: 900, height: 40 }; }
  };
  const hugeNextTurn = {
    isConnected: true,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "turn-huge" : null; },
    getBoundingClientRect() { return { top: 190, bottom: 650, left: 0, right: 900, width: 900, height: 460 }; }
  };
  const registry = { getRenderedRecords: () => [
    { key: "turn-short", element: shortTurn },
    { key: "turn-huge", element: hugeNextTurn }
  ] };
  const tracker = new ActiveTracker({
    adapter: { getTurnKey: (element) => element.getAttribute("data-content-search-turn-key") },
    registry,
    window: { IntersectionObserver: FakeIntersectionObserver },
    footerHeight: 0
  });
  tracker.bind(makeScrollContainer());
  assert.equal(tracker.activeKey, "turn-short", "the last turn above the activation line should win even if the next turn is much larger");
  tracker.dispose();
});

test("ActiveTracker ignores connected DOM nodes recycled to a different turn key", () => {
  const recycled = {
    isConnected: true,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "turn-other" : null; },
    getBoundingClientRect() { return { top: 100, bottom: 150, left: 0, right: 900, width: 900, height: 50 }; }
  };
  const live = {
    isConnected: true,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "turn-live" : null; },
    getBoundingClientRect() { return { top: 180, bottom: 230, left: 0, right: 900, width: 900, height: 50 }; }
  };
  const registry = { getRenderedRecords: () => [
    { key: "turn-stale", element: recycled },
    { key: "turn-live", element: live }
  ] };
  const tracker = new ActiveTracker({
    adapter: { getTurnKey: (element) => element.getAttribute("data-content-search-turn-key") },
    registry,
    window: { IntersectionObserver: FakeIntersectionObserver },
    footerHeight: 0
  });
  tracker.bind(makeScrollContainer());
  assert.equal(tracker.activeKey, "turn-live");
  tracker.dispose();
});
