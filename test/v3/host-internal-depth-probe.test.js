import test from "node:test";
import assert from "node:assert/strict";
import { collectHostInternalDepthProbe, collectL3ExactKeyJoinDryRunMap } from "../../src/v3/diagnostics/host-internal-depth-probe.js";

function makeNode() {
  return {
    parentElement: null,
    getAttribute(name) {
      if (name === "data-thread-user-message-navigation-item-id") return "official-private-marker";
      return null;
    }
  };
}

test("host internal depth probe distinguishes L1, L2 and L3 without exposing raw turn ids", () => {
  const marker = makeNode();
  Object.defineProperty(marker, "__reactProps$probe", {
    value: {
      item: { turnId: "turn-q2", navigationIndex: 7 },
      onClick() {}
    },
    configurable: true
  });
  Object.defineProperty(marker, "__reactFiber$probe", {
    value: {
      tag: 5,
      elementType: "button",
      memoizedProps: { message: { id: "turn-q2" }, virtualIndex: 7 },
      pendingProps: null,
      memoizedState: null,
      return: {
        tag: 0,
        elementType: function NavigationRailItem() {},
        memoizedProps: { threadItem: { turnId: "turn-q2" } },
        pendingProps: null,
        memoizedState: null,
        return: null
      }
    },
    configurable: true
  });

  const scrollContainer = makeNode();
  const conversationRoot = makeNode();
  scrollContainer.parentElement = conversationRoot;
  const windowRef = {
    __codexThreadScrollHandlers: {
      saveNow() {},
      markPointerIntent() {},
      scrollToIndex(index) { return index; }
    }
  };
  const document = {
    querySelectorAll(selector) {
      return selector === "[data-thread-user-message-navigation-item-id]" ? [marker] : [];
    }
  };
  const host = {
    getConversationIdentity: () => ({ host: "local", source: "sidebar-local", stable: true }),
    getScrollContainer: () => scrollContainer,
    conversation: { getConversationRoot: () => conversationRoot }
  };

  const result = collectHostInternalDepthProbe({
    window: windowRef,
    document,
    host,
    turns: [
      { id: "turn-q1", order: 0 },
      { id: "turn-q2", order: 1 }
    ]
  });

  assert.equal(result.level1.codexThreadScrollHandlers.present, true);
  assert.ok(result.level1.codexThreadScrollHandlers.keys.some((entry) => entry.name === "scrollToIndex" && entry.type === "function"));
  assert.equal(result.level2.directKnownTurnMatch, true);
  assert.equal(result.level2.markerSampleCount, 1);
  assert.equal(result.level2.markerSamplesWithKnownTurnMatch, 1);
  assert.ok(result.level2.markerSamples[0].knownTurnMatches.some((entry) => entry.targetOrder === 1 && entry.path.includes("item.turnId")));
  assert.equal(result.level3.directKnownTurnMatch, true);
  assert.equal(result.level3.markerSampleCount, 1);
  assert.equal(result.level3.markerSamplesWithKnownTurnMatch, 1);
  assert.equal(result.level3.shallowestKnownTurnDepth, 0);
  assert.ok(result.level3.markerSamples[0].knownTurnMatches.some((entry) => entry.targetOrder === 1));
  assert.equal(result.conclusion.recommendedDepth, "L1");
  const json = JSON.stringify(result);
  assert.equal(json.includes("turn-q2"), false);
  assert.equal(json.includes("official-private-marker"), false);
});

test("host internal depth probe never invokes accessor properties", () => {
  let getterCalls = 0;
  const marker = makeNode();
  const props = { item: { order: 1 } };
  Object.defineProperty(props, "dangerousMessageId", {
    get() {
      getterCalls += 1;
      return "turn-secret";
    }
  });
  Object.defineProperty(marker, "__reactProps$probe", { value: props });
  const document = { querySelectorAll: () => [marker] };
  const host = {
    getConversationIdentity: () => ({ host: "local", stable: true }),
    getScrollContainer: () => null,
    conversation: { getConversationRoot: () => null }
  };
  collectHostInternalDepthProbe({ window: {}, document, host, turns: [{ id: "turn-secret", order: 0 }] });
  assert.equal(getterCalls, 0);
});

