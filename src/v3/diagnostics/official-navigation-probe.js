import { createScrollModel } from "../core/scroll-model.js";

const DEFAULT_SAMPLE_DELAYS_MS = [24, 80, 180, 420, 900, 1200];
const MAX_SAMPLES = 32;
const MAX_PATH_NODES = 6;
const MAX_CLASS_TOKENS = 8;

export class OfficialNavigationProbe {
  constructor({ document, window, getContext = () => null, getScrollContainer = () => null, getVisibleRange = () => null, isOwnedEvent = defaultOwnedEvent, onPrivateMarker = null, onRecord = null, sampleDelaysMs = DEFAULT_SAMPLE_DELAYS_MS } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.getContext = getContext;
    this.getScrollContainer = getScrollContainer;
    this.getVisibleRange = getVisibleRange;
    this.isOwnedEvent = isOwnedEvent;
    this.onPrivateMarker = onPrivateMarker;
    this.onRecord = onRecord;
    this.sampleDelaysMs = [...sampleDelaysMs].filter((value) => Number(value) >= 0);
    this.active = null;
    this.sequence = 0;
    this.started = false;
    this.boundClick = (event) => this.handleClick(event);
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.document?.addEventListener?.("click", this.boundClick, true);
    return this;
  }

  destroy() {
    if (!this.started) return;
    this.started = false;
    this.document?.removeEventListener?.("click", this.boundClick, true);
    this.finishActive("destroyed", { emit: false });
  }

  handleClick(event) {
    if (!this.started || this.isOwnedEvent?.(event)) return;
    const context = safeCall(this.getContext);
    if (!context?.enabled || !context?.sessionKey) return;
    if (isConversationSwitchEvent(event) || isEditorEvent(event)) return;
    const container = safeCall(this.getScrollContainer);
    if (!container || container.isConnected === false) return;

    this.finishActive("superseded-click");
    const startedAtMs = probeNow(this.window);
    const active = {
      probeId: ++this.sequence,
      context,
      initialContainer: container,
      startedAtMs,
      startedAt: new Date().toISOString(),
      trigger: fingerprintClickTarget(event, this.window),
      marker: identifyOfficialNavigationMarker(event, this.document),
      before: this.readSnapshot(container),
      after: null,
      samples: [],
      timers: [],
      observer: null,
      scrollContainer: null,
      scrollEventCount: 0,
      mutationCount: 0,
      firstScrollMs: null,
      firstWindowMs: null,
      firstExtentMs: null
    };
    this.active = active;
    const privateMarkerKey = readOfficialNavigationMarkerKey(event);
    if (active.marker && privateMarkerKey) {
      try { this.onPrivateMarker?.({ probeId: active.probeId, sessionKey: context.sessionKey, markerKey: privateMarkerKey, markerIndex: active.marker.markerIndex, markerCount: active.marker.markerCount }); } catch {}
    }
    this.appendSample(active, "click", active.before, 0);
    this.bindActiveContainer(active, container);

    for (const delayMs of this.sampleDelaysMs) {
      const timer = setTimer(this.window, () => {
        if (this.active !== active) return;
        const snapshot = this.readSnapshot();
        this.observeMilestones(active, snapshot);
        this.appendSample(active, "timer", snapshot);
        if (delayMs === this.sampleDelaysMs.at(-1)) this.finishActive("settled");
      }, delayMs);
      active.timers.push(timer);
    }
  }

