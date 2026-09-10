import test from "node:test";
import assert from "node:assert/strict";
import { OfficialNavigationProbe, analyzeOfficialNavigationLearning, analyzeOfficialNavigationMapping, fingerprintClickTarget, selectTrustedOfficialBridgePair } from "../../src/v3/diagnostics/official-navigation-probe.js";

function createDocumentHarness() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    fire(type, event) { listeners.get(type)?.(event); },
    listeners
  };
}

function createProbeWindow() {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  return {
    performance: { now: () => now },
    innerWidth: 1400,
    getComputedStyle: (node) => ({ flexDirection: node?.style?.flexDirection ?? "column" }),
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms, cleared: false }); return id; },
    clearTimeout(id) { const timer = timers.get(id); if (timer) timer.cleared = true; },
    advance(ms) { now += ms; },
    runTimers() {
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms)) {
        timers.delete(id);
        if (timer.cleared) continue;
        now = Math.max(now, timer.ms);
        timer.callback();
      }
    }
  };
}

function createContainer() {
  const listeners = new Map();
  return {
    isConnected: true,
    scrollTop: 10000,
    scrollHeight: 20000,
    clientHeight: 800,
    style: { flexDirection: "column" },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    fireScroll() { listeners.get("scroll")?.(); }
  };
}

function element({ tag = "button", attrs = {}, classes = [], rect = null, parent = null } = {}) {
  const attributeEntries = Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) }));
  return {
    tagName: tag.toUpperCase(),
    className: classes.join(" "),
    id: attrs.id ?? "",
    parentElement: parent,
    attributes: attributeEntries,
    getAttribute(name) { const item = attributeEntries.find((entry) => entry.name === name); return item?.value ?? null; },
    getBoundingClientRect() { return rect ?? { top: 100, left: 1300, right: 1330, width: 30, height: 30 }; }
  };
}

function clickEvent(target, path = [target]) {
  return { target, isTrusted: true, composedPath: () => path };
}

test("OfficialNavigationProbe classifies one official virtual-window jump", () => {
  const document = createDocumentHarness();
  const window = createProbeWindow();
  const container = createContainer();
  let range = { min: 60, max: 75, count: 16 };
  const records = [];
  const context = { enabled: true, sessionKey: "session-A", host: "local", source: "sidebar-local", stable: true };
  const probe = new OfficialNavigationProbe({
    document, window, sampleDelaysMs: [50, 120],
    getContext: () => context, getScrollContainer: () => container, getVisibleRange: () => range,
    onRecord: (record) => records.push(record)
  }).start();
  const button = element({ attrs: { role: "button" }, classes: ["official-timeline-marker"] });
  document.fire("click", clickEvent(button));
  window.advance(12);
  container.scrollTop = 1200;
  range = { min: 0, max: 15, count: 16 };
  container.fireScroll();
  window.runTimers();
  assert.equal(records.length, 1);
  assert.equal(records[0].host, "local");
  assert.equal(records[0].classification, "single-jump-window-swap");
  assert.equal(records[0].scrollEventCount, 1);
  assert.equal(records[0].metrics.windowChanged, true);
  assert.ok(records[0].metrics.absoluteLogicalDelta > container.clientHeight * 1.5);
  probe.destroy();
});

test("OfficialNavigationProbe discards a probe when the conversation session changes", () => {
  const document = createDocumentHarness();
  const window = createProbeWindow();
  const container = createContainer();
  let sessionKey = "session-A";
  let range = { min: 40, max: 50, count: 11 };
  const records = [];
  const probe = new OfficialNavigationProbe({
    document, window, sampleDelaysMs: [40],
    getContext: () => ({ enabled: true, sessionKey, host: "chatgpt", source: "sidebar-chatgpt", stable: true }),
    getScrollContainer: () => container, getVisibleRange: () => range, onRecord: (record) => records.push(record)
  }).start();
  const button = element({ classes: ["official-timeline-marker"] });
  document.fire("click", clickEvent(button));
  container.scrollTop = 2000;
  range = { min: 0, max: 10, count: 11 };
  sessionKey = "session-B";
  window.runTimers();
  assert.equal(records.length, 0);
  probe.destroy();
});

test("OfficialNavigationProbe ignores sidebar conversation-selection clicks", () => {
  const document = createDocumentHarness();
  const window = createProbeWindow();
  const container = createContainer();
  const probe = new OfficialNavigationProbe({
    document, window, getContext: () => ({ enabled: true, sessionKey: "session-A", host: "chatgpt", stable: true }),
    getScrollContainer: () => container, getVisibleRange: () => ({ min: 1, max: 5, count: 5 })
  }).start();
  const row = element({ attrs: { "data-sidebar-chatgpt-conversation-key": "secret-conversation-key" } });
  document.fire("click", clickEvent(row));
  assert.equal(probe.active, null);
  probe.destroy();
});