test("host internal depth probe degrades cleanly when React internals are absent", () => {
  const marker = makeNode();
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => [marker] },
    host: {
      getConversationIdentity: () => ({ host: "local", stable: true }),
      getScrollContainer: () => null,
      conversation: { getConversationRoot: () => null }
    },
    turns: [{ id: "q1", order: 0 }]
  });
  assert.equal(result.level2.reactPropsPresent, false);
  assert.equal(result.level3.reactFiberPresent, false);
  assert.equal(result.conclusion.recommendedDepth, "deeper-than-L3");
});

test("host internal depth probe reports pending marker before drawing depth conclusions", () => {
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => [] },
    host: {
      getConversationIdentity: () => ({ host: "local", stable: true }),
      getScrollContainer: () => ({}),
      conversation: { getConversationRoot: () => ({}) }
    },
    turns: [{ id: "q1", order: 0 }]
  });
  assert.equal(result.level0.officialMarkerCount, 0);
  assert.equal(result.conclusion.recommendedDepth, "pending-marker");
});
function makeL3MappedMarker({ markerKey, turnId, allTurnIds = [], sharedTurnId = null }) {
  const marker = makeNode();
  marker.getAttribute = (name) => name === "data-thread-user-message-navigation-item-id" ? markerKey : null;
  const sharedItems = allTurnIds.map((id) => ({ turnKey: id }));
  const publicTurnId = sharedTurnId ?? turnId;
  const depth4 = {
    tag: 0,
    elementType: function TimelineItems() {},
    memoizedProps: { items: sharedItems },
    pendingProps: null,
    memoizedState: null,
    return: null
  };
  const depth3 = {
    tag: 0,
    elementType: function TimelineMarkerTooltip() {},
    memoizedProps: {
      activeItem: { turnKey: publicTurnId },
      items: sharedItems,
      tooltipContent: { props: { item: { turnKey: publicTurnId } } },
      markerRecord: { turnKey: turnId }
    },
    pendingProps: null,
    memoizedState: null,
    return: depth4
  };
  const depth2 = { tag: 0, memoizedProps: null, pendingProps: null, memoizedState: null, return: depth3 };
  const depth1 = { tag: 0, memoizedProps: null, pendingProps: null, memoizedState: null, return: depth2 };
  const depth0 = { tag: 5, elementType: "button", memoizedProps: { onClick() {} }, pendingProps: null, memoizedState: null, return: depth1 };
  Object.defineProperty(marker, "__reactFiber$probe", { value: depth0, configurable: true });
  return marker;
}