  bindActiveContainer(active, container) {
    if (!active || !container || active.scrollContainer === container) return;
    if (active.scrollContainer) active.scrollContainer.removeEventListener?.("scroll", active.onScroll);
    active.scrollContainer = container;
    active.onScroll = () => {
      if (this.active !== active) return;
      active.scrollEventCount += 1;
      if (active.firstScrollMs == null) active.firstScrollMs = elapsedMs(this.window, active.startedAtMs);
      const currentContainer = safeCall(this.getScrollContainer) ?? container;
      if (currentContainer !== active.scrollContainer) this.bindActiveContainer(active, currentContainer);
      const snapshot = this.readSnapshot(currentContainer);
      this.observeMilestones(active, snapshot);
      this.appendSample(active, "scroll", snapshot);
    };
    container.addEventListener?.("scroll", active.onScroll, { passive: true });

    try { active.observer?.disconnect?.(); } catch {}
    const MutationObserverCtor = this.window?.MutationObserver;
    if (typeof MutationObserverCtor === "function") {
      try {
        active.observer = new MutationObserverCtor(() => {
          if (this.active !== active) return;
          active.mutationCount += 1;
          const currentContainer = safeCall(this.getScrollContainer) ?? container;
          if (currentContainer !== active.scrollContainer) this.bindActiveContainer(active, currentContainer);
          const snapshot = this.readSnapshot(currentContainer);
          this.observeMilestones(active, snapshot);
          this.appendSample(active, "mutation", snapshot);
        });
        active.observer.observe(container, { subtree: true, childList: true, attributes: true });
      } catch {
        active.observer = null;
      }
    }
  }

  readSnapshot(explicitContainer = null) {
    const container = explicitContainer ?? safeCall(this.getScrollContainer);
    if (!container) return null;
    const flexDirection = safeFlexDirection(this.window, container);
    const model = createScrollModel({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      flexDirection
    });
    const range = sanitizeVisibleRange(safeCall(this.getVisibleRange));
    return {
      physicalScrollTop: roundNumber(container.scrollTop),
      scrollHeight: roundNumber(model.scrollHeight),
      clientHeight: roundNumber(model.clientHeight),
      logicalPosition: roundNumber(model.logicalPosition),
      maxLogicalPosition: roundNumber(model.maxLogicalPosition),
      isColumnReverse: Boolean(model.isColumnReverse),
      visibleRange: range,
      containerChanged: Boolean(this.active && container !== this.active.initialContainer)
    };
  }

  observeMilestones(active, snapshot) {
    if (!active || !snapshot || !active.before) return;
    const t = elapsedMs(this.window, active.startedAtMs);
    if (active.firstWindowMs == null && visibleRangeChanged(active.before.visibleRange, snapshot.visibleRange)) active.firstWindowMs = t;
    if (active.firstExtentMs == null && Math.abs(snapshot.scrollHeight - active.before.scrollHeight) > 2) active.firstExtentMs = t;
  }

  appendSample(active, kind, snapshot, explicitElapsed = null) {
    if (!active || !snapshot) return;
    const sample = { t: explicitElapsed == null ? elapsedMs(this.window, active.startedAtMs) : explicitElapsed, kind, ...snapshot };
    const previous = active.samples.at(-1);
    if (previous && sampleEquivalent(previous, sample)) return;
    active.samples.push(sample);
    if (active.samples.length > MAX_SAMPLES) active.samples.splice(0, active.samples.length - MAX_SAMPLES);
  }

  finishActive(reason = "settled", { emit = true } = {}) {
    const active = this.active;
    if (!active) return null;
    this.active = null;
    for (const timer of active.timers ?? []) clearTimer(this.window, timer);
    try { active.observer?.disconnect?.(); } catch {}
    active.scrollContainer?.removeEventListener?.("scroll", active.onScroll);

    const currentContext = safeCall(this.getContext);
    if (!emit || !currentContext?.enabled || currentContext.sessionKey !== active.context.sessionKey) return null;
    const finalContainer = safeCall(this.getScrollContainer) ?? active.initialContainer;
    const after = this.readSnapshot(finalContainer);
    active.after = after;
    this.observeMilestones(active, after);
    this.appendSample(active, "final", after);
    if (!meaningfulNavigationChange(active.before, after, active.samples, active.scrollEventCount)) return null;

    const metrics = computeProbeMetrics(active);
    const record = sanitizeOfficialNavigationRecord({
      probeId: active.probeId,
      host: active.context.host ?? null,
      source: active.context.source ?? null,
      stable: Boolean(active.context.stable),
      startedAt: active.startedAt,
      finishedReason: reason,
      trigger: active.trigger,
      marker: active.marker,
      totalElapsedMs: elapsedMs(this.window, active.startedAtMs),
      clickToFirstScrollMs: active.firstScrollMs,
      clickToFirstWindowMs: active.firstWindowMs,
      clickToFirstExtentMs: active.firstExtentMs,
      scrollEventCount: active.scrollEventCount,
      mutationCount: active.mutationCount,
      classification: classifyNavigation(active, metrics),
      metrics,
      before: active.before,
      after,
      samples: active.samples
    });
    if (record) {
      try { this.onRecord?.(record); } catch {}
    }
    return record;
  }
}


