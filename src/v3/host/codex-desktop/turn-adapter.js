const TURN_ID_ATTRIBUTES = [
  "data-turn-id-container",
  "data-turn-id",
  "data-content-search-turn-key",
  "data-turn-key"
];

const USER_SELECTORS = [
  "[data-turn='user']",
"[data-message-author-role='user']",
  "[data-testid='user-message']",
  "[data-user-message-bubble='true']",
  "[data-markdown-text-tone='user-message']",
  "[data-message-author='user']"
];

const FALLBACK_MEDIA_SELECTORS = TURN_ID_ATTRIBUTES.map((attribute) => `[${attribute}^='fallback-turn-']`);
const FALLBACK_MEDIA_CONTENT_SELECTORS = [
  "img",
  "[data-testid*='file']",
  "[data-file]",
  "[data-attachment]",
  "[aria-label*='file' i]",
  "[aria-label*='image' i]"
];

const TURN_GEOMETRY_SELECTORS = [
  "[data-turn='user']",
"[data-local-conversation-user-anchor='true']",
  "[data-user-message-bubble='true']",
  "[data-message-author-role='user']",
  "[data-testid='user-message']",
  "[data-markdown-text-tone='user-message']",
  "[data-message-author='user']"
];

export class TurnAdapter {
  constructor({ document, clock = () => Date.now() } = {}) {
    this.document = document ?? globalThis.document;
    this.clock = clock;
  }

  getVisibleTurns() {
    const seen = new Set();
    const candidates = [];
    for (const selector of USER_SELECTORS) {
      for (const message of this.document?.querySelectorAll?.(selector) ?? []) {
        const container = this.getTurnContainer(message);
        const id = this.getTurnId(container) ?? this.getTurnId(message);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        candidates.push({ id, message, container, placeholderText: null, discoveryOrder: candidates.length });
      }
    }
    for (const selector of FALLBACK_MEDIA_SELECTORS) {
      for (const container of this.document?.querySelectorAll?.(selector) ?? []) {
        const id = this.getTurnId(container);
        if (!id || seen.has(id) || !/^fallback-turn-\d+$/.test(String(id))) continue;
        if (!hasFallbackMediaContent(container)) continue;
        seen.add(id);
        candidates.push({ id, message: null, container, placeholderText: "[图片或文件]", discoveryOrder: candidates.length });
      }
    }
    candidates.sort(compareDomCandidateOrder);
    const visualOrderById = rankCandidatesByVisualTop(candidates, (candidate) => {
      const target = this.getTurnGeometryElement(candidate?.message ?? candidate?.container ?? null);
      return target?.getBoundingClientRect?.() ?? null;
    });
    const turns = [];
    for (let windowOrder = 0; windowOrder < candidates.length; windowOrder += 1) {
      const { id, message, container, placeholderText } = candidates[windowOrder];
      const orderInfo = this.getTurnOrderInfo(container, windowOrder);
      turns.push({
        id,
        order: orderInfo.order,
        orderTrust: orderInfo.trust,
        windowOrder,
        visualOrder: visualOrderById.get(String(id)) ?? null,
        text: placeholderText ?? this.readTurnText(message, container),
        type: "text",
        source: "dom",
        lastSeen: this.clock(),
        visible: true
      });
    }
    return turns.sort((a, b) => a.order - b.order);
  }

  resolveTurn(turnId) {
    if (!turnId) return null;
    const escaped = cssEscape(String(turnId));
    for (const attribute of TURN_ID_ATTRIBUTES) {
      const elements = this.document?.querySelectorAll?.(`[${attribute}="${escaped}"]`) ?? [];
      for (const element of elements) {
        const candidate = this.getTurnGeometryElement(element);
        if (candidate && this.verifyTurnElement(turnId, candidate)) return candidate;
      }
    }
    return null;
  }