test("L3 candidate matrix finds a one-to-one identity pattern while shared Fiber state points every marker at one turn", () => {
  const ids = ["turn-secret-1", "turn-secret-2", "turn-secret-3", "turn-secret-4"];
  const markers = ids.map((turnId, index) => makeL3MappedMarker({
    markerKey: `official-secret-${index + 1}`,
    turnId,
    allTurnIds: ids,
    sharedTurnId: ids[0]
  }));
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => markers },
    host: {
      getConversationIdentity: () => ({ host: "local", source: "sidebar-local", stable: true }),
      getScrollContainer: () => null,
      conversation: { getConversationRoot: () => null }
    },
    turns: ids.map((id, order) => ({ id, order, text: `Private message body ${order + 1}` }))
  });

  const probe = result.l3AutoBridgeProbe;
  assert.equal(probe.markerCount, 4);
  assert.equal(probe.knownTurnCount, 4);
  assert.ok(probe.candidatePatternCount >= 3);
  assert.ok(probe.resolvableCandidatePatternCount >= 2);
  assert.ok(probe.sharedStateCandidateCount >= 1);
  assert.ok(probe.exactOneToOneCandidateCount >= 1);
  assert.equal(probe.resolvedMarkerCount, 4);
  assert.equal(probe.mappedMarkerCount, 4);
  assert.equal(probe.mappedTurnCount, 4);
  assert.equal(probe.unmatchedOfficialCount, 0);
  assert.equal(probe.duplicateTargetCount, 0);
  assert.equal(probe.coverage, 1);
  assert.equal(probe.oneToOne, true);
  assert.equal(probe.bestCandidateResolvedMarkers, 4);
  assert.equal(probe.bestCandidateUniqueTurns, 4);
  assert.equal(probe.bestCandidateDuplicateTargets, 0);
  assert.equal(probe.bestCandidateCoverage, 1);
  assert.equal(probe.bestCandidateOneToOne, true);
  assert.equal(probe.recommendedMode, "probe-candidate-exact-one-to-one");
  const json = JSON.stringify(probe);
  for (const id of ids) assert.equal(json.includes(id), false);
  assert.equal(json.includes("official-secret"), false);
  assert.equal(json.includes("markerRecord"), false);
  assert.equal(json.includes("tooltipContent"), false);
  assert.equal(json.includes("Private message body"), false);
});

test("L3 candidate matrix fails closed when candidate patterns are duplicate or ambiguous", () => {
  const ids = ["turn-a", "turn-b", "turn-c"];
  const duplicateA = makeL3MappedMarker({ markerKey: "marker-a1", turnId: ids[0], allTurnIds: ids, sharedTurnId: ids[0] });
  const duplicateB = makeL3MappedMarker({ markerKey: "marker-a2", turnId: ids[0], allTurnIds: ids, sharedTurnId: ids[0] });
  const ambiguous = makeNode();
  Object.defineProperty(ambiguous, "__reactFiber$probe", {
    value: {
      tag: 5,
      memoizedProps: { candidateItems: [{ turnKey: ids[1] }, { turnKey: ids[2] }] },
      pendingProps: null,
      memoizedState: null,
      return: null
    },
    configurable: true
  });
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => [duplicateA, duplicateB, ambiguous] },
    host: {
      getConversationIdentity: () => ({ host: "local", source: "sidebar-local", stable: true }),
      getScrollContainer: () => null,
      conversation: { getConversationRoot: () => null }
    },
    turns: ids.map((id, order) => ({ id, order }))
  });

  const probe = result.l3AutoBridgeProbe;
  assert.equal(probe.markerCount, 3);
  assert.ok(probe.candidatePatternCount > 0);
  assert.equal(probe.oneToOne, false);
  assert.equal(probe.bestCandidateOneToOne, false);
  assert.ok(probe.sharedStateCandidateCount > 0 || probe.bestCandidateAmbiguousMarkers > 0);
  assert.match(probe.recommendedMode, /^probe-candidate-/);
});

