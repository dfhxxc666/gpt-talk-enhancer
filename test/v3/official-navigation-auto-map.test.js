import test from "node:test";
import assert from "node:assert/strict";
import { analyzeOfficialNavigationAutoMap, officialAutoMapSignature, sanitizeOfficialNavigationAutoSummary } from "../../src/v3/diagnostics/official-navigation-auto-map.js";

function marker({ key, label = "", title = "", text = "" } = {}) {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) {
      if (name === "data-thread-user-message-navigation-item-id") return key ?? null;
      if (name === "aria-label") return label || null;
      if (name === "title") return title || null;
      return null;
    }
  };
}

function turns(count) {
  return Array.from({ length: count }, (_, order) => ({ id: `turn-${order + 1}`, order, text: `Question text ${order + 1}`, shortText: `Question text ${order + 1}` }));
}

test("official auto map resolves a full Work rail from explicit Q labels without clicks", () => {
  const buttons = [
    marker({ key: "extra-a", label: "Pinned" }),
    ...Array.from({ length: 8 }, (_, index) => marker({ key: `k${index + 1}`, label: `Jump to Q${index + 1}` })),
    marker({ key: "extra-b", label: "Bottom" })
  ];
  const result = analyzeOfficialNavigationAutoMap({ document: { querySelectorAll: () => buttons }, turns: turns(8) });
  assert.equal(result.summary.readyCandidate, true);
  assert.equal(result.summary.mappedTargetCount, 8);
  assert.equal(result.summary.coverage, 1);
  assert.equal(result.summary.markerConflicts, 0);
  assert.equal(result.summary.targetConflicts, 0);
  assert.equal(result.summary.monotonic, true);
  assert.equal(result.summary.strategyCounts.explicitLabel, 8);
  assert.equal(result.privatePairs[0].targetOrder, 0);
  assert.equal(result.privatePairs.at(-1).targetOrder, 7);
});

test("official auto map can resolve marker keys through current DOM references", () => {
  const buttons = Array.from({ length: 6 }, (_, index) => marker({ key: `marker-${index + 1}` }));
  const result = analyzeOfficialNavigationAutoMap({
    document: { querySelectorAll: () => buttons },
    turns: turns(6),
    resolveMarkerKey: (key) => `turn-${Number(key.split("-").at(-1))}`
  });
  assert.equal(result.summary.readyCandidate, true);
  assert.equal(result.summary.strategyCounts.domReference, 6);
  assert.equal(result.summary.coverage, 1);
});

test("official auto map fails closed on conflicting or sparse evidence", () => {
  const buttons = [
    marker({ key: "a", label: "Q1" }),
    marker({ key: "b", label: "Q1" }),
    marker({ key: "c", label: "Q3" })
  ];
  const result = analyzeOfficialNavigationAutoMap({ document: { querySelectorAll: () => buttons }, turns: turns(8) });
  assert.equal(result.summary.readyCandidate, false);
  assert.ok(result.summary.targetConflicts > 0);
  assert.equal(result.summary.recommendedMode, "fallback-self");
});

test("official auto summary and signature expose no raw marker keys", () => {
  const buttons = Array.from({ length: 5 }, (_, index) => marker({ key: `secret-marker-${index}`, label: `Q${index + 1}` }));
  const result = analyzeOfficialNavigationAutoMap({ document: { querySelectorAll: () => buttons }, turns: turns(5) });
  const summary = sanitizeOfficialNavigationAutoSummary({ ...result.summary, status: "auto-scanning", stableScans: 1 });
  assert.equal(JSON.stringify(summary).includes("secret-marker"), false);
  assert.equal(officialAutoMapSignature(result.privatePairs).includes("secret-marker"), true);
});


test("official auto map fills only equal-size gaps between trusted anchors", () => {
  const buttons = [
    marker({ key: "k1", label: "Q1" }),
    marker({ key: "k2" }),
    marker({ key: "k3" }),
    marker({ key: "k4", label: "Q4" }),
    marker({ key: "extra" }),
    marker({ key: "k5", label: "Q5" })
  ];
  const result = analyzeOfficialNavigationAutoMap({ document: { querySelectorAll: () => buttons }, turns: turns(5) });
  const byTarget = new Map(result.privatePairs.map((pair) => [pair.targetOrder, pair]));
  assert.equal(byTarget.get(1)?.markerIndex, 1);
  assert.equal(byTarget.get(2)?.markerIndex, 2);
  assert.deepEqual(byTarget.get(1)?.strategies, ["sequenceGap"]);
  assert.equal(result.summary.strategyCounts.sequenceGap, 2);
});

test("official auto map never fills an unequal marker/turn gap", () => {
  const buttons = [
    marker({ key: "k1", label: "Q1" }),
    marker({ key: "extra-a" }),
    marker({ key: "k2" }),
    marker({ key: "k3" }),
    marker({ key: "k4", label: "Q4" })
  ];
  const result = analyzeOfficialNavigationAutoMap({ document: { querySelectorAll: () => buttons }, turns: turns(4), minCoverage: 0.4 });
  assert.equal(result.privatePairs.some((pair) => pair.strategies.includes("sequenceGap")), false);
});
