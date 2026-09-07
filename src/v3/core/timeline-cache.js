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

export function normalizeCachedTurn(input = {}) {
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