function readOfficialNavigationMarkerKey(event) {
  const path = typeof event?.composedPath === "function" ? event.composedPath() : buildElementPath(event?.target);
  for (const node of path ?? []) {
    const value = node?.getAttribute?.("data-thread-user-message-navigation-item-id");
    if (value != null) {
      const key = String(value).trim();
      return key || null;
    }
  }
  return null;
}

export function identifyOfficialNavigationMarker(event, documentRef = globalThis.document) {
  const path = typeof event?.composedPath === "function" ? event.composedPath() : buildElementPath(event?.target);
  let marker = null;
  for (const node of path ?? []) {
    if (node?.getAttribute?.("data-thread-user-message-navigation-item-id") != null) { marker = node; break; }
  }
  if (!marker) return null;
  const buttons = Array.from(documentRef?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
  const index = buttons.indexOf(marker);
  if (index < 0) return null;
  return { markerIndex: index, markerCount: buttons.length };
}

export function sanitizeOfficialNavigationLearningSample(value = {}) {
  if (!value || typeof value !== "object") return null;
  const markerIndex = Number(value.markerIndex);
  const markerCount = Number(value.markerCount);
  const targetOrder = Number(value.targetOrder);
  const knownTurnCount = Number(value.knownTurnCount);
  if (!Number.isInteger(markerIndex) || markerIndex < 0 || !Number.isInteger(markerCount) || markerCount <= markerIndex || !Number.isInteger(targetOrder) || targetOrder < 0) return null;
  return {
    markerIndex,
    markerCount,
    targetOrder,
    knownTurnCount: Number.isInteger(knownTurnCount) && knownTurnCount >= 0 ? knownTurnCount : null,
    host: safeString(value.host),
    classification: safeString(value.classification),
    observedAt: safeString(value.observedAt)
  };
}

export function selectTrustedOfficialBridgePair({ learning, targetOrder, markerCount, knownTurnCount, minHits = 2 } = {}) {
  if (!learning || typeof learning !== "object") return null;
  if (!learning.oneToOneObserved || !learning.monotonic || Number(learning.markerConflicts) > 0 || Number(learning.targetConflicts) > 0) return null;
  if (!Number.isInteger(targetOrder) || targetOrder < 0) return null;
  if (!Number.isInteger(markerCount) || markerCount <= 0 || Number(learning.markerCount) !== markerCount) return null;
  if (!Number.isInteger(knownTurnCount) || knownTurnCount <= 0 || Number(learning.knownTurnCount) !== knownTurnCount) return null;
  const pair = (Array.isArray(learning.observedPairs) ? learning.observedPairs : []).find((item) => Number(item?.targetOrder) === targetOrder);
  if (!pair || !Number.isInteger(pair.markerIndex) || pair.markerIndex < 0 || pair.markerIndex >= markerCount) return null;
  if ((Number(pair.hits) || 0) < Math.max(2, Number(minHits) || 2)) return null;
  return { markerIndex: Number(pair.markerIndex), targetOrder, hits: Number(pair.hits) || 0 };
}

export function sanitizeOfficialNavigationLearningHistory(value, limit = 32) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeOfficialNavigationLearningSample).filter(Boolean).slice(-Math.max(1, Number(limit) || 32));
}

