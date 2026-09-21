import { EventBus } from "./core/event-bus.js";
import { LocalStorageAdapter } from "./core/storage.js";
import { ConversationStore } from "./core/conversation-store.js";
import { TurnIndex } from "./core/turn-index.js";
import { TimelineState } from "./core/timeline-state.js";
import { PromptStore } from "./core/prompt-store.js";
import { SettingsStore } from "./core/settings-store.js";
import { TimelineCache } from "./core/timeline-cache.js";
import { WorkTimelineCache } from "./core/work-timeline-cache.js";
import { normalizeQuestionDisplayText } from "./core/question-display.js";
import { SURFACE } from "./host/host-interface.js";
import { CodexDesktopHost } from "./host/codex-desktop/codex-host.js";
import { parseSidebarConversationKey } from "./host/codex-desktop/conversation-adapter.js";
import { AppShell } from "./ui/app-shell.js";

export const VERSION = "0.5.3";
const NAVIGATION_PENDING_DELAY_MS = 650;
const LOCAL_NAVIGATION_SETTLE_MS = 500;
const CHAT_CONVERSATION_SETTLE_DELAYS_MS = [240, 600, 1200];
const CHAT_PENDING_SELECTION_TTL_MS = 2600;
const CHAT_DIRECT_REKEY_WINDOW_MS = 5000;
const PINNED_CHAT_SELECTION_TTL_MS = 3200;
const NAVIGATION_HISTORY_LIMIT = 5;
const NAVIGATION_STEP_LIMIT = 16;
const SLOW_NAVIGATION_HISTORY_LIMIT = 10;
const SLOW_NAVIGATION_STORAGE_KEY = "gte.v3.navigation-diagnostics";
const CAPTURE_DIAGNOSTIC_LIMIT = 12;
const CHAT_SCROLL_DIAGNOSTIC_LIMIT = 40;
const CHAT_BOOTSTRAP_MAX_FAILURES = 3;
const CHAT_BOOTSTRAP_RETRY_DELAYS_MS = [220, 700, 1500];

export function analyzeChatIndexOrderHealth(turns = []) {
  const records = (Array.isArray(turns) ? turns : []).filter((turn) => turn?.id);
  if (!records.length) {
    return {
      healthy: true,
      corrupt: false,
      count: 0,
      orderCount: 0,
      uniqueOrderCount: 0,
      min: null,
      max: null,
      duplicateOrders: [],
      missingOrders: [],
      invalidOrderCount: 0
    };
  }

  const counts = new Map();
  let invalidOrderCount = 0;
  for (const turn of records) {
    const order = Number(turn?.order);
    if (!Number.isInteger(order) || order < 0) {
      invalidOrderCount += 1;
      continue;
    }
    counts.set(order, (counts.get(order) ?? 0) + 1);
  }
  const orders = [...counts.keys()].sort((a, b) => a - b);
  const duplicateOrders = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([order]) => order)
    .sort((a, b) => a - b);
  const min = orders.length ? orders[0] : null;
  const max = orders.length ? orders.at(-1) : null;
  const missingOrders = [];
  if (min === 0 && Number.isInteger(max)) {
    for (let order = 0; order <= max; order += 1) {
      if (!counts.has(order)) missingOrders.push(order);
    }
  }
  const corrupt = invalidOrderCount > 0
    || duplicateOrders.length > 0
    || (min === 0 && missingOrders.length > 0);
  return {
    healthy: !corrupt,
    corrupt,
    count: records.length,
    orderCount: records.length - invalidOrderCount,
    uniqueOrderCount: orders.length,
    min,
    max,
    duplicateOrders,
    missingOrders,
    invalidOrderCount
  };
}

export function reconcileChatVisibleTurns(index, visibleRecords = [], diagnostics = null) {
  const records = (Array.isArray(visibleRecords) ? visibleRecords : [])
    .filter((record) => record?.id)
    .map((record, position) => ({
      ...record,
      windowOrder: Number.isFinite(record.windowOrder) ? Number(record.windowOrder) : position
    }));
  if (!records.length) {
    if (diagnostics) Object.assign(diagnostics, { recordCount: 0, orientation: "none", turns: [] });
    return [];
  }

  const cacheRepair = repairReversedVisualDomOrders(index, records);
  const existing = index?.getOrdered?.() ?? [];
  const currentVisibleIds = new Set(records.map((record) => String(record.id)));
  const resolved = new Map();
  const anchorMeta = new Map();
  const offsets = [];
  const reverseOffsets = [];
  const noteAnchor = (position, record, order, kind, extra = {}) => {
    const windowOrder = Number(record.windowOrder);
    const reverseWindowOrder = records.length - 1 - windowOrder;
    offsets.push(order - windowOrder);
    reverseOffsets.push(order - reverseWindowOrder);
    anchorMeta.set(position, { kind, order, ...extra });
  };

  for (let position = 0; position < records.length; position += 1) {
    const record = records[position];
    if (record.orderTrust !== "window" && Number.isFinite(record.order)) {
      const order = Number(record.order);
      resolved.set(position, { id: String(record.id), order });
      noteAnchor(position, record, order, "absolute");
      continue;
    }

    const known = index?.get?.(record.id);
    if (known && Number.isFinite(known.order)) {
      const order = Number(known.order);
      resolved.set(position, { id: String(record.id), order });
      noteAnchor(position, record, order, "known-id");
      continue;
    }

    const text = normalizeChatTurnText(record.text);
    if (!text) {
      anchorMeta.set(position, { kind: "no-text", order: null, textMatchCount: 0 });
      continue;
    }
    const matches = existing.filter((candidate) => (
      isTrustedChatOrderAnchor(candidate)
      || (candidate?.source === "dom" && !currentVisibleIds.has(String(candidate.id)))
    ) && normalizeChatTurnText(candidate.text) === text);
    if (matches.length !== 1 || !Number.isFinite(matches[0].order)) {
      anchorMeta.set(position, { kind: "text-unresolved", order: null, textMatchCount: matches.length });
      continue;
    }
    const anchor = matches[0];
    const order = Number(anchor.order);
    if (anchor.source?.includes("capture")) {
      index?.setAlias?.(record.id, anchor.id);
      resolved.set(position, { id: String(anchor.id), order });
    } else {
      resolved.set(position, { id: String(record.id), order });
    }
    noteAnchor(position, record, order, "text-anchor", { textMatchCount: matches.length, captureAnchor: Boolean(anchor.source?.includes("capture")) });
  }

  const distinctOffsets = [...new Set(offsets.filter(Number.isFinite))];
  const sharedOffset = distinctOffsets.length === 1 ? distinctOffsets[0] : null;
  const distinctReverseOffsets = [...new Set(reverseOffsets.filter(Number.isFinite))];
  const reverseSharedOffset = distinctReverseOffsets.length === 1 ? distinctReverseOffsets[0] : null;
  const forwardMappedOrders = records
    .filter((record) => record.orderTrust === "window")
    .map((record) => Number.isFinite(sharedOffset) ? Number(record.windowOrder) + sharedOffset : null)
    .filter(Number.isFinite);
  const reverseMappedOrders = records
    .filter((record) => record.orderTrust === "window")
    .map((record) => Number.isFinite(reverseSharedOffset) ? (records.length - 1 - Number(record.windowOrder)) + reverseSharedOffset : null)
    .filter(Number.isFinite);
  const forwardHasNegative = forwardMappedOrders.some((order) => order < 0);
  const reverseAllNonNegative = reverseMappedOrders.length > 0 && reverseMappedOrders.every((order) => order >= 0);
  const useReverseWindow = Number.isFinite(sharedOffset)
    && Number.isFinite(reverseSharedOffset)
    && forwardHasNegative
    && reverseAllNonNegative;
  const orientation = useReverseWindow ? "reverse-window" : "forward-window";
  const selectedOffset = useReverseWindow ? reverseSharedOffset : sharedOffset;
  const output = [];
  const stagedOrders = new Map();
  const turnDiagnostics = [];

  for (let position = 0; position < records.length; position += 1) {
    const record = records[position];
    let mapped = resolved.get(position) ?? null;
    let mappedBy = mapped ? anchorMeta.get(position)?.kind ?? "anchor" : null;
    if (!mapped && record.orderTrust === "window" && Number.isFinite(selectedOffset)) {
      const basisOrder = useReverseWindow
        ? records.length - 1 - Number(record.windowOrder)
        : Number(record.windowOrder);
      mapped = { id: String(record.id), order: basisOrder + selectedOffset };
      mappedBy = orientation;
    }

    const diag = {
      position,
      windowOrder: Number(record.windowOrder),
      orderTrust: record.orderTrust ?? null,
      idMode: diagnosticTurnIdMode(record.id),
      anchorKind: anchorMeta.get(position)?.kind ?? null,
      textMatchCount: Number(anchorMeta.get(position)?.textMatchCount ?? 0),
      resolvedOrder: Number.isFinite(resolved.get(position)?.order) ? Number(resolved.get(position).order) : null,
      mappedOrder: Number.isFinite(mapped?.order) ? Number(mapped.order) : null,
      mappedBy,
      accepted: false,
      reason: null
    };

    if (!mapped || !Number.isFinite(mapped.order)) {
      diag.reason = "unmapped";
      turnDiagnostics.push(diag);
      continue;
    }
    if (mapped.order < 0) {
      diag.reason = "negative-order";
      turnDiagnostics.push(diag);
      continue;
    }

    const candidate = {
      ...record,
      id: mapped.id,
      order: Number(mapped.order),
      orderTrust: record.orderTrust === "window" ? "mapped" : record.orderTrust
    };
    const occupants = (index?.getOrdered?.() ?? []).filter((turn) => turn.id !== candidate.id && Number(turn.order) === candidate.order);
    if (occupants.length) {
      const legacyOccupant = occupants.length === 1 ? occupants[0] : null;
      const promotedLegacy = record.orderTrust === "window"
        && Number.isFinite(selectedOffset)
        && legacyOccupant
        && index?.replaceLegacyAnchor?.(legacyOccupant.id, candidate.id) === true;
      const promotedStaleDom = !promotedLegacy
        && record.orderTrust === "window"
        && Number.isFinite(selectedOffset)
        && legacyOccupant
        && legacyOccupant.source === "dom"
        && !currentVisibleIds.has(String(legacyOccupant.id))
        && normalizeChatTurnText(legacyOccupant.text) === normalizeChatTurnText(candidate.text)
        && index?.replaceStaleDomAnchor?.(legacyOccupant.id, candidate.id, { order: candidate.order, text: candidate.text }) === true;
      if (!promotedLegacy && !promotedStaleDom) {
        const text = normalizeChatTurnText(candidate.text);
        const compatible = occupants.filter((turn) => isTrustedChatOrderAnchor(turn)
          && text
          && normalizeChatTurnText(turn.text) === text);
        if (occupants.length !== 1 || compatible.length !== 1) {
          diag.reason = "occupied-order";
          diag.occupantCount = occupants.length;
          turnDiagnostics.push(diag);
          continue;
        }
        const anchor = compatible[0];
        if (anchor.source?.includes("capture")) {
          index?.setAlias?.(record.id, anchor.id);
          candidate.id = String(anchor.id);
          candidate.order = Number(anchor.order);
        }
      }
    }
    const stagedId = stagedOrders.get(Number(candidate.order)) ?? null;
    if (stagedId && stagedId !== String(candidate.id)) {
      diag.reason = "staged-order-collision";
      diag.stagedOccupant = true;
      turnDiagnostics.push(diag);
      continue;
    }
    stagedOrders.set(Number(candidate.order), String(candidate.id));
    output.push(candidate);
    diag.accepted = true;
    diag.reason = "accepted";
    turnDiagnostics.push(diag);
  }

  if (diagnostics) {
    Object.assign(diagnostics, {
      recordCount: records.length,
      cacheRepair,
      existingCount: existing.length,
      anchorCount: resolved.size,
      forwardSharedOffset: Number.isFinite(sharedOffset) ? sharedOffset : null,
      reverseSharedOffset: Number.isFinite(reverseSharedOffset) ? reverseSharedOffset : null,
      forwardHasNegative,
      reverseAllNonNegative,
      orientation,
      turns: turnDiagnostics
    });
  }
  return output.sort((a, b) => Number(a.windowOrder) - Number(b.windowOrder));
}

function repairReversedVisualDomOrders(index, records = []) {
  const rows = (Array.isArray(records) ? records : [])
    .filter((record) => diagnosticTurnIdMode(record?.id) === "uuid-like"
      && Number.isFinite(record?.visualOrder));
  if (rows.length < 2 || rows.length !== records.length) {
    return { repaired: false, reason: "ineligible-visible-set", count: rows.length };
  }
  const visualOrders = rows.map((record) => Number(record.visualOrder));
  if (new Set(visualOrders).size !== rows.length) {
    return { repaired: false, reason: "ambiguous-visual-order", count: rows.length };
  }
  const known = rows.map((record) => {
    const turn = index?.get?.(record.id) ?? null;
    return turn && turn.id === String(record.id) ? turn : null;
  });
  if (known.some((turn) => !turn || turn.source !== "dom" || !Number.isFinite(turn.order))) {
    return { repaired: false, reason: "not-dom-only-known-set", count: rows.length };
  }
  const sortedOrders = known.map((turn) => Number(turn.order)).sort((a, b) => a - b);
  if (new Set(sortedOrders).size !== rows.length) {
    return { repaired: false, reason: "duplicate-known-orders", count: rows.length };
  }
  for (let i = 1; i < sortedOrders.length; i += 1) {
    if (sortedOrders[i] !== sortedOrders[i - 1] + 1) {
      return { repaired: false, reason: "noncontiguous-known-orders", count: rows.length };
    }
  }
  const visualRows = rows
    .map((record) => ({ record, known: index.get(record.id) }))
    .sort((a, b) => Number(a.record.visualOrder) - Number(b.record.visualOrder));
  const visualKnownOrders = visualRows.map((entry) => Number(entry.known.order));
  const reversed = [...sortedOrders].reverse();
  const exactlyReversed = visualKnownOrders.every((order, i) => order === reversed[i]);
  if (!exactlyReversed) {
    return { repaired: false, reason: "not-exactly-reversed", count: rows.length };
  }
  const assignments = visualRows.map((entry, i) => ({
    id: String(entry.record.id),
    order: sortedOrders[i]
  }));
  const repaired = Boolean(index?.reassignDomOrders?.(assignments));
  return {
    repaired,
    reason: repaired ? "visual-order-reversal" : "reassign-rejected",
    count: rows.length,
    minOrder: sortedOrders[0],
    maxOrder: sortedOrders.at(-1)
  };
}

function analyzeChatBootstrapWindow(records = [], { allowPartial = true } = {}) {
  const input = Array.isArray(records) ? records : [];
  const uuidRows = input
    .map((record, position) => ({
      record,
      position,
      id: String(record?.id ?? ""),
      visualOrder: Number.isFinite(record?.visualOrder) ? Number(record.visualOrder) : null,
      windowOrder: Number.isFinite(record?.windowOrder) ? Number(record.windowOrder) : position
    }))
    .filter((entry) => diagnosticTurnIdMode(entry.id) === "uuid-like");
  if (!uuidRows.length) {
    return {
      turns: [],
      basis: "none",
      partial: Boolean(input.length),
      rawCount: input.length,
      uuidCount: 0
    };
  }
  if (!allowPartial && uuidRows.length !== input.length) {
    return {
      turns: [],
      basis: "none",
      partial: true,
      rawCount: input.length,
      uuidCount: uuidRows.length
    };
  }

  const visualOrders = uuidRows.map((entry) => entry.visualOrder);
  const hasStableVisualOrder = visualOrders.every(Number.isFinite)
    && new Set(visualOrders).size === uuidRows.length;
  const windowOrders = uuidRows.map((entry) => entry.windowOrder);
  const hasStableWindowOrder = windowOrders.every(Number.isFinite)
    && new Set(windowOrders).size === uuidRows.length;
  if (!hasStableVisualOrder && !hasStableWindowOrder) {
    return {
      turns: [],
      basis: "none",
      partial: uuidRows.length !== input.length,
      rawCount: input.length,
      uuidCount: uuidRows.length
    };
  }

  const basis = hasStableVisualOrder ? "visual" : "window";
  const rows = [...uuidRows].sort((left, right) => {
    const leftOrder = basis === "visual" ? left.visualOrder : left.windowOrder;
    const rightOrder = basis === "visual" ? right.visualOrder : right.windowOrder;
    return leftOrder - rightOrder || left.position - right.position;
  });
  return {
    turns: rows.map(({ record, id }) => ({
      id,
      text: String(record?.text ?? ""),
      shortText: String(record?.shortText ?? record?.text ?? ""),
      type: record?.type ?? "text"
    })),
    basis,
    partial: uuidRows.length !== input.length || basis !== "visual",
    rawCount: input.length,
    uuidCount: uuidRows.length
  };
}

function normalizeChatBootstrapWindow(records = []) {
  return analyzeChatBootstrapWindow(records).turns;
}

function readChatBootstrapFlexDirection(container, windowRef) {
  const computed = String(windowRef?.getComputedStyle?.(container)?.flexDirection ?? "").trim();
  if (computed) return computed;
  return String(container?.style?.flexDirection ?? "").trim();
}

function isLogicalChatBootstrapBasis(basis) {
  return basis === "visual"
    || basis === "container-reverse-window"
    || basis === "container-forward-window";
}

function analyzeChatBootstrapWindowForContainer(records = [], container = null, windowRef = null, options = {}) {
  const analyzed = analyzeChatBootstrapWindow(records, options);
  if (!analyzed.turns.length || analyzed.basis !== "window") return analyzed;
  const flexDirection = readChatBootstrapFlexDirection(container, windowRef);
  if (flexDirection === "column-reverse") {
    return {
      ...analyzed,
      turns: [...analyzed.turns].reverse(),
      basis: "container-reverse-window"
    };
  }
  if (flexDirection === "column") {
    return {
      ...analyzed,
      basis: "container-forward-window"
    };
  }
  return { ...analyzed, turns: [], basis: "none" };
}

function bootstrapSequenceCoversIds(turns = [], requiredIds = []) {
  const available = new Set((Array.isArray(turns) ? turns : []).map((turn) => String(turn?.id ?? "")).filter(Boolean));
  return (Array.isArray(requiredIds) ? requiredIds : []).every((id) => available.has(String(id)));
}

function analyzeAbsoluteChatBootstrapWindow(records = []) {
  const rows = (Array.isArray(records) ? records : [])
    .filter((record) => record?.id
      && record.orderTrust !== "window"
      && Number.isFinite(record.order))
    .map((record) => ({
      id: String(record.id),
      order: Number(record.order),
      text: String(record?.text ?? ""),
      shortText: String(record?.shortText ?? record?.text ?? ""),
      type: record?.type ?? "text"
    }))
    .sort((left, right) => left.order - right.order);
  const uniqueOrders = new Set(rows.map((row) => row.order));
  if (!rows.length || rows.length !== (Array.isArray(records) ? records.length : 0) || uniqueOrders.size !== rows.length) {
    return { turns: [], basis: "absolute", partial: true };
  }
  return { turns: rows, basis: "absolute", partial: false };
}