test("L3 candidate matrix allows an extra non-turn official marker when one pattern maps every known turn exactly once", () => {
  const ids = ["turn-one", "turn-two", "turn-three", "turn-four"];
  const markers = ids.map((turnId, index) => makeL3MappedMarker({
    markerKey: `official-${index + 1}`,
    turnId,
    allTurnIds: ids,
    sharedTurnId: ids[0]
  }));
  const extra = makeNode();
  Object.defineProperty(extra, "__reactFiber$probe", {
    value: {
      tag: 5,
      memoizedProps: { activeItem: { turnKey: ids[0] }, items: ids.map((turnKey) => ({ turnKey })) },
      pendingProps: null,
      memoizedState: null,
      return: null
    },
    configurable: true
  });
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => [...markers, extra] },
    host: {
      getConversationIdentity: () => ({ host: "local", source: "sidebar-local", stable: true }),
      getScrollContainer: () => null,
      conversation: { getConversationRoot: () => null }
    },
    turns: ids.map((id, order) => ({ id, order }))
  });

  const probe = result.l3AutoBridgeProbe;
  assert.equal(probe.markerCount, 5);
  assert.equal(probe.knownTurnCount, 4);
  assert.equal(probe.resolvedMarkerCount, 4);
  assert.equal(probe.mappedMarkerCount, 4);
  assert.equal(probe.mappedTurnCount, 4);
  assert.equal(probe.unmatchedOfficialCount, 1);
  assert.equal(probe.noScopedMatchCount, 1);
  assert.equal(probe.coverage, 1);
  assert.equal(probe.oneToOne, true);
  assert.equal(probe.bestCandidateOneToOne, true);
  assert.equal(probe.recommendedMode, "probe-candidate-exact-one-to-one");
});
function makeRelationalMarker({ markerKey, sharedItems, ownItem = null, includeOwnRef = false }) {
  const marker = makeNode();
  marker.getAttribute = (name) => name === "data-thread-user-message-navigation-item-id" ? markerKey : null;
  const depth3 = {
    tag: 0,
    elementType: function TimelineRelationLayer() {},
    memoizedProps: {
      items: sharedItems,
      activeItem: sharedItems[0] ?? null,
      ...(includeOwnRef ? { ownItem } : {})
    },
    pendingProps: null,
    memoizedState: null,
    return: null
  };
  const depth2 = { tag: 0, memoizedProps: null, pendingProps: null, memoizedState: null, return: depth3 };
  const depth1 = { tag: 0, memoizedProps: null, pendingProps: null, memoizedState: null, return: depth2 };
  const depth0 = { tag: 5, key: markerKey, elementType: "button", memoizedProps: { onClick() {} }, pendingProps: null, memoizedState: null, return: depth1 };
  Object.defineProperty(marker, "__reactFiber$probe", { value: depth0, configurable: true });
  return marker;
}

test("L3 relational probe finds an exact one-to-one mapping through shared item object references", () => {
  const ids = ["turn-ref-1", "turn-ref-2", "turn-ref-3", "turn-ref-4"];
  const sharedItems = ids.map((turnKey, index) => ({ turnKey, navKey: `item-ref-${index + 1}` }));
  const markers = sharedItems.map((ownItem, index) => makeRelationalMarker({
    markerKey: `dom-ref-${index + 1}`,
    sharedItems,
    ownItem,
    includeOwnRef: true
  }));
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => markers },
    host: {
      getConversationIdentity: () => ({ host: "local", source: "sidebar-local", stable: true }),
      getScrollContainer: () => null,
      conversation: { getConversationRoot: () => null }
    },
    turns: ids.map((id, order) => ({ id, order }))
  });

  const probe = result.l3AutoBridgeProbe;
  assert.equal(probe.objectRefMappedMarkers, 4);
  assert.equal(probe.objectRefUniqueTurns, 4);
  assert.equal(probe.objectRefConflicts, 0);
  assert.equal(probe.objectRefCoverage, 1);
  assert.equal(probe.objectRefOneToOne, true);
  assert.equal(probe.bestRelationKind, "object-ref");
  assert.equal(probe.bestRelationCoverage, 1);
  assert.equal(probe.bestRelationOneToOne, true);
  assert.equal(probe.recommendedMode, "probe-relation-object-ref-exact-one-to-one");
  const json = JSON.stringify(probe);
  for (const id of ids) assert.equal(json.includes(id), false);
  assert.equal(json.includes("item-ref"), false);
  assert.equal(json.includes("dom-ref"), false);
});

