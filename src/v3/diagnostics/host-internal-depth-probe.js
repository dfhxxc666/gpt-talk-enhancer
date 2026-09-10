const CANDIDATE_KEY_RE = /(id|turn|message|thread|nav|index|order|item|scroll|virtual|range|offset)/i;
const REACT_PROPS_PREFIX = '__reactProps$';
const REACT_FIBER_PREFIX = '__reactFiber$';
const REACT_CONTAINER_PREFIX = '__reactContainer$';

export function collectHostInternalDepthProbe({ window: windowRef, document, host, turns = [] } = {}) {
  const orderedTurns = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn?.id && Number.isFinite(turn?.order))
    .map((turn) => ({ id: String(turn.id), order: Number(turn.order) }));
  const orderById = new Map(orderedTurns.map((turn) => [turn.id, turn.order]));
  const markers = Array.from(document?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
  const marker = markers[0] ?? null;
  const markerSample = sampleMarkers(markers, 8);
  const scrollContainer = host?.getScrollContainer?.() ?? null;
  const conversationRoot = host?.conversation?.getConversationRoot?.() ?? scrollContainer?.parentElement ?? null;

  const level1 = collectLevel1(windowRef);
  const level2 = collectReactPropsLayer({ marker, markerSample, scrollContainer, conversationRoot, orderById });
  const level3 = collectFiberLayer({ marker, markerSample, scrollContainer, conversationRoot, orderById });
  const l3AutoBridgeProbe = collectL3AutoBridgeProbe({ markers, orderById });
  return {
    capturedAt: new Date().toISOString(),
    host: host?.getConversationIdentity?.()?.host ?? null,
    level0: {
      officialMarkerCount: markers.length,
      hasScrollContainer: Boolean(scrollContainer),
      markerReactOwnKeys: marker ? reactOwnKeys(marker) : []
    },
    level1,
    level2,
    level3,
    l3AutoBridgeProbe,
    conclusion: summarizeRequiredDepth({ markerCount: markers.length, level1, level2, level3 })
  };
}

export function collectL3ExactKeyJoinDryRunMap({ document, turns = [], preferredPattern = null } = {}) {
  const orderedTurns = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn?.id && Number.isFinite(turn?.order))
    .map((turn) => ({ id: String(turn.id), order: Number(turn.order) }));
  const orderById = new Map(orderedTurns.map((turn) => [turn.id, turn.order]));
  const markers = Array.from(document?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
  return collectExactKeyJoinMap({ markers, orderById, preferredPattern });
}
function collectLevel1(windowRef) {
  const handlers = safeDataValue(windowRef, '__codexThreadScrollHandlers');
  const globals = [];
  for (const name of safeOwnNames(windowRef)) {
    if (!/(codex|thread|scroll|nav|virtual|message)/i.test(name)) continue;
    const value = safeDataValue(windowRef, name);
    if (value == null) continue;
    globals.push({
      name,
      type: valueType(value),
      keys: isPlainInspectable(value) ? describeOwnKeys(value, 30) : []
    });
    if (globals.length >= 20) break;
  }
  return {
    codexThreadScrollHandlers: handlers == null ? { present: false, keys: [] } : {
      present: true,
      keys: describeOwnKeys(handlers, 50)
    },
    matchingGlobals: globals
  };
}

function collectReactPropsLayer({ marker, markerSample = [], scrollContainer, conversationRoot, orderById }) {
  const targets = [
    ['official-marker', marker],
    ['scroll-container', scrollContainer],
    ['conversation-root', conversationRoot]
  ];
  const inspected = [];
  for (const [label, node] of targets) {
    if (!node) continue;
    const propKey = reactOwnKeys(node).find((key) => key.startsWith(REACT_PROPS_PREFIX));
    if (!propKey) {
      inspected.push({ target: label, present: false, candidatePaths: [], knownTurnMatches: [] });
      continue;
    }
    const props = safeDataValue(node, propKey);
    inspected.push({
      target: label,
      present: Boolean(props),
      candidatePaths: collectCandidatePaths(props, { maxDepth: 4, maxNodes: 350 }),
      knownTurnMatches: findKnownTurnMatches(props, orderById, { maxDepth: 4, maxNodes: 500 })
    });
  }
  const markerSamples = markerSample.map((node, sampleIndex) => {
    const propKey = reactOwnKeys(node).find((key) => key.startsWith(REACT_PROPS_PREFIX));
    const props = propKey ? safeDataValue(node, propKey) : null;
    return {
      sampleIndex,
      present: Boolean(props),
      candidatePaths: props ? collectCandidatePaths(props, { maxDepth: 5, maxNodes: 700 }) : [],
      knownTurnMatches: props ? findKnownTurnMatches(props, orderById, { maxDepth: 5, maxNodes: 900 }) : [],
      handlerTraits: props ? collectHandlerTraits(props, { maxDepth: 3, maxNodes: 220 }) : []
    };
  });
  return {
    reactPropsPresent: inspected.some((entry) => entry.present) || markerSamples.some((entry) => entry.present),
    directKnownTurnMatch: inspected.some((entry) => entry.knownTurnMatches.length > 0) || markerSamples.some((entry) => entry.knownTurnMatches.length > 0),
    inspected,
    markerSamples,
    markerSampleCount: markerSamples.length,
    markerSamplesWithKnownTurnMatch: markerSamples.filter((entry) => entry.knownTurnMatches.length > 0).length
  };
}