function buildAbsoluteChatBootstrapSweepSequence(windows = []) {
  const byOrder = new Map();
  let conflict = false;
  let windowCount = 0;
  for (const window of Array.isArray(windows) ? windows : []) {
    const analyzed = Array.isArray(window?.turns) && window.basis === "absolute"
      ? window
      : analyzeAbsoluteChatBootstrapWindow(window);
    if (!analyzed.turns?.length) continue;
    windowCount += 1;
    for (const turn of analyzed.turns) {
      const order = Number(turn.order);
      if (!Number.isFinite(order) || order < 0) {
        conflict = true;
        continue;
      }
      const previous = byOrder.get(order);
      if (previous && String(previous.id) !== String(turn.id)
        && normalizeChatTurnText(previous.text) !== normalizeChatTurnText(turn.text)) {
        conflict = true;
        continue;
      }
      if (!previous || normalizeChatTurnText(turn.text).length >= normalizeChatTurnText(previous.text).length) {
        byOrder.set(order, { ...turn });
      }
    }
  }
  const orders = [...byOrder.keys()].sort((a, b) => a - b);
  const contiguous = orders.length > 0
    && orders[0] === 0
    && orders.every((order, index) => order === index);
  const turns = contiguous ? orders.map((order) => byOrder.get(order)) : [];
  const missingText = turns.filter((turn) => !normalizeChatTurnText(turn?.text)).length;
  return {
    turns: !conflict && contiguous && missingText === 0 ? turns : [],
    windowCount,
    skippedWindows: 0,
    missingText,
    complete: !conflict && contiguous && turns.length > 0 && missingText === 0
  };
}

function bootstrapWindowOrientations(window) {
  const turns = Array.isArray(window?.turns) ? window.turns : [];
  if (!turns.length) return [];
  const forward = turns.map((turn) => ({ ...turn }));
  if (isLogicalChatBootstrapBasis(window?.basis) || turns.length < 2) return [forward];
  return [forward, [...forward].reverse()];
}

function bootstrapOverlapSize(sequence = [], window = []) {
  const max = Math.min(sequence.length, window.length);
  for (let size = max; size >= 1; size -= 1) {
    let match = true;
    for (let offset = 0; offset < size; offset += 1) {
      if (sequence[sequence.length - size + offset]?.id !== window[offset]?.id) {
        match = false;
        break;
      }
    }
    if (match) return size;
  }
  return 0;
}

function containsBootstrapWindow(sequence = [], window = []) {
  if (!window.length || sequence.length < window.length) return false;
  for (let start = 0; start <= sequence.length - window.length; start += 1) {
    let match = true;
    for (let offset = 0; offset < window.length; offset += 1) {
      if (sequence[start + offset]?.id !== window[offset]?.id) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function enrichBootstrapTurns(sequence = [], windows = []) {
  const bestById = new Map();
  const prefer = (left, right) => {
    const leftText = normalizeChatTurnText(left);
    const rightText = normalizeChatTurnText(right);
    return rightText.length > leftText.length ? right : left;
  };
  for (const window of windows) {
    for (const turn of Array.isArray(window?.turns) ? window.turns : []) {
      const id = String(turn?.id ?? "");
      if (!id) continue;
      const previous = bestById.get(id) ?? { id, text: "", shortText: "", type: "text" };
      bestById.set(id, {
        id,
        text: prefer(previous.text, String(turn?.text ?? "")),
        shortText: prefer(previous.shortText, String(turn?.shortText ?? turn?.text ?? "")),
        type: previous.type !== "text" ? previous.type : (turn?.type ?? previous.type)
      });
    }
  }
  return sequence.map((turn) => ({ ...turn, ...(bestById.get(String(turn?.id ?? "")) ?? {}) }));
}

function buildChatBootstrapSweepSequence(windows = []) {
  const analyzed = (Array.isArray(windows) ? windows : [])
    .map((window) => {
      if (Array.isArray(window?.turns) && window.turns.length) {
        return {
          turns: window.turns.map((turn) => ({ ...turn })),
          basis: window.basis ?? "visual",
          partial: Boolean(window.partial)
        };
      }
      return analyzeChatBootstrapWindow(window);
    })
    .filter((window) => window.turns.length && isLogicalChatBootstrapBasis(window.basis));

  const orderedIds = [];
  const seen = new Set();
  const bestById = new Map();
  let skippedWindows = 0;
  for (const window of analyzed) {
    if (!window.turns.length) {
      skippedWindows += 1;
      continue;
    }
    for (const turn of window.turns) {
      const id = String(turn?.id ?? "");
      if (!id || diagnosticTurnIdMode(id) !== "uuid-like") continue;
      if (!seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
      const previous = bestById.get(id) ?? { id, text: "", shortText: "", type: "text" };
      const nextText = String(turn?.text ?? "");
      const nextShortText = String(turn?.shortText ?? turn?.text ?? "");
      bestById.set(id, {
        id,
        text: normalizeChatTurnText(nextText).length >= normalizeChatTurnText(previous.text).length ? nextText : previous.text,
        shortText: normalizeChatTurnText(nextShortText).length >= normalizeChatTurnText(previous.shortText).length ? nextShortText : previous.shortText,
        type: previous.type !== "text" ? previous.type : (turn?.type ?? previous.type)
      });
    }
  }
  const turns = orderedIds.map((id) => bestById.get(id)).filter(Boolean);
  const missingText = turns.filter((turn) => !normalizeChatTurnText(turn?.text)).length;
  return {
    turns: missingText === 0 ? turns : [],
    windowCount: analyzed.length,
    skippedWindows,
    missingText,
    complete: analyzed.length > 0 && turns.length > 0 && missingText === 0
  };
}

function stitchChatBootstrapWindows(windows = []) {
  const analyzed = (Array.isArray(windows) ? windows : [])
    .map((window) => {
      if (Array.isArray(window?.turns) && window.turns.length) {
        return {
          turns: window.turns.map((turn) => ({ ...turn })),
          basis: window.basis ?? "visual",
          partial: Boolean(window.partial)
        };
      }
      return analyzeChatBootstrapWindow(window);
    })
    .filter((window) => window.turns.length);
  if (!analyzed.length) {
    return { turns: [], connectedWindows: 0, totalWindows: 0, skippedWindows: 0, complete: false };
  }

  const initialWindow = analyzed[0].turns;
  const ordered = [...analyzed].reverse();
  let best = null;

  for (const seed of bootstrapWindowOrientations(ordered[0])) {
    const sequence = seed.map((turn) => ({ ...turn }));
    let connectedWindows = 1;
    let skippedWindows = 0;

    for (let i = 1; i < ordered.length; i += 1) {
      const candidateWindow = ordered[i];
      const orientations = bootstrapWindowOrientations(candidateWindow);
      let bestOrientation = null;
      let bestOverlap = 0;

      for (const candidate of orientations) {
        if (candidate.every((turn) => sequence.some((known) => known.id === turn.id))) {
          bestOrientation = candidate;
          bestOverlap = candidate.length;
          break;
        }
        const overlap = bootstrapOverlapSize(sequence, candidate);
        if (overlap > bestOverlap) {
          bestOrientation = candidate;
          bestOverlap = overlap;
        }
      }

      if (!bestOrientation || !bestOverlap) {
        skippedWindows += 1;
        continue;
      }
      for (const turn of bestOrientation.slice(bestOverlap)) {
        if (!sequence.some((known) => known.id === turn.id)) sequence.push({ ...turn });
      }
      connectedWindows += 1;
    }

    const complete = containsBootstrapWindow(sequence, initialWindow);
    const candidate = {
      turns: complete ? enrichBootstrapTurns(sequence, analyzed) : [],
      connectedWindows,
      totalWindows: analyzed.length,
      skippedWindows,
      complete
    };
    if (!best
      || Number(candidate.complete) > Number(best.complete)
      || (candidate.complete === best.complete && candidate.turns.length > best.turns.length)
      || (candidate.complete === best.complete && candidate.turns.length === best.turns.length
        && candidate.connectedWindows > best.connectedWindows)) {
      best = candidate;
    }
  }

  return best ?? {
    turns: [],
    connectedWindows: 0,
    totalWindows: analyzed.length,
    skippedWindows: analyzed.length,
    complete: false
  };
}

function diagnosticTurnIdMode(id) {
  const value = String(id ?? "");
  if (/^(?:fallback-turn|turn-index)-\d+$/.test(value)) return "fallback";
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)) return "uuid-like";
  return value ? "other" : "none";
}

function isTrustedChatOrderAnchor(record) {
  if (!record?.id || !Number.isFinite(record.order)) return false;
  if (record.source?.includes("capture")) return true;
  return /^fallback-turn-\d+$/.test(String(record.id)) || /^turn-index-\d+$/.test(String(record.id));
}

function normalizeChatTurnText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableSyntheticChatNamespace(prefix, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let hash = 0xcbf29ce484222325n;
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return String(prefix) + hash.toString(16).padStart(16, "0");
}

function stablePinnedChatNamespace(value) {
  return stableSyntheticChatNamespace("pinned-chat:", value);
}

function stableProjectChatNamespace(projectId, title) {
  const project = String(projectId ?? "").trim();
  const normalizedTitle = normalizeChatTurnText(title);
  if (!project || !normalizedTitle) return null;
  return stableSyntheticChatNamespace("project-chat:", project + "\n" + normalizedTitle);
}

function visibleChatSelectionSignature(records = []) {
  return (Array.isArray(records) ? records : [])
    .map((turn) => String(turn?.id ?? "").trim() + "\u0001" + normalizeChatTurnText(turn?.text))
    .filter(Boolean)
    .join("\u0002");
}

const CHAT_BOOTSTRAP_VISUAL_STRIP_ATTRIBUTES = [
  "id",
  "data-turn",
  "data-message-author-role",
  "data-testid",
  "data-user-message-bubble",
  "data-markdown-text-tone",
  "data-message-author",
  "data-turn-id-container",
  "data-turn-id",
  "data-content-search-turn-key",
  "data-turn-key"
];

function scrubChatBootstrapVisualClone(root) {
  const nodes = [root, ...(root?.querySelectorAll?.("*") ?? [])];
  for (const node of nodes) {
    for (const attribute of CHAT_BOOTSTRAP_VISUAL_STRIP_ATTRIBUTES) {
      try { node?.removeAttribute?.(attribute); } catch {}
    }
  }
}

function chatBootstrapBackgroundColor(container, windowRef) {
  let node = container;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement ?? null) {
    const color = String(windowRef?.getComputedStyle?.(node)?.backgroundColor ?? "").trim();
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
  }
  return "Canvas";
}

function beginChatBootstrapVisualFreeze({ document, window, container } = {}) {
  if (!container?.cloneNode || !container?.getBoundingClientRect || !document?.body?.appendChild) return null;
  const rect = container.getBoundingClientRect();
  if (!rect || Number(rect.width) < 1 || Number(rect.height) < 1) return null;
  let clone = null;
  try {
    clone = container.cloneNode(true);
    scrubChatBootstrapVisualClone(clone);
    clone.setAttribute?.("aria-hidden", "true");
    clone.setAttribute?.("data-gte-chat-bootstrap-freeze", "true");
    try { clone.inert = true; } catch {}
    const style = clone.style;
    if (!style) return null;
    style.setProperty("position", "fixed", "important");
    style.setProperty("left", Math.round(Number(rect.left) || 0) + "px", "important");
    style.setProperty("top", Math.round(Number(rect.top) || 0) + "px", "important");
    style.setProperty("width", Math.round(Number(rect.width) || 0) + "px", "important");
    style.setProperty("height", Math.round(Number(rect.height) || 0) + "px", "important");
    style.setProperty("margin", "0", "important");
    style.setProperty("overflow", "hidden", "important");
    style.setProperty("pointer-events", "none", "important");
    style.setProperty("visibility", "visible", "important");
    style.setProperty("opacity", "1", "important");
    style.setProperty("z-index", "2147483000", "important");
    style.setProperty("background-color", chatBootstrapBackgroundColor(container, window), "important");
    document.body.appendChild(clone);
    try { clone.scrollTop = Number(container.scrollTop) || 0; } catch {}
    const previousVisibility = container.style?.getPropertyValue?.("visibility") ?? "";
    const previousVisibilityPriority = container.style?.getPropertyPriority?.("visibility") ?? "";
    container.style?.setProperty?.("visibility", "hidden", "important");
    return { clone, container, previousVisibility, previousVisibilityPriority };
  } catch {
    try { clone?.remove?.(); } catch {}
    return null;
  }
}

function endChatBootstrapVisualFreeze(state) {
  if (!state) return;
  const { clone, container, previousVisibility, previousVisibilityPriority } = state;
  try {
    if (previousVisibility) container?.style?.setProperty?.("visibility", previousVisibility, previousVisibilityPriority || "");
    else container?.style?.removeProperty?.("visibility");
  } catch {}
  try { clone?.remove?.(); } catch {}
}

function waitChatBootstrapFrame(windowRef) {
  return new Promise((resolve) => {
    if (typeof windowRef?.requestAnimationFrame === "function") windowRef.requestAnimationFrame(() => resolve());
    else (windowRef?.setTimeout ?? setTimeout)(resolve, 0);
  });
}

function resolveProjectChatSelection(target) {
  const trigger = target?.closest?.("[data-thread-title-trigger]") ?? null;
  if (!trigger) return null;
  if (trigger.closest?.("[data-pinned-content-tab-drop-key], [data-sidebar-chatgpt-conversation-key], [data-app-action-sidebar-thread-id]")) {
    return null;
  }
  const projectScope = trigger.closest?.("[data-sidebar-project-container-id], [data-app-action-sidebar-project-id]") ?? null;
  if (!projectScope) return null;
  const projectId = projectScope.getAttribute?.("data-sidebar-project-container-id")
    ?? projectScope.getAttribute?.("data-app-action-sidebar-project-id")
    ?? "";
  const titleNode = trigger.querySelector?.("[data-thread-title]") ?? null;
  const title = normalizeChatTurnText(titleNode?.textContent ?? trigger.textContent ?? "");
  if (!projectId || !title) return null;

  const matches = [...(projectScope.querySelectorAll?.("[data-thread-title-trigger]") ?? [])]
    .filter((candidate) => {
      const candidateTitleNode = candidate?.querySelector?.("[data-thread-title]") ?? null;
      return normalizeChatTurnText(candidateTitleNode?.textContent ?? candidate?.textContent ?? "") === title;
    });
  if (matches.length !== 1) return null;
  const conversationId = stableProjectChatNamespace(projectId, title);
  return conversationId ? { conversationId, titleMatchCount: matches.length } : null;
}

function canonicalChatConversationId(value) {
  const id = String(value ?? "").trim();
  if (!id || id.startsWith("local:")) return id || null;
  return parseSidebarConversationKey(id);
}

function normalizePinnedChatComparableText(value) {
  return normalizeQuestionDisplayText(value).replace(/\s+/g, " ").trim();
}

export function resolvePinnedChatConversationCandidate(visibleRecords = [], candidates = []) {
  const visible = (Array.isArray(visibleRecords) ? visibleRecords : []).filter((record) => record?.id);
  if (!visible.length) return null;

  const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.conversationId && Array.isArray(candidate.turns) && candidate.turns.length)
    .map((candidate) => ({
      conversationId: String(candidate.conversationId),
      turns: candidate.turns
    }));
  if (!normalizedCandidates.length) return null;

  const visibleTexts = visible
    .map((record) => normalizeChatTurnText(record.text))
    .filter((text) => text && text !== "[图片或文件]");
  if (visibleTexts.length >= 2) {
    const textMatches = new Set();
    for (const candidate of normalizedCandidates) {
      const candidateTexts = candidate.turns
        .map((turn) => normalizeChatTurnText(turn?.text))
        .filter((text) => text && text !== "[图片或文件]");
      if (countContiguousSequence(candidateTexts, visibleTexts) === 1) {
        textMatches.add(candidate.conversationId);
      }
    }
    if (textMatches.size === 1) {
      return {
        conversationId: [...textMatches][0],
        evidence: "visible-text-sequence",
        score: visibleTexts.length
      };
    }
  }

  const comparableVisibleTexts = visible
    .map((record) => normalizePinnedChatComparableText(record.text))
    .filter((text) => text && text !== "[图片或文件]");
  if (comparableVisibleTexts.length >= 2) {
    const comparableMatches = new Set();
    for (const candidate of normalizedCandidates) {
      const comparableCandidateTexts = candidate.turns
        .map((turn) => normalizePinnedChatComparableText(turn?.text))
        .filter((text) => text && text !== "[图片或文件]");
      if (countContiguousSequence(comparableCandidateTexts, comparableVisibleTexts) === 1) {
        comparableMatches.add(candidate.conversationId);
      }
    }
    if (comparableMatches.size === 1) {
      return {
        conversationId: [...comparableMatches][0],
        evidence: "visible-normalized-text-sequence",
        score: comparableVisibleTexts.length
      };
    }
  }

  const stableVisibleIds = new Set(
    visible
      .map((record) => String(record?.id ?? ""))
      .filter((id) => diagnosticTurnIdMode(id) === "uuid-like")
  );
  if (!stableVisibleIds.size) return null;

  const idMatches = normalizedCandidates
    .map((candidate) => ({
      conversationId: candidate.conversationId,
      count: candidate.turns.reduce(
        (total, turn) => total + (stableVisibleIds.has(String(turn?.id ?? "")) ? 1 : 0),
        0
      )
    }))
    .filter((item) => item.count > 0);

  if (idMatches.length === 1) {
    return {
      conversationId: idMatches[0].conversationId,
      evidence: "visible-uuid-overlap",
      score: idMatches[0].count
    };
  }
  return null;
}

function countContiguousSequence(haystack, needle) {
  if (!needle.length || haystack.length < needle.length) return 0;
  let count = 0;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) { matched = false; break; }
    }
    if (matched) count += 1;
  }
  return count;
}

function longestContiguousVisibleTextRun(candidateTexts = [], visibleTexts = []) {
  if (!candidateTexts.length || !visibleTexts.length) return 0;
  let best = 0;
  for (let visibleStart = 0; visibleStart < visibleTexts.length; visibleStart += 1) {
    for (let candidateStart = 0; candidateStart < candidateTexts.length; candidateStart += 1) {
      let length = 0;
      while (visibleStart + length < visibleTexts.length
        && candidateStart + length < candidateTexts.length
        && visibleTexts[visibleStart + length] === candidateTexts[candidateStart + length]) length += 1;
      if (length > best) best = length;
    }
  }
  return best;
}