export function analyzeOfficialNavigationLearning(samples = []) {
  const clean = sanitizeOfficialNavigationLearningHistory(samples, 256);
  const markerTargets = new Map();
  const targetMarkers = new Map();
  for (const sample of clean) {
    const targets = markerTargets.get(sample.markerIndex) ?? new Set(); targets.add(sample.targetOrder); markerTargets.set(sample.markerIndex, targets);
    const markers = targetMarkers.get(sample.targetOrder) ?? new Set(); markers.add(sample.markerIndex); targetMarkers.set(sample.targetOrder, markers);
  }
  const markerConflicts = [...markerTargets.values()].filter((targets) => targets.size > 1).length;
  const targetConflicts = [...targetMarkers.values()].filter((markers) => markers.size > 1).length;
  const pairs = [...markerTargets.entries()]
    .filter(([, targets]) => targets.size === 1)
    .map(([markerIndex, targets]) => {
      const targetOrder = [...targets][0];
      const hits = clean.filter((sample) => sample.markerIndex === markerIndex && sample.targetOrder === targetOrder).length;
      return { markerIndex, targetOrder, offset: markerIndex - targetOrder, hits };
    })
    .sort((a, b) => a.markerIndex - b.markerIndex);
  const monotonic = pairs.every((pair, index) => index === 0 || pair.targetOrder > pairs[index - 1].targetOrder);
  const oneToOneObserved = markerConflicts === 0 && targetConflicts === 0;
  const uniqueOffsets = [...new Set(pairs.map((pair) => pair.offset))].sort((a,b)=>a-b);
  const latest = clean.at(-1) ?? null;
  const knownTurnCount = latest?.knownTurnCount ?? null;
  const markerCount = latest?.markerCount ?? null;
  const targetCoverage = Number.isInteger(knownTurnCount) && knownTurnCount > 0 ? ratio(targetMarkers.size, knownTurnCount) : 0;
  let recommendedBridgeMode = 'insufficient';
  if (!oneToOneObserved || !monotonic) recommendedBridgeMode = 'unsafe-conflict';
  else if (targetCoverage >= 0.95 && pairs.length >= 5) recommendedBridgeMode = 'learned-index-near-complete';
  else if (pairs.length >= 5) recommendedBridgeMode = 'learned-pairs-only';
  else if (pairs.length > 0) recommendedBridgeMode = 'collect-more';
  return {
    sampleCount: clean.length,
    uniqueMarkerCount: markerTargets.size,
    uniqueTargetCount: targetMarkers.size,
    markerCount,
    knownTurnCount,
    markerConflicts,
    targetConflicts,
    oneToOneObserved,
    monotonic,
    uniqueOffsets,
    targetCoverage: clampRatio(targetCoverage),
    observedPairs: pairs.slice(-64),
    recommendedBridgeMode
  };
}

function sanitizeOfficialMarker(value) {
  if (!value || typeof value !== "object") return null;
  const markerIndex = Number(value.markerIndex), markerCount = Number(value.markerCount);
  if (!Number.isInteger(markerIndex) || markerIndex < 0 || !Number.isInteger(markerCount) || markerCount <= markerIndex) return null;
  return { markerIndex, markerCount };
}

export function fingerprintClickTarget(event, windowRef = globalThis.window) {
  const path = typeof event?.composedPath === "function" ? event.composedPath() : buildElementPath(event?.target);
  const nodes = [];
  for (const node of path ?? []) {
    if (!node || typeof node !== "object" || !node.tagName) continue;
    const tag = String(node.tagName).toLowerCase();
    if (tag === "html" || tag === "body") continue;
    nodes.push(fingerprintElement(node, windowRef));
    if (nodes.length >= MAX_PATH_NODES) break;
  }
  return { trusted: Boolean(event?.isTrusted), path: nodes };
}