test("L3 relational probe joins private marker keys to shared item keys without exposing either value", () => {
  const ids = ["turn-key-1", "turn-key-2", "turn-key-3", "turn-key-4"];
  const sharedItems = ids.map((turnKey, index) => ({ turnKey, navKey: `nav-secret-${index + 1}` }));
  const markers = sharedItems.map((item) => makeRelationalMarker({ markerKey: item.navKey, sharedItems }));
  const extra = makeRelationalMarker({ markerKey: "aux-secret", sharedItems });
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => [...markers, extra] },
    host: {
      getConversationIdentity: () => ({ host: "local", source: "sidebar-local", stable: true }),
      getScrollContainer: () => null,
      conversation: { getConversationRoot: () => null }
    },
    turns: ids.map((id, order) => ({ id, order }))
  });

  const probe = result.l3AutoBridgeProbe;
  assert.equal(probe.markerCount, 5);
  assert.equal(probe.knownTurnCount, 4);
  assert.equal(probe.keyJoinMappedMarkers, 4);
  assert.equal(probe.keyJoinUniqueTurns, 4);
  assert.equal(probe.keyJoinConflicts, 0);
  assert.equal(probe.keyJoinCoverage, 1);
  assert.equal(probe.keyJoinOneToOne, true);
  assert.equal(probe.bestRelationKind, "key-join");
  assert.equal(probe.bestRelationCoverage, 1);
  assert.equal(probe.bestRelationOneToOne, true);
  assert.ok(probe.positionalAlignmentCandidates >= 1);
  assert.equal(probe.bestPositionalCoverage, 1);
  assert.equal(probe.recommendedMode, "probe-relation-key-join-exact-one-to-one");
  const json = JSON.stringify(probe);
  assert.equal(json.includes("nav-secret"), false);
  assert.equal(json.includes("aux-secret"), false);
});

test("L3 exact key-join dry-run map stays identity-stable across marker DOM reorder", () => {
  const ids = ["turn-dry-1", "turn-dry-2", "turn-dry-3", "turn-dry-4"];
  const sharedItems = ids.map((turnKey, index) => ({ turnKey, navKey: `dry-secret-${index + 1}` }));
  const markers = sharedItems.map((item) => makeRelationalMarker({ markerKey: item.navKey, sharedItems }));
  const extra = makeRelationalMarker({ markerKey: "dry-aux-secret", sharedItems });
  const scan = collectL3ExactKeyJoinDryRunMap({
    document: { querySelectorAll: () => [...markers, extra] },
    turns: ids.map((id, order) => ({ id, order }))
  });
  assert.equal(scan.summary.markerCount, 5);
  assert.equal(scan.summary.knownTurnCount, 4);
  assert.ok(scan.summary.exactPatternCount >= 1);
  assert.equal(scan.summary.mappingAgreement, true);
  assert.equal(scan.summary.mappedTurnCount, 4);
  assert.equal(scan.summary.coverage, 1);
  assert.equal(scan.summary.conflicts, 0);
  assert.equal(scan.summary.oneToOne, true);
  assert.equal(scan.pairsByTarget.size, 4);
  assert.equal(scan.identityByTarget.size, 4);
  assert.ok(scan.patternKey);

  const rebuiltMarkers = sharedItems.map((item) => makeRelationalMarker({ markerKey: item.navKey, sharedItems })).reverse();
  const rebuiltExtra = makeRelationalMarker({ markerKey: "dry-aux-secret", sharedItems });
  const rescanned = collectL3ExactKeyJoinDryRunMap({
    document: { querySelectorAll: () => [rebuiltExtra, ...rebuiltMarkers] },
    turns: ids.map((id, order) => ({ id, order })),
    preferredPattern: scan.patternKey
  });
  assert.equal(rescanned.patternKey, scan.patternKey);
  assert.notEqual(rescanned.pairsByTarget.get(0)?.markerIndex, scan.pairsByTarget.get(0)?.markerIndex);
  const sortIdentityEntries = (map) => [...map.entries()].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sortIdentityEntries(rescanned.identityByTarget), sortIdentityEntries(scan.identityByTarget));
  assert.equal(rescanned.summary.preferredPatternPresent, true);
  assert.equal(typeof rescanned.summary.alternateExactPatternAvailable, "boolean");

  // A vanished preferred pattern must be distinguishable from loss of all exact mappings.
  const alternate = collectL3ExactKeyJoinDryRunMap({
    document: { querySelectorAll: () => [rebuiltExtra, ...rebuiltMarkers] },
    turns: ids.map((id, order) => ({ id, order })),
    preferredPattern: "missing-preferred-pattern"
  });
  assert.equal(alternate.summary.preferredPatternPresent, false);
  assert.equal(alternate.summary.alternateExactPatternAvailable, true);
  assert.equal(alternate.summary.oneToOne, true);
  assert.equal(alternate.summary.coverage, 1);
  const publicJson = JSON.stringify(rescanned.summary);
  assert.equal(publicJson.includes("dry-secret"), false);
  assert.equal(publicJson.includes("turn-dry"), false);
  assert.equal(publicJson.includes("dry-aux-secret"), false);
});