function diagnosePinnedChatCandidates(visibleRecords = [], candidates = [], { memoryIds = new Set(), cacheIds = new Set() } = {}) {
  const visible = (Array.isArray(visibleRecords) ? visibleRecords : []).filter((record) => record?.id);
  const visibleIds = new Set(visible.map((record) => String(record.id)));
  const stableVisibleIds = new Set(
    visible
      .map((record) => String(record?.id ?? ""))
      .filter((id) => diagnosticTurnIdMode(id) === "uuid-like")
  );
  const visibleTexts = visible.map((record) => normalizeChatTurnText(record.text)).filter((text) => text && text !== "[图片或文件]");
  const visibleComparableTexts = visible.map((record) => normalizePinnedChatComparableText(record.text)).filter((text) => text && text !== "[图片或文件]");
  const visibleTextSet = new Set(visibleTexts);
  const visibleComparableTextSet = new Set(visibleComparableTexts);
  const summaries = [];
  let ordinal = 0;
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate?.conversationId || !Array.isArray(candidate.turns) || !candidate.turns.length) continue;
    ordinal += 1;
    const conversationId = String(candidate.conversationId);
    const turns = candidate.turns;
    const candidateTexts = turns.map((turn) => normalizeChatTurnText(turn?.text)).filter((text) => text && text !== "[图片或文件]");
    const candidateComparableTexts = turns.map((turn) => normalizePinnedChatComparableText(turn?.text)).filter((text) => text && text !== "[图片或文件]");
    const candidateTextSet = new Set(candidateTexts);
    const candidateComparableTextSet = new Set(candidateComparableTexts);
    const idOverlap = turns.reduce((total, turn) => total + (visibleIds.has(String(turn?.id ?? "")) ? 1 : 0), 0);
    const stableIdOverlap = turns.reduce(
      (total, turn) => total + (stableVisibleIds.has(String(turn?.id ?? "")) ? 1 : 0),
      0
    );
    const exactTextOverlap = [...visibleTextSet].reduce((total, text) => total + (candidateTextSet.has(text) ? 1 : 0), 0);
    const normalizedTextOverlap = [...visibleComparableTextSet].reduce((total, text) => total + (candidateComparableTextSet.has(text) ? 1 : 0), 0);
    summaries.push({
      candidate: ordinal,
      source: memoryIds.has(conversationId) && cacheIds.has(conversationId) ? "memory+cache" : memoryIds.has(conversationId) ? "memory" : cacheIds.has(conversationId) ? "cache" : "unknown",
      turnCount: turns.length,
      idOverlap,
      stableIdOverlap,
      exactTextOverlap,
      normalizedTextOverlap,
      fullVisibleSequenceOccurrences: countContiguousSequence(candidateTexts, visibleTexts),
      bestContiguousTextRun: longestContiguousVisibleTextRun(candidateTexts, visibleTexts),
      fullNormalizedSequenceOccurrences: countContiguousSequence(candidateComparableTexts, visibleComparableTexts),
      bestNormalizedContiguousTextRun: longestContiguousVisibleTextRun(candidateComparableTexts, visibleComparableTexts)
    });
  }
  const resolved = resolvePinnedChatConversationCandidate(visible, candidates);
  let resolvedCandidate = null;
  if (resolved?.conversationId) {
    const index = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate?.conversationId && Array.isArray(candidate.turns) && candidate.turns.length).findIndex((candidate) => String(candidate.conversationId) === String(resolved.conversationId));
    resolvedCandidate = index >= 0 ? index + 1 : null;
  }
  return {
    visibleTurnCount: visible.length,
    visibleUsableTextCount: visibleTexts.length,
    visibleComparableTextCount: visibleComparableTexts.length,
    candidateCount: summaries.length,
    resolved: Boolean(resolved),
    resolvedCandidate,
    evidence: resolved?.evidence ?? null,
    score: resolved?.score ?? null,
    candidates: summaries
  };
}

export class TalkEnhancerV3App {
  constructor({ document, window, host = null, storage = null } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.eventBus = new EventBus();
    this.storage = storage ?? new LocalStorageAdapter(this.window?.localStorage);
    this.conversations = new ConversationStore();
    this.timelineState = new TimelineState();
    this.promptStore = new PromptStore({ storage: this.storage });
    this.settings = new SettingsStore({ storage: this.storage });
    this.chatTimelineCache = new TimelineCache({ storage: this.storage });
    this.timelineCache = this.chatTimelineCache;
    this.workTimelineCache = new WorkTimelineCache({ storage: this.storage });
    this.cacheHydrationCounts = new Map();
    this.cacheHydrationDiagnostics = new Map();
    this.turnIndexes = new Map();
    this.currentConversationId = null;
    this.recentStableChatIdentity = null;
    this.chatConversationAliases = new Map();
    this.pendingConversationSelectionId = null;
    this.pendingConversationSelectionStartedAt = 0;
    this.pendingPinnedChatSelection = null;
    this.activePinnedChatConversationId = null;
    this.lastPinnedClickTransition = null;
    this.lastNavigation = { target: null, verified: false, reason: "none" };
    this.navigationRequestId = 0;
    this.navigationRunSequence = 0;
    this.activeNavigation = null;
    this.navigationHistory = [];
    this.slowNavigationHistory = sanitizeSlowNavigationHistory(
      this.storage?.read?.(SLOW_NAVIGATION_STORAGE_KEY, [])
    );
    this.navigationUxTimer = null;
    this.navigationUx = { state: "idle", target: null, targetOrder: null, pendingVisible: false };
    this.captureStatus = { status: "unavailable", turnCount: 0, lastError: "" };
    this.captureDiagnostics = [];
    this.chatScrollDiagnostics = [];
    this.diagnosticConversationOrdinals = new Map();
    this.nextDiagnosticConversationOrdinal = 1;
    this.lastChatScrollDiagnosticSignature = null;
    this.destroyed = false;
    this.refreshFrame = null;
    this.observer = null;
    this.scrollContainer = null;
    this.boundScroll = () => {
      this.captureActiveChatBootstrapWindow(this.getChatBootstrapVisibleTurns());
      this.recordChatScrollDiagnostic("scroll");
      this.scheduleRefresh("scroll");
    };
    this.boundRoute = () => this.scheduleRefresh("route");
    this.conversationSelectTimer = null;
    this.chatIdentitySettleTimer = null;
    this.chatIdentitySettleAttempt = 0;
    this.localNavigationSettleUntil = 0;
    this.workEarlierHydrationGeneration = 0;
    this.workEarlierHydrationPromise = null;
    this.workEarlierHydrationExhausted = new Map();
    this.chatEarlierHydrationGeneration = 0;
    this.chatEarlierHydrationPromise = null;
    this.chatEarlierHydrationExhausted = new Map();
    this.chatBootstrapHydrationGeneration = 0;
    this.chatBootstrapHydrationPromise = null;
    this.chatBootstrapAttempted = new Set();
    this.chatBootstrapFailures = new Map();
    this.chatAutoRepairBlocked = new Set();
    this.chatBootstrapRetryTimer = null;
    this.chatBootstrapCollector = null;
    this.chatBootstrapSampleTimer = null;
    this.lastChatBootstrapDiagnostics = null;
    this.pinnedChatProbeArmed = false;
    this.pinnedChatProbe = null;
    this.pinnedChatProbeBaselineId = null;
    this.pinnedChatProbeBaselineRoute = null;
    this.pinnedChatProbeObserver = null;
    this.pinnedChatProbeTimers = [];
    this.lastPinnedChatInference = {
      inferredConversationSet: false,
      result: "uninitialized",
      directIdentityPresent: false,
      directIdentityStable: false,
      visibleTurnCount: 0,
      candidateCount: 0,
      evidence: null
    };
    this.lastRefreshDiagnostics = {
      reason: null,
      branch: "uninitialized",
      resolvedIdentity: { present: false },
      chatVisibleTurnsCount: 0,
      routedVisibleTurnsCount: 0,
      preReconcileIndexCount: 0,
      trustedVisibleTurnsCount: 0,
      postRefreshIndexCount: 0
    };
    this.boundConversationSelect = (event) => this.handleConversationSelect(event);
    this.boundPinnedChatProbeEvent = (event) => this.capturePinnedChatProbe(event);
    this.host = host ?? new CodexDesktopHost({
      document: this.document,
      window: this.window,
      onCapture: (payload) => this.handleCapture(payload),
      onCaptureStatus: (status) => this.handleCaptureStatus(status)
    });
    this.shell = new AppShell({
      document: this.document,
      window: this.window,
      host: this.host,
      promptStore: this.promptStore,
      onNavigate: (turnId) => this.navigate(turnId),
      onLoadEarlier: () => this.loadAllEarlierHistory(),
      initialPanelOpen: this.settings.load().timelinePanelOpen
    });
  }

  start() {
    this.window?.__GPTTalkEnhancerV3?.destroy?.();
    this.shell.mount();
    this.host.start?.();
    this.bindLifecycle();
    this.refresh("start");
    this.window.__GPTTalkEnhancerV3 = this;
    return this;
  }

  bindLifecycle() {
    if (typeof this.window?.MutationObserver === "function" && this.document?.body) {
      this.observer = new this.window.MutationObserver(() => {
        this.captureActiveChatBootstrapWindow(this.getChatBootstrapVisibleTurns());
        this.scheduleRefresh("mutation");
      });
      this.observer.observe(this.document.body, { childList: true, subtree: true, attributes: true });
    }
    this.window?.addEventListener?.("popstate", this.boundRoute);
    this.window?.addEventListener?.("hashchange", this.boundRoute);
    this.document?.addEventListener?.("click", this.boundConversationSelect, true);
    for (const type of ["pointerdown", "mousedown", "click", "pointerup"]) {
      this.document?.addEventListener?.(type, this.boundPinnedChatProbeEvent, true);
      this.window?.addEventListener?.(type, this.boundPinnedChatProbeEvent, true);
    }
  }

  handleConversationSelect(event) {
    const row = event?.target?.closest?.(
      "[data-sidebar-chatgpt-conversation-key], [data-app-action-sidebar-thread-id], [data-pinned-content-tab-drop-key], [data-thread-title-trigger]"
    );
    if (!row) return;
    this.recordChatScrollDiagnostic("conversation-select-before", { force: true });
    const localId = row?.getAttribute?.("data-app-action-sidebar-thread-id") ?? null;
    const chatKey = row?.getAttribute?.("data-sidebar-chatgpt-conversation-key") ?? null;
    const pinnedDropKey = row?.getAttribute?.("data-pinned-content-tab-drop-key") ?? null;
    const expectedChatId = chatKey ? parseSidebarConversationKey(chatKey) : null;
    const pinnedConversationId = pinnedDropKey ? stablePinnedChatNamespace(pinnedDropKey) : null;
    const projectSelection = !localId && !expectedChatId && !pinnedConversationId
      ? resolveProjectChatSelection(event?.target)
      : null;
    const syntheticConversationId = pinnedConversationId ?? projectSelection?.conversationId ?? null;
    const syntheticKind = pinnedConversationId ? "pinned" : projectSelection ? "project" : null;
    const currentIdentity = this.host.getConversationIdentity?.() ?? null;
    const currentLocalId = currentIdentity?.stable
      && currentIdentity?.host === "local"
      && currentIdentity?.source === "sidebar-local"
      ? String(currentIdentity.id ?? "")
      : "";
    const leavingCurrentLocal = Boolean(currentLocalId && (!localId || String(localId) !== currentLocalId));
    if (leavingCurrentLocal) this.host.persistLocalScrollPosition?.();
    const localThreadSelected = Boolean(localId);
    const pinnedChatSelected = Boolean(syntheticConversationId && !localThreadSelected && !expectedChatId);
    if (!pinnedChatSelected) {
      this.pendingPinnedChatSelection = null;
      this.activePinnedChatConversationId = null;
      this.lastPinnedClickTransition = null;
    }
    if (pinnedChatSelected) {
      const baselineVisibleIds = new Set(
        (this.host.getChatVisibleTurns?.() ?? this.host.getVisibleTurns?.() ?? [])
          .map((turn) => String(turn?.id ?? "").trim())
          .filter(Boolean)
      );
      const baselineVisibleSignature = visibleChatSelectionSignature(
        this.host.getChatVisibleTurns?.() ?? this.host.getVisibleTurns?.() ?? []
      );
      if (syntheticConversationId === this.currentConversationId) {
        this.pendingPinnedChatSelection = null;
        this.activePinnedChatConversationId = syntheticConversationId;
        this.lastPinnedClickTransition = {
          state: "already-current",
          baselineVisibleCount: baselineVisibleIds.size,
          currentVisibleCount: baselineVisibleIds.size,
          overlapCount: baselineVisibleIds.size
        };
      } else {
        this.activePinnedChatConversationId = null;
        this.pendingPinnedChatSelection = {
          conversationId: syntheticConversationId,
          kind: syntheticKind,
          baselineConversationId: currentIdentity?.stable && currentIdentity?.host === "chatgpt"
            ? canonicalChatConversationId(currentIdentity.id)
            : canonicalChatConversationId(this.currentConversationId),
          baselineVisibleIds,
          baselineVisibleSignature,
          startedAt: appNowMs(this.window),
          observedRefreshes: 0
        };
        this.lastPinnedClickTransition = {
          state: "armed",
          baselineVisibleCount: baselineVisibleIds.size,
          currentVisibleCount: baselineVisibleIds.size,
          overlapCount: baselineVisibleIds.size
        };
        this.cancelChatEarlierHydration();
        this.cancelChatBootstrapHydration();
        this.shell?.updateTimeline?.([], null);
        this.shell?.setQuestionHistoryState?.({ visible: false, loading: false, exhausted: false });
      }
    }
    const expectedConversationId = localThreadSelected ? String(localId) : expectedChatId;
    if (expectedConversationId && expectedConversationId !== this.currentConversationId) {
      this.pendingConversationSelectionId = expectedConversationId;
      this.pendingConversationSelectionStartedAt = appNowMs(this.window);
      this.cancelWorkEarlierHydration();
      this.cancelChatEarlierHydration();
      this.shell?.updateTimeline?.([], null);
      this.shell?.setQuestionHistoryState?.({ visible: false, loading: false, exhausted: false });
    }
    this.localNavigationSettleUntil = localThreadSelected ? appNowMs(this.window) + LOCAL_NAVIGATION_SETTLE_MS : 0;
    this.invalidateNavigation("conversation-select");
    this.scheduleRefresh("conversation-select");
    this.clearConversationSelectTimer();
    if (pinnedChatSelected) {
      this.scheduleConversationSelectRetry({ expectedChatId: null, attempt: 0, delays: CHAT_CONVERSATION_SETTLE_DELAYS_MS });
      return;
    }
    if (localThreadSelected || !expectedChatId) {
      this.scheduleConversationSelectRetry({ expectedChatId: null, attempt: 0, delays: [240] });
      return;
    }
    this.scheduleConversationSelectRetry({ expectedChatId, attempt: 0, delays: CHAT_CONVERSATION_SETTLE_DELAYS_MS });
  }

  clearConversationSelectTimer() {
    if (this.conversationSelectTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.conversationSelectTimer);
    this.conversationSelectTimer = null;
  }

  scheduleConversationSelectRetry({ expectedChatId = null, attempt = 0, delays = CHAT_CONVERSATION_SETTLE_DELAYS_MS } = {}) {
    if (this.destroyed || attempt >= delays.length) return;
    const set = this.window?.setTimeout ?? setTimeout;
    this.conversationSelectTimer = set(() => {
      this.conversationSelectTimer = null;
      this.refresh("conversation-select-settled");
      if (expectedChatId && this.host.getConversationId?.() !== expectedChatId) {
        this.scheduleConversationSelectRetry({ expectedChatId, attempt: attempt + 1, delays });
      }
    }, delays[attempt]);
  }
  clearChatIdentitySettleRetry({ resetAttempt = true } = {}) {
    if (this.chatIdentitySettleTimer != null) {
      const clear = this.window?.clearTimeout ?? clearTimeout;
      clear(this.chatIdentitySettleTimer);
      this.chatIdentitySettleTimer = null;
    }
    if (resetAttempt) this.chatIdentitySettleAttempt = 0;
  }

  scheduleChatIdentitySettleRetry() {
    if (this.destroyed || this.chatIdentitySettleTimer != null) return false;
    if (this.chatIdentitySettleAttempt >= CHAT_CONVERSATION_SETTLE_DELAYS_MS.length) return false;
    if (String(this.currentConversationId ?? "").startsWith("local:")) return false;
    const visibleChatTurns = this.host.getChatVisibleTurns?.() ?? [];
    if (!visibleChatTurns.length) return false;

    const attempt = this.chatIdentitySettleAttempt;
    const set = this.window?.setTimeout ?? setTimeout;
    this.chatIdentitySettleTimer = set(() => {
      this.chatIdentitySettleTimer = null;
      if (this.destroyed) return;
      const surface = this.host.getSurface?.();
      if (surface !== SURFACE.CONVERSATION) {
        this.chatIdentitySettleAttempt = 0;
        return;
      }
      const directIdentity = this.host.getDirectConversationIdentity?.() ?? null;
      if (directIdentity?.stable) {
        this.chatIdentitySettleAttempt = 0;
        this.refresh("chat-identity-settled");
        return;
      }
      this.chatIdentitySettleAttempt = attempt + 1;
      this.refresh("chat-identity-settle-retry");
    }, CHAT_CONVERSATION_SETTLE_DELAYS_MS[attempt]);
    return true;
  }

  scheduleRefresh(reason = "event") {
    if (this.destroyed || this.refreshFrame != null) return;
    const run = () => {
      this.refreshFrame = null;
      this.refresh(reason);
    };
    if (typeof this.window?.requestAnimationFrame === "function") this.refreshFrame = this.window.requestAnimationFrame(run);
    else this.refreshFrame = this.window?.setTimeout?.(run, 0) ?? setTimeout(run, 0);
  }

  getPinnedChatCandidates() {
    const byId = new Map();
    const rememberCandidate = (conversationId, turns = []) => {
      const canonicalId = canonicalChatConversationId(conversationId);
      const id = canonicalId ? (this.chatConversationAliases.get(canonicalId) ?? canonicalId) : null;
      if (!id || id.startsWith("local:")) return;
      const records = Array.isArray(turns) ? turns : [];
      const current = byId.get(id);
      if (!current || records.length > current.turns.length) {
        byId.set(id, { conversationId: id, turns: records });
      }
    };
    for (const entry of this.chatTimelineCache.listConversations?.() ?? []) {
      rememberCandidate(entry?.conversationId, entry?.turns ?? []);
    }
    for (const [conversationId, index] of this.turnIndexes) {
      const turns = index?.getOrdered?.() ?? [];
      if (!turns.length) continue;
      rememberCandidate(conversationId, turns);
    }
    return [...byId.values()];
  }

  adoptDirectChatIdentity(identity, visibleRecords = []) {
    if (!identity?.stable || identity.host !== "chatgpt" || !identity.id) {
      return { identity, migrated: false, evidence: null };
    }
    const targetId = canonicalChatConversationId(identity.id);
    if (!targetId) return { identity, migrated: false, evidence: null };
    const normalizedIdentity = String(identity.id) === targetId ? identity : { ...identity, id: targetId };
    const sourceId = String(this.currentConversationId ?? "").trim();
    if (!sourceId || sourceId === targetId || sourceId.startsWith("local:")) {
      return { identity: normalizedIdentity, migrated: false, evidence: null };
    }

    const sourceIndex = this.turnIndexes.get(sourceId) ?? null;
    if (!sourceIndex) return { identity: normalizedIdentity, migrated: false, evidence: null };
    const canonicalSourceId = canonicalChatConversationId(sourceId);
    const sameCanonicalConversation = canonicalSourceId === targetId;
    const sourceTurns = sourceIndex.getOrdered?.() ?? [];
    const visible = Array.isArray(visibleRecords) ? visibleRecords : [];
    const sourceIds = new Set(sourceTurns.map((turn) => String(turn?.id ?? "")).filter(Boolean));
    const exactVisibleIdOverlap = visible.some((turn) => sourceIds.has(String(turn?.id ?? "")));
    const recent = this.recentStableChatIdentity;
    const recentAgeMs = Number.isFinite(recent?.confirmedAt)
      ? Math.max(0, appNowMs(this.window) - Number(recent.confirmedAt))
      : Number.POSITIVE_INFINITY;
    const recentOneTurnDirectRekey = !sourceId.startsWith("pinned-chat:")
      && !this.pendingConversationSelectionId
      && recent?.conversationId === canonicalSourceId
      && recentAgeMs <= CHAT_DIRECT_REKEY_WINDOW_MS
      && sourceTurns.length === 1
      && visible.length === 1
      && sourceTurns[0]?.visible === true
      && normalizeChatTurnText(sourceTurns[0]?.text)
      && normalizeChatTurnText(sourceTurns[0]?.text) === normalizeChatTurnText(visible[0]?.text);
    if (!sameCanonicalConversation && !exactVisibleIdOverlap && !recentOneTurnDirectRekey) {
      return { identity: normalizedIdentity, migrated: false, evidence: null };
    }

    const targetIndex = this.getTurnIndex(targetId);
    targetIndex.mergeMany(sourceTurns);
    const sourceHydration = Number(this.cacheHydrationCounts.get(sourceId) ?? 0);
    const targetHydration = Number(this.cacheHydrationCounts.get(targetId) ?? 0);
    if (sourceHydration || targetHydration) {
      this.cacheHydrationCounts.set(targetId, Math.max(sourceHydration, targetHydration));
    }
    const sourceViewState = this.timelineState.get(sourceId);
    if (sourceViewState) this.timelineState.update(targetId, sourceViewState);
    this.persistTimelineCache(targetId, targetIndex);
    if (canonicalSourceId && canonicalSourceId !== targetId) this.chatConversationAliases.set(canonicalSourceId, targetId);
    return {
      identity: normalizedIdentity,
      migrated: true,
      evidence: sameCanonicalConversation
        ? "canonical-id-handoff"
        : exactVisibleIdOverlap ? "visible-id-handoff" : "recent-one-turn-direct-rekey"
    };
  }