export function analyzeOfficialNavigationMapping({ document, turns = [] } = {}) {
  const buttons = Array.from(document?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
  const officialIds = buttons
    .map((button) => String(button?.getAttribute?.('data-thread-user-message-navigation-item-id') ?? '').trim())
    .filter(Boolean);
  const orderedTurns = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn?.id && Number.isFinite(turn?.order))
    .map((turn) => ({ id: String(turn.id), order: Number(turn.order) }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const turnOrderById = new Map(orderedTurns.map((turn) => [turn.id, turn.order]));
  const officialUniqueIdCount = new Set(officialIds).size;
  const knownUniqueIdCount = new Set(orderedTurns.map((turn) => turn.id)).size;
  const matchedOrders = officialIds.map((id) => turnOrderById.get(id)).filter(Number.isFinite);
  const exactIdMatches = matchedOrders.length;
  let orderedExactMatches = 0;
  for (let index = 0; index < Math.min(officialIds.length, orderedTurns.length); index += 1) {
    if (officialIds[index] === orderedTurns[index].id) orderedExactMatches += 1;
  }
  const matchedOrderMonotonic = matchedOrders.every((order, index) => index === 0 || order > matchedOrders[index - 1]);
  const officialButtonCount = officialIds.length;
  const knownTurnCount = orderedTurns.length;
  const exactButtonCoverage = ratio(exactIdMatches, officialButtonCount);
  const exactTurnCoverage = ratio(exactIdMatches, knownTurnCount);
  const orderedCoverage = ratio(orderedExactMatches, Math.min(officialButtonCount, knownTurnCount));
  const countAligned = officialButtonCount > 0 && officialButtonCount === knownTurnCount;
  const oneToOneExact = officialButtonCount > 0
    && officialUniqueIdCount === officialButtonCount
    && knownUniqueIdCount === knownTurnCount
    && countAligned
    && exactIdMatches === officialButtonCount
    && orderedExactMatches === officialButtonCount
    && matchedOrderMonotonic;
  let recommendedBridgeMode = 'insufficient';
  if (oneToOneExact) recommendedBridgeMode = 'direct-exact-id';
  else if (officialButtonCount > 0 && exactButtonCoverage >= 0.95 && matchedOrderMonotonic) recommendedBridgeMode = 'direct-exact-id-partial';
  else if (countAligned && orderedCoverage >= 0.95) recommendedBridgeMode = 'ordered-index-candidate';
  else if (officialButtonCount > 0 && exactIdMatches > 0) recommendedBridgeMode = 'mixed-unsafe';
  return sanitizeOfficialNavigationMapping({
    officialButtonCount,
    officialUniqueIdCount,
    knownTurnCount,
    knownUniqueIdCount,
    exactIdMatches,
    orderedExactMatches,
    exactButtonCoverage,
    exactTurnCoverage,
    orderedCoverage,
    matchedOrderMonotonic,
    countAligned,
    oneToOneExact,
    matchedOrderRange: matchedOrders.length ? { min: Math.min(...matchedOrders), max: Math.max(...matchedOrders), count: matchedOrders.length } : null,
    recommendedBridgeMode
  });
}

export function sanitizeOfficialNavigationMapping(value = {}) {
  if (!value || typeof value !== 'object') return null;
  return {
    officialButtonCount: nonNegativeInt(value.officialButtonCount),
    officialUniqueIdCount: nonNegativeInt(value.officialUniqueIdCount),
    knownTurnCount: nonNegativeInt(value.knownTurnCount),
    knownUniqueIdCount: nonNegativeInt(value.knownUniqueIdCount),
    exactIdMatches: nonNegativeInt(value.exactIdMatches),
    orderedExactMatches: nonNegativeInt(value.orderedExactMatches),
    exactButtonCoverage: clampRatio(value.exactButtonCoverage),
    exactTurnCoverage: clampRatio(value.exactTurnCoverage),
    orderedCoverage: clampRatio(value.orderedCoverage),
    matchedOrderMonotonic: Boolean(value.matchedOrderMonotonic),
    countAligned: Boolean(value.countAligned),
    oneToOneExact: Boolean(value.oneToOneExact),
    matchedOrderRange: sanitizeVisibleRange(value.matchedOrderRange),
    recommendedBridgeMode: safeString(value.recommendedBridgeMode) ?? 'insufficient'
  };
}

function ratio(numerator, denominator) {
  if (!(Number(denominator) > 0)) return 0;
  return Math.round((Number(numerator) / Number(denominator)) * 1000) / 1000;
}

function clampRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 1000) / 1000));
}

function nonNegativeInt(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function sanitizeOfficialNavigationHistory(value, limit = 10) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeOfficialNavigationRecord).filter(Boolean).slice(-Math.max(1, Number(limit) || 10));
}