test("official click fingerprint stores attribute shapes but not raw values", () => {
  const uuid = "12345678-1234-1234-1234-123456789abc";
  const secret = "Q76 private question text";
  const button = element({ attrs: { "data-turn-id": uuid, "aria-label": secret, title: "Jump to private turn" }, classes: ["timeline", "marker"] });
  const fingerprint = fingerprintClickTarget(clickEvent(button), { innerWidth: 1400 });
  const json = JSON.stringify(fingerprint);
  assert.equal(json.includes(uuid), false);
  assert.equal(json.includes(secret), false);
  assert.equal(fingerprint.path[0].dataAttributes[0].name, "data-turn-id");
  assert.equal(fingerprint.path[0].dataAttributes[0].kind, "uuid-like");
  assert.equal(fingerprint.path[0].ariaLabel.length, secret.length);
  assert.equal(fingerprint.path[0].ariaLabel.kind, "text");
});


test("official marker key is private-only and never enters persisted probe records", () => {
  const document = createDocumentHarness();
  const window = createProbeWindow();
  const container = createContainer();
  let range = { min: 20, max: 25, count: 6 };
  const privateMarkers = [];
  const records = [];
  const button = element({ attrs: { "data-thread-user-message-navigation-item-id": "private-official-marker-key" } });
  document.querySelectorAll = () => [button];
  const probe = new OfficialNavigationProbe({
    document, window, sampleDelaysMs: [40],
    getContext: () => ({ enabled: true, sessionKey: "session-A", host: "local", source: "sidebar-local", stable: true }),
    getScrollContainer: () => container, getVisibleRange: () => range,
    onPrivateMarker: (marker) => privateMarkers.push(marker),
    onRecord: (record) => records.push(record)
  }).start();
  document.fire("click", clickEvent(button));
  container.scrollTop = 2500;
  range = { min: 5, max: 10, count: 6 };
  container.fireScroll();
  window.runTimers();
  assert.equal(privateMarkers.length, 1);
  assert.equal(privateMarkers[0].markerKey, "private-official-marker-key");
  assert.equal(records.length, 1);
  assert.equal(JSON.stringify(records[0]).includes("private-official-marker-key"), false);
  assert.equal("markerKey" in (records[0].marker ?? {}), false);
  probe.destroy();
});

test("official navigation mapping proves exact one-to-one turn ids without exposing raw ids", () => {
  const ids = ["turn-a", "turn-b", "turn-c"];
  const buttons = ids.map((id) => element({ attrs: { "data-thread-user-message-navigation-item-id": id } }));
  const document = { querySelectorAll: () => buttons };
  const mapping = analyzeOfficialNavigationMapping({ document, turns: ids.map((id, order) => ({ id, order })) });
  assert.equal(mapping.officialButtonCount, 3);
  assert.equal(mapping.knownTurnCount, 3);
  assert.equal(mapping.exactIdMatches, 3);
  assert.equal(mapping.orderedExactMatches, 3);
  assert.equal(mapping.exactButtonCoverage, 1);
  assert.equal(mapping.exactTurnCoverage, 1);
  assert.equal(mapping.matchedOrderMonotonic, true);
  assert.equal(mapping.oneToOneExact, true);
  assert.equal(mapping.recommendedBridgeMode, "direct-exact-id");
  const json = JSON.stringify(mapping);
  for (const id of ids) assert.equal(json.includes(id), false);
});

test("official navigation mapping supports a monotonic exact-id subset as a partial bridge", () => {
  const buttons = ["turn-b", "turn-c"].map((id) => element({ attrs: { "data-thread-user-message-navigation-item-id": id } }));
  const document = { querySelectorAll: () => buttons };
  const turns = ["turn-a", "turn-b", "turn-c"].map((id, order) => ({ id, order }));
  const mapping = analyzeOfficialNavigationMapping({ document, turns });
  assert.equal(mapping.exactButtonCoverage, 1);
  assert.equal(mapping.exactTurnCoverage, 0.667);
  assert.equal(mapping.matchedOrderMonotonic, true);
  assert.equal(mapping.oneToOneExact, false);
  assert.equal(mapping.recommendedBridgeMode, "direct-exact-id-partial");
  assert.deepEqual(mapping.matchedOrderRange, { min: 1, max: 2, count: 2 });
});

