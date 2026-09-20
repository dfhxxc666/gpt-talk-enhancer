/*
 * GPT TalkEnhancer 0.5.2 Desktop bundle
 * Includes GPL-3.0-or-later derived Timeline UI material.
 * See NOTICE-GPL.md and THIRD_PARTY_GPL-3.0.txt in this distribution.
 */
(() => {
  "use strict";
  const __modules = {
"src/v3/core/event-bus.js": (module, exports, __require) => {
class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    const set = this.listeners.get(type);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(type);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) listener(payload);
  }

  clear() {
    this.listeners.clear();
  }
}

Object.assign(exports, { EventBus });

},
"src/v3/core/storage.js": (module, exports, __require) => {
class StorageAdapter {
  read(_key, fallback = null) {
    return fallback;
  }

  write(_key, _value) {
    return false;
  }

  remove(_key) {
    return false;
  }
}

class LocalStorageAdapter extends StorageAdapter {
  constructor(storage) {
    super();
    this.storage = storage ?? null;
  }

  read(key, fallback = null) {
    try {
      const raw = this.storage?.getItem?.(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  write(key, value) {
    try {
      this.storage?.setItem?.(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key) {
    try {
      this.storage?.removeItem?.(key);
      return true;
    } catch {
      return false;
    }
  }
}

class MemoryStorageAdapter extends StorageAdapter {
  constructor(seed = {}) {
    super();
    this.values = new Map(Object.entries(seed));
  }

  read(key, fallback = null) {
    return this.values.has(key) ? structuredCloneSafe(this.values.get(key)) : fallback;
  }

  write(key, value) {
    this.values.set(key, structuredCloneSafe(value));
    return true;
  }

  remove(key) {
    return this.values.delete(key);
  }
}

function structuredCloneSafe(value) {
  if (value == null) return value;
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

Object.assign(exports, { StorageAdapter, LocalStorageAdapter, MemoryStorageAdapter });

},
"src/v3/core/conversation-store.js": (module, exports, __require) => {
const DEFAULT_CAPTURE = Object.freeze({ status: "unavailable", turnCount: 0, lastError: "" });

class ConversationStore {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.states = new Map();
    this.activeConversationId = null;
  }

  ensureConversation(conversationId, route = "") {
    if (!conversationId) return null;
    const existing = this.states.get(conversationId);
    const state = existing ?? {
      conversationId,
      route,
      turnCount: 0,
      activeTurnId: null,
      captureStatus: { ...DEFAULT_CAPTURE },
      lastUpdated: this.clock()
    };
    if (route) state.route = route;
    if (!existing) this.states.set(conversationId, state);
    return state;
  }

  activateConversation(conversationId, route = "") {
    if (!conversationId) {
      this.activeConversationId = null;
      return null;
    }
    const state = this.ensureConversation(conversationId, route);
    state.lastUpdated = this.clock();
    this.activeConversationId = conversationId;
    return state;
  }

  update(conversationId, patch = {}) {
    const state = this.ensureConversation(conversationId);
    if (!state) return null;
    Object.assign(state, patch, { lastUpdated: this.clock() });
    return state;
  }

  setCaptureStatus(conversationId, captureStatus) {
    return this.update(conversationId, {
      captureStatus: { ...DEFAULT_CAPTURE, ...(captureStatus ?? {}) }
    });
  }

  setActiveTurn(conversationId, activeTurnId) {
    return this.update(conversationId, { activeTurnId: activeTurnId ?? null });
  }

  get(conversationId) {
    return this.states.get(conversationId) ?? null;
  }

  getActive() {
    return this.activeConversationId ? this.get(this.activeConversationId) : null;
  }

  snapshot(conversationId = this.activeConversationId) {
    const state = conversationId ? this.get(conversationId) : null;
    return state ? { ...state, captureStatus: { ...state.captureStatus } } : null;
  }
}

Object.assign(exports, { ConversationStore });

},
"src/v3/core/turn-index.js": (module, exports, __require) => {
const SOURCE_ORDER = ["capture", "dom"];
const FALLBACK_TURN = /^fallback-turn-(\d+)$/;
const LEGACY_TURN = /^turn-index-(\d+)$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class TurnIndex {
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

  replaceDomSnapshot(records = []) {
    const existing = [...this.records.values()];
    if (existing.some((record) => record.source !== "dom")) return false;
    const next = (Array.isArray(records) ? records : []).filter((record) => record?.id);
    if (!next.length) return false;
    this.records.clear();
    this.aliases.clear();
    this.mergeMany(next.map((record) => ({ ...record, source: "dom" })));
    return true;
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

  reassignDomOrders(assignments = []) {
    const normalized = [];
    const ids = new Set();
    const orders = new Set();
    for (const assignment of Array.isArray(assignments) ? assignments : []) {
      const id = String(assignment?.id ?? "").trim();
      const order = Number(assignment?.order);
      if (!id || !Number.isFinite(order) || order < 0 || ids.has(id) || orders.has(order)) return false;
      const record = this.records.get(id);
      if (!record || record.source !== "dom") return false;
      ids.add(id);
      orders.add(order);
      normalized.push({ record, order });
    }
    if (normalized.length < 2) return false;
    for (const { record, order } of normalized) record.order = order;
    return true;
  }

  setAlias(aliasId, canonicalId) {
    const alias = String(aliasId ?? "").trim();
    const canonical = String(canonicalId ?? "").trim();
    if (!alias || !canonical || alias === canonical) return false;
    this.aliases.set(alias, canonical);
    return true;
  }

  replaceLegacyAnchor(aliasId, canonicalId) {
    const alias = String(aliasId ?? "").trim();
    const canonical = String(canonicalId ?? "").trim();
    if (!alias || !canonical || alias === canonical) return false;
    const record = this.records.get(alias);
    if (!record || record.source?.includes("capture")) return false;
    const selfOrder = legacyTurnOrder(alias) ?? fallbackOrder(alias);
    if (selfOrder === null || Number(record.order) !== selfOrder) return false;
    const existing = this.records.get(canonical);
    if (existing && Number(existing.order) !== selfOrder) return false;
    this.aliases.set(alias, canonical);
    this.records.delete(alias);
    return true;
  }
  replaceStaleDomAnchor(aliasId, canonicalId, { order = null, text = "" } = {}) {
    const alias = String(aliasId ?? "").trim();
    const canonical = String(canonicalId ?? "").trim();
    if (!alias || !canonical || alias === canonical || !Number.isFinite(order)) return false;
    const record = this.records.get(alias);
    if (!record || record.source !== "dom" || Number(record.order) !== Number(order)) return false;
    const expectedText = cleanText(text);
    if (!expectedText || cleanText(record.text) !== expectedText) return false;
    const existing = this.records.get(canonical);
    if (existing && (Number(existing.order) !== Number(order) || cleanText(existing.text) !== expectedText)) return false;
    this.aliases.set(alias, canonical);
    this.records.delete(alias);
    return true;
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
      const legacyOrder = legacyTurnOrder(legacyId) ?? fallbackOrder(legacyId);
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

function compareTurns(a, b) {
  return finiteOr(a?.order, Number.MAX_SAFE_INTEGER) - finiteOr(b?.order, Number.MAX_SAFE_INTEGER)
    || String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

function fallbackOrder(id) {
  const match = String(id ?? "").match(FALLBACK_TURN);
  if (!match) return null;
  const order = Number.parseInt(match[1], 10);
  return Number.isFinite(order) ? order : null;
}

function isUuidV7(id) {
  return UUID_V7.test(String(id ?? "").trim());
}

function legacyTurnOrder(id) {
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

Object.assign(exports, { TurnIndex, compareTurns, fallbackOrder, isUuidV7, legacyTurnOrder });

},
"src/v3/core/timeline-state.js": (module, exports, __require) => {
class TimelineState {
  constructor({ maxRailMarkers = 14 } = {}) {
    this.states = new Map();
    this.maxRailMarkers = maxRailMarkers;
  }

  get(conversationId) {
    if (!conversationId) return defaultState(this.maxRailMarkers);
    if (!this.states.has(conversationId)) this.states.set(conversationId, defaultState(this.maxRailMarkers));
    return this.states.get(conversationId);
  }

  update(conversationId, patch) {
    const state = this.get(conversationId);
    Object.assign(state, patch);
    return state;
  }
}

function sampleRailMarkers(turns, activeTurnId, maxMarkers = 14) {
  const ordered = Array.isArray(turns) ? turns : [];
  const limit = Math.max(2, Number(maxMarkers) || 14);
  if (ordered.length <= limit) return [...ordered];

  const indexes = new Set([0, ordered.length - 1]);
  for (let slot = 1; slot < limit - 1; slot += 1) {
    indexes.add(Math.round((slot * (ordered.length - 1)) / (limit - 1)));
  }

  const activeIndex = ordered.findIndex((turn) => turn.id === activeTurnId);
  if (activeIndex >= 0 && !indexes.has(activeIndex)) {
    let replace = null;
    let bestDistance = Infinity;
    for (const index of indexes) {
      if (index === 0 || index === ordered.length - 1) continue;
      const distance = Math.abs(index - activeIndex);
      if (distance < bestDistance) {
        bestDistance = distance;
        replace = index;
      }
    }
    if (replace != null) indexes.delete(replace);
    indexes.add(activeIndex);
  }

  return [...indexes].sort((a, b) => a - b).slice(0, limit).map((index) => ordered[index]);
}

function defaultState(maxRailMarkers) {
  return {
    panelOpen: false,
    manualBrowse: false,
    followActive: true,
    anchorTurnId: null,
    anchorOffset: 0,
    maxRailMarkers
  };
}

Object.assign(exports, { TimelineState, sampleRailMarkers });

},
"src/v3/core/prompt-store.js": (module, exports, __require) => {
class PromptStore {
  constructor({ storage, key = "gte.v3.prompts", clock = () => Date.now(), idFactory = null } = {}) {
    this.storage = storage;
    this.key = key;
    this.clock = clock;
    this.sequence = 0;
    this.idFactory = idFactory ?? (() => `prompt-${this.clock()}-${++this.sequence}`);
  }

  list() {
    const value = this.storage?.read?.(this.key, []);
    if (!Array.isArray(value)) return [];
    return value.map(normalizePrompt).sort(promptSort);
  }

  create({ title, text, favorite = false }) {
    const now = this.clock();
    const item = normalizePrompt({
      id: this.idFactory(),
      title,
      text,
      favorite,
      createdAt: now,
      updatedAt: now
    });
    const next = [...this.list(), item];
    this.#save(next);
    return item;
  }

  update(id, patch = {}) {
    let updated = null;
    const next = this.list().map((item) => {
      if (item.id !== id) return item;
      updated = normalizePrompt({ ...item, ...patch, id: item.id, createdAt: item.createdAt, updatedAt: this.clock() });
      return updated;
    });
    if (updated) this.#save(next);
    return updated;
  }

  remove(id) {
    const current = this.list();
    const next = current.filter((item) => item.id !== id);
    if (next.length === current.length) return false;
    this.#save(next);
    return true;
  }

  toggleFavorite(id) {
    const item = this.list().find((entry) => entry.id === id);
    return item ? this.update(id, { favorite: !item.favorite }) : null;
  }

  search(query) {
    const needle = String(query ?? "").trim().toLocaleLowerCase();
    if (!needle) return this.list();
    return this.list().filter((item) => `${item.title}\n${item.text}`.toLocaleLowerCase().includes(needle));
  }

  #save(items) {
    this.storage?.write?.(this.key, items.map(normalizePrompt));
  }
}

function normalizePrompt(input = {}) {
  return {
    id: String(input.id ?? ""),
    title: String(input.title ?? "").trim() || "未命名提示词",
    text: String(input.text ?? ""),
    favorite: Boolean(input.favorite),
    createdAt: Number(input.createdAt) || 0,
    updatedAt: Number(input.updatedAt) || 0
  };
}

function promptSort(a, b) {
  return Number(b.favorite) - Number(a.favorite)
    || b.updatedAt - a.updatedAt
    || a.title.localeCompare(b.title);
}

Object.assign(exports, { PromptStore });

},
"src/v3/core/settings-store.js": (module, exports, __require) => {
class SettingsStore {
  constructor({ storage, key = "gte.v3.settings" } = {}) {
    this.storage = storage;
    this.key = key;
  }

  load() {
    return { ...DEFAULTS, ...(this.storage?.read?.(this.key, {}) ?? {}) };
  }

  save(patch = {}) {
    const next = { ...this.load(), ...patch };
    this.storage?.write?.(this.key, next);
    return next;
  }
}

const DEFAULTS = Object.freeze({
  timelinePanelOpen: false,
  maxRailMarkers: 14
});

Object.assign(exports, { SettingsStore });

},
"src/v3/core/timeline-cache.js": (module, exports, __require) => {
const TIMELINE_CACHE_KEY = "gpt-talk-enhancer.timeline-cache.v1";
const TIMELINE_CACHE_SCHEMA_VERSION = 1;

class TimelineCache {
  constructor({
    storage,
    key = TIMELINE_CACHE_KEY,
    clock = () => Date.now(),
    maxConversations = 80,
    maxTurnsPerConversation = 1000
  } = {}) {
    this.storage = storage;
    this.key = key;
    this.clock = clock;
    this.maxConversations = maxConversations;
    this.maxTurnsPerConversation = maxTurnsPerConversation;
    this.signatures = new Map();
  }

  load(conversationId) {
    const id = normalizeConversationId(conversationId);
    if (!id) return [];
    const root = this.#readRoot();
    const entry = root.conversations[id];
    if (!entry || !Array.isArray(entry.turns)) return [];
    const turns = normalizeTurns(entry.turns, this.maxTurnsPerConversation);
    if (hasDuplicateOrders(turns)) {
      this.signatures.delete(id);
      return trustedOrderAnchors(turns);
    }
    this.signatures.set(id, turnSignature(turns));
    return turns;
  }

  save(conversationId, turns = []) {
    const id = normalizeConversationId(conversationId);
    if (!id) return false;
    const normalized = normalizeTurns(turns, this.maxTurnsPerConversation);
    if (hasDuplicateOrders(normalized)) return false;
    const signature = turnSignature(normalized);
    if (this.signatures.get(id) === signature) return false;

    const root = this.#readRoot();
    root.conversations[id] = {
      conversationId: id,
      updatedAt: this.clock(),
      turns: normalized
    };
    root.conversations = pruneConversations(root.conversations, this.maxConversations);
    const saved = Boolean(this.storage?.write?.(this.key, root));
    if (saved) this.signatures.set(id, signature);
    return saved;
  }

  getStats() {
    const root = this.#readRoot();
    const entries = Object.values(root.conversations);
    return {
      schemaVersion: TIMELINE_CACHE_SCHEMA_VERSION,
      conversations: entries.length,
      turns: entries.reduce((total, entry) => total + (Array.isArray(entry?.turns) ? entry.turns.length : 0), 0)
    };
  }

  listConversations() {
    const root = this.#readRoot();
    return Object.values(root.conversations)
      .filter((entry) => entry && normalizeConversationId(entry.conversationId))
      .map((entry) => ({
        conversationId: normalizeConversationId(entry.conversationId),
        updatedAt: Number(entry.updatedAt) || 0,
        turns: normalizeTurns(entry.turns, this.maxTurnsPerConversation)
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  #readRoot() {
    const value = this.storage?.read?.(this.key, null);
    if (!value || value.schemaVersion !== TIMELINE_CACHE_SCHEMA_VERSION || !isPlainObject(value.conversations)) {
      return { schemaVersion: TIMELINE_CACHE_SCHEMA_VERSION, conversations: {} };
    }
    return { schemaVersion: TIMELINE_CACHE_SCHEMA_VERSION, conversations: { ...value.conversations } };
  }
}

function normalizeCachedTurn(input = {}) {
  if (!input?.id) return null;
  return {
    id: String(input.id),
    order: Number.isFinite(input.order) ? Number(input.order) : 0,
    text: normalizeWhitespace(input.text),
    shortText: normalizeWhitespace(input.shortText ?? input.text),
    type: String(input.type ?? "text"),
    lastSeen: Number.isFinite(input.lastSeen) ? Number(input.lastSeen) : 0
  };
}

function normalizeTurns(turns, limit) {
  const byId = new Map();
  for (const turn of Array.isArray(turns) ? turns : []) {
    const normalized = normalizeCachedTurn(turn);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Number(limit) || 0));
}

function hasDuplicateOrders(turns) {
  const seen = new Set();
  for (const turn of turns) {
    if (!Number.isFinite(turn?.order)) continue;
    const order = Number(turn.order);
    if (seen.has(order)) return true;
    seen.add(order);
  }
  return false;
}

function trustedOrderAnchors(turns) {
  const byOrder = new Map();
  for (const turn of turns) {
    const order = trustedOrderFromId(turn?.id);
    if (order === null || Number(turn?.order) !== order) continue;
    const current = byOrder.get(order);
    if (!current || /^fallback-turn-\d+$/.test(String(turn.id))) byOrder.set(order, turn);
  }
  return [...byOrder.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function trustedOrderFromId(id) {
  const match = String(id ?? "").match(/^(?:fallback-turn|turn-index)-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function turnSignature(turns) {
  return turns.map((turn) => [turn.id, turn.order, turn.text, turn.shortText, turn.type].join("\u0000")).join("\u0001");
}

function pruneConversations(conversations, limit) {
  const entries = Object.entries(conversations ?? {})
    .filter(([, entry]) => entry && Array.isArray(entry.turns))
    .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))
    .slice(0, Math.max(1, Number(limit) || 1));
  return Object.fromEntries(entries);
}

function normalizeConversationId(value) {
  return String(value ?? "").trim();
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
Object.assign(exports, { TIMELINE_CACHE_KEY, TIMELINE_CACHE_SCHEMA_VERSION, TimelineCache, normalizeCachedTurn });

},
"src/v3/core/work-timeline-cache.js": (module, exports, __require) => {
const WORK_TIMELINE_CACHE_KEY = "gpt-talk-enhancer.timeline-cache.work.v1";
const TIMELINE_CACHE_SCHEMA_VERSION = 1;

class WorkTimelineCache {
  constructor({
    storage,
    key = WORK_TIMELINE_CACHE_KEY,
    clock = () => Date.now(),
    maxConversations = 80,
    maxTurnsPerConversation = 1000
  } = {}) {
    this.storage = storage;
    this.key = key;
    this.clock = clock;
    this.maxConversations = maxConversations;
    this.maxTurnsPerConversation = maxTurnsPerConversation;
    this.signatures = new Map();
  }

  load(conversationId) {
    const id = normalizeConversationId(conversationId);
    if (!id) return [];
    const root = this.#readRoot();
    const entry = root.conversations[id];
    if (!entry || !Array.isArray(entry.turns)) return [];
    const turns = normalizeTurns(entry.turns, this.maxTurnsPerConversation);
    this.signatures.set(id, turnSignature(turns));
    return turns;
  }

  save(conversationId, turns = []) {
    const id = normalizeConversationId(conversationId);
    if (!id) return false;
    const normalized = normalizeTurns(turns, this.maxTurnsPerConversation);
    const signature = turnSignature(normalized);
    if (this.signatures.get(id) === signature) return false;

    const root = this.#readRoot();
    root.conversations[id] = {
      conversationId: id,
      updatedAt: this.clock(),
      turns: normalized
    };
    root.conversations = pruneConversations(root.conversations, this.maxConversations);
    const saved = Boolean(this.storage?.write?.(this.key, root));
    if (saved) this.signatures.set(id, signature);
    return saved;
  }

  getStats() {
    const root = this.#readRoot();
    const entries = Object.values(root.conversations);
    return {
      schemaVersion: TIMELINE_CACHE_SCHEMA_VERSION,
      conversations: entries.length,
      turns: entries.reduce((total, entry) => total + (Array.isArray(entry?.turns) ? entry.turns.length : 0), 0)
    };
  }

  #readRoot() {
    const value = this.storage?.read?.(this.key, null);
    if (!value || value.schemaVersion !== TIMELINE_CACHE_SCHEMA_VERSION || !isPlainObject(value.conversations)) {
      return { schemaVersion: TIMELINE_CACHE_SCHEMA_VERSION, conversations: {} };
    }
    return { schemaVersion: TIMELINE_CACHE_SCHEMA_VERSION, conversations: { ...value.conversations } };
  }
}

function normalizeCachedTurn(input = {}) {
  if (!input?.id) return null;
  return {
    id: String(input.id),
    order: Number.isFinite(input.order) ? Number(input.order) : 0,
    text: normalizeWhitespace(input.text),
    shortText: normalizeWhitespace(input.shortText ?? input.text),
    type: String(input.type ?? "text"),
    lastSeen: Number.isFinite(input.lastSeen) ? Number(input.lastSeen) : 0
  };
}

function normalizeTurns(turns, limit) {
  const byId = new Map();
  for (const turn of Array.isArray(turns) ? turns : []) {
    const normalized = normalizeCachedTurn(turn);
    if (normalized) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Number(limit) || 0));
}

function turnSignature(turns) {
  return turns.map((turn) => [turn.id, turn.order, turn.text, turn.shortText, turn.type].join("\u0000")).join("\u0001");
}

function pruneConversations(conversations, limit) {
  const entries = Object.entries(conversations ?? {})
    .filter(([, entry]) => entry && Array.isArray(entry.turns))
    .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))
    .slice(0, Math.max(1, Number(limit) || 1));
  return Object.fromEntries(entries);
}

function normalizeConversationId(value) {
  return String(value ?? "").trim();
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
Object.assign(exports, { WORK_TIMELINE_CACHE_KEY, TIMELINE_CACHE_SCHEMA_VERSION, WorkTimelineCache, normalizeCachedTurn });

},
"src/v3/core/question-display.js": (module, exports, __require) => {
const REQUEST_LABEL = /^(?:my request|request|\u6211\u7684\u8bf7\u6c42|\u6211\u7684\u95ee\u9898)$/i;
const WRAPPER_LABEL = /^(?:selected text|selection\s+\d+)$/i;

function normalizeQuestionDisplayText(value) {
  const raw = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return "";

  const request = extractRequestSection(raw);
  const candidate = request || stripWrapperLabels(raw);
  const cleaned = cleanMarkdownNoise(candidate);
  if (cleaned) return cleaned;

  return collapseWhitespace(stripWrapperLabels(raw)) || collapseWhitespace(raw);
}

function extractRequestSection(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  let matchIndex = -1;
  let inline = "";
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseLabelLine(lines[index]);
    if (!parsed || !REQUEST_LABEL.test(parsed.label)) continue;
    matchIndex = index;
    inline = parsed.rest;
  }
  if (matchIndex < 0) return "";
  return [inline, ...lines.slice(matchIndex + 1)].filter(Boolean).join("\n").trim();
}

function stripWrapperLabels(value) {
  return String(value ?? "")
    .split("\n")
    .filter((line) => {
      const parsed = parseLabelLine(line);
      if (parsed && WRAPPER_LABEL.test(parsed.label)) return false;
      const heading = String(line ?? "").match(/^\s*#{1,6}\s+(.+?)\s*$/);
      return !(heading && WRAPPER_LABEL.test(heading[1].trim()));
    })
    .join("\n");
}

function parseLabelLine(line) {
  const match = String(line ?? "").match(/^\s*(?:#{1,6}\s*)?([^:\uFF1A]+)[:\uFF1A]\s*(.*)$/);
  if (!match) return null;
  return { label: match[1].trim(), rest: match[2].trim() };
}

function cleanMarkdownNoise(value) {
  return collapseWhitespace(
    String(value ?? "")
      .replace(/```[\s\S]*?```/g, " [code] ")
      .replace(/~~~[\s\S]*?~~~/g, " [code] ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/gi, "$1")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+[.)]\s+/gm, "")
      .replace(/`([^`]+)`/g, "$1")
  );
}

function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
Object.assign(exports, { normalizeQuestionDisplayText, extractRequestSection });

},
"src/v3/host/host-interface.js": (module, exports, __require) => {
const SURFACE = Object.freeze({
  NEW_CHAT: "NEW_CHAT",
  CONVERSATION: "CONVERSATION",
  MEDIA_VIEWER: "MEDIA_VIEWER",
  SETTINGS: "SETTINGS",
  PLUGIN_MANAGER: "PLUGIN_MANAGER",
  OTHER: "OTHER"
});

class HostInterface {
  getSurface() { return SURFACE.OTHER; }
  getConversationId() { return null; }
  getConversationIdentity() { return null; }
  getVisibleTurns() { return []; }
  resolveTurn(_turnId) { return null; }
  navigateToTurn(_turnId, _context) { return Promise.resolve({ ok: false, reason: "not-implemented" }); }
  notifyNavigationIntent() { return false; }
  getComposer() { return null; }
  getComposerRect() { return null; }
  getConversationViewportElement() { return null; }
  getConversationViewportRect() { return null; }
  insertPrompt(_text) { return { ok: false, reason: "not-implemented" }; }
  isMediaViewerOpen() { return false; }
  getCompatibilityReport() { return null; }
  getNavigationCompatibility() { return null; }
  getTheme() { return "dark"; }
  destroy() {}
}

Object.assign(exports, { SURFACE, HostInterface });

},
"src/v3/host/codex-desktop/conversation-adapter.js": (module, exports, __require) => {
const CHATGPT_CONVERSATION_PREFIX = "chatgpt:conversation:";
const STABLE_LOCAL_THREAD = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseSidebarConversationKey(value) {
  const key = String(value ?? "").trim();
  if (!key) return null;
  if (key.startsWith(CHATGPT_CONVERSATION_PREFIX)) {
    return key.slice(CHATGPT_CONVERSATION_PREFIX.length) || null;
  }
  return key;
}

function isStableLocalThreadIdentity(value, { host = "", kind = "" } = {}) {
  return String(host).toLowerCase() === "local"
    && String(kind).toLowerCase() === "local"
    && STABLE_LOCAL_THREAD.test(String(value ?? "").trim());
}

class ConversationAdapter {
  constructor({ document, window } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.inferredChatConversationId = null;
  }

  getConversationId() {
    return this.getConversationIdentity()?.id ?? null;
  }

  setInferredChatConversationId(value) {
    const raw = String(value ?? "").trim();
    const id = raw && !raw.startsWith("local:") ? parseSidebarConversationKey(raw) : raw;
    this.inferredChatConversationId = id || null;
    return Boolean(this.inferredChatConversationId);
  }

  clearInferredChatConversationId() {
    const changed = Boolean(this.inferredChatConversationId);
    this.inferredChatConversationId = null;
    return changed;
  }

  getDirectConversationIdentity() {
    const pathname = String(this.window?.location?.pathname ?? "");
    const routeMatch = pathname.match(/\/(?:c|conversation|chat)\/([^/?#]+)/i);
    if (routeMatch?.[1]) {
      return { id: decodeURIComponent(routeMatch[1]), source: "route", host: "chatgpt", kind: "conversation", stable: true };
    }

    const selectedLocal = this.getSelectedLocalThreadRow();
    const localId = selectedLocal?.getAttribute?.("data-app-action-sidebar-thread-id");
    const host = selectedLocal?.getAttribute?.("data-app-action-sidebar-thread-host-id") ?? "";
    const kind = selectedLocal?.getAttribute?.("data-app-action-sidebar-thread-kind") ?? "";
    if (isStableLocalThreadIdentity(localId, { host, kind })) {
      return { id: String(localId), source: "sidebar-local", host: "local", kind: "local", stable: true };
    }

    const selectedChatgpt = this.getSelectedChatgptConversationId();
    if (selectedChatgpt) {
      return { id: selectedChatgpt, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
    }

    const explicit = this.document?.querySelector?.("[data-conversation-id], [data-thread-id]");
    const explicitId = explicit?.getAttribute?.("data-conversation-id")
      || explicit?.getAttribute?.("data-thread-id")
      || null;
    return explicitId
      ? { id: String(explicitId), source: "dom-explicit", host: null, kind: null, stable: false }
      : null;
  }

  getConversationIdentity() {
    const direct = this.getDirectConversationIdentity();
    if (direct?.stable) return direct;
    if (this.inferredChatConversationId && this.hasVisibleConversationContent()) {
      return {
        id: this.inferredChatConversationId,
        source: "inferred-visible-chat",
        host: "chatgpt",
        kind: "conversation",
        stable: true
      };
    }
    return direct;
  }

  getSelectedLocalThreadRow() {
    return this.document?.querySelector?.(
      "[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected='true'], [data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active='true']"
    ) ?? null;
  }

  getSelectedChatgptConversationId() {
    const rows = this.document?.querySelectorAll?.("[data-sidebar-chatgpt-conversation-key]") ?? [];
    for (const row of rows) {
      const selected = row?.getAttribute?.("aria-current") === "page"
        || Boolean(row?.querySelector?.("[aria-current='page']"));
      if (!selected) continue;
      const value = row?.getAttribute?.("data-sidebar-chatgpt-conversation-key");
      const parsed = parseSidebarConversationKey(value);
      if (parsed) return parsed;
    }
    return null;
  }

  getRoute() {
    const location = this.window?.location;
    return `${location?.pathname ?? ""}${location?.search ?? ""}${location?.hash ?? ""}`;
  }

  getStableConversationRoot() {
    return this.document?.querySelector?.("[data-thread-find-target='conversation']")
      ?? this.document?.querySelector?.("[data-chatgpt-conversation-selection-target='true']")
      ?? this.document?.querySelector?.("main [data-testid='conversation-turn-list']")
      ?? null;
  }

  isVisibleConversationRoot(root) {
    if (!root || root.isConnected === false || root.hidden === true) return false;
    const style = this.window?.getComputedStyle?.(root);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    const rect = root.getBoundingClientRect?.();
    return !rect || (Number(rect.width) > 0 && Number(rect.height) > 0);
  }

  hasVisibleConversationContent() {
    const root = this.getStableConversationRoot();
    if (!this.isVisibleConversationRoot(root)) return false;
    return Boolean(this.document?.querySelector?.(
      "[data-markdown-text-tone='user-message'], [data-turn-key], [data-content-search-turn-key], [data-turn-id], [data-turn-id-container]"
    ));
  }

  getConversationRoot() {
    return this.getStableConversationRoot()
      ?? this.document?.querySelector?.("main")
      ?? null;
  }

  getScrollContainer() {
    const root = this.getConversationRoot();
    let node = root;
    while (node && node !== this.document?.body) {
      const style = this.window?.getComputedStyle?.(node);
      const overflowY = style?.overflowY ?? "";
      if ((overflowY === "auto" || overflowY === "scroll") && Number(node.scrollHeight) > Number(node.clientHeight)) return node;
      node = node.parentElement;
    }
    return this.document?.scrollingElement ?? this.document?.documentElement ?? this.document?.body ?? null;
  }
}

Object.assign(exports, { parseSidebarConversationKey, isStableLocalThreadIdentity, ConversationAdapter });

},
"src/v3/host/codex-desktop/turn-adapter.js": (module, exports, __require) => {
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

class TurnAdapter {
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

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/[\\"\]\[]/g, "\\$&");
}

const TURN_ID_PRIORITY = Object.freeze([...TURN_ID_ATTRIBUTES]);

Object.assign(exports, { TurnAdapter, cssEscape, TURN_ID_PRIORITY });

},
"src/v3/host/codex-desktop/work-turn-adapter.js": (module, exports, __require) => {
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

class WorkTurnAdapter {
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

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
  return String(value).replace(/[\\"\]\[]/g, "\\$&");
}

const TURN_ID_PRIORITY = Object.freeze([...TURN_ID_ATTRIBUTES]);

Object.assign(exports, { WorkTurnAdapter, cssEscape, TURN_ID_PRIORITY });

},
"src/v3/host/codex-desktop/composer-adapter.js": (module, exports, __require) => {
class ComposerAdapter {
  constructor({ document, window } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
  }

  getComposer() {
    return this.document?.querySelector?.("#prompt-textarea")
      ?? this.document?.querySelector?.("textarea[placeholder]")
      ?? this.document?.querySelector?.("[contenteditable='true'][role='textbox']")
      ?? null;
  }

  getComposerForm() {
    const composer = this.getComposer();
    if (!composer) return null;
    const composerRect = composer.getBoundingClientRect?.() ?? null;
    const form = composer.closest?.("form") ?? null;
    if (form && isUsableComposerAnchor(form.getBoundingClientRect?.() ?? null, composerRect)) return form;
    const parent = composer.parentElement ?? null;
    if (parent && isUsableComposerAnchor(parent.getBoundingClientRect?.() ?? null, composerRect)) return parent;
    return composer;
  }

  getComposerRect() {
    const composer = this.getComposer();
    if (!composer) return null;
    const composerRect = composer.getBoundingClientRect?.() ?? null;
    const anchor = this.getComposerForm();
    const anchorRect = anchor?.getBoundingClientRect?.() ?? null;
    return isUsableComposerAnchor(anchorRect, composerRect) ? anchorRect : composerRect;
  }

  insertText(text) {
    const composer = this.getComposer();
    if (!composer) return { ok: false, reason: "composer-not-found" };
    const insertion = String(text ?? "");
    if (!insertion) return { ok: false, reason: "empty-prompt" };
    const before = readComposerText(composer);
    composer.focus?.();
    const inserted = isTextControl(composer)
      ? insertIntoTextControl(composer, insertion)
      : insertIntoEditable(composer, insertion, this.document, this.window);
    if (inserted) dispatchInput(composer, this.window);
    const after = readComposerText(composer);
    const ok = inserted && after !== before && after.includes(insertion);
    return { ok, reason: ok ? "inserted" : "readback-failed", before, after };
  }
}

function readComposerText(composer) {
  if (!composer) return "";
  if (isTextControl(composer)) return String(composer.value ?? "");
  return String(composer.innerText ?? composer.textContent ?? "");
}

function isTextControl(element) {
  return element && "value" in element && typeof element.value === "string";
}

function insertIntoTextControl(composer, insertion) {
  const start = Number.isFinite(composer.selectionStart) ? composer.selectionStart : composer.value.length;
  const end = Number.isFinite(composer.selectionEnd) ? composer.selectionEnd : start;
  composer.value = `${composer.value.slice(0, start)}${insertion}${composer.value.slice(end)}`;
  try { composer.selectionStart = composer.selectionEnd = start + insertion.length; } catch {}
  return true;
}

function insertIntoEditable(composer, insertion, documentRef, windowRef) {
  const selection = windowRef?.getSelection?.();
  let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !composer.contains?.(range.commonAncestorContainer)) {
    range = documentRef?.createRange?.();
    if (!range) return false;
    range.selectNodeContents?.(composer);
    range.collapse?.(false);
  }
  range.deleteContents?.();
  const node = documentRef?.createTextNode?.(insertion);
  if (!node) return false;
  range.insertNode?.(node);
  range.setStartAfter?.(node);
  range.collapse?.(true);
  selection?.removeAllRanges?.();
  selection?.addRange?.(range);
  return true;
}

function dispatchInput(composer, windowRef) {
  const EventCtor = windowRef?.InputEvent ?? windowRef?.Event;
  if (!EventCtor) return;
  composer.dispatchEvent?.(new EventCtor("input", { bubbles: true }));
}

function isUsableComposerAnchor(anchorRect, composerRect) {
  if (!isFiniteRect(anchorRect) || !isFiniteRect(composerRect)) return false;
  const composerHeight = Math.max(1, Number(composerRect.height) || Number(composerRect.bottom) - Number(composerRect.top) || 1);
  const anchorHeight = Math.max(0, Number(anchorRect.height) || Number(anchorRect.bottom) - Number(anchorRect.top) || 0);
  const topGap = Math.abs(Number(anchorRect.top) - Number(composerRect.top));
  const bottomGap = Math.abs(Number(anchorRect.bottom) - Number(composerRect.bottom));
  const maxHeight = Math.max(240, composerHeight * 6);
  return anchorHeight <= maxHeight && topGap <= 160 && bottomGap <= 180;
}

function isFiniteRect(rect) {
  if (!rect) return false;
  return [rect.left, rect.top, rect.right, rect.bottom].every((value) => Number.isFinite(Number(value)));
}

Object.assign(exports, { ComposerAdapter, readComposerText });

},
"src/v3/host/codex-desktop/overlay-detector.js": (module, exports, __require) => {
class OverlayDetector {
  constructor({ document } = {}) {
    this.document = document ?? globalThis.document;
  }

  isMediaViewerOpen() {
    const selectors = [
      "[data-testid='modal-image-viewer']",
      "[data-testid*='image-viewer']",
      "[role='dialog'] [data-testid*='image']",
      "[role='dialog'] img[src^='blob:']"
    ];
    return selectors.some((selector) => Boolean(this.document?.querySelector?.(selector)));
  }

  isBlockingDialogOpen() {
    const selectors = ["[role='dialog']", "[aria-modal='true']"];
    for (const selector of selectors) {
      const nodes = Array.from(this.document?.querySelectorAll?.(selector) ?? []);
      for (const node of nodes) {
        if (!isVisibleHostOverlay(node)) continue;
        return true;
      }
    }
    return false;
  }

  isPromptFloatingLayerOpen({ composerRect = null } = {}) {
    if (!isFiniteRect(composerRect)) return false;
    const promptZone = {
      left: Number(composerRect.left) - 56,
      top: Number(composerRect.top) - 240,
      right: Number(composerRect.right) + 24,
      bottom: Number(composerRect.bottom) + 24
    };
    const selectors = [
      "[data-radix-popper-content-wrapper]",
      "[role='menu']",
      "[role='listbox']",
      "[role='tooltip']"
    ];
    for (const selector of selectors) {
      const nodes = Array.from(this.document?.querySelectorAll?.(selector) ?? []);
      for (const node of nodes) {
        if (!isVisibleHostOverlay(node)) continue;
        const rect = node.getBoundingClientRect?.() ?? null;
        if (rectsIntersect(promptZone, rect)) return true;
      }
    }
    return false;
  }
}
function isVisibleHostOverlay(node) {
  if (!node || node.hidden === true) return false;
  if (String(node.getAttribute?.("aria-hidden") ?? "").toLowerCase() === "true") return false;
  if (node.closest?.("#gte-root")) return false;
  const rect = node.getBoundingClientRect?.() ?? null;
  if (!isFiniteRect(rect)) return false;
  const width = Number(rect.width) || Number(rect.right) - Number(rect.left);
  const height = Number(rect.height) || Number(rect.bottom) - Number(rect.top);
  return width > 0 && height > 0;
}

function isFiniteRect(rect) {
  if (!rect) return false;
  return [rect.left, rect.top, rect.right, rect.bottom].every((value) => Number.isFinite(Number(value)));
}

function rectsIntersect(a, b) {
  if (!isFiniteRect(a) || !isFiniteRect(b)) return false;
  return Number(a.left) < Number(b.right)
    && Number(a.right) > Number(b.left)
    && Number(a.top) < Number(b.bottom)
    && Number(a.bottom) > Number(b.top);
}

Object.assign(exports, { OverlayDetector });

},
"src/v3/host/codex-desktop/surface-detector.js": (module, exports, __require) => {
const { SURFACE } = __require("src/v3/host/host-interface.js");

class SurfaceDetector {
  constructor({ document, window, conversationAdapter, overlayDetector } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.conversationAdapter = conversationAdapter;
    this.overlayDetector = overlayDetector;
  }

  getSurface() {
    if (this.overlayDetector?.isMediaViewerOpen?.()) return SURFACE.MEDIA_VIEWER;
    const route = String(this.window?.location?.pathname ?? "").toLowerCase();
    if (/(^|\/)settings?(\/|$)/.test(route)) return SURFACE.SETTINGS;
    if (/(^|\/)(plugins?|skills?|mcp)(\/|$)/.test(route)) return SURFACE.PLUGIN_MANAGER;
    if (this.conversationAdapter?.getConversationId?.()) return SURFACE.CONVERSATION;
    if (this.conversationAdapter?.hasVisibleConversationContent?.()) return SURFACE.CONVERSATION;
    if (this.document?.querySelector?.("#prompt-textarea")
      ?? this.document?.querySelector?.("[contenteditable='true'][role='textbox']")) return SURFACE.NEW_CHAT;
    return SURFACE.OTHER;
  }
}

Object.assign(exports, { SurfaceDetector });

},
"src/v3/host/codex-desktop/conversation-capture.js": (module, exports, __require) => {
const CAPTURE_OWNER_KEY = "__GPTTalkEnhancerV3CaptureOwner";
const CONVERSATION_PATH = /^\/backend-api\/conversation\/([^/?#]+)\/?$/;

class ConversationCapture {
  constructor({ window, onCapture, onStatus } = {}) {
    this.window = window ?? globalThis.window;
    this.onCapture = onCapture ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.originalFetch = null;
    this.wrapper = null;
    this.installed = false;
  }

  install() {
    const win = this.window;
    if (!win || typeof win.fetch !== "function") {
      this.onStatus({ status: "unavailable", lastError: "fetch-unavailable" });
      return false;
    }
    win[CAPTURE_OWNER_KEY]?.dispose?.();
    this.originalFetch = win.fetch;
    const owner = this;
    this.wrapper = function gteConversationFetch(input, init) {
      const pending = owner.originalFetch.call(this, input, init);
      Promise.resolve(pending).then((response) => owner.inspect(input, init, response)).catch(() => {});
      return pending;
    };
    win.fetch = this.wrapper;
    win[CAPTURE_OWNER_KEY] = { dispose: () => this.dispose() };
    this.installed = true;
    this.onStatus({ status: "active", lastError: "" });
    return true;
  }

  inspect(input, init, response) {
    const match = matchConversationRequest(input, init, this.window?.location?.href);
    if (!match || !response?.clone) return;
    let clone;
    try { clone = response.clone(); } catch { return; }
    Promise.resolve(clone.json()).then((payload) => {
      const turns = parseConversationPayload(payload);
      this.onCapture({ conversationId: match.conversationId, turns, payload });
      this.onStatus({ status: "active", turnCount: turns.length, lastError: "" });
    }).catch((error) => {
      this.onStatus({ status: "degraded", lastError: String(error?.message ?? error) });
    });
  }

  dispose() {
    if (!this.installed) return;
    if (this.window?.fetch === this.wrapper && this.originalFetch) this.window.fetch = this.originalFetch;
    if (this.window?.[CAPTURE_OWNER_KEY]?.dispose) delete this.window[CAPTURE_OWNER_KEY];
    this.installed = false;
    this.wrapper = null;
    this.originalFetch = null;
  }
}

function matchConversationRequest(input, init = {}, baseUrl = "https://chatgpt.com/") {
  const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
  if (method !== "GET") return null;
  const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
  if (!rawUrl) return null;
  let url;
  try { url = new URL(rawUrl, baseUrl); } catch { return null; }
  const match = url.pathname.match(CONVERSATION_PATH);
  return match ? { conversationId: decodeURIComponent(match[1]), url: url.href } : null;
}

function parseConversationPayload(payload) {
  const mapping = payload?.mapping;
  const currentNode = payload?.current_node;
  if (!mapping || typeof mapping !== "object" || !currentNode) return [];
  const branch = [];
  const visited = new Set();
  let nodeId = currentNode;
  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = mapping[nodeId];
    if (!node) break;
    branch.push(node);
    nodeId = node.parent ?? null;
  }
  branch.reverse();
  const turns = [];
  for (const node of branch) {
    const message = node?.message;
    if (message?.author?.role !== "user") continue;
    const text = extractVisibleText(message?.content);
    if (!text) continue;
    turns.push({
      id: String(node.id ?? message.id ?? ""),
      order: turns.length,
      text,
      type: "text",
      source: "capture",
      visible: false,
      lastSeen: Date.now()
    });
  }
  return turns.filter((turn) => turn.id);
}

function extractVisibleText(content) {
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = [];
  for (const part of parts) {
    if (typeof part === "string") text.push(part);
    else if (part && typeof part === "object" && typeof part.text === "string") text.push(part.text);
  }
  return text.join("\n").replace(/\s+/g, " ").trim();
}

Object.assign(exports, { ConversationCapture, matchConversationRequest, parseConversationPayload, extractVisibleText });

},
"src/v3/core/scroll-model.js": (module, exports, __require) => {
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function getMaxLogicalPosition(scrollHeight, clientHeight) {
  return Math.max(0, Number(scrollHeight || 0) - Number(clientHeight || 0));
}

function logicalFromScrollTop(scrollTop, maxLogicalPosition, isColumnReverse) {
  const max = Math.max(0, Number(maxLogicalPosition || 0));
  const physical = Number(scrollTop || 0);
  return isColumnReverse
    ? clamp(max + physical, 0, max)
    : clamp(physical, 0, max);
}

function scrollTopFromLogical(logicalPosition, maxLogicalPosition, isColumnReverse) {
  const max = Math.max(0, Number(maxLogicalPosition || 0));
  const logical = clamp(Number(logicalPosition || 0), 0, max);
  return isColumnReverse ? logical - max : logical;
}

function createScrollModel({ scrollTop = 0, scrollHeight = 0, clientHeight = 0, flexDirection = "column" } = {}) {
  const isColumnReverse = flexDirection === "column-reverse";
  const maxLogicalPosition = getMaxLogicalPosition(scrollHeight, clientHeight);
  return Object.freeze({
    scrollTop: Number(scrollTop || 0),
    scrollHeight: Number(scrollHeight || 0),
    clientHeight: Number(clientHeight || 0),
    flexDirection,
    isColumnReverse,
    minLogicalPosition: 0,
    maxLogicalPosition,
    logicalPosition: logicalFromScrollTop(scrollTop, maxLogicalPosition, isColumnReverse)
  });
}

Object.assign(exports, { clamp, getMaxLogicalPosition, logicalFromScrollTop, scrollTopFromLogical, createScrollModel });

},
"src/v3/host/codex-desktop/navigation-adapter.js": (module, exports, __require) => {
const { clamp, createScrollModel, scrollTopFromLogical } = __require("src/v3/core/scroll-model.js");

const FALLBACK_TURN = /^fallback-turn-(\d+)$/;
const NAVIGATION_TRACE_LIMIT = 16;
const HYDRATION_ATTRIBUTES = [
  "data-turn-key",
  "data-content-search-turn-key",
  "data-turn-id",
  "data-turn-id-container"
];

class NavigationAdapter {
  constructor({
    window,
    turnAdapter,
    conversationAdapter,
    activationOffset = 120,
    maxHydrationSteps = 256,
    maxConsecutiveStalls = 4,
    hydrationWaitMs = 900,
    workWheelStepPx = 720,
    workWheelWaitMs = 120,
    inactivityNavigationMs = 5000,
    absoluteMaxNavigationMs = 45000,
    maxNavigationMs = null,
    motionProgressWaitMs = 45,
    chatMotionProgressWaitMs = 8,
    chatEarlierJumpScale = 1.35,
    chatBoundaryHydrationWaitMs = 1800,
    maxAlignFrames = 8,
    postSettleWaitMs = 160,
    mountedFastSettleWaitMs = 120,
    maxPostSettleCorrections = 2
  } = {}) {
    this.window = window ?? globalThis.window;
    this.turnAdapter = turnAdapter;
    this.conversationAdapter = conversationAdapter;
    this.activationOffset = activationOffset;
    this.maxHydrationSteps = maxHydrationSteps;
    this.maxConsecutiveStalls = maxConsecutiveStalls;
    this.hydrationWaitMs = hydrationWaitMs;
    this.workWheelStepPx = workWheelStepPx;
    this.workWheelWaitMs = workWheelWaitMs;
    this.inactivityNavigationMs = inactivityNavigationMs;
    this.absoluteMaxNavigationMs = Number.isFinite(maxNavigationMs)
      ? Number(maxNavigationMs)
      : Number(absoluteMaxNavigationMs);
    this.motionProgressWaitMs = motionProgressWaitMs;
    this.chatMotionProgressWaitMs = chatMotionProgressWaitMs;
    this.chatEarlierJumpScale = Math.max(1, Number(chatEarlierJumpScale) || 1);
    this.chatBoundaryHydrationWaitMs = Math.max(this.hydrationWaitMs, Number(chatBoundaryHydrationWaitMs) || 0);
    this.maxAlignFrames = maxAlignFrames;
    this.postSettleWaitMs = postSettleWaitMs;
    this.mountedFastSettleWaitMs = mountedFastSettleWaitMs;
    this.maxPostSettleCorrections = maxPostSettleCorrections;
    this.compatibility = createNavigationCompatibility();
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true, allowMountedFastSettle = false, onTraceStep = null } = {}) {
    const steps = [];
    const finish = (result) => ({ ...result, steps: steps.slice() });
    const recordStep = (entry) => {
      steps.push(entry);
      if (steps.length > NAVIGATION_TRACE_LIMIT) steps.splice(0, steps.length - NAVIGATION_TRACE_LIMIT);
      try { onTraceStep?.(entry, steps.slice()); } catch {}
    };
    if (!turnId) return finish(failure("missing-turn-id", turnId));
    if (!isCurrent()) return finish(failure("superseded", turnId));
    const readTurns = () => {
      try {
        const current = typeof getTurns === "function" ? getTurns() : turns;
        return Array.isArray(current) ? current : turns;
      } catch {
        return turns;
      }
    };
    const getIndexState = () => createNavigationIndex(turnId, readTurns());
    let indexState = getIndexState();
    if (indexState.targetIndex < 0) return finish(failure("unknown-turn", turnId));

    const container = this.conversationAdapter.getScrollContainer();
    if (!container) return finish(failure("missing-scroll-container", turnId));
    const isNavigationCurrent = () => isCurrent() && this.conversationAdapter.getScrollContainer() === container;
    if (!isNavigationCurrent()) return finish(failure("superseded", turnId));

    this.compatibility = createNavigationCompatibility();
    const startedAt = nowMs(this.window);
    let lastProgressAt = startedAt;
    let probes = 0;
    let consecutiveStalls = 0;
    let workCompatibilityNotified = false;
    let chatBoundaryWaitAvailable = true;
    let chatDirectionHint = null;
    let snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    let candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    const readTargetOrder = () => getIndexState().targetOrder;
    const readMaxKnownOrder = () => getIndexState().maxKnownOrder;
    if (candidate) {
      lastProgressAt = nowMs(this.window);
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder, {
        mountedFastSettle: Boolean(allowMountedFastSettle)
      });
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
      indexState = getIndexState();
      snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    }

    const conversationIdentity = this.conversationAdapter.getConversationIdentity?.() ?? null;
    const allowFirstTurnProbeOverrun = conversationIdentity?.host === "chatgpt" && indexState.targetOrder === 0;

    while ((probes < this.maxHydrationSteps || allowFirstTurnProbeOverrun)
      && nowMs(this.window) - startedAt < this.absoluteMaxNavigationMs) {
      const loopNow = nowMs(this.window);
      if (loopNow - lastProgressAt >= this.inactivityNavigationMs) {
        return finish(this.navigationFailure("navigation-inactive", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
          inactiveMs: Math.round(loopNow - lastProgressAt)
        }));
      }
      if (!isNavigationCurrent()) return finish(failure("superseded", turnId));

      const refreshedIndex = getIndexState();
      if (refreshedIndex.targetIndex < 0) return finish(failure("unknown-turn", turnId));
      if (refreshedIndex.signature !== indexState.signature) {
        indexState = refreshedIndex;
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
      } else {
        indexState = refreshedIndex;
      }
      const { targetOrder, orderById, maxKnownOrder } = indexState;

      candidate = this.resolveCandidate(turnId, targetOrder);
      if (candidate) {
        lastProgressAt = nowMs(this.window);
        const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
        consecutiveStalls = 0;
        indexState = getIndexState();
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        continue;
      }

      const model = readScrollModel(container, this.window);
      const visibleOrders = this.readVisibleOrders(orderById);
      const currentSnapshot = this.readHydrationSnapshot(container, targetOrder, orderById);
      let direction = chooseHydrationDirection(targetOrder, visibleOrders, model);
      if (conversationIdentity?.host === "chatgpt") {
        if (visibleOrders.length === 0 && (chatDirectionHint === -1 || chatDirectionHint === 1)) {
          direction = chatDirectionHint;
        } else if (direction === -1 || direction === 1) {
          chatDirectionHint = direction;
        }
      }
      if (hasHydrationProgress(targetOrder, snapshot, currentSnapshot, direction)) {
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
      }
      snapshot = currentSnapshot;

      const targetBeforeVisible = visibleOrders.length > 0
        ? targetOrder < visibleOrders[0]
        : conversationIdentity?.host === "chatgpt" && direction < 0 && chatDirectionHint === -1;
      const localWorkEarlier = conversationIdentity?.host === "local"
        && conversationIdentity?.source === "sidebar-local"
        && model.isColumnReverse
        && direction < 0
        && targetBeforeVisible;

      if (localWorkEarlier) {
        if (!workCompatibilityNotified) {
          workCompatibilityNotified = true;
          this.notifyCodexPlusScrollIntent(container, isNavigationCurrent);
        }
        const stepStartedAt = nowMs(this.window);
        const outcome = await this.performWorkWheelHydrationStep({
          turnId,
          targetOrder,
          previousSnapshot: currentSnapshot,
          container,
          isCurrent: isNavigationCurrent,
          orderById,
          turnCount: indexState.turns.length,
          getIndexState
        });
        recordStep(createNavigationTraceStep({
          mode: "work-wheel",
          direction: -1,
          elapsedMs: nowMs(this.window) - stepStartedAt,
          jumpPx: outcome.step,
          waitMs: outcome.waitMs,
          targetOrder,
          before: currentSnapshot,
          after: outcome.snapshot,
          outcome
        }));
        if (outcome.state === "superseded") return finish(failure("superseded", turnId));
        probes += outcome.moved ? 1 : 0;
        const nextIndex = getIndexState();
        if (nextIndex.signature !== indexState.signature) {
          lastProgressAt = nowMs(this.window);
          consecutiveStalls = 0;
        }
        indexState = nextIndex;
        snapshot = outcome.snapshot ?? this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        if (outcome.candidate) {
          lastProgressAt = nowMs(this.window);
          const aligned = await this.verifyAndAlign(turnId, outcome.candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
          consecutiveStalls = 0;
          indexState = getIndexState();
          snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
          continue;
        }
        if (outcome.progressed || outcome.moved) {
          consecutiveStalls = 0;
          lastProgressAt = nowMs(this.window);
          continue;
        }
        return finish(this.navigationFailure("work-wheel-stalled", turnId, {
          probes, stalls: 1, container, startedAt, getIndexState
        }));
      }

      const computedJump = hydrationStepSize(model, visibleOrders, targetOrder);
      const nudgeScale = consecutiveStalls > 0 ? 0.42 : 1;
      const hostJumpScale = hydrationJumpScale({
        host: conversationIdentity?.host,
        direction,
        targetBeforeVisible,
        targetDistance: currentSnapshot.targetDistance,
        chatEarlierJumpScale: this.chatEarlierJumpScale
      });
      const baseJump = computedJump * nudgeScale * hostJumpScale;
      const coalescedJump = chatFarCoalescedJump({
        baseJump,
        host: conversationIdentity?.host,
        direction,
        targetBeforeVisible,
        targetDistance: currentSnapshot.targetDistance,
        logicalPosition: model.logicalPosition,
        minLogicalPosition: model.minLogicalPosition,
        stalled: consecutiveStalls > 0
      });
      const jump = Math.max(
        Math.min(coalescedJump.jumpPx, model.maxLogicalPosition || computedJump),
        Math.min(180, model.clientHeight || 180)
      );
      const regularNextLogical = clamp(
        model.logicalPosition + direction * jump,
        model.minLogicalPosition,
        model.maxLogicalPosition
      );
      const endpointLogical = model.isColumnReverse && targetOrder === maxKnownOrder && direction > 0
        ? model.maxLogicalPosition
        : null;
      const nextLogical = endpointLogical == null ? regularNextLogical : endpointLogical;
      const remainingJumpPx = Math.abs(nextLogical - model.logicalPosition);
      const moved = remainingJumpPx >= 1;
      const chatEarlierBoundary = chatBoundaryWaitAvailable
        && conversationIdentity?.host === "chatgpt"
        && direction < 0
        && targetBeforeVisible
        && nextLogical <= model.minLogicalPosition + 1
        && remainingJumpPx <= 1;
      const motionWaitMs = conversationIdentity?.host === "chatgpt" ? this.chatMotionProgressWaitMs : this.motionProgressWaitMs;
      const stepWaitMs = chatEarlierBoundary ? this.chatBoundaryHydrationWaitMs : this.hydrationWaitMs;
      const stepStartedAt = nowMs(this.window);
      const outcome = await this.awaitHydrationProgress({
        turnId,
        targetOrder,
        previousSnapshot: currentSnapshot,
        direction,
        container,
        isCurrent: isNavigationCurrent,
        orderById,
        getIndexState,
        waitMs: stepWaitMs,
        allowMotionProgress: !chatEarlierBoundary,
        motionProgressWaitMs: motionWaitMs,
        scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
      });
      if (chatEarlierBoundary) {
        chatBoundaryWaitAvailable = Boolean(outcome.candidate || outcome.progressed);
      }
      recordStep(createNavigationTraceStep({
        mode: chatEarlierBoundary ? "chat-boundary" : coalescedJump.coalesced ? "chat-coalesced" : conversationIdentity?.host === "chatgpt" ? "chat-progressive" : "regular-progressive",
        direction,
        elapsedMs: nowMs(this.window) - stepStartedAt,
        jumpPx: remainingJumpPx,
        waitMs: chatEarlierBoundary ? stepWaitMs : motionWaitMs,
        targetOrder,
        before: currentSnapshot,
        after: outcome.snapshot,
        outcome
      }));
      if (outcome.state === "superseded") return finish(failure("superseded", turnId));
      probes += moved ? 1 : 0;
      const nextIndex = getIndexState();
      if (nextIndex.signature !== indexState.signature) {
        lastProgressAt = nowMs(this.window);
        consecutiveStalls = 0;
      }
      indexState = nextIndex;
      snapshot = outcome.snapshot ?? this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);

      if (outcome.candidate) {
        lastProgressAt = nowMs(this.window);
        const aligned = await this.verifyAndAlign(turnId, outcome.candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
        consecutiveStalls = 0;
        indexState = getIndexState();
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        continue;
      }
      if (outcome.progressed) {
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
        continue;
      }

      consecutiveStalls += 1;
      if (consecutiveStalls >= this.maxConsecutiveStalls) {
        indexState = getIndexState();
        candidate = this.resolveCandidate(turnId, indexState.targetOrder);
        if (candidate) {
          const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
        }
        return finish(this.navigationFailure("hydration-stalled", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState
        }));
      }
    }

    indexState = getIndexState();
    candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    if (candidate) {
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
    }
    return finish(this.navigationFailure("navigation-hard-limit", turnId, {
      probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
      budgetLimit: probes >= this.maxHydrationSteps && !allowFirstTurnProbeOverrun ? "probes" : "absolute-time"
    }));
  }

  navigationFailure(reason, turnId, { probes = 0, stalls = 0, targetOrder = -1, orderById = null, container, startedAt, getIndexState = null, ...extra } = {}) {
    const indexState = typeof getIndexState === "function" ? getIndexState() : null;
    const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
    const currentOrderById = indexState?.orderById ?? orderById;
    const latest = this.readHydrationSnapshot(container, currentTargetOrder, currentOrderById);
    return {
      ...failure(reason, turnId),
      probes, stalls,
      targetOrder: currentTargetOrder,
      visibleRange: latest.visibleRange,
      scrollHeight: latest.scrollHeight,
      maxLogicalPosition: latest.maxLogicalPosition,
      logicalPosition: latest.logicalPosition,
      elapsedMs: Math.round(nowMs(this.window) - startedAt),
      ...extra
    };
  }

  async awaitHydrationProgress({ turnId, targetOrder, previousSnapshot, direction, container, isCurrent, orderById = null, getIndexState = null, waitMs = this.hydrationWaitMs, allowMotionProgress = true, motionProgressWaitMs = this.motionProgressWaitMs, scrollAction = null }) {
    const initialIndex = typeof getIndexState === "function" ? getIndexState() : null;
    const initialTargetOrder = Number.isFinite(initialIndex?.targetOrder) ? Number(initialIndex.targetOrder) : targetOrder;
    const initialOrderById = initialIndex?.orderById ?? orderById;
    const baselineSignature = initialIndex?.signature ?? null;
    const baseline = previousSnapshot ?? this.readHydrationSnapshot(container, initialTargetOrder, initialOrderById);
    const allowWindowChangeProgress = this.conversationAdapter.getConversationIdentity?.()?.host === "chatgpt";
    let observer = null;
    let timer = null;
    let motionTimer = null;
    let rafId = null;
    let rafChecks = 0;
    let settled = false;
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { observer?.disconnect?.(); } catch {}
      if (timer != null) clearTimer(this.window, timer);
      if (motionTimer != null) clearTimer(this.window, motionTimer);
      if (rafId != null) this.window?.cancelAnimationFrame?.(rafId);
      resolvePromise(value);
    };
    const readIndex = () => typeof getIndexState === "function" ? getIndexState() : null;
    const readCurrentSnapshot = () => {
      const indexState = readIndex();
      const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
      const currentOrderById = indexState?.orderById ?? orderById;
      return {
        indexState,
        targetOrder: currentTargetOrder,
        snapshot: this.readHydrationSnapshot(container, currentTargetOrder, currentOrderById)
      };
    };
    const evaluate = ({ allowMotionProgress = false } = {}) => {
      if (settled) return true;
      if (!isCurrent()) {
        const current = readCurrentSnapshot();
        finish({ state: "superseded", progressed: false, snapshot: current.snapshot });
        return true;
      }
      const current = readCurrentSnapshot();
      const candidate = this.resolveCandidate(turnId, current.targetOrder);
      if (candidate) {
        finish({ state: "target", progressed: true, candidate, snapshot: current.snapshot });
        return true;
      }
      if (baselineSignature != null && current.indexState?.signature != null && current.indexState.signature !== baselineSignature) {
        finish({ state: "progress", progressed: true, indexChanged: true, snapshot: current.snapshot });
        return true;
      }
      if (allowWindowChangeProgress && hasVisibleWindowChanged(baseline, current.snapshot)) {
        finish({ state: "progress", progressed: true, windowChanged: true, snapshot: current.snapshot });
        return true;
      }
      if (hasHydrationProgress(current.targetOrder, baseline, current.snapshot, direction, { allowMotionProgress })) {
        finish({ state: "progress", progressed: true, snapshot: current.snapshot });
        return true;
      }
      return false;
    };

    const MutationObserverCtor = this.window?.MutationObserver;
    if (typeof MutationObserverCtor === "function" && container) {
      try {
        observer = new MutationObserverCtor(() => {
          evaluate({ allowMotionProgress: false });
        });
        observer.observe(container, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: HYDRATION_ATTRIBUTES
        });
      } catch {
        observer = null;
      }
    }

    const scheduleFrameCheck = () => {
      if (settled || rafChecks >= 36 || typeof this.window?.requestAnimationFrame !== "function") return;
      rafChecks += 1;
      rafId = this.window.requestAnimationFrame(() => {
        rafId = null;
        if (!evaluate({ allowMotionProgress: false })) scheduleFrameCheck();
      });
    };

    if (allowMotionProgress) {
      motionTimer = setTimer(this.window, () => {
        motionTimer = null;
        evaluate({ allowMotionProgress: true });
      }, motionProgressWaitMs);
    }

    timer = setTimer(this.window, () => {
      if (evaluate({ allowMotionProgress })) return;
      const current = readCurrentSnapshot();
      finish({ state: "stalled", progressed: false, snapshot: current.snapshot });
    }, Math.max(0, Number(waitMs) || 0));
    if (!isCurrent()) {
      const current = readCurrentSnapshot();
      finish({ state: "superseded", progressed: false, snapshot: current.snapshot });
      return promise;
    }
    try { scrollAction?.(); } catch {}
    evaluate({ allowMotionProgress: false });
    scheduleFrameCheck();
    return promise;
  }

  async performWorkWheelHydrationStep({ turnId, targetOrder, previousSnapshot, container, isCurrent, orderById, turnCount = 0, getIndexState = null }) {
    if (!container || !isCurrent()) return { state: "superseded", progressed: false, moved: false };
    const indexState = typeof getIndexState === "function" ? getIndexState() : null;
    const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
    const currentOrderById = indexState?.orderById ?? orderById;
    const currentTurnCount = Array.isArray(indexState?.turns) ? indexState.turns.length : turnCount;
    const model = readScrollModel(container, this.window);
    const viewport = Math.max(240, Number(model.clientHeight) || 737);
    const configuredStep = Math.min(Math.max(240, Number(this.workWheelStepPx) || 720), viewport);
    const step = workWheelStepSize({
      configuredStep,
      viewport,
      turnCount: currentTurnCount,
      targetDistance: previousSnapshot?.targetDistance,
      logicalPosition: model.logicalPosition,
      minLogicalPosition: model.minLogicalPosition
    });
    const nextLogical = clamp(model.logicalPosition - step, model.minLogicalPosition, model.maxLogicalPosition);
    const moved = Math.abs(nextLogical - model.logicalPosition) >= 1;
    dispatchWheelEvent(container, this.window, -step);
    const waitMs = moved ? this.workWheelWaitMs : this.hydrationWaitMs;
    const outcome = await this.awaitHydrationProgress({
      turnId,
      targetOrder: currentTargetOrder,
      previousSnapshot,
      direction: -1,
      container,
      isCurrent,
      orderById: currentOrderById,
      getIndexState,
      waitMs,
      allowMotionProgress: false,
      scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
    });
    return { ...outcome, moved, step, waitMs };
  }

  notifyCodexPlusScrollIntent(container, isCurrent = () => true) {
    if (!container || !isCurrent()) {
      this.compatibility = { ...createNavigationCompatibility(), status: "superseded" };
      return false;
    }
    const handlers = this.window?.__codexThreadScrollHandlers;
    const markPointerIntent = handlers?.markPointerIntent;
    if (typeof markPointerIntent !== "function") {
      this.compatibility = { ...createNavigationCompatibility(), status: "unavailable" };
      return false;
    }
    try {
      markPointerIntent.call(handlers, { target: container, type: "pointerdown" });
      this.compatibility = { ...createNavigationCompatibility(), status: "available", notified: true };
      return true;
    } catch (error) {
      this.compatibility = { ...createNavigationCompatibility(), status: "error", error: String(error?.message ?? error ?? "unknown") };
      return false;
    }
  }

  async hydrateEarlierHistory({
    isCurrent = () => true,
    onProgress = null,
    maxSteps = 64,
    maxBoundaryStalls = 3,
    boundaryWaitMs = this.chatBoundaryHydrationWaitMs,
    boundaryPollMs = 120
  } = {}) {
    const identity = this.conversationAdapter.getConversationIdentity?.() ?? null;
    if (!identity?.stable || identity.host !== "chatgpt") {
      return { ok: false, started: false, reason: "not-chat" };
    }
    const container = this.conversationAdapter.getScrollContainer?.();
    if (!container || container.isConnected === false) {
      return { ok: false, started: false, reason: "missing-scroll-container" };
    }

    let steps = 0;
    let stalls = 0;
    while (steps < Math.max(1, Number(maxSteps) || 1)
      && stalls < Math.max(1, Number(maxBoundaryStalls) || 1)) {
      if (!isCurrent() || this.conversationAdapter.getScrollContainer?.() !== container) {
        return { ok: false, started: true, reason: "superseded", steps, stalls };
      }

      const model = readScrollModel(container, this.window);
      const atEarlierBoundary = Math.abs(Number(model.logicalPosition) - Number(model.minLogicalPosition)) <= 1;
      if (!atEarlierBoundary) {
        setLogicalScrollPosition(container, model.minLogicalPosition, model);
        await nextFrame(this.window);
        await delay(this.window, Math.max(8, Math.min(120, Number(this.hydrationWaitMs) || 45)));
        steps += 1;
        try { onProgress?.({ steps, phase: "seek-boundary", snapshot: readChatHistorySnapshot(this.turnAdapter, container, this.window) }); } catch {}
        continue;
      }

      const before = readChatHistorySnapshot(this.turnAdapter, container, this.window);
      const waitLimit = Math.max(1, Number(boundaryWaitMs) || this.chatBoundaryHydrationWaitMs);
      const poll = Math.max(1, Math.min(waitLimit, Number(boundaryPollMs) || 120));
      const waitStartedAt = nowMs(this.window);
      let after = before;
      let changed = false;
      while (nowMs(this.window) - waitStartedAt < waitLimit) {
        await delay(this.window, Math.min(poll, Math.max(1, waitLimit - (nowMs(this.window) - waitStartedAt))));
        await nextFrame(this.window);
        if (!isCurrent()) return { ok: false, started: true, reason: "superseded", steps, stalls };
        after = readChatHistorySnapshot(this.turnAdapter, container, this.window);
        if (chatHistorySnapshotChanged(before, after)) {
          changed = true;
          break;
        }
      }
      steps += 1;
      if (changed) {
        stalls = 0;
        try { onProgress?.({ steps, phase: "history-batch", snapshot: after }); } catch {}
      } else {
        stalls += 1;
      }
    }

    const snapshot = readChatHistorySnapshot(this.turnAdapter, container, this.window);
    return {
      ok: true,
      started: true,
      reason: stalls >= Math.max(1, Number(maxBoundaryStalls) || 1) ? "earlier-boundary-exhausted" : "step-limit",
      steps,
      stalls,
      scrollHeight: snapshot.scrollHeight,
      logicalPosition: snapshot.logicalPosition
    };
  }

  async sweepLoadedChatHistory({
    isCurrent = () => true,
    onWindow = null,
    maxSteps = 256,
    stepRatio = 0.75,
    settleWaitMs = 8
  } = {}) {
    const identity = this.conversationAdapter.getConversationIdentity?.() ?? null;
    if ((!identity?.stable || identity.host !== "chatgpt") && !isCurrent()) {
      return { ok: false, started: false, reason: "not-chat", steps: 0, windowCount: 0 };
    }
    const container = this.conversationAdapter.getScrollContainer?.();
    if (!container || container.isConnected === false) {
      return { ok: false, started: false, reason: "missing-scroll-container", steps: 0, windowCount: 0 };
    }

    const emitWindow = (phase) => {
      const turns = this.turnAdapter.getVisibleTurns?.() ?? [];
      const model = readScrollModel(container, this.window);
      try {
        onWindow?.({
          phase,
          turns,
          logicalPosition: Number(model.logicalPosition) || 0,
          maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
          clientHeight: Number(model.clientHeight) || 0
        });
      } catch {}
      return { turns, model };
    };

    let model = readScrollModel(container, this.window);
    setLogicalScrollPosition(container, model.minLogicalPosition, model);
    await nextFrame(this.window);
    if (settleWaitMs > 0) await delay(this.window, settleWaitMs);
    if (!isCurrent() || this.conversationAdapter.getScrollContainer?.() !== container) {
      return { ok: false, started: true, reason: "superseded", steps: 0, windowCount: 0 };
    }

    let windowCount = 0;
    emitWindow("sweep-start");
    windowCount += 1;
    let steps = 0;
    while (steps < Math.max(1, Number(maxSteps) || 1)) {
      if (!isCurrent() || this.conversationAdapter.getScrollContainer?.() !== container) {
        return { ok: false, started: true, reason: "superseded", steps, windowCount };
      }
      model = readScrollModel(container, this.window);
      const remaining = Number(model.maxLogicalPosition) - Number(model.logicalPosition);
      if (remaining <= 1) {
        emitWindow("sweep-end");
        windowCount += 1;
        return {
          ok: true,
          started: true,
          reason: "sweep-complete",
          steps,
          windowCount,
          logicalPosition: Number(model.logicalPosition) || 0,
          maxLogicalPosition: Number(model.maxLogicalPosition) || 0
        };
      }
      const viewport = Math.max(1, Number(model.clientHeight) || 800);
      const ratio = Math.max(0.25, Math.min(0.9, Number(stepRatio) || 0.75));
      const stepPx = Math.max(120, viewport * ratio);
      const nextLogical = Math.min(Number(model.maxLogicalPosition), Number(model.logicalPosition) + stepPx);
      setLogicalScrollPosition(container, nextLogical, model);
      await nextFrame(this.window);
      if (settleWaitMs > 0) await delay(this.window, settleWaitMs);
      if (!isCurrent() || this.conversationAdapter.getScrollContainer?.() !== container) {
        return { ok: false, started: true, reason: "superseded", steps, windowCount };
      }
      emitWindow("sweep-step");
      windowCount += 1;
      steps += 1;
    }

    model = readScrollModel(container, this.window);
    return {
      ok: false,
      started: true,
      reason: "step-limit",
      steps,
      windowCount,
      logicalPosition: Number(model.logicalPosition) || 0,
      maxLogicalPosition: Number(model.maxLogicalPosition) || 0
    };
  }

  getCompatibilityStatus() {
    return { ...this.compatibility };
  }

  readVisibleOrders(orderById = null) {
    const values = [];
    const host = this.conversationAdapter.getConversationIdentity?.()?.host ?? null;
    for (const turn of this.turnAdapter.getVisibleTurns?.() ?? []) {
      const id = String(turn?.id ?? "");
      const canonicalOrder = orderById?.get?.(id);
      let order = null;
      if (Number.isFinite(canonicalOrder)) {
        order = Number(canonicalOrder);
      } else if (host === "chatgpt" && turn?.orderTrust === "window") {
        order = fallbackOrder(id);
      } else {
        order = Number.isFinite(turn?.order) ? Number(turn.order) : fallbackOrder(id);
      }
      if (Number.isFinite(order)) values.push(order);
    }
    return [...new Set(values)].sort((a, b) => a - b);
  }

  readVisibleWindowSignature() {
    return (this.turnAdapter.getVisibleTurns?.() ?? [])
      .map((turn) => String(turn?.id ?? "").trim())
      .filter(Boolean)
      .join("|");
  }

  readHydrationSnapshot(container, targetOrder, orderById = null) {
    return {
      ...createHydrationSnapshot(targetOrder, this.readVisibleOrders(orderById), readScrollModel(container, this.window)),
      windowSignature: this.readVisibleWindowSignature()
    };
  }

  resolveCandidate(turnId, targetOrder = -1) {
    const direct = this.turnAdapter.resolveTurn(turnId);
    if (direct && this.turnAdapter.verifyTurnElement(turnId, direct)) return { element: direct, domId: turnId };
    if (!Number.isFinite(targetOrder) || targetOrder < 0) return null;
    const fallbackId = `fallback-turn-${targetOrder}`;
    if (fallbackId === turnId) return null;
    const fallback = this.turnAdapter.resolveTurn(fallbackId);
    if (fallback && this.turnAdapter.verifyTurnElement(fallbackId, fallback)) return { element: fallback, domId: fallbackId };
    return null;
  }

  async verifyAndAlign(turnId, candidateOrElement, isCurrent, probes, targetOrder = -1, maxKnownOrder = null, options = {}) {
    if (!isCurrent()) return failure("superseded", turnId);
    const readTargetOrder = typeof targetOrder === "function" ? targetOrder : () => targetOrder;
    const readMaxKnownOrder = typeof maxKnownOrder === "function" ? maxKnownOrder : () => maxKnownOrder;
    let candidate = candidateOrElement?.element
      ? candidateOrElement
      : { element: candidateOrElement, domId: turnId };
    if (!this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) return failure("stale-or-recycled-dom", turnId);
    const container = this.conversationAdapter.getScrollContainer();
    if (!container) return failure("missing-scroll-container", turnId);

    const alignCandidate = async () => {
      for (let frame = 0; frame < this.maxAlignFrames; frame += 1) {
        if (!isCurrent()) return failure("superseded", turnId);
        candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
        if (!candidate?.element || !this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) {
          return failure("stale-or-recycled-dom", turnId);
        }
        const rect = candidate.element.getBoundingClientRect?.();
        const containerRect = container.getBoundingClientRect?.();
        if (!rect || !containerRect) break;
        const activationLine = containerRect.top + this.activationOffset;
        const delta = rect.top - activationLine;
        if (Math.abs(delta) <= 5) break;
        const model = readScrollModel(container, this.window);
        const logicalTarget = clamp(
          model.logicalPosition + delta,
          model.minLogicalPosition,
          model.maxLogicalPosition
        );
        if (Math.abs(logicalTarget - model.logicalPosition) < 1) break;
        setLogicalScrollPosition(container, logicalTarget, model);
        await nextFrame(this.window);
      }
      return null;
    };

    const firstAlignmentFailure = await alignCandidate();
    if (firstAlignmentFailure) return firstAlignmentFailure;

    if (options?.mountedFastSettle && this.mountedFastSettleWaitMs > 0) {
      candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
      const fastRectBefore = candidate?.element?.getBoundingClientRect?.();
      const fastContainerBefore = container.getBoundingClientRect?.();
      const fastSnapshotBefore = readMountedSettleSnapshot(this.turnAdapter, container, this.window, fastRectBefore);
      if (candidate?.element
        && this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)
        && fastRectBefore
        && fastContainerBefore
        && (rectInActivationZone(fastRectBefore, fastContainerBefore, this.activationOffset)
          || isVerifiedTailEndpoint({
            targetOrder: readTargetOrder(),
            maxKnownOrder: readMaxKnownOrder(),
            rect: fastRectBefore,
            containerRect: fastContainerBefore,
            model: readScrollModel(container, this.window)
          }))) {
        await delay(this.window, this.mountedFastSettleWaitMs);
        await nextFrame(this.window);
        if (!isCurrent()) return failure("superseded", turnId);
        candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
        const fastRectAfter = candidate?.element?.getBoundingClientRect?.();
        const fastContainerAfter = container.getBoundingClientRect?.();
        const fastModelAfter = readScrollModel(container, this.window);
        const fastSnapshotAfter = readMountedSettleSnapshot(this.turnAdapter, container, this.window, fastRectAfter);
        if (candidate?.element
          && this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)
          && fastRectAfter
          && fastContainerAfter
          && mountedSettleSnapshotStable(fastSnapshotBefore, fastSnapshotAfter)) {
          if (isVerifiedTailEndpoint({
            targetOrder: readTargetOrder(),
            maxKnownOrder: readMaxKnownOrder(),
            rect: fastRectAfter,
            containerRect: fastContainerAfter,
            model: fastModelAfter
          })) {
            return {
              ok: true, target: turnId, targetOrder: readTargetOrder(), verified: true, probes,
              domId: candidate.domId, settleChecks: 1, settleMode: "mounted-fast", endpoint: "tail"
            };
          }
          if (rectInActivationZone(fastRectAfter, fastContainerAfter, this.activationOffset)) {
            return {
              ok: true, target: turnId, targetOrder: readTargetOrder(), verified: true, probes,
              domId: candidate.domId, settleChecks: 1, settleMode: "mounted-fast"
            };
          }
        }
      }
    }

    for (let settleCheck = 0; settleCheck <= this.maxPostSettleCorrections; settleCheck += 1) {
      await nextFrame(this.window);
      if (!isCurrent()) return failure("superseded", turnId);
      candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
      if (!candidate?.element || !this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) {
        return { ...failure("post-settle-target-lost", turnId), probes, settleChecks: settleCheck };
      }
      const rect = candidate.element.getBoundingClientRect?.();
      const containerRect = container.getBoundingClientRect?.();
      if (!rect || !containerRect) return { ...failure("verification-failed", turnId), probes };
      const model = readScrollModel(container, this.window);
      if (isVerifiedTailEndpoint({
        targetOrder: readTargetOrder(),
        maxKnownOrder: readMaxKnownOrder(),
        rect,
        containerRect,
        model
      })) {
        return {
          ok: true,
          target: turnId,
          targetOrder: readTargetOrder(),
          verified: true,
          probes,
          domId: candidate.domId,
          settleChecks: settleCheck + 1,
          endpoint: "tail"
        };
      }
      if (!rectInActivationZone(rect, containerRect, this.activationOffset)) {
        if (settleCheck >= this.maxPostSettleCorrections) {
          return { ...failure("post-settle-drift", turnId), probes, settleChecks: settleCheck + 1 };
        }
        const correctionFailure = await alignCandidate();
        if (correctionFailure) return correctionFailure;
      }
      if (settleCheck < this.maxPostSettleCorrections && this.postSettleWaitMs > 0) {
        await delay(this.window, this.postSettleWaitMs);
        continue;
      }
      return {
        ok: true,
        target: turnId,
        targetOrder: readTargetOrder(),
        verified: true,
        probes,
        domId: candidate.domId,
        settleChecks: settleCheck + 1
      };
    }

    return { ...failure("post-settle-drift", turnId), probes };
  }

  async verifyAndCenter(...args) {
    return this.verifyAndAlign(...args);
  }
}

function createNavigationIndex(turnId, turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  const targetIndex = list.findIndex((turn) => turn?.id === turnId);
  const targetRecord = targetIndex >= 0 ? list[targetIndex] : null;
  const targetOrder = Number.isFinite(targetRecord?.order) ? Number(targetRecord.order) : targetIndex;
  const orderById = createTurnOrderMap(list);
  const knownOrders = [...orderById.values()].filter(Number.isFinite).sort((a, b) => a - b);
  const maxKnownOrder = knownOrders.at(-1) ?? null;
  const signature = list.map((turn, index) => {
    const order = Number.isFinite(turn?.order) ? Number(turn.order) : index;
    return `${String(turn?.id ?? "")}:${order}`;
  }).join("|");
  return { turns: list, targetIndex, targetOrder, orderById, maxKnownOrder, signature };
}

function createTurnOrderMap(turns = []) {
  const values = new Map();
  for (const [index, turn] of turns.entries()) {
    if (!turn?.id) continue;
    const order = Number.isFinite(turn.order) ? Number(turn.order) : index;
    values.set(String(turn.id), order);
  }
  return values;
}

function computeActiveTurnId({ visibleTurns = [], resolveTurn, container = null, activationOffset = 120 } = {}) {
  const containerRect = container?.getBoundingClientRect?.() ?? { top: 0, bottom: Number.POSITIVE_INFINITY, height: 800 };
  const activationLine = containerRect.top + activationOffset;
  let crossed = null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const turn of visibleTurns) {
    const rect = resolveTurn?.(turn.id)?.getBoundingClientRect?.();
    if (!rect || rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue;
    const distance = Math.abs(rect.top - activationLine);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = turn.id;
    }
    if (rect.top <= activationLine && rect.bottom > activationLine) crossed = turn.id;
  }
  return crossed ?? nearest ?? null;
}

function isVerifiedTailEndpoint({ targetOrder, maxKnownOrder, rect, containerRect, model, tolerance = 2 } = {}) {
  if (!Number.isFinite(targetOrder) || !Number.isFinite(maxKnownOrder) || targetOrder !== maxKnownOrder) return false;
  if (!model?.isColumnReverse) return false;
  if (Math.abs(Number(model.maxLogicalPosition || 0) - Number(model.logicalPosition || 0)) > tolerance) return false;
  if (!rect || !containerRect) return false;
  return Number(rect.bottom) > Number(containerRect.top) && Number(rect.top) < Number(containerRect.bottom);
}

function readMountedSettleSnapshot(turnAdapter, container, windowRef, rect) {
  const model = readScrollModel(container, windowRef);
  const visibleSignature = (turnAdapter?.getVisibleTurns?.() ?? [])
    .map((turn) => String(turn?.id ?? ""))
    .join("|");
  return {
    visibleSignature,
    scrollHeight: Number(model.scrollHeight) || 0,
    maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
    logicalPosition: Number(model.logicalPosition) || 0,
    rectTop: Number(rect?.top),
    rectBottom: Number(rect?.bottom)
  };
}

function mountedSettleSnapshotStable(before, after, tolerance = 2) {
  if (!before || !after) return false;
  if (before.visibleSignature !== after.visibleSignature) return false;
  if (Math.abs(after.scrollHeight - before.scrollHeight) > tolerance) return false;
  if (Math.abs(after.maxLogicalPosition - before.maxLogicalPosition) > tolerance) return false;
  if (Math.abs(after.logicalPosition - before.logicalPosition) > tolerance) return false;
  if (!Number.isFinite(before.rectTop) || !Number.isFinite(after.rectTop)) return false;
  if (!Number.isFinite(before.rectBottom) || !Number.isFinite(after.rectBottom)) return false;
  if (Math.abs(after.rectTop - before.rectTop) > tolerance) return false;
  if (Math.abs(after.rectBottom - before.rectBottom) > tolerance) return false;
  return true;
}

function createNavigationTraceStep({ mode, direction, elapsedMs, jumpPx, waitMs, targetOrder, before, after, outcome } = {}) {
  return {
    mode: String(mode ?? "unknown"),
    direction: Number(direction) || 0,
    elapsedMs: Math.round(Number(elapsedMs) || 0),
    jumpPx: Math.round(Number(jumpPx) || 0),
    waitMs: Math.round(Number(waitMs) || 0),
    targetOrder: Number.isFinite(targetOrder) ? Number(targetOrder) : null,
    progressKind: classifyNavigationStepProgress({ targetOrder, before, after, outcome, direction }),
    before: compactTraceSnapshot(before),
    after: compactTraceSnapshot(after)
  };
}

function compactTraceSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    visibleRange: snapshot.visibleRange ?? visibleOrderRange(snapshot.visibleOrders ?? []),
    scrollHeight: Math.round(Number(snapshot.scrollHeight) || 0),
    logicalPosition: Math.round(Number(snapshot.logicalPosition) || 0)
  };
}

function classifyNavigationStepProgress({ targetOrder, before, after, outcome, direction } = {}) {
  if (outcome?.candidate || outcome?.state === "target") return "target";
  if (outcome?.indexChanged) return "index";
  if (!after) return outcome?.progressed ? "progress" : "none";
  if (turnWindowDistance(targetOrder, after.visibleOrders ?? []) < turnWindowDistance(targetOrder, before?.visibleOrders ?? [])) return "window";
  if ((Number(after.scrollHeight) || 0) > (Number(before?.scrollHeight) || 0) + 1
    || (Number(after.maxLogicalPosition) || 0) > (Number(before?.maxLogicalPosition) || 0) + 1) return "extent";
  if (direction < 0 && (Number(after.logicalPosition) || 0) < (Number(before?.logicalPosition) || 0) - 1) return "motion";
  if (direction > 0 && (Number(after.logicalPosition) || 0) > (Number(before?.logicalPosition) || 0) + 1) return "motion";
  return outcome?.progressed ? "progress" : "none";
}

function rectInActivationZone(rect, containerRect = null, activationOffset = 120) {
  if (!rect) return false;
  const bounds = containerRect ?? { top: 0, bottom: 800, height: 800 };
  const height = Number(bounds.height) || Math.max(1, Number(bounds.bottom) - Number(bounds.top)) || 800;
  const line = Number(bounds.top || 0) + activationOffset;
  const tolerance = Math.min(42, Math.max(18, height * 0.045));
  return rect.top <= line + tolerance && rect.bottom >= line - tolerance;
}

function readScrollModel(container, windowRef = globalThis.window) {
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  return createScrollModel({
    scrollTop: container?.scrollTop,
    scrollHeight: container?.scrollHeight,
    clientHeight: container?.clientHeight,
    flexDirection
  });
}

function setLogicalScrollPosition(container, logicalPosition, model = readScrollModel(container)) {
  if (!container) return null;
  const top = scrollTopFromLogical(logicalPosition, model.maxLogicalPosition, model.isColumnReverse);
  container.scrollTop = top;
  return top;
}

function chooseHydrationDirection(targetOrder, visibleOrders = [], model = {}) {
  if (visibleOrders.length) {
    const min = visibleOrders[0];
    const max = visibleOrders[visibleOrders.length - 1];
    if (targetOrder < min) return -1;
    if (targetOrder > max) return 1;
  }
  const midpoint = (Number(model.minLogicalPosition || 0) + Number(model.maxLogicalPosition || 0)) / 2;
  return Number(model.logicalPosition || 0) > midpoint ? -1 : 1;
}

function hydrationStepSize(model = {}, visibleOrders = [], targetOrder = -1) {
  const viewport = Math.max(1, Number(model.clientHeight) || 800);
  const span = Math.max(viewport, Number(model.maxLogicalPosition) || viewport);
  let multiplier = 1.45;
  if (visibleOrders.length && Number.isFinite(targetOrder)) {
    const min = visibleOrders[0];
    const max = visibleOrders[visibleOrders.length - 1];
    const distance = targetOrder < min ? min - targetOrder : targetOrder > max ? targetOrder - max : 0;
    if (distance > 20) multiplier = 2.4;
    else if (distance > 8) multiplier = 1.9;
  }
  const proportional = Math.min(3200, Math.max(900, span * 0.06));
  return Math.min(span, Math.max(viewport * multiplier, proportional));
}

function workWheelStepSize({ configuredStep = 720, viewport = 737, turnCount = 0, targetDistance = 0, logicalPosition = 0, minLogicalPosition = 0 } = {}) {
  const safeViewport = Math.max(240, Number(viewport) || 737);
  const base = Math.min(Math.max(240, Number(configuredStep) || 720), safeViewport);
  if (Number(turnCount) <= 12) return Math.round(Math.max(180, Math.min(base, safeViewport * 0.5)));
  const distance = Math.max(0, Number(targetDistance) || 0);
  const scale = distance > 40 ? 1.35 : distance > 20 ? 1.2 : 1;
  const desired = Math.min(base * scale, safeViewport * 1.35);
  const remaining = Math.max(0, Number(logicalPosition) - Number(minLogicalPosition));
  return Math.round(remaining > 0 ? Math.min(desired, remaining) : desired);
}

function hydrationJumpScale({ host = null, direction = 0, targetBeforeVisible = false, targetDistance = 0, chatEarlierJumpScale = 1.35 } = {}) {
  if (host !== "chatgpt" || direction >= 0 || !targetBeforeVisible) return 1;
  const base = Math.max(1, Number(chatEarlierJumpScale) || 1);
  const distance = Math.max(0, Number(targetDistance) || 0);
  if (distance > 40) return Math.max(base, 1.75);
  if (distance > 20) return Math.max(base, 1.55);
  return base;
}

function chatFarCoalescedJump({ baseJump = 0, host = null, direction = 0, targetBeforeVisible = false, targetDistance = 0, logicalPosition = 0, minLogicalPosition = 0, stalled = false } = {}) {
  const base = Math.max(0, Number(baseJump) || 0);
  const availableEarlier = Math.max(0, Number(logicalPosition) - Number(minLogicalPosition));
  const eligible = host === "chatgpt"
    && direction < 0
    && targetBeforeVisible
    && Number(targetDistance) > 40
    && !stalled
    && availableEarlier > base * 1.6;
  if (!eligible) return { jumpPx: base, coalesced: false };
  return { jumpPx: Math.round(Math.min(base * 1.35, 7600, availableEarlier)), coalesced: true };
}

function turnWindowDistance(targetOrder, orders = []) {
  if (!Number.isFinite(targetOrder) || !orders.length) return Number.POSITIVE_INFINITY;
  const sorted = [...orders].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.POSITIVE_INFINITY;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (targetOrder < min) return min - targetOrder;
  if (targetOrder > max) return targetOrder - max;
  return 0;
}

function createHydrationSnapshot(targetOrder, orders = [], model = {}) {
  const visibleOrders = [...orders].filter(Number.isFinite).sort((a, b) => a - b);
  return {
    visibleOrders,
    visibleRange: visibleOrderRange(visibleOrders),
    targetDistance: turnWindowDistance(targetOrder, visibleOrders),
    scrollHeight: Number(model.scrollHeight) || 0,
    clientHeight: Number(model.clientHeight) || 0,
    maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
    logicalPosition: Number(model.logicalPosition) || 0
  };
}

function hasHydrationProgress(targetOrder, before, after, direction = 0, { allowMotionProgress = true } = {}) {
  if (!after) return false;
  if (!before) return true;
  if (turnWindowDistance(targetOrder, after.visibleOrders) < turnWindowDistance(targetOrder, before.visibleOrders)) return true;
  if (after.scrollHeight > before.scrollHeight + 1) return true;
  if (after.maxLogicalPosition > before.maxLogicalPosition + 1) return true;
  if (!allowMotionProgress) return false;
  if (direction < 0 && after.logicalPosition < before.logicalPosition - 1) return true;
  if (direction > 0 && after.logicalPosition > before.logicalPosition + 1) return true;
  return false;
}

function hasTurnWindowProgress(targetOrder, beforeOrders = [], afterOrders = []) {
  return turnWindowDistance(targetOrder, afterOrders) < turnWindowDistance(targetOrder, beforeOrders);
}

function hasVisibleWindowChanged(before, after) {
  const previous = String(before?.windowSignature ?? "");
  const current = String(after?.windowSignature ?? "");
  return Boolean(previous && current && previous !== current);
}

function visibleOrderRange(orders = []) {
  if (!orders.length) return null;
  return { min: orders[0], max: orders[orders.length - 1] };
}

function retryableAlignmentFailure(reason) {
  return reason === "stale-or-recycled-dom"
    || reason === "post-settle-target-lost"
    || reason === "post-settle-drift";
}

function fallbackOrder(id) {
  const match = String(id ?? "").match(FALLBACK_TURN);
  return match ? Number.parseInt(match[1], 10) : null;
}

function dispatchWheelEvent(container, windowRef = globalThis.window, deltaY = -720) {
  if (!container?.dispatchEvent) return false;
  try {
    const WheelCtor = windowRef?.WheelEvent ?? globalThis.WheelEvent;
    const event = typeof WheelCtor === "function"
      ? new WheelCtor("wheel", { deltaY, deltaMode: 0, bubbles: true, cancelable: true })
      : { type: "wheel", deltaY, deltaMode: 0, bubbles: true, cancelable: true };
    container.dispatchEvent(event);
    return true;
  } catch {
    return false;
  }
}



function readChatHistorySnapshot(turnAdapter, container, windowRef) {
  const model = readScrollModel(container, windowRef);
  return {
    visibleSignature: (turnAdapter?.getVisibleTurns?.() ?? []).map((turn) => String(turn?.id ?? "")).join("|"),
    scrollHeight: Number(model.scrollHeight) || 0,
    maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
    minLogicalPosition: Number(model.minLogicalPosition) || 0,
    logicalPosition: Number(model.logicalPosition) || 0
  };
}

function chatHistorySnapshotChanged(before, after) {
  if (!before || !after) return false;
  return before.visibleSignature !== after.visibleSignature
    || Math.abs(Number(after.scrollHeight) - Number(before.scrollHeight)) >= 1
    || Math.abs(Number(after.maxLogicalPosition) - Number(before.maxLogicalPosition)) >= 1;
}

function nextFrame(windowRef) {
  return new Promise((resolve) => {
    if (typeof windowRef?.requestAnimationFrame === "function") windowRef.requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function delay(windowRef, milliseconds) {
  return new Promise((resolve) => setTimer(windowRef, resolve, milliseconds));
}

function setTimer(windowRef, callback, delayMs) {
  return typeof windowRef?.setTimeout === "function" ? windowRef.setTimeout(callback, delayMs) : setTimeout(callback, delayMs);
}

function clearTimer(windowRef, timer) {
  if (typeof windowRef?.clearTimeout === "function") windowRef.clearTimeout(timer);
  else clearTimeout(timer);
}

function nowMs(windowRef) {
  return Number(windowRef?.performance?.now?.()) || Date.now();
}

function createNavigationCompatibility() {
  return {
    feature: "codex-plus-thread-scroll-restore",
    status: "not-needed",
    notified: false,
    error: ""
  };
}

function failure(reason, target) {
  return { ok: false, reason, target, verified: false };
}

Object.assign(exports, { NavigationAdapter, computeActiveTurnId, rectInActivationZone, readScrollModel, setLogicalScrollPosition, chooseHydrationDirection, hydrationStepSize, workWheelStepSize, hydrationJumpScale, chatFarCoalescedJump, turnWindowDistance, createHydrationSnapshot, hasHydrationProgress, hasTurnWindowProgress, visibleOrderRange });

},
"src/v3/host/codex-desktop/work-navigation-adapter.js": (module, exports, __require) => {
const { clamp, createScrollModel, scrollTopFromLogical } = __require("src/v3/core/scroll-model.js");

const FALLBACK_TURN = /^fallback-turn-(\d+)$/;
const NAVIGATION_TRACE_LIMIT = 16;
const WORK_TAIL_BACKTRACK_MAX_STEPS = 32;
const HYDRATION_ATTRIBUTES = [
  "data-turn-key",
  "data-content-search-turn-key",
  "data-turn-id",
  "data-turn-id-container"
];

class WorkNavigationAdapter {
  constructor({
    window,
    turnAdapter,
    conversationAdapter,
    activationOffset = 120,
    maxHydrationSteps = 256,
    maxConsecutiveStalls = 4,
    hydrationWaitMs = 900,
    workWheelStepPx = 720,
    workWheelWaitMs = 120,
    inactivityNavigationMs = 5000,
    absoluteMaxNavigationMs = 45000,
    maxNavigationMs = null,
    motionProgressWaitMs = 45,
    chatMotionProgressWaitMs = 8,
    chatEarlierJumpScale = 1.35,
    chatBoundaryHydrationWaitMs = 1800,
    maxAlignFrames = 8,
    postSettleWaitMs = 160,
    mountedFastSettleWaitMs = 120,
    maxPostSettleCorrections = 2
  } = {}) {
    this.window = window ?? globalThis.window;
    this.turnAdapter = turnAdapter;
    this.conversationAdapter = conversationAdapter;
    this.activationOffset = activationOffset;
    this.maxHydrationSteps = maxHydrationSteps;
    this.maxConsecutiveStalls = maxConsecutiveStalls;
    this.hydrationWaitMs = hydrationWaitMs;
    this.workWheelStepPx = workWheelStepPx;
    this.workWheelWaitMs = workWheelWaitMs;
    this.inactivityNavigationMs = inactivityNavigationMs;
    this.absoluteMaxNavigationMs = Number.isFinite(maxNavigationMs)
      ? Number(maxNavigationMs)
      : Number(absoluteMaxNavigationMs);
    this.motionProgressWaitMs = motionProgressWaitMs;
    this.chatMotionProgressWaitMs = chatMotionProgressWaitMs;
    this.chatEarlierJumpScale = Math.max(1, Number(chatEarlierJumpScale) || 1);
    this.chatBoundaryHydrationWaitMs = Math.max(this.hydrationWaitMs, Number(chatBoundaryHydrationWaitMs) || 0);
    this.maxAlignFrames = maxAlignFrames;
    this.postSettleWaitMs = postSettleWaitMs;
    this.mountedFastSettleWaitMs = mountedFastSettleWaitMs;
    this.maxPostSettleCorrections = maxPostSettleCorrections;
    this.compatibility = createNavigationCompatibility();
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true, allowMountedFastSettle = false, onTraceStep = null } = {}) {
    const steps = [];
    const finish = (result) => ({ ...result, steps: steps.slice() });
    const recordStep = (entry) => {
      steps.push(entry);
      if (steps.length > NAVIGATION_TRACE_LIMIT) steps.splice(0, steps.length - NAVIGATION_TRACE_LIMIT);
      try { onTraceStep?.(entry, steps.slice()); } catch {}
    };
    if (!turnId) return finish(failure("missing-turn-id", turnId));
    if (!isCurrent()) return finish(failure("superseded", turnId));
    const readTurns = () => {
      try {
        const current = typeof getTurns === "function" ? getTurns() : turns;
        return Array.isArray(current) ? current : turns;
      } catch {
        return turns;
      }
    };
    const getIndexState = () => createNavigationIndex(turnId, readTurns());
    let indexState = getIndexState();
    if (indexState.targetIndex < 0) return finish(failure("unknown-turn", turnId));

    const container = this.conversationAdapter.getScrollContainer();
    if (!container) return finish(failure("missing-scroll-container", turnId));
    const isNavigationCurrent = () => isCurrent() && this.conversationAdapter.getScrollContainer() === container;
    if (!isNavigationCurrent()) return finish(failure("superseded", turnId));

    this.compatibility = createNavigationCompatibility();
    const startedAt = nowMs(this.window);
    let lastProgressAt = startedAt;
    let probes = 0;
    let consecutiveStalls = 0;
    let workCompatibilityNotified = false;
    let tailTargetBacktrackActive = false;
    let tailTargetBacktrackSteps = 0;
    let chatBoundaryWaitAvailable = true;
    let snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    let candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    const readTargetOrder = () => getIndexState().targetOrder;
    const readMaxKnownOrder = () => getIndexState().maxKnownOrder;
    if (candidate) {
      lastProgressAt = nowMs(this.window);
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder, {
        mountedFastSettle: Boolean(allowMountedFastSettle)
      });
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
      indexState = getIndexState();
      snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    }

    const conversationIdentity = this.conversationAdapter.getConversationIdentity?.() ?? null;
    const allowFirstTurnProbeOverrun = conversationIdentity?.host === "chatgpt" && indexState.targetOrder === 0;

    while ((probes < this.maxHydrationSteps || allowFirstTurnProbeOverrun)
      && nowMs(this.window) - startedAt < this.absoluteMaxNavigationMs) {
      const loopNow = nowMs(this.window);
      if (loopNow - lastProgressAt >= this.inactivityNavigationMs) {
        return finish(this.navigationFailure("navigation-inactive", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
          inactiveMs: Math.round(loopNow - lastProgressAt)
        }));
      }
      if (!isNavigationCurrent()) return finish(failure("superseded", turnId));

      const refreshedIndex = getIndexState();
      if (refreshedIndex.targetIndex < 0) return finish(failure("unknown-turn", turnId));
      if (refreshedIndex.signature !== indexState.signature) {
        indexState = refreshedIndex;
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
      } else {
        indexState = refreshedIndex;
      }
      const { targetOrder, orderById, maxKnownOrder } = indexState;

      candidate = this.resolveCandidate(turnId, targetOrder);
      if (candidate) {
        lastProgressAt = nowMs(this.window);
        const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
        consecutiveStalls = 0;
        indexState = getIndexState();
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        continue;
      }

      const model = readScrollModel(container, this.window);
      const visibleOrders = this.readVisibleOrders(orderById);
      const currentSnapshot = createHydrationSnapshot(targetOrder, visibleOrders, model);
      const targetBeforeVisible = visibleOrders.length > 0 && targetOrder < visibleOrders[0];
      const targetAfterVisible = visibleOrders.length > 0 && targetOrder > visibleOrders[visibleOrders.length - 1];
      const localWorkColumnReverse = conversationIdentity?.host === "local"
        && conversationIdentity?.source === "sidebar-local"
        && model.isColumnReverse;
      const atPhysicalTail = Math.abs(Number(model.maxLogicalPosition) - Number(model.logicalPosition)) <= 2;
      if (tailTargetBacktrackActive && (targetOrder !== maxKnownOrder || !targetAfterVisible)) {
        tailTargetBacktrackActive = false;
      }
      if (!tailTargetBacktrackActive
        && localWorkColumnReverse
        && targetOrder === maxKnownOrder
        && targetAfterVisible
        && atPhysicalTail) {
        tailTargetBacktrackActive = true;
        tailTargetBacktrackSteps = 0;
      }
      if (tailTargetBacktrackActive && tailTargetBacktrackSteps >= WORK_TAIL_BACKTRACK_MAX_STEPS) {
        return finish(this.navigationFailure("tail-target-backtrack-limit", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
          tailBacktrackSteps: tailTargetBacktrackSteps
        }));
      }
      const direction = tailTargetBacktrackActive
        ? -1
        : chooseHydrationDirection(targetOrder, visibleOrders, model);
      if (hasHydrationProgress(targetOrder, snapshot, currentSnapshot, direction)) {
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
      }
      snapshot = currentSnapshot;

      const localWorkWheel = localWorkColumnReverse
        && ((direction < 0 && (targetBeforeVisible || tailTargetBacktrackActive))
          || (direction > 0 && targetAfterVisible));

      if (localWorkWheel) {
        if (!workCompatibilityNotified) {
          workCompatibilityNotified = true;
          this.notifyCodexPlusScrollIntent(container, isNavigationCurrent);
        }
        const tailBacktrackThisStep = tailTargetBacktrackActive;
        if (tailBacktrackThisStep) tailTargetBacktrackSteps += 1;
        const stepStartedAt = nowMs(this.window);
        const outcome = await this.performWorkWheelHydrationStep({
          turnId,
          targetOrder,
          previousSnapshot: currentSnapshot,
          container,
          isCurrent: isNavigationCurrent,
          orderById,
          turnCount: indexState.turns.length,
          direction,
          getIndexState
        });
        recordStep(createNavigationTraceStep({
          mode: tailBacktrackThisStep ? "work-tail-backtrack" : "work-wheel",
          direction,
          elapsedMs: nowMs(this.window) - stepStartedAt,
          jumpPx: outcome.step,
          waitMs: outcome.waitMs,
          targetOrder,
          before: currentSnapshot,
          after: outcome.snapshot,
          outcome
        }));
        if (outcome.state === "superseded") return finish(failure("superseded", turnId));
        probes += outcome.moved ? 1 : 0;
        const nextIndex = getIndexState();
        if (nextIndex.signature !== indexState.signature) {
          lastProgressAt = nowMs(this.window);
          consecutiveStalls = 0;
        }
        indexState = nextIndex;
        snapshot = outcome.snapshot ?? this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        if (outcome.candidate) {
          lastProgressAt = nowMs(this.window);
          const aligned = await this.verifyAndAlign(turnId, outcome.candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
          consecutiveStalls = 0;
          indexState = getIndexState();
          snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
          continue;
        }
        if (outcome.progressed || outcome.moved) {
          consecutiveStalls = 0;
          lastProgressAt = nowMs(this.window);
          continue;
        }
        return finish(this.navigationFailure("work-wheel-stalled", turnId, {
          probes, stalls: 1, container, startedAt, getIndexState
        }));
      }

      const computedJump = hydrationStepSize(model, visibleOrders, targetOrder);
      const nudgeScale = consecutiveStalls > 0 ? 0.42 : 1;
      const hostJumpScale = hydrationJumpScale({
        host: conversationIdentity?.host,
        direction,
        targetBeforeVisible,
        targetDistance: currentSnapshot.targetDistance,
        chatEarlierJumpScale: this.chatEarlierJumpScale
      });
      const baseJump = computedJump * nudgeScale * hostJumpScale;
      const coalescedJump = chatFarCoalescedJump({
        baseJump,
        host: conversationIdentity?.host,
        direction,
        targetBeforeVisible,
        targetDistance: currentSnapshot.targetDistance,
        logicalPosition: model.logicalPosition,
        minLogicalPosition: model.minLogicalPosition,
        stalled: consecutiveStalls > 0
      });
      const jump = Math.max(
        Math.min(coalescedJump.jumpPx, model.maxLogicalPosition || computedJump),
        Math.min(180, model.clientHeight || 180)
      );
      const regularNextLogical = clamp(
        model.logicalPosition + direction * jump,
        model.minLogicalPosition,
        model.maxLogicalPosition
      );
      const endpointLogical = model.isColumnReverse && targetOrder === maxKnownOrder && direction > 0
        ? model.maxLogicalPosition
        : null;
      const nextLogical = endpointLogical == null ? regularNextLogical : endpointLogical;
      const remainingJumpPx = Math.abs(nextLogical - model.logicalPosition);
      const moved = remainingJumpPx >= 1;
      const chatEarlierBoundary = chatBoundaryWaitAvailable
        && conversationIdentity?.host === "chatgpt"
        && direction < 0
        && targetBeforeVisible
        && nextLogical <= model.minLogicalPosition + 1
        && remainingJumpPx <= 1;
      const motionWaitMs = conversationIdentity?.host === "chatgpt" ? this.chatMotionProgressWaitMs : this.motionProgressWaitMs;
      const stepWaitMs = chatEarlierBoundary ? this.chatBoundaryHydrationWaitMs : this.hydrationWaitMs;
      const stepStartedAt = nowMs(this.window);
      const outcome = await this.awaitHydrationProgress({
        turnId,
        targetOrder,
        previousSnapshot: currentSnapshot,
        direction,
        container,
        isCurrent: isNavigationCurrent,
        orderById,
        getIndexState,
        waitMs: stepWaitMs,
        allowMotionProgress: !chatEarlierBoundary,
        motionProgressWaitMs: motionWaitMs,
        scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
      });
      if (chatEarlierBoundary) {
        chatBoundaryWaitAvailable = Boolean(outcome.candidate || outcome.progressed);
      }
      recordStep(createNavigationTraceStep({
        mode: chatEarlierBoundary ? "chat-boundary" : coalescedJump.coalesced ? "chat-coalesced" : conversationIdentity?.host === "chatgpt" ? "chat-progressive" : "regular-progressive",
        direction,
        elapsedMs: nowMs(this.window) - stepStartedAt,
        jumpPx: remainingJumpPx,
        waitMs: chatEarlierBoundary ? stepWaitMs : motionWaitMs,
        targetOrder,
        before: currentSnapshot,
        after: outcome.snapshot,
        outcome
      }));
      if (outcome.state === "superseded") return finish(failure("superseded", turnId));
      probes += moved ? 1 : 0;
      const nextIndex = getIndexState();
      if (nextIndex.signature !== indexState.signature) {
        lastProgressAt = nowMs(this.window);
        consecutiveStalls = 0;
      }
      indexState = nextIndex;
      snapshot = outcome.snapshot ?? this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);

      if (outcome.candidate) {
        lastProgressAt = nowMs(this.window);
        const aligned = await this.verifyAndAlign(turnId, outcome.candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
        consecutiveStalls = 0;
        indexState = getIndexState();
        snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
        continue;
      }
      if (outcome.progressed) {
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
        continue;
      }

      consecutiveStalls += 1;
      if (consecutiveStalls >= this.maxConsecutiveStalls) {
        indexState = getIndexState();
        candidate = this.resolveCandidate(turnId, indexState.targetOrder);
        if (candidate) {
          const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
        }
        return finish(this.navigationFailure("hydration-stalled", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState
        }));
      }
    }

    indexState = getIndexState();
    candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    if (candidate) {
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return finish(aligned);
    }
    return finish(this.navigationFailure("navigation-hard-limit", turnId, {
      probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
      budgetLimit: probes >= this.maxHydrationSteps && !allowFirstTurnProbeOverrun ? "probes" : "absolute-time"
    }));
  }

  navigationFailure(reason, turnId, { probes = 0, stalls = 0, targetOrder = -1, orderById = null, container, startedAt, getIndexState = null, ...extra } = {}) {
    const indexState = typeof getIndexState === "function" ? getIndexState() : null;
    const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
    const currentOrderById = indexState?.orderById ?? orderById;
    const latest = this.readHydrationSnapshot(container, currentTargetOrder, currentOrderById);
    return {
      ...failure(reason, turnId),
      probes, stalls,
      targetOrder: currentTargetOrder,
      visibleRange: latest.visibleRange,
      scrollHeight: latest.scrollHeight,
      maxLogicalPosition: latest.maxLogicalPosition,
      logicalPosition: latest.logicalPosition,
      elapsedMs: Math.round(nowMs(this.window) - startedAt),
      ...extra
    };
  }

  async awaitHydrationProgress({ turnId, targetOrder, previousSnapshot, direction, container, isCurrent, orderById = null, getIndexState = null, waitMs = this.hydrationWaitMs, allowMotionProgress = true, motionProgressWaitMs = this.motionProgressWaitMs, scrollAction = null }) {
    const initialIndex = typeof getIndexState === "function" ? getIndexState() : null;
    const initialTargetOrder = Number.isFinite(initialIndex?.targetOrder) ? Number(initialIndex.targetOrder) : targetOrder;
    const initialOrderById = initialIndex?.orderById ?? orderById;
    const baselineSignature = initialIndex?.signature ?? null;
    const baseline = previousSnapshot ?? this.readHydrationSnapshot(container, initialTargetOrder, initialOrderById);
    let observer = null;
    let timer = null;
    let motionTimer = null;
    let rafId = null;
    let rafChecks = 0;
    let settled = false;
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { observer?.disconnect?.(); } catch {}
      if (timer != null) clearTimer(this.window, timer);
      if (motionTimer != null) clearTimer(this.window, motionTimer);
      if (rafId != null) this.window?.cancelAnimationFrame?.(rafId);
      resolvePromise(value);
    };
    const readIndex = () => typeof getIndexState === "function" ? getIndexState() : null;
    const readCurrentSnapshot = () => {
      const indexState = readIndex();
      const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
      const currentOrderById = indexState?.orderById ?? orderById;
      return {
        indexState,
        targetOrder: currentTargetOrder,
        snapshot: this.readHydrationSnapshot(container, currentTargetOrder, currentOrderById)
      };
    };
    const evaluate = ({ allowMotionProgress = false } = {}) => {
      if (settled) return true;
      if (!isCurrent()) {
        const current = readCurrentSnapshot();
        finish({ state: "superseded", progressed: false, snapshot: current.snapshot });
        return true;
      }
      const current = readCurrentSnapshot();
      const candidate = this.resolveCandidate(turnId, current.targetOrder);
      if (candidate) {
        finish({ state: "target", progressed: true, candidate, snapshot: current.snapshot });
        return true;
      }
      if (baselineSignature != null && current.indexState?.signature != null && current.indexState.signature !== baselineSignature) {
        finish({ state: "progress", progressed: true, indexChanged: true, snapshot: current.snapshot });
        return true;
      }
      if (hasHydrationProgress(current.targetOrder, baseline, current.snapshot, direction, { allowMotionProgress })) {
        finish({ state: "progress", progressed: true, snapshot: current.snapshot });
        return true;
      }
      return false;
    };

    const MutationObserverCtor = this.window?.MutationObserver;
    if (typeof MutationObserverCtor === "function" && container) {
      try {
        observer = new MutationObserverCtor(() => {
          evaluate({ allowMotionProgress: false });
        });
        observer.observe(container, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: HYDRATION_ATTRIBUTES
        });
      } catch {
        observer = null;
      }
    }

    const scheduleFrameCheck = () => {
      if (settled || rafChecks >= 36 || typeof this.window?.requestAnimationFrame !== "function") return;
      rafChecks += 1;
      rafId = this.window.requestAnimationFrame(() => {
        rafId = null;
        if (!evaluate({ allowMotionProgress: false })) scheduleFrameCheck();
      });
    };

    if (allowMotionProgress) {
      motionTimer = setTimer(this.window, () => {
        motionTimer = null;
        evaluate({ allowMotionProgress: true });
      }, motionProgressWaitMs);
    }

    timer = setTimer(this.window, () => {
      if (evaluate({ allowMotionProgress })) return;
      const current = readCurrentSnapshot();
      finish({ state: "stalled", progressed: false, snapshot: current.snapshot });
    }, Math.max(0, Number(waitMs) || 0));
    if (!isCurrent()) {
      const current = readCurrentSnapshot();
      finish({ state: "superseded", progressed: false, snapshot: current.snapshot });
      return promise;
    }
    try { scrollAction?.(); } catch {}
    evaluate({ allowMotionProgress: false });
    scheduleFrameCheck();
    return promise;
  }

  async performWorkWheelHydrationStep({ turnId, targetOrder, previousSnapshot, container, isCurrent, orderById, turnCount = 0, direction = -1, getIndexState = null }) {
    if (!container || !isCurrent()) return { state: "superseded", progressed: false, moved: false };
    const indexState = typeof getIndexState === "function" ? getIndexState() : null;
    const currentTargetOrder = Number.isFinite(indexState?.targetOrder) ? Number(indexState.targetOrder) : targetOrder;
    const currentOrderById = indexState?.orderById ?? orderById;
    const currentTurnCount = Array.isArray(indexState?.turns) ? indexState.turns.length : turnCount;
    const model = readScrollModel(container, this.window);
    const viewport = Math.max(240, Number(model.clientHeight) || 737);
    const configuredStep = Math.min(Math.max(240, Number(this.workWheelStepPx) || 720), viewport);
    const step = workWheelStepSize({
      configuredStep,
      viewport,
      turnCount: currentTurnCount,
      targetDistance: previousSnapshot?.targetDistance,
      logicalPosition: model.logicalPosition,
      minLogicalPosition: model.minLogicalPosition,
      maxLogicalPosition: model.maxLogicalPosition,
      direction
    });
    const nextLogical = clamp(model.logicalPosition + direction * step, model.minLogicalPosition, model.maxLogicalPosition);
    const moved = Math.abs(nextLogical - model.logicalPosition) >= 1;
    dispatchWheelEvent(container, this.window, direction * step);
    const waitMs = moved ? this.workWheelWaitMs : this.hydrationWaitMs;
    const outcome = await this.awaitHydrationProgress({
      turnId,
      targetOrder: currentTargetOrder,
      previousSnapshot,
      direction,
      container,
      isCurrent,
      orderById: currentOrderById,
      getIndexState,
      waitMs,
      allowMotionProgress: false,
      scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
    });
    return { ...outcome, moved, step, waitMs };
  }

  notifyCodexPlusScrollIntent(container, isCurrent = () => true) {
    if (!container || !isCurrent()) {
      this.compatibility = { ...createNavigationCompatibility(), status: "superseded" };
      return false;
    }
    const handlers = this.window?.__codexThreadScrollHandlers;
    const markPointerIntent = handlers?.markPointerIntent;
    if (typeof markPointerIntent !== "function") {
      this.compatibility = { ...createNavigationCompatibility(), status: "unavailable" };
      return false;
    }
    try {
      markPointerIntent.call(handlers, { target: container, type: "pointerdown" });
      this.compatibility = { ...createNavigationCompatibility(), status: "available", notified: true };
      return true;
    } catch (error) {
      this.compatibility = { ...createNavigationCompatibility(), status: "error", error: String(error?.message ?? error ?? "unknown") };
      return false;
    }
  }

  isEarlierBoundary({ tolerance = 24 } = {}) {
    const identity = this.conversationAdapter.getConversationIdentity?.() ?? null;
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return false;
    const container = this.conversationAdapter.getScrollContainer?.();
    if (!container || container.isConnected === false) return false;
    const model = readScrollModel(container, this.window);
    if (!model.isColumnReverse) return false;
    return Math.abs(Number(model.logicalPosition) - Number(model.minLogicalPosition)) <= Math.max(0, Number(tolerance) || 0);
  }

  async hydrateEarlierHistory({
    isCurrent = () => true,
    maxSteps = 96,
    maxBoundaryStalls = 3,
    stopAfterBatch = false,
    onProgress = null
  } = {}) {
    const identity = this.conversationAdapter.getConversationIdentity?.() ?? null;
    const container = this.conversationAdapter.getScrollContainer?.();
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
      return { ok: false, started: false, reason: "not-local-work", steps: 0, stalls: 0 };
    }
    if (!container || container.isConnected === false) {
      return { ok: false, started: false, reason: "missing-scroll-container", steps: 0, stalls: 0 };
    }
    const initialModel = readScrollModel(container, this.window);
    if (!initialModel.isColumnReverse) {
      return { ok: false, started: false, reason: "not-earlier-boundary", steps: 0, stalls: 0 };
    }

    this.notifyCodexPlusScrollIntent(container, isCurrent);
    let steps = 0;
    let stalls = 0;
    let snapshot = readWorkHistorySnapshot(this.turnAdapter, container, this.window);
    while (steps < Math.max(1, Number(maxSteps) || 1)
      && stalls < Math.max(1, Number(maxBoundaryStalls) || 1)) {
      if (!isCurrent() || this.conversationAdapter.getScrollContainer?.() !== container) {
        return { ok: false, started: true, reason: "superseded", steps, stalls };
      }
      const model = readScrollModel(container, this.window);
      const viewport = Math.max(240, Number(model.clientHeight) || 737);
      const step = Math.round(Math.min(Math.max(240, Number(this.workWheelStepPx) || 720), viewport * 0.9));
      const nextLogical = clamp(model.logicalPosition - step, model.minLogicalPosition, model.maxLogicalPosition);
      const moved = Math.abs(nextLogical - model.logicalPosition) >= 1;
      dispatchWheelEvent(container, this.window, -step);
      if (moved) setLogicalScrollPosition(container, nextLogical, model);
      const waitMs = moved ? this.workWheelWaitMs : this.hydrationWaitMs;
      await delay(this.window, waitMs);
      await nextFrame(this.window);
      if (!isCurrent()) return { ok: false, started: true, reason: "superseded", steps, stalls };

      const after = readWorkHistorySnapshot(this.turnAdapter, container, this.window);
      const structuralProgress = workHistorySnapshotChanged(snapshot, after);
      const motionProgress = Math.abs(Number(after.logicalPosition) - Number(snapshot.logicalPosition)) >= 1;
      const extentGrowth = Number(after.scrollHeight) > Number(snapshot.scrollHeight)
        || Number(after.maxLogicalPosition) > Number(snapshot.maxLogicalPosition);
      const boundaryExpansion = !moved && structuralProgress;
      const batchLoaded = extentGrowth || boundaryExpansion;
      const progressed = structuralProgress || motionProgress;
      steps += 1;
      if (progressed) {
        stalls = 0;
        try { onProgress?.({ steps, snapshot: after, structuralProgress, motionProgress }); } catch {}
      } else if (Math.abs(Number(after.logicalPosition) - Number(after.minLogicalPosition)) <= 24) {
        stalls += 1;
      } else {
        stalls = 0;
      }
      snapshot = after;
      if (stopAfterBatch && batchLoaded) {
        return {
          ok: true,
          started: true,
          reason: "earlier-batch-loaded",
          steps,
          stalls,
          scrollHeight: snapshot.scrollHeight,
          logicalPosition: snapshot.logicalPosition
        };
      }
    }
    return {
      ok: true,
      started: true,
      reason: stalls >= Math.max(1, Number(maxBoundaryStalls) || 1) ? "earlier-boundary-exhausted" : "step-limit",
      steps,
      stalls,
      scrollHeight: snapshot.scrollHeight,
      logicalPosition: snapshot.logicalPosition
    };
  }

  getCompatibilityStatus() {
    return { ...this.compatibility };
  }

  readVisibleOrders(orderById = null) {
    const values = [];
    for (const turn of this.turnAdapter.getVisibleTurns?.() ?? []) {
      const canonicalOrder = orderById?.get?.(String(turn?.id ?? ""));
      const order = Number.isFinite(canonicalOrder)
        ? Number(canonicalOrder)
        : Number.isFinite(turn?.order) ? Number(turn.order) : fallbackOrder(turn?.id);
      if (Number.isFinite(order)) values.push(order);
    }
    return [...new Set(values)].sort((a, b) => a - b);
  }

  readHydrationSnapshot(container, targetOrder, orderById = null) {
    return createHydrationSnapshot(targetOrder, this.readVisibleOrders(orderById), readScrollModel(container, this.window));
  }

  resolveCandidate(turnId, targetOrder = -1) {
    const direct = this.turnAdapter.resolveTurn(turnId);
    if (direct && this.turnAdapter.verifyTurnElement(turnId, direct)) return { element: direct, domId: turnId };
    if (!Number.isFinite(targetOrder) || targetOrder < 0) return null;
    const fallbackId = `fallback-turn-${targetOrder}`;
    if (fallbackId === turnId) return null;
    const fallback = this.turnAdapter.resolveTurn(fallbackId);
    if (fallback && this.turnAdapter.verifyTurnElement(fallbackId, fallback)) return { element: fallback, domId: fallbackId };
    return null;
  }

  async verifyAndAlign(turnId, candidateOrElement, isCurrent, probes, targetOrder = -1, maxKnownOrder = null, options = {}) {
    if (!isCurrent()) return failure("superseded", turnId);
    const readTargetOrder = typeof targetOrder === "function" ? targetOrder : () => targetOrder;
    const readMaxKnownOrder = typeof maxKnownOrder === "function" ? maxKnownOrder : () => maxKnownOrder;
    let candidate = candidateOrElement?.element
      ? candidateOrElement
      : { element: candidateOrElement, domId: turnId };
    if (!this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) return failure("stale-or-recycled-dom", turnId);
    const container = this.conversationAdapter.getScrollContainer();
    if (!container) return failure("missing-scroll-container", turnId);

    const alignCandidate = async () => {
      for (let frame = 0; frame < this.maxAlignFrames; frame += 1) {
        if (!isCurrent()) return failure("superseded", turnId);
        candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
        if (!candidate?.element || !this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) {
          return failure("stale-or-recycled-dom", turnId);
        }
        const rect = candidate.element.getBoundingClientRect?.();
        const containerRect = container.getBoundingClientRect?.();
        if (!rect || !containerRect) break;
        const activationLine = containerRect.top + this.activationOffset;
        const delta = rect.top - activationLine;
        if (Math.abs(delta) <= 5) break;
        const model = readScrollModel(container, this.window);
        const logicalTarget = clamp(
          model.logicalPosition + delta,
          model.minLogicalPosition,
          model.maxLogicalPosition
        );
        if (Math.abs(logicalTarget - model.logicalPosition) < 1) break;
        setLogicalScrollPosition(container, logicalTarget, model);
        await nextFrame(this.window);
      }
      return null;
    };

    const firstAlignmentFailure = await alignCandidate();
    if (firstAlignmentFailure) return firstAlignmentFailure;

    if (options?.mountedFastSettle && this.mountedFastSettleWaitMs > 0) {
      candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
      const fastRectBefore = candidate?.element?.getBoundingClientRect?.();
      const fastContainerBefore = container.getBoundingClientRect?.();
      const fastSnapshotBefore = readMountedSettleSnapshot(this.turnAdapter, container, this.window, fastRectBefore);
      if (candidate?.element
        && this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)
        && fastRectBefore
        && fastContainerBefore
        && (rectInActivationZone(fastRectBefore, fastContainerBefore, this.activationOffset)
          || isVerifiedTailEndpoint({
            targetOrder: readTargetOrder(),
            maxKnownOrder: readMaxKnownOrder(),
            rect: fastRectBefore,
            containerRect: fastContainerBefore,
            model: readScrollModel(container, this.window)
          }))) {
        await delay(this.window, this.mountedFastSettleWaitMs);
        await nextFrame(this.window);
        if (!isCurrent()) return failure("superseded", turnId);
        candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
        const fastRectAfter = candidate?.element?.getBoundingClientRect?.();
        const fastContainerAfter = container.getBoundingClientRect?.();
        const fastModelAfter = readScrollModel(container, this.window);
        const fastSnapshotAfter = readMountedSettleSnapshot(this.turnAdapter, container, this.window, fastRectAfter);
        if (candidate?.element
          && this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)
          && fastRectAfter
          && fastContainerAfter
          && mountedSettleSnapshotStable(fastSnapshotBefore, fastSnapshotAfter)) {
          if (isVerifiedTailEndpoint({
            targetOrder: readTargetOrder(),
            maxKnownOrder: readMaxKnownOrder(),
            rect: fastRectAfter,
            containerRect: fastContainerAfter,
            model: fastModelAfter
          })) {
            return {
              ok: true, target: turnId, targetOrder: readTargetOrder(), verified: true, probes,
              domId: candidate.domId, settleChecks: 1, settleMode: "mounted-fast", endpoint: "tail"
            };
          }
          if (rectInActivationZone(fastRectAfter, fastContainerAfter, this.activationOffset)) {
            return {
              ok: true, target: turnId, targetOrder: readTargetOrder(), verified: true, probes,
              domId: candidate.domId, settleChecks: 1, settleMode: "mounted-fast"
            };
          }
        }
      }
    }

    for (let settleCheck = 0; settleCheck <= this.maxPostSettleCorrections; settleCheck += 1) {
      await nextFrame(this.window);
      if (!isCurrent()) return failure("superseded", turnId);
      candidate = this.resolveCandidate(turnId, readTargetOrder()) ?? candidate;
      if (!candidate?.element || !this.turnAdapter.verifyTurnElement(candidate.domId, candidate.element)) {
        return { ...failure("post-settle-target-lost", turnId), probes, settleChecks: settleCheck };
      }
      const rect = candidate.element.getBoundingClientRect?.();
      const containerRect = container.getBoundingClientRect?.();
      if (!rect || !containerRect) return { ...failure("verification-failed", turnId), probes };
      const model = readScrollModel(container, this.window);
      if (isVerifiedTailEndpoint({
        targetOrder: readTargetOrder(),
        maxKnownOrder: readMaxKnownOrder(),
        rect,
        containerRect,
        model
      })) {
        return {
          ok: true,
          target: turnId,
          targetOrder: readTargetOrder(),
          verified: true,
          probes,
          domId: candidate.domId,
          settleChecks: settleCheck + 1,
          endpoint: "tail"
        };
      }
      if (!rectInActivationZone(rect, containerRect, this.activationOffset)) {
        if (settleCheck >= this.maxPostSettleCorrections) {
          return { ...failure("post-settle-drift", turnId), probes, settleChecks: settleCheck + 1 };
        }
        const correctionFailure = await alignCandidate();
        if (correctionFailure) return correctionFailure;
      }
      if (settleCheck < this.maxPostSettleCorrections && this.postSettleWaitMs > 0) {
        await delay(this.window, this.postSettleWaitMs);
        continue;
      }
      return {
        ok: true,
        target: turnId,
        targetOrder: readTargetOrder(),
        verified: true,
        probes,
        domId: candidate.domId,
        settleChecks: settleCheck + 1
      };
    }

    return { ...failure("post-settle-drift", turnId), probes };
  }

  async verifyAndCenter(...args) {
    return this.verifyAndAlign(...args);
  }
}

function createNavigationIndex(turnId, turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  const targetIndex = list.findIndex((turn) => turn?.id === turnId);
  const targetRecord = targetIndex >= 0 ? list[targetIndex] : null;
  const targetOrder = Number.isFinite(targetRecord?.order) ? Number(targetRecord.order) : targetIndex;
  const orderById = createTurnOrderMap(list);
  const knownOrders = [...orderById.values()].filter(Number.isFinite).sort((a, b) => a - b);
  const maxKnownOrder = knownOrders.at(-1) ?? null;
  const signature = list.map((turn, index) => {
    const order = Number.isFinite(turn?.order) ? Number(turn.order) : index;
    return `${String(turn?.id ?? "")}:${order}`;
  }).join("|");
  return { turns: list, targetIndex, targetOrder, orderById, maxKnownOrder, signature };
}

function createTurnOrderMap(turns = []) {
  const values = new Map();
  for (const [index, turn] of turns.entries()) {
    if (!turn?.id) continue;
    const order = Number.isFinite(turn.order) ? Number(turn.order) : index;
    values.set(String(turn.id), order);
  }
  return values;
}

function computeActiveTurnId({ visibleTurns = [], resolveTurn, container = null, activationOffset = 120 } = {}) {
  const containerRect = container?.getBoundingClientRect?.() ?? { top: 0, bottom: Number.POSITIVE_INFINITY, height: 800 };
  const activationLine = containerRect.top + activationOffset;
  let crossed = null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const turn of visibleTurns) {
    const rect = resolveTurn?.(turn.id)?.getBoundingClientRect?.();
    if (!rect || rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue;
    const distance = Math.abs(rect.top - activationLine);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = turn.id;
    }
    if (rect.top <= activationLine && rect.bottom > activationLine) crossed = turn.id;
  }
  return crossed ?? nearest ?? null;
}

function isVerifiedTailEndpoint({ targetOrder, maxKnownOrder, rect, containerRect, model, tolerance = 2 } = {}) {
  if (!Number.isFinite(targetOrder) || !Number.isFinite(maxKnownOrder) || targetOrder !== maxKnownOrder) return false;
  if (!model?.isColumnReverse) return false;
  if (Math.abs(Number(model.maxLogicalPosition || 0) - Number(model.logicalPosition || 0)) > tolerance) return false;
  if (!rect || !containerRect) return false;
  return Number(rect.bottom) > Number(containerRect.top) && Number(rect.top) < Number(containerRect.bottom);
}

function readMountedSettleSnapshot(turnAdapter, container, windowRef, rect) {
  const model = readScrollModel(container, windowRef);
  const visibleSignature = (turnAdapter?.getVisibleTurns?.() ?? [])
    .map((turn) => String(turn?.id ?? ""))
    .join("|");
  return {
    visibleSignature,
    scrollHeight: Number(model.scrollHeight) || 0,
    maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
    logicalPosition: Number(model.logicalPosition) || 0,
    rectTop: Number(rect?.top),
    rectBottom: Number(rect?.bottom)
  };
}

function mountedSettleSnapshotStable(before, after, tolerance = 2) {
  if (!before || !after) return false;
  if (before.visibleSignature !== after.visibleSignature) return false;
  if (Math.abs(after.scrollHeight - before.scrollHeight) > tolerance) return false;
  if (Math.abs(after.maxLogicalPosition - before.maxLogicalPosition) > tolerance) return false;
  if (Math.abs(after.logicalPosition - before.logicalPosition) > tolerance) return false;
  if (!Number.isFinite(before.rectTop) || !Number.isFinite(after.rectTop)) return false;
  if (!Number.isFinite(before.rectBottom) || !Number.isFinite(after.rectBottom)) return false;
  if (Math.abs(after.rectTop - before.rectTop) > tolerance) return false;
  if (Math.abs(after.rectBottom - before.rectBottom) > tolerance) return false;
  return true;
}

function createNavigationTraceStep({ mode, direction, elapsedMs, jumpPx, waitMs, targetOrder, before, after, outcome } = {}) {
  return {
    mode: String(mode ?? "unknown"),
    direction: Number(direction) || 0,
    elapsedMs: Math.round(Number(elapsedMs) || 0),
    jumpPx: Math.round(Number(jumpPx) || 0),
    waitMs: Math.round(Number(waitMs) || 0),
    targetOrder: Number.isFinite(targetOrder) ? Number(targetOrder) : null,
    progressKind: classifyNavigationStepProgress({ targetOrder, before, after, outcome, direction }),
    before: compactTraceSnapshot(before),
    after: compactTraceSnapshot(after)
  };
}

function compactTraceSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    visibleRange: snapshot.visibleRange ?? visibleOrderRange(snapshot.visibleOrders ?? []),
    scrollHeight: Math.round(Number(snapshot.scrollHeight) || 0),
    logicalPosition: Math.round(Number(snapshot.logicalPosition) || 0)
  };
}

function classifyNavigationStepProgress({ targetOrder, before, after, outcome, direction } = {}) {
  if (outcome?.candidate || outcome?.state === "target") return "target";
  if (outcome?.indexChanged) return "index";
  if (!after) return outcome?.progressed ? "progress" : "none";
  if (turnWindowDistance(targetOrder, after.visibleOrders ?? []) < turnWindowDistance(targetOrder, before?.visibleOrders ?? [])) return "window";
  if ((Number(after.scrollHeight) || 0) > (Number(before?.scrollHeight) || 0) + 1
    || (Number(after.maxLogicalPosition) || 0) > (Number(before?.maxLogicalPosition) || 0) + 1) return "extent";
  if (direction < 0 && (Number(after.logicalPosition) || 0) < (Number(before?.logicalPosition) || 0) - 1) return "motion";
  if (direction > 0 && (Number(after.logicalPosition) || 0) > (Number(before?.logicalPosition) || 0) + 1) return "motion";
  return outcome?.progressed ? "progress" : "none";
}

function rectInActivationZone(rect, containerRect = null, activationOffset = 120) {
  if (!rect) return false;
  const bounds = containerRect ?? { top: 0, bottom: 800, height: 800 };
  const height = Number(bounds.height) || Math.max(1, Number(bounds.bottom) - Number(bounds.top)) || 800;
  const line = Number(bounds.top || 0) + activationOffset;
  const tolerance = Math.min(42, Math.max(18, height * 0.045));
  return rect.top <= line + tolerance && rect.bottom >= line - tolerance;
}

function readScrollModel(container, windowRef = globalThis.window) {
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  return createScrollModel({
    scrollTop: container?.scrollTop,
    scrollHeight: container?.scrollHeight,
    clientHeight: container?.clientHeight,
    flexDirection
  });
}

function setLogicalScrollPosition(container, logicalPosition, model = readScrollModel(container)) {
  if (!container) return null;
  const top = scrollTopFromLogical(logicalPosition, model.maxLogicalPosition, model.isColumnReverse);
  container.scrollTop = top;
  return top;
}

function chooseHydrationDirection(targetOrder, visibleOrders = [], model = {}) {
  if (visibleOrders.length) {
    const min = visibleOrders[0];
    const max = visibleOrders[visibleOrders.length - 1];
    if (targetOrder < min) return -1;
    if (targetOrder > max) return 1;
  }
  const midpoint = (Number(model.minLogicalPosition || 0) + Number(model.maxLogicalPosition || 0)) / 2;
  return Number(model.logicalPosition || 0) > midpoint ? -1 : 1;
}

function hydrationStepSize(model = {}, visibleOrders = [], targetOrder = -1) {
  const viewport = Math.max(1, Number(model.clientHeight) || 800);
  const span = Math.max(viewport, Number(model.maxLogicalPosition) || viewport);
  let multiplier = 1.45;
  if (visibleOrders.length && Number.isFinite(targetOrder)) {
    const min = visibleOrders[0];
    const max = visibleOrders[visibleOrders.length - 1];
    const distance = targetOrder < min ? min - targetOrder : targetOrder > max ? targetOrder - max : 0;
    if (distance > 20) multiplier = 2.4;
    else if (distance > 8) multiplier = 1.9;
  }
  const proportional = Math.min(3200, Math.max(900, span * 0.06));
  return Math.min(span, Math.max(viewport * multiplier, proportional));
}

function workWheelStepSize({ configuredStep = 720, viewport = 737, turnCount = 0, targetDistance = 0, logicalPosition = 0, minLogicalPosition = 0, maxLogicalPosition = Number.POSITIVE_INFINITY, direction = -1 } = {}) {
  const safeViewport = Math.max(240, Number(viewport) || 737);
  const base = Math.min(Math.max(240, Number(configuredStep) || 720), safeViewport);
  if (Number(turnCount) <= 12) return Math.round(Math.max(180, Math.min(base, safeViewport * 0.5)));
  const distance = Math.max(0, Number(targetDistance) || 0);
  const scale = distance > 40 ? 1.35 : distance > 20 ? 1.2 : 1;
  const desired = Math.min(base * scale, safeViewport * 1.35);
  const remaining = direction > 0
    ? Math.max(0, Number(maxLogicalPosition) - Number(logicalPosition))
    : Math.max(0, Number(logicalPosition) - Number(minLogicalPosition));
  return Math.round(remaining > 0 ? Math.min(desired, remaining) : desired);
}

function hydrationJumpScale({ host = null, direction = 0, targetBeforeVisible = false, targetDistance = 0, chatEarlierJumpScale = 1.35 } = {}) {
  if (host !== "chatgpt" || direction >= 0 || !targetBeforeVisible) return 1;
  const base = Math.max(1, Number(chatEarlierJumpScale) || 1);
  const distance = Math.max(0, Number(targetDistance) || 0);
  if (distance > 40) return Math.max(base, 1.75);
  if (distance > 20) return Math.max(base, 1.55);
  return base;
}

function chatFarCoalescedJump({ baseJump = 0, host = null, direction = 0, targetBeforeVisible = false, targetDistance = 0, logicalPosition = 0, minLogicalPosition = 0, stalled = false } = {}) {
  const base = Math.max(0, Number(baseJump) || 0);
  const availableEarlier = Math.max(0, Number(logicalPosition) - Number(minLogicalPosition));
  const eligible = host === "chatgpt"
    && direction < 0
    && targetBeforeVisible
    && Number(targetDistance) > 40
    && !stalled
    && availableEarlier > base * 1.6;
  if (!eligible) return { jumpPx: base, coalesced: false };
  return { jumpPx: Math.round(Math.min(base * 1.35, 7600, availableEarlier)), coalesced: true };
}

function turnWindowDistance(targetOrder, orders = []) {
  if (!Number.isFinite(targetOrder) || !orders.length) return Number.POSITIVE_INFINITY;
  const sorted = [...orders].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.POSITIVE_INFINITY;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (targetOrder < min) return min - targetOrder;
  if (targetOrder > max) return targetOrder - max;
  return 0;
}

function createHydrationSnapshot(targetOrder, orders = [], model = {}) {
  const visibleOrders = [...orders].filter(Number.isFinite).sort((a, b) => a - b);
  return {
    visibleOrders,
    visibleRange: visibleOrderRange(visibleOrders),
    targetDistance: turnWindowDistance(targetOrder, visibleOrders),
    scrollHeight: Number(model.scrollHeight) || 0,
    clientHeight: Number(model.clientHeight) || 0,
    maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
    logicalPosition: Number(model.logicalPosition) || 0
  };
}

function hasHydrationProgress(targetOrder, before, after, direction = 0, { allowMotionProgress = true } = {}) {
  if (!after) return false;
  if (!before) return true;
  if (turnWindowDistance(targetOrder, after.visibleOrders) < turnWindowDistance(targetOrder, before.visibleOrders)) return true;
  if (after.scrollHeight > before.scrollHeight + 1) return true;
  if (after.maxLogicalPosition > before.maxLogicalPosition + 1) return true;
  if (!allowMotionProgress) return false;
  if (direction < 0 && after.logicalPosition < before.logicalPosition - 1) return true;
  if (direction > 0 && after.logicalPosition > before.logicalPosition + 1) return true;
  return false;
}

function hasTurnWindowProgress(targetOrder, beforeOrders = [], afterOrders = []) {
  return turnWindowDistance(targetOrder, afterOrders) < turnWindowDistance(targetOrder, beforeOrders);
}

function visibleOrderRange(orders = []) {
  if (!orders.length) return null;
  return { min: orders[0], max: orders[orders.length - 1] };
}

function retryableAlignmentFailure(reason) {
  return reason === "stale-or-recycled-dom"
    || reason === "post-settle-target-lost"
    || reason === "post-settle-drift";
}

function fallbackOrder(id) {
  const match = String(id ?? "").match(FALLBACK_TURN);
  return match ? Number.parseInt(match[1], 10) : null;
}

function readWorkHistorySnapshot(turnAdapter, container, windowRef) {
  const model = readScrollModel(container, windowRef);
  return {
    visibleSignature: (turnAdapter?.getVisibleTurns?.() ?? []).map((turn) => String(turn?.id ?? "")).join("|"),
    scrollHeight: Number(model.scrollHeight) || 0,
    maxLogicalPosition: Number(model.maxLogicalPosition) || 0,
    minLogicalPosition: Number(model.minLogicalPosition) || 0,
    logicalPosition: Number(model.logicalPosition) || 0
  };
}

function workHistorySnapshotChanged(before, after) {
  if (!before || !after) return false;
  return before.visibleSignature !== after.visibleSignature
    || Math.abs(Number(after.scrollHeight) - Number(before.scrollHeight)) >= 1
    || Math.abs(Number(after.maxLogicalPosition) - Number(before.maxLogicalPosition)) >= 1;
}

function dispatchWheelEvent(container, windowRef = globalThis.window, deltaY = -720) {
  if (!container?.dispatchEvent) return false;
  try {
    const WheelCtor = windowRef?.WheelEvent ?? globalThis.WheelEvent;
    const event = typeof WheelCtor === "function"
      ? new WheelCtor("wheel", { deltaY, deltaMode: 0, bubbles: true, cancelable: true })
      : { type: "wheel", deltaY, deltaMode: 0, bubbles: true, cancelable: true };
    container.dispatchEvent(event);
    return true;
  } catch {
    return false;
  }
}


function nextFrame(windowRef) {
  return new Promise((resolve) => {
    if (typeof windowRef?.requestAnimationFrame === "function") windowRef.requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function delay(windowRef, milliseconds) {
  return new Promise((resolve) => setTimer(windowRef, resolve, milliseconds));
}

function setTimer(windowRef, callback, delayMs) {
  return typeof windowRef?.setTimeout === "function" ? windowRef.setTimeout(callback, delayMs) : setTimeout(callback, delayMs);
}

function clearTimer(windowRef, timer) {
  if (typeof windowRef?.clearTimeout === "function") windowRef.clearTimeout(timer);
  else clearTimeout(timer);
}

function nowMs(windowRef) {
  return Number(windowRef?.performance?.now?.()) || Date.now();
}

function createNavigationCompatibility() {
  return {
    feature: "codex-plus-thread-scroll-restore",
    status: "not-needed",
    notified: false,
    error: ""
  };
}

function failure(reason, target) {
  return { ok: false, reason, target, verified: false };
}

Object.assign(exports, { WorkNavigationAdapter, computeActiveTurnId, rectInActivationZone, readScrollModel, setLogicalScrollPosition, chooseHydrationDirection, hydrationStepSize, workWheelStepSize, hydrationJumpScale, chatFarCoalescedJump, turnWindowDistance, createHydrationSnapshot, hasHydrationProgress, hasTurnWindowProgress, visibleOrderRange });

},
"src/v3/host/codex-desktop/host-contract.js": (module, exports, __require) => {
const { SURFACE } = __require("src/v3/host/host-interface.js");

const HOST_CONTRACT_REVISION = "codex-desktop-v1";
const HOST_CONTRACT_STATUS = Object.freeze({
  READY: "ready",
  DEGRADED: "degraded",
  UNKNOWN: "unknown",
  UNAVAILABLE: "unavailable",
  OPTIONAL_UNAVAILABLE: "optional-unavailable"
});

const FALLBACK_TURN = /^fallback-turn-\d+$/;

class HostContractDiagnostics {
  constructor({ document, window, conversationAdapter, turnAdapter, composerAdapter, surfaceDetector, capture } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.conversationAdapter = conversationAdapter;
    this.turnAdapter = turnAdapter;
    this.composerAdapter = composerAdapter;
    this.surfaceDetector = surfaceDetector;
    this.capture = capture;
  }

  inspect() {
    const surface = this.surfaceDetector?.getSurface?.() ?? SURFACE.OTHER;
    const conversationId = this.conversationAdapter?.getConversationId?.() ?? null;
    const conversationRoot = this.conversationAdapter?.getConversationRoot?.() ?? null;
    const scrollContainer = this.conversationAdapter?.getScrollContainer?.() ?? null;
    const visibleTurns = this.turnAdapter?.getVisibleTurns?.() ?? [];
    const composer = this.composerAdapter?.getComposer?.() ?? null;
    const rendererScheme = readRendererScheme(this.window?.location);
    const flexDirection = scrollContainer
      ? (this.window?.getComputedStyle?.(scrollContainer)?.flexDirection ?? scrollContainer?.style?.flexDirection ?? "")
      : "";

    return evaluateHostContract({
      surface,
      rendererScheme,
      conversationId,
      conversationRoot,
      scrollContainer,
      visibleTurns,
      composer,
      flexDirection,
      captureInstalled: Boolean(this.capture?.installed),
      fetchAvailable: typeof this.window?.fetch === "function"
    });
  }
}

function evaluateHostContract({
  surface = SURFACE.OTHER,
  rendererScheme = "",
  conversationId = null,
  conversationRoot = null,
  scrollContainer = null,
  visibleTurns = [],
  composer = null,
  flexDirection = "",
  captureInstalled = false,
  fetchAvailable = false
} = {}) {
  const isConversation = surface === SURFACE.CONVERSATION;
  const isNewChat = surface === SURFACE.NEW_CHAT;
  const turns = Array.isArray(visibleTurns) ? visibleTurns : [];
  const turnIdMode = classifyTurnIdMode(turns);
  const scrollable = Boolean(scrollContainer)
    && Number(scrollContainer?.scrollHeight ?? 0) > Number(scrollContainer?.clientHeight ?? 0);

  const renderer = {
    status: rendererScheme === "app:" ? HOST_CONTRACT_STATUS.READY : HOST_CONTRACT_STATUS.UNKNOWN,
    scheme: rendererScheme || "unknown"
  };
  const surfaceReport = { status: HOST_CONTRACT_STATUS.READY, value: surface };
  const conversation = isConversation
    ? {
        status: conversationId && conversationRoot ? HOST_CONTRACT_STATUS.READY : HOST_CONTRACT_STATUS.UNAVAILABLE,
        required: true,
        idDetected: Boolean(conversationId),
        rootDetected: Boolean(conversationRoot)
      }
    : {
        status: HOST_CONTRACT_STATUS.READY,
        required: false,
        idDetected: Boolean(conversationId),
        rootDetected: Boolean(conversationRoot)
      };
  const scroll = isConversation
    ? {
        status: !scrollContainer
          ? HOST_CONTRACT_STATUS.UNAVAILABLE
          : scrollable
            ? HOST_CONTRACT_STATUS.READY
            : HOST_CONTRACT_STATUS.DEGRADED,
        required: true,
        containerDetected: Boolean(scrollContainer),
        scrollable,
        flexDirection: flexDirection || "unknown"
      }
    : {
        status: HOST_CONTRACT_STATUS.READY,
        required: false,
        containerDetected: Boolean(scrollContainer),
        scrollable,
        flexDirection: flexDirection || "unknown"
      };
  const turnsReport = isConversation
    ? {
        status: turns.length > 0 ? HOST_CONTRACT_STATUS.READY : HOST_CONTRACT_STATUS.UNKNOWN,
        required: true,
        visibleCount: turns.length,
        idMode: turnIdMode,
        fallbackIds: turnIdMode === "fallback" || turnIdMode === "mixed"
      }
    : {
        status: HOST_CONTRACT_STATUS.READY,
        required: false,
        visibleCount: turns.length,
        idMode: turnIdMode,
        fallbackIds: turnIdMode === "fallback" || turnIdMode === "mixed"
      };
  const composerReport = {
    status: composer
      ? HOST_CONTRACT_STATUS.READY
      : isNewChat
        ? HOST_CONTRACT_STATUS.UNAVAILABLE
        : isConversation
          ? HOST_CONTRACT_STATUS.DEGRADED
          : HOST_CONTRACT_STATUS.READY,
    required: isNewChat || isConversation,
    detected: Boolean(composer)
  };
  const navigation = isConversation
    ? {
        status: scroll.status === HOST_CONTRACT_STATUS.UNAVAILABLE
          || conversation.status === HOST_CONTRACT_STATUS.UNAVAILABLE
            ? HOST_CONTRACT_STATUS.UNAVAILABLE
            : turnsReport.status === HOST_CONTRACT_STATUS.READY
              ? HOST_CONTRACT_STATUS.READY
              : HOST_CONTRACT_STATUS.UNKNOWN,
        required: true
      }
    : { status: HOST_CONTRACT_STATUS.READY, required: false };
  const capture = {
    status: captureInstalled
      ? HOST_CONTRACT_STATUS.READY
      : HOST_CONTRACT_STATUS.OPTIONAL_UNAVAILABLE,
    required: false,
    installed: Boolean(captureInstalled),
    fetchAvailable: Boolean(fetchAvailable)
  };

  const required = [conversation, scroll, turnsReport, composerReport, navigation].filter((item) => item.required);
  const status = required.some((item) => item.status === HOST_CONTRACT_STATUS.UNAVAILABLE)
    ? HOST_CONTRACT_STATUS.UNAVAILABLE
    : required.some((item) => item.status === HOST_CONTRACT_STATUS.DEGRADED)
      ? HOST_CONTRACT_STATUS.DEGRADED
      : HOST_CONTRACT_STATUS.READY;

  return {
    revision: HOST_CONTRACT_REVISION,
    status,
    renderer,
    surface: surfaceReport,
    conversation,
    scroll,
    turns: turnsReport,
    composer: composerReport,
    navigation,
    capture
  };
}

function classifyTurnIdMode(turns = []) {
  const ids = (Array.isArray(turns) ? turns : []).map((turn) => String(turn?.id ?? "")).filter(Boolean);
  if (!ids.length) return "unknown";
  const fallbackCount = ids.filter((id) => FALLBACK_TURN.test(id)).length;
  if (fallbackCount === ids.length) return "fallback";
  if (fallbackCount === 0) return "stable";
  return "mixed";
}

function readRendererScheme(location) {
  const protocol = String(location?.protocol ?? "").trim();
  if (protocol) return protocol;
  const href = String(location?.href ?? "").trim();
  const match = href.match(/^([a-z][a-z0-9+.-]*:)/i);
  return match?.[1]?.toLowerCase?.() ?? "";
}
Object.assign(exports, { HOST_CONTRACT_REVISION, HOST_CONTRACT_STATUS, HostContractDiagnostics, evaluateHostContract, classifyTurnIdMode });

},
"src/v3/host/codex-desktop/codex-host.js": (module, exports, __require) => {
const { HostInterface } = __require("src/v3/host/host-interface.js");
const { ConversationAdapter, isStableLocalThreadIdentity } = __require("src/v3/host/codex-desktop/conversation-adapter.js");
const { TurnAdapter } = __require("src/v3/host/codex-desktop/turn-adapter.js");
const { WorkTurnAdapter } = __require("src/v3/host/codex-desktop/work-turn-adapter.js");
const { ComposerAdapter } = __require("src/v3/host/codex-desktop/composer-adapter.js");
const { OverlayDetector } = __require("src/v3/host/codex-desktop/overlay-detector.js");
const { SurfaceDetector } = __require("src/v3/host/codex-desktop/surface-detector.js");
const { ConversationCapture } = __require("src/v3/host/codex-desktop/conversation-capture.js");
const { NavigationAdapter, computeActiveTurnId } = __require("src/v3/host/codex-desktop/navigation-adapter.js");
const { WorkNavigationAdapter } = __require("src/v3/host/codex-desktop/work-navigation-adapter.js");
const { HostContractDiagnostics } = __require("src/v3/host/codex-desktop/host-contract.js");

function computeTailActiveTurnId({ visibleTurns = [], resolveTurn, container = null, windowRef = globalThis.window, tolerance = 2 } = {}) {
  if (!container) return null;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  if (flexDirection !== "column-reverse") return null;
  const scrollTop = Number(container.scrollTop);
  if (!Number.isFinite(scrollTop) || Math.abs(scrollTop) > tolerance) return null;
  const scrollHeight = Number(container.scrollHeight);
  const clientHeight = Number(container.clientHeight);
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight) || scrollHeight <= clientHeight + tolerance) return null;
  const containerRect = container.getBoundingClientRect?.();
  if (!containerRect) return null;

  let tailTurnId = null;
  let tailTop = Number.NEGATIVE_INFINITY;
  let tailBottom = Number.NEGATIVE_INFINITY;
  for (const turn of visibleTurns) {
    if (!turn?.id) continue;
    const rect = resolveTurn?.(turn.id)?.getBoundingClientRect?.();
    if (!rect) continue;
    if (rect.top >= containerRect.bottom) return null;
    if (rect.bottom <= containerRect.top) continue;
    if (rect.top > tailTop || (rect.top === tailTop && rect.bottom > tailBottom)) {
      tailTurnId = turn.id;
      tailTop = rect.top;
      tailBottom = rect.bottom;
    }
  }
  return tailTurnId;
}

class CodexDesktopHost extends HostInterface {
  constructor({ document, window, onCapture, onCaptureStatus } = {}) {
    super();
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.conversation = new ConversationAdapter({ document: this.document, window: this.window });
    this.chatTurns = new TurnAdapter({ document: this.document });
    this.workTurns = new WorkTurnAdapter({ document: this.document });
    this.lastHostMode = null;
    this.turns = createRoutedTurnAdapter(this);
    this.composer = new ComposerAdapter({ document: this.document, window: this.window });
    this.overlay = new OverlayDetector({ document: this.document });
    this.surface = new SurfaceDetector({
      document: this.document,
      window: this.window,
      conversationAdapter: this.conversation,
      overlayDetector: this.overlay
    });
    this.chatNavigation = new NavigationAdapter({
      window: this.window,
      conversationAdapter: this.conversation,
      activationOffset: 120,
      maxHydrationSteps: 256,
      maxConsecutiveStalls: 4,
      hydrationWaitMs: 900,
      inactivityNavigationMs: 5000,
      absoluteMaxNavigationMs: 45000,
      postSettleWaitMs: 160,
      maxPostSettleCorrections: 2,
      turnAdapter: this.chatTurns
    });
    this.workNavigation = new WorkNavigationAdapter({
      window: this.window,
      conversationAdapter: this.conversation,
      activationOffset: 120,
      maxHydrationSteps: 256,
      maxConsecutiveStalls: 4,
      hydrationWaitMs: 900,
      inactivityNavigationMs: 5000,
      absoluteMaxNavigationMs: 45000,
      postSettleWaitMs: 160,
      maxPostSettleCorrections: 2,
      turnAdapter: this.workTurns
    });
    this.navigation = createRoutedNavigationAdapter(this);
    this.capture = new ConversationCapture({
      window: this.window,
      onCapture,
      onStatus: onCaptureStatus
    });
    this.contract = new HostContractDiagnostics({
      document: this.document,
      window: this.window,
      conversationAdapter: this.conversation,
      turnAdapter: this.turns,
      composerAdapter: this.composer,
      surfaceDetector: this.surface,
      capture: this.capture
    });
    this.navigationRequestId = 0;
    this.hostTailIntentGeneration = 0;
    this.boundHostPointerDown = (event) => this.handleHostPointerDown(event);
  }

  start() {
    this.capture.install();
    this.window?.addEventListener?.("pointerdown", this.boundHostPointerDown, true);
    return this;
  }

  getSurface() {
    return this.surface.getSurface();
  }

  isPromptOverlayBlocked() {
    if (this.overlay.isBlockingDialogOpen?.()) return true;
    return this.overlay.isPromptFloatingLayerOpen?.({ composerRect: this.getComposerRect?.() ?? null }) ?? false;
  }

  getConversationId() {
    return this.conversation.getConversationId();
  }

  getConversationIdentity() {
    return this.conversation.getConversationIdentity();
  }

  getDirectConversationIdentity() {
    return this.conversation.getDirectConversationIdentity?.() ?? null;
  }

  setInferredChatConversationId(conversationId) {
    return this.conversation.setInferredChatConversationId?.(conversationId) ?? false;
  }

  clearInferredChatConversationId() {
    return this.conversation.clearInferredChatConversationId?.() ?? false;
  }

  getChatVisibleTurns() {
    return this.chatTurns.getVisibleTurns?.() ?? [];
  }

  getRoute() {
    return this.conversation.getRoute();
  }

  getHostMode() {
    const identity = this.conversation.getConversationIdentity?.() ?? null;
    const conversationId = this.conversation.getConversationId?.() ?? null;
    if (identity?.host === "local" || String(conversationId ?? "").startsWith("local:")) {
      this.lastHostMode = "work";
      return "work";
    }
    if (identity?.host === "chatgpt") {
      this.lastHostMode = "chat";
      return "chat";
    }
    return this.lastHostMode ?? "chat";
  }

  getTurnAdapter() {
    return this.getHostMode() === "work" ? this.workTurns : this.chatTurns;
  }

  getNavigationAdapter() {
    return this.getHostMode() === "work" ? this.workNavigation : this.chatNavigation;
  }

  getVisibleTurns() {
    return this.turns.getVisibleTurns();
  }

  resolveTurn(turnId) {
    return this.turns.resolveTurn(turnId);
  }

  getActiveTurnId() {
    const visibleTurns = this.getVisibleTurns();
    const container = this.getScrollContainer();
    const resolveTurn = (turnId) => this.resolveTurn(turnId);
    const tailActiveTurnId = computeTailActiveTurnId({
      visibleTurns,
      resolveTurn,
      container,
      windowRef: this.window
    });
    if (tailActiveTurnId) return tailActiveTurnId;
    const identity = this.getConversationIdentity();
    const activationOffset = identity?.stable && identity?.host === "local" && identity?.source === "sidebar-local" ? 132 : 120;
    return computeActiveTurnId({
      visibleTurns,
      resolveTurn,
      container,
      activationOffset
    });
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true, allowMountedFastSettle = false, onTraceStep = null } = {}) {
    const requestId = ++this.navigationRequestId;
    const stillCurrent = () => requestId === this.navigationRequestId && isCurrent();
    const result = await this.navigation.navigateToTurn(turnId, {
      turns,
      getTurns,
      isCurrent: stillCurrent,
      allowMountedFastSettle,
      onTraceStep
    });
    if (result?.ok && result?.verified && stillCurrent()) this.persistLocalScrollPosition();
    return result;
  }

  notifyNavigationIntent() {
    const container = this.getScrollContainer();
    if (!container || container.isConnected === false) return false;
    return this.getNavigationAdapter()?.notifyCodexPlusScrollIntent?.(container, () => true) ?? false;
  }

  isWorkEarlierBoundary() {
    if (this.getHostMode() !== "work") return false;
    return this.workNavigation?.isEarlierBoundary?.() ?? false;
  }

  hydrateWorkEarlierHistory(options = {}) {
    if (this.getHostMode() !== "work") {
      return Promise.resolve({ ok: false, started: false, reason: "not-work" });
    }
    return this.workNavigation?.hydrateEarlierHistory?.(options)
      ?? Promise.resolve({ ok: false, started: false, reason: "unsupported" });
  }

  hydrateChatEarlierHistory(options = {}) {
    if (this.getHostMode() !== "chat") {
      return Promise.resolve({ ok: false, started: false, reason: "not-chat" });
    }
    return this.chatNavigation?.hydrateEarlierHistory?.(options)
      ?? Promise.resolve({ ok: false, started: false, reason: "unsupported" });
  }

  sweepLoadedChatHistory(options = {}) {
    if (this.getHostMode() !== "chat") {
      return Promise.resolve({ ok: false, started: false, reason: "not-chat" });
    }
    return this.chatNavigation?.sweepLoadedChatHistory?.(options)
      ?? Promise.resolve({ ok: false, started: false, reason: "unsupported" });
  }

  handleHostPointerDown(event) {
    const identity = this.getConversationIdentity();
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return false;
    const container = this.getScrollContainer();
    if (!container || container.isConnected === false) return false;
    const button = findHostTailButtonCandidate(event?.target, container);
    if (!button) return false;

    const notified = this.workNavigation?.notifyCodexPlusScrollIntent?.(container, () => true) ?? false;
    if (!notified) return false;
    const generation = ++this.hostTailIntentGeneration;
    const delays = [0, 60, 180, 360];
    const set = this.window?.setTimeout ?? setTimeout;
    const check = (index) => {
      if (generation !== this.hostTailIntentGeneration) return;
      set(() => {
        if (generation !== this.hostTailIntentGeneration) return;
        const currentIdentity = this.getConversationIdentity();
        if (!currentIdentity?.stable || currentIdentity.id !== identity.id || currentIdentity.host !== "local" || currentIdentity.source !== "sidebar-local") return;
        if (this.getScrollContainer() !== container || container.isConnected === false) return;
        if (isPhysicalScrollTail(container, this.window)) {
          this.persistLocalScrollPosition();
          this.hostTailIntentGeneration += 1;
          return;
        }
        const nearTailTolerance = Math.min(96, Math.max(36, Number(container.clientHeight || 0) * 0.08));
        if (index >= 2 && distanceToPhysicalScrollTail(container, this.window) <= nearTailTolerance) {
          snapToPhysicalScrollTail(container, this.window);
          this.persistLocalScrollPosition();
          this.hostTailIntentGeneration += 1;
          return;
        }
        if (index + 1 < delays.length) check(index + 1);
      }, delays[index] ?? 0);
    };
    check(0);
    return true;
  }

  persistLocalScrollPosition() {
    const identity = this.getConversationIdentity();
    if (!identity?.stable || identity.source !== "sidebar-local") return false;
    if (!isStableLocalThreadIdentity(identity.id, { host: identity.host, kind: identity.kind })) return false;
    const container = this.getScrollContainer();
    if (!container || container.isConnected === false) return false;
    if (!(Number(container.scrollHeight) > 0) || !(Number(container.clientHeight) > 0)) return false;
    const handlers = this.window?.__codexThreadScrollHandlers;
    const saveNow = handlers?.saveNow;
    if (typeof saveNow !== "function") return false;
    const sessionId = String(identity.id).slice("local:".length);
    try {
      saveNow.call(handlers, sessionId, container);
      return true;
    } catch {
      return false;
    }
  }
  cancelNavigation() {
    this.navigationRequestId += 1;
  }

  getComposer() {
    return this.composer.getComposer();
  }

  getComposerForm() {
    return this.composer.getComposerForm();
  }

  getComposerRect() {
    return this.composer.getComposerRect();
  }

  insertPrompt(text) {
    return this.composer.insertText(text);
  }

  isMediaViewerOpen() {
    return this.overlay.isMediaViewerOpen();
  }

  getScrollContainer() {
    return this.conversation.getScrollContainer();
  }

  getConversationViewportElement() {
    return this.conversation.getScrollContainer?.() ?? this.conversation.getConversationRoot?.() ?? null;
  }

  getConversationViewportRect() {
    return this.getConversationViewportElement()?.getBoundingClientRect?.() ?? null;
  }

  getCompatibilityReport() {
    return this.contract.inspect();
  }

  getNavigationCompatibility() {
    return this.navigation.getCompatibilityStatus?.() ?? null;
  }

  getTheme() {
    const root = this.document?.documentElement;
    const explicit = root?.getAttribute?.("data-theme") ?? root?.getAttribute?.("data-color-scheme");
    if (explicit === "light" || explicit === "dark") return explicit;
    if (root?.classList?.contains?.("dark")) return "dark";
    return this.window?.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  destroy() {
    this.cancelNavigation();
    this.hostTailIntentGeneration += 1;
    this.window?.removeEventListener?.("pointerdown", this.boundHostPointerDown, true);
    this.capture.dispose();
  }
}

function findHostTailButtonCandidate(target, container) {
  let button = target ?? null;
  while (button && String(button.tagName ?? "").toUpperCase() !== "BUTTON") button = button.parentElement ?? null;
  if (!button) return null;
  for (let node = button; node; node = node.parentElement ?? null) {
    if (node.getAttribute?.("data-gte-component")) return null;
  }
  const buttonRect = button.getBoundingClientRect?.();
  const containerRect = container?.getBoundingClientRect?.();
  if (!buttonRect || !containerRect) return null;
  const width = Number(buttonRect.width) || Math.max(0, Number(buttonRect.right) - Number(buttonRect.left));
  const height = Number(buttonRect.height) || Math.max(0, Number(buttonRect.bottom) - Number(buttonRect.top));
  if (width < 20 || height < 20 || width > 72 || height > 72) return null;
  const containerWidth = Number(containerRect.width) || Math.max(0, Number(containerRect.right) - Number(containerRect.left));
  const containerHeight = Number(containerRect.height) || Math.max(0, Number(containerRect.bottom) - Number(containerRect.top));
  if (!(containerWidth > 0) || !(containerHeight > 0)) return null;
  const centerX = (Number(buttonRect.left) + Number(buttonRect.right)) / 2;
  const centerY = (Number(buttonRect.top) + Number(buttonRect.bottom)) / 2;
  const minX = Number(containerRect.left) + containerWidth * 0.28;
  const maxX = Number(containerRect.right) - containerWidth * 0.28;
  const minY = Number(containerRect.top) + containerHeight * 0.55;
  const maxY = Number(containerRect.bottom) + 48;
  return centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY ? button : null;
}

function distanceToPhysicalScrollTail(container, windowRef = globalThis.window) {
  if (!container) return Number.POSITIVE_INFINITY;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  const scrollTop = Number(container.scrollTop);
  if (!Number.isFinite(scrollTop)) return Number.POSITIVE_INFINITY;
  if (flexDirection === "column-reverse") return Math.abs(scrollTop);
  const max = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
  return Math.abs(max - scrollTop);
}

function snapToPhysicalScrollTail(container, windowRef = globalThis.window) {
  if (!container) return false;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  if (flexDirection === "column-reverse") container.scrollTop = 0;
  else container.scrollTop = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
  return true;
}

function isPhysicalScrollTail(container, windowRef = globalThis.window, tolerance = 3) {
  if (!container) return false;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  const scrollTop = Number(container.scrollTop);
  if (!Number.isFinite(scrollTop)) return false;
  if (flexDirection === "column-reverse") return Math.abs(scrollTop) <= tolerance;
  const max = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
  return Math.abs(max - scrollTop) <= tolerance;
}

function createRoutedTurnAdapter(host) {
  return {
    getVisibleTurns: (...args) => host.getTurnAdapter()?.getVisibleTurns?.(...args) ?? [],
    resolveTurn: (...args) => host.getTurnAdapter()?.resolveTurn?.(...args) ?? null,
    verifyTurnElement: (...args) => Boolean(host.getTurnAdapter()?.verifyTurnElement?.(...args))
  };
}

function createRoutedNavigationAdapter(host) {
  return {
    navigateToTurn: (...args) => host.getNavigationAdapter()?.navigateToTurn?.(...args),
    getCompatibilityStatus: () => host.getNavigationAdapter()?.getCompatibilityStatus?.() ?? null
  };
}

Object.assign(exports, { computeTailActiveTurnId, CodexDesktopHost });

},
"src/v3/ui/timeline/timeline-rail.js": (module, exports, __require) => {
const { sampleRailMarkers } = __require("src/v3/core/timeline-state.js");
const { normalizeQuestionDisplayText } = __require("src/v3/core/question-display.js");

class TimelineRail {
  constructor({ document, onSelect, onTogglePanel, maxMarkers = 28 } = {}) {
    this.document = document ?? globalThis.document;
    this.onSelect = onSelect ?? (() => {});
    this.onTogglePanel = onTogglePanel ?? (() => {});
    this.maxMarkers = maxMarkers;
    this.element = null;
    this.markers = null;
    this.toggle = null;
    this.signature = "";
    this.rightInset = 10;
    this.pendingTurnId = null;
  }

  mount(root) {
    if (this.element) return this.element;
    const rail = this.document.createElement("nav");
    rail.className = "gte-timeline-rail";
    rail.setAttribute("aria-label", "Conversation timeline");

    const markers = this.document.createElement("div");
    markers.className = "gte-rail-markers";

    const toggle = this.document.createElement("button");
    toggle.type = "button";
    toggle.className = "gte-rail-toggle";
    toggle.textContent = "\u2637";
    toggle.title = "提问列表";
    toggle.setAttribute("aria-label", "提问列表");
    toggle.addEventListener("click", () => this.onTogglePanel());

    rail.append(markers, toggle);
    root.append(rail);
    this.element = rail;
    this.markers = markers;
    this.toggle = toggle;
    this.setRightInset(this.rightInset);
    return rail;
  }

  setState(turns, activeTurnId) {
    if (!this.markers) return;
    const source = Array.isArray(turns) ? turns : [];
    const sampled = sampleRailMarkers(source, activeTurnId, this.maxMarkers);
    const nextSignature = sampled.map((turn) => `${turn.id}:${turn.order}`).join("|") + `|${activeTurnId ?? ""}`;
    if (nextSignature === this.signature) return;
    this.signature = nextSignature;
    this.markers.replaceChildren();

    const finiteOrders = source.map((turn, index) => Number.isFinite(turn?.order) ? Number(turn.order) : index);
    const maxOrder = Math.max(0, ...finiteOrders);
    for (const [sampleIndex, turn] of sampled.entries()) {
      const sourceIndex = source.findIndex((candidate) => candidate.id === turn.id);
      const order = Number.isFinite(turn?.order) ? Number(turn.order) : Math.max(0, sourceIndex);
      const ratio = maxOrder > 0 ? Math.max(0, Math.min(1, order / maxOrder)) : sampled.length <= 1 ? 0 : sampleIndex / (sampled.length - 1);
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "gte-rail-marker";
      if (turn.id === activeTurnId) button.classList.add("is-active");
      if (turn.id === this.pendingTurnId) button.classList.add("is-pending");
      button.dataset.turnId = turn.id;
      button.dataset.turnOrder = String(order);
      button.style.top = `${(ratio * 100).toFixed(3)}%`;
      const displayText = normalizeQuestionDisplayText(turn.text);
      const shortText = compactRailTooltip(displayText);
      button.title = shortText ? `Q${order + 1} · ${shortText}` : `Q${order + 1}`;
      button.setAttribute("aria-label", displayText ? `Q${order + 1} ${displayText}` : `Q${order + 1}`);
      button.addEventListener("click", () => this.onSelect(turn.id));
      this.markers.append(button);
    }
  }

  setPending(turnId) {
    if (this.pendingTurnId === turnId) return;
    const previous = this.pendingTurnId;
    this.pendingTurnId = turnId ?? null;
    if (previous) this.findMarker(previous)?.classList.remove("is-pending");
    if (this.pendingTurnId) this.findMarker(this.pendingTurnId)?.classList.add("is-pending");
  }

  findMarker(turnId) {
    if (!turnId || !this.markers) return null;
    for (const marker of this.markers.children ?? []) if (marker.dataset?.turnId === turnId) return marker;
    return null;
  }

  setRightInset(value) {
    const numeric = Number(value);
    this.rightInset = Number.isFinite(numeric) ? Math.max(10, Math.round(numeric)) : 10;
    if (this.element) this.element.style.right = `${this.rightInset}px`;
    return this.rightInset;
  }

  setVisible(visible) {
    if (this.element) this.element.hidden = !visible;
  }

  getAnchorRect() {
    return this.element?.getBoundingClientRect?.() ?? null;
  }

  destroy() {
    this.element?.remove?.();
    this.element = null;
    this.markers = null;
    this.toggle = null;
    this.pendingTurnId = null;
  }
}

function compactRailTooltip(value, maxLength = 18) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

Object.assign(exports, { TimelineRail });

},
"src/v3/ui/timeline/question-list.js": (module, exports, __require) => {
const { normalizeQuestionDisplayText } = __require("src/v3/core/question-display.js");

class QuestionListPanel {
  constructor({ document, window, onSelect, onOpenChange, onLoadEarlier, getAnchorRect } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.onSelect = onSelect ?? (() => {});
    this.onOpenChange = onOpenChange ?? (() => {});
    this.onLoadEarlier = onLoadEarlier ?? (() => {});
    this.getAnchorRect = getAnchorRect ?? (() => null);
    this.element = null;
    this.list = null;
    this.count = null;
    this.followButton = null;
    this.loadEarlierButton = null;
    this.earlierAction = { visible: false, loading: false, exhausted: false };
    this.turns = [];
    this.signature = "";
    this.activeTurnId = null;
    this.pendingTurnId = null;
    this.opened = false;
    this.manualBrowse = false;
    this.suppressScroll = false;
    this.programmaticScrollTop = null;
    this.renderCount = 0;
    this.activeUpdateCount = 0;
    this.openFollowGeneration = 0;
    this.boundResize = () => this.updatePosition();
  }

  mount(root) {
    if (this.element) return this.element;
    const panel = this.document.createElement("section");
    panel.className = "gte-question-panel";
    panel.hidden = true;

    const header = this.document.createElement("header");
    header.className = "gte-question-header";
    const title = this.document.createElement("strong");
    title.textContent = "Questions";
    const count = this.document.createElement("span");
    count.className = "gte-question-count";
    const follow = this.document.createElement("button");
    follow.type = "button";
    follow.className = "gte-follow-active";
    follow.textContent = "\u25ce";
    follow.title = "跟随当前提问";
    follow.addEventListener("click", () => {
      this.manualBrowse = false;
      this.scrollActiveIntoView();
    });
    const close = this.document.createElement("button");
    close.type = "button";
    close.className = "gte-question-close";
    close.textContent = "\u00d7";
    close.title = "关闭";
    close.addEventListener("click", () => this.setOpen(false));
    const loadEarlier = this.document.createElement("button");
    loadEarlier.type = "button";
    loadEarlier.className = "gte-load-earlier";
    loadEarlier.hidden = true;
    loadEarlier.textContent = "⇈";
    loadEarlier.title = "加载全部历史到顶部";
    loadEarlier.setAttribute("aria-label", "加载全部历史到顶部");
    loadEarlier.addEventListener("click", () => {
      if (loadEarlier.disabled || loadEarlier.hidden) return;
      this.onLoadEarlier();
    });
    header.append(title, loadEarlier, count, follow, close);

    const list = this.document.createElement("div");
    list.className = "gte-question-list";
    list.setAttribute("role", "listbox");
    list.addEventListener("wheel", () => { this.manualBrowse = true; }, { passive: true });
    list.addEventListener("scroll", () => {
      const escapedProgrammaticTarget = this.suppressScroll
        && this.programmaticScrollTop != null
        && Math.abs(this.list.scrollTop - this.programmaticScrollTop) > 1;
      if (!this.suppressScroll || escapedProgrammaticTarget) {
        this.manualBrowse = true;
        this.suppressScroll = false;
        this.programmaticScrollTop = null;
      }
    }, { passive: true });

    panel.append(header, list);
    root.append(panel);
    this.element = panel;
    this.list = list;
    this.count = count;
    this.followButton = follow;
    this.loadEarlierButton = loadEarlier;
    this.window?.addEventListener?.("resize", this.boundResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundResize, { passive: true });
    return panel;
  }

  setOpen(open) {
    const nextOpen = Boolean(open);
    const openingAnchor = nextOpen && !this.opened ? this.getAnchorRect?.() ?? null : null;
    this.opened = nextOpen;
    if (this.element) this.element.hidden = !this.opened;
    if (this.opened) {
      this.manualBrowse = false;
      this.updatePosition(openingAnchor);
      this.scheduleActiveFollow();
    } else {
      this.openFollowGeneration += 1;
    }
    this.onOpenChange(this.opened);
  }

  toggle() { this.setOpen(!this.opened); }

  setVisible(visible) {
    if (!visible) {
      if (this.element) this.element.hidden = true;
      return;
    }
    if (this.element) this.element.hidden = !this.opened;
    if (this.opened) this.updatePosition();
  }

  updatePosition(anchorOverride = null) {
    if (!this.opened || !this.element) return;
    const anchor = anchorOverride ?? this.getAnchorRect?.();
    if (!anchor) return;
    const viewportWidth = Number(this.window?.visualViewport?.width ?? this.window?.innerWidth ?? 1280);
    const viewportHeight = Number(this.window?.visualViewport?.height ?? this.window?.innerHeight ?? 800);
    const width = 250;
    const desiredHeight = Math.min(620, viewportHeight * 0.68);
    const left = Math.max(12, Math.min(viewportWidth - width - 12, anchor.left - width - 10));
    const top = Math.max(12, Math.min(viewportHeight - desiredHeight - 12, anchor.top));
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.right = "auto";
  }

  setEarlierAction({ visible = false, loading = false, exhausted = false } = {}) {
    this.earlierAction = { visible: Boolean(visible), loading: Boolean(loading), exhausted: Boolean(exhausted) };
    if (!this.loadEarlierButton || !this.element) return;
    this.loadEarlierButton.hidden = !this.earlierAction.visible || this.earlierAction.exhausted;
    this.loadEarlierButton.disabled = this.earlierAction.loading;
    this.loadEarlierButton.textContent = this.earlierAction.loading ? "…" : "⇈";
  }

  setTurns(turns) {
    const next = Array.isArray(turns) ? turns : [];
    const signature = next.map((turn) => `${turn.id}\u0000${Number.isFinite(turn?.order) ? Number(turn.order) : ""}\u0000${turn.text}`).join("\u0001");
    if (signature === this.signature) {
      this.turns = next;
      return false;
    }
    const anchor = this.captureAnchor();
    this.signature = signature;
    this.turns = next;
    this.renderRows();
    this.restoreAnchor(anchor);
    if (this.opened) this.updatePosition();
    return true;
  }

  setActive(turnId, { forceFollow = false } = {}) {
    if (this.activeTurnId === turnId) return;
    const previous = this.activeTurnId;
    this.activeTurnId = turnId ?? null;
    this.activeUpdateCount += 1;
    if (previous) this.findRow(previous)?.classList.remove("is-active");
    const current = this.findRow(this.activeTurnId);
    current?.classList.add("is-active");
    current?.setAttribute?.("aria-selected", "true");
    if (previous) this.findRow(previous)?.setAttribute?.("aria-selected", "false");
    if (this.opened && (forceFollow || !this.manualBrowse)) this.scrollActiveIntoView();
  }

  setPending(turnId) {
    if (this.pendingTurnId === turnId) return;
    const previous = this.pendingTurnId;
    this.pendingTurnId = turnId ?? null;
    if (previous) this.findRow(previous)?.classList.remove("is-pending");
    if (this.pendingTurnId) this.findRow(this.pendingTurnId)?.classList.add("is-pending");
  }

  renderRows() {
    if (!this.list) return;
    this.renderCount += 1;
    this.list.replaceChildren();
    this.count.textContent = String(this.turns.length);
    this.turns.forEach((turn, index) => {
      const row = this.document.createElement("button");
      row.type = "button";
      row.className = "gte-question-row";
      if (turn.id === this.activeTurnId) row.classList.add("is-active");
      if (turn.id === this.pendingTurnId) row.classList.add("is-pending");
      row.dataset.turnId = turn.id;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", turn.id === this.activeTurnId ? "true" : "false");
      const number = this.document.createElement("span");
      number.className = "gte-question-number";
      const order = Number.isFinite(turn?.order) ? Number(turn.order) : index;
      number.textContent = `Q${order + 1}`;
      const text = this.document.createElement("span");
      text.className = "gte-question-text";
      const displayText = normalizeQuestionDisplayText(turn.text);
      text.textContent = displayText || "(empty question)";
      row.title = displayText || `Q${order + 1}`;
      row.append(number, text);
      row.addEventListener("click", () => this.onSelect(turn.id));
      this.list.append(row);
    });
  }

  captureAnchor() {
    if (!this.list || !this.turns.length) return null;
    const listRect = this.list.getBoundingClientRect?.();
    if (!listRect) return null;
    for (const row of this.list.children ?? []) {
      const rect = row.getBoundingClientRect?.();
      if (rect && rect.bottom > listRect.top) return { turnId: row.dataset.turnId, offset: rect.top - listRect.top };
    }
    return null;
  }

  restoreAnchor(anchor) {
    if (!anchor || !this.list) return;
    const row = this.findRow(anchor.turnId);
    const listRect = this.list.getBoundingClientRect?.();
    const rowRect = row?.getBoundingClientRect?.();
    if (!row || !listRect || !rowRect) return;
    this.suppressScroll = true;
    this.list.scrollTop += (rowRect.top - listRect.top) - anchor.offset;
    this.programmaticScrollTop = this.list.scrollTop;
    queueMicrotask(() => { this.suppressScroll = false; this.programmaticScrollTop = null; });
  }

  scheduleActiveFollow() {
    const generation = ++this.openFollowGeneration;
    const run = () => {
      if (!this.opened || generation !== this.openFollowGeneration) return;
      this.scrollActiveIntoView();
    };
    if (typeof this.window?.requestAnimationFrame === "function") this.window.requestAnimationFrame(run);
    else (this.window?.setTimeout ?? setTimeout)(run, 0);
  }

  scrollActiveIntoView() {
    const row = this.findRow(this.activeTurnId);
    if (!row) return;
    this.suppressScroll = true;
    row.scrollIntoView?.({ block: "center", behavior: "auto" });
    this.programmaticScrollTop = this.list.scrollTop;
    queueMicrotask(() => { this.suppressScroll = false; this.programmaticScrollTop = null; });
  }

  findRow(turnId) {
    if (!turnId || !this.list) return null;
    for (const row of this.list.children ?? []) if (row.dataset?.turnId === turnId) return row;
    return null;
  }

  getViewState() {
    const anchor = this.captureAnchor();
    return {
      panelOpen: this.opened,
      manualBrowse: this.manualBrowse,
      anchorTurnId: anchor?.turnId ?? null,
      anchorOffset: anchor?.offset ?? 0
    };
  }

  restoreViewState(state = {}) {
    this.opened = Boolean(state.panelOpen);
    if (this.element) this.element.hidden = !this.opened;
    this.manualBrowse = Boolean(state.manualBrowse);
    if (this.opened) this.updatePosition();
    if (state.anchorTurnId) this.restoreAnchor({ turnId: state.anchorTurnId, offset: Number(state.anchorOffset) || 0 });
    else if (this.opened && !this.manualBrowse) this.scrollActiveIntoView();
  }

  destroy() {
    this.openFollowGeneration += 1;
    this.window?.removeEventListener?.("resize", this.boundResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundResize);
    this.element?.remove?.();
    this.element = null;
    this.list = null;
    this.pendingTurnId = null;
    this.loadEarlierButton = null;
  }
}

Object.assign(exports, { QuestionListPanel });

},
"src/v3/ui/prompt/prompt-trigger.js": (module, exports, __require) => {
class PromptTrigger {
  constructor({ document, window, host, onClick, onPositionChange } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.host = host;
    this.onClick = onClick ?? (() => {});
    this.onPositionChange = onPositionChange ?? (() => {});
    this.element = null;
    this.anchor = null;
    this.resizeObserver = null;
    this.visible = false;
    this.boundResize = () => this.updatePosition();
  }

  mount(root) {
    if (this.element) return this.element;
    const button = this.document.createElement("button");
    button.type = "button";
    button.className = "gte-prompt-trigger";
    button.textContent = "\u2726";
    button.title = "Prompt Library";
    button.setAttribute("aria-label", "Prompt Library");
    button.hidden = true;
    button.addEventListener("click", () => this.onClick());
    root.append(button);
    this.element = button;
    this.window?.addEventListener?.("resize", this.boundResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundResize, { passive: true });
    return button;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    if (!this.element) return;
    this.element.hidden = !this.visible;
    if (this.visible) this.refreshAnchor();
  }

  refreshAnchor() {
    const next = this.host?.getComposerForm?.() ?? this.host?.getComposer?.()?.parentElement ?? null;
    if (next !== this.anchor) {
      this.resizeObserver?.disconnect?.();
      this.resizeObserver = null;
      this.anchor = next;
      if (next && typeof this.window?.ResizeObserver === "function") {
        this.resizeObserver = new this.window.ResizeObserver(() => this.updatePosition());
        this.resizeObserver.observe(next);
      }
    }
    this.updatePosition();
  }

  updatePosition() {
    if (!this.visible || !this.element) return;
    const rect = this.host?.getComposerRect?.();
    if (!rect) {
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;
    const buttonWidth = this.element.offsetWidth || 32;
    const buttonHeight = this.element.offsetHeight || 32;
    const gap = 6;
    const compactHeight = Math.min(Number(rect.height) || 44, 52);
    const verticalInset = Math.min(10, Math.max(6, (compactHeight - buttonHeight) / 2));
    const left = Math.max(8, rect.left - buttonWidth - gap);
    const top = Math.max(8, rect.top + verticalInset);
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.onPositionChange({ left, top, rect, triggerRect: this.element.getBoundingClientRect?.() ?? null });
  }

  destroy() {
    this.resizeObserver?.disconnect?.();
    this.window?.removeEventListener?.("resize", this.boundResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundResize);
    this.element?.remove?.();
    this.element = null;
    this.anchor = null;
  }
}

Object.assign(exports, { PromptTrigger });

},
"src/v3/ui/prompt/prompt-panel.js": (module, exports, __require) => {
class PromptPanel {
  constructor({ document, window, store, host, onToast, getTriggerRect } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.store = store;
    this.host = host;
    this.onToast = onToast ?? (() => {});
    this.getTriggerRect = getTriggerRect ?? (() => null);
    this.element = null;
    this.opened = false;
    this.body = null;
    this.query = "";
    this.editingId = null;
    this.pendingDeleteId = null;
    this.boundResize = () => this.updatePosition();
  }

  mount(root) {
    if (this.element) return this.element;
    const panel = this.document.createElement("section");
    panel.className = "gte-prompt-panel";
    panel.hidden = true;
    const header = this.document.createElement("header");
    header.className = "gte-prompt-header";
    const title = this.document.createElement("strong");
    title.textContent = "提示词";
    const add = makeButton(this.document, "+", "添加提示词", "gte-prompt-icon-button");
    const close = makeButton(this.document, "\u00d7", "关闭", "gte-prompt-icon-button");
    add.addEventListener("click", () => this.openEditor());
    close.addEventListener("click", () => this.setOpen(false));
    header.append(title, add, close);
    this.body = this.document.createElement("div");
    this.body.className = "gte-prompt-body";
    panel.append(header, this.body);
    root.append(panel);
    this.element = panel;
    this.render();
    this.window?.addEventListener?.("resize", this.boundResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundResize, { passive: true });
    return panel;
  }

  setOpen(open) {
    this.opened = Boolean(open);
    if (this.element) this.element.hidden = !this.opened;
    if (this.opened) {
      this.render();
      this.updatePosition();
      queueMicrotask(() => this.updatePosition());
    }
  }

  toggle() { this.setOpen(!this.opened); }

  setVisible(visible) {
    if (this.element) this.element.hidden = !visible || !this.opened;
    if (visible && this.opened) this.updatePosition();
  }

  updatePosition() {
    if (!this.opened || !this.element) return;
    const composer = this.host?.getComposerRect?.();
    const trigger = this.getTriggerRect?.();
    if (!composer && !trigger) return;

    const viewport = this.window?.visualViewport;
    const viewportWidth = Number(viewport?.width ?? this.window?.innerWidth ?? this.document?.documentElement?.clientWidth ?? 1280);
    const viewportHeight = Number(viewport?.height ?? this.window?.innerHeight ?? this.document?.documentElement?.clientHeight ?? 800);
    const measured = this.element.getBoundingClientRect?.();
    const width = Number(measured?.width) > 120 ? Number(measured.width) : 332;
    const height = Number(measured?.height) > 90 ? Number(measured.height) : Math.min(410, viewportHeight - 24);
    const gap = 10;
    const anchorLeft = Number(trigger?.left ?? composer?.left ?? 12);
    const composerTop = Number(composer?.top ?? trigger?.top ?? 12);
    const composerBottom = Number(composer?.bottom ?? ((composer?.top ?? 12) + (composer?.height ?? 44)));

    let placement = "above";
    let top = composerTop - height - gap;
    if (top < 12) {
      const below = composerBottom + gap;
      if (below + height <= viewportHeight - 12) {
        top = below;
        placement = "below";
      } else {
        top = Math.max(12, viewportHeight - height - 12);
        placement = "clamped";
      }
    }
    const left = Math.max(12, Math.min(viewportWidth - width - 12, anchorLeft));
    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
    this.element.style.right = "auto";
    this.element.style.bottom = "auto";
    this.element.setAttribute?.("data-placement", placement);
  }

  render() {
    if (!this.body) return;
    if (this.editingId !== null) return this.renderEditor();
    const all = this.store.list();
    this.body.replaceChildren();
    if (all.length === 0) return this.renderEmpty();
    if (all.length >= 5) {
      const search = this.document.createElement("input");
      search.type = "search";
      search.className = "gte-prompt-search";
      search.placeholder = "搜索提示词";
      search.value = this.query;
      search.addEventListener("input", () => {
        this.query = search.value;
        this.render();
        queueMicrotask(() => {
          const next = this.body?.querySelector?.(".gte-prompt-search");
          next?.focus?.();
          try { next?.setSelectionRange?.(this.query.length, this.query.length); } catch {}
        });
      });
      this.body.append(search);
    }
    const items = this.query ? this.store.search(this.query) : all;
    const list = this.document.createElement("div");
    list.className = "gte-prompt-list";
    for (const item of items) list.append(this.createItem(item));
    if (!items.length) {
      const empty = this.document.createElement("div");
      empty.className = "gte-prompt-empty-small";
      empty.textContent = "没有匹配的提示词";
      list.append(empty);
    }
    this.body.append(list);
    if (this.opened) queueMicrotask(() => this.updatePosition());
  }

  renderEmpty() {
    const empty = this.document.createElement("div");
    empty.className = "gte-prompt-empty";
    const label = this.document.createElement("div");
    label.textContent = "保存常用提示词";
    const add = makeButton(this.document, "+ 添加提示词", "添加提示词", "gte-primary-button");
    add.addEventListener("click", () => this.openEditor());
    empty.append(label, add);
    this.body.append(empty);
    if (this.opened) queueMicrotask(() => this.updatePosition());
  }

  createItem(item) {
    const row = this.document.createElement("article");
    row.className = "gte-prompt-item";
    row.dataset.promptId = item.id;
    const main = makeButton(this.document, "", item.title, "gte-prompt-item-main");
    const title = this.document.createElement("strong");
    title.textContent = item.title;
    const preview = this.document.createElement("span");
    preview.textContent = item.text;
    main.append(title, preview);
    main.addEventListener("click", () => this.insertPrompt(item));

    const actions = this.document.createElement("div");
    actions.className = "gte-prompt-actions";
    const favorite = makeButton(this.document, item.favorite ? "\u2605" : "\u2606", "收藏", "gte-prompt-action");
    favorite.addEventListener("click", () => { this.store.toggleFavorite(item.id); this.render(); });
    const edit = makeButton(this.document, "\u270e", "编辑", "gte-prompt-action");
    edit.addEventListener("click", () => this.openEditor(item.id));
    const remove = makeButton(this.document, this.pendingDeleteId === item.id ? "确认" : "删", "删除", "gte-prompt-action");
    if (this.pendingDeleteId === item.id) remove.classList.add("is-danger");
    remove.addEventListener("click", () => this.requestDelete(item.id));
    actions.append(favorite, edit, remove);
    row.append(main, actions);
    return row;
  }

  openEditor(id = "") {
    this.pendingDeleteId = null;
    this.editingId = id;
    this.render();
    queueMicrotask(() => this.updatePosition());
  }

  renderEditor() {
    this.body.replaceChildren();
    const item = this.editingId ? this.store.list().find((entry) => entry.id === this.editingId) : null;
    const form = this.document.createElement("form");
    form.className = "gte-prompt-editor";
    const title = this.document.createElement("input");
    title.type = "text";
    title.className = "gte-prompt-input";
    title.placeholder = "标题";
    title.value = item?.title ?? "";
    const text = this.document.createElement("textarea");
    text.className = "gte-prompt-textarea";
    text.placeholder = "提示词内容";
    text.value = item?.text ?? "";
    const actions = this.document.createElement("div");
    actions.className = "gte-editor-actions";
    const cancel = makeButton(this.document, "取消", "取消", "gte-secondary-button");
    const save = makeButton(this.document, "保存", "保存", "gte-primary-button");
    cancel.addEventListener("click", () => { this.editingId = null; this.render(); });
    const saveCurrent = () => this.saveEditor(title.value, text.value);
    save.addEventListener("click", saveCurrent);
    form.addEventListener("submit", (event) => { event.preventDefault(); saveCurrent(); });
    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); saveCurrent(); }
    });
    actions.append(cancel, save);
    form.append(title, text, actions);
    this.body.append(form);
  }

  saveEditor(title, text) {
    const content = String(text ?? "").trim();
    if (!content) { this.onToast("提示词内容不能为空"); return false; }
    if (this.editingId) this.store.update(this.editingId, { title, text: content });
    else this.store.create({ title, text: content });
    this.editingId = null;
    this.render();
    this.onToast("提示词已保存");
    return true;
  }

  requestDelete(id) {
    if (this.pendingDeleteId !== id) {
      this.pendingDeleteId = id;
      this.render();
      return false;
    }
    this.store.remove(id);
    this.pendingDeleteId = null;
    this.render();
    this.onToast("提示词已删除");
    return true;
  }

  insertPrompt(item) {
    const result = this.host.insertPrompt(item.text);
    if (result?.ok) {
      this.onToast("已插入提示词");
      this.setOpen(false);
    } else this.onToast("未能插入提示词，请重试");
    return result;
  }

  destroy() {
    this.window?.removeEventListener?.("resize", this.boundResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundResize);
    this.element?.remove?.();
    this.element = null;
    this.body = null;
  }
}

function makeButton(documentRef, text, title, className) {
  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.title = title;
  return button;
}

Object.assign(exports, { PromptPanel });

},
"src/v3/ui/toast.js": (module, exports, __require) => {
class Toast {
  constructor({ document, window } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.element = null;
    this.timer = null;
  }

  mount(root) {
    if (this.element) return this.element;
    const element = this.document.createElement("div");
    element.className = "gte-toast";
    element.hidden = true;
    element.setAttribute("role", "status");
    root.append(element);
    this.element = element;
    return element;
  }

  setViewportRect(rect = null, viewportWidth = 0) {
    if (!this.element) return null;
    const left = Number(rect?.left);
    const right = Number(rect?.right);
    const width = Number(viewportWidth);
    if (Number.isFinite(left) && Number.isFinite(right) && right > left) {
      const clampedLeft = width > 0 ? Math.max(0, Math.min(width, left)) : left;
      const clampedRight = width > 0 ? Math.max(clampedLeft, Math.min(width, right)) : right;
      const center = Math.round((clampedLeft + clampedRight) / 2);
      this.element.style.left = `${center}px`;
      return center;
    }
    this.element.style.left = "50%";
    return null;
  }

  show(message, timeout = 1800) {
    if (!this.element) return;
    this.element.textContent = String(message ?? "");
    this.element.hidden = false;
    if (this.timer) this.window?.clearTimeout?.(this.timer);
    this.timer = null;
    if (timeout > 0) {
      this.timer = this.window?.setTimeout?.(() => {
        this.hide();
      }, timeout) ?? null;
    }
  }

  hide() {
    if (this.timer) this.window?.clearTimeout?.(this.timer);
    this.timer = null;
    if (this.element) this.element.hidden = true;
  }

  destroy() {
    this.hide();
    this.element?.remove?.();
    this.element = null;
  }
}

Object.assign(exports, { Toast });

},
"src/v3/ui/style-bundle.js": (module, exports, __require) => {
const BUNDLED_STYLE_TEXT = "/*\n * GPT TalkEnhancer 0.3 Timeline UI.\n * Interaction/visual baseline adapted from houyanchao/chatgpt-gemini-timeline (GPL-3.0-or-later).\n * See reference/NOTICE-GPL.md and reference/THIRD_PARTY_GPL-3.0.txt.\n */\n:host, .gte-shell {\n  --gte-bg: #ffffff;\n  --gte-panel: rgba(255,255,255,.965);\n  --gte-text: #202123;\n  --gte-muted: #8a8d93;\n  --gte-border: rgba(0,0,0,.10);\n  --gte-hover: rgba(0,0,0,.045);\n  --gte-active: #6d5dfc;\n  --gte-active-soft: rgba(109,93,252,.11);\n  --gte-timeline-active: #202123;\n  --gte-timeline-dot: #b9bdc4;\n  --gte-shadow: 0 12px 36px rgba(0,0,0,.14);\n}\n:host([data-theme=\"dark\"]), .gte-shell[data-theme=\"dark\"] {\n  --gte-bg: #1f2023;\n  --gte-panel: rgba(31,32,35,.965);\n  --gte-text: #f3f3f4;\n  --gte-muted: #96999f;\n  --gte-border: rgba(255,255,255,.11);\n  --gte-hover: rgba(255,255,255,.065);\n  --gte-active-soft: rgba(133,119,255,.18);\n  --gte-timeline-active: #f1f3f5;\n  --gte-timeline-dot: #747981;\n  --gte-shadow: 0 12px 36px rgba(0,0,0,.32);\n}\n\n.gte-timeline-rail {\n  position: fixed;\n  top: 94px;\n  right: 10px;\n  bottom: 112px;\n  z-index: 2147483100;\n  width: 28px;\n  min-height: 220px;\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  padding: 8px 3px 34px;\n  border: 1px solid rgba(0,0,0,.035);\n  border-radius: 14px;\n  background: rgba(248,249,250,.72);\n  box-shadow: 0 2px 12px rgba(0,0,0,.055);\n  backdrop-filter: blur(9px);\n  -webkit-backdrop-filter: blur(9px);\n}\n:host([data-theme=\"dark\"]) .gte-timeline-rail,\n.gte-shell[data-theme=\"dark\"] .gte-timeline-rail {\n  background: rgba(38,40,44,.70);\n  border-color: rgba(255,255,255,.045);\n  box-shadow: 0 2px 14px rgba(0,0,0,.20);\n}\n.gte-timeline-rail[hidden], .gte-question-panel[hidden] { display: none !important; }\n\n.gte-rail-markers {\n  position: relative;\n  width: 100%;\n  flex: 1 1 auto;\n  min-height: 0;\n  margin-top: 6px;\n}\n.gte-rail-marker,\n.gte-rail-toggle,\n.gte-question-close,\n.gte-follow-active {\n  appearance: none;\n  border: 0;\n  font: inherit;\n  color: inherit;\n  cursor: pointer;\n}\n.gte-rail-marker {\n  position: absolute;\n  left: 50%;\n  width: 18px;\n  height: 18px;\n  padding: 0;\n  transform: translate(-50%, -50%);\n  border-radius: 999px;\n  background: transparent;\n  outline: none;\n}\n.gte-rail-marker::after {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 5px;\n  height: 5px;\n  transform: translate(-50%, -50%);\n  border-radius: 999px;\n  background: var(--gte-timeline-dot);\n  transition: transform .13s ease, background .13s ease, opacity .13s ease;\n  opacity: .86;\n}\n.gte-rail-marker:hover::after {\n  transform: translate(-50%, -50%) scale(1.35);\n  background: var(--gte-muted);\n}\n.gte-rail-marker.is-active::before {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 13px;\n  height: 13px;\n  transform: translate(-50%, -50%);\n  border: 2px solid var(--gte-timeline-active);\n  border-radius: 999px;\n  box-sizing: border-box;\n}\n.gte-rail-marker.is-active::after {\n  width: 4px;\n  height: 4px;\n  background: var(--gte-timeline-active);\n  opacity: .92;\n}\n.gte-rail-marker.is-pending::before {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 14px;\n  height: 14px;\n  transform: translate(-50%, -50%);\n  border: 2px dashed var(--gte-active);\n  border-radius: 999px;\n  box-sizing: border-box;\n}\n.gte-rail-marker.is-pending::after {\n  background: var(--gte-active);\n  opacity: 1;\n}\n.gte-rail-toggle {\n  position: absolute;\n  left: 50%;\n  bottom: 5px;\n  width: 22px;\n  height: 22px;\n  transform: translateX(-50%);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 7px;\n  background: transparent;\n  color: var(--gte-muted);\n  font-size: 15px;\n  line-height: 1;\n  opacity: .88;\n}\n.gte-rail-toggle:hover {\n  background: var(--gte-hover);\n  color: var(--gte-text);\n  opacity: 1;\n}\n\n.gte-question-panel {\n  position: fixed;\n  z-index: 2147483099;\n  width: 250px;\n  max-height: min(68vh, 620px);\n  overflow: hidden;\n  border: 1px solid var(--gte-border);\n  border-radius: 10px;\n  background: var(--gte-panel);\n  box-shadow: 0 12px 40px rgba(0,0,0,.12), 0 4px 12px rgba(0,0,0,.055);\n  color: var(--gte-text);\n  backdrop-filter: blur(12px);\n  -webkit-backdrop-filter: blur(12px);\n  animation: gte-ql-in .16s cubic-bezier(.16,1,.3,1);\n}\n@keyframes gte-ql-in {\n  from { opacity: 0; transform: scale(.975) translateX(4px); }\n  to { opacity: 1; transform: scale(1) translateX(0); }\n}\n.gte-question-header {\n  height: 42px;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 8px 0 12px;\n  border-bottom: 1px solid rgba(0,0,0,.055);\n}\n:host([data-theme=\"dark\"]) .gte-question-header,\n.gte-shell[data-theme=\"dark\"] .gte-question-header { border-bottom-color: rgba(255,255,255,.06); }\n.gte-question-header strong { flex: 1; font-size: 13px; font-weight: 650; letter-spacing: -.01em; }\n.gte-question-count { color: var(--gte-muted); font-size: 11px; font-variant-numeric: tabular-nums; }\n.gte-question-close, .gte-follow-active {\n  width: 24px;\n  height: 24px;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--gte-muted);\n}\n.gte-question-close:hover, .gte-follow-active:hover { background: var(--gte-hover); color: var(--gte-text); }\n.gte-load-earlier {\n  appearance: none;\n  width: 24px;\n  height: 24px;\n  flex: 0 0 24px;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--gte-muted);\n  cursor: pointer;\n  font: 14px/1 system-ui, -apple-system, \"Segoe UI\", sans-serif;\n}\n.gte-load-earlier:hover:not(:disabled) { background: var(--gte-hover); color: var(--gte-text); }\n.gte-load-earlier:disabled { cursor: default; opacity: .58; }\n.gte-question-list {\n  max-height: calc(min(68vh, 620px) - 42px);\n  overflow-y: auto;\n  overflow-x: hidden;\n  padding: 4px 3px;\n  overscroll-behavior: contain;\n  scrollbar-width: thin;\n}\n.gte-question-row {\n  width: 100%;\n  min-width: 0;\n  height: 32px;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 7px;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--gte-text);\n  cursor: pointer;\n  text-align: left;\n  font: 12.5px/1.45 system-ui, -apple-system, \"Segoe UI\", sans-serif;\n}\n.gte-question-row:hover { background: var(--gte-hover); }\n.gte-question-row.is-active { background: rgba(0,0,0,.055); color: var(--gte-text); }\n:host([data-theme=\"dark\"]) .gte-question-row.is-active,\n.gte-shell[data-theme=\"dark\"] .gte-question-row.is-active { background: rgba(255,255,255,.08); }\n.gte-question-row.is-pending {\n  background: var(--gte-active-soft);\n  box-shadow: inset 2px 0 0 var(--gte-active);\n}\n.gte-question-number {\n  flex: 0 0 31px;\n  color: var(--gte-muted);\n  font-size: 10.5px;\n  font-weight: 650;\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n  letter-spacing: .01em;\n}\n.gte-question-row.is-active .gte-question-number { color: var(--gte-text); font-weight: 750; }\n.gte-question-row.is-pending .gte-question-number { color: var(--gte-active); font-weight: 750; }\n.gte-question-text {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n:host, .gte-shell {\n  --gte-prompt-bg: var(--gte-panel, rgba(31,32,35,.96));\n}\n.gte-prompt-trigger {\n  position: fixed;\n  z-index: 2147483101;\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  border: 1px solid var(--gte-border);\n  border-radius: 10px;\n  background: var(--gte-panel);\n  box-shadow: 0 4px 14px rgba(0,0,0,.11);\n  color: var(--gte-active);\n  font: 700 16px/1 system-ui, sans-serif;\n  cursor: pointer;\n  backdrop-filter: blur(10px);\n  -webkit-backdrop-filter: blur(10px);\n  transition: background .14s ease, transform .14s ease, box-shadow .14s ease;\n}\n.gte-prompt-trigger:hover {\n  background: var(--gte-active-soft);\n  transform: translateY(-1px);\n  box-shadow: 0 5px 16px rgba(0,0,0,.13);\n}\n.gte-prompt-trigger[hidden], .gte-prompt-panel[hidden] { display: none !important; }\n.gte-prompt-panel {\n  position: fixed;\n  z-index: 2147483102;\n  width: 332px;\n  max-height: min(410px, calc(100vh - 24px));\n  overflow: hidden;\n  border: 1px solid var(--gte-border);\n  border-radius: 14px;\n  background: var(--gte-panel);\n  box-shadow: var(--gte-shadow);\n  color: var(--gte-text);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  animation: gte-prompt-in .16s cubic-bezier(.16,1,.3,1);\n}\n.gte-prompt-panel[data-placement=\"above\"] { transform-origin: bottom left; }\n.gte-prompt-panel[data-placement=\"below\"] { transform-origin: top left; }\n@keyframes gte-prompt-in {\n  from { opacity: 0; transform: scale(.975) translateY(4px); }\n  to { opacity: 1; transform: scale(1) translateY(0); }\n}\n.gte-prompt-header {\n  height: 44px;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 9px 0 13px;\n  border-bottom: 1px solid var(--gte-border);\n}\n.gte-prompt-header strong { flex: 1; font-size: 13px; }\n.gte-prompt-icon-button, .gte-prompt-action, .gte-primary-button, .gte-secondary-button, .gte-prompt-item-main {\n  border: 0;\n  font: inherit;\n  cursor: pointer;\n}\n.gte-prompt-icon-button {\n  width: 27px;\n  height: 27px;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--gte-muted);\n}\n.gte-prompt-icon-button:hover { background: var(--gte-hover); color: var(--gte-text); }\n.gte-prompt-body { max-height: 366px; overflow-y: auto; padding: 9px; box-sizing: border-box; }\n.gte-prompt-search, .gte-prompt-input, .gte-prompt-textarea {\n  width: 100%;\n  box-sizing: border-box;\n  border: 1px solid var(--gte-border);\n  border-radius: 9px;\n  background: var(--gte-bg);\n  color: var(--gte-text);\n  outline: none;\n  font: 12px/1.4 system-ui, sans-serif;\n}\n.gte-prompt-search, .gte-prompt-input { height: 34px; padding: 0 10px; }\n.gte-prompt-search { margin-bottom: 8px; }\n.gte-prompt-search:focus, .gte-prompt-input:focus, .gte-prompt-textarea:focus { border-color: var(--gte-active); }\n.gte-prompt-list { display: flex; flex-direction: column; gap: 6px; }\n.gte-prompt-item {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  min-width: 0;\n  padding: 4px;\n  border-radius: 10px;\n}\n.gte-prompt-item:hover { background: var(--gte-hover); }\n.gte-prompt-item-main {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 3px;\n  padding: 6px;\n  background: transparent;\n  color: var(--gte-text);\n  text-align: left;\n}\n.gte-prompt-item-main strong { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }\n.gte-prompt-item-main span {\n  width: 100%;\n  overflow: hidden;\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  color: var(--gte-muted);\n  font-size: 11px;\n  line-height: 1.35;\n}\n.gte-prompt-actions { display: flex; gap: 2px; }\n.gte-prompt-action {\n  min-width: 25px;\n  height: 25px;\n  padding: 0 5px;\n  border-radius: 7px;\n  background: transparent;\n  color: var(--gte-muted);\n  font-size: 10px;\n}\n.gte-prompt-action:hover { background: var(--gte-active-soft); color: var(--gte-active); }\n.gte-prompt-action.is-danger { color: #ef5350; background: rgba(239,83,80,.12); }\n.gte-prompt-empty, .gte-prompt-empty-small {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 12px;\n  padding: 30px 12px;\n  color: var(--gte-muted);\n  font-size: 12px;\n}\n.gte-prompt-empty-small { padding: 18px 8px; }\n.gte-primary-button, .gte-secondary-button {\n  height: 32px;\n  padding: 0 12px;\n  border-radius: 8px;\n  font-size: 12px;\n}\n.gte-primary-button { background: var(--gte-active); color: white; }\n.gte-secondary-button { background: var(--gte-hover); color: var(--gte-text); }\n.gte-prompt-editor { display: flex; flex-direction: column; gap: 8px; }\n.gte-prompt-textarea { min-height: 150px; resize: vertical; padding: 9px 10px; }\n.gte-editor-actions { display: flex; justify-content: flex-end; gap: 7px; }\n.gte-toast {\n  position: fixed;\n  z-index: 2147483103;\n  left: 50%;\n  bottom: 34px;\n  transform: translateX(-50%);\n  max-width: min(420px, 80vw);\n  padding: 9px 13px;\n  border: 1px solid var(--gte-border);\n  border-radius: 10px;\n  background: var(--gte-panel);\n  box-shadow: var(--gte-shadow);\n  color: var(--gte-text);\n  font: 12px/1.4 system-ui, sans-serif;\n}\n";

Object.assign(exports, { BUNDLED_STYLE_TEXT });

},
"src/v3/ui/app-shell.js": (module, exports, __require) => {
const { SURFACE } = __require("src/v3/host/host-interface.js");
const { TimelineRail } = __require("src/v3/ui/timeline/timeline-rail.js");
const { QuestionListPanel } = __require("src/v3/ui/timeline/question-list.js");
const { PromptTrigger } = __require("src/v3/ui/prompt/prompt-trigger.js");
const { PromptPanel } = __require("src/v3/ui/prompt/prompt-panel.js");
const { Toast } = __require("src/v3/ui/toast.js");
const { BUNDLED_STYLE_TEXT } = __require("src/v3/ui/style-bundle.js");

class AppShell {
  constructor({ document, window, host, promptStore, onNavigate, onLoadEarlier, initialPanelOpen = false } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.host = host;
    this.promptStore = promptStore;
    this.onNavigate = onNavigate ?? (() => {});
    this.onLoadEarlier = onLoadEarlier ?? (() => {});
    this.initialPanelOpen = initialPanelOpen;
    this.hostElement = null;
    this.root = null;
    this.shell = null;
    this.surface = SURFACE.OTHER;
    this.timelineLayoutTarget = null;
    this.timelineLayoutObserver = null;
    this.boundViewportResize = () => this.refreshTimelineLayout();
    this.navigationToastActive = false;
  }

  mount() {
    this.document?.getElementById?.("gte-root")?.remove?.();
    const hostElement = this.document.createElement("div");
    hostElement.id = "gte-root";
    const root = hostElement.attachShadow?.({ mode: "open" }) ?? hostElement;
    const style = this.document.createElement("style");
    style.textContent = BUNDLED_STYLE_TEXT;
    const shell = this.document.createElement("div");
    shell.className = "gte-shell";
    root.append(style, shell);
    (this.document.body ?? this.document.documentElement).append(hostElement);
    this.hostElement = hostElement;
    this.root = root;
    this.shell = shell;

    this.toast = new Toast({ document: this.document, window: this.window });
    this.rail = new TimelineRail({
      document: this.document,
      onSelect: (turnId) => this.onNavigate(turnId),
      onTogglePanel: () => this.questionList.toggle(),
      maxMarkers: 28
    });
    this.questionList = new QuestionListPanel({
      document: this.document,
      window: this.window,
      onSelect: (turnId) => this.onNavigate(turnId),
      onLoadEarlier: () => this.onLoadEarlier(),
      onOpenChange: (open) => { this.panelOpen = open; },
      getAnchorRect: () => this.rail?.getAnchorRect?.() ?? null
    });
    this.promptPanel = new PromptPanel({
      document: this.document,
      window: this.window,
      store: this.promptStore,
      host: this.host,
      onToast: (message) => this.toast.show(message),
      getTriggerRect: () => this.promptTrigger?.element?.getBoundingClientRect?.() ?? null
    });
    this.promptTrigger = new PromptTrigger({
      document: this.document,
      window: this.window,
      host: this.host,
      onClick: () => this.promptPanel.toggle(),
      onPositionChange: () => this.promptPanel?.updatePosition?.()
    });

    this.rail.mount(shell);
    this.questionList.mount(shell);
    this.promptTrigger.mount(shell);
    this.promptPanel.mount(shell);
    this.toast.mount(shell);
    this.questionList.setOpen(this.initialPanelOpen);
    this.setTheme(this.host.getTheme());
    this.window?.addEventListener?.("resize", this.boundViewportResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundViewportResize, { passive: true });
    this.refreshTimelineLayout();
    return this;
  }

  setSurface(surface) {
    this.surface = surface;
    const timelineVisible = surface === SURFACE.CONVERSATION;
    const promptBlocked = Boolean(this.host?.isPromptOverlayBlocked?.());
    const promptVisible = (surface === SURFACE.CONVERSATION || surface === SURFACE.NEW_CHAT) && !promptBlocked;
    this.rail?.setVisible(timelineVisible);
    this.questionList?.setVisible(timelineVisible);
    this.promptTrigger?.setVisible(promptVisible);
    if (!promptVisible) this.promptPanel?.setOpen?.(false);
    this.promptPanel?.setVisible(promptVisible);
    if (this.hostElement?.getAttribute?.("data-gte-surface") !== surface) this.hostElement?.setAttribute?.("data-gte-surface", surface);
  }

  updateTimeline(turns, activeTurnId) {
    this.questionList?.setTurns(turns);
    this.questionList?.setActive(activeTurnId);
    this.rail?.setState(turns, activeTurnId);
    this.questionList?.updatePosition?.();
  }

  setQuestionHistoryState(state = {}) {
    this.questionList?.setEarlierAction?.(state);
  }

  setNavigationState({ state = "idle", target = null, targetOrder = null, pendingVisible = false } = {}) {
    const pendingTarget = state === "pending" ? target : null;
    this.questionList?.setPending?.(pendingTarget);
    this.rail?.setPending?.(pendingTarget);
    if (state === "pending" && pendingVisible) {
      const label = Number.isFinite(targetOrder) ? `Q${targetOrder + 1}` : String(target ?? "");
      this.toast?.show(`正在定位 ${label}…`, 0);
      this.navigationToastActive = true;
    } else if (this.navigationToastActive) {
      this.toast?.hide?.();
      this.navigationToastActive = false;
    }
  }

  syncTimelineLayoutObserver() {
    const target = this.host?.getConversationViewportElement?.() ?? null;
    if (target === this.timelineLayoutTarget) return;
    this.timelineLayoutObserver?.disconnect?.();
    this.timelineLayoutTarget = target;
    if (!target || typeof this.window?.ResizeObserver !== "function") return;
    if (!this.timelineLayoutObserver) {
      this.timelineLayoutObserver = new this.window.ResizeObserver(() => this.refreshTimelineLayout());
    }
    this.timelineLayoutObserver.observe(target);
  }

  refreshTimelineLayout() {
    this.syncTimelineLayoutObserver();
    const rect = this.host?.getConversationViewportRect?.() ?? null;
    const viewportWidth = Number(this.window?.visualViewport?.width ?? this.window?.innerWidth ?? 0);
    const contentRight = Number(rect?.right);
    const inset = viewportWidth > 0 && Number.isFinite(contentRight)
      ? Math.max(14, viewportWidth - Math.min(viewportWidth, Math.max(0, contentRight)) + 14)
      : 14;
    this.rail?.setRightInset?.(inset);
    this.toast?.setViewportRect?.(rect, viewportWidth);
    this.questionList?.updatePosition?.();
    return Math.round(inset);
  }

  refreshComposerAnchor() {
    this.refreshTimelineLayout();
    this.promptTrigger?.refreshAnchor();
    this.promptPanel?.updatePosition?.();
  }

  setTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    if (this.hostElement?.getAttribute?.("data-theme") !== value) this.hostElement?.setAttribute?.("data-theme", value);
    if (this.shell?.getAttribute?.("data-theme") !== value) this.shell?.setAttribute?.("data-theme", value);
  }

  showToast(message) {
    this.navigationToastActive = false;
    this.toast?.show(message);
  }

  getStatus() {
    return {
      timelineMounted: Boolean(this.rail?.element),
      timelineHidden: Boolean(this.rail?.element?.hidden),
      timelineMarkerCount: Number(this.rail?.markers?.children?.length ?? 0),
      questionPanelOpen: Boolean(this.questionList?.opened),
      questionRenderCount: this.questionList?.renderCount ?? 0,
      questionTurnCount: Number(this.questionList?.turns?.length ?? 0),
      promptMounted: Boolean(this.promptTrigger?.element),
      promptPanelOpen: Boolean(this.promptPanel?.opened)
    };
  }

  destroy() {
    this.window?.removeEventListener?.("resize", this.boundViewportResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundViewportResize);
    this.timelineLayoutObserver?.disconnect?.();
    this.timelineLayoutObserver = null;
    this.timelineLayoutTarget = null;
    this.navigationToastActive = false;
    this.promptTrigger?.destroy();
    this.promptPanel?.destroy();
    this.questionList?.destroy();
    this.rail?.destroy();
    this.toast?.destroy();
    this.hostElement?.remove?.();
    this.hostElement = null;
    this.root = null;
    this.shell = null;
  }
}

Object.assign(exports, { AppShell });

},
"src/v3/bootstrap.js": (module, exports, __require) => {
const { EventBus } = __require("src/v3/core/event-bus.js");
const { LocalStorageAdapter } = __require("src/v3/core/storage.js");
const { ConversationStore } = __require("src/v3/core/conversation-store.js");
const { TurnIndex } = __require("src/v3/core/turn-index.js");
const { TimelineState } = __require("src/v3/core/timeline-state.js");
const { PromptStore } = __require("src/v3/core/prompt-store.js");
const { SettingsStore } = __require("src/v3/core/settings-store.js");
const { TimelineCache } = __require("src/v3/core/timeline-cache.js");
const { WorkTimelineCache } = __require("src/v3/core/work-timeline-cache.js");
const { normalizeQuestionDisplayText } = __require("src/v3/core/question-display.js");
const { SURFACE } = __require("src/v3/host/host-interface.js");
const { CodexDesktopHost } = __require("src/v3/host/codex-desktop/codex-host.js");
const { parseSidebarConversationKey } = __require("src/v3/host/codex-desktop/conversation-adapter.js");
const { AppShell } = __require("src/v3/ui/app-shell.js");

const VERSION = "0.5.2";
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

function reconcileChatVisibleTurns(index, visibleRecords = [], diagnostics = null) {
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

function resolvePinnedChatConversationCandidate(visibleRecords = [], candidates = []) {
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

class TalkEnhancerV3App {
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
          trustedVisible
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
      const cached = this.getTimelineCache(conversationId).load(conversationId);
      if (cached.length) index.mergeMany(cached.map((turn) => ({ ...turn, source: "dom", visible: false })));
      this.cacheHydrationCounts.set(conversationId, cached.length);
      this.turnIndexes.set(conversationId, index);
    }
    return this.turnIndexes.get(conversationId);
  }

  persistTimelineCache(conversationId, index = this.turnIndexes.get(conversationId)) {
    if (!conversationId || !index) return false;
    return this.getTimelineCache(conversationId).save(conversationId, index.getOrdered());
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

  maybeStartChatTrueTopBootstrap({ conversationId, index, identity, visibleRecords = [], trustedVisible = [] } = {}) {
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
    const repairIncompletePinnedCache = syntheticChat
      && existingTurns.length > 0
      && (Array.isArray(trustedVisible) ? trustedVisible.length : 0) === 0
      && !existingVisibleOverlap
      && existingTurns.every((turn) => turn?.source === "dom");
    if (existingTurns.length !== 0 && !repairIncompletePinnedCache) return false;
    if (!visible.length) return false;
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
    if (bootstrapMode === "uuid" && Array.isArray(trustedVisible) && trustedVisible.length) return false;
    if (this.activeNavigation?.status === "running" || this.navigationUx.state === "pending") return false;
    if (this.chatEarlierHydrationPromise || this.chatBootstrapHydrationPromise) return true;
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
          const replaced = repairIncompletePinnedCache
            ? currentIndex.replaceDomSnapshot?.(snapshot) === true
            : false;
          if (!replaced) currentIndex.mergeMany(snapshot);
          this.persistTimelineCache(conversationId, currentIndex);
          this.chatEarlierHydrationExhausted.set(conversationId, Number(currentIndex.size?.() ?? stitched.turns.length));
          this.chatBootstrapAttempted.add(conversationId);
          this.chatBootstrapFailures.delete(conversationId);
          bootstrapped = true;
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
    const record = index.get(turnId);
    const targetOrder = Number.isFinite(record?.order) ? Number(record.order) : null;
    this.cancelWorkEarlierHydration();
    this.cancelChatEarlierHydration();
    const requestId = ++this.navigationRequestId;
    const identity = this.host.getConversationIdentity?.() ?? null;
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
      timelineIndex: { ...summarizeOrders(knownTurns), idModes: idModeCounts(knownTurns), cacheRestoredTurns: this.cacheHydrationCounts.get(internalConversationId) ?? 0 },
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
        cacheRestoredTurns: this.cacheHydrationCounts.get(this.currentConversationId) ?? 0
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

function registerBundle(windowRef = globalThis.window) {
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

Object.assign(exports, { VERSION, reconcileChatVisibleTurns, resolvePinnedChatConversationCandidate, TalkEnhancerV3App, registerBundle });

},
  };
  const __cache = Object.create(null);
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    const factory = __modules[id];
    if (!factory) throw new Error(`Missing bundled module: ${id}`);
    const module = { exports: {} };
    __cache[id] = module;
    factory(module, module.exports, __require);
    return module.exports;
  }
  __require("src/v3/bootstrap.js");
})();
