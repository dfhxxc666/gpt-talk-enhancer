const SOURCE_ORDER = ["capture", "dom"];
const FALLBACK_TURN = /^fallback-turn-(\d+)$/;
const LEGACY_TURN = /^turn-index-(\d+)$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TurnIndex {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.records = new Map();
    this.aliases = new Map();
  }

  upsert(input) {
    if (!input?.id) return null;
    const previous = this.records.get(input.id);
    const sources = new Set(sourceParts(previous?.source));
    for (const source of sourceParts(input.source)) sources.add(source);
    const next = {
      id: String(input.id),
      order: previous?.source?.includes("capture") && input.source === "dom"
        ? previous.order
        : finiteOr(input.order, previous?.order, this.records.size),
      text: cleanText(input.text ?? previous?.text ?? ""),
      shortText: cleanText(input.shortText ?? input.text ?? previous?.shortText ?? previous?.text ?? ""),
      type: input.type ?? previous?.type ?? "text",
      source: normalizeSource(sources),
      lastSeen: finiteOr(input.lastSeen, this.clock()),
      visible: input.visible ?? previous?.visible ?? false
    };
    this.records.set(next.id, next);
    return next;
  }

  mergeMany(records = []) {
    for (const record of records) this.upsert(record);
    return this.getOrdered();
  }

  replaceCapture(records = []) {
    const captureIds = new Set();
    for (const record of records) {
      captureIds.add(String(record.id));
      this.upsert({ ...record, source: "capture" });
    }
    for (const [id, record] of this.records) {
      if (!captureIds.has(id) && record.source === "capture") this.records.delete(id);
    }
    this.reconcileFallbackAliases();
    return this.getOrdered();
  }

  setVisible(visibleRecords = []) {
    for (const record of this.records.values()) record.visible = false;
    for (const record of visibleRecords) {
      if (!record?.id) continue;
      const originalId = String(record.id);
      const canonicalId = this.resolveCanonicalId(originalId);
      if (canonicalId !== originalId) this.aliases.set(originalId, canonicalId);
      this.upsert({ ...record, id: canonicalId, source: "dom", visible: true });
    }
    this.reconcileLegacyAliases(visibleRecords);
  }

  resolveCanonicalId(id) {
    if (!id) return null;
    const value = String(id);
    const aliased = this.aliases.get(value);
    if (aliased) return aliased;
    if (this.records.has(value)) return value;
    const order = fallbackOrder(value);
    if (order === null) return value;
    return this.getCaptureRecordAtOrder(order)?.id ?? value;
  }

  getCaptureRecordAtOrder(order) {
    if (!Number.isFinite(order)) return null;
    return [...this.records.values()].find((record) => record.source?.includes("capture") && record.order === order) ?? null;
  }

  reconcileFallbackAliases() {
    for (const [id, record] of [...this.records.entries()]) {
      const order = fallbackOrder(id);
      if (order === null || record.source?.includes("capture")) continue;
      const captured = this.getCaptureRecordAtOrder(order);
      if (!captured || captured.id === id) continue;
      this.aliases.set(id, captured.id);
      if (record.visible) {
        this.upsert({
          ...captured,
          id: captured.id,
          text: captured.text || record.text,
          shortText: captured.shortText || record.shortText,
          source: "dom",
          visible: true,
          lastSeen: record.lastSeen
        });
      }
      if (record.source === "dom") this.records.delete(id);
    }
  }

  reconcileLegacyAliases(visibleRecords = []) {
    const stableByOrder = new Map();
    const ambiguousOrders = new Set();
    for (const record of visibleRecords) {
      if (!record?.id || !Number.isFinite(record.order)) continue;
      const id = String(record.id);
      if (fallbackOrder(id) !== null || legacyTurnOrder(id) !== null) continue;
      const order = Number(record.order);
      if (stableByOrder.has(order) && stableByOrder.get(order) !== id) {
        stableByOrder.delete(order);
        ambiguousOrders.add(order);
      } else if (!ambiguousOrders.has(order)) {
        stableByOrder.set(order, id);
      }
    }

    for (const [legacyId, legacyRecord] of [...this.records.entries()]) {
      const legacyOrder = legacyTurnOrder(legacyId);
      if (legacyOrder === null || Number(legacyRecord.order) !== legacyOrder) continue;
      const stableId = stableByOrder.get(legacyOrder);
      if (!stableId || stableId === legacyId) continue;
      const stableRecord = this.records.get(stableId);
      if (!stableRecord?.visible) continue;
      const legacyText = cleanText(legacyRecord.text);
      const stableText = cleanText(stableRecord.text);
      if (!legacyText || !stableText || legacyText !== stableText) continue;

      this.aliases.set(legacyId, stableId);
      this.upsert({
        ...stableRecord,
        id: stableId,
        text: stableRecord.text || legacyRecord.text,
        shortText: stableRecord.shortText || legacyRecord.shortText,
        source: "dom",
        visible: true,
        lastSeen: Math.max(Number(stableRecord.lastSeen) || 0, Number(legacyRecord.lastSeen) || 0)
      });
      if (!legacyRecord.source?.includes("capture")) this.records.delete(legacyId);
    }
  }

  reindexUuidV7() {
    const entries = [...this.records.values()];
    const stable = entries.filter((record) => isUuidV7(record?.id));
    if (!stable.length) return false;

    const legacy = entries.filter((record) => legacyTurnOrder(record?.id) !== null);
    const unsupported = entries.filter((record) => !isUuidV7(record?.id) && legacyTurnOrder(record?.id) === null);
    if (unsupported.length) return false;

    const stableByText = new Map();
    for (const record of stable) {
      const text = cleanText(record.text);
      if (!text) continue;
      const matches = stableByText.get(text) ?? [];
      matches.push(record.id);
      stableByText.set(text, matches);
    }

    for (const record of legacy) {
      const text = cleanText(record.text);
      if (!text || !(stableByText.get(text)?.length)) return false;
    }

    let changed = false;
    for (const record of legacy) {
      const matches = stableByText.get(cleanText(record.text)) ?? [];
      if (matches.length === 1) this.aliases.set(record.id, matches[0]);
      if (this.records.delete(record.id)) changed = true;
    }

    stable.sort((a, b) => String(a.id).toLowerCase().localeCompare(String(b.id).toLowerCase()));
    stable.forEach((record, order) => {
      if (record.order !== order) changed = true;
      record.order = order;
    });
    return changed;
  }

  get(id) {
    return this.records.get(this.resolveCanonicalId(id)) ?? null;
  }

  has(id) {
    return this.records.has(this.resolveCanonicalId(id));
  }

  getOrdered() {
    return [...this.records.values()].sort(compareTurns);
  }

  getVisible() {
    return this.getOrdered().filter((record) => record.visible);
  }

  size() {
    return this.records.size;
  }

  signature() {
    return this.getOrdered().map((record) => `${record.id}\u0000${record.order}\u0000${record.text}`).join("\u0001");
  }
}

export function compareTurns(a, b) {
  return finiteOr(a?.order, Number.MAX_SAFE_INTEGER) - finiteOr(b?.order, Number.MAX_SAFE_INTEGER)
    || String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

export function fallbackOrder(id) {
  const match = String(id ?? "").match(FALLBACK_TURN);
  if (!match) return null;
  const order = Number.parseInt(match[1], 10);
  return Number.isFinite(order) ? order : null;
}

export function isUuidV7(id) {
  return UUID_V7.test(String(id ?? "").trim());
}

export function legacyTurnOrder(id) {
  const match = String(id ?? "").match(LEGACY_TURN);
  if (!match) return null;
  const order = Number.parseInt(match[1], 10);
  return Number.isFinite(order) ? order : null;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceParts(source) {
  return String(source ?? "").split("+").filter((value) => SOURCE_ORDER.includes(value));
}

function normalizeSource(sources) {
  const values = SOURCE_ORDER.filter((source) => sources.has(source));
  return values.length ? values.join("+") : "dom";
}

function finiteOr(...values) {
  for (const value of values) if (Number.isFinite(value)) return Number(value);
  return 0;
}