test("official navigation mapping rejects exact ids presented in a non-monotonic order", () => {
  const buttons = ["turn-c", "turn-a", "turn-b"].map((id) => element({ attrs: { "data-thread-user-message-navigation-item-id": id } }));
  const document = { querySelectorAll: () => buttons };
  const turns = ["turn-a", "turn-b", "turn-c"].map((id, order) => ({ id, order }));
  const mapping = analyzeOfficialNavigationMapping({ document, turns });
  assert.equal(mapping.exactButtonCoverage, 1);
  assert.equal(mapping.matchedOrderMonotonic, false);
  assert.equal(mapping.oneToOneExact, false);
  assert.equal(mapping.recommendedBridgeMode, "mixed-unsafe");
});


test("official marker learning accepts a monotonic piecewise-offset mapping", () => {
  const summary = analyzeOfficialNavigationLearning([
    { markerIndex: 0, markerCount: 66, targetOrder: 0, knownTurnCount: 63 },
    { markerIndex: 10, markerCount: 66, targetOrder: 10, knownTurnCount: 63 },
    { markerIndex: 22, markerCount: 66, targetOrder: 21, knownTurnCount: 63 },
    { markerIndex: 44, markerCount: 66, targetOrder: 42, knownTurnCount: 63 },
    { markerIndex: 65, markerCount: 66, targetOrder: 62, knownTurnCount: 63 }
  ]);
  assert.equal(summary.sampleCount, 5);
  assert.equal(summary.uniqueMarkerCount, 5);
  assert.equal(summary.uniqueTargetCount, 5);
  assert.equal(summary.oneToOneObserved, true);
  assert.equal(summary.monotonic, true);
  assert.deepEqual(summary.uniqueOffsets, [0, 1, 2, 3]);
  assert.equal(summary.recommendedBridgeMode, "learned-pairs-only");
  assert.deepEqual(summary.observedPairs.map(({ markerIndex, targetOrder }) => [markerIndex, targetOrder]), [[0,0],[10,10],[22,21],[44,42],[65,62]]);
});

test("official marker learning rejects conflicting marker or target mappings", () => {
  const summary = analyzeOfficialNavigationLearning([
    { markerIndex: 5, markerCount: 66, targetOrder: 5, knownTurnCount: 63 },
    { markerIndex: 5, markerCount: 66, targetOrder: 6, knownTurnCount: 63 },
    { markerIndex: 7, markerCount: 66, targetOrder: 6, knownTurnCount: 63 }
  ]);
  assert.ok(summary.markerConflicts > 0);
  assert.ok(summary.targetConflicts > 0);
  assert.equal(summary.oneToOneObserved, false);
  assert.equal(summary.recommendedBridgeMode, "unsafe-conflict");
});

test("official marker learning recognizes near-complete target coverage", () => {
  const summary = analyzeOfficialNavigationLearning([
    { markerIndex: 0, markerCount: 7, targetOrder: 0, knownTurnCount: 6 },
    { markerIndex: 1, markerCount: 7, targetOrder: 1, knownTurnCount: 6 },
    { markerIndex: 3, markerCount: 7, targetOrder: 2, knownTurnCount: 6 },
    { markerIndex: 4, markerCount: 7, targetOrder: 3, knownTurnCount: 6 },
    { markerIndex: 5, markerCount: 7, targetOrder: 4, knownTurnCount: 6 },
    { markerIndex: 6, markerCount: 7, targetOrder: 5, knownTurnCount: 6 }
  ]);
  assert.equal(summary.targetCoverage, 1);
  assert.equal(summary.monotonic, true);
  assert.equal(summary.recommendedBridgeMode, "learned-index-near-complete");
});


test("official bridge trusts only a repeated current mapping pair", () => {
  const base = { oneToOneObserved: true, monotonic: true, markerConflicts: 0, targetConflicts: 0, markerCount: 66, knownTurnCount: 63 };
  assert.equal(selectTrustedOfficialBridgePair({ learning: { ...base, observedPairs: [{ markerIndex: 25, targetOrder: 22, hits: 1 }] }, targetOrder: 22, markerCount: 66, knownTurnCount: 63 }), null);
  assert.deepEqual(selectTrustedOfficialBridgePair({ learning: { ...base, observedPairs: [{ markerIndex: 25, targetOrder: 22, hits: 2 }] }, targetOrder: 22, markerCount: 66, knownTurnCount: 63 }), { markerIndex: 25, targetOrder: 22, hits: 2 });
});

test("official bridge rejects stale marker or turn counts", () => {
  const learning = { oneToOneObserved: true, monotonic: true, markerConflicts: 0, targetConflicts: 0, markerCount: 66, knownTurnCount: 63, observedPairs: [{ markerIndex: 25, targetOrder: 22, hits: 3 }] };
  assert.equal(selectTrustedOfficialBridgePair({ learning, targetOrder: 22, markerCount: 65, knownTurnCount: 63 }), null);
  assert.equal(selectTrustedOfficialBridgePair({ learning, targetOrder: 22, markerCount: 66, knownTurnCount: 62 }), null);
});