function collectFiberLayer({ marker, markerSample = [], scrollContainer, conversationRoot, orderById }) {
  const targets = [
    ['official-marker', marker],
    ['scroll-container', scrollContainer],
    ['conversation-root', conversationRoot]
  ];
  const inspected = [];
  for (const [label, node] of targets) {
    if (!node) continue;
    const ownKeys = reactOwnKeys(node);
    const fiberKey = ownKeys.find((key) => key.startsWith(REACT_FIBER_PREFIX) || key.startsWith(REACT_CONTAINER_PREFIX));
    if (!fiberKey) {
      inspected.push({ target: label, present: false, componentChain: [], knownTurnMatches: [], candidatePaths: [] });
      continue;
    }
    let fiber = safeDataValue(node, fiberKey);
    const componentChain = [];
    const knownTurnMatches = [];
    const candidatePaths = [];
    const seen = new Set();
    for (let depth = 0; fiber && depth < 12 && !seen.has(fiber); depth += 1) {
      seen.add(fiber);
      componentChain.push(describeFiber(fiber));
      for (const propName of ['memoizedProps', 'pendingProps', 'memoizedState']) {
        const value = safeDataValue(fiber, propName);
        if (value == null) continue;
        const prefix = `fiber[${depth}].${propName}`;
        for (const hit of findKnownTurnMatches(value, orderById, { maxDepth: 3, maxNodes: 220 })) {
          knownTurnMatches.push({ ...hit, path: `${prefix}.${hit.path}` });
        }
        for (const hit of collectCandidatePaths(value, { maxDepth: 3, maxNodes: 180 })) {
          candidatePaths.push({ ...hit, path: `${prefix}.${hit.path}` });
        }
      }
      fiber = safeDataValue(fiber, 'return');
    }
    inspected.push({
      target: label,
      present: true,
      componentChain,
      knownTurnMatches: dedupeMatches(knownTurnMatches).slice(0, 40),
      candidatePaths: dedupePaths(candidatePaths).slice(0, 60)
    });
  }
  const markerSamples = markerSample.map((node, sampleIndex) => collectMarkerFiberSample(node, sampleIndex, orderById));
  return {
    reactFiberPresent: inspected.some((entry) => entry.present) || markerSamples.some((entry) => entry.present),
    directKnownTurnMatch: inspected.some((entry) => entry.knownTurnMatches.length > 0) || markerSamples.some((entry) => entry.knownTurnMatches.length > 0),
    inspected,
    markerSamples,
    markerSampleCount: markerSamples.length,
    markerSamplesWithKnownTurnMatch: markerSamples.filter((entry) => entry.knownTurnMatches.length > 0).length,
    shallowestKnownTurnDepth: minKnownTurnDepth(markerSamples)
  };
}

function collectL3AutoBridgeProbe({ markers = [], orderById = new Map() } = {}) {
  const markerList = Array.isArray(markers) ? markers : [];
  const knownTurnCount = orderById instanceof Map ? orderById.size : 0;
  const patterns = new Map();

  markerList.forEach((marker, markerIndex) => {
    const byPattern = new Map();
    for (const candidate of collectMarkerCandidateMatches(marker, orderById)) {
      const targets = byPattern.get(candidate.pattern) ?? new Set();
      targets.add(candidate.targetOrder);
      byPattern.set(candidate.pattern, targets);
    }
    for (const [pattern, targets] of byPattern.entries()) {
      let record = patterns.get(pattern);
      if (!record) {
        record = { markerTargets: new Map() };
        patterns.set(pattern, record);
      }
      record.markerTargets.set(markerIndex, targets);
    }
  });

  const summaries = [...patterns.values()].map((record) => summarizeCandidatePattern({
    markerCount: markerList.length,
    knownTurnCount,
    markerTargets: record.markerTargets
  }));
  summaries.sort(compareCandidatePatternSummaries);
  const best = summaries[0] ?? emptyCandidatePatternSummary(markerList.length, knownTurnCount);
  const candidatePatternCount = summaries.length;
  const resolvableCandidatePatternCount = summaries.filter((summary) => summary.resolvedMarkerCount > 0).length;
  const exactOneToOneCandidateCount = summaries.filter((summary) => summary.oneToOne).length;
  const sharedStateCandidateCount = summaries.filter((summary) => summary.sharedState).length;
  const partialCandidateCount = summaries.filter((summary) => summary.partial).length;
  const relational = collectL3RelationalProbe({ markers: markerList, orderById });

  let recommendedMode = 'probe-insufficient';
  if (markerList.length === 0) recommendedMode = 'probe-pending-marker';
  else if (knownTurnCount === 0) recommendedMode = 'probe-insufficient-known-turns';
  else if (relational.objectRef.oneToOne) recommendedMode = 'probe-relation-object-ref-exact-one-to-one';
  else if (relational.keyJoin.oneToOne) recommendedMode = 'probe-relation-key-join-exact-one-to-one';
  else if (relational.best.coverage >= 0.95 && relational.best.conflicts === 0) recommendedMode = 'probe-relation-near-complete';
  else if (relational.best.mappedTurnCount > 0) recommendedMode = 'probe-relation-partial';
  else if (best.oneToOne) recommendedMode = 'probe-candidate-exact-one-to-one';
  else if (best.coverage >= 0.95 && best.duplicateTargetCount === 0 && best.ambiguousMarkerCount === 0) recommendedMode = 'probe-candidate-near-complete';
  else if (best.mappedTurnCount > 0) recommendedMode = 'probe-candidate-partial';
  else if (candidatePatternCount > 0) recommendedMode = 'probe-candidate-conflict';

  return {
    markerCount: markerList.length,
    knownTurnCount,
    candidatePatternCount,
    resolvableCandidatePatternCount,
    exactOneToOneCandidateCount,
    sharedStateCandidateCount,
    partialCandidateCount,
    resolvedMarkerCount: best.resolvedMarkerCount,
    mappedMarkerCount: best.mappedMarkerCount,
    mappedTurnCount: best.mappedTurnCount,
    unmatchedOfficialCount: best.unmatchedOfficialCount,
    ambiguousMarkerCount: best.ambiguousMarkerCount,
    duplicateTargetCount: best.duplicateTargetCount,
    noScopedMatchCount: best.noPatternMatchCount,
    conflicts: best.ambiguousMarkerCount + best.duplicateTargetCount,
    coverage: best.coverage,
    oneToOne: best.oneToOne,
    bestCandidateResolvedMarkers: best.resolvedMarkerCount,
    bestCandidateUniqueTurns: best.uniqueTurnCount,
    bestCandidateDuplicateTargets: best.duplicateTargetCount,
    bestCandidateAmbiguousMarkers: best.ambiguousMarkerCount,
    bestCandidateCoverage: best.coverage,
    bestCandidateOneToOne: best.oneToOne,
    objectRefMappedMarkers: relational.objectRef.mappedMarkerCount,
    objectRefUniqueTurns: relational.objectRef.uniqueTurnCount,
    objectRefConflicts: relational.objectRef.conflicts,
    objectRefCoverage: relational.objectRef.coverage,
    objectRefOneToOne: relational.objectRef.oneToOne,
    keyJoinMappedMarkers: relational.keyJoin.mappedMarkerCount,
    keyJoinUniqueTurns: relational.keyJoin.uniqueTurnCount,
    keyJoinConflicts: relational.keyJoin.conflicts,
    keyJoinCoverage: relational.keyJoin.coverage,
    keyJoinOneToOne: relational.keyJoin.oneToOne,
    positionalAlignmentCandidates: relational.positionalAlignmentCandidates,
    bestPositionalCoverage: relational.bestPositionalCoverage,
    bestRelationKind: relational.best.kind,
    bestRelationMappedMarkers: relational.best.mappedMarkerCount,
    bestRelationUniqueTurns: relational.best.uniqueTurnCount,
    bestRelationConflicts: relational.best.conflicts,
    bestRelationCoverage: relational.best.coverage,
    bestRelationOneToOne: relational.best.oneToOne,
    recommendedMode
  };
}