export function sanitizeOfficialNavigationRecord(value = {}) {
  if (!value || typeof value !== "object") return null;
  return {
    probeId: Number(value.probeId) || 0,
    host: safeString(value.host),
    source: safeString(value.source),
    stable: Boolean(value.stable),
    startedAt: safeString(value.startedAt),
    finishedReason: safeString(value.finishedReason),
    trigger: sanitizeTrigger(value.trigger),
    marker: sanitizeOfficialMarker(value.marker),
    learningSample: sanitizeOfficialNavigationLearningSample(value.learningSample),
    totalElapsedMs: nullableRound(value.totalElapsedMs),
    clickToFirstScrollMs: nullableRound(value.clickToFirstScrollMs),
    clickToFirstWindowMs: nullableRound(value.clickToFirstWindowMs),
    clickToFirstExtentMs: nullableRound(value.clickToFirstExtentMs),
    scrollEventCount: Math.max(0, Math.round(Number(value.scrollEventCount) || 0)),
    mutationCount: Math.max(0, Math.round(Number(value.mutationCount) || 0)),
    classification: safeString(value.classification) ?? "navigation-change",
    mapping: sanitizeOfficialNavigationMapping(value.mapping),
    metrics: sanitizeMetrics(value.metrics),
    before: sanitizeSnapshot(value.before),
    after: sanitizeSnapshot(value.after),
    samples: (Array.isArray(value.samples) ? value.samples : []).map(sanitizeSample).filter(Boolean).slice(-MAX_SAMPLES)
  };
}

function fingerprintElement(element, windowRef) {
  const role = safeAttribute(element, "role");
  const classes = String(element.className ?? "").split(/\s+/).map((token) => token.trim()).filter(Boolean).slice(0, MAX_CLASS_TOKENS);
  const dataAttributes = [];
  for (const attribute of Array.from(element.attributes ?? [])) {
    const name = String(attribute?.name ?? "");
    if (!name.startsWith("data-")) continue;
    dataAttributes.push({ name, kind: classifyAttributeValue(attribute?.value) });
    if (dataAttributes.length >= 10) break;
  }
  const rect = element.getBoundingClientRect?.();
  const innerWidth = Number(windowRef?.innerWidth) || null;
  return {
    tag: String(element.tagName ?? "").toLowerCase() || null,
    role: role || null,
    classes,
    hasId: Boolean(element.id),
    ariaLabel: attributeShape(element, "aria-label"),
    ariaCurrent: attributeShape(element, "aria-current"),
    title: attributeShape(element, "title"),
    dataAttributes,
    rect: rect ? {
      top: roundNumber(rect.top),
      left: roundNumber(rect.left),
      width: roundNumber(rect.width),
      height: roundNumber(rect.height),
      rightInset: innerWidth == null ? null : roundNumber(innerWidth - Number(rect.right || 0))
    } : null
  };
}

function attributeShape(element, name) {
  const value = safeAttribute(element, name);
  if (!value) return null;
  return { present: true, length: String(value).length, kind: classifyAttributeValue(value) };
}

function classifyAttributeValue(value) {
  const text = String(value ?? "");
  if (!text) return "empty";
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return "numeric";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(text)) return "uuid-like";
  if (/^(true|false|page|step|location|date|time)$/i.test(text)) return "enum";
  if (text.length <= 24 && /^[A-Za-z0-9_.:-]+$/.test(text)) return "short-token";
  return text.length > 80 ? "long-text" : "text";
}

function sanitizeTrigger(value) {
  if (!value || typeof value !== "object") return { trusted: false, path: [] };
  return {
    trusted: Boolean(value.trusted),
    path: (Array.isArray(value.path) ? value.path : []).slice(0, MAX_PATH_NODES).map((node) => ({
      tag: safeString(node?.tag),
      role: safeString(node?.role),
      classes: (Array.isArray(node?.classes) ? node.classes : []).map(safeString).filter(Boolean).slice(0, MAX_CLASS_TOKENS),
      hasId: Boolean(node?.hasId),
      ariaLabel: sanitizeAttributeShape(node?.ariaLabel),
      ariaCurrent: sanitizeAttributeShape(node?.ariaCurrent),
      title: sanitizeAttributeShape(node?.title),
      dataAttributes: (Array.isArray(node?.dataAttributes) ? node.dataAttributes : []).slice(0, 10).map((item) => ({ name: safeString(item?.name), kind: safeString(item?.kind) })).filter((item) => item.name),
      rect: sanitizeRect(node?.rect)
    }))
  };
}