  rememberStableChatIdentity(identity, visibleRecords = []) {
    if (!identity?.stable || identity.host !== "chatgpt" || !identity.id) return false;
    const visibleIds = (Array.isArray(visibleRecords) ? visibleRecords : [])
      .map((record) => String(record?.id ?? "").trim())
      .filter(Boolean);
    const conversationId = canonicalChatConversationId(identity.id);
    if (!conversationId) return false;
    this.recentStableChatIdentity = {
      conversationId,
      visibleIds: new Set(visibleIds),
      confirmedAt: appNowMs(this.window)
    };
    return true;
  }

  resolveRecentStableChatIdentity(visibleRecords = []) {
    const recent = this.recentStableChatIdentity;
    if (!recent?.conversationId || !(recent.visibleIds instanceof Set) || !recent.visibleIds.size) return null;
    const currentIds = new Set(
      (Array.isArray(visibleRecords) ? visibleRecords : [])
        .map((record) => String(record?.id ?? "").trim())
        .filter(Boolean)
    );
    if (!currentIds.size) return null;
    const overlap = [...currentIds].some((id) => recent.visibleIds.has(id));
    return overlap ? recent.conversationId : null;
  }

  refreshPinnedChatInference(surface) {
    const hasDirectIdentityApi = typeof this.host.getDirectConversationIdentity === "function";
    let directIdentity = hasDirectIdentityApi
      ? this.host.getDirectConversationIdentity()
      : this.host.getConversationIdentity?.() ?? null;
    const pendingPinned = this.pendingPinnedChatSelection;
    if (pendingPinned && surface === SURFACE.CONVERSATION && this.host.getChatVisibleTurns && this.host.setInferredChatConversationId) {
      pendingPinned.observedRefreshes = Number(pendingPinned.observedRefreshes ?? 0) + 1;
      const visible = this.host.getChatVisibleTurns?.() ?? [];
      const currentIds = new Set(visible.map((turn) => String(turn?.id ?? "").trim()).filter(Boolean));
      const baselineIds = pendingPinned.baselineVisibleIds instanceof Set ? pendingPinned.baselineVisibleIds : new Set();
      const overlapCount = [...currentIds].reduce((total, id) => total + (baselineIds.has(id) ? 1 : 0), 0);
      const ageMs = Math.max(0, appNowMs(this.window) - Number(pendingPinned.startedAt || 0));
      const expired = ageMs >= PINNED_CHAT_SELECTION_TTL_MS;
      const currentVisibleSignature = visibleChatSelectionSignature(visible);
      const baselineVisibleSignature = String(pendingPinned.baselineVisibleSignature ?? "");
      const projectTransitioned = pendingPinned.kind === "project"
        && currentIds.size > 0
        && pendingPinned.observedRefreshes >= 2
        && Boolean(currentVisibleSignature)
        && currentVisibleSignature !== baselineVisibleSignature;
      const transitioned = pendingPinned.kind === "project"
        ? projectTransitioned
        : currentIds.size > 0
          && (baselineIds.size > 0 ? overlapCount === 0 : pendingPinned.observedRefreshes >= 2);
      const directId = directIdentity?.stable && directIdentity.host === "chatgpt"
        ? canonicalChatConversationId(directIdentity.id)
        : null;
      const directChanged = Boolean(directId && directId !== pendingPinned.baselineConversationId);
      const staleBaselineDirect = Boolean(directId && directId === pendingPinned.baselineConversationId);

      this.lastPinnedClickTransition = {
        state: expired && !staleBaselineDirect
          ? "expired"
          : transitioned
            ? (directChanged ? "direct-transition" : staleBaselineDirect ? "waiting-stale-direct" : "visible-window-transition")
            : "waiting",
        ageMs: Math.round(ageMs),
        baselineVisibleCount: baselineIds.size,
        currentVisibleCount: currentIds.size,
        overlapCount,
        observedRefreshes: pendingPinned.observedRefreshes,
        selectionKind: pendingPinned.kind ?? "pinned",
        signatureChanged: Boolean(currentVisibleSignature && currentVisibleSignature !== baselineVisibleSignature)
      };

      if (transitioned && directChanged) {
        this.pendingPinnedChatSelection = null;
      } else if (transitioned && staleBaselineDirect) {
        this.host.clearInferredChatConversationId?.();
        this.lastPinnedChatInference = {
          inferredConversationSet: false,
          result: "pinned-click-waiting-for-stale-direct-to-clear",
          directIdentityPresent: true,
          directIdentityStable: true,
          visibleTurnCount: visible.length,
          candidateCount: 0,
          evidence: null
        };
        return null;
      } else if (transitioned) {
        const inferredConversationSet = Boolean(this.host.setInferredChatConversationId(pendingPinned.conversationId));
        const inferredIdentity = this.host.getConversationIdentity?.() ?? null;
        this.pendingPinnedChatSelection = null;
        this.activePinnedChatConversationId = inferredConversationSet ? pendingPinned.conversationId : null;
        if (inferredIdentity?.stable && inferredIdentity.host === "chatgpt") {
          this.rememberStableChatIdentity(inferredIdentity, visible);
        }
        this.lastPinnedChatInference = {
          inferredConversationSet,
          result: inferredConversationSet
            ? (pendingPinned.kind === "project" ? "project-chat-click-visible-window-transition" : "pinned-click-visible-window-transition")
            : (pendingPinned.kind === "project" ? "project-chat-click-inference-failed" : "pinned-click-inference-failed"),
          directIdentityPresent: Boolean(directIdentity),
          directIdentityStable: Boolean(directIdentity?.stable),
          visibleTurnCount: visible.length,
          candidateCount: 0,
          evidence: pendingPinned.kind === "project"
            ? "project-chat-click-visible-window-transition"
            : "pinned-click-visible-window-transition"
        };
        return inferredIdentity;
      } else if (!expired || staleBaselineDirect) {
        this.host.clearInferredChatConversationId?.();
        this.lastPinnedChatInference = {
          inferredConversationSet: false,
          result: "pinned-click-waiting-for-content-transition",
          directIdentityPresent: Boolean(directIdentity),
          directIdentityStable: Boolean(directIdentity?.stable),
          visibleTurnCount: visible.length,
          candidateCount: 0,
          evidence: null
        };
        return null;
      } else {
        this.pendingPinnedChatSelection = null;
        this.activePinnedChatConversationId = null;
      }
    }
    if (directIdentity?.stable) {
      this.pendingPinnedChatSelection = null;
      this.activePinnedChatConversationId = null;
      const visible = directIdentity.host === "chatgpt" ? this.host.getChatVisibleTurns?.() ?? [] : [];
      const handoff = directIdentity.host === "chatgpt"
        ? this.adoptDirectChatIdentity(directIdentity, visible)
        : { identity: directIdentity, migrated: false, evidence: null };
      directIdentity = handoff.identity;
      this.host.clearInferredChatConversationId?.();
      if (directIdentity.host === "chatgpt") {
        this.rememberStableChatIdentity(directIdentity, visible);
      } else if (directIdentity.host === "local") {
        this.recentStableChatIdentity = null;
      }
      this.lastPinnedChatInference = {
        inferredConversationSet: false,
        result: "direct-stable",
        directIdentityPresent: true,
        directIdentityStable: true,
        visibleTurnCount: visible.length,
        candidateCount: 0,
        evidence: handoff.evidence,
        handoffMigrated: handoff.migrated
      };
      return directIdentity;
    }
    if (surface === SURFACE.CONVERSATION && this.activePinnedChatConversationId && this.host.setInferredChatConversationId) {
      const visible = this.host.getChatVisibleTurns?.() ?? [];
      const inferredConversationSet = Boolean(this.host.setInferredChatConversationId(this.activePinnedChatConversationId));
      const inferredIdentity = this.host.getConversationIdentity?.() ?? null;
      if (inferredIdentity?.stable && inferredIdentity.host === "chatgpt") {
        this.rememberStableChatIdentity(inferredIdentity, visible);
      }
      this.lastPinnedChatInference = {
        inferredConversationSet,
        result: inferredConversationSet
          ? (String(this.activePinnedChatConversationId).startsWith("project-chat:") ? "project-chat-click-latched" : "pinned-click-latched")
          : (String(this.activePinnedChatConversationId).startsWith("project-chat:") ? "project-chat-click-latch-failed" : "pinned-click-latch-failed"),
        directIdentityPresent: false,
        directIdentityStable: false,
        visibleTurnCount: visible.length,
        candidateCount: 0,
        evidence: String(this.activePinnedChatConversationId).startsWith("project-chat:")
          ? "project-chat-click-latched"
          : "pinned-click-latched"
      };
      return inferredIdentity;
    }
    if (surface !== SURFACE.CONVERSATION || !this.host.getChatVisibleTurns || !this.host.setInferredChatConversationId) {
      this.activePinnedChatConversationId = null;
      this.host.clearInferredChatConversationId?.();
      this.lastPinnedChatInference = {
        inferredConversationSet: false,
        result: "ineligible",
        directIdentityPresent: Boolean(directIdentity),
        directIdentityStable: Boolean(directIdentity?.stable),
        visibleTurnCount: 0,
        candidateCount: 0,
        evidence: null
      };
      return directIdentity;
    }
    const visible = this.host.getChatVisibleTurns?.() ?? [];
    const recentConversationId = this.resolveRecentStableChatIdentity(visible);
    if (recentConversationId) {
      const inferredConversationSet = Boolean(this.host.setInferredChatConversationId(recentConversationId));
      const inferredIdentity = this.host.getConversationIdentity?.() ?? directIdentity;
      if (inferredIdentity?.stable && inferredIdentity.host === "chatgpt") {
        this.rememberStableChatIdentity(inferredIdentity, visible);
      }
      this.lastPinnedChatInference = {
        inferredConversationSet,
        result: inferredConversationSet ? "recent-visible-id-overlap" : "recent-visible-id-overlap-failed",
        directIdentityPresent: Boolean(directIdentity),
        directIdentityStable: Boolean(directIdentity?.stable),
        visibleTurnCount: visible.length,
        candidateCount: 1,
        evidence: "recent-visible-id-overlap"
      };
      return inferredIdentity;
    }

    const candidates = this.getPinnedChatCandidates();
    const resolved = resolvePinnedChatConversationCandidate(visible, candidates);
    if (!resolved?.conversationId) {
      this.host.clearInferredChatConversationId?.();
      this.lastPinnedChatInference = {
        inferredConversationSet: false,
        result: "no-unique-candidate",
        directIdentityPresent: Boolean(directIdentity),
        directIdentityStable: Boolean(directIdentity?.stable),
        visibleTurnCount: visible.length,
        candidateCount: candidates.length,
        evidence: null
      };
      return directIdentity;
    }
    const inferredConversationSet = Boolean(this.host.setInferredChatConversationId(resolved.conversationId));
    const inferredIdentity = this.host.getConversationIdentity?.() ?? directIdentity;
    if (inferredIdentity?.stable && inferredIdentity.host === "chatgpt") {
      this.rememberStableChatIdentity(inferredIdentity, visible);
    }
    this.lastPinnedChatInference = {
      inferredConversationSet,
      result: inferredConversationSet ? "inferred-set" : "inferred-set-failed",
      directIdentityPresent: Boolean(directIdentity),
      directIdentityStable: Boolean(directIdentity?.stable),
      visibleTurnCount: visible.length,
      candidateCount: candidates.length,
      evidence: resolved.evidence ?? null
    };
    return inferredIdentity;
  }  refresh(reason = "manual") {
    if (this.destroyed) return this.status();
    const surface = this.host.getSurface();
    const conversationIdentity = this.refreshPinnedChatInference(surface);
    const conversationId = conversationIdentity?.id ?? this.host.getConversationId();
    this.recordChatScrollDiagnostic("refresh-start:" + reason);
    const refreshDiagnostics = {
      reason,
      branch: "unresolved",
      resolvedIdentity: conversationIdentity
        ? { present: true, host: conversationIdentity.host ?? null, source: conversationIdentity.source ?? null, stable: Boolean(conversationIdentity.stable) }
        : { present: false },
      chatVisibleTurnsCount: Number(this.lastPinnedChatInference?.visibleTurnCount ?? 0),
      routedVisibleTurnsCount: 0,
      preReconcileIndexCount: 0,
      trustedVisibleTurnsCount: 0,
      postRefreshIndexCount: 0
    };
    this.shell.setTheme(this.host.getTheme());
    this.shell.setSurface(surface);

    if (this.pendingConversationSelectionId) {
      const pendingId = String(this.pendingConversationSelectionId);
      const comparablePendingId = pendingId.startsWith("local:") ? pendingId : canonicalChatConversationId(pendingId);
      const rawConversationId = String(conversationId ?? "");
      const comparableConversationId = rawConversationId.startsWith("local:")
        ? rawConversationId
        : canonicalChatConversationId(rawConversationId);
      const matchedPending = comparableConversationId === comparablePendingId && conversationIdentity?.stable;
      const pendingAgeMs = this.pendingConversationSelectionStartedAt > 0
        ? Math.max(0, appNowMs(this.window) - this.pendingConversationSelectionStartedAt)
        : 0;
      const expiredPending = this.pendingConversationSelectionStartedAt > 0
        && pendingAgeMs >= CHAT_PENDING_SELECTION_TTL_MS;
      if (matchedPending || expiredPending) {
        this.pendingConversationSelectionId = null;
        this.pendingConversationSelectionStartedAt = 0;
        refreshDiagnostics.pendingResolution = matchedPending ? "matched" : "expired";
      } else if (surface === SURFACE.CONVERSATION) {
        refreshDiagnostics.branch = "conversation-transition";
        refreshDiagnostics.pendingAgeMs = pendingAgeMs;
        refreshDiagnostics.postRefreshIndexCount = Number(this.currentConversationId ? this.turnIndexes.get(this.currentConversationId)?.size?.() ?? 0 : 0);
        this.shell.updateTimeline([], null);
        this.shell.setQuestionHistoryState?.({ visible: false, loading: false, exhausted: false });
        this.bindScrollContainer(null);
        this.shell.refreshComposerAnchor();
        this.lastRefreshDiagnostics = refreshDiagnostics;
        this.recordChatScrollDiagnostic("refresh-end:" + reason);
        this.updateDebug(reason + "-conversation-transition");
        return this.status();
      }
    }

    if (surface === SURFACE.CONVERSATION && conversationId) {
      this.clearChatIdentitySettleRetry();
      refreshDiagnostics.branch = "resolved-conversation";
      this.activateConversation(conversationId);
      const index = this.getTurnIndex(conversationId);
      refreshDiagnostics.preReconcileIndexCount = Number(index.size?.() ?? 0);
      const visible = this.host.getVisibleTurns();
      if (conversationIdentity?.host === "chatgpt") {
        this.captureActiveChatBootstrapWindow(this.getChatBootstrapVisibleTurns());
      }
      refreshDiagnostics.routedVisibleTurnsCount = visible.length;
      const reconcileDiagnostics = {};
      const trustedVisible = conversationIdentity?.host === "chatgpt"
        ? reconcileChatVisibleTurns(index, visible, reconcileDiagnostics)
        : visible;
      if (conversationIdentity?.host === "chatgpt") refreshDiagnostics.chatReconcile = reconcileDiagnostics;
      refreshDiagnostics.trustedVisibleTurnsCount = trustedVisible.length;
      if (conversationIdentity?.host === "chatgpt") {
        refreshDiagnostics.chatBootstrapStarted = this.maybeStartChatTrueTopBootstrap({
          conversationId,
          index,
          identity: conversationIdentity,
          visibleRecords: visible,
          trustedVisible,
          reconcileDiagnostics
        });
      }
      index.setVisible(trustedVisible);
      if (conversationIdentity?.source === "sidebar-local" && conversationIdentity?.stable) index.reindexUuidV7?.();
      if (this.navigationUx.state === "pending" && this.navigationUx.target) {
        const pendingRecord = index.get(this.navigationUx.target);
        const pendingOrder = Number.isFinite(pendingRecord?.order) ? Number(pendingRecord.order) : null;
        if (pendingOrder !== this.navigationUx.targetOrder) {
          this.setNavigationUx({ targetOrder: pendingOrder }, "navigation-target-reindexed");
        }
      }
      this.persistTimelineCache(conversationId, index);
      const activeTurnId = index.resolveCanonicalId(this.host.getActiveTurnId());
      this.conversations.update(conversationId, { turnCount: index.size(), activeTurnId, route: this.host.getRoute?.() ?? "" });
      this.shell.updateTimeline(index.getOrdered(), activeTurnId);
      const localWork = Boolean(conversationIdentity?.stable && conversationIdentity.host === "local" && conversationIdentity.source === "sidebar-local");
      const chatConversation = Boolean(conversationIdentity?.stable && conversationIdentity.host === "chatgpt");
      const turnCount = Number(index.size?.() ?? 0);
      refreshDiagnostics.postRefreshIndexCount = turnCount;
      const exhausted = localWork
        ? this.workEarlierHydrationExhausted.get(conversationId) === turnCount
        : chatConversation && this.chatEarlierHydrationExhausted.get(conversationId) === turnCount;
      this.shell.setQuestionHistoryState?.({
        visible: localWork || chatConversation,
        loading: localWork ? Boolean(this.workEarlierHydrationPromise) : chatConversation && Boolean(this.chatEarlierHydrationPromise),
        exhausted
      });
      this.bindScrollContainer(this.host.getScrollContainer?.());
    } else if (surface === SURFACE.CONVERSATION && this.currentConversationId) {
      const ownedChatOperation = Boolean(
        (this.chatEarlierHydrationPromise || this.chatBootstrapHydrationPromise)
        && !this.pendingConversationSelectionId
        && !this.pendingPinnedChatSelection
      );
      const currentIndex = this.turnIndexes.get(this.currentConversationId) ?? null;
      refreshDiagnostics.postRefreshIndexCount = Number(currentIndex?.size?.() ?? 0);
      if (ownedChatOperation && currentIndex) {
        refreshDiagnostics.branch = "identity-transient-preserve-chat-operation";
        const activeTurnId = currentIndex.resolveCanonicalId?.(this.host.getActiveTurnId?.()) ?? null;
        this.shell.updateTimeline(currentIndex.getOrdered?.() ?? [], activeTurnId);
        this.shell.setQuestionHistoryState?.({ visible: true, loading: true, exhausted: false });
        this.bindScrollContainer(this.host.getScrollContainer?.());
        this.scheduleChatIdentitySettleRetry();
      } else {
        refreshDiagnostics.branch = "identity-transient-clear-ui";
        if (this.navigationUx.state === "pending") this.invalidateNavigation("conversation-identity-transient");
        this.shell.updateTimeline([], null);
        this.shell.setQuestionHistoryState?.({ visible: false, loading: false, exhausted: false });
        this.bindScrollContainer(this.host.getScrollContainer?.());
        this.scheduleChatIdentitySettleRetry();
      }
    } else {
      refreshDiagnostics.branch = surface === SURFACE.CONVERSATION ? "conversation-without-identity" : "non-conversation";
      if (surface !== SURFACE.MEDIA_VIEWER) this.deactivateConversationView();
      if (surface === SURFACE.CONVERSATION) {
        this.shell.updateTimeline([], null);
        this.scheduleChatIdentitySettleRetry();
      } else {
        this.clearChatIdentitySettleRetry();
      }
      this.shell.setQuestionHistoryState?.({ visible: false, loading: false, exhausted: false });
      this.bindScrollContainer(null);
    }

    this.shell.refreshComposerAnchor();
    this.lastRefreshDiagnostics = refreshDiagnostics;
    this.recordChatScrollDiagnostic("refresh-end:" + reason);
    this.updateDebug(reason);
    return this.status();
  }  activateConversation(conversationId) {
    if (this.currentConversationId === conversationId) return;
    if (this.currentConversationId) {
      this.saveConversationView(this.currentConversationId);
      this.invalidateNavigation("conversation-changed");
    }
    this.currentConversationId = conversationId;
    const conversation = this.conversations.activateConversation(conversationId, this.host.getRoute?.() ?? "");
    if (conversation?.captureStatus?.status === "unavailable" && this.captureStatus?.status !== "unavailable") {
      this.conversations.setCaptureStatus(conversationId, this.captureStatus);
    }
    const state = this.timelineState.get(conversationId);
    queueMicrotask(() => this.shell.questionList?.restoreViewState?.(state));
  }