function collectMarkerCandidateMatches(node, orderById) {
  if (!node || !(orderById instanceof Map) || orderById.size === 0) return [];
  const ownKeys = reactOwnKeys(node);
  const fiberKey = ownKeys.find((key) => key.startsWith(REACT_FIBER_PREFIX) || key.startsWith(REACT_CONTAINER_PREFIX));
  if (!fiberKey) return [];
  let fiber = safeDataValue(node, fiberKey);
  const seen = new Set();
  const candidates = [];
  const dedupe = new Set();
  for (let depth = 0; fiber && depth < 20 && !seen.has(fiber); depth += 1) {
    seen.add(fiber);
    for (const propName of ['memoizedProps', 'pendingProps', 'memoizedState']) {
      const value = safeDataValue(fiber, propName);
      if (value == null) continue;
      for (const hit of findKnownTurnMatches(value, orderById, { maxDepth: 6, maxNodes: 1200 })) {
        const pattern = normalizeCandidatePattern(`fiber[${depth}].${propName}.${hit.path}`);
        const key = `${pattern}\u0000${hit.targetOrder}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        candidates.push({ pattern, targetOrder: hit.targetOrder });
      }
    }
    fiber = safeDataValue(fiber, 'return');
  }
  return candidates;
}

function normalizeCandidatePattern(path) {
  return String(path ?? '')
    .replace(/\[\d+\]/g, '[*]')
    .replace(/(^|\.)\d+(?=\.|$)/g, '$1[*]');
}

function summarizeCandidatePattern({ markerCount = 0, knownTurnCount = 0, markerTargets = new Map() } = {}) {
  let resolvedMarkerCount = 0;
  let ambiguousMarkerCount = 0;
  const targetCounts = new Map();
  for (const targets of markerTargets.values()) {
    if (!(targets instanceof Set) || targets.size === 0) continue;
    if (targets.size > 1) {
      ambiguousMarkerCount += 1;
      continue;
    }
    const targetOrder = [...targets][0];
    resolvedMarkerCount += 1;
    targetCounts.set(targetOrder, Number(targetCounts.get(targetOrder) ?? 0) + 1);
  }
  const duplicateTargets = new Set([...targetCounts.entries()].filter(([, count]) => count > 1).map(([targetOrder]) => targetOrder));
  const duplicateTargetCount = duplicateTargets.size;
  const conflictFreeCounts = [...targetCounts.entries()].filter(([targetOrder]) => !duplicateTargets.has(targetOrder));
  const mappedTurnCount = conflictFreeCounts.length;
  const mappedMarkerCount = conflictFreeCounts.reduce((sum, [, count]) => sum + count, 0);
  const uniqueTurnCount = targetCounts.size;
  const noPatternMatchCount = Math.max(0, markerCount - markerTargets.size);
  const unmatchedOfficialCount = Math.max(0, markerCount - mappedMarkerCount);
  const coverage = knownTurnCount > 0 ? roundRatio(mappedTurnCount / knownTurnCount) : 0;
  const oneToOne = knownTurnCount > 0
    && ambiguousMarkerCount === 0
    && duplicateTargetCount === 0
    && resolvedMarkerCount === knownTurnCount
    && uniqueTurnCount === knownTurnCount;
  const sharedState = resolvedMarkerCount >= 2 && duplicateTargetCount > 0 && uniqueTurnCount < resolvedMarkerCount;
  const partial = !oneToOne && mappedTurnCount > 0 && duplicateTargetCount === 0 && ambiguousMarkerCount === 0;
  return {
    resolvedMarkerCount,
    mappedMarkerCount,
    mappedTurnCount,
    uniqueTurnCount,
    unmatchedOfficialCount,
    ambiguousMarkerCount,
    duplicateTargetCount,
    noPatternMatchCount,
    coverage,
    oneToOne,
    sharedState,
    partial
  };
}

function emptyCandidatePatternSummary(markerCount, knownTurnCount) {
  return summarizeCandidatePattern({ markerCount, knownTurnCount, markerTargets: new Map() });
}

function compareCandidatePatternSummaries(a, b) {
  if (Boolean(a.oneToOne) !== Boolean(b.oneToOne)) return a.oneToOne ? -1 : 1;
  const aConflicts = Number(a.duplicateTargetCount || 0) + Number(a.ambiguousMarkerCount || 0);
  const bConflicts = Number(b.duplicateTargetCount || 0) + Number(b.ambiguousMarkerCount || 0);
  const aConflictFree = aConflicts === 0;
  const bConflictFree = bConflicts === 0;
  if (aConflictFree !== bConflictFree) return aConflictFree ? -1 : 1;
  if (a.mappedTurnCount !== b.mappedTurnCount) return b.mappedTurnCount - a.mappedTurnCount;
  if (a.uniqueTurnCount !== b.uniqueTurnCount) return b.uniqueTurnCount - a.uniqueTurnCount;
  if (aConflicts !== bConflicts) return aConflicts - bConflicts;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  return b.resolvedMarkerCount - a.resolvedMarkerCount;
}

const RELATION_JOIN_KEY_RE = /(?:id|key|marker|nav)/i;

function collectL3RelationalProbe({ markers = [], orderById = new Map() } = {}) {
  const markerList = Array.isArray(markers) ? markers : [];
  const knownTurnCount = orderById instanceof Map ? orderById.size : 0;
  const objectPatterns = new Map();
  const keyPatterns = new Map();
  const positionalCollections = new Map();

  markerList.forEach((marker, markerIndex) => {
    const relations = collectMarkerRelationMatches(marker, orderById);
    addRelationCandidates(objectPatterns, markerIndex, relations.objectRefs);
    addRelationCandidates(keyPatterns, markerIndex, relations.keyJoins);
    for (const collection of relations.collections) {
      if (!positionalCollections.has(collection.pattern)) positionalCollections.set(collection.pattern, collection.targetOrders);
    }
  });

  const objectRef = summarizeBestRelationPatterns(objectPatterns, markerList.length, knownTurnCount, 'object-ref');
  const keyJoin = summarizeBestRelationPatterns(keyPatterns, markerList.length, knownTurnCount, 'key-join');
  const positional = summarizePositionalAlignments({
    markerCount: markerList.length,
    knownTurnCount,
    collections: [...positionalCollections.values()]
  });
  const best = compareRelationSummaries(objectRef, keyJoin) <= 0 ? objectRef : keyJoin;
  return {
    objectRef,
    keyJoin,
    positionalAlignmentCandidates: positional.candidateCount,
    bestPositionalCoverage: positional.bestCoverage,
    best
  };
}

function collectMarkerRelationMatches(node, orderById) {
  if (!node || !(orderById instanceof Map) || orderById.size === 0) return { objectRefs: [], keyJoins: [], collections: [] };
  const ownKeys = reactOwnKeys(node);
  const fiberKey = ownKeys.find((key) => key.startsWith(REACT_FIBER_PREFIX) || key.startsWith(REACT_CONTAINER_PREFIX));
  if (!fiberKey) return { objectRefs: [], keyJoins: [], collections: [] };
  let fiber = safeDataValue(node, fiberKey);
  const seen = new Set();
  const localObjects = [];
  const localTokens = [];
  const collections = [];

  const markerKey = safeAttributeValue(node, 'data-thread-user-message-navigation-item-id');
  if (isRelationScalar(markerKey)) localTokens.push({ path: 'dom.markerKey', value: markerKey });

  for (let depth = 0; fiber && depth < 20 && !seen.has(fiber); depth += 1) {
    seen.add(fiber);
    const fiberKeyValue = safeDataValue(fiber, 'key');
    if (isRelationScalar(fiberKeyValue)) localTokens.push({ path: `fiber[${depth}].key`, value: fiberKeyValue });
    for (const propName of ['memoizedProps', 'pendingProps', 'memoizedState']) {
      const value = safeDataValue(fiber, propName);
      if (value == null) continue;
      const prefix = `fiber[${depth}].${propName}`;
      localObjects.push(...collectNonArrayObjectRefs(value, prefix, { maxDepth: 5, maxNodes: 500 }));
      localTokens.push(...collectRelationJoinTokens(value, prefix, orderById, { maxDepth: 5, maxNodes: 500 }));
      collections.push(...collectTurnItemCollections(value, prefix, orderById, { maxDepth: 5, maxNodes: 700 }));
    }
    fiber = safeDataValue(fiber, 'return');
  }

  const objectRefs = [];
  const keyJoins = [];
  const objectSeen = new Set();
  const keySeen = new Set();
  for (const collection of collections) {
    const itemByObject = new Map(collection.items.map((item) => [item.object, item]));
    for (const local of localObjects) {
      const item = itemByObject.get(local.object);
      if (!item) continue;
      const pattern = `ref:${normalizeCandidatePattern(local.path)}=>${collection.pattern}`;
      const dedupeKey = `${pattern}\u0000${item.targetOrder}`;
      if (objectSeen.has(dedupeKey)) continue;
      objectSeen.add(dedupeKey);
      objectRefs.push({ pattern, targetOrder: item.targetOrder });
    }
    for (const local of localTokens) {
      for (const item of collection.items) {
        for (const token of item.tokens) {
          if (!relationScalarEqual(local.value, token.value)) continue;
          const pattern = `key:${normalizeCandidatePattern(local.path)}=>${collection.pattern}.${normalizeCandidatePattern(token.path)}`;
          const dedupeKey = `${pattern}\u0000${item.targetOrder}`;
          if (keySeen.has(dedupeKey)) continue;
          keySeen.add(dedupeKey);
          keyJoins.push({ pattern, targetOrder: item.targetOrder, identity: local.value });
        }
      }
    }
  }
  const collectionSummaries = collections.map((collection) => ({
    pattern: collection.pattern,
    targetOrders: collection.items.map((item) => item.targetOrder)
  }));
  return { objectRefs, keyJoins, collections: collectionSummaries };
}

function collectTurnItemCollections(root, prefix, orderById, { maxDepth = 5, maxNodes = 600 } = {}) {
  const queue = [{ value: root, path: prefix, depth: 0 }];
  const seen = new Set();
  const out = [];
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const current = queue.shift();
    const value = current.value;
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    if (Array.isArray(value)) {
      const items = [];
      const limit = Math.min(value.length, Math.max(128, orderById.size + 8));
      for (let index = 0; index < limit; index += 1) {
        const item = value[index];
        if (!item || typeof item !== 'object') continue;
        const orders = new Set(findKnownTurnMatches(item, orderById, { maxDepth: 4, maxNodes: 180 }).map((hit) => hit.targetOrder));
        if (orders.size !== 1) continue;
        items.push({
          object: item,
          targetOrder: [...orders][0],
          tokens: collectRelationJoinTokens(item, '', orderById, { maxDepth: 4, maxNodes: 180, includeTurnKeys: true })
        });
      }
      if (items.length >= 2) out.push({ pattern: normalizeCandidatePattern(current.path), items });
      continue;
    }
    if (current.depth >= maxDepth) continue;
    for (const [key, descriptor] of Object.entries(safeDescriptors(value))) {
      if (!('value' in descriptor)) continue;
      const child = descriptor.value;
      if (!child || (typeof child !== 'object' && typeof child !== 'function')) continue;
      const path = current.path ? `${current.path}.${key}` : key;
      queue.push({ value: child, path, depth: current.depth + 1 });
    }
  }
  return dedupeCollections(out);
}

function collectNonArrayObjectRefs(root, prefix, { maxDepth = 5, maxNodes = 400 } = {}) {
  const queue = [{ value: root, path: prefix, depth: 0 }];
  const seen = new Set();
  const out = [];
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const current = queue.shift();
    const value = current.value;
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || Array.isArray(value) || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    if (current.depth >= maxDepth) continue;
    for (const [key, descriptor] of Object.entries(safeDescriptors(value))) {
      if (!('value' in descriptor)) continue;
      const child = descriptor.value;
      const path = current.path ? `${current.path}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        out.push({ path, object: child });
        queue.push({ value: child, path, depth: current.depth + 1 });
      }
    }
  }
  return out;
}