function sanitizeAttributeShape(value) {
  if (!value || typeof value !== "object") return null;
  return { present: Boolean(value.present), length: Math.max(0, Math.round(Number(value.length) || 0)), kind: safeString(value.kind) };
}

function sanitizeRect(value) {
  if (!value || typeof value !== "object") return null;
  return { top: nullableRound(value.top), left: nullableRound(value.left), width: nullableRound(value.width), height: nullableRound(value.height), rightInset: nullableRound(value.rightInset) };
}

function sanitizeVisibleRange(value) {
  if (!value || typeof value !== "object") return null;
  const min = Number(value.min), max = Number(value.max), count = Number(value.count);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max, count: Number.isFinite(count) ? count : Math.max(0, max - min + 1) };
}

function sanitizeSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  return {
    physicalScrollTop: nullableRound(value.physicalScrollTop),
    scrollHeight: nullableRound(value.scrollHeight),
    clientHeight: nullableRound(value.clientHeight),
    logicalPosition: nullableRound(value.logicalPosition),
    maxLogicalPosition: nullableRound(value.maxLogicalPosition),
    isColumnReverse: Boolean(value.isColumnReverse),
    visibleRange: sanitizeVisibleRange(value.visibleRange),
    containerChanged: Boolean(value.containerChanged)
  };
}

function sanitizeSample(value) {
  const snapshot = sanitizeSnapshot(value);
  if (!snapshot) return null;
  return { t: nullableRound(value?.t), kind: safeString(value?.kind), ...snapshot };
}

function sanitizeMetrics(value) {
  if (!value || typeof value !== "object") return { logicalDelta: 0, absoluteLogicalDelta: 0, maxSingleLogicalDelta: 0, distinctMotionSteps: 0, extentDelta: 0, windowChanged: false, containerChanged: false };
  return {
    logicalDelta: roundNumber(value.logicalDelta),
    absoluteLogicalDelta: Math.abs(roundNumber(value.absoluteLogicalDelta)),
    maxSingleLogicalDelta: Math.abs(roundNumber(value.maxSingleLogicalDelta)),
    distinctMotionSteps: Math.max(0, Math.round(Number(value.distinctMotionSteps) || 0)),
    extentDelta: roundNumber(value.extentDelta),
    windowChanged: Boolean(value.windowChanged),
    containerChanged: Boolean(value.containerChanged)
  };
}

function computeProbeMetrics(active) {
  const before = active.before ?? {};
  const after = active.after ?? {};
  let maxSingleLogicalDelta = 0, distinctMotionSteps = 0, previous = null;
  for (const sample of active.samples ?? []) {
    if (previous) {
      const delta = Math.abs(Number(sample.logicalPosition) - Number(previous.logicalPosition));
      if (delta > 2) distinctMotionSteps += 1;
      maxSingleLogicalDelta = Math.max(maxSingleLogicalDelta, delta);
    }
    previous = sample;
  }
  return {
    logicalDelta: roundNumber(Number(after.logicalPosition) - Number(before.logicalPosition)),
    absoluteLogicalDelta: roundNumber(Math.abs(Number(after.logicalPosition) - Number(before.logicalPosition))),
    maxSingleLogicalDelta: roundNumber(maxSingleLogicalDelta),
    distinctMotionSteps,
    extentDelta: roundNumber(Number(after.scrollHeight) - Number(before.scrollHeight)),
    windowChanged: visibleRangeChanged(before.visibleRange, after.visibleRange),
    containerChanged: Boolean(after.containerChanged || (active.samples ?? []).some((sample) => sample.containerChanged))
  };
}

