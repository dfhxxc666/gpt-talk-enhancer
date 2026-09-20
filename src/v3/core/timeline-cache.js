export const TIMELINE_CACHE_KEY = "gpt-talk-enhancer.timeline-cache.v1";
export const TIMELINE_CACHE_SCHEMA_VERSION = 1;

export class TimelineCache {
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
    this.loadDiagnostics = new Map();
  }

  load(conversationId) {
    return this.loadWithHealth(conversationId).turns;
  }

  loadWithHealth(conversationId) {
    const id = normalizeConversationId(conversationId);
    if (!id) {
      return {
        turns: [],
        status: "invalid-conversation",
        health: analyzeTimelineCacheOrderHealth([]),
        sourceTurnCount: 0,
        loadedTurnCount: 0
      };
    }
    const root = this.#readRoot();
    const entry = root.conversations[id];
    if (!entry || !Array.isArray(entry.turns)) {
      const diagnostics = {
        status: "empty",
        health: analyzeTimelineCacheOrderHealth([]),
        sourceTurnCount: 0,
        loadedTurnCount: 0
      };
      this.loadDiagnostics.set(id, diagnostics);
      return { turns: [], ...diagnostics };
    }

    const health = analyzeTimelineCacheOrderHealth(entry.turns);
    const turns = normalizeTurns(entry.turns, this.maxTurnsPerConversation);
    if (health.corrupt) {
      const salvaged = trustedOrderAnchors(turns);
      const diagnostics = {
        status: salvaged.length ? "salvaged" : "rejected",
        health,
        sourceTurnCount: entry.turns.length,
        loadedTurnCount: salvaged.length
      };
      this.signatures.delete(id);
      this.loadDiagnostics.set(id, diagnostics);
      return { turns: salvaged, ...diagnostics };
    }

    const diagnostics = {
      status: "healthy",
      health,
      sourceTurnCount: entry.turns.length,
      loadedTurnCount: turns.length
    };
    this.signatures.set(id, turnSignature(turns));
    this.loadDiagnostics.set(id, diagnostics);
    return { turns, ...diagnostics };
  }

  getLoadDiagnostics(conversationId) {
    const id = normalizeConversationId(conversationId);
    if (!id) return null;
    const value = this.loadDiagnostics.get(id);
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  save(conversationId, turns = []) {
    const id = normalizeConversationId(conversationId);
    if (!id) return false;
    const health = analyzeTimelineCacheOrderHealth(turns);
    if (health.corrupt) return false;
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

  listConversations() {
    const root = this.#readRoot();
    return Object.values(root.conversations)
      .filter((entry) => entry && normalizeConversationId(entry.conversationId))
      .map((entry) => ({
        conversationId: normalizeConversationId(entry.conversationId),
        updatedAt: Number(entry.updatedAt) || 0,
        turns: (() => {
          const turns = normalizeTurns(entry.turns, this.maxTurnsPerConversation);
          return analyzeTimelineCacheOrderHealth(entry.turns).corrupt
            ? trustedOrderAnchors(turns)
            : turns;
        })()
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

export function analyzeTimelineCacheOrderHealth(turns = []) {
  const records = Array.isArray(turns) ? turns : [];
  const ids = new Set();
  const duplicateIds = [];
  const counts = new Map();
  let invalidIdCount = 0;
  let invalidOrderCount = 0;

  for (const turn of records) {
    const id = String(turn?.id ?? "").trim();
    if (!id) {
      invalidIdCount += 1;
    } else if (ids.has(id)) {
      duplicateIds.push(id);
    } else {
      ids.add(id);
    }

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
  if (Number.isInteger(min) && Number.isInteger(max)) {
    for (let order = min; order <= max; order += 1) {
      if (!counts.has(order)) missingOrders.push(order);
    }
  }

  const corrupt = invalidIdCount > 0
    || invalidOrderCount > 0
    || duplicateIds.length > 0
    || duplicateOrders.length > 0
    || missingOrders.length > 0;

  return {
    healthy: !corrupt,
    corrupt,
    count: records.length,
    validIdCount: ids.size,
    uniqueOrderCount: orders.length,
    min,
    max,
    duplicateIds: [...new Set(duplicateIds)].sort(),
    duplicateOrders,
    missingOrders,
    invalidIdCount,
    invalidOrderCount
  };
}

export function normalizeCachedTurn(input = {}) {
  const id = String(input?.id ?? "").trim();
  const order = Number(input?.order);
  if (!id || !Number.isInteger(order) || order < 0) return null;
  return {
    id,
    order,
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