function collectRelationJoinTokens(root, prefix, orderById, { maxDepth = 5, maxNodes = 400, includeTurnKeys = false } = {}) {
  const queue = [{ value: root, path: prefix, depth: 0 }];
  const seen = new Set();
  const out = [];
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const current = queue.shift();
    const value = current.value;
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || Array.isArray(value) || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    if (current.depth >= maxDepth) continue;
    for (const [key, descriptor] of Object.entries(safeDescriptors(value))) {
      if (!('value' in descriptor)) continue;
      const child = descriptor.value;
      const path = current.path ? `${current.path}.${key}` : key;
      if (isRelationScalar(child)) {
        const terminal = String(key);
        const isTurnKey = /^(?:turnKey|turnId)$/i.test(terminal);
        if (isTurnKey ? includeTurnKeys : RELATION_JOIN_KEY_RE.test(terminal)) out.push({ path, value: child });
      } else if (child && typeof child === 'object' && !Array.isArray(child)) {
        queue.push({ value: child, path, depth: current.depth + 1 });
      }
    }
  }
  return out;
}

function addRelationCandidates(patterns, markerIndex, candidates) {
  const byPattern = new Map();
  for (const candidate of candidates ?? []) {
    const targets = byPattern.get(candidate.pattern) ?? new Set();
    targets.add(candidate.targetOrder);
    byPattern.set(candidate.pattern, targets);
  }
  for (const [pattern, targets] of byPattern.entries()) {
    let markerTargets = patterns.get(pattern);
    if (!markerTargets) {
      markerTargets = new Map();
      patterns.set(pattern, markerTargets);
    }
    markerTargets.set(markerIndex, targets);
  }
}