function classifyNavigation(active, metrics) {
  const viewport = Math.max(1, Number(active.before?.clientHeight) || 1);
  if (metrics.windowChanged && metrics.absoluteLogicalDelta <= 2 && active.scrollEventCount <= 1) return "virtual-window-swap";
  if (metrics.absoluteLogicalDelta >= viewport * 1.5 && metrics.distinctMotionSteps <= 2 && active.scrollEventCount <= 2) return metrics.windowChanged ? "single-jump-window-swap" : "single-jump";
  if (metrics.distinctMotionSteps >= 3 || active.scrollEventCount >= 3) return "multi-step-scroll";
  if (metrics.windowChanged || Math.abs(metrics.extentDelta) > 2) return "window-or-extent-navigation";
  return "navigation-change";
}

function meaningfulNavigationChange(before, after, samples, scrollEventCount) {
  if (!before || !after) return false;
  if (Math.abs(Number(after.logicalPosition) - Number(before.logicalPosition)) > 2) return true;
  if (Math.abs(Number(after.scrollHeight) - Number(before.scrollHeight)) > 2) return true;
  if (visibleRangeChanged(before.visibleRange, after.visibleRange)) return true;
  if (scrollEventCount > 0 && (samples ?? []).some((sample) => Math.abs(Number(sample.logicalPosition) - Number(before.logicalPosition)) > 2)) return true;
  return false;
}

function visibleRangeChanged(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return Number(a.min) !== Number(b.min) || Number(a.max) !== Number(b.max) || Number(a.count) !== Number(b.count);
}

function sampleEquivalent(a, b) {
  return Number(a.logicalPosition) === Number(b.logicalPosition)
    && Number(a.scrollHeight) === Number(b.scrollHeight)
    && Number(a.physicalScrollTop) === Number(b.physicalScrollTop)
    && !visibleRangeChanged(a.visibleRange, b.visibleRange)
    && Boolean(a.containerChanged) === Boolean(b.containerChanged);
}

function defaultOwnedEvent(event) {
  for (const node of event?.composedPath?.() ?? buildElementPath(event?.target)) if (node?.id === "gte-root") return true;
  return false;
}

function isConversationSwitchEvent(event) {
  for (const node of event?.composedPath?.() ?? buildElementPath(event?.target)) {
    if (!node?.getAttribute) continue;
    if (node.getAttribute("data-sidebar-chatgpt-conversation-key") != null) return true;
    if (node.getAttribute("data-app-action-sidebar-thread-id") != null) return true;
  }
  return false;
}

function isEditorEvent(event) {
  for (const node of event?.composedPath?.() ?? buildElementPath(event?.target)) {
    if (!node || !node.tagName) continue;
    const tag = String(node.tagName).toLowerCase();
    if (tag === "textarea" || tag === "input") return true;
    if (node.getAttribute?.("contenteditable") === "true") return true;
  }
  return false;
}

function buildElementPath(target) {
  const path = [];
  let node = target;
  while (node && path.length < MAX_PATH_NODES + 4) {
    path.push(node);
    node = node.parentElement ?? node.parentNode ?? null;
  }
  return path;
}

function safeAttribute(element, name) { try { return element?.getAttribute?.(name) ?? ""; } catch { return ""; } }
function safeFlexDirection(windowRef, container) { try { return windowRef?.getComputedStyle?.(container)?.flexDirection ?? container?.style?.flexDirection ?? "column"; } catch { return container?.style?.flexDirection ?? "column"; } }
function safeCall(fn) { try { return typeof fn === "function" ? fn() : null; } catch { return null; } }
function elapsedMs(windowRef, startedAtMs) { return Math.max(0, Math.round(probeNow(windowRef) - Number(startedAtMs || 0))); }
function probeNow(windowRef) { const value = Number(windowRef?.performance?.now?.()); return Number.isFinite(value) ? value : Date.now(); }
function setTimer(windowRef, callback, delayMs) { return typeof windowRef?.setTimeout === "function" ? windowRef.setTimeout(callback, Math.max(0, Number(delayMs) || 0)) : setTimeout(callback, Math.max(0, Number(delayMs) || 0)); }
function clearTimer(windowRef, timer) { if (typeof windowRef?.clearTimeout === "function") windowRef.clearTimeout(timer); else clearTimeout(timer); }
function roundNumber(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number) : 0; }
function nullableRound(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number) : null; }
function safeString(value) { return typeof value === "string" && value ? value : null; }
