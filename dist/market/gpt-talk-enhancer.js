/*
@codex-plus-script
name: GPT TalkEnhancer
description: Conversation Timeline / Question List and Prompt Library for Codex Desktop.
version: 0.5.2
author: dfhxxc666
homepage: https://github.com/dfhxxc666/gpt-talk-enhancer
license: GPL-3.0-or-later

GPT TalkEnhancer includes GPL-derived Timeline / Question List work.
See the project NOTICE.md and LICENSE for attribution and license details.
*/

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
Object.assign(exports, { TIMELINE_CACHE_KEY, TIMELINE_CACHE_SCHEMA_VERSION, TimelineCache, normalizeCachedTurn });

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
  }

  getConversationId() {
    return this.getConversationIdentity()?.id ?? null;
  }

  getConversationIdentity() {
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

class TurnAdapter {
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

Object.assign(exports, { TurnAdapter, cssEscape, TURN_ID_PRIORITY });

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
    chatFastPathWaitMs = 220,
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
    this.chatFastPathWaitMs = Math.max(0, Number(chatFastPathWaitMs) || 0);
    this.maxAlignFrames = maxAlignFrames;
    this.postSettleWaitMs = postSettleWaitMs;
    this.mountedFastSettleWaitMs = mountedFastSettleWaitMs;
    this.maxPostSettleCorrections = maxPostSettleCorrections;
    this.compatibility = createNavigationCompatibility();
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true, allowMountedFastSettle = false, allowChatPredictiveFastPath = false, onTraceStep = null } = {}) {
    const steps = [];
    const fastPath = { attempted: false, succeeded: false, fallbackReason: null };
    const finish = (result) => ({
      ...result,
      fastAttempted: fastPath.attempted,
      fastSucceeded: fastPath.succeeded,
      fallbackReason: fastPath.fallbackReason,
      steps: steps.slice()
    });
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

    const initialFastPlan = planChatPredictiveFastPath({
      allowed: allowChatPredictiveFastPath,
      identity: conversationIdentity,
      indexState,
      snapshot
    });
    if (initialFastPlan.eligible) {
      fastPath.attempted = true;
      const fastStartedAt = nowMs(this.window);
      const stability = await this.awaitChatFastPathStability({
        container,
        targetOrder: indexState.targetOrder,
        orderById: indexState.orderById,
        getIndexState,
        isCurrent: isNavigationCurrent
      });
      snapshot = stability.after ?? snapshot;
      if (stability.state === "superseded") {
        fastPath.fallbackReason = "superseded";
        recordStep(createNavigationTraceStep({
          mode: "chat-fast", direction: -1,
          elapsedMs: nowMs(this.window) - fastStartedAt,
          jumpPx: 0, waitMs: 0, targetOrder: indexState.targetOrder,
          before: stability.before, after: stability.after,
          outcome: { state: "superseded", progressed: false }
        }));
        return finish(failure("superseded", turnId));
      }
      if (!stability.stable) {
        fastPath.fallbackReason = "unstable-extent";
        recordStep(createNavigationTraceStep({
          mode: "chat-fast", direction: -1,
          elapsedMs: nowMs(this.window) - fastStartedAt,
          jumpPx: 0, waitMs: 0, targetOrder: indexState.targetOrder,
          before: stability.before, after: stability.after,
          outcome: { progressed: false }
        }));
      } else {
        indexState = getIndexState();
        const stablePlan = planChatPredictiveFastPath({
          allowed: true,
          identity: conversationIdentity,
          indexState,
          snapshot: stability.after
        });
        if (!stablePlan.eligible) {
          fastPath.fallbackReason = stablePlan.reason;
          recordStep(createNavigationTraceStep({
            mode: "chat-fast", direction: -1,
            elapsedMs: nowMs(this.window) - fastStartedAt,
            jumpPx: 0, waitMs: 0, targetOrder: indexState.targetOrder,
            before: stability.before, after: stability.after,
            outcome: { progressed: false }
          }));
        } else {
          const fastBefore = stability.after;
          const predictedLogical = stablePlan.predictedLogical;
          const fastJumpPx = Math.abs(Number(fastBefore.logicalPosition) - Number(predictedLogical));
          const outcome = await this.awaitHydrationProgress({
            turnId,
            targetOrder: indexState.targetOrder,
            previousSnapshot: fastBefore,
            direction: -1,
            container,
            isCurrent: isNavigationCurrent,
            orderById: indexState.orderById,
            getIndexState,
            waitMs: this.chatFastPathWaitMs,
            allowMotionProgress: false,
            scrollAction: () => setLogicalScrollPosition(container, predictedLogical, readScrollModel(container, this.window))
          });
          recordStep(createNavigationTraceStep({
            mode: "chat-fast", direction: -1,
            elapsedMs: nowMs(this.window) - fastStartedAt,
            jumpPx: fastJumpPx, waitMs: this.chatFastPathWaitMs,
            targetOrder: indexState.targetOrder,
            before: fastBefore, after: outcome.snapshot, outcome
          }));
          if (outcome.state === "superseded") {
            fastPath.fallbackReason = "superseded";
            return finish(failure("superseded", turnId));
          }
          probes += fastJumpPx >= 1 ? 1 : 0;
          indexState = getIndexState();
          snapshot = outcome.snapshot ?? this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
          if (outcome.progressed) lastProgressAt = nowMs(this.window);
          if (outcome.candidate) {
            const aligned = await this.verifyAndAlign(turnId, outcome.candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
            if (aligned.ok) {
              fastPath.succeeded = true;
              fastPath.fallbackReason = null;
              return finish(aligned);
            }
            fastPath.fallbackReason = aligned.reason ?? "fast-verify-failed";
            if (!retryableAlignmentFailure(aligned.reason)) return finish(aligned);
            indexState = getIndexState();
            snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
          } else {
            fastPath.fallbackReason = outcome.progressed ? "target-not-mounted" : "no-structural-progress";
          }
        }
      }
    }

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
      const direction = chooseHydrationDirection(targetOrder, visibleOrders, model);
      if (hasHydrationProgress(targetOrder, snapshot, currentSnapshot, direction)) {
        consecutiveStalls = 0;
        lastProgressAt = nowMs(this.window);
      }
      snapshot = currentSnapshot;

      const targetBeforeVisible = visibleOrders.length > 0 && targetOrder < visibleOrders[0];
      const targetAfterVisible = visibleOrders.length > 0 && targetOrder > visibleOrders[visibleOrders.length - 1];
      const localWorkWheel = conversationIdentity?.host === "local"
        && conversationIdentity?.source === "sidebar-local"
        && model.isColumnReverse
        && ((direction < 0 && targetBeforeVisible) || (direction > 0 && targetAfterVisible));

      if (localWorkWheel) {
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
          direction,
          getIndexState
        });
        recordStep(createNavigationTraceStep({
          mode: "work-wheel",
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

  async awaitChatFastPathStability({ container, targetOrder, orderById = null, getIndexState = null, isCurrent = () => true } = {}) {
    const readIndex = () => typeof getIndexState === "function" ? getIndexState() : null;
    const firstIndex = readIndex();
    const firstTargetOrder = Number.isFinite(firstIndex?.targetOrder) ? Number(firstIndex.targetOrder) : targetOrder;
    const firstOrderById = firstIndex?.orderById ?? orderById;
    const before = this.readHydrationSnapshot(container, firstTargetOrder, firstOrderById);
    await nextFrame(this.window);
    if (!isCurrent()) return { state: "superseded", stable: false, before, after: before };
    await nextFrame(this.window);
    if (!isCurrent()) return { state: "superseded", stable: false, before, after: before };
    const lastIndex = readIndex();
    const lastTargetOrder = Number.isFinite(lastIndex?.targetOrder) ? Number(lastIndex.targetOrder) : targetOrder;
    const lastOrderById = lastIndex?.orderById ?? orderById;
    const after = this.readHydrationSnapshot(container, lastTargetOrder, lastOrderById);
    const sameIndex = firstIndex?.signature == null || lastIndex?.signature == null || firstIndex.signature === lastIndex.signature;
    const stable = Boolean(sameIndex && chatFastSnapshotStable(before, after));
    return { state: stable ? "stable" : "unstable", stable, before, after };
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

function predictChatFastLogicalPosition({ targetOrder = null, maxKnownOrder = null, minLogicalPosition = 0, maxLogicalPosition = 0 } = {}) {
  if (!Number.isFinite(targetOrder) || !Number.isFinite(maxKnownOrder) || Number(maxKnownOrder) <= 0) return null;
  const min = Number(minLogicalPosition) || 0;
  const max = Math.max(min, Number(maxLogicalPosition) || 0);
  const ratio = clamp(Number(targetOrder) / Number(maxKnownOrder), 0, 1);
  return Math.round(min + (max - min) * ratio);
}

function chatFastSnapshotStable(before, after, tolerance = 2) {
  if (!before || !after) return false;
  const beforeOrders = (before.visibleOrders ?? []).join("|");
  const afterOrders = (after.visibleOrders ?? []).join("|");
  if (!beforeOrders || beforeOrders !== afterOrders) return false;
  if (Math.abs(Number(after.scrollHeight) - Number(before.scrollHeight)) > tolerance) return false;
  if (Math.abs(Number(after.maxLogicalPosition) - Number(before.maxLogicalPosition)) > tolerance) return false;
  if (Math.abs(Number(after.logicalPosition) - Number(before.logicalPosition)) > tolerance) return false;
  if (Math.abs(Number(after.clientHeight) - Number(before.clientHeight)) > tolerance) return false;
  return Number(after.maxLogicalPosition) > Math.max(1, Number(after.clientHeight) || 0);
}

function planChatPredictiveFastPath({ allowed = false, identity = null, indexState = null, snapshot = null } = {}) {
  if (!allowed) return { eligible: false, reason: "not-authorized", predictedLogical: null };
  if (identity?.host !== "chatgpt" || identity?.stable !== true) return { eligible: false, reason: "unstable-identity", predictedLogical: null };
  const targetOrder = Number(indexState?.targetOrder);
  const maxKnownOrder = Number(indexState?.maxKnownOrder);
  const visibleOrders = (snapshot?.visibleOrders ?? []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!Number.isFinite(targetOrder) || !Number.isFinite(maxKnownOrder) || maxKnownOrder < 20) return { eligible: false, reason: "insufficient-index", predictedLogical: null };
  const knownOrders = [...new Set([...(indexState?.orderById?.values?.() ?? [])].filter(Number.isFinite))].sort((a, b) => a - b);
  if (knownOrders.length !== maxKnownOrder + 1 || knownOrders[0] !== 0 || knownOrders.at(-1) !== maxKnownOrder) return { eligible: false, reason: "non-contiguous-index", predictedLogical: null };
  if (visibleOrders.length < 2 || targetOrder >= visibleOrders[0]) return { eligible: false, reason: "not-far-earlier", predictedLogical: null };
  const distance = turnWindowDistance(targetOrder, visibleOrders);
  if (!(distance > 20)) return { eligible: false, reason: "near-target", predictedLogical: null };
  if (!(Number(snapshot?.maxLogicalPosition) > Math.max(1, Number(snapshot?.clientHeight) || 0))) return { eligible: false, reason: "insufficient-scroll-extent", predictedLogical: null };
  const predictedLogical = predictChatFastLogicalPosition({ targetOrder, maxKnownOrder, minLogicalPosition: 0, maxLogicalPosition: snapshot.maxLogicalPosition });
  if (!Number.isFinite(predictedLogical) || predictedLogical >= Number(snapshot.logicalPosition) - Math.max(180, Number(snapshot.clientHeight) || 180)) return { eligible: false, reason: "prediction-too-small", predictedLogical: null };
  return { eligible: true, reason: null, predictedLogical };
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

Object.assign(exports, { NavigationAdapter, computeActiveTurnId, rectInActivationZone, readScrollModel, setLogicalScrollPosition, chooseHydrationDirection, hydrationStepSize, predictChatFastLogicalPosition, chatFastSnapshotStable, planChatPredictiveFastPath, workWheelStepSize, hydrationJumpScale, chatFarCoalescedJump, turnWindowDistance, createHydrationSnapshot, hasHydrationProgress, hasTurnWindowProgress, visibleOrderRange });

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
const { TurnAdapter, cssEscape } = __require("src/v3/host/codex-desktop/turn-adapter.js");
const { ComposerAdapter } = __require("src/v3/host/codex-desktop/composer-adapter.js");
const { OverlayDetector } = __require("src/v3/host/codex-desktop/overlay-detector.js");
const { SurfaceDetector } = __require("src/v3/host/codex-desktop/surface-detector.js");
const { ConversationCapture } = __require("src/v3/host/codex-desktop/conversation-capture.js");
const { NavigationAdapter, computeActiveTurnId } = __require("src/v3/host/codex-desktop/navigation-adapter.js");
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
    this.turns = new TurnAdapter({ document: this.document });
    this.composer = new ComposerAdapter({ document: this.document, window: this.window });
    this.overlay = new OverlayDetector({ document: this.document });
    this.surface = new SurfaceDetector({
      document: this.document,
      window: this.window,
      conversationAdapter: this.conversation,
      overlayDetector: this.overlay
    });
    this.navigation = new NavigationAdapter({
      window: this.window,
      turnAdapter: this.turns,
      conversationAdapter: this.conversation,
      activationOffset: 120,
      maxHydrationSteps: 256,
      maxConsecutiveStalls: 4,
      hydrationWaitMs: 900,
      inactivityNavigationMs: 5000,
      absoluteMaxNavigationMs: 45000,
      postSettleWaitMs: 160,
      maxPostSettleCorrections: 2
    });
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
  }

  start() {
    this.capture.install();
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

  getRoute() {
    return this.conversation.getRoute();
  }

  getVisibleTurns() {
    return this.turns.getVisibleTurns();
  }

  resolveOfficialNavigationMarkerKey(markerKey) {
    const key = String(markerKey ?? "").trim();
    if (!key) return null;
    const escaped = cssEscape(key);
    const selectors = [
      `[data-message-id="${escaped}"]`,
      `[data-message-id-container="${escaped}"]`,
      `[data-user-message-id="${escaped}"]`,
      `[data-message-key="${escaped}"]`,
      `[data-turn-id-container="${escaped}"]`,
      `[data-turn-id="${escaped}"]`,
      `[data-content-search-turn-key="${escaped}"]`,
      `[data-turn-key="${escaped}"]`
    ];
    const resolved = new Set();
    const collect = (node) => {
      if (!node) return;
      const container = this.turns.getTurnContainer?.(node) ?? node;
      const turnId = this.turns.getTurnId?.(container) ?? this.turns.getTurnId?.(node);
      if (turnId) resolved.add(String(turnId));
    };
    collect(this.document?.getElementById?.(key));
    for (const selector of selectors) {
      for (const node of this.document?.querySelectorAll?.(selector) ?? []) collect(node);
    }
    return resolved.size === 1 ? [...resolved][0] : null;
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

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true, allowMountedFastSettle = false, allowChatPredictiveFastPath = false, onTraceStep = null } = {}) {
    const requestId = ++this.navigationRequestId;
    const stillCurrent = () => requestId === this.navigationRequestId && isCurrent();
    const result = await this.navigation.navigateToTurn(turnId, {
      turns,
      getTurns,
      isCurrent: stillCurrent,
      allowMountedFastSettle,
      allowChatPredictiveFastPath,
      onTraceStep
    });
    if (result?.ok && result?.verified && stillCurrent()) this.persistLocalScrollPosition();
    return result;
  }

  notifyNavigationIntent() {
    const container = this.getScrollContainer();
    if (!container || container.isConnected === false) return false;
    return this.navigation.notifyCodexPlusScrollIntent?.(container, () => true) ?? false;
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
    this.capture.dispose();
  }
}

Object.assign(exports, { computeTailActiveTurnId, CodexDesktopHost });

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
  constructor({ document, window, onSelect, onOpenChange, getAnchorRect } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.onSelect = onSelect ?? (() => {});
    this.onOpenChange = onOpenChange ?? (() => {});
    this.getAnchorRect = getAnchorRect ?? (() => null);
    this.element = null;
    this.list = null;
    this.count = null;
    this.followButton = null;
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
    header.append(title, count, follow, close);

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

  setTurns(turns) {
    const next = Array.isArray(turns) ? turns : [];
    const signature = next.map((turn) => `${turn.id}\u0000${turn.text}`).join("\u0001");
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
const BUNDLED_STYLE_TEXT = "/*\n * GPT TalkEnhancer 0.3 Timeline UI.\n * Interaction/visual baseline adapted from houyanchao/chatgpt-gemini-timeline (GPL-3.0-or-later).\n * See reference/NOTICE-GPL.md and reference/THIRD_PARTY_GPL-3.0.txt.\n */\n:host, .gte-shell {\n  --gte-bg: #ffffff;\n  --gte-panel: rgba(255,255,255,.965);\n  --gte-text: #202123;\n  --gte-muted: #8a8d93;\n  --gte-border: rgba(0,0,0,.10);\n  --gte-hover: rgba(0,0,0,.045);\n  --gte-active: #6d5dfc;\n  --gte-active-soft: rgba(109,93,252,.11);\n  --gte-timeline-active: #202123;\n  --gte-timeline-dot: #b9bdc4;\n  --gte-shadow: 0 12px 36px rgba(0,0,0,.14);\n}\n:host([data-theme=\"dark\"]), .gte-shell[data-theme=\"dark\"] {\n  --gte-bg: #1f2023;\n  --gte-panel: rgba(31,32,35,.965);\n  --gte-text: #f3f3f4;\n  --gte-muted: #96999f;\n  --gte-border: rgba(255,255,255,.11);\n  --gte-hover: rgba(255,255,255,.065);\n  --gte-active-soft: rgba(133,119,255,.18);\n  --gte-timeline-active: #f1f3f5;\n  --gte-timeline-dot: #747981;\n  --gte-shadow: 0 12px 36px rgba(0,0,0,.32);\n}\n\n.gte-timeline-rail {\n  position: fixed;\n  top: 94px;\n  right: 10px;\n  bottom: 112px;\n  z-index: 2147483100;\n  width: 28px;\n  min-height: 220px;\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  padding: 8px 3px 34px;\n  border: 1px solid rgba(0,0,0,.035);\n  border-radius: 14px;\n  background: rgba(248,249,250,.72);\n  box-shadow: 0 2px 12px rgba(0,0,0,.055);\n  backdrop-filter: blur(9px);\n  -webkit-backdrop-filter: blur(9px);\n}\n:host([data-theme=\"dark\"]) .gte-timeline-rail,\n.gte-shell[data-theme=\"dark\"] .gte-timeline-rail {\n  background: rgba(38,40,44,.70);\n  border-color: rgba(255,255,255,.045);\n  box-shadow: 0 2px 14px rgba(0,0,0,.20);\n}\n.gte-timeline-rail[hidden], .gte-question-panel[hidden] { display: none !important; }\n\n.gte-rail-markers {\n  position: relative;\n  width: 100%;\n  flex: 1 1 auto;\n  min-height: 0;\n  margin-top: 6px;\n}\n.gte-rail-marker,\n.gte-rail-toggle,\n.gte-question-close,\n.gte-follow-active {\n  appearance: none;\n  border: 0;\n  font: inherit;\n  color: inherit;\n  cursor: pointer;\n}\n.gte-rail-marker {\n  position: absolute;\n  left: 50%;\n  width: 18px;\n  height: 18px;\n  padding: 0;\n  transform: translate(-50%, -50%);\n  border-radius: 999px;\n  background: transparent;\n  outline: none;\n}\n.gte-rail-marker::after {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 5px;\n  height: 5px;\n  transform: translate(-50%, -50%);\n  border-radius: 999px;\n  background: var(--gte-timeline-dot);\n  transition: transform .13s ease, background .13s ease, opacity .13s ease;\n  opacity: .86;\n}\n.gte-rail-marker:hover::after {\n  transform: translate(-50%, -50%) scale(1.35);\n  background: var(--gte-muted);\n}\n.gte-rail-marker.is-active::before {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 13px;\n  height: 13px;\n  transform: translate(-50%, -50%);\n  border: 2px solid var(--gte-timeline-active);\n  border-radius: 999px;\n  box-sizing: border-box;\n}\n.gte-rail-marker.is-active::after {\n  width: 4px;\n  height: 4px;\n  background: var(--gte-timeline-active);\n  opacity: .92;\n}\n.gte-rail-marker.is-pending::before {\n  content: \"\";\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 14px;\n  height: 14px;\n  transform: translate(-50%, -50%);\n  border: 2px dashed var(--gte-active);\n  border-radius: 999px;\n  box-sizing: border-box;\n}\n.gte-rail-marker.is-pending::after {\n  background: var(--gte-active);\n  opacity: 1;\n}\n.gte-rail-toggle {\n  position: absolute;\n  left: 50%;\n  bottom: 5px;\n  width: 22px;\n  height: 22px;\n  transform: translateX(-50%);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 7px;\n  background: transparent;\n  color: var(--gte-muted);\n  font-size: 15px;\n  line-height: 1;\n  opacity: .88;\n}\n.gte-rail-toggle:hover {\n  background: var(--gte-hover);\n  color: var(--gte-text);\n  opacity: 1;\n}\n\n.gte-question-panel {\n  position: fixed;\n  z-index: 2147483099;\n  width: 250px;\n  max-height: min(68vh, 620px);\n  overflow: hidden;\n  border: 1px solid var(--gte-border);\n  border-radius: 10px;\n  background: var(--gte-panel);\n  box-shadow: 0 12px 40px rgba(0,0,0,.12), 0 4px 12px rgba(0,0,0,.055);\n  color: var(--gte-text);\n  backdrop-filter: blur(12px);\n  -webkit-backdrop-filter: blur(12px);\n  animation: gte-ql-in .16s cubic-bezier(.16,1,.3,1);\n}\n@keyframes gte-ql-in {\n  from { opacity: 0; transform: scale(.975) translateX(4px); }\n  to { opacity: 1; transform: scale(1) translateX(0); }\n}\n.gte-question-header {\n  height: 42px;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 8px 0 12px;\n  border-bottom: 1px solid rgba(0,0,0,.055);\n}\n:host([data-theme=\"dark\"]) .gte-question-header,\n.gte-shell[data-theme=\"dark\"] .gte-question-header { border-bottom-color: rgba(255,255,255,.06); }\n.gte-question-header strong { flex: 1; font-size: 13px; font-weight: 650; letter-spacing: -.01em; }\n.gte-question-count { color: var(--gte-muted); font-size: 11px; font-variant-numeric: tabular-nums; }\n.gte-question-close, .gte-follow-active {\n  width: 24px;\n  height: 24px;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--gte-muted);\n}\n.gte-question-close:hover, .gte-follow-active:hover { background: var(--gte-hover); color: var(--gte-text); }\n.gte-question-list {\n  max-height: calc(min(68vh, 620px) - 42px);\n  overflow-y: auto;\n  overflow-x: hidden;\n  padding: 4px 3px;\n  overscroll-behavior: contain;\n  scrollbar-width: thin;\n}\n.gte-question-row {\n  width: 100%;\n  min-width: 0;\n  height: 32px;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 7px;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--gte-text);\n  cursor: pointer;\n  text-align: left;\n  font: 12.5px/1.45 system-ui, -apple-system, \"Segoe UI\", sans-serif;\n}\n.gte-question-row:hover { background: var(--gte-hover); }\n.gte-question-row.is-active { background: rgba(0,0,0,.055); color: var(--gte-text); }\n:host([data-theme=\"dark\"]) .gte-question-row.is-active,\n.gte-shell[data-theme=\"dark\"] .gte-question-row.is-active { background: rgba(255,255,255,.08); }\n.gte-question-row.is-pending {\n  background: var(--gte-active-soft);\n  box-shadow: inset 2px 0 0 var(--gte-active);\n}\n.gte-question-number {\n  flex: 0 0 31px;\n  color: var(--gte-muted);\n  font-size: 10.5px;\n  font-weight: 650;\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n  letter-spacing: .01em;\n}\n.gte-question-row.is-active .gte-question-number { color: var(--gte-text); font-weight: 750; }\n.gte-question-row.is-pending .gte-question-number { color: var(--gte-active); font-weight: 750; }\n.gte-question-text {\n  flex: 1 1 auto;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n:host, .gte-shell {\n  --gte-prompt-bg: var(--gte-panel, rgba(31,32,35,.96));\n}\n.gte-prompt-trigger {\n  position: fixed;\n  z-index: 2147483101;\n  width: 32px;\n  height: 32px;\n  padding: 0;\n  border: 1px solid var(--gte-border);\n  border-radius: 10px;\n  background: var(--gte-panel);\n  box-shadow: 0 4px 14px rgba(0,0,0,.11);\n  color: var(--gte-active);\n  font: 700 16px/1 system-ui, sans-serif;\n  cursor: pointer;\n  backdrop-filter: blur(10px);\n  -webkit-backdrop-filter: blur(10px);\n  transition: background .14s ease, transform .14s ease, box-shadow .14s ease;\n}\n.gte-prompt-trigger:hover {\n  background: var(--gte-active-soft);\n  transform: translateY(-1px);\n  box-shadow: 0 5px 16px rgba(0,0,0,.13);\n}\n.gte-prompt-trigger[hidden], .gte-prompt-panel[hidden] { display: none !important; }\n.gte-prompt-panel {\n  position: fixed;\n  z-index: 2147483102;\n  width: 332px;\n  max-height: min(410px, calc(100vh - 24px));\n  overflow: hidden;\n  border: 1px solid var(--gte-border);\n  border-radius: 14px;\n  background: var(--gte-panel);\n  box-shadow: var(--gte-shadow);\n  color: var(--gte-text);\n  backdrop-filter: blur(14px);\n  -webkit-backdrop-filter: blur(14px);\n  animation: gte-prompt-in .16s cubic-bezier(.16,1,.3,1);\n}\n.gte-prompt-panel[data-placement=\"above\"] { transform-origin: bottom left; }\n.gte-prompt-panel[data-placement=\"below\"] { transform-origin: top left; }\n@keyframes gte-prompt-in {\n  from { opacity: 0; transform: scale(.975) translateY(4px); }\n  to { opacity: 1; transform: scale(1) translateY(0); }\n}\n.gte-prompt-header {\n  height: 44px;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 9px 0 13px;\n  border-bottom: 1px solid var(--gte-border);\n}\n.gte-prompt-header strong { flex: 1; font-size: 13px; }\n.gte-prompt-icon-button, .gte-prompt-action, .gte-primary-button, .gte-secondary-button, .gte-prompt-item-main {\n  border: 0;\n  font: inherit;\n  cursor: pointer;\n}\n.gte-prompt-icon-button {\n  width: 27px;\n  height: 27px;\n  border-radius: 8px;\n  background: transparent;\n  color: var(--gte-muted);\n}\n.gte-prompt-icon-button:hover { background: var(--gte-hover); color: var(--gte-text); }\n.gte-prompt-body { max-height: 366px; overflow-y: auto; padding: 9px; box-sizing: border-box; }\n.gte-prompt-search, .gte-prompt-input, .gte-prompt-textarea {\n  width: 100%;\n  box-sizing: border-box;\n  border: 1px solid var(--gte-border);\n  border-radius: 9px;\n  background: var(--gte-bg);\n  color: var(--gte-text);\n  outline: none;\n  font: 12px/1.4 system-ui, sans-serif;\n}\n.gte-prompt-search, .gte-prompt-input { height: 34px; padding: 0 10px; }\n.gte-prompt-search { margin-bottom: 8px; }\n.gte-prompt-search:focus, .gte-prompt-input:focus, .gte-prompt-textarea:focus { border-color: var(--gte-active); }\n.gte-prompt-list { display: flex; flex-direction: column; gap: 6px; }\n.gte-prompt-item {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  min-width: 0;\n  padding: 4px;\n  border-radius: 10px;\n}\n.gte-prompt-item:hover { background: var(--gte-hover); }\n.gte-prompt-item-main {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 3px;\n  padding: 6px;\n  background: transparent;\n  color: var(--gte-text);\n  text-align: left;\n}\n.gte-prompt-item-main strong { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }\n.gte-prompt-item-main span {\n  width: 100%;\n  overflow: hidden;\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  color: var(--gte-muted);\n  font-size: 11px;\n  line-height: 1.35;\n}\n.gte-prompt-actions { display: flex; gap: 2px; }\n.gte-prompt-action {\n  min-width: 25px;\n  height: 25px;\n  padding: 0 5px;\n  border-radius: 7px;\n  background: transparent;\n  color: var(--gte-muted);\n  font-size: 10px;\n}\n.gte-prompt-action:hover { background: var(--gte-active-soft); color: var(--gte-active); }\n.gte-prompt-action.is-danger { color: #ef5350; background: rgba(239,83,80,.12); }\n.gte-prompt-empty, .gte-prompt-empty-small {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 12px;\n  padding: 30px 12px;\n  color: var(--gte-muted);\n  font-size: 12px;\n}\n.gte-prompt-empty-small { padding: 18px 8px; }\n.gte-primary-button, .gte-secondary-button {\n  height: 32px;\n  padding: 0 12px;\n  border-radius: 8px;\n  font-size: 12px;\n}\n.gte-primary-button { background: var(--gte-active); color: white; }\n.gte-secondary-button { background: var(--gte-hover); color: var(--gte-text); }\n.gte-prompt-editor { display: flex; flex-direction: column; gap: 8px; }\n.gte-prompt-textarea { min-height: 150px; resize: vertical; padding: 9px 10px; }\n.gte-editor-actions { display: flex; justify-content: flex-end; gap: 7px; }\n.gte-toast {\n  position: fixed;\n  z-index: 2147483103;\n  left: 50%;\n  bottom: 34px;\n  transform: translateX(-50%);\n  max-width: min(420px, 80vw);\n  padding: 9px 13px;\n  border: 1px solid var(--gte-border);\n  border-radius: 10px;\n  background: var(--gte-panel);\n  box-shadow: var(--gte-shadow);\n  color: var(--gte-text);\n  font: 12px/1.4 system-ui, sans-serif;\n}\n";

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
  constructor({ document, window, host, promptStore, onNavigate, initialPanelOpen = false } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.host = host;
    this.promptStore = promptStore;
    this.onNavigate = onNavigate ?? (() => {});
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
      questionPanelOpen: Boolean(this.questionList?.opened),
      questionRenderCount: this.questionList?.renderCount ?? 0,
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
"src/v3/diagnostics/official-navigation-probe.js": (module, exports, __require) => {
const { createScrollModel } = __require("src/v3/core/scroll-model.js");

const DEFAULT_SAMPLE_DELAYS_MS = [24, 80, 180, 420, 900, 1200];
const MAX_SAMPLES = 32;
const MAX_PATH_NODES = 6;
const MAX_CLASS_TOKENS = 8;

class OfficialNavigationProbe {
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

function identifyOfficialNavigationMarker(event, documentRef = globalThis.document) {
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

function sanitizeOfficialNavigationLearningSample(value = {}) {
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

function selectTrustedOfficialBridgePair({ learning, targetOrder, markerCount, knownTurnCount, minHits = 2 } = {}) {
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

function sanitizeOfficialNavigationLearningHistory(value, limit = 32) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeOfficialNavigationLearningSample).filter(Boolean).slice(-Math.max(1, Number(limit) || 32));
}

function analyzeOfficialNavigationLearning(samples = []) {
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

function fingerprintClickTarget(event, windowRef = globalThis.window) {
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

function analyzeOfficialNavigationMapping({ document, turns = [] } = {}) {
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

function sanitizeOfficialNavigationMapping(value = {}) {
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

function sanitizeOfficialNavigationHistory(value, limit = 10) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeOfficialNavigationRecord).filter(Boolean).slice(-Math.max(1, Number(limit) || 10));
}

function sanitizeOfficialNavigationRecord(value = {}) {
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

Object.assign(exports, { OfficialNavigationProbe, identifyOfficialNavigationMarker, sanitizeOfficialNavigationLearningSample, selectTrustedOfficialBridgePair, sanitizeOfficialNavigationLearningHistory, analyzeOfficialNavigationLearning, fingerprintClickTarget, analyzeOfficialNavigationMapping, sanitizeOfficialNavigationMapping, sanitizeOfficialNavigationHistory, sanitizeOfficialNavigationRecord });

},
"src/v3/diagnostics/official-navigation-auto-map.js": (module, exports, __require) => {
const MARKER_SELECTOR = "[data-thread-user-message-navigation-item-id]";

function analyzeOfficialNavigationAutoMap({ document, turns = [], resolveMarkerKey = null, minCoverage = 0.8 } = {}) {
  const buttons = Array.from(document?.querySelectorAll?.(MARKER_SELECTOR) ?? []);
  const orderedTurns = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn?.id && Number.isFinite(turn?.order))
    .map((turn) => ({
      id: String(turn.id),
      order: Number(turn.order),
      text: normalizeText(turn.text),
      shortText: normalizeText(turn.shortText ?? turn.text)
    }))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const orderById = new Map(orderedTurns.map((turn) => [turn.id, turn.order]));
  const uniqueTextOrders = buildUniqueTextOrders(orderedTurns);
  const markerCandidates = [];
  const strategyCounts = { domReference: 0, explicitLabel: 0, textMatch: 0, sequenceGap: 0 };
  let markerConflicts = 0;

  buttons.forEach((button, markerIndex) => {
    const markerKey = String(button?.getAttribute?.("data-thread-user-message-navigation-item-id") ?? "").trim();
    if (!markerKey) return;
    const candidates = new Map();
    const add = (order, strategy) => {
      if (!Number.isInteger(order) || order < 0 || order >= orderedTurns.length) return;
      const strategies = candidates.get(order) ?? new Set();
      strategies.add(strategy);
      candidates.set(order, strategies);
    };

    if (typeof resolveMarkerKey === "function") {
      const resolvedId = resolveMarkerKey(markerKey);
      const resolvedOrder = orderById.get(String(resolvedId ?? ""));
      if (Number.isInteger(resolvedOrder)) add(resolvedOrder, "domReference");
    }

    const texts = readMarkerTexts(button);
    for (const text of texts) {
      const explicitOrder = parseExplicitQuestionOrder(text, orderedTurns.length);
      if (Number.isInteger(explicitOrder)) add(explicitOrder, "explicitLabel");
      const normalized = normalizeText(text);
      const textOrder = uniqueTextOrders.get(normalized);
      if (Number.isInteger(textOrder)) add(textOrder, "textMatch");
      if (normalized.length >= 6) {
        for (const turn of orderedTurns) {
          const candidateText = turn.shortText || turn.text;
          if (candidateText.length >= 6 && normalized.endsWith(candidateText)) add(turn.order, "textMatch");
        }
      }
    }

    if (candidates.size !== 1) {
      if (candidates.size > 1) markerConflicts += 1;
      return;
    }
    const [[targetOrder, strategies]] = candidates.entries();
    for (const strategy of strategies) strategyCounts[strategy] += 1;
    markerCandidates.push({ markerIndex, markerKey, targetOrder, strategies: [...strategies].sort() });
  });

  const byTarget = new Map();
  for (const pair of markerCandidates) {
    const list = byTarget.get(pair.targetOrder) ?? [];
    list.push(pair);
    byTarget.set(pair.targetOrder, list);
  }
  const targetConflicts = [...byTarget.values()].filter((list) => list.length > 1).length;
  let pairs = markerCandidates
    .filter((pair) => (byTarget.get(pair.targetOrder)?.length ?? 0) === 1)
    .sort((a, b) => a.markerIndex - b.markerIndex);
  const directMonotonic = pairs.every((pair, index) => index === 0 || pair.targetOrder > pairs[index - 1].targetOrder);
  if (directMonotonic && markerConflicts === 0 && targetConflicts === 0) {
    const anchors = [{ markerIndex: -1, targetOrder: -1 }, ...pairs, { markerIndex: buttons.length, targetOrder: orderedTurns.length }];
    const occupiedMarkers = new Set(pairs.map((pair) => pair.markerIndex));
    const occupiedTargets = new Set(pairs.map((pair) => pair.targetOrder));
    const inferred = [];
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const left = anchors[i];
      const right = anchors[i + 1];
      const markerGap = right.markerIndex - left.markerIndex - 1;
      const targetGap = right.targetOrder - left.targetOrder - 1;
      if (markerGap <= 0 || markerGap !== targetGap) continue;
      for (let offset = 1; offset <= markerGap; offset += 1) {
        const markerIndex = left.markerIndex + offset;
        const targetOrder = left.targetOrder + offset;
        if (occupiedMarkers.has(markerIndex) || occupiedTargets.has(targetOrder)) continue;
        const button = buttons[markerIndex];
        const markerKey = String(button?.getAttribute?.('data-thread-user-message-navigation-item-id') ?? '').trim();
        if (!markerKey) continue;
        inferred.push({ markerIndex, markerKey, targetOrder, strategies: ['sequenceGap'] });
        occupiedMarkers.add(markerIndex);
        occupiedTargets.add(targetOrder);
      }
    }
    if (inferred.length) {
      strategyCounts.sequenceGap += inferred.length;
      pairs = [...pairs, ...inferred].sort((a, b) => a.markerIndex - b.markerIndex);
    }
  }
  const monotonic = pairs.every((pair, index) => index === 0 || pair.targetOrder > pairs[index - 1].targetOrder);
  const mappedTargetCount = new Set(pairs.map((pair) => pair.targetOrder)).size;
  const knownTurnCount = orderedTurns.length;
  const coverage = knownTurnCount > 0 ? mappedTargetCount / knownTurnCount : 0;
  const readyCandidate = buttons.length > 0
    && knownTurnCount >= 5
    && markerConflicts === 0
    && targetConflicts === 0
    && monotonic
    && mappedTargetCount >= 5
    && coverage >= Math.max(0.5, Math.min(1, Number(minCoverage) || 0.8));

  return {
    privatePairs: pairs,
    summary: {
      markerCount: buttons.length,
      knownTurnCount,
      mappedTargetCount,
      coverage: roundRatio(coverage),
      markerConflicts,
      targetConflicts,
      monotonic,
      strategyCounts,
      readyCandidate,
      recommendedMode: readyCandidate ? "auto-official-candidate" : "fallback-self"
    }
  };
}

function sanitizeOfficialNavigationAutoSummary(value = {}) {
  const strategies = value?.strategyCounts ?? {};
  return {
    status: typeof value?.status === "string" ? value.status : "idle",
    markerCount: nonNegativeInt(value?.markerCount),
    knownTurnCount: nonNegativeInt(value?.knownTurnCount),
    mappedTargetCount: nonNegativeInt(value?.mappedTargetCount),
    coverage: roundRatio(value?.coverage),
    markerConflicts: nonNegativeInt(value?.markerConflicts),
    targetConflicts: nonNegativeInt(value?.targetConflicts),
    monotonic: Boolean(value?.monotonic),
    stableScans: nonNegativeInt(value?.stableScans),
    strategyCounts: {
      domReference: nonNegativeInt(strategies.domReference),
      explicitLabel: nonNegativeInt(strategies.explicitLabel),
      textMatch: nonNegativeInt(strategies.textMatch),
      sequenceGap: nonNegativeInt(strategies.sequenceGap)
    },
    recommendedMode: typeof value?.recommendedMode === "string" ? value.recommendedMode : "fallback-self"
  };
}

function officialAutoMapSignature(pairs = []) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((pair) => `${Number(pair?.targetOrder)}\u0000${String(pair?.markerKey ?? "")}`)
    .sort()
    .join("\u0001");
}

function readMarkerTexts(button) {
  const values = [
    button?.getAttribute?.("aria-label"),
    button?.getAttribute?.("aria-description"),
    button?.getAttribute?.("title"),
    button?.innerText,
    button?.textContent
  ];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function parseExplicitQuestionOrder(text, knownTurnCount) {
  const value = String(text ?? "").trim();
  const patterns = [
    /\bQ\s*([1-9]\d*)\b/i,
    /\bQuestion\s*([1-9]\d*)\b/i,
    /问题\s*([1-9]\d*)/i,
    /第\s*([1-9]\d*)\s*(?:个)?(?:问题|提问)/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const number = Number.parseInt(match[1], 10);
    if (Number.isInteger(number) && number >= 1 && number <= knownTurnCount) return number - 1;
  }
  return null;
}

function buildUniqueTextOrders(turns) {
  const map = new Map();
  const ambiguous = new Set();
  for (const turn of turns) {
    for (const text of [turn.text, turn.shortText]) {
      if (!text || text.length < 3) continue;
      if (map.has(text) && map.get(text) !== turn.order) {
        ambiguous.add(text);
        map.delete(text);
      } else if (!ambiguous.has(text)) {
        map.set(text, turn.order);
      }
    }
  }
  return map;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function nonNegativeInt(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function roundRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, Math.round(number * 1000) / 1000));
}

Object.assign(exports, { analyzeOfficialNavigationAutoMap, sanitizeOfficialNavigationAutoSummary, officialAutoMapSignature });

},
"src/v3/diagnostics/host-internal-depth-probe.js": (module, exports, __require) => {
const CANDIDATE_KEY_RE = /(id|turn|message|thread|nav|index|order|item|scroll|virtual|range|offset)/i;
const REACT_PROPS_PREFIX = '__reactProps$';
const REACT_FIBER_PREFIX = '__reactFiber$';
const REACT_CONTAINER_PREFIX = '__reactContainer$';

function collectHostInternalDepthProbe({ window: windowRef, document, host, turns = [] } = {}) {
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

function collectL3ExactKeyJoinDryRunMap({ document, turns = [], preferredPattern = null } = {}) {
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




Object.assign(exports, { collectHostInternalDepthProbe, collectL3ExactKeyJoinDryRunMap });

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
const { SURFACE } = __require("src/v3/host/host-interface.js");
const { CodexDesktopHost } = __require("src/v3/host/codex-desktop/codex-host.js");
const { parseSidebarConversationKey } = __require("src/v3/host/codex-desktop/conversation-adapter.js");
const { AppShell } = __require("src/v3/ui/app-shell.js");
const { OfficialNavigationProbe, analyzeOfficialNavigationLearning, analyzeOfficialNavigationMapping, sanitizeOfficialNavigationHistory, sanitizeOfficialNavigationLearningHistory, sanitizeOfficialNavigationRecord, selectTrustedOfficialBridgePair } = __require("src/v3/diagnostics/official-navigation-probe.js");
const { analyzeOfficialNavigationAutoMap, officialAutoMapSignature, sanitizeOfficialNavigationAutoSummary } = __require("src/v3/diagnostics/official-navigation-auto-map.js");
const { collectHostInternalDepthProbe, collectL3ExactKeyJoinDryRunMap } = __require("src/v3/diagnostics/host-internal-depth-probe.js");

const VERSION = "0.5.2";
const OFFICIAL_NAVIGATION_RUNTIME_ENABLED = false;
const L3_RUNTIME_ENABLED = false;
const NAVIGATION_PENDING_DELAY_MS = 650;
const LOCAL_NAVIGATION_SETTLE_MS = 500;
const CHAT_CONVERSATION_SETTLE_DELAYS_MS = [240, 600, 1200];
const NAVIGATION_HISTORY_LIMIT = 5;
const NAVIGATION_STEP_LIMIT = 16;
const SLOW_NAVIGATION_HISTORY_LIMIT = 10;
const SLOW_NAVIGATION_STORAGE_KEY = "gte.v3.navigation-diagnostics";
const OFFICIAL_NAVIGATION_HISTORY_LIMIT = 10;
const OFFICIAL_NAVIGATION_STORAGE_KEY = "gte.v3.official-navigation-diagnostics";
const OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT = 32;
const OFFICIAL_NAVIGATION_LEARNING_STORAGE_KEY = "gte.v3.official-navigation-learning";
const OFFICIAL_BRIDGE_AUTO_RETRY_DELAYS_MS = [120, 400];
const L3_ADAPTIVE_RESCAN_DELAYS_MS = [50, 120, 250];
const L3_POST_NAVIGATION_SCAN_DELAY_MS = 180;
const L3_EVENT_RECOVERY_DEBOUNCE_MS = 140;

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
    this.timelineCache = new TimelineCache({ storage: this.storage });
    this.cacheHydrationCounts = new Map();
    this.turnIndexes = new Map();
    this.currentConversationId = null;
    this.lastNavigation = { target: null, verified: false, reason: "none", fastAttempted: false, fastSucceeded: false, fallbackReason: null, officialBridgeAttempted: false, officialBridgeSucceeded: false, officialBridgeFallbackReason: null };
    this.navigationRequestId = 0;
    this.navigationRunSequence = 0;
    this.activeNavigation = null;
    this.navigationHistory = [];
    this.slowNavigationHistory = sanitizeSlowNavigationHistory(
      this.storage?.read?.(SLOW_NAVIGATION_STORAGE_KEY, [])
    );
    this.officialNavigationHistory = sanitizeOfficialNavigationHistory(
      this.storage?.read?.(OFFICIAL_NAVIGATION_STORAGE_KEY, []),
      OFFICIAL_NAVIGATION_HISTORY_LIMIT
    );
    this.officialNavigationMapping = this.officialNavigationHistory.at(-1)?.mapping ?? null;
    this.officialNavigationLearningHistory = sanitizeOfficialNavigationLearningHistory(
      this.storage?.read?.(OFFICIAL_NAVIGATION_LEARNING_STORAGE_KEY, []),
      OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT
    );
    this.officialNavigationLearning = analyzeOfficialNavigationLearning(this.officialNavigationLearningHistory);
    this.officialBridgeAutoSessions = new Map();
    this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "idle" });
    this.officialBridgeAutoTimer = null;
    this.officialNavigationSessionLearningHistory = [];
    this.officialNavigationSessionLearning = analyzeOfficialNavigationLearning([]);
    this.officialBridgeInFlight = false;
    this.hostInternalDepthProbe = null;
    this.hostInternalDepthProbeByConversation = new Map();
    this.hostInternalDepthProbeAttempts = new Map();
    this.hostInternalDepthProbeTimer = null;
    this.l3KeyJoinDryRunSessions = new Map();
    this.l3KeyJoinDryRun = createL3KeyJoinDryRunSummary();
    this.l3AdaptiveRescanTimer = null;
    this.l3AdaptiveRescanGeneration = 0;
    this.l3PostNavigationScanTimer = null;
    this.l3EventRecoveryTimer = null;
    this.l3EventRecoveryWatch = null;
    this.officialNavigationPrivateMarkers = new Map();
    this.officialNavigationPrivateSessions = new Map();
    this.officialNavigationSessionPrivatePairsByTarget = new Map();
    this.officialNavigationSessionPrivateTargetsByKey = new Map();
    this.officialNavigationSessionPrivateConflictedTargets = new Set();
    this.officialNavigationSessionPrivateConflictedKeys = new Set();
    this.navigationUxTimer = null;
    this.navigationUx = { state: "idle", target: null, targetOrder: null, pendingVisible: false };
    this.captureStatus = { status: "unavailable", turnCount: 0, lastError: "" };
    this.destroyed = false;
    this.refreshFrame = null;
    this.observer = null;
    this.scrollContainer = null;
    this.boundScroll = () => this.scheduleRefresh("scroll");
    this.boundRoute = () => this.scheduleRefresh("route");
    this.conversationSelectTimer = null;
    this.localNavigationSettleUntil = 0;
    this.boundConversationSelect = (event) => this.handleConversationSelect(event);
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
      initialPanelOpen: this.settings.load().timelinePanelOpen
    });
    this.officialNavigationProbe = new OfficialNavigationProbe({
      document: this.document,
      window: this.window,
      getContext: () => {
        const identity = this.host.getConversationIdentity?.() ?? null;
        return {
          enabled: !this.destroyed && this.host.getSurface?.() === SURFACE.CONVERSATION && Boolean(this.currentConversationId),
          sessionKey: this.currentConversationId,
          host: identity?.host ?? null,
          source: identity?.source ?? null,
          stable: Boolean(identity?.stable)
        };
      },
      getScrollContainer: () => this.host.getScrollContainer?.(),
      getVisibleRange: () => this.getOfficialProbeVisibleRange(),
      isOwnedEvent: (event) => this.officialBridgeInFlight || ((event?.composedPath?.() ?? []).some((node) => node?.id === "gte-root")),
      onRecord: (record) => this.handleOfficialNavigationRecord(record)
    });
  }

  start() {
    this.window?.__GPTTalkEnhancerV3?.destroy?.();
    this.shell.mount();
    this.host.start?.();
    this.bindLifecycle();
    if (OFFICIAL_NAVIGATION_RUNTIME_ENABLED) this.officialNavigationProbe.start();
    this.refresh("start");
    this.window.__GPTTalkEnhancerV3 = this;
    return this;
  }

  bindLifecycle() {
    if (typeof this.window?.MutationObserver === "function" && this.document?.body) {
      this.observer = new this.window.MutationObserver((records) => {
        this.scheduleRefresh("mutation");
        if (L3_RUNTIME_ENABLED) this.handleL3EventRecoveryMutation(records);
      });
      this.observer.observe(this.document.body, { childList: true, subtree: true, attributes: true });
    }
    this.window?.addEventListener?.("popstate", this.boundRoute);
    this.window?.addEventListener?.("hashchange", this.boundRoute);
    this.document?.addEventListener?.("click", this.boundConversationSelect, true);
  }

  handleConversationSelect(event) {
    const row = event?.target?.closest?.(
      "[data-sidebar-chatgpt-conversation-key], [data-app-action-sidebar-thread-id]"
    );
    if (!row) return;
    const localId = row?.getAttribute?.("data-app-action-sidebar-thread-id") ?? null;
    const chatKey = row?.getAttribute?.("data-sidebar-chatgpt-conversation-key") ?? null;
    const expectedChatId = chatKey ? parseSidebarConversationKey(chatKey) : null;
    const localThreadSelected = Boolean(localId);
    const currentIdentity = this.host.getConversationIdentity?.() ?? null;
    const currentLocalId = currentIdentity?.stable
      && currentIdentity?.host === "local"
      && currentIdentity?.source === "sidebar-local"
      ? String(currentIdentity.id ?? "")
      : "";
    const leavingCurrentLocal = Boolean(currentLocalId && (!localId || String(localId) !== currentLocalId));
    if (leavingCurrentLocal) this.host.persistLocalScrollPosition?.();
    this.localNavigationSettleUntil = localThreadSelected ? appNowMs(this.window) + LOCAL_NAVIGATION_SETTLE_MS : 0;
    this.invalidateNavigation("conversation-select");
    this.scheduleRefresh("conversation-select");
    this.clearConversationSelectTimer();
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
  scheduleRefresh(reason = "event") {
    if (this.destroyed || this.refreshFrame != null) return;
    const run = () => {
      this.refreshFrame = null;
      this.refresh(reason);
    };
    if (typeof this.window?.requestAnimationFrame === "function") this.refreshFrame = this.window.requestAnimationFrame(run);
    else this.refreshFrame = this.window?.setTimeout?.(run, 0) ?? setTimeout(run, 0);
  }

  refresh(reason = "manual") {
    if (this.destroyed) return this.status();
    const surface = this.host.getSurface();
    const conversationId = this.host.getConversationId();
    const conversationIdentity = this.host.getConversationIdentity?.() ?? null;
    this.shell.setTheme(this.host.getTheme());
    this.shell.setSurface(surface);

    if (surface === SURFACE.CONVERSATION && conversationId) {
      this.activateConversation(conversationId);
      const index = this.getTurnIndex(conversationId);
      const visible = this.host.getVisibleTurns();
      index.setVisible(visible);
      if (conversationIdentity?.source === "sidebar-local" && conversationIdentity?.stable) index.reindexUuidV7?.();
      if (OFFICIAL_NAVIGATION_RUNTIME_ENABLED) {
        this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "fallback-self", recommendedMode: "fallback-self" });
      } else {
        this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "fallback-self", recommendedMode: "fallback-self" });
      }
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
      if (L3_RUNTIME_ENABLED) this.scheduleHostInternalDepthProbe(conversationId, index, conversationIdentity);
      this.bindScrollContainer(this.host.getScrollContainer?.());
    } else if (surface === SURFACE.CONVERSATION && this.currentConversationId) {
      if (this.navigationUx.state === "pending") this.invalidateNavigation("conversation-identity-transient");
      this.bindScrollContainer(this.host.getScrollContainer?.());
    } else {
      if (surface !== SURFACE.MEDIA_VIEWER) this.deactivateConversationView();
      this.bindScrollContainer(null);
    }

    this.shell.refreshComposerAnchor();
    this.updateDebug(reason);
    return this.status();
  }

  activateConversation(conversationId) {
    if (this.currentConversationId === conversationId) return;
    if (this.currentConversationId) {
      this.saveConversationView(this.currentConversationId);
      this.invalidateNavigation("conversation-changed");
    }
    this.currentConversationId = conversationId;
    this.clearOfficialBridgeAutoTimer();
    this.clearHostInternalDepthProbeTimer();
    this.clearL3AdaptiveRescanTimer();
    this.clearL3PostNavigationScanTimer();
    this.clearL3EventRecoveryWatch();
    this.hostInternalDepthProbe = this.hostInternalDepthProbeByConversation.get(conversationId) ?? null;
    const existingAutoSession = this.officialBridgeAutoSessions.get(conversationId);
    if (existingAutoSession) existingAutoSession.retryAttempt = 0;
    this.officialNavigationSessionLearningHistory = [];
    this.officialNavigationSessionLearning = analyzeOfficialNavigationLearning([]);
    const conversation = this.conversations.activateConversation(conversationId, this.host.getRoute?.() ?? "");
    if (conversation?.captureStatus?.status === "unavailable" && this.captureStatus?.status !== "unavailable") {
      this.conversations.setCaptureStatus(conversationId, this.captureStatus);
    }
    const state = this.timelineState.get(conversationId);
    queueMicrotask(() => this.shell.questionList?.restoreViewState?.(state));
  }

  deactivateConversationView() {
    this.clearL3EventRecoveryWatch();
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

  getTurnIndex(conversationId) {
    if (!this.turnIndexes.has(conversationId)) {
      const index = new TurnIndex();
      const cached = this.timelineCache.load(conversationId);
      if (cached.length) index.mergeMany(cached.map((turn) => ({ ...turn, source: "dom", visible: false })));
      this.cacheHydrationCounts.set(conversationId, cached.length);
      this.turnIndexes.set(conversationId, index);
    }
    return this.turnIndexes.get(conversationId);
  }

  persistTimelineCache(conversationId, index = this.turnIndexes.get(conversationId)) {
    if (!conversationId || !index) return false;
    return this.timelineCache.save(conversationId, index.getOrdered());
  }

  handleCapture({ conversationId, turns } = {}) {
    if (!conversationId) return;
    const index = this.getTurnIndex(conversationId);
    index.replaceCapture(turns ?? []);
    this.persistTimelineCache(conversationId, index);
    this.conversations.setCaptureStatus(conversationId, { status: "active", turnCount: index.size(), lastError: "" });
    if (this.currentConversationId === conversationId) this.scheduleRefresh("capture");
  }

  handleCaptureStatus(status = {}) {
    this.captureStatus = { ...this.captureStatus, ...status };
    if (this.currentConversationId) this.conversations.setCaptureStatus(this.currentConversationId, this.captureStatus);
    this.updateDebug("capture-status");
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
      fastAttempted: Boolean(result?.fastAttempted),
      fastSucceeded: Boolean(result?.fastSucceeded),
      fallbackReason: result?.fallbackReason ?? null,
      officialBridgeAttempted: Boolean(result?.officialBridgeAttempted),
      officialBridgeSucceeded: Boolean(result?.officialBridgeSucceeded),
      officialBridgeFallbackReason: result?.officialBridgeFallbackReason ?? null,
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
        fastAttempted: completed.fastAttempted,
        fastSucceeded: completed.fastSucceeded,
        fallbackReason: completed.fallbackReason,
        officialBridgeAttempted: completed.officialBridgeAttempted,
        officialBridgeSucceeded: completed.officialBridgeSucceeded,
        officialBridgeFallbackReason: completed.officialBridgeFallbackReason,
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

  getOfficialProbeVisibleRange() {
    const index = this.currentConversationId ? this.getTurnIndex(this.currentConversationId) : null;
    const orders = [];
    for (const turn of this.host.getVisibleTurns?.() ?? []) {
      const record = turn?.id && index ? index.get(turn.id) : null;
      const order = Number.isFinite(record?.order) ? Number(record.order) : (!index && Number.isFinite(turn?.order) ? Number(turn.order) : null);
      if (Number.isFinite(order)) orders.push(order);
    }
    const unique = [...new Set(orders)].sort((a, b) => a - b);
    if (!unique.length) return null;
    return { min: unique[0], max: unique.at(-1), count: unique.length };
  }

  resetOfficialNavigationPrivateSession() {
    this.officialNavigationPrivateMarkers?.clear?.();
    this.officialNavigationSessionPrivatePairsByTarget = new Map();
    this.officialNavigationSessionPrivateTargetsByKey = new Map();
    this.officialNavigationSessionPrivateConflictedTargets = new Set();
    this.officialNavigationSessionPrivateConflictedKeys = new Set();
  }

  activateOfficialNavigationPrivateSession(conversationId) {
    this.officialNavigationPrivateMarkers?.clear?.();
    if (!conversationId) {
      this.resetOfficialNavigationPrivateSession();
      return;
    }
    let session = this.officialNavigationPrivateSessions.get(conversationId);
    if (!session) {
      session = {
        pairsByTarget: new Map(),
        targetsByKey: new Map(),
        conflictedTargets: new Set(),
        conflictedKeys: new Set()
      };
      this.officialNavigationPrivateSessions.set(conversationId, session);
    }
    this.officialNavigationSessionPrivatePairsByTarget = session.pairsByTarget;
    this.officialNavigationSessionPrivateTargetsByKey = session.targetsByKey;
    this.officialNavigationSessionPrivateConflictedTargets = session.conflictedTargets;
    this.officialNavigationSessionPrivateConflictedKeys = session.conflictedKeys;
  }

  handleOfficialPrivateMarker(marker) {
    const probeId = Number(marker?.probeId);
    const sessionKey = typeof marker?.sessionKey === "string" ? marker.sessionKey : null;
    const markerKey = typeof marker?.markerKey === "string" ? marker.markerKey.trim() : "";
    if (!Number.isInteger(probeId) || probeId <= 0 || !sessionKey || sessionKey !== this.currentConversationId || !markerKey) return;
    this.officialNavigationPrivateMarkers.set(probeId, { sessionKey, markerKey });
    while (this.officialNavigationPrivateMarkers.size > 32) this.officialNavigationPrivateMarkers.delete(this.officialNavigationPrivateMarkers.keys().next().value);
  }

  recordOfficialPrivateMarkerLearning({ probeId, targetOrder, knownTurnCount }) {
    const privateMarker = this.officialNavigationPrivateMarkers.get(Number(probeId));
    this.officialNavigationPrivateMarkers.delete(Number(probeId));
    if (!privateMarker || privateMarker.sessionKey !== this.currentConversationId || !Number.isInteger(targetOrder) || targetOrder < 0) return;
    const markerKey = privateMarker.markerKey;
    if (!markerKey || this.officialNavigationSessionPrivateConflictedKeys.has(markerKey) || this.officialNavigationSessionPrivateConflictedTargets.has(targetOrder)) return;
    const existingTarget = this.officialNavigationSessionPrivateTargetsByKey.get(markerKey);
    const existingPair = this.officialNavigationSessionPrivatePairsByTarget.get(targetOrder);
    if ((Number.isInteger(existingTarget) && existingTarget !== targetOrder) || (existingPair?.markerKey && existingPair.markerKey !== markerKey)) {
      this.officialNavigationSessionPrivateConflictedKeys.add(markerKey);
      this.officialNavigationSessionPrivateConflictedTargets.add(targetOrder);
      if (Number.isInteger(existingTarget)) this.officialNavigationSessionPrivateConflictedTargets.add(existingTarget);
      if (existingPair?.markerKey) this.officialNavigationSessionPrivateConflictedKeys.add(existingPair.markerKey);
      this.officialNavigationSessionPrivateTargetsByKey.delete(markerKey);
      this.officialNavigationSessionPrivatePairsByTarget.delete(targetOrder);
      return;
    }
    const hits = existingPair?.markerKey === markerKey ? Number(existingPair.hits || 0) + 1 : 1;
    this.officialNavigationSessionPrivateTargetsByKey.set(markerKey, targetOrder);
    this.officialNavigationSessionPrivatePairsByTarget.set(targetOrder, { markerKey, hits, knownTurnCount: Number(knownTurnCount) || 0 });
  }

  getTrustedOfficialPrivatePair({ targetOrder, index }) {
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index || this.officialNavigationSessionPrivateConflictedTargets.has(targetOrder)) return null;
    const pair = this.officialNavigationSessionPrivatePairsByTarget.get(targetOrder);
    if (!pair?.markerKey || Number(pair.hits) < 2 || this.officialNavigationSessionPrivateConflictedKeys.has(pair.markerKey)) return null;
    if (Number(pair.knownTurnCount) !== Number(index.size?.() ?? 0)) return null;
    const buttons = Array.from(this.document?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
    const matches = buttons.filter((button) => String(button?.getAttribute?.('data-thread-user-message-navigation-item-id') ?? '').trim() === pair.markerKey);
    if (matches.length !== 1) return null;
    return { marker: matches[0], targetOrder, hits: Number(pair.hits) };
  }

  handleOfficialNavigationRecord(record) {
    const index = this.currentConversationId ? this.getTurnIndex(this.currentConversationId) : null;
    const mapping = analyzeOfficialNavigationMapping({ document: this.document, turns: index?.getOrdered?.() ?? [] });
    const activeTurnId = index?.resolveCanonicalId?.(this.host.getActiveTurnId?.());
    const activeRecord = activeTurnId ? index?.get?.(activeTurnId) : null;
    const marker = record?.marker ?? null;
    const learningSample = marker && Number.isFinite(activeRecord?.order) ? {
      markerIndex: marker.markerIndex,
      markerCount: marker.markerCount,
      targetOrder: Number(activeRecord.order),
      knownTurnCount: index?.size?.() ?? null,
      host: record?.host ?? null,
      classification: record?.classification ?? null,
      observedAt: new Date().toISOString()
    } : null;
    const clean = sanitizeOfficialNavigationRecord({ ...record, mapping, learningSample });
    if (!clean) return;
    this.officialNavigationMapping = clean.mapping ?? null;
    if (clean.learningSample) {
      this.officialNavigationLearningHistory = [...this.officialNavigationLearningHistory, clean.learningSample].slice(-OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT);
      this.officialNavigationLearning = analyzeOfficialNavigationLearning(this.officialNavigationLearningHistory);
      this.storage?.write?.(OFFICIAL_NAVIGATION_LEARNING_STORAGE_KEY, this.officialNavigationLearningHistory);
      this.officialNavigationSessionLearningHistory = [...this.officialNavigationSessionLearningHistory, clean.learningSample].slice(-OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT);
      this.officialNavigationSessionLearning = analyzeOfficialNavigationLearning(this.officialNavigationSessionLearningHistory);
    }
    this.officialNavigationHistory = [...this.officialNavigationHistory, clean].slice(-OFFICIAL_NAVIGATION_HISTORY_LIMIT);
    this.storage?.write?.(OFFICIAL_NAVIGATION_STORAGE_KEY, this.officialNavigationHistory);
    this.publishOfficialNavigationDiagnostics();
  }

  publishOfficialNavigationDiagnostics() {
    if (!this.window) return;
    const current = this.window.__GPTTalkEnhancerDebug ?? {};
    this.window.__GPTTalkEnhancerDebug = {
      ...current,
      officialNavigationHistory: this.officialNavigationHistory.map((item) => JSON.parse(JSON.stringify(item))),
      lastOfficialNavigation: this.officialNavigationHistory.length ? JSON.parse(JSON.stringify(this.officialNavigationHistory.at(-1))) : null,
      officialNavigationMapping: this.officialNavigationMapping ? JSON.parse(JSON.stringify(this.officialNavigationMapping)) : null,
      officialNavigationLearning: JSON.parse(JSON.stringify(this.officialNavigationLearning)),
      officialNavigationSessionLearning: JSON.parse(JSON.stringify(this.officialNavigationSessionLearning)),
      officialBridgeAuto: JSON.parse(JSON.stringify(this.officialBridgeAuto)),
      officialBridgeSessionTrustedTargets: this.getOfficialBridgeSessionTrustedTargets(),
      hostInternalDepthProbe: this.hostInternalDepthProbe ? JSON.parse(JSON.stringify(this.hostInternalDepthProbe)) : null,
      l3RuntimeEnabled: L3_RUNTIME_ENABLED,
      l3KeyJoinDryRun: createL3KeyJoinDryRunSummary(this.l3KeyJoinDryRun),
      officialNavigationLearningHistory: this.officialNavigationLearningHistory.map((item) => ({ ...item }))
    };
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

  getOfficialBridgeAutoSession(conversationId) {
    if (!conversationId) return null;
    let session = this.officialBridgeAutoSessions.get(conversationId);
    if (!session) {
      session = {
        conversationId,
        status: "auto-scanning",
        stableScans: 0,
        lastSignature: null,
        pairsByTarget: new Map(),
        knownTurnCount: 0,
        retryAttempt: 0,
        summary: sanitizeOfficialNavigationAutoSummary({ status: "auto-scanning" })
      };
      this.officialBridgeAutoSessions.set(conversationId, session);
    }
    return session;
  }

  clearHostInternalDepthProbeTimer() {
    if (this.hostInternalDepthProbeTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.hostInternalDepthProbeTimer);
    this.hostInternalDepthProbeTimer = null;
  }

  getL3KeyJoinDryRunSession(conversationId) {
    if (!conversationId) return null;
    let session = this.l3KeyJoinDryRunSessions.get(conversationId);
    if (!session) {
      session = {
        status: "idle",
        stableScans: 0,
        patternKey: null,
        identityByTarget: new Map(),
        knownTurnCount: 0,
        pairsByTarget: new Map(),
        adaptiveRescanState: "idle",
        adaptiveRescanAttempt: 0,
        summary: createL3KeyJoinDryRunSummary()
      };
      this.l3KeyJoinDryRunSessions.set(conversationId, session);
    }
    return session;
  }

  runL3ResearchScan({ targetOrder = null } = {}) {
    if (this.isLocalWorkNavigationActive()) {
      return createL3KeyJoinDryRunSummary({ status: "research-blocked-navigation" });
    }
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    const identity = this.host.getConversationIdentity?.() ?? null;
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
      const unavailable = createL3KeyJoinDryRunSummary({ status: "research-unavailable" });
      this.l3KeyJoinDryRun = unavailable;
      this.updateDebug("l3-research-unavailable");
      return unavailable;
    }
    const session = this.getL3KeyJoinDryRunSession(conversationId);
    const scan = collectL3ExactKeyJoinDryRunMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      preferredPattern: session?.patternKey ?? null
    });
    const source = scan?.summary ?? {};
    const target = Number.isInteger(targetOrder) && targetOrder >= 0 ? targetOrder : -1;
    const result = createL3KeyJoinDryRunSummary({
      status: "research-one-shot",
      stableScans: session?.stableScans ?? 0,
      mappedTurnCount: Number(source.mappedTurnCount) || 0,
      coverage: Number(source.coverage) || 0,
      conflicts: Number(source.conflicts) || 0,
      exactPatternCount: Number(source.exactPatternCount) || 0,
      mappingAgreement: Boolean(source.mappingAgreement),
      ...createL3FreshDiagnostics(scan, target),
      mappingStable: null,
      adaptiveRescanState: "research-frozen",
      adaptiveRescanAttempt: 0,
      freshMapAccepted: false
    });
    this.l3KeyJoinDryRun = result;
    this.updateDebug("l3-research-one-shot");
    return result;
  }
  refreshL3KeyJoinDryRun({ conversationId, index, identity, finalAttempt = false } = {}) {
    if (this.isLocalWorkNavigationActive()) return null;
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
      this.l3KeyJoinDryRun = createL3KeyJoinDryRunSummary({ status: "unavailable" });
      return null;
    }
    const session = this.getL3KeyJoinDryRunSession(conversationId);
    const scan = collectL3ExactKeyJoinDryRunMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      preferredPattern: session.patternKey
    });
    const summary = scan?.summary ?? {};
    const exact = Boolean(
      summary.oneToOne
      && summary.coverage === 1
      && Number(summary.conflicts) === 0
      && scan?.patternKey
      && scan?.identityByTarget instanceof Map
      && scan.identityByTarget.size === Number(summary.knownTurnCount ?? 0)
    );
    if (exact) {
      const sameIdentity = Boolean(
        session.patternKey
        && session.patternKey === scan.patternKey
        && sameL3KeyJoinIdentityMap(session.identityByTarget, scan.identityByTarget)
      );
      session.stableScans = sameIdentity ? session.stableScans + 1 : 1;
      session.patternKey = scan.patternKey;
      session.identityByTarget = new Map(scan.identityByTarget);
      session.knownTurnCount = Number(summary.knownTurnCount) || 0;
      session.pairsByTarget = scan.pairsByTarget instanceof Map ? scan.pairsByTarget : new Map();
      session.status = session.stableScans >= 2 ? "dry-run-ready" : (finalAttempt ? "dry-run-unstable" : "dry-run-scanning");
    } else {
      session.status = "dry-run-unavailable";
      session.stableScans = 0;
      session.patternKey = null;
      session.identityByTarget = new Map();
      session.knownTurnCount = Number(summary.knownTurnCount) || Number(index.size?.() ?? 0);
      session.pairsByTarget = new Map();
    }
    session.summary = createL3KeyJoinDryRunSummary({
      status: session.status,
      stableScans: session.stableScans,
      mappedTurnCount: Number(summary.mappedTurnCount) || 0,
      coverage: Number(summary.coverage) || 0,
      conflicts: Number(summary.conflicts) || 0,
      exactPatternCount: Number(summary.exactPatternCount) || 0,
      mappingAgreement: Boolean(summary.mappingAgreement)
    });
    this.l3KeyJoinDryRun = session.summary;
    return session;
  }

  recordL3KeyJoinDryRunTarget({ targetOrder, index, identity } = {}) {
    if (this.isLocalWorkNavigationActive()) return this.l3KeyJoinDryRun;
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return this.l3KeyJoinDryRun;
    const conversationId = this.currentConversationId;
    const session = conversationId ? this.l3KeyJoinDryRunSessions.get(conversationId) : null;
    const currentScan = session?.patternKey ? collectL3ExactKeyJoinDryRunMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      preferredPattern: session.patternKey
    }) : null;
    const currentSummary = currentScan?.summary ?? null;
    const mappingStable = Boolean(
      session
      && session.status === "dry-run-ready"
      && Number(session.knownTurnCount) === Number(index.size?.() ?? 0)
      && currentSummary?.oneToOne
      && Number(currentSummary?.conflicts) === 0
      && currentScan?.patternKey === session.patternKey
      && sameL3KeyJoinIdentityMap(session.identityByTarget, currentScan?.identityByTarget)
    );
    const exactCurrent = isL3ExactKeyJoinScan(currentScan, index);
    let adaptiveRescanState = session?.adaptiveRescanState ?? "idle";
    let freshMapAccepted = null;
    if (session && exactCurrent) {
      this.clearL3AdaptiveRescanTimer();
      this.clearL3EventRecoveryWatch();
      if (!mappingStable) {
        adoptL3ExactKeyJoinScan(session, currentScan);
        adaptiveRescanState = "accepted-current";
        freshMapAccepted = true;
      } else {
        adaptiveRescanState = "stable";
        freshMapAccepted = false;
      }
      session.adaptiveRescanState = adaptiveRescanState;
      session.adaptiveRescanAttempt = 0;
    } else if (session && currentScan) {
      this.clearL3AdaptiveRescanTimer();
      this.clearL3EventRecoveryWatch();
      adaptiveRescanState = "pending";
      freshMapAccepted = false;
      session.adaptiveRescanState = adaptiveRescanState;
      session.adaptiveRescanAttempt = 0;
    }
    const summary = createL3KeyJoinDryRunSummary({
      ...(session?.summary ?? this.l3KeyJoinDryRun),
      status: session?.status ?? this.l3KeyJoinDryRun?.status,
      stableScans: session?.stableScans ?? this.l3KeyJoinDryRun?.stableScans,
      ...createL3FreshDiagnostics(currentScan, targetOrder),
      mappingStable,
      adaptiveRescanState,
      adaptiveRescanAttempt: session?.adaptiveRescanAttempt ?? 0,
      freshMapAccepted
    });
    this.l3KeyJoinDryRun = summary;
    if (session) session.summary = summary;
    this.updateDebug("l3-key-join-dry-run-target");
    if (session && currentScan && !exactCurrent && conversationId) {
      this.scheduleL3AdaptiveRescan({ conversationId, targetOrder, attempt: 0 });
    }
    return summary;
  }

  clearL3AdaptiveRescanTimer() {
    this.l3AdaptiveRescanGeneration += 1;
    if (this.l3AdaptiveRescanTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.l3AdaptiveRescanTimer);
    this.l3AdaptiveRescanTimer = null;
  }

  scheduleL3AdaptiveRescan({ conversationId, targetOrder, attempt = 0 } = {}) {
    if (this.isLocalWorkNavigationActive()) return;
    if (!conversationId || !Number.isInteger(targetOrder) || targetOrder < 0 || attempt >= L3_ADAPTIVE_RESCAN_DELAYS_MS.length) return;
    const session = this.l3KeyJoinDryRunSessions.get(conversationId);
    if (!session?.patternKey) return;
    const generation = this.l3AdaptiveRescanGeneration;
    const delayMs = L3_ADAPTIVE_RESCAN_DELAYS_MS[attempt];
    const set = this.window?.setTimeout ?? setTimeout;
    this.l3AdaptiveRescanTimer = set(() => {
      this.l3AdaptiveRescanTimer = null;
      if (this.destroyed || generation !== this.l3AdaptiveRescanGeneration || this.currentConversationId !== conversationId || this.isLocalWorkNavigationActive()) return;
      const index = this.getTurnIndex(conversationId);
      const identity = this.host.getConversationIdentity?.() ?? null;
      if (!index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return;
      const scan = collectL3ExactKeyJoinDryRunMap({
        document: this.document,
        turns: index.getOrdered?.() ?? [],
        preferredPattern: session.patternKey
      });
      session.adaptiveRescanAttempt = attempt + 1;
      const exact = isL3ExactKeyJoinScan(scan, index);
      let state = "pending";
      let freshMapAccepted = false;
      if (exact) {
        adoptL3ExactKeyJoinScan(session, scan);
        this.clearL3EventRecoveryWatch();
        state = "recovered";
        freshMapAccepted = true;
      } else if (attempt + 1 >= L3_ADAPTIVE_RESCAN_DELAYS_MS.length) {
        state = "exhausted-watching";
      }
      session.adaptiveRescanState = state;
      session.summary = createL3KeyJoinDryRunSummary({
        ...(session.summary ?? this.l3KeyJoinDryRun),
        status: session.status,
        stableScans: session.stableScans,
        ...createL3FreshDiagnostics(scan, targetOrder),
        mappingStable: false,
        adaptiveRescanState: state,
        adaptiveRescanAttempt: session.adaptiveRescanAttempt,
        freshMapAccepted
      });
      this.l3KeyJoinDryRun = session.summary;
      this.updateDebug("l3-key-join-adaptive-rescan");
      if (!exact && state === "pending") this.scheduleL3AdaptiveRescan({ conversationId, targetOrder, attempt: attempt + 1 });
      if (!exact && state === "exhausted-watching") this.startL3EventRecoveryWatch({ conversationId, targetOrder });
    }, delayMs);
  }

  clearL3EventRecoveryTimer() {
    if (this.l3EventRecoveryTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.l3EventRecoveryTimer);
    this.l3EventRecoveryTimer = null;
  }

  clearL3EventRecoveryWatch() {
    this.clearL3EventRecoveryTimer();
    this.l3EventRecoveryWatch = null;
  }

  startL3EventRecoveryWatch({ conversationId, targetOrder } = {}) {
    this.clearL3EventRecoveryWatch();
    if (!conversationId || !Number.isInteger(targetOrder) || targetOrder < 0) return;
    const session = this.l3KeyJoinDryRunSessions.get(conversationId);
    if (!session?.patternKey) return;
    this.l3EventRecoveryWatch = { conversationId, targetOrder };
  }

  handleL3EventRecoveryMutation(records = []) {
    const watch = this.l3EventRecoveryWatch;
    if (!watch || this.isLocalWorkNavigationActive() || this.l3EventRecoveryTimer != null) return;
    if (!Array.from(records ?? []).length) return;
    if (this.currentConversationId !== watch.conversationId) {
      this.clearL3EventRecoveryWatch();
      return;
    }
    const set = this.window?.setTimeout ?? setTimeout;
    this.l3EventRecoveryTimer = set(() => {
      this.l3EventRecoveryTimer = null;
      const currentWatch = this.l3EventRecoveryWatch;
      if (this.destroyed || !currentWatch || currentWatch.conversationId !== watch.conversationId || this.currentConversationId !== watch.conversationId || this.isLocalWorkNavigationActive()) return;
      const index = this.getTurnIndex(watch.conversationId);
      const identity = this.host.getConversationIdentity?.() ?? null;
      const session = this.l3KeyJoinDryRunSessions.get(watch.conversationId);
      if (!index || !session?.patternKey || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
        this.clearL3EventRecoveryWatch();
        return;
      }
      const scan = collectL3ExactKeyJoinDryRunMap({
        document: this.document,
        turns: index.getOrdered?.() ?? [],
        preferredPattern: session.patternKey
      });
      const exact = isL3ExactKeyJoinScan(scan, index);
      let state = "exhausted-watching";
      let freshMapAccepted = false;
      if (exact) {
        adoptL3ExactKeyJoinScan(session, scan);
        state = "recovered-event";
        freshMapAccepted = true;
      }
      session.adaptiveRescanState = state;
      session.summary = createL3KeyJoinDryRunSummary({
        ...(session.summary ?? this.l3KeyJoinDryRun),
        status: session.status,
        stableScans: session.stableScans,
        ...createL3FreshDiagnostics(scan, watch.targetOrder),
        mappingStable: false,
        adaptiveRescanState: state,
        adaptiveRescanAttempt: session.adaptiveRescanAttempt,
        freshMapAccepted
      });
      this.l3KeyJoinDryRun = session.summary;
      this.updateDebug("l3-key-join-event-recovery");
      if (exact) this.clearL3EventRecoveryWatch();
    }, L3_EVENT_RECOVERY_DEBOUNCE_MS);
    this.l3EventRecoveryTimer?.unref?.();
  }

  isLocalWorkNavigationActive() {
    return Boolean(this.activeNavigation?.status === "running"
      && this.activeNavigation?.host === "local"
      && this.activeNavigation?.source === "sidebar-local");
  }

  clearL3PostNavigationScanTimer() {
    if (this.l3PostNavigationScanTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.l3PostNavigationScanTimer);
    this.l3PostNavigationScanTimer = null;
  }

  scheduleL3PostNavigationScan({ conversationId, targetOrder, requestId } = {}) {
    this.clearL3PostNavigationScanTimer();
    if (!conversationId || !Number.isInteger(targetOrder) || targetOrder < 0) return;
    const set = this.window?.setTimeout ?? setTimeout;
    this.l3PostNavigationScanTimer = set(() => {
      this.l3PostNavigationScanTimer = null;
      if (this.destroyed || requestId !== this.navigationRequestId || this.currentConversationId !== conversationId || this.isLocalWorkNavigationActive()) return;
      const index = this.getTurnIndex(conversationId);
      const identity = this.host.getConversationIdentity?.() ?? null;
      if (!index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return;
      this.recordL3KeyJoinDryRunTarget({ targetOrder, index, identity });
    }, L3_POST_NAVIGATION_SCAN_DELAY_MS);
    this.l3PostNavigationScanTimer?.unref?.();
  }

  scheduleHostInternalDepthProbe(conversationId, index, identity) {
    if (this.isLocalWorkNavigationActive()) return;
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return;
    const existing = this.hostInternalDepthProbeByConversation.get(conversationId);
    const drySession = this.l3KeyJoinDryRunSessions.get(conversationId) ?? null;
    if (existing) {
      this.hostInternalDepthProbe = existing;
      if (!drySession || drySession.status !== "dry-run-scanning") {
        if (drySession?.summary) this.l3KeyJoinDryRun = drySession.summary;
        return;
      }
    }
    if (this.hostInternalDepthProbeTimer != null) return;
    const attempts = Number(this.hostInternalDepthProbeAttempts.get(conversationId) ?? 0);
    const delays = [180, 420, 900, 1600, 2600];
    const delayMs = delays[Math.min(attempts, delays.length - 1)];
    const set = this.window?.setTimeout ?? setTimeout;
    this.hostInternalDepthProbeTimer = set(() => {
      this.hostInternalDepthProbeTimer = null;
      if (this.destroyed || this.currentConversationId !== conversationId || this.isLocalWorkNavigationActive()) return;
      const currentIdentity = this.host.getConversationIdentity?.() ?? null;
      if (!currentIdentity?.stable || currentIdentity.host !== "local" || currentIdentity.source !== "sidebar-local") return;
      const currentIndex = this.getTurnIndex(conversationId);
      const attempt = attempts + 1;
      this.hostInternalDepthProbeAttempts.set(conversationId, attempt);
      try {
        const result = collectHostInternalDepthProbe({ window: this.window, document: this.document, host: this.host, turns: currentIndex?.getOrdered?.() ?? [] });
        const markerCount = Number(result?.level0?.officialMarkerCount ?? 0);
        const markerComplete = markerCount > 0 || attempt >= delays.length;
        const dryRunSession = markerCount > 0 ? this.refreshL3KeyJoinDryRun({ conversationId, index: currentIndex, identity: currentIdentity, finalAttempt: attempt >= delays.length }) : null;
        const dryRunNeedsRetry = dryRunSession?.status === "dry-run-scanning";
        this.hostInternalDepthProbe = { ...result, markerProbeAttempt: attempt, markerProbeComplete: markerComplete };
        if (markerComplete) this.hostInternalDepthProbeByConversation.set(conversationId, this.hostInternalDepthProbe);
        this.updateDebug("host-internal-depth-probe");
        if (!markerComplete || dryRunNeedsRetry) this.scheduleHostInternalDepthProbe(conversationId, currentIndex, currentIdentity);
      } catch (error) {
        this.hostInternalDepthProbe = { error: String(error?.message ?? error ?? "unknown"), markerProbeAttempt: attempt, markerProbeComplete: true };
        this.hostInternalDepthProbeByConversation.set(conversationId, this.hostInternalDepthProbe);
        this.l3KeyJoinDryRun = createL3KeyJoinDryRunSummary({ status: "error" });
        this.updateDebug("host-internal-depth-probe-error");
      }
    }, delayMs);
    this.hostInternalDepthProbeTimer?.unref?.();
  }

  clearOfficialBridgeAutoTimer() {
    if (this.officialBridgeAutoTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.officialBridgeAutoTimer);
    this.officialBridgeAutoTimer = null;
  }

  scheduleOfficialBridgeAutoRetry(conversationId, session) {
    if (!conversationId || !session || session.status === "auto-official-ready" || this.officialBridgeAutoTimer != null) return;
    const attempt = Number(session.retryAttempt) || 0;
    if (attempt >= OFFICIAL_BRIDGE_AUTO_RETRY_DELAYS_MS.length) return;
    const delayMs = OFFICIAL_BRIDGE_AUTO_RETRY_DELAYS_MS[attempt];
    session.retryAttempt = attempt + 1;
    const set = this.window?.setTimeout ?? setTimeout;
    this.officialBridgeAutoTimer = set(() => {
      this.officialBridgeAutoTimer = null;
      if (this.destroyed || this.currentConversationId !== conversationId) return;
      this.refresh("official-bridge-auto-scan");
    }, delayMs);
  }

  refreshOfficialWorkAutoBridge({ conversationId, index, identity }) {
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
      if (conversationId === this.currentConversationId) this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "fallback-self", recommendedMode: "fallback-self" });
      return this.officialBridgeAuto;
    }
    const session = this.getOfficialBridgeAutoSession(conversationId);
    const scan = analyzeOfficialNavigationAutoMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      resolveMarkerKey: (markerKey) => this.host.resolveOfficialNavigationMarkerKey?.(markerKey) ?? null,
      minCoverage: 0.8
    });
    const signature = scan.summary.readyCandidate ? officialAutoMapSignature(scan.privatePairs) : "";
    if (scan.summary.readyCandidate && signature) {
      session.stableScans = session.lastSignature === signature ? session.stableScans + 1 : 1;
      session.lastSignature = signature;
      session.knownTurnCount = scan.summary.knownTurnCount;
      if (session.stableScans >= 2) {
        session.status = "auto-official-ready";
        session.pairsByTarget = new Map(scan.privatePairs.map((pair) => [pair.targetOrder, { markerKey: pair.markerKey, strategies: pair.strategies }]));
        this.clearOfficialBridgeAutoTimer();
      } else {
        session.status = "auto-scanning";
      }
    } else {
      session.status = "fallback-self";
      session.stableScans = 0;
      session.lastSignature = null;
      session.pairsByTarget = new Map();
      session.knownTurnCount = scan.summary.knownTurnCount;
    }
    session.summary = sanitizeOfficialNavigationAutoSummary({
      ...scan.summary,
      status: session.status,
      stableScans: session.stableScans,
      recommendedMode: session.status === "auto-official-ready" ? "auto-official-ready" : session.status === "auto-scanning" ? "auto-scanning" : "fallback-self"
    });
    this.officialBridgeAuto = session.summary;
    this.scheduleOfficialBridgeAutoRetry(conversationId, session);
    return session.summary;
  }

  getOfficialAutoBridgePair({ targetOrder, index }) {
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index || !this.currentConversationId) return null;
    const session = this.officialBridgeAutoSessions.get(this.currentConversationId);
    if (!session || session.status !== "auto-official-ready" || Number(session.knownTurnCount) !== Number(index.size?.() ?? 0)) return null;
    const pair = session.pairsByTarget.get(targetOrder);
    if (!pair?.markerKey) return null;
    const buttons = Array.from(this.document?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
    const matches = buttons.filter((button) => String(button?.getAttribute?.('data-thread-user-message-navigation-item-id') ?? '').trim() === pair.markerKey);
    if (matches.length !== 1) return null;
    return { marker: matches[0], targetOrder, strategies: [...(pair.strategies ?? [])] };
  }

  getOfficialBridgeSessionTrustedTargets() {
    const session = this.currentConversationId ? this.officialBridgeAutoSessions.get(this.currentConversationId) : null;
    if (!session || session.status !== "auto-official-ready") return [];
    return [...session.pairsByTarget.entries()]
      .map(([targetOrder, pair]) => ({ targetOrder: Number(targetOrder), trusted: true, source: "auto", strategies: [...(pair?.strategies ?? [])] }))
      .sort((a, b) => a.targetOrder - b.targetOrder);
  }

  getOfficialBridgeActiveOrder(index) {
    if (!index) return null;
    const activeTurnId = index.resolveCanonicalId?.(this.host.getActiveTurnId?.());
    const activeRecord = activeTurnId ? index.get?.(activeTurnId) : null;
    return Number.isFinite(activeRecord?.order) ? Number(activeRecord.order) : null;
  }

  hasTrustedOfficialWorkBridgeCandidate({ targetOrder, index, identity }) {
    if (!OFFICIAL_NAVIGATION_RUNTIME_ENABLED) return false;
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return false;
    return Boolean(this.getOfficialAutoBridgePair({ targetOrder, index }));
  }

  async tryOfficialWorkBridge({ targetOrder, index, identity, isCurrent }) {
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return { attempted: false, fallbackReason: "not-local-work" };
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index) return { attempted: false, fallbackReason: "invalid-target" };
    const pair = this.getOfficialAutoBridgePair({ targetOrder, index });
    if (!pair) return { attempted: false, fallbackReason: "auto-bridge-unavailable" };
    const marker = pair.marker;
    if (!marker || typeof marker.click !== "function") return { attempted: false, fallbackReason: "marker-unavailable" };

    const startedAt = appNowMs(this.window);
    let firstMatchedAt = null;
    try {
      this.officialBridgeInFlight = true;
      marker.click();
    } catch {
      return { attempted: true, succeeded: false, fallbackReason: "marker-click-failed", elapsedMs: Math.round(appNowMs(this.window) - startedAt) };
    } finally {
      this.officialBridgeInFlight = false;
    }

    while (appNowMs(this.window) - startedAt <= 650) {
      if (!isCurrent?.()) return { attempted: true, succeeded: false, fallbackReason: "superseded", elapsedMs: Math.round(appNowMs(this.window) - startedAt) };
      const activeOrder = this.getOfficialBridgeActiveOrder(index);
      const now = appNowMs(this.window);
      if (activeOrder === targetOrder) {
        if (firstMatchedAt == null) firstMatchedAt = now;
        if (now - firstMatchedAt >= 80) {
          this.host.persistLocalScrollPosition?.();
          return {
            attempted: true,
            succeeded: true,
            fallbackReason: null,
            elapsedMs: Math.round(now - startedAt),
            result: {
              ok: true,
              verified: true,
              reason: "official-bridge",
              settleMode: "official-bridge",
              officialBridgeAttempted: true,
              officialBridgeSucceeded: true,
              officialBridgeFallbackReason: null,
              steps: [{ mode: "official-bridge", direction: 0, elapsedMs: Math.round(now - startedAt), jumpPx: 0, waitMs: 0, targetOrder, progressKind: "target", before: null, after: null }]
            }
          };
        }
      } else {
        firstMatchedAt = null;
      }
      await waitMs(this.window, 24);
    }
    return { attempted: true, succeeded: false, fallbackReason: "verify-timeout", elapsedMs: Math.round(appNowMs(this.window) - startedAt) };
  }

  async navigate(turnId) {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    if (!index) return { ok: false, reason: "no-conversation" };
    const record = index.get(turnId);
    const targetOrder = Number.isFinite(record?.order) ? Number(record.order) : null;
    const requestId = ++this.navigationRequestId;
    const identity = this.host.getConversationIdentity?.() ?? null;
    const localWorkNavigation = Boolean(identity?.stable && identity.host === "local" && identity.source === "sidebar-local");
    if (localWorkNavigation) {
      this.clearL3AdaptiveRescanTimer();
      this.clearL3PostNavigationScanTimer();
      this.clearL3EventRecoveryWatch();
    }
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
    if (localWorkNavigation) this.host.notifyNavigationIntent?.();
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
    const bridge = { attempted: false, succeeded: false, fallbackReason: null, elapsedMs: 0 };
    if (!isCurrent()) {
      const superseded = { ok: false, target: turnId, verified: false, reason: "superseded", officialBridgeAttempted: Boolean(bridge.attempted), officialBridgeSucceeded: false, officialBridgeFallbackReason: bridge.fallbackReason ?? "superseded" };
      this.completeNavigationRun(navigationRun, superseded);
      return superseded;
    }

    const allowMountedFastSettle = Boolean(identity?.stable && (identity.host === "chatgpt" || identity.host === "local"));
    const cacheRestoredTurns = Number(this.cacheHydrationCounts.get(conversationId) ?? 0);
    const knownTurns = Number(index.size?.() ?? 0);
    const allowChatPredictiveFastPath = Boolean(
      identity?.stable
      && identity.host === "chatgpt"
      && knownTurns >= 20
      && cacheRestoredTurns >= Math.max(20, Math.ceil(knownTurns * 0.8))
    );
    let result = await this.host.navigateToTurn(turnId, {
      turns: index.getOrdered(),
      getTurns: () => index.getOrdered(),
      isCurrent,
      allowMountedFastSettle,
      allowChatPredictiveFastPath,
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
      fastAttempted: Boolean(result?.fastAttempted),
      fastSucceeded: Boolean(result?.fastSucceeded),
      fallbackReason: result?.fallbackReason ?? null,
      officialBridgeAttempted: Boolean(result?.officialBridgeAttempted),
      officialBridgeSucceeded: Boolean(result?.officialBridgeSucceeded),
      officialBridgeFallbackReason: result?.officialBridgeFallbackReason ?? null,
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
    if (L3_RUNTIME_ENABLED && localWorkNavigation && result?.ok && result?.verified && result?.reason !== "superseded") {
      this.scheduleL3PostNavigationScan({ conversationId, targetOrder: latestTargetOrder, requestId });
    }
    return result;
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
      officialNavigationHistory: this.officialNavigationHistory.map((item) => JSON.parse(JSON.stringify(item))),
      lastOfficialNavigation: this.officialNavigationHistory.length ? JSON.parse(JSON.stringify(this.officialNavigationHistory.at(-1))) : null,
      officialNavigationMapping: this.officialNavigationMapping ? JSON.parse(JSON.stringify(this.officialNavigationMapping)) : null,
      officialNavigationLearning: JSON.parse(JSON.stringify(this.officialNavigationLearning)),
      officialNavigationSessionLearning: JSON.parse(JSON.stringify(this.officialNavigationSessionLearning)),
      officialBridgeAuto: JSON.parse(JSON.stringify(this.officialBridgeAuto)),
      officialBridgeSessionTrustedTargets: this.getOfficialBridgeSessionTrustedTargets(),
      hostInternalDepthProbe: this.hostInternalDepthProbe ? JSON.parse(JSON.stringify(this.hostInternalDepthProbe)) : null,
      l3RuntimeEnabled: L3_RUNTIME_ENABLED,
      l3KeyJoinDryRun: createL3KeyJoinDryRunSummary(this.l3KeyJoinDryRun),
      officialNavigationLearningHistory: this.officialNavigationLearningHistory.map((item) => ({ ...item })),
      navigationUx: { ...this.navigationUx },
      navigationCompatibility: this.host?.getNavigationCompatibility?.() ?? null,
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
    this.navigationRequestId += 1;
    this.clearNavigationUxTimer();
    this.shell?.setNavigationState?.({ state: "idle", target: null, targetOrder: null, pendingVisible: false });
    this.saveConversationView(this.currentConversationId);
    this.observer?.disconnect?.();
    this.bindScrollContainer(null);
    this.window?.removeEventListener?.("popstate", this.boundRoute);
    this.window?.removeEventListener?.("hashchange", this.boundRoute);
    this.document?.removeEventListener?.("click", this.boundConversationSelect, true);
    this.clearConversationSelectTimer();
    this.clearOfficialBridgeAutoTimer();
    this.clearHostInternalDepthProbeTimer();
    this.clearL3AdaptiveRescanTimer();
    this.clearL3EventRecoveryWatch();
    this.officialNavigationProbe?.destroy?.();
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

function createL3KeyJoinDryRunSummary(value = {}) {
  const nullableBoolean = (input) => input === true ? true : input === false ? false : null;
  const nullableCount = (input) => input == null || !Number.isFinite(Number(input)) ? null : Math.max(0, Math.floor(Number(input)));
  const nullableRatio = (input) => input == null || !Number.isFinite(Number(input)) ? null : Math.max(0, Math.min(1, Number(input)));
  return {
    status: typeof value.status === "string" ? value.status : "idle",
    stableScans: Math.max(0, Number(value.stableScans) || 0),
    mappedTurnCount: Math.max(0, Number(value.mappedTurnCount) || 0),
    coverage: Math.max(0, Math.min(1, Number(value.coverage) || 0)),
    conflicts: Math.max(0, Number(value.conflicts) || 0),
    exactPatternCount: Math.max(0, Number(value.exactPatternCount) || 0),
    mappingAgreement: Boolean(value.mappingAgreement),
    currentMarkerCount: nullableCount(value.currentMarkerCount),
    currentKnownTurnCount: nullableCount(value.currentKnownTurnCount),
    currentExactPatternCount: nullableCount(value.currentExactPatternCount),
    currentRelationPatternCount: nullableCount(value.currentRelationPatternCount),
    currentMarkersWithKeyJoinCandidates: nullableCount(value.currentMarkersWithKeyJoinCandidates),
    currentKeyJoinMappedMarkers: nullableCount(value.currentKeyJoinMappedMarkers),
    currentKeyJoinUniqueTurns: nullableCount(value.currentKeyJoinUniqueTurns),
    currentBestKeyJoinCoverage: nullableRatio(value.currentBestKeyJoinCoverage),
    currentBestKeyJoinConflicts: nullableCount(value.currentBestKeyJoinConflicts),
    currentBestKeyJoinOneToOne: nullableBoolean(value.currentBestKeyJoinOneToOne),
    currentMappedTurnCount: nullableCount(value.currentMappedTurnCount),
    currentCoverage: nullableRatio(value.currentCoverage),
    currentConflicts: nullableCount(value.currentConflicts),
    currentOneToOne: nullableBoolean(value.currentOneToOne),
    preferredPatternPresent: nullableBoolean(value.preferredPatternPresent),
    alternateExactPatternAvailable: nullableBoolean(value.alternateExactPatternAvailable),
    mappingStable: nullableBoolean(value.mappingStable),
    targetResolvable: nullableBoolean(value.targetResolvable),
    markerConnected: nullableBoolean(value.markerConnected),
    adaptiveRescanState: typeof value.adaptiveRescanState === "string" ? value.adaptiveRescanState : "idle",
    adaptiveRescanAttempt: Math.max(0, Number(value.adaptiveRescanAttempt) || 0),
    freshMapAccepted: nullableBoolean(value.freshMapAccepted)
  };
}

function isL3ExactKeyJoinScan(scan, index) {
  const summary = scan?.summary ?? null;
  const expectedKnownTurnCount = Number(index?.size?.() ?? 0);
  return Boolean(
    summary?.oneToOne
    && Number(summary?.coverage) === 1
    && Number(summary?.conflicts) === 0
    && scan?.patternKey
    && scan?.identityByTarget instanceof Map
    && scan.identityByTarget.size === expectedKnownTurnCount
    && Number(summary?.knownTurnCount) === expectedKnownTurnCount
  );
}

function adoptL3ExactKeyJoinScan(session, scan) {
  if (!session || !scan?.patternKey || !(scan?.identityByTarget instanceof Map)) return false;
  session.patternKey = scan.patternKey;
  session.identityByTarget = new Map(scan.identityByTarget);
  session.knownTurnCount = Number(scan?.summary?.knownTurnCount) || 0;
  session.pairsByTarget = scan.pairsByTarget instanceof Map ? scan.pairsByTarget : new Map();
  session.status = "dry-run-ready";
  session.stableScans = Math.max(2, Number(session.stableScans) || 0);
  return true;
}

function createL3FreshDiagnostics(scan, targetOrder) {
  const currentSummary = scan?.summary ?? null;
  const pair = scan?.pairsByTarget instanceof Map ? scan.pairsByTarget.get(targetOrder) : null;
  const marker = pair?.marker ?? null;
  return {
    currentMarkerCount: currentSummary ? currentSummary.markerCount : null,
    currentKnownTurnCount: currentSummary ? currentSummary.knownTurnCount : null,
    currentExactPatternCount: currentSummary ? currentSummary.exactPatternCount : null,
    currentRelationPatternCount: currentSummary ? currentSummary.relationPatternCount : null,
    currentMarkersWithKeyJoinCandidates: currentSummary ? currentSummary.markersWithKeyJoinCandidates : null,
    currentKeyJoinMappedMarkers: currentSummary ? currentSummary.keyJoinMappedMarkers : null,
    currentKeyJoinUniqueTurns: currentSummary ? currentSummary.keyJoinUniqueTurns : null,
    currentBestKeyJoinCoverage: currentSummary ? currentSummary.bestKeyJoinCoverage : null,
    currentBestKeyJoinConflicts: currentSummary ? currentSummary.bestKeyJoinConflicts : null,
    currentBestKeyJoinOneToOne: currentSummary ? Boolean(currentSummary.bestKeyJoinOneToOne) : null,
    currentMappedTurnCount: currentSummary ? currentSummary.mappedTurnCount : null,
    currentCoverage: currentSummary ? currentSummary.coverage : null,
    currentConflicts: currentSummary ? currentSummary.conflicts : null,
    currentOneToOne: currentSummary ? Boolean(currentSummary.oneToOne) : null,
    preferredPatternPresent: currentSummary?.preferredPatternPresent ?? null,
    alternateExactPatternAvailable: currentSummary?.alternateExactPatternAvailable ?? null,
    targetResolvable: Boolean(pair && pair.markerIndex != null),
    markerConnected: Boolean(marker && marker.isConnected !== false)
  };
}
function sameL3KeyJoinIdentityMap(left, right) {
  if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
  for (const [targetOrder, identity] of left.entries()) {
    if (!right.has(targetOrder) || !Object.is(identity, right.get(targetOrder))) return false;
  }
  return true;
}

function isSlowNavigationStep(step = {}) {
  const elapsedMs = Number(step?.elapsedMs) || 0;
  const waitMs = Number(step?.waitMs) || 0;
  if (step?.mode === "chat-progressive" || step?.mode === "chat-fast") return elapsedMs >= 100;
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
    fastAttempted: Boolean(value.fastAttempted),
    fastSucceeded: Boolean(value.fastSucceeded),
    fallbackReason: typeof value.fallbackReason === "string" ? value.fallbackReason : null,
    officialBridgeAttempted: Boolean(value.officialBridgeAttempted),
    officialBridgeSucceeded: Boolean(value.officialBridgeSucceeded),
    officialBridgeFallbackReason: typeof value.officialBridgeFallbackReason === "string" ? value.officialBridgeFallbackReason : null,
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

function appNowMs(windowRef = globalThis.window) {
  const value = Number(windowRef?.performance?.now?.());
  return Number.isFinite(value) ? value : Date.now();
}

function waitMs(windowRef, ms) {
  const set = windowRef?.setTimeout ?? setTimeout;
  return new Promise((resolve) => set(resolve, Math.max(0, Number(ms) || 0)));
}

Object.assign(exports, { VERSION, TalkEnhancerV3App, registerBundle });

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

(() => {
  "use strict";
  if (window.top !== window || !String(location.href).startsWith("app://-/")) return;
  const bundle = window.__GPTTalkEnhancerV3Bundle;
  if (!bundle?.mount) {
    console.error("[GPT TalkEnhancer] v3 bundle is not loaded; ensure 00-gpt-talk-enhancer.v3.bundle.js is enabled before this loader.");
    return;
  }
  window.__GPTTalkEnhancerV3?.destroy?.();
  bundle.mount();
})();