function summarizeBestRelationPatterns(patterns, markerCount, knownTurnCount, kind) {
  const summaries = [...patterns.values()].map((markerTargets) => ({
    ...summarizeCandidatePattern({ markerCount, knownTurnCount, markerTargets }),
    kind
  }));
  summaries.sort(compareCandidatePatternSummaries);
  const best = summaries[0] ?? { ...emptyCandidatePatternSummary(markerCount, knownTurnCount), kind };
  return { ...best, conflicts: best.ambiguousMarkerCount + best.duplicateTargetCount };
}

function collectExactKeyJoinMap({ markers = [], orderById = new Map(), preferredPattern = null } = {}) {
  const markerList = Array.isArray(markers) ? markers : [];
  const knownTurnCount = orderById instanceof Map ? orderById.size : 0;
  const patterns = new Map();
  markerList.forEach((marker, markerIndex) => {
    const byPattern = new Map();
    for (const candidate of collectMarkerRelationMatches(marker, orderById).keyJoins) {
      let entry = byPattern.get(candidate.pattern);
      if (!entry) {
        entry = { targets: new Set(), identitiesByTarget: new Map() };
        byPattern.set(candidate.pattern, entry);
      }
      entry.targets.add(candidate.targetOrder);
      let identities = entry.identitiesByTarget.get(candidate.targetOrder);
      if (!identities) {
        identities = new Set();
        entry.identitiesByTarget.set(candidate.targetOrder, identities);
      }
      identities.add(candidate.identity);
    }
    for (const [pattern, entry] of byPattern.entries()) {
      let markerEntries = patterns.get(pattern);
      if (!markerEntries) {
        markerEntries = new Map();
        patterns.set(pattern, markerEntries);
      }
      markerEntries.set(markerIndex, { marker, ...entry });
    }
  });

  const markersWithKeyJoinCandidates = new Set();
  const keyJoinPatternSummaries = [];
  for (const markerEntries of patterns.values()) {
    for (const markerIndex of markerEntries.keys()) markersWithKeyJoinCandidates.add(markerIndex);
    const markerTargets = new Map([...markerEntries.entries()].map(([markerIndex, entry]) => [markerIndex, entry.targets]));
    keyJoinPatternSummaries.push(summarizeCandidatePattern({ markerCount: markerList.length, knownTurnCount, markerTargets }));
  }
  keyJoinPatternSummaries.sort(compareCandidatePatternSummaries);
  const bestKeyJoin = keyJoinPatternSummaries[0] ?? emptyCandidatePatternSummary(markerList.length, knownTurnCount);
  const bestKeyJoinConflicts = Number(bestKeyJoin.ambiguousMarkerCount || 0) + Number(bestKeyJoin.duplicateTargetCount || 0);
  const exact = [];
  for (const [pattern, markerEntries] of patterns.entries()) {
    const markerTargets = new Map([...markerEntries.entries()].map(([markerIndex, entry]) => [markerIndex, entry.targets]));
    const summary = summarizeCandidatePattern({ markerCount: markerList.length, knownTurnCount, markerTargets });
    if (!summary.oneToOne) continue;
    const pairsByTarget = new Map();
    const identityByTarget = new Map();
    let identityAmbiguous = false;
    for (const [markerIndex, entry] of markerEntries.entries()) {
      if (!(entry.targets instanceof Set) || entry.targets.size !== 1) continue;
      const targetOrder = [...entry.targets][0];
      const identities = entry.identitiesByTarget?.get(targetOrder);
      if (!(identities instanceof Set) || identities.size !== 1) {
        identityAmbiguous = true;
        break;
      }
      const identity = [...identities][0];
      pairsByTarget.set(targetOrder, { marker: entry.marker, markerIndex });
      identityByTarget.set(targetOrder, identity);
    }
    if (identityAmbiguous || identityByTarget.size !== knownTurnCount) continue;
    exact.push({ pattern, summary, pairsByTarget, identityByTarget });
  }

  exact.sort((a, b) => String(a.pattern).localeCompare(String(b.pattern)));
  const preferred = preferredPattern ? exact.find((entry) => entry.pattern === preferredPattern) ?? null : null;
  const preferredPatternPresent = preferredPattern ? Boolean(preferred) : null;
  const alternateExactPatternAvailable = preferredPattern ? exact.some((entry) => entry.pattern !== preferredPattern) : null;
  const selected = preferred ?? exact[0] ?? null;
  const mappingAgreement = Boolean(selected);
  return {
    summary: {
      markerCount: markerList.length,
      knownTurnCount,
      exactPatternCount: exact.length,
      relationPatternCount: patterns.size,
      markersWithKeyJoinCandidates: markersWithKeyJoinCandidates.size,
      keyJoinMappedMarkers: bestKeyJoin.mappedMarkerCount,
      keyJoinUniqueTurns: bestKeyJoin.uniqueTurnCount,
      bestKeyJoinCoverage: bestKeyJoin.coverage,
      bestKeyJoinConflicts,
      bestKeyJoinOneToOne: Boolean(bestKeyJoin.oneToOne),
      mappingAgreement,
      preferredPatternPresent,
      alternateExactPatternAvailable,
      mappedTurnCount: selected?.summary?.mappedTurnCount ?? 0,
      coverage: selected?.summary?.coverage ?? 0,
      conflicts: selected ? 0 : (exact.length > 0 ? 1 : 0),
      oneToOne: Boolean(selected?.summary?.oneToOne)
    },
    pairsByTarget: selected?.pairsByTarget ?? new Map(),
    identityByTarget: selected?.identityByTarget ?? new Map(),
    patternKey: selected?.pattern ?? ''
  };
}
function compareRelationSummaries(a, b) {
  if (Boolean(a.oneToOne) !== Boolean(b.oneToOne)) return a.oneToOne ? -1 : 1;
  if (a.mappedTurnCount !== b.mappedTurnCount) return b.mappedTurnCount - a.mappedTurnCount;
  if (a.conflicts !== b.conflicts) return a.conflicts - b.conflicts;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  return b.resolvedMarkerCount - a.resolvedMarkerCount;
}

