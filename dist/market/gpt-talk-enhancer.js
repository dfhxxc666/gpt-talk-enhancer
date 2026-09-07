/*
@codex-plus-script
name: GPT TalkEnhancer
description: Conversation Timeline / Question List and Prompt Library for Codex Desktop.
version: 0.4.5
author: dfhxxc666
homepage: https://github.com/dfhxxc666/gpt-talk-enhancer
license: GPL-3.0-or-later

GPT TalkEnhancer includes GPL-derived Timeline / Question List work.
See the project NOTICE.md and LICENSE for attribution and license details.
*/

/*
 * GPT TalkEnhancer 0.4.5 Desktop bundle
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

  getConversationRoot() {
    return this.document?.querySelector?.("[data-thread-find-target='conversation']")
      ?? this.document?.querySelector?.("[data-chatgpt-conversation-selection-target='true']")
      ?? this.document?.querySelector?.("main [data-testid='conversation-turn-list']")
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
    return composer?.closest?.("form") ?? composer?.parentElement ?? null;
  }

  getComposerRect() {
    return this.getComposerForm()?.getBoundingClientRect?.() ?? null;
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
    if (this.document?.querySelector?.("#prompt-textarea, textarea[placeholder], [contenteditable='true'][role='textbox']")) return SURFACE.NEW_CHAT;
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
    workWheelWaitMs = 220,
    inactivityNavigationMs = 5000,
    absoluteMaxNavigationMs = 45000,
    maxNavigationMs = null,
    motionProgressWaitMs = 45,
    maxAlignFrames = 8,
    postSettleWaitMs = 160,
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
    this.maxAlignFrames = maxAlignFrames;
    this.postSettleWaitMs = postSettleWaitMs;
    this.maxPostSettleCorrections = maxPostSettleCorrections;
    this.compatibility = createNavigationCompatibility();
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true } = {}) {
    if (!turnId) return failure("missing-turn-id", turnId);
    if (!isCurrent()) return failure("superseded", turnId);
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
    if (indexState.targetIndex < 0) return failure("unknown-turn", turnId);

    const container = this.conversationAdapter.getScrollContainer();
    if (!container) return failure("missing-scroll-container", turnId);
    const isNavigationCurrent = () => isCurrent() && this.conversationAdapter.getScrollContainer() === container;
    if (!isNavigationCurrent()) return failure("superseded", turnId);

    this.compatibility = createNavigationCompatibility();
    const startedAt = nowMs(this.window);
    let lastProgressAt = startedAt;
    let probes = 0;
    let consecutiveStalls = 0;
    let workCompatibilityNotified = false;
    let snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    let candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    const readTargetOrder = () => getIndexState().targetOrder;
    const readMaxKnownOrder = () => getIndexState().maxKnownOrder;
    if (candidate) {
      lastProgressAt = nowMs(this.window);
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
      indexState = getIndexState();
      snapshot = this.readHydrationSnapshot(container, indexState.targetOrder, indexState.orderById);
    }

    while (probes < this.maxHydrationSteps && nowMs(this.window) - startedAt < this.absoluteMaxNavigationMs) {
      const loopNow = nowMs(this.window);
      if (loopNow - lastProgressAt >= this.inactivityNavigationMs) {
        return this.navigationFailure("navigation-inactive", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
          inactiveMs: Math.round(loopNow - lastProgressAt)
        });
      }
      if (!isNavigationCurrent()) return failure("superseded", turnId);

      const refreshedIndex = getIndexState();
      if (refreshedIndex.targetIndex < 0) return failure("unknown-turn", turnId);
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
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
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
      const reverseEarlier = model.isColumnReverse && direction < 0 && targetBeforeVisible;

      if (reverseEarlier) {
        if (!workCompatibilityNotified) {
          workCompatibilityNotified = true;
          this.notifyCodexPlusScrollIntent(container, isNavigationCurrent);
        }
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
        if (outcome.state === "superseded") return failure("superseded", turnId);
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
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
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
        return this.navigationFailure("work-wheel-stalled", turnId, {
          probes, stalls: 1, container, startedAt, getIndexState
        });
      }

      const computedJump = hydrationStepSize(model, visibleOrders, targetOrder);
      const nudgeScale = consecutiveStalls > 0 ? 0.42 : 1;
      const jump = Math.max(
        Math.min(computedJump * nudgeScale, model.maxLogicalPosition || computedJump),
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
      const moved = Math.abs(nextLogical - model.logicalPosition) >= 1;
      const outcome = await this.awaitHydrationProgress({
        turnId,
        targetOrder,
        previousSnapshot: currentSnapshot,
        direction,
        container,
        isCurrent: isNavigationCurrent,
        orderById,
        getIndexState,
        waitMs: this.hydrationWaitMs,
        allowMotionProgress: true,
        scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
      });
      if (outcome.state === "superseded") return failure("superseded", turnId);
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
        if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
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
          if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
        }
        return this.navigationFailure("hydration-stalled", turnId, {
          probes, stalls: consecutiveStalls, container, startedAt, getIndexState
        });
      }
    }

    indexState = getIndexState();
    candidate = this.resolveCandidate(turnId, indexState.targetOrder);
    if (candidate) {
      const aligned = await this.verifyAndAlign(turnId, candidate, isNavigationCurrent, probes, readTargetOrder, readMaxKnownOrder);
      if (aligned.ok || !retryableAlignmentFailure(aligned.reason)) return aligned;
    }
    return this.navigationFailure("navigation-hard-limit", turnId, {
      probes, stalls: consecutiveStalls, container, startedAt, getIndexState,
      budgetLimit: probes >= this.maxHydrationSteps ? "probes" : "absolute-time"
    });
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

  async awaitHydrationProgress({ turnId, targetOrder, previousSnapshot, direction, container, isCurrent, orderById = null, getIndexState = null, waitMs = this.hydrationWaitMs, allowMotionProgress = true, scrollAction = null }) {
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
      }, this.motionProgressWaitMs);
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
    const step = Number(currentTurnCount) <= 12 ? Math.max(180, Math.min(configuredStep, viewport * 0.5)) : configuredStep;
    const nextLogical = clamp(model.logicalPosition - step, model.minLogicalPosition, model.maxLogicalPosition);
    const moved = Math.abs(nextLogical - model.logicalPosition) >= 1;
    dispatchWheelEvent(container, this.window, -step);
    const outcome = await this.awaitHydrationProgress({
      turnId,
      targetOrder: currentTargetOrder,
      previousSnapshot,
      direction: -1,
      container,
      isCurrent,
      orderById: currentOrderById,
      getIndexState,
      waitMs: moved ? this.workWheelWaitMs : this.hydrationWaitMs,
      allowMotionProgress: false,
      scrollAction: moved ? () => setLogicalScrollPosition(container, nextLogical, model) : null
    });
    return { ...outcome, moved };
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

  async verifyAndAlign(turnId, candidateOrElement, isCurrent, probes, targetOrder = -1, maxKnownOrder = null) {
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

Object.assign(exports, { NavigationAdapter, computeActiveTurnId, rectInActivationZone, readScrollModel, setLogicalScrollPosition, chooseHydrationDirection, hydrationStepSize, turnWindowDistance, createHydrationSnapshot, hasHydrationProgress, hasTurnWindowProgress, visibleOrderRange });

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
    return computeActiveTurnId({
      visibleTurns,
      resolveTurn,
      container,
      activationOffset: 120
    });
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true } = {}) {
    const requestId = ++this.navigationRequestId;
    const stillCurrent = () => requestId === this.navigationRequestId && isCurrent();
    const result = await this.navigation.navigateToTurn(turnId, {
      turns,
      getTurns,
      isCurrent: stillCurrent
    });
    if (result?.ok && result?.verified && stillCurrent()) this.persistLocalScrollPosition();
    return result;
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
      button.title = `Q${order + 1} ${displayText}`.trim();
      button.setAttribute("aria-label", button.title);
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
    this.opened = Boolean(open);
    if (this.element) this.element.hidden = !this.opened;
    if (this.opened) {
      this.manualBrowse = false;
      this.updatePosition();
      this.scrollActiveIntoView();
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

  updatePosition() {
    if (!this.opened || !this.element) return;
    const anchor = this.getAnchorRect?.();
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
    const promptVisible = surface === SURFACE.CONVERSATION || surface === SURFACE.NEW_CHAT;
    this.rail?.setVisible(timelineVisible);
    this.questionList?.setVisible(timelineVisible);
    this.promptTrigger?.setVisible(promptVisible);
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
      ? Math.max(10, viewportWidth - Math.min(viewportWidth, Math.max(0, contentRight)) + 10)
      : 10;
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
const { AppShell } = __require("src/v3/ui/app-shell.js");

const VERSION = "0.4.5";
const NAVIGATION_PENDING_DELAY_MS = 650;

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
    this.lastNavigation = { target: null, verified: false, reason: "none" };
    this.navigationRequestId = 0;
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
      this.observer = new this.window.MutationObserver(() => this.scheduleRefresh("mutation"));
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
    this.invalidateNavigation("conversation-select");
    this.scheduleRefresh("conversation-select");
    if (this.conversationSelectTimer != null) {
      const clear = this.window?.clearTimeout ?? clearTimeout;
      clear(this.conversationSelectTimer);
    }
    const set = this.window?.setTimeout ?? setTimeout;
    this.conversationSelectTimer = set(() => {
      this.conversationSelectTimer = null;
      this.refresh("conversation-select-settled");
    }, 240);
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

  async navigate(turnId) {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    if (!index) return { ok: false, reason: "no-conversation" };
    const record = index.get(turnId);
    const targetOrder = Number.isFinite(record?.order) ? Number(record.order) : null;
    const requestId = ++this.navigationRequestId;
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
    const result = await this.host.navigateToTurn(turnId, { turns: index.getOrdered(), getTurns: () => index.getOrdered(), isCurrent });
    if (requestId !== this.navigationRequestId) return result;
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
      targetOrder: latestTargetOrder
    };
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
    if (this.conversationSelectTimer != null) {
      const clear = this.window?.clearTimeout ?? clearTimeout;
      clear(this.conversationSelectTimer);
      this.conversationSelectTimer = null;
    }
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