  getTurnGeometryElement(element) {
    if (!element) return null;
    if (hasUsableRect(element.getBoundingClientRect?.())) return element;
    for (const selector of TURN_GEOMETRY_SELECTORS) {
      const candidate = element.querySelector?.(selector);
      if (candidate && hasUsableRect(candidate.getBoundingClientRect?.())) return candidate;
    }
    return element;
  }

  verifyTurnElement(turnId, element) {
    return Boolean(element && this.getTurnId(element) === String(turnId));
  }

  getTurnContainer(element) {
    if (!element?.closest) return element ?? null;
    for (const attribute of TURN_ID_ATTRIBUTES) {
      const found = element.closest(`[${attribute}]`);
      if (found) return found;
    }
    return element.closest("article") ?? element;
  }

  getTurnId(element) {
    if (!element?.getAttribute) return null;
    for (const attribute of TURN_ID_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value) return String(value);
    }
    if (!element.closest) return null;
    for (const attribute of TURN_ID_ATTRIBUTES) {
      const owner = element.closest(`[${attribute}]`);
      const value = owner?.getAttribute?.(attribute);
      if (value) return String(value);
    }
    return null;
  }

  getTurnOrder(element, fallback = 0) {
    return this.getTurnOrderInfo(element, fallback).order;
  }

  getTurnOrderInfo(element, fallback = 0) {
    const fallbackId = this.getTurnId(element);
    const fallbackMatch = String(fallbackId ?? "").match(/^fallback-turn-(\d+)$/);
    if (fallbackMatch) return { order: Number.parseInt(fallbackMatch[1], 10), trust: "absolute" };
    for (const attribute of ["data-turn-index", "data-message-index", "aria-posinset"]) {
      const value = Number.parseInt(element?.getAttribute?.(attribute) ?? "", 10);
      if (Number.isFinite(value)) return { order: value, trust: "absolute" };
    }
    return { order: fallback, trust: "window" };
  }

  readTurnText(message, container) {
    const target = message ?? container;
    const text = String(target?.innerText ?? target?.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text;
    if (Number(target?.childElementCount) > 0 || Number(container?.childElementCount) > 0) return "[图片或文件]";
    return "";
  }
}


function hasFallbackMediaContent(container) {
  for (const selector of FALLBACK_MEDIA_CONTENT_SELECTORS) {
    try {
      if (container?.querySelector?.(selector)) return true;
    } catch {}
  }
  return false;
}

function rankCandidatesByVisualTop(candidates = [], readRect = () => null) {
  if (!Array.isArray(candidates) || candidates.length < 2) return new Map();
  const rows = candidates.map((candidate, index) => {
    const rect = readRect(candidate);
    const top = Number(rect?.top);
    return { id: String(candidate?.id ?? ""), top, index };
  });
  if (rows.some((row) => !row.id || !Number.isFinite(row.top))) return new Map();
  const distinct = new Set(rows.map((row) => row.top));
  if (distinct.size !== rows.length) return new Map();
  rows.sort((a, b) => a.top - b.top || a.index - b.index);
  return new Map(rows.map((row, visualOrder) => [row.id, visualOrder]));
}

function compareDomCandidateOrder(left, right) {
  if (left === right) return 0;
  const leftNode = left?.message ?? left?.container ?? null;
  const rightNode = right?.message ?? right?.container ?? null;
  try {
    const relation = leftNode?.compareDocumentPosition?.(rightNode);
    if (Number.isFinite(relation)) {
      if (relation & 4) return -1;
      if (relation & 2) return 1;
    }
  } catch {}
  return Number(left?.discoveryOrder ?? 0) - Number(right?.discoveryOrder ?? 0);
}
function hasUsableRect(rect) {
  return Boolean(rect && Number(rect.width) > 0 && Number(rect.height) > 0);
}

export function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/[\\"\]\[]/g, "\\$&");
}

export const TURN_ID_PRIORITY = Object.freeze([...TURN_ID_ATTRIBUTES]);