function summarizePositionalAlignments({ markerCount = 0, knownTurnCount = 0, collections = [] } = {}) {
  let candidateCount = 0;
  let bestMappedTurns = 0;
  for (const orders of collections) {
    if (!Array.isArray(orders) || orders.length === 0) continue;
    const maxOffset = Math.max(markerCount, orders.length);
    for (let offset = -maxOffset; offset <= maxOffset; offset += 1) {
      const mapped = [];
      for (let markerIndex = 0; markerIndex < markerCount; markerIndex += 1) {
        const itemIndex = markerIndex + offset;
        if (itemIndex < 0 || itemIndex >= orders.length) continue;
        const order = orders[itemIndex];
        if (Number.isInteger(order)) mapped.push(order);
      }
      const unique = new Set(mapped);
      bestMappedTurns = Math.max(bestMappedTurns, unique.size);
      if (knownTurnCount > 0 && mapped.length === knownTurnCount && unique.size === knownTurnCount) candidateCount += 1;
    }
  }
  return {
    candidateCount,
    bestCoverage: knownTurnCount > 0 ? roundRatio(bestMappedTurns / knownTurnCount) : 0
  };
}

function dedupeCollections(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.pattern}\u0000${value.items.map((item) => item.targetOrder).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRelationScalar(value) {
  if (typeof value === 'string') return value.length > 0 && value.length <= 256;
  return Number.isFinite(value);
}

function relationScalarEqual(a, b) {
  return typeof a === typeof b && a === b;
}

function safeAttributeValue(node, name) {
  try {
    const value = node?.getAttribute?.(name);
    return value == null ? null : String(value);
  } catch {
    return null;
  }
}

function roundRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 1000) / 1000));
}