  deactivateConversationView() {
    if (this.currentConversationId) {
      this.saveConversationView(this.currentConversationId);
      this.invalidateNavigation("conversation-deactivated");
    }
    this.currentConversationId = null;
  }

  saveConversationView(conversationId) {
    if (!conversationId) return;
    const view = this.shell.questionList?.getViewState?.();
    if (view) this.timelineState.update(conversationId, view);
  }

  getTimelineCache(conversationId) {
    return String(conversationId ?? "").startsWith("local:") ? this.workTimelineCache : this.chatTimelineCache;
  }

  getTurnIndex(conversationId) {
    if (!this.turnIndexes.has(conversationId)) {
      const index = new TurnIndex();
      const cache = this.getTimelineCache(conversationId);
      const loaded = typeof cache?.loadWithHealth === "function"
        ? cache.loadWithHealth(conversationId)
        : { turns: cache?.load?.(conversationId) ?? [], status: "legacy", health: null };
      const cached = Array.isArray(loaded?.turns) ? loaded.turns : [];
      if (cached.length) index.mergeMany(cached.map((turn) => ({ ...turn, source: "dom", visible: false })));
      this.cacheHydrationCounts.set(conversationId, cached.length);
      this.cacheHydrationDiagnostics.set(conversationId, {
        status: loaded?.status ?? "unknown",
        sourceTurnCount: Number(loaded?.sourceTurnCount ?? cached.length),
        loadedTurnCount: Number(loaded?.loadedTurnCount ?? cached.length),
        health: loaded?.health ? JSON.parse(JSON.stringify(loaded.health)) : null
      });
      this.turnIndexes.set(conversationId, index);
    }
    return this.turnIndexes.get(conversationId);
  }

  persistTimelineCache(conversationId, index = this.turnIndexes.get(conversationId)) {
    if (!conversationId || !index) return false;
    return this.getTimelineCache(conversationId).save(conversationId, index.getOrdered());
  }

  getScrollOwnershipState() {
    const owners = [];
    if (this.activeNavigation?.status === "running" || this.navigationUx.state === "pending") {
      owners.push("navigation");
    }
    if (this.chatBootstrapHydrationPromise) {
      owners.push(this.lastChatBootstrapDiagnostics?.repairReason ? "chat-repair" : "chat-bootstrap");
    }
    if (this.chatEarlierHydrationPromise) owners.push("chat-earlier");
    if (this.workEarlierHydrationPromise) owners.push("work-earlier");
    return {
      owner: owners.length === 0 ? "idle" : owners.length === 1 ? owners[0] : "conflict",
      owners,
      conflict: owners.length > 1
    };
  }

  getDiagnosticConversationOrdinal(conversationId) {
    const id = String(conversationId ?? "").trim();
    if (!id) return null;
    if (!this.diagnosticConversationOrdinals.has(id)) {
      this.diagnosticConversationOrdinals.set(id, this.nextDiagnosticConversationOrdinal++);
    }
    return this.diagnosticConversationOrdinals.get(id);
  }

  recordCaptureDiagnostic({ conversationId, turns = [], payload = null, beforeTurns = [], afterTurns = [] } = {}) {
    const incoming = Array.isArray(turns) ? turns : [];
    const before = Array.isArray(beforeTurns) ? beforeTurns : [];
    const after = Array.isArray(afterTurns) ? afterTurns : [];
    const beforeCaptureIds = new Set(before.filter((turn) => String(turn?.source ?? "").includes("capture")).map((turn) => String(turn.id)));
    const incomingIds = new Set(incoming.map((turn) => String(turn?.id ?? "")).filter(Boolean));
    const incomingOrders = incoming.map((turn) => Number(turn?.order)).filter(Number.isFinite).sort((a, b) => a - b);
    const previousCaptureCount = beforeCaptureIds.size;
    const retainedCaptureCount = [...beforeCaptureIds].filter((id) => incomingIds.has(id)).length;
    const removedCaptureCount = previousCaptureCount - retainedCaptureCount;
    const addedCaptureCount = [...incomingIds].filter((id) => !beforeCaptureIds.has(id)).length;
    const mappingCount = payload?.mapping && typeof payload.mapping === "object" ? Object.keys(payload.mapping).length : 0;
    this.captureDiagnostics.push({
      sequence: this.captureDiagnostics.length ? Number(this.captureDiagnostics.at(-1)?.sequence ?? 0) + 1 : 1,
      conversationOrdinal: this.getDiagnosticConversationOrdinal(conversationId),
      relationToCurrent: !this.currentConversationId ? "no-current" : String(this.currentConversationId) === String(conversationId) ? "matches-current" : "background",
      incomingTurnCount: incoming.length,
      incomingOrderMin: incomingOrders.length ? incomingOrders[0] : null,
      incomingOrderMax: incomingOrders.length ? incomingOrders.at(-1) : null,
      incomingStartsAtZero: incomingOrders.length ? incomingOrders[0] === 0 : false,
      incomingIdModes: diagnosticIdModeCounts(incoming),
      mappingCount,
      currentNodePresent: Boolean(payload?.current_node),
      previousIndexCount: before.length,
      previousCaptureCount,
      retainedCaptureCount,
      removedCaptureCount,
      addedCaptureCount,
      afterIndexCount: after.length
    });
    this.captureDiagnostics = this.captureDiagnostics.slice(-CAPTURE_DIAGNOSTIC_LIMIT);
  }

