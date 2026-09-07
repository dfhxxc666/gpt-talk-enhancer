const TURN_ID_ATTRIBUTES = [
  "data-turn-id-container",
  "data-turn-id",
  "data-content-search-turn-key",
  "data-turn-key"
];

const USER_SELECTORS = [
  "[data-message-author-role='user']",
  "[data-testid='user-message']",
  "[data-user-message-bubble='true']",
  "[data-markdown-text-tone='user-message']",
  "[data-message-author='user']"
];

const TURN_GEOMETRY_SELECTORS = [
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
    const turns = [];
    let fallbackOrder = 0;
    for (const selector of USER_SELECTORS) {
      for (const message of this.document?.querySelectorAll?.(selector) ?? []) {
        const container = this.getTurnContainer(message);
        const id = this.getTurnId(container) ?? this.getTurnId(message);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        turns.push({
          id,
          order: this.getTurnOrder(container, fallbackOrder++),
          text: this.readTurnText(message, container),
          type: "text",
          source: "dom",
          lastSeen: this.clock(),
          visible: true
        });
      }
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
    const fallbackId = this.getTurnId(element);
    const fallbackMatch = String(fallbackId ?? "").match(/^fallback-turn-(\d+)$/);
    if (fallbackMatch) return Number.parseInt(fallbackMatch[1], 10);
    for (const attribute of ["data-turn-index", "data-message-index", "aria-posinset"]) {
      const value = Number.parseInt(element?.getAttribute?.(attribute) ?? "", 10);
      if (Number.isFinite(value)) return value;
    }
    return fallback;
  }

  readTurnText(message, container) {
    const target = message ?? container;
    return String(target?.innerText ?? target?.textContent ?? "").replace(/\s+/g, " ").trim();
  }
}

function hasUsableRect(rect) {
  return Boolean(rect && Number(rect.width) > 0 && Number(rect.height) > 0);
}

export function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/[\\"\]\[]/g, "\\$&");
}

export const TURN_ID_PRIORITY = Object.freeze([...TURN_ID_ATTRIBUTES]);