function collectMarkerFiberSample(node, sampleIndex, orderById) {
  const ownKeys = reactOwnKeys(node);
  const fiberKey = ownKeys.find((key) => key.startsWith(REACT_FIBER_PREFIX) || key.startsWith(REACT_CONTAINER_PREFIX));
  if (!fiberKey) return { sampleIndex, present: false, componentChain: [], knownTurnMatches: [], candidatePaths: [], handlerTraits: [] };
  let fiber = safeDataValue(node, fiberKey);
  const componentChain = [];
  const knownTurnMatches = [];
  const candidatePaths = [];
  const handlerTraits = [];
  const seen = new Set();
  for (let depth = 0; fiber && depth < 20 && !seen.has(fiber); depth += 1) {
    seen.add(fiber);
    componentChain.push(describeFiber(fiber));
    for (const propName of ['memoizedProps', 'pendingProps', 'memoizedState']) {
      const value = safeDataValue(fiber, propName);
      if (value == null) continue;
      const prefix = `fiber[${depth}].${propName}`;
      for (const hit of findKnownTurnMatches(value, orderById, { maxDepth: 5, maxNodes: 800 })) knownTurnMatches.push({ ...hit, path: `${prefix}.${hit.path}`, fiberDepth: depth });
      for (const hit of collectCandidatePaths(value, { maxDepth: 4, maxNodes: 500 })) candidatePaths.push({ ...hit, path: `${prefix}.${hit.path}` });
      for (const hit of collectHandlerTraits(value, { maxDepth: 3, maxNodes: 220 })) handlerTraits.push({ ...hit, path: `${prefix}.${hit.path}` });
    }
    fiber = safeDataValue(fiber, 'return');
  }
  return {
    sampleIndex,
    present: true,
    componentChain,
    knownTurnMatches: dedupeMatches(knownTurnMatches).slice(0, 80),
    candidatePaths: dedupePaths(candidatePaths).slice(0, 100),
    handlerTraits: dedupeHandlerTraits(handlerTraits).slice(0, 60)
  };
}

function minKnownTurnDepth(samples) {
  const depths = samples.flatMap((entry) => entry.knownTurnMatches ?? []).map((entry) => entry.fiberDepth).filter(Number.isFinite);
  return depths.length ? Math.min(...depths) : null;
}

function sampleMarkers(markers, limit) {
  if (!Array.isArray(markers) || markers.length <= limit) return Array.isArray(markers) ? markers : [];
  const out = [];
  for (let i = 0; i < limit; i += 1) {
    const index = Math.round((i * (markers.length - 1)) / Math.max(1, limit - 1));
    if (!out.includes(markers[index])) out.push(markers[index]);
  }
  return out;
}

function collectHandlerTraits(root, { maxDepth = 3, maxNodes = 200 } = {}) {
  const hits = [];
  walkData(root, { maxDepth, maxNodes }, ({ path, key, value }) => {
    if (typeof value !== 'function') return;
    if (!/(click|navigate|scroll|jump|select|press|pointer|intent|capture|restore)/i.test(String(key ?? ''))) return;
    hits.push({ path, name: String(key ?? ''), arity: value.length, sourceTraits: functionSourceTraits(value) });
  });
  return dedupeHandlerTraits(hits).slice(0, 60);
}