test("L3 dry-run reports partial key-join coverage when no exact pattern survives", () => {
  const ids = ["turn-partial-1", "turn-partial-2", "turn-partial-3", "turn-partial-4"];
  const sharedItems = ids.map((turnKey, index) => ({ turnKey, navKey: `partial-secret-${index + 1}` }));
  const markers = sharedItems.slice(0, 3).map((item) => makeRelationalMarker({ markerKey: item.navKey, sharedItems }));
  const noFiberMarker = makeNode();
  noFiberMarker.getAttribute = (name) => name === "data-thread-user-message-navigation-item-id" ? "partial-unmatched-secret" : null;
  const scan = collectL3ExactKeyJoinDryRunMap({
    document: { querySelectorAll: () => [...markers, noFiberMarker] },
    turns: ids.map((id, order) => ({ id, order }))
  });
  assert.equal(scan.summary.exactPatternCount, 0);
  assert.ok(scan.summary.relationPatternCount >= 1);
  assert.equal(scan.summary.markersWithKeyJoinCandidates, 3);
  assert.equal(scan.summary.keyJoinMappedMarkers, 3);
  assert.equal(scan.summary.keyJoinUniqueTurns, 3);
  assert.equal(scan.summary.bestKeyJoinCoverage, 0.75);
  assert.equal(scan.summary.bestKeyJoinConflicts, 0);
  assert.equal(scan.summary.bestKeyJoinOneToOne, false);
  assert.equal(scan.summary.mappedTurnCount, 0);
  assert.equal(scan.summary.coverage, 0);
  assert.equal(scan.summary.oneToOne, false);
  const json = JSON.stringify(scan.summary);
  assert.equal(json.includes("partial-secret"), false);
  assert.equal(json.includes("turn-partial"), false);
});
test("L3 auto bridge probe never invokes Fiber accessor properties", () => {
  let getterCalls = 0;
  const marker = makeNode();
  const props = { tooltipContent: { props: { item: { turnKey: "turn-safe" } } } };
  Object.defineProperty(props, "secretTurnKey", {
    get() {
      getterCalls += 1;
      return "turn-secret";
    }
  });
  Object.defineProperty(marker, "__reactFiber$probe", {
    value: { tag: 5, memoizedProps: props, pendingProps: null, memoizedState: null, return: null },
    configurable: true
  });
  const result = collectHostInternalDepthProbe({
    window: {},
    document: { querySelectorAll: () => [marker] },
    host: {
      getConversationIdentity: () => ({ host: "local", source: "sidebar-local", stable: true }),
      getScrollContainer: () => null,
      conversation: { getConversationRoot: () => null }
    },
    turns: [{ id: "turn-safe", order: 0 }, { id: "turn-secret", order: 1 }]
  });
  assert.equal(getterCalls, 0);
  assert.equal(result.l3AutoBridgeProbe.mappedMarkerCount, 1);
  assert.equal(JSON.stringify(result.l3AutoBridgeProbe).includes("turn-safe"), false);
  assert.equal(JSON.stringify(result.l3AutoBridgeProbe).includes("turn-secret"), false);
});