  recordChatScrollDiagnostic(reason = "manual", { force = false } = {}) {
    const surface = this.host?.getSurface?.();
    if (surface !== SURFACE.CONVERSATION) return false;
    if (this.host?.getHostMode?.() === "work") return false;
    const identity = this.host?.getConversationIdentity?.() ?? null;
    const currentId = this.currentConversationId ?? identity?.id ?? null;
    if (identity?.host === "local" || String(currentId ?? "").startsWith("local:")) return false;
    const container = this.host?.getScrollContainer?.() ?? null;
    if (!container) return false;
    const visible = this.host?.getChatVisibleTurns?.() ?? [];
    const index = currentId ? this.turnIndexes.get(currentId) ?? null : null;
    const activeId = this.host?.getActiveTurnId?.() ?? null;
    const activeRecord = index?.get?.(activeId) ?? null;
    const visibleOrders = visible
      .map((turn) => {
        const known = index?.get?.(turn?.id);
        if (Number.isFinite(known?.order)) return Number(known.order);
        if (turn?.orderTrust !== "window" && Number.isFinite(turn?.order)) return Number(turn.order);
        return null;
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const flexDirection = this.window?.getComputedStyle?.(container)?.flexDirection
      ?? container?.style?.flexDirection
      ?? null;
    const entry = {
      sequence: this.chatScrollDiagnostics.length ? Number(this.chatScrollDiagnostics.at(-1)?.sequence ?? 0) + 1 : 1,
      reason,
      conversationOrdinal: this.getDiagnosticConversationOrdinal(currentId),
      identity: identity
        ? { present: true, host: identity.host ?? null, source: identity.source ?? null, stable: Boolean(identity.stable) }
        : { present: false },
      activeOrder: Number.isFinite(activeRecord?.order) ? Number(activeRecord.order) : null,
      visibleOrderMin: visibleOrders.length ? visibleOrders[0] : null,
      visibleOrderMax: visibleOrders.length ? visibleOrders.at(-1) : null,
      visibleTurnCount: visible.length,
      scrollTop: diagnosticRound(container.scrollTop),
      scrollHeight: diagnosticRound(container.scrollHeight),
      clientHeight: diagnosticRound(container.clientHeight),
      flexDirection
    };
    const signature = JSON.stringify({
      conversationOrdinal: entry.conversationOrdinal,
      identity: entry.identity,
      activeOrder: entry.activeOrder,
      visibleOrderMin: entry.visibleOrderMin,
      visibleOrderMax: entry.visibleOrderMax,
      visibleTurnCount: entry.visibleTurnCount,
      scrollTop: entry.scrollTop,
      scrollHeight: entry.scrollHeight,
      clientHeight: entry.clientHeight,
      flexDirection: entry.flexDirection
    });
    if (!force && signature === this.lastChatScrollDiagnosticSignature) return false;
    this.lastChatScrollDiagnosticSignature = signature;
    this.chatScrollDiagnostics.push(entry);
    this.chatScrollDiagnostics = this.chatScrollDiagnostics.slice(-CHAT_SCROLL_DIAGNOSTIC_LIMIT);
    return true;
  }

  handleCapture({ conversationId, turns, payload } = {}) {
    if (!conversationId) return;
    const index = this.getTurnIndex(conversationId);
    const beforeTurns = index.getOrdered();
    index.replaceCapture(turns ?? []);
    const afterTurns = index.getOrdered();
    this.recordCaptureDiagnostic({ conversationId, turns: turns ?? [], payload, beforeTurns, afterTurns });
    this.persistTimelineCache(conversationId, index);
    this.conversations.setCaptureStatus(conversationId, { status: "active", turnCount: index.size(), lastError: "" });
    if (this.currentConversationId === conversationId) {
      this.scheduleRefresh("capture");
    } else if (!this.currentConversationId
      && this.host.getSurface?.() === SURFACE.CONVERSATION
      && !(this.host.getDirectConversationIdentity?.()?.stable)) {
      this.scheduleRefresh("capture-candidate");
    }
  }

  handleCaptureStatus(status = {}) {
    this.captureStatus = { ...this.captureStatus, ...status };
    if (this.currentConversationId) this.conversations.setCaptureStatus(this.currentConversationId, this.captureStatus);
    this.updateDebug("capture-status");
  }

  maybeStartWorkEarlierHydration({ conversationId, index, identity, explicit = false, stopAfterBatch = false } = {}) {
    if (!explicit) return false;
    const localWork = Boolean(identity?.stable && identity.host === "local" && identity.source === "sidebar-local");
    const panelOpen = Boolean(this.shell?.getStatus?.().questionPanelOpen);
    if (!localWork || !conversationId || !index || !panelOpen) {
      if (conversationId && !panelOpen) this.workEarlierHydrationExhausted.delete(conversationId);
      return false;
    }
    if (this.activeNavigation?.status === "running" || this.navigationUx.state === "pending") return false;
    const turnCount = Number(index.size?.() ?? 0);
    if (this.workEarlierHydrationExhausted.get(conversationId) === turnCount) return false;
    if (this.workEarlierHydrationPromise) return true;
    this.shell.setQuestionHistoryState?.({ visible: true, loading: true, exhausted: false });

    const generation = ++this.workEarlierHydrationGeneration;
    const isCurrent = () => {
      const currentIdentity = this.host.getConversationIdentity?.() ?? null;
      return !this.destroyed
        && generation === this.workEarlierHydrationGeneration
        && conversationId === this.currentConversationId
        && conversationId === this.host.getConversationId?.()
        && currentIdentity?.stable
        && currentIdentity.host === "local"
        && currentIdentity.source === "sidebar-local"
        && Boolean(this.shell?.getStatus?.().questionPanelOpen)
        && this.activeNavigation?.status !== "running"
        && this.navigationUx.state !== "pending";
    };
    const task = Promise.resolve(this.host.hydrateWorkEarlierHistory?.({
      isCurrent,
      stopAfterBatch,
      onProgress: () => this.scheduleRefresh("work-earlier-history-progress")
    }))
      .then((result) => {
        const currentIndex = this.turnIndexes.get(conversationId);
        const currentCount = Number(currentIndex?.size?.() ?? turnCount);
        if (result?.reason === "earlier-boundary-exhausted") this.workEarlierHydrationExhausted.set(conversationId, currentCount);
        else this.workEarlierHydrationExhausted.delete(conversationId);
        if (isCurrent()) this.scheduleRefresh("work-earlier-history-done");
        return result;
      })
      .finally(() => {
        if (this.workEarlierHydrationPromise === task) this.workEarlierHydrationPromise = null;
        this.scheduleRefresh("work-earlier-history-finalize");
      });
    this.workEarlierHydrationPromise = task;
    return true;
  }

  getChatBootstrapVisibleTurns() {
    if (typeof this.host?.getChatVisibleTurns === "function") {
      return this.host.getChatVisibleTurns() ?? [];
    }
    return this.host?.getVisibleTurns?.() ?? [];
  }

  captureActiveChatBootstrapWindow(records = null) {
    const collector = this.chatBootstrapCollector;
    if (!collector || collector.conversationId !== this.currentConversationId) return false;
    try {
      return Boolean(collector.capture?.(records));
    } catch {
      return false;
    }
  }

  startChatBootstrapSampleLoop(conversationId, generation, intervalMs = 24) {
    this.stopChatBootstrapSampleLoop();
    const tick = () => {
      if (this.destroyed
        || generation !== this.chatBootstrapHydrationGeneration
        || this.chatBootstrapCollector?.conversationId !== conversationId
        || this.currentConversationId !== conversationId) {
        this.chatBootstrapSampleTimer = null;
        return;
      }
      this.captureActiveChatBootstrapWindow(this.getChatBootstrapVisibleTurns());
      this.chatBootstrapSampleTimer = this.window?.setTimeout?.(tick, intervalMs) ?? setTimeout(tick, intervalMs);
    };
    this.chatBootstrapSampleTimer = this.window?.setTimeout?.(tick, intervalMs) ?? setTimeout(tick, intervalMs);
  }

  stopChatBootstrapSampleLoop() {
    if (this.chatBootstrapSampleTimer == null) return;
    if (typeof this.window?.clearTimeout === "function") this.window.clearTimeout(this.chatBootstrapSampleTimer);
    else clearTimeout(this.chatBootstrapSampleTimer);
    this.chatBootstrapSampleTimer = null;
  }

  maybeStartChatTrueTopBootstrap({
    conversationId,
    index,
    identity,
    visibleRecords = [],
    trustedVisible = [],
    reconcileDiagnostics = null
  } = {}) {
    const chatConversation = Boolean(identity?.stable && identity.host === "chatgpt");
    if (!chatConversation || !conversationId || !index) return false;
    const explicitChatVisible = this.getChatBootstrapVisibleTurns();
    const visible = explicitChatVisible.length
      ? explicitChatVisible
      : (Array.isArray(visibleRecords) ? visibleRecords : []);
    const existingTurns = index.getOrdered?.() ?? [];
    const visibleIds = new Set(visible.map((record) => String(record?.id ?? "")).filter(Boolean));
    const existingVisibleOverlap = existingTurns.some((turn) => visibleIds.has(String(turn?.id ?? "")));
    const syntheticChat = (String(conversationId).startsWith("pinned-chat:")
      || String(conversationId).startsWith("project-chat:"))
      && identity?.source === "inferred-visible-chat";
    const pureDomExisting = existingTurns.length > 0
      && existingTurns.every((turn) => turn?.source === "dom");
    const preRepairOrderHealth = analyzeChatIndexOrderHealth(existingTurns);
    const conflictCount = (Array.isArray(reconcileDiagnostics?.turns) ? reconcileDiagnostics.turns : [])
      .filter((entry) => entry?.reason === "occupied-order" || entry?.reason === "staged-order-collision")
      .length;
    const repairCorruptDomChatIndex = pureDomExisting && preRepairOrderHealth.corrupt;
    const repairConflictedDomChatIndex = pureDomExisting && conflictCount > 0;
    const repairIncompletePinnedCache = syntheticChat
      && pureDomExisting
      && (Array.isArray(trustedVisible) ? trustedVisible.length : 0) === 0
      && !existingVisibleOverlap;
    const repairExistingChatIndex = repairIncompletePinnedCache
      || repairCorruptDomChatIndex
      || repairConflictedDomChatIndex;
    const autoRepairBlocked = repairExistingChatIndex && this.chatAutoRepairBlocked.has(conversationId);
    const repairReason = repairCorruptDomChatIndex
      ? "corrupt-dom-orders"
      : repairConflictedDomChatIndex
        ? "conflicted-dom-orders"
        : repairIncompletePinnedCache
          ? "incomplete-synthetic-cache"
          : null;
    if (autoRepairBlocked) {
      this.lastChatBootstrapDiagnostics = {
        conversationOrdinal: this.getDiagnosticConversationOrdinal(conversationId),
        result: "repair-blocked",
        repairReason,
        repairRejected: true,
        repairRejectReason: "previous-shrinking-candidate",
        preRepairOrderHealth,
        bootstrapped: false
      };
      return false;
    }
    if (repairCorruptDomChatIndex || repairConflictedDomChatIndex) {
      this.chatBootstrapAttempted.delete(conversationId);
      this.chatEarlierHydrationExhausted.delete(conversationId);
    }
    if (existingTurns.length !== 0 && !repairExistingChatIndex) return false;
    if (!visible.length) return false;
    if (!repairExistingChatIndex && existingTurns.length === 0 && visible.length === 1) {
      this.lastChatBootstrapDiagnostics = {
        conversationOrdinal: this.getDiagnosticConversationOrdinal(conversationId),
        result: "single-turn-auto-bootstrap-suppressed",
        visibleTurnCount: 1,
        preRepairOrderHealth,
        bootstrapped: false
      };
      return false;
    }
    const container = this.host.getScrollContainer?.() ?? null;
    if (!container || container.isConnected === false) return false;
    const initialUuidWindow = analyzeChatBootstrapWindowForContainer(
      visible,
      container,
      this.window,
      { allowPartial: false }
    );
    const initialAbsoluteWindow = analyzeAbsoluteChatBootstrapWindow(visible);
    const bootstrapMode = initialUuidWindow.turns.length && isLogicalChatBootstrapBasis(initialUuidWindow.basis)
      ? "uuid"
      : initialAbsoluteWindow.turns.length
        ? "absolute"
        : null;
    if (!bootstrapMode) return false;
    if (bootstrapMode === "uuid"
      && Array.isArray(trustedVisible)
      && trustedVisible.length
      && !repairExistingChatIndex) return false;
    if (this.activeNavigation?.status === "running" || this.navigationUx.state === "pending") return false;
    if (this.chatBootstrapHydrationPromise) return true;
    if (this.chatEarlierHydrationPromise) return false;
    if (this.chatBootstrapAttempted.has(conversationId)) return false;
    const failureCount = Number(this.chatBootstrapFailures.get(conversationId) ?? 0);
    if (failureCount >= CHAT_BOOTSTRAP_MAX_FAILURES) return false;
    const originalScrollTop = Number(container.scrollTop);
    let visualFreeze = beginChatBootstrapVisualFreeze({
      document: this.document,
      window: this.window,
      container
    });
    const visualFreezeApplied = Boolean(visualFreeze);
    const windows = [];
    const sweepWindows = [];
    const collectorStats = {
      attempts: 0,
      rejected: 0,
      duplicates: 0,
      partial: 0,
      fallbackOrder: 0
    };
    const captureWindow = (records = null) => {
      collectorStats.attempts += 1;
      const current = Array.isArray(records) ? records : this.getChatBootstrapVisibleTurns();
      const analyzed = bootstrapMode === "absolute"
        ? analyzeAbsoluteChatBootstrapWindow(current)
        : analyzeChatBootstrapWindow(current, { allowPartial: true });
      if (!analyzed.turns.length) {
        collectorStats.rejected += 1;
        return false;
      }
      const signature = analyzed.turns.map((turn) => turn.id).join("|") + ":" + analyzed.basis;
      const previous = windows.at(-1);
      if (previous?.signature === signature) {
        collectorStats.duplicates += 1;
        return false;
      }
      if (windows.length >= 256) {
        collectorStats.rejected += 1;
        return false;
      }
      if (analyzed.partial) collectorStats.partial += 1;
      if (analyzed.basis !== "visual") collectorStats.fallbackOrder += 1;
      windows.push({ signature, ...analyzed });
      return true;
    };
    const captureSweepWindow = (records = null) => {
      const current = Array.isArray(records) ? records : this.getChatBootstrapVisibleTurns();
      const analyzed = bootstrapMode === "absolute"
        ? analyzeAbsoluteChatBootstrapWindow(current)
        : analyzeChatBootstrapWindowForContainer(current, container, this.window, { allowPartial: true });
      if (!analyzed.turns.length || (bootstrapMode === "uuid" && !isLogicalChatBootstrapBasis(analyzed.basis))) return false;
      const signature = analyzed.turns.map((turn) => turn.id).join("|");
      const previous = sweepWindows.at(-1);
      if (previous?.signature === signature) return false;
      sweepWindows.push({ signature, ...analyzed });
      return true;
    };
    this.chatBootstrapCollector = { conversationId, capture: captureWindow };
    captureWindow();
    if (bootstrapMode === "uuid" && windows.length) {
      const initialSignature = initialUuidWindow.turns.map((turn) => turn.id).join("|") + ":" + initialUuidWindow.basis;
      windows[0] = { signature: initialSignature, ...initialUuidWindow };
    }
    this.shell?.showToast?.("正在加载时间线…");
    const generation = ++this.chatBootstrapHydrationGeneration;
    this.startChatBootstrapSampleLoop(conversationId, generation, 24);
    const isCurrent = () => {
      const currentIdentity = this.host.getConversationIdentity?.() ?? null;
      if (this.destroyed
        || generation !== this.chatBootstrapHydrationGeneration
        || conversationId !== this.currentConversationId
        || this.pendingConversationSelectionId
        || this.pendingPinnedChatSelection
        || this.host.getSurface?.() !== SURFACE.CONVERSATION
        || this.activeNavigation?.status === "running"
        || this.navigationUx.state === "pending") return false;
      if (!currentIdentity?.stable) return true;
      if (currentIdentity.host !== "chatgpt") return false;
      return canonicalChatConversationId(currentIdentity.id) === canonicalChatConversationId(conversationId);
    };

    const task = Promise.resolve(this.host.hydrateChatEarlierHistory?.({
      isCurrent,
      maxBoundaryStalls: 2,
      onProgress: () => {
        captureWindow();
        this.scheduleRefresh("chat-bootstrap-progress");
      }
    }))
      .then(async (result) => {
        captureWindow();
        let sweepResult = null;
        let sweepSequence = { turns: [], windowCount: 0, skippedWindows: 0, missingText: 0, complete: false };
        if (result?.reason === "earlier-boundary-exhausted" && isCurrent() && typeof this.host.sweepLoadedChatHistory === "function") {
          this.stopChatBootstrapSampleLoop();
          sweepResult = await this.host.sweepLoadedChatHistory({
            isCurrent,
            maxSteps: 256,
            stepRatio: 0.75,
            settleWaitMs: 8,
            onWindow: ({ turns } = {}) => {
              captureSweepWindow(turns);
            }
          });
          captureSweepWindow();
          if (sweepResult?.reason === "sweep-complete") {
            sweepSequence = bootstrapMode === "absolute"
              ? buildAbsoluteChatBootstrapSweepSequence(sweepWindows)
              : buildChatBootstrapSweepSequence(sweepWindows);
          }
        }
        const stitchedFallback = result?.reason === "earlier-boundary-exhausted" && bootstrapMode === "uuid"
          ? stitchChatBootstrapWindows(windows)
          : { turns: [], connectedWindows: 0, totalWindows: windows.length, complete: false, skippedWindows: 0 };
        const stitched = sweepResult?.reason === "sweep-complete" && sweepSequence.complete
          ? {
              turns: sweepSequence.turns,
              connectedWindows: sweepSequence.windowCount,
              totalWindows: sweepSequence.windowCount,
              complete: true,
              skippedWindows: sweepSequence.skippedWindows
            }
          : stitchedFallback;
        const collectionMode = sweepResult?.reason === "sweep-complete" && sweepSequence.complete
          ? "loaded-sweep"
          : "event-stitch";
        const initialRequiredIds = bootstrapMode === "uuid"
          ? initialUuidWindow.turns.map((turn) => String(turn.id))
          : [];
        const coversInitialWindow = bootstrapMode !== "uuid"
          || bootstrapSequenceCoversIds(stitched.turns, initialRequiredIds);
        let bootstrapped = false;
        let repairRejected = false;
        let repairRejectReason = null;
        let repairExistingCount = existingTurns.length;
        let repairCandidateCount = 0;
        if (result?.reason === "earlier-boundary-exhausted"
          && stitched.complete
          && stitched.turns.length
          && coversInitialWindow
          && isCurrent()) {
          const currentIndex = this.turnIndexes.get(conversationId) ?? index;
          const snapshot = stitched.turns.map((turn, order) => ({
            id: turn.id,
            order,
            text: turn.text,
            shortText: turn.shortText,
            type: turn.type,
            source: "dom",
            visible: false
          }));
          const currentExisting = currentIndex.getOrdered?.() ?? [];
          repairExistingCount = currentExisting.length;
          repairCandidateCount = snapshot.length;

          let applied = false;
          if (repairExistingChatIndex) {
            if (snapshot.length < currentExisting.length) {
              repairRejected = true;
              repairRejectReason = "candidate-shrinks-existing";
              this.chatAutoRepairBlocked.add(conversationId);
            } else {
              applied = currentIndex.replaceDomSnapshot?.(snapshot) === true;
              if (!applied) {
                repairRejected = true;
                repairRejectReason = "replacement-rejected";
              }
            }
          } else {
            currentIndex.mergeMany(snapshot);
            applied = true;
          }

          if (applied) {
            this.persistTimelineCache(conversationId, currentIndex);
            this.chatEarlierHydrationExhausted.set(conversationId, Number(currentIndex.size?.() ?? stitched.turns.length));
            this.chatBootstrapAttempted.add(conversationId);
            this.chatBootstrapFailures.delete(conversationId);
            this.chatAutoRepairBlocked.delete(conversationId);
            bootstrapped = true;
          } else if (isCurrent()) {
            this.chatBootstrapFailures.set(
              conversationId,
              repairRejectReason === "candidate-shrinks-existing"
                ? CHAT_BOOTSTRAP_MAX_FAILURES
                : Math.min(CHAT_BOOTSTRAP_MAX_FAILURES, failureCount + 1)
            );
          }
        } else if (isCurrent()) {
          this.chatBootstrapFailures.set(
            conversationId,
            Math.min(CHAT_BOOTSTRAP_MAX_FAILURES, failureCount + 1)
          );
        }
        this.lastChatBootstrapDiagnostics = {
          conversationOrdinal: this.getDiagnosticConversationOrdinal(conversationId),
          result: result?.reason ?? null,
          windowCount: windows.length,
          connectedWindows: stitched.connectedWindows,
          stitchedTurnCount: stitched.turns.length,
          skippedWindows: Number(stitched.skippedWindows ?? 0),
          completeChain: Boolean(stitched.complete),
          collectorAttempts: collectorStats.attempts,
          collectorRejected: collectorStats.rejected,
          collectorDuplicates: collectorStats.duplicates,
          partialWindows: collectorStats.partial,
          fallbackOrderWindows: collectorStats.fallbackOrder,
          repairedIncompleteCache: Boolean(bootstrapped && repairIncompletePinnedCache),
          repairedCorruptDomIndex: Boolean(bootstrapped && repairCorruptDomChatIndex),
          repairedConflictedDomIndex: Boolean(bootstrapped && repairConflictedDomChatIndex),
          repairReason,
          repairConflictCount: conflictCount,
          repairRejected,
          repairRejectReason,
          repairExistingCount,
          repairCandidateCount,
          preRepairOrderHealth,
          bootstrapMode,
          collectionMode,
          sweepResult: sweepResult?.reason ?? null,
          sweepWindowCount: sweepWindows.length,
          sweepTurnCount: sweepSequence.turns.length,
          sweepMissingText: Number(sweepSequence.missingText ?? 0),
          coversInitialWindow,
          bootstrapFailureCount: Number(this.chatBootstrapFailures.get(conversationId) ?? 0),
          visualFreezeApplied,
          bootstrapped
        };
        if (container === this.host.getScrollContainer?.() && container.isConnected !== false && Number.isFinite(originalScrollTop)) {
          try { container.scrollTop = originalScrollTop; } catch {}
          if (visualFreeze) {
            await waitChatBootstrapFrame(this.window);
            await waitChatBootstrapFrame(this.window);
          }
        }
        if (visualFreeze) {
          endChatBootstrapVisualFreeze(visualFreeze);
          visualFreeze = null;
        }
        if (isCurrent()) this.scheduleRefresh("chat-bootstrap-done");
        return result;
      })
      .finally(() => {
        if (visualFreeze) {
          if (container === this.host.getScrollContainer?.() && container.isConnected !== false && Number.isFinite(originalScrollTop)) {
            try { container.scrollTop = originalScrollTop; } catch {}
          }
          endChatBootstrapVisualFreeze(visualFreeze);
          visualFreeze = null;
        }
        if (this.chatBootstrapHydrationPromise === task) this.chatBootstrapHydrationPromise = null;
        if (this.chatBootstrapCollector?.conversationId === conversationId) this.chatBootstrapCollector = null;
        this.stopChatBootstrapSampleLoop();
        const failures = Number(this.chatBootstrapFailures.get(conversationId) ?? 0);
        if (!this.chatBootstrapAttempted.has(conversationId)
          && failures > 0
          && failures < CHAT_BOOTSTRAP_MAX_FAILURES
          && this.currentConversationId === conversationId) {
          if (this.chatBootstrapRetryTimer != null) {
            (this.window?.clearTimeout ?? clearTimeout)(this.chatBootstrapRetryTimer);
          }
          const delayMs = CHAT_BOOTSTRAP_RETRY_DELAYS_MS[Math.min(
            failures - 1,
            CHAT_BOOTSTRAP_RETRY_DELAYS_MS.length - 1
          )];
          this.chatBootstrapRetryTimer = (this.window?.setTimeout ?? setTimeout)(() => {
            this.chatBootstrapRetryTimer = null;
            if (!this.destroyed && this.currentConversationId === conversationId) {
              this.scheduleRefresh("chat-bootstrap-retry");
            }
          }, delayMs);
        }
        this.scheduleRefresh("chat-bootstrap-finalize");
      });
    this.chatBootstrapHydrationPromise = task;
    this.lastChatBootstrapDiagnostics = {
      conversationOrdinal: this.getDiagnosticConversationOrdinal(conversationId),
      result: "running",
      windowCount: windows.length,
      connectedWindows: 0,
      stitchedTurnCount: 0,
      skippedWindows: 0,
      completeChain: false,
      collectorAttempts: collectorStats.attempts,
      collectorRejected: collectorStats.rejected,
      collectorDuplicates: collectorStats.duplicates,
      partialWindows: collectorStats.partial,
      fallbackOrderWindows: collectorStats.fallbackOrder,
      repairedIncompleteCache: false,
      repairedCorruptDomIndex: false,
      repairedConflictedDomIndex: false,
      repairReason,
      repairConflictCount: conflictCount,
      repairRejected: false,
      repairRejectReason: null,
      repairExistingCount: existingTurns.length,
      repairCandidateCount: 0,
      preRepairOrderHealth,
      bootstrapMode,
      collectionMode: "running",
      sweepResult: null,
      sweepWindowCount: 0,
      sweepTurnCount: 0,
      sweepMissingText: 0,
      coversInitialWindow: false,
      bootstrapFailureCount: failureCount,
      visualFreezeApplied,
      bootstrapped: false
    };
    return true;
  }

  maybeStartChatEarlierHydration({ conversationId, index, identity, explicit = false } = {}) {
    if (!explicit) return false;
    const chatConversation = Boolean(identity?.stable && identity.host === "chatgpt");
    const panelOpen = Boolean(this.shell?.getStatus?.().questionPanelOpen);
    if (!chatConversation || !conversationId || !index || !panelOpen) {
      if (conversationId && !panelOpen) this.chatEarlierHydrationExhausted.delete(conversationId);
      return false;
    }
    if (this.activeNavigation?.status === "running" || this.navigationUx.state === "pending") return false;
    if (this.chatBootstrapHydrationPromise) return false;
    const turnCount = Number(index.size?.() ?? 0);
    if (this.chatEarlierHydrationExhausted.get(conversationId) === turnCount) return false;
    if (this.chatEarlierHydrationPromise) return true;
    this.shell.setQuestionHistoryState?.({ visible: true, loading: true, exhausted: false });

    const generation = ++this.chatEarlierHydrationGeneration;
    const isCurrent = () => {
      const currentIdentity = this.host.getConversationIdentity?.() ?? null;
      if (this.destroyed
        || generation !== this.chatEarlierHydrationGeneration
        || conversationId !== this.currentConversationId
        || this.pendingConversationSelectionId
        || this.pendingPinnedChatSelection
        || this.host.getSurface?.() !== SURFACE.CONVERSATION
        || !Boolean(this.shell?.getStatus?.().questionPanelOpen)
        || this.activeNavigation?.status === "running"
        || this.navigationUx.state !== "idle") return false;
      if (!currentIdentity?.stable) return true;
      if (currentIdentity.host !== "chatgpt") return false;
      return canonicalChatConversationId(currentIdentity.id) === canonicalChatConversationId(conversationId);
    };
    const task = Promise.resolve(this.host.hydrateChatEarlierHistory?.({
      isCurrent,
      onProgress: () => this.scheduleRefresh("chat-earlier-history-progress")
    }))
      .then((result) => {
        const currentIndex = this.turnIndexes.get(conversationId);
        const currentCount = Number(currentIndex?.size?.() ?? turnCount);
        if (result?.reason === "earlier-boundary-exhausted") this.chatEarlierHydrationExhausted.set(conversationId, currentCount);
        else this.chatEarlierHydrationExhausted.delete(conversationId);
        if (isCurrent()) this.scheduleRefresh("chat-earlier-history-done");
        return result;
      })
      .finally(() => {
        if (this.chatEarlierHydrationPromise === task) this.chatEarlierHydrationPromise = null;
        this.scheduleRefresh("chat-earlier-history-finalize");
      });
    this.chatEarlierHydrationPromise = task;
    return true;
  }

  loadAllEarlierHistory() {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    const identity = this.host.getConversationIdentity?.() ?? null;
    if (identity?.host === "local") {
      return this.maybeStartWorkEarlierHydration({ conversationId, index, identity, explicit: true, stopAfterBatch: false });
    }
    if (identity?.host === "chatgpt") {
      return this.maybeStartChatEarlierHydration({ conversationId, index, identity, explicit: true });
    }
    return false;
  }

  loadEarlierWorkBatch() {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    const identity = this.host.getConversationIdentity?.() ?? null;
    return this.maybeStartWorkEarlierHydration({ conversationId, index, identity, explicit: true, stopAfterBatch: true });
  }

  cancelWorkEarlierHydration() {
    this.workEarlierHydrationGeneration += 1;
  }

  cancelChatEarlierHydration() {
    this.chatEarlierHydrationGeneration += 1;
  }

  cancelChatBootstrapHydration() {
    this.chatBootstrapHydrationGeneration += 1;
    this.chatBootstrapCollector = null;
    this.stopChatBootstrapSampleLoop();
    if (this.chatBootstrapRetryTimer != null) {
      (this.window?.clearTimeout ?? clearTimeout)(this.chatBootstrapRetryTimer);
      this.chatBootstrapRetryTimer = null;
    }
  }

  bindScrollContainer(container) {
    if (this.scrollContainer === container) return;
    this.scrollContainer?.removeEventListener?.("scroll", this.boundScroll);
    this.scrollContainer = container ?? null;
    this.scrollContainer?.addEventListener?.("scroll", this.boundScroll, { passive: true });
  }

  clearNavigationUxTimer() {
    if (this.navigationUxTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.navigationUxTimer);
    this.navigationUxTimer = null;
  }

  invalidateNavigation(reason = "navigation-invalidated") {
    this.navigationRequestId += 1;
    this.host?.cancelNavigation?.();
    this.clearNavigationUxTimer();
    if (this.navigationUx.state !== "idle" || this.navigationUx.target != null || this.navigationUx.pendingVisible) {
      this.setNavigationUx({ state: "idle", target: null, targetOrder: null, pendingVisible: false }, reason);
    }
  }

  setNavigationUx(next = {}, reason = "navigation-ux") {
    this.navigationUx = { ...this.navigationUx, ...next };
    this.shell?.setNavigationState?.(this.navigationUx);
    this.updateDebug(reason);
  }

  beginNavigationRun({ targetOrder, identity }) {
    const startedAtMs = Date.now();
    const run = {
      runId: ++this.navigationRunSequence,
      targetOrder,
      targetLabel: Number.isFinite(targetOrder) ? `Q${Number(targetOrder) + 1}` : null,
      host: identity?.host ?? null,
      source: identity?.source ?? null,
      status: "running",
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      currentStep: null,
      steps: []
    };
    this.activeNavigation = run;
    this.publishNavigationDiagnostics();
    return run;
  }

  recordNavigationStep(run, entry, steps = null) {
    if (!run) return;
    run.steps = (Array.isArray(steps) ? steps : [...(run.steps ?? []), entry]).slice(-NAVIGATION_STEP_LIMIT);
    run.currentStep = entry ?? null;
    if (this.activeNavigation?.runId === run.runId) {
      this.activeNavigation = run;
      this.publishNavigationDiagnostics();
    }
  }

  completeNavigationRun(run, result = {}) {
    if (!run) return;
    const finishedAtMs = Date.now();
    const steps = Array.isArray(result?.steps) && result.steps.length ? result.steps.slice(-NAVIGATION_STEP_LIMIT) : (run.steps ?? []).slice(-NAVIGATION_STEP_LIMIT);
    const slowestStep = steps.reduce((best, step) => Number(step?.elapsedMs ?? -1) > Number(best?.elapsedMs ?? -1) ? step : best, null);
    const completed = {
      ...run,
      status: result?.reason === "superseded" ? "superseded" : result?.ok ? "success" : "failed",
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalElapsedMs: Math.max(0, finishedAtMs - Number(run.startedAtMs || finishedAtMs)),
      resultElapsedMs: Number.isFinite(result?.elapsedMs) ? Number(result.elapsedMs) : null,
      reason: result?.reason ?? (result?.ok ? "ok" : "unknown"),
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      slowestStep,
      currentStep: null,
      steps
    };
    delete completed.startedAtMs;
    this.navigationHistory = [...this.navigationHistory, completed].slice(-NAVIGATION_HISTORY_LIMIT);
    const slowSteps = steps.filter(isSlowNavigationStep);
    if (slowSteps.length > 0) {
      const slowRecord = sanitizeSlowNavigationRecord({
        runId: completed.runId,
        targetOrder: completed.targetOrder,
        targetLabel: completed.targetLabel,
        host: completed.host,
        source: completed.source,
        startedAt: completed.startedAt,
        finishedAt: completed.finishedAt,
        totalElapsedMs: completed.totalElapsedMs,
        resultElapsedMs: completed.resultElapsedMs,
        status: completed.status,
        reason: completed.reason,
        ok: completed.ok,
        verified: completed.verified,
        slowestStep: completed.slowestStep,
        slowSteps,
        steps
      });
      if (slowRecord) {
        this.slowNavigationHistory = [...this.slowNavigationHistory, slowRecord].slice(-SLOW_NAVIGATION_HISTORY_LIMIT);
        this.storage?.write?.(SLOW_NAVIGATION_STORAGE_KEY, this.slowNavigationHistory);
      }
    }
    if (this.activeNavigation?.runId === run.runId) this.activeNavigation = null;
    this.publishNavigationDiagnostics();
  }

  publishNavigationDiagnostics() {
    if (!this.window) return;
    const current = this.window.__GPTTalkEnhancerDebug ?? {};
    this.window.__GPTTalkEnhancerDebug = {
      ...current,
      activeNavigation: this.activeNavigation ? { ...this.activeNavigation, steps: [...(this.activeNavigation.steps ?? [])] } : null,
      navigationHistory: this.navigationHistory.map((item) => ({ ...item, steps: [...(item.steps ?? [])] })),
      slowNavigationHistory: this.slowNavigationHistory.map(cloneSlowNavigationRecord),
      lastSlowNavigation: this.slowNavigationHistory.length ? cloneSlowNavigationRecord(this.slowNavigationHistory.at(-1)) : null
    };
  }

  async navigate(turnId) {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    if (!index) return { ok: false, reason: "no-conversation" };
    const identity = this.host.getConversationIdentity?.() ?? null;
    const chatOrderHealth = identity?.stable && identity.host === "chatgpt"
      ? analyzeChatIndexOrderHealth(index.getOrdered?.() ?? [])
      : null;
    const repairableChatIndex = Boolean(
      chatOrderHealth?.corrupt
      && (index.getOrdered?.() ?? []).every((turn) => turn?.source === "dom")
    );
    if (this.chatBootstrapHydrationPromise || repairableChatIndex) {
      const autoRepairBlocked = repairableChatIndex && this.chatAutoRepairBlocked.has(conversationId);
      if (repairableChatIndex && !autoRepairBlocked) {
        this.chatBootstrapAttempted.delete(conversationId);
        this.scheduleRefresh("chat-index-repair-before-navigation");
      }
      this.shell?.showToast?.(autoRepairBlocked ? "时间线索引异常，已暂停自动修复" : "正在修复时间线…");
      return {
        ok: false,
        verified: false,
        target: turnId,
        reason: autoRepairBlocked ? "chat-index-auto-repair-blocked" : "chat-index-repairing",
        orderHealth: chatOrderHealth
      };
    }
    const record = index.get(turnId);
    const targetOrder = Number.isFinite(record?.order) ? Number(record.order) : null;
    this.cancelWorkEarlierHydration();
    this.cancelChatEarlierHydration();
    const requestId = ++this.navigationRequestId;
    const navigationRun = this.beginNavigationRun({ targetOrder, identity });
    this.clearNavigationUxTimer();
    this.setNavigationUx({ state: "pending", target: turnId, targetOrder, pendingVisible: false }, "navigate-start");

    const set = this.window?.setTimeout ?? setTimeout;
    this.navigationUxTimer = set(() => {
      this.navigationUxTimer = null;
      if (this.destroyed || requestId !== this.navigationRequestId || this.navigationUx.state !== "pending") return;
      this.setNavigationUx({ pendingVisible: true }, "navigate-pending-visible");
    }, NAVIGATION_PENDING_DELAY_MS);

    const isCurrent = () => !this.destroyed
      && requestId === this.navigationRequestId
      && conversationId === this.currentConversationId
      && conversationId === this.host.getConversationId?.();
    if (identity?.host === "local") {
      const remainingSettleMs = Math.max(0, this.localNavigationSettleUntil - appNowMs(this.window));
      if (remainingSettleMs > 0) {
        await waitMs(this.window, remainingSettleMs);
        if (!isCurrent()) {
          const superseded = { ok: false, target: turnId, verified: false, reason: "superseded" };
          this.completeNavigationRun(navigationRun, superseded);
          return superseded;
        }
      }
    }
    const allowMountedFastSettle = Boolean(identity?.stable && (identity.host === "chatgpt" || identity.host === "local"));
    const localWorkNavigation = Boolean(identity?.stable && identity.host === "local" && identity.source === "sidebar-local");
    if (localWorkNavigation) this.host.notifyNavigationIntent?.();
    const result = await this.host.navigateToTurn(turnId, {
      turns: index.getOrdered(),
      getTurns: () => index.getOrdered(),
      isCurrent,
      allowMountedFastSettle,
      onTraceStep: (entry, steps) => this.recordNavigationStep(navigationRun, entry, steps)
    });
    if (requestId !== this.navigationRequestId) {
      const supersededResult = result?.reason === "superseded"
        ? result
        : { ...result, ok: false, verified: false, reason: "superseded" };
      this.completeNavigationRun(navigationRun, supersededResult);
      return result;
    }
    this.clearNavigationUxTimer();
    const latestRecord = index.get(turnId);
    const latestTargetOrder = Number.isFinite(latestRecord?.order) ? Number(latestRecord.order) : targetOrder;
    this.lastNavigation = {
      target: turnId,
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      reason: result?.reason ?? (result?.ok ? "ok" : "unknown"),
      probes: Number.isFinite(result?.probes) ? result.probes : 0,
      stalls: Number.isFinite(result?.stalls) ? result.stalls : 0,
      elapsedMs: Number.isFinite(result?.elapsedMs) ? result.elapsedMs : null,
      inactiveMs: Number.isFinite(result?.inactiveMs) ? result.inactiveMs : null,
      budgetLimit: result?.budgetLimit ?? null,
      visibleRange: result?.visibleRange ?? null,
      scrollHeight: Number.isFinite(result?.scrollHeight) ? result.scrollHeight : null,
      maxLogicalPosition: Number.isFinite(result?.maxLogicalPosition) ? result.maxLogicalPosition : null,
      logicalPosition: Number.isFinite(result?.logicalPosition) ? result.logicalPosition : null,
      domId: result?.domId ?? null,
      settleChecks: Number.isFinite(result?.settleChecks) ? result.settleChecks : null,
      settleMode: result?.settleMode ?? null,
      steps: Array.isArray(result?.steps) ? result.steps : [],
      targetOrder: latestTargetOrder
    };
    this.completeNavigationRun(navigationRun, this.lastNavigation);
    if (result?.reason === "superseded") {
      this.setNavigationUx({ state: "idle", target: null, targetOrder: null, pendingVisible: false }, "navigate-superseded");
    } else if (result?.ok) {
      this.setNavigationUx({ state: "success", targetOrder: latestTargetOrder, pendingVisible: false }, "navigate-success");
    } else {
      this.setNavigationUx({ state: "failed", targetOrder: latestTargetOrder, pendingVisible: false }, "navigate-failed");
      const label = Number.isFinite(latestTargetOrder) ? `Q${latestTargetOrder + 1}` : String(turnId ?? "该消息");
      this.shell.showToast(`未能定位 ${label}，请再试一次`);
    }
    this.refresh("navigate-result");
    const earliestKnownRecord = index.getOrdered?.()?.[0] ?? null;
    const earliestKnownOrder = Number.isFinite(earliestKnownRecord?.order) ? Number(earliestKnownRecord.order) : null;
    const explicitWorkEarlierIntent = Boolean(localWorkNavigation
      && result?.ok
      && result?.verified
      && Number.isFinite(latestTargetOrder)
      && Number.isFinite(earliestKnownOrder)
      && latestTargetOrder === earliestKnownOrder);
    if (explicitWorkEarlierIntent) {
      this.maybeStartWorkEarlierHydration({ conversationId, index, identity, explicit: true, stopAfterBatch: true });
    }
    return result;
  }

  armPinnedChatProbe() {
    this.stopPinnedChatProbe();
    const baseline = this.host.getConversationIdentity?.() ?? null;
    const baselineId = baseline?.id ?? null;
    this.pinnedChatProbeBaselineId = baselineId;
    const baselineRoute = String(this.host.getRoute?.() ?? this.window?.location?.href ?? "");
    this.pinnedChatProbeBaselineRoute = baselineRoute;
    const baselineRouteShape = sanitizeProbeHref(baselineRoute);
    this.pinnedChatProbeArmed = true;
    this.pinnedChatProbe = {
      state: "armed",
      captured: false,
      eventCaptured: false,
      transitionObserved: false,
      baseline: {
        identity: sanitizeProbeIdentity(baseline, baselineId),
        routeShape: baselineRouteShape
      },
      eventType: null,
      pathSource: null,
      selectorMatches: null,
      ancestry: [],
      identityTimeline: [],
      activeElementTimeline: [],
      domMutations: []
    };
    const MutationObserverCtor = this.window?.MutationObserver;
    if (typeof MutationObserverCtor === "function" && this.document?.body) {
      try {
        this.pinnedChatProbeObserver = new MutationObserverCtor((records = []) => {
          const probe = this.pinnedChatProbe;
          if (!this.pinnedChatProbeArmed || !probe) return;
          for (const record of Array.from(records).slice(0, 20)) {
            if (probe.domMutations.length >= 80) break;
            probe.domMutations.push({
              type: String(record?.type ?? "unknown"),
              attributeName: record?.attributeName ? String(record.attributeName) : null,
              target: sanitizeProbePath(probeParentChain(record?.target, 4), 4),
              added: Array.from(record?.addedNodes ?? []).slice(0, 3).map((node) => sanitizeProbeNode(node))
            });
          }
        });
        this.pinnedChatProbeObserver.observe(this.document.body, { subtree: true, childList: true, attributes: true });
      } catch {
        this.pinnedChatProbeObserver = null;
      }
    }
    for (const delayMs of [0, 80, 250, 600, 1200, 1800]) {
      const set = this.window?.setTimeout ?? setTimeout;
      const timer = set(() => this.samplePinnedChatProbe(delayMs), delayMs);
      this.pinnedChatProbeTimers.push(timer);
    }
    this.updateDebug("pinned-chat-probe-armed");
    return { armed: true };
  }

  samplePinnedChatProbe(afterMs = 0) {
    const probe = this.pinnedChatProbe;
    if (!this.pinnedChatProbeArmed || !probe) return false;
    const identity = this.host.getConversationIdentity?.() ?? null;
    const rawRoute = String(this.host.getRoute?.() ?? this.window?.location?.href ?? "");
    const routeShape = sanitizeProbeHref(rawRoute);
    const identityState = sanitizeProbeIdentity(identity, this.pinnedChatProbeBaselineId);
    const routeChanged = Boolean(this.pinnedChatProbeBaselineRoute != null && rawRoute !== this.pinnedChatProbeBaselineRoute);
    const identityChanged = identityState.idState === "changed";
    probe.identityTimeline.push({ afterMs, ...identityState, routeShape, routeChanged });
    probe.activeElementTimeline.push({
      afterMs,
      ancestry: sanitizeProbePath(probeParentChain(this.document?.activeElement, 6), 6)
    });
    if (identityChanged || routeChanged) {
      probe.captured = true;
      probe.transitionObserved = true;
      probe.state = "transition-observed";
    }
    if (Number(afterMs) >= 1800) {
      probe.state = probe.transitionObserved ? "completed-transition" : probe.eventCaptured ? "completed-event-only" : "completed-no-transition";
      this.pinnedChatProbeArmed = false;
      this.pinnedChatProbeObserver?.disconnect?.();
      this.pinnedChatProbeObserver = null;
      this.pinnedChatProbeBaselineId = null;
      this.pinnedChatProbeBaselineRoute = null;
    }
    this.updateDebug("pinned-chat-probe-sample");
    return true;
  }

  capturePinnedChatProbe(event) {
    if (!this.pinnedChatProbeArmed || !this.pinnedChatProbe || this.pinnedChatProbe.eventCaptured) return false;
    const target = event?.target ?? null;
    const composedPath = typeof event?.composedPath === "function"
      ? event.composedPath().filter(Boolean)
      : [];
    const pathNodes = composedPath.length ? composedPath : probeParentChain(target);
    const probe = this.pinnedChatProbe;
    probe.captured = true;
    probe.eventCaptured = true;
    probe.eventType = String(event?.type ?? "unknown");
    probe.pathSource = composedPath.length ? "composedPath" : "parent-chain";
    probe.selectorMatches = {
      knownChatKey: Boolean(findProbePathMatch(pathNodes, "[data-sidebar-chatgpt-conversation-key]")),
      knownWorkThread: Boolean(findProbePathMatch(pathNodes, "[data-app-action-sidebar-thread-id]")),
      anchor: Boolean(findProbePathMatch(pathNodes, "a[href]"))
    };
    probe.ancestry = sanitizeProbePath(pathNodes);
    probe.state = probe.transitionObserved ? "transition-observed" : "event-captured";
    this.updateDebug("pinned-chat-probe-event");
    return true;
  }

  stopPinnedChatProbe() {
    this.pinnedChatProbeArmed = false;
    this.pinnedChatProbeObserver?.disconnect?.();
    this.pinnedChatProbeObserver = null;
    this.pinnedChatProbeBaselineId = null;
    this.pinnedChatProbeBaselineRoute = null;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    for (const timer of this.pinnedChatProbeTimers ?? []) clear(timer);
    this.pinnedChatProbeTimers = [];
  }

  capturePinnedChatState() {
    const hostIdentity = this.host.getConversationIdentity?.() ?? null;
    const directIdentity = this.host.getDirectConversationIdentity?.() ?? null;
    const hostConversationId = this.host.getConversationId?.() ?? null;
    const internalConversationId = this.currentConversationId ?? null;
    const index = internalConversationId ? this.turnIndexes.get(internalConversationId) ?? null : null;
    const visibleTurns = Array.isArray(this.host.getVisibleTurns?.()) ? this.host.getVisibleTurns() : [];
    const chatVisibleTurns = Array.isArray(this.host.getChatVisibleTurns?.()) ? this.host.getChatVisibleTurns() : [];
    const knownTurns = index?.getOrdered?.() ?? [];
    const shellStatus = this.shell?.getStatus?.() ?? {};
    const selectedRows = Array.from(this.document?.querySelectorAll?.("[data-sidebar-chatgpt-conversation-key]") ?? []);
    const selectedCandidates = selectedRows.filter((row) => row?.getAttribute?.("aria-current") === "page" || Boolean(row?.querySelector?.("[aria-current='page']")));
    const selectedParsed = selectedCandidates.map((row) => parseSidebarConversationKey(row?.getAttribute?.("data-sidebar-chatgpt-conversation-key"))).filter(Boolean);
    const explicitNodes = Array.from(this.document?.querySelectorAll?.("[data-conversation-id], [data-thread-id]") ?? []);
    const pinnedCandidates = this.getPinnedChatCandidates();
    const memoryIds = new Set([...this.turnIndexes.keys()].filter((id) => id && !String(id).startsWith("local:")));
    const cacheIds = new Set((this.chatTimelineCache.listConversations?.() ?? []).map((entry) => String(entry?.conversationId ?? "")).filter(Boolean));
    const pinnedCandidateDiagnostics = diagnosePinnedChatCandidates(this.host.getChatVisibleTurns?.() ?? visibleTurns, pinnedCandidates, { memoryIds, cacheIds });
    const summarizeOrders = (turns) => {
      const orders = turns.map((turn) => Number(turn?.order)).filter(Number.isFinite).sort((a, b) => a - b);
      return { count: turns.length, orderedCount: orders.length, min: orders.length ? orders[0] : null, max: orders.length ? orders.at(-1) : null };
    };
    const idModeCounts = (turns) => {
      const counts = { fallback: 0, uuidLike: 0, other: 0 };
      for (const turn of turns) {
        const id = String(turn?.id ?? "");
        if (/^(?:fallback-turn|turn-index)-\d+$/.test(id)) counts.fallback += 1;
        else if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(id)) counts.uuidLike += 1;
        else counts.other += 1;
      }
      return counts;
    };
    const selectedRelation = !hostConversationId || !selectedParsed.length
      ? "unavailable"
      : selectedParsed.some((value) => value === hostConversationId) ? "matches-host" : "differs-from-host";
    const internalRelation = !hostConversationId || !internalConversationId
      ? "unavailable"
      : hostConversationId === internalConversationId ? "matches-host" : "differs-from-host";
    const snapshot = {
      surface: this.host.getSurface?.() ?? null,
      routeShape: sanitizeProbeHref(this.host.getRoute?.() ?? this.window?.location?.href ?? ""),
      hostIdentity: hostIdentity ? { present: true, host: hostIdentity.host ?? null, source: hostIdentity.source ?? null, kind: hostIdentity.kind ?? null, stable: Boolean(hostIdentity.stable), idShape: probeValueShape(hostIdentity.id ?? "") } : { present: false },
      directIdentity: directIdentity ? { present: true, host: directIdentity.host ?? null, source: directIdentity.source ?? null, kind: directIdentity.kind ?? null, stable: Boolean(directIdentity.stable), idShape: probeValueShape(directIdentity.id ?? "") } : { present: false },
      inferredConversationSet: Boolean(this.lastPinnedChatInference?.inferredConversationSet),
      inferenceResult: this.lastPinnedChatInference?.result ?? null,
      inferenceEvidence: this.lastPinnedChatInference?.evidence ?? null,
      pinnedClickTransition: this.lastPinnedClickTransition ? { ...this.lastPinnedClickTransition } : null,
      pinnedIdentityLatched: Boolean(this.activePinnedChatConversationId),
      refreshResolvedIdentity: this.lastRefreshDiagnostics?.resolvedIdentity ?? { present: false },
      refreshBranch: this.lastRefreshDiagnostics?.branch ?? null,
      refreshCounts: {
        chatVisibleTurns: Number(this.lastRefreshDiagnostics?.chatVisibleTurnsCount ?? 0),
        routedVisibleTurns: Number(this.lastRefreshDiagnostics?.routedVisibleTurnsCount ?? 0),
        preReconcileIndex: Number(this.lastRefreshDiagnostics?.preReconcileIndexCount ?? 0),
        trustedVisibleTurns: Number(this.lastRefreshDiagnostics?.trustedVisibleTurnsCount ?? 0),
        postRefreshIndex: Number(this.lastRefreshDiagnostics?.postRefreshIndexCount ?? 0)
      },
      reconcileDiagnostics: this.lastRefreshDiagnostics?.chatReconcile
        ? JSON.parse(JSON.stringify(this.lastRefreshDiagnostics.chatReconcile))
        : null,
      internalConversation: { present: Boolean(internalConversationId), relationToHost: internalRelation, idShape: internalConversationId ? probeValueShape(internalConversationId) : "none" },
      selectedChatRows: { total: selectedRows.length, selected: selectedCandidates.length, relationToHost: selectedRelation, keyShapes: selectedParsed.map(probeValueShape) },
      explicitConversationNodes: { count: explicitNodes.length },
      visibleTurns: { ...summarizeOrders(visibleTurns), idModes: idModeCounts(visibleTurns) },
      chatVisibleTurns: { ...summarizeOrders(chatVisibleTurns), idModes: idModeCounts(chatVisibleTurns) },
      timelineIndex: {
        ...summarizeOrders(knownTurns),
        idModes: idModeCounts(knownTurns),
        cacheRestoredTurns: this.cacheHydrationCounts.get(internalConversationId) ?? 0,
        cacheHydration: this.cacheHydrationDiagnostics.get(internalConversationId) ?? null,
        orderHealth: analyzeChatIndexOrderHealth(knownTurns)
      },
      visibleContent: Boolean(this.host?.conversation?.hasVisibleConversationContent?.()),
      stableConversationRoot: Boolean(this.host?.conversation?.getStableConversationRoot?.()),
      shell: {
        timelineMounted: Boolean(shellStatus.timelineMounted),
        timelineHidden: Boolean(shellStatus.timelineHidden),
        timelineMarkerCount: Number(shellStatus.timelineMarkerCount ?? 0),
        questionPanelOpen: Boolean(shellStatus.questionPanelOpen),
        questionRenderCount: Number(shellStatus.questionRenderCount ?? 0),
        questionTurnCount: Number(shellStatus.questionTurnCount ?? 0)
      },
      questionPanelOpen: Boolean(shellStatus.questionPanelOpen),
      chatBootstrapDiagnostics: this.lastChatBootstrapDiagnostics ? { ...this.lastChatBootstrapDiagnostics } : null,
      scrollOwnership: this.getScrollOwnershipState(),
      captureDiagnostics: this.captureDiagnostics.map((entry) => ({ ...entry })),
      chatScrollDiagnostics: this.chatScrollDiagnostics.map((entry) => ({ ...entry, identity: { ...entry.identity } })),
      sidebarStructure: collectSidebarStructureDiagnostics(this.document),
      pinnedCandidateDiagnostics
    };
    this.pinnedChatStateSnapshot = snapshot;
    this.updateDebug("pinned-chat-state-snapshot");
    return JSON.parse(JSON.stringify(snapshot));
  }

  status() {
    const conversation = this.currentConversationId ? this.conversations.snapshot(this.currentConversationId) : null;
    const index = this.currentConversationId ? this.getTurnIndex(this.currentConversationId) : null;
    const shell = this.shell?.getStatus?.() ?? {};
    const surface = this.host?.getSurface?.() ?? SURFACE.OTHER;
    const capture = conversation?.captureStatus ?? this.captureStatus;
    const hostContract = this.host?.getCompatibilityReport?.() ?? null;
    const conversationIdentity = this.host?.getConversationIdentity?.()
      ?? (this.currentConversationId ? { id: this.currentConversationId, source: "unknown", host: null, kind: null, stable: false } : null);
    const captureHasData = Number(capture?.turnCount ?? 0) > 0;
    const fallbackDegraded = capture?.status === "degraded"
      || capture?.status === "unavailable"
      || (surface === SURFACE.CONVERSATION && (index?.size?.() ?? 0) > 0 && !captureHasData);
    const degraded = hostContract
      ? hostContract.status === "degraded" || hostContract.status === "unavailable"
      : fallbackDegraded;
    return {
      version: VERSION,
      host: "codex-desktop",
      surface,
      conversationId: this.currentConversationId,
      conversationIdentity,
      capture: { active: capture?.status === "active", status: capture?.status ?? "unavailable", turnCount: capture?.turnCount ?? 0, lastError: capture?.lastError ?? "" },
      timeline: {
        knownTurns: index?.size?.() ?? 0,
        visibleTurns: index?.getVisible?.().length ?? 0,
        activeTurnId: conversation?.activeTurnId ?? null,
        mounted: Boolean(shell.timelineMounted),
        questionPanelOpen: Boolean(shell.questionPanelOpen),
        renderCount: shell.questionRenderCount ?? 0,
        cacheRestoredTurns: this.cacheHydrationCounts.get(this.currentConversationId) ?? 0,
        cacheHydration: this.cacheHydrationDiagnostics.get(this.currentConversationId) ?? null,
        orderHealth: analyzeChatIndexOrderHealth(index?.getOrdered?.() ?? [])
      },
      prompt: { composerDetected: Boolean(this.host?.getComposer?.()), mounted: Boolean(shell.promptMounted), panelOpen: Boolean(shell.promptPanelOpen) },
      overlayBlocked: surface === SURFACE.MEDIA_VIEWER,
      navigation: { ...this.lastNavigation },
      activeNavigation: this.activeNavigation ? { ...this.activeNavigation, steps: [...(this.activeNavigation.steps ?? [])] } : null,
      navigationHistory: this.navigationHistory.map((item) => ({ ...item, steps: [...(item.steps ?? [])] })),
      slowNavigationHistory: this.slowNavigationHistory.map(cloneSlowNavigationRecord),
      lastSlowNavigation: this.slowNavigationHistory.length ? cloneSlowNavigationRecord(this.slowNavigationHistory.at(-1)) : null,
      navigationUx: { ...this.navigationUx },
      navigationCompatibility: this.host?.getNavigationCompatibility?.() ?? null,
      scrollOwnership: this.getScrollOwnershipState(),
      pinnedChatProbe: this.pinnedChatProbe ? JSON.parse(JSON.stringify(this.pinnedChatProbe)) : null,
      pinnedClickTransition: this.lastPinnedClickTransition ? { ...this.lastPinnedClickTransition } : null,
      pinnedIdentityLatched: Boolean(this.activePinnedChatConversationId),
      chatBootstrapDiagnostics: this.lastChatBootstrapDiagnostics ? { ...this.lastChatBootstrapDiagnostics } : null,
      captureDiagnostics: this.captureDiagnostics.map((entry) => ({ ...entry })),
      chatScrollDiagnostics: this.chatScrollDiagnostics.map((entry) => ({ ...entry, identity: { ...entry.identity } })),
      hostContract,
      health: degraded ? "degraded" : "healthy"
    };
  }

  updateDebug(reason = "manual") {
    if (this.window) this.window.__GPTTalkEnhancerDebug = { ...this.status(), lastRefreshReason: reason };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelWorkEarlierHydration();
    this.cancelChatEarlierHydration();
    this.cancelChatBootstrapHydration();
    this.pendingPinnedChatSelection = null;
    this.activePinnedChatConversationId = null;
    this.navigationRequestId += 1;
    this.clearNavigationUxTimer();
    this.shell?.setNavigationState?.({ state: "idle", target: null, targetOrder: null, pendingVisible: false });
    this.saveConversationView(this.currentConversationId);
    this.observer?.disconnect?.();
    this.bindScrollContainer(null);
    this.window?.removeEventListener?.("popstate", this.boundRoute);
    this.window?.removeEventListener?.("hashchange", this.boundRoute);
    this.document?.removeEventListener?.("click", this.boundConversationSelect, true);
    for (const type of ["pointerdown", "mousedown", "click", "pointerup"]) {
      this.document?.removeEventListener?.(type, this.boundPinnedChatProbeEvent, true);
      this.window?.removeEventListener?.(type, this.boundPinnedChatProbeEvent, true);
    }
    this.stopPinnedChatProbe();
    this.clearConversationSelectTimer();
    this.clearChatIdentitySettleRetry();
    if (this.refreshFrame != null && typeof this.window?.cancelAnimationFrame === "function") this.window.cancelAnimationFrame(this.refreshFrame);
    this.host?.destroy?.();
    this.shell?.destroy?.();
    if (this.window?.__GPTTalkEnhancerV3 === this) delete this.window.__GPTTalkEnhancerV3;
  }
}

export function registerBundle(windowRef = globalThis.window) {
  if (!windowRef) return null;
  const bundle = {
    version: VERSION,
    mount(options = {}) {
      return new TalkEnhancerV3App({ window: windowRef, document: windowRef.document, ...options }).start();
    }
  };
  windowRef.__GPTTalkEnhancerV3Bundle = bundle;
  return bundle;
}

if (typeof window !== "undefined") registerBundle(window);

function isSlowNavigationStep(step = {}) {
  const elapsedMs = Number(step?.elapsedMs) || 0;
  const waitMs = Number(step?.waitMs) || 0;
  if (step?.mode === "chat-progressive") return elapsedMs >= 100;
  if (step?.mode === "work-wheel") return elapsedMs >= Math.max(180, waitMs * 1.5);
  return elapsedMs >= Math.max(100, waitMs * 1.5);
}

function sanitizeSlowNavigationHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeSlowNavigationRecord).filter(Boolean).slice(-SLOW_NAVIGATION_HISTORY_LIMIT);
}