function functionSourceTraits(fn) {
  let source = '';
  try { source = Function.prototype.toString.call(fn); } catch { return []; }
  const traits = [];
  for (const token of ['scrollIntoView','scrollTo','scrollBy','captureNavigation','prepareRestoreLock','saveNow','preventDefault','stopPropagation']) {
    if (source.includes(token)) traits.push(token);
  }
  return traits;
}

function dedupeHandlerTraits(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.path}\u0000${value.name}\u0000${(value.sourceTraits ?? []).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeRequiredDepth({ markerCount, level1, level2, level3 }) {
  const l1Keys = level1?.codexThreadScrollHandlers?.keys ?? [];
  const directL1 = l1Keys.some((entry) => /^(scrollToIndex|jumpToTurn|navigateToMessage|navigateToTurn|scrollToItem)$/i.test(entry.name));
  if (directL1) return { recommendedDepth: 'L1', reason: 'direct-navigation-handler-visible' };
  if (!(markerCount > 0)) return { recommendedDepth: 'pending-marker', reason: 'official-marker-not-mounted' };
  if (level2?.markerSamplesWithKnownTurnMatch > 0) return { recommendedDepth: 'L2', reason: 'marker-react-props-map-to-known-turn' };
  if (level3?.markerSamplesWithKnownTurnMatch > 0) return { recommendedDepth: 'L3', reason: 'marker-fiber-chain-maps-to-known-turn', shallowestFiberDepth: level3.shallowestKnownTurnDepth };
  return { recommendedDepth: 'deeper-than-L3', reason: 'marker-props-and-return-chain-have-no-known-turn-match' };
}

function findKnownTurnMatches(root, orderById, { maxDepth = 3, maxNodes = 300 } = {}) {
  if (!root || orderById.size === 0) return [];
  const hits = [];
  walkData(root, { maxDepth, maxNodes }, ({ path, value }) => {
    if (typeof value !== 'string') return;
    const order = orderById.get(value);
    if (!Number.isInteger(order)) return;
    hits.push({ path, targetOrder: order, targetLabel: `Q${order + 1}` });
  });
  return dedupeMatches(hits).slice(0, 40);
}

function collectCandidatePaths(root, { maxDepth = 3, maxNodes = 250 } = {}) {
  const hits = [];
  walkData(root, { maxDepth, maxNodes }, ({ path, key, value }) => {
    if (!key || !CANDIDATE_KEY_RE.test(key)) return;
    hits.push({ path, type: valueType(value), shape: valueShape(value) });
  });
  return dedupePaths(hits).slice(0, 60);
}

function walkData(root, { maxDepth, maxNodes }, visitor) {
  const queue = [{ value: root, path: '', depth: 0 }];
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    const current = queue.shift();
    const value = current.value;
    if (value == null || (typeof value !== 'object' && typeof value !== 'function')) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    if (current.depth >= maxDepth) continue;
    const descriptors = safeDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor)) continue;
      const child = descriptor.value;
      const path = current.path ? `${current.path}.${key}` : key;
      visitor({ path, key, value: child });
      if (isPlainInspectable(child)) queue.push({ value: child, path, depth: current.depth + 1 });
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < Math.min(value.length, 20); index += 1) {
        const child = value[index];
        const path = `${current.path}[${index}]`;
        visitor({ path, key: String(index), value: child });
        if (isPlainInspectable(child)) queue.push({ value: child, path, depth: current.depth + 1 });
      }
    }
  }
}

function describeFiber(fiber) {
  const type = safeDataValue(fiber, 'elementType') ?? safeDataValue(fiber, 'type');
  return {
    tag: Number.isFinite(safeDataValue(fiber, 'tag')) ? Number(safeDataValue(fiber, 'tag')) : null,
    component: componentName(type),
    hasMemoizedProps: safeDataValue(fiber, 'memoizedProps') != null,
    hasMemoizedState: safeDataValue(fiber, 'memoizedState') != null
  };
}

function componentName(type) {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return type.displayName || type.name || 'function';
  if (type && typeof type === 'object') return String(safeDataValue(type, 'displayName') ?? safeDataValue(type, 'name') ?? 'object');
  return null;
}

function reactOwnKeys(node) {
  return safeOwnNames(node).filter((key) => key.startsWith('__react')).slice(0, 20);
}

function describeOwnKeys(value, limit) {
  return safeOwnNames(value).slice(0, limit).map((name) => {
    const child = safeDataValue(value, name);
    return { name, type: valueType(child), arity: typeof child === 'function' ? child.length : null, sourceTraits: typeof child === 'function' ? functionSourceTraits(child) : [] };
  });
}

function safeOwnNames(value) {
  try { return Object.getOwnPropertyNames(value ?? {}); } catch { return []; }
}

function safeDescriptors(value) {
  try { return Object.getOwnPropertyDescriptors(value ?? {}); } catch { return {}; }
}

function safeDataValue(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value ?? {}, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function isPlainInspectable(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Object]' || tag === '[object Array]' || typeof value === 'function';
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function valueShape(value) {
  if (typeof value === 'string') return { length: value.length, uuidLike: /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value), numericLike: /^\d+$/.test(value) };
  if (Array.isArray(value)) return { length: value.length };
  if (typeof value === 'function') return { arity: value.length };
  if (value && typeof value === 'object') return { keys: safeOwnNames(value).slice(0, 12) };
  return null;
}

function dedupeMatches(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.path}\u0000${value.targetOrder}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupePaths(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.path}\u0000${value.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
