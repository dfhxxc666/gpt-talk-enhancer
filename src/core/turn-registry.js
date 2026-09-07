import { shortenText } from "./dom-utils.js";

export class TurnRegistry {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.records = new Map();
    this.conversationId = null;
    this.sequence = 0;
  }

  setConversation(conversationId) {
    if (this.conversationId === conversationId) {
      return false;
    }
    this.conversationId = conversationId;
    this.records.clear();
    this.sequence = 0;
    return true;
  }

  clear() {
    this.records.clear();
    this.sequence = 0;
  }

  upsert(input, now = this.clock()) {
    if (!input?.key) {
      return null;
    }

    const previous = this.records.get(input.key);
    const hasOrder = Number.isFinite(input.logicalOrder);
    const record = previous ?? {
      key: String(input.key),
      text: "",
      shortText: "",
      element: null,
      rendered: false,
      approximatePosition: null,
      discoveredAt: now,
      lastSeenAt: now,
      logicalOrder: this.sequence++
    };

    if (input.text !== undefined) record.text = String(input.text);
    if (input.shortText !== undefined) record.shortText = String(input.shortText);
    else if (input.text !== undefined) record.shortText = shortenText(input.text);
    if (input.element !== undefined) record.element = input.element;
    if (input.approximatePosition !== undefined) record.approximatePosition = input.approximatePosition;
    if (hasOrder) record.logicalOrder = input.logicalOrder;
    if (input.rendered !== undefined) record.rendered = Boolean(input.rendered);
    else if (input.element !== undefined) record.rendered = Boolean(input.element);
    if (record.rendered) record.lastSeenAt = now;

    this.records.set(record.key, record);
    return record;
  }

  syncRendered(turns, now = this.clock()) {
    const seenKeys = new Set();
    for (const turn of turns ?? []) {
      if (!turn?.key) continue;
      seenKeys.add(String(turn.key));
      this.upsert({ ...turn, rendered: true }, now);
    }

    for (const record of this.records.values()) {
      if (!seenKeys.has(record.key)) {
        record.rendered = false;
        record.element = null;
      }
    }
    return this.getUserRecords();
  }

  markUnrendered(turnKey) {
    const record = this.records.get(turnKey);
    if (!record) {
      return false;
    }
    record.rendered = false;
    record.element = null;
    return true;
  }

  get(turnKey) {
    return this.records.get(turnKey) ?? null;
  }

  getAll() {
    return [...this.records.values()].sort(compareRecords);
  }

  getUserRecords() {
    return this.getAll();
  }

  getRenderedRecords() {
    return this.getAll().filter((record) => record.rendered && record.element);
  }

  get size() {
    return this.records.size;
  }
}

function compareRecords(left, right) {
  const leftOrder = Number.isFinite(left.logicalOrder) ? left.logicalOrder : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(right.logicalOrder) ? right.logicalOrder : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.discoveredAt !== right.discoveredAt) return left.discoveredAt - right.discoveredAt;
  return left.key.localeCompare(right.key);
}