function sanitizeSlowNavigationRecord(value = {}) {
  if (!value || typeof value !== "object") return null;
  const cleanStep = (step) => step && typeof step === "object" ? {
    mode: String(step.mode ?? "unknown"),
    direction: Number(step.direction) || 0,
    elapsedMs: Math.round(Number(step.elapsedMs) || 0),
    jumpPx: Math.round(Number(step.jumpPx) || 0),
    waitMs: Math.round(Number(step.waitMs) || 0),
    targetOrder: Number.isFinite(step.targetOrder) ? Number(step.targetOrder) : null,
    progressKind: String(step.progressKind ?? "none"),
    before: sanitizeTraceSnapshot(step.before),
    after: sanitizeTraceSnapshot(step.after)
  } : null;
  return {
    runId: Number(value.runId) || 0,
    targetOrder: Number.isFinite(value.targetOrder) ? Number(value.targetOrder) : null,
    targetLabel: typeof value.targetLabel === "string" ? value.targetLabel : null,
    host: typeof value.host === "string" ? value.host : null,
    source: typeof value.source === "string" ? value.source : null,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    totalElapsedMs: Math.round(Number(value.totalElapsedMs) || 0),
    resultElapsedMs: Number.isFinite(value.resultElapsedMs) ? Math.round(Number(value.resultElapsedMs)) : null,
    status: typeof value.status === "string" ? value.status : null,
    reason: typeof value.reason === "string" ? value.reason : null,
    ok: Boolean(value.ok),
    verified: Boolean(value.verified),
    slowestStep: cleanStep(value.slowestStep),
    slowSteps: (Array.isArray(value.slowSteps) ? value.slowSteps : []).map(cleanStep).filter(Boolean).slice(-NAVIGATION_STEP_LIMIT),
    steps: (Array.isArray(value.steps) ? value.steps : []).map(cleanStep).filter(Boolean).slice(-NAVIGATION_STEP_LIMIT)
  };
}

function sanitizeTraceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    visibleRange: snapshot.visibleRange && Number.isFinite(snapshot.visibleRange.min) && Number.isFinite(snapshot.visibleRange.max)
      ? { min: Number(snapshot.visibleRange.min), max: Number(snapshot.visibleRange.max) }
      : null,
    scrollHeight: Math.round(Number(snapshot.scrollHeight) || 0),
    logicalPosition: Math.round(Number(snapshot.logicalPosition) || 0)
  };
}

function cloneSlowNavigationRecord(record) {
  return record ? JSON.parse(JSON.stringify(record)) : null;
}

function diagnosticRound(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function diagnosticIdModeCounts(turns = []) {
  const counts = { fallback: 0, uuidLike: 0, other: 0 };
  for (const turn of Array.isArray(turns) ? turns : []) {
    const id = String(turn?.id ?? "");
    if (/^(?:fallback-turn|turn-index)-\d+$/.test(id)) counts.fallback += 1;
    else if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(id)) counts.uuidLike += 1;
    else if (id) counts.other += 1;
  }
  return counts;
}

function collectSidebarStructureDiagnostics(documentRef) {
  const roots = Array.from(documentRef?.querySelectorAll?.("aside, nav, [role='navigation']") ?? []).slice(0, 8);
  const nodes = [];
  const seen = new Set();
  for (const root of roots) {
    const descendants = [root, ...Array.from(root?.querySelectorAll?.("*") ?? []).slice(0, 500)];
    for (const node of descendants) {
      if (!node || seen.has(node)) continue;
      seen.add(node);
      nodes.push(node);
    }
  }
  const dataAttributeCounts = new Map();
  const hrefShapeCounts = new Map();
  const candidateShapeCounts = new Map();
  let ariaCurrentCount = 0;
  let ariaSelectedCount = 0;
  for (const node of nodes) {
    const names = typeof node?.getAttributeNames === "function" ? node.getAttributeNames() : [];
    const dataNames = names.filter((name) => String(name).startsWith("data-")).sort();
    for (const name of dataNames) dataAttributeCounts.set(name, (dataAttributeCounts.get(name) ?? 0) + 1);
    const hrefShape = sanitizeProbeHref(node?.getAttribute?.("href"));
    if (hrefShape) hrefShapeCounts.set(hrefShape, (hrefShapeCounts.get(hrefShape) ?? 0) + 1);
    if (node?.getAttribute?.("aria-current") != null) ariaCurrentCount += 1;
    if (node?.getAttribute?.("aria-selected") != null) ariaSelectedCount += 1;
  }
  for (const node of nodes) {
    const names = typeof node?.getAttributeNames === "function" ? node.getAttributeNames() : [];
    const dataNames = names.filter((name) => String(name).startsWith("data-")).sort();
    const hrefShape = sanitizeProbeHref(node?.getAttribute?.("href"));
    const role = node?.getAttribute?.("role") ?? null;
    const ariaCurrent = node?.getAttribute?.("aria-current") ?? null;
    const ariaSelected = node?.getAttribute?.("aria-selected") ?? null;
    if (!dataNames.length && !hrefShape && !role && ariaCurrent == null && ariaSelected == null) continue;
    const tag = String(node?.tagName ?? "").toLowerCase();
    const key = JSON.stringify({ tag: tag || null, role, hrefShape, dataNames, ariaCurrent, ariaSelected });
    candidateShapeCounts.set(key, (candidateShapeCounts.get(key) ?? 0) + 1);
  }
  const ranked = (map, keyName) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, 40)
    .map(([key, count]) => ({ [keyName]: key, count }));
  return {
    rootCount: roots.length,
    scannedNodeCount: nodes.length,
    ariaCurrentCount,
    ariaSelectedCount,
    dataAttributeNames: ranked(dataAttributeCounts, "name"),
    hrefShapes: ranked(hrefShapeCounts, "shape"),
    candidateShapes: [...candidateShapeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([key, count]) => ({ ...JSON.parse(key), count })),
    pinnedRelations: collectPinnedSidebarRelations(documentRef)
  };
}

function collectPinnedSidebarRelations(documentRef) {
  const pinnedNodes = Array.from(documentRef?.querySelectorAll?.("[data-pinned-content-tab-drop-key]") ?? []).slice(0, 20);
  return pinnedNodes.map((node, index) => {
    const ancestors = probeParentChain(node, 10);
    const parentShapes = ancestors.map((ancestor, depth) => ({
      depth,
      tag: String(ancestor?.tagName ?? "").toLowerCase() || null,
      role: ancestor?.getAttribute?.("role") ?? null,
      hrefShape: sanitizeProbeHref(ancestor?.getAttribute?.("href")),
      dataNames: (typeof ancestor?.getAttributeNames === "function" ? ancestor.getAttributeNames() : [])
        .filter((name) => String(name).startsWith("data-"))
        .sort()
    }));
    const chatAncestorDepth = ancestors.findIndex((ancestor) => ancestor?.getAttribute?.("data-sidebar-chatgpt-conversation-key") != null);
    const appThreadAncestorDepth = ancestors.findIndex((ancestor) => ancestor?.getAttribute?.("data-app-action-sidebar-thread-id") != null);
    return {
      index: index + 1,
      tag: String(node?.tagName ?? "").toLowerCase() || null,
      role: node?.getAttribute?.("role") ?? null,
      chatAncestorDepth: chatAncestorDepth >= 0 ? chatAncestorDepth : null,
      appThreadAncestorDepth: appThreadAncestorDepth >= 0 ? appThreadAncestorDepth : null,
      descendantChatConversationCount: Number(node?.querySelectorAll?.("[data-sidebar-chatgpt-conversation-key]")?.length ?? 0),
      descendantAppThreadCount: Number(node?.querySelectorAll?.("[data-app-action-sidebar-thread-id]")?.length ?? 0),
      parentShapes
    };
  });
}

function probeParentChain(target, maxDepth = 10) {
  const nodes = [];
  let node = target ?? null;
  for (let depth = 0; node && depth < maxDepth; depth += 1, node = node.parentElement ?? null) nodes.push(node);
  return nodes;
}

function findProbePathMatch(nodes, selector) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    try {
      if (node?.matches?.(selector)) return node;
      if (node?.closest?.(selector) === node) return node;
    } catch {}
  }
  return null;
}

function sanitizeProbeNode(node) {
  if (!node || typeof node !== "object") return null;
  return sanitizeProbePath([node], 1)[0] ?? null;
}

function sanitizeProbePath(nodes, maxDepth = 10) {
  const rows = [];
  const input = Array.isArray(nodes) ? nodes : [];
  for (let depth = 0; depth < Math.min(maxDepth, input.length); depth += 1) {
    const node = input[depth];
    if (!node || typeof node !== "object") continue;
    const names = typeof node.getAttributeNames === "function" ? node.getAttributeNames() : [];
    const data = {};
    for (const name of names) {
      if (!String(name).startsWith("data-")) continue;
      data[name] = sanitizeProbeAttribute(name, node.getAttribute?.(name));
    }
    rows.push({
      depth,
      tag: String(node.tagName ?? "").toLowerCase() || null,
      role: node.getAttribute?.("role") ?? null,
      ariaCurrent: node.getAttribute?.("aria-current") ?? null,
      ariaSelected: node.getAttribute?.("aria-selected") ?? null,
      classShape: sanitizeProbeClass(node.getAttribute?.("class") ?? node.className ?? ""),
      hrefShape: sanitizeProbeHref(node.getAttribute?.("href")),
      data
    });
  }
  return rows;
}

function sanitizeProbeClass(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.split(/\s+/).filter(Boolean).slice(0, 10).join(" ").slice(0, 160);
}

function sanitizeProbeAttribute(name, value) {
  const key = String(name ?? "").toLowerCase();
  const text = String(value ?? "");
  if (!text) return "";
  if (/(?:^|[-_])(id|key|thread|conversation)(?:$|[-_])/.test(key)) return `<redacted:${probeValueShape(text)}>`;
  if (/(?:title|label|name|text|content)/.test(key)) return `<redacted:text-${Math.min(99, text.length)}>`;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function sanitizeProbeHref(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://probe.invalid");
    const parts = url.pathname.split("/").map((part) => {
      if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(part)) return "<id>";
      if (/^[A-Za-z0-9_-]{20,}$/.test(part)) return "<id>";
      return part;
    });
    return parts.join("/") || "/";
  } catch {
    return "<unparsed>";
  }
}

function probeValueShape(value) {
  const text = String(value ?? "");
  if (/^local:/i.test(text)) return "local";
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(text)) return "uuid-like";
  if (text.includes(":")) return "namespaced";
  return `opaque-${Math.min(99, text.length)}`;
}

function sanitizeProbeIdentity(identity, baselineId = null) {
  if (!identity) return { present: false, host: null, source: null, kind: null, stable: false, idState: "none" };
  const id = identity?.id ?? null;
  return {
    present: true,
    host: identity?.host ?? null,
    source: identity?.source ?? null,
    kind: identity?.kind ?? null,
    stable: Boolean(identity?.stable),
    idState: !id ? "none" : baselineId && id === baselineId ? "same" : "changed"
  };
}

function appNowMs(windowRef = globalThis.window) {
  const value = Number(windowRef?.performance?.now?.());
  return Number.isFinite(value) ? value : Date.now();
}

function waitMs(windowRef, ms) {
  const set = windowRef?.setTimeout ?? setTimeout;
  return new Promise((resolve) => set(resolve, Math.max(0, Number(ms) || 0)));
}
