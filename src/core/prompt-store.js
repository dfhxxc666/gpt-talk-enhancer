import { STORAGE_KEYS } from "./constants.js";

const SCHEMA_VERSION = 1;

export class PromptStore {
  constructor({
    storage,
    key = STORAGE_KEYS.prompts,
    clock = () => Date.now(),
    idFactory = defaultIdFactory
  } = {}) {
    this.storage = storage;
    this.key = key;
    this.clock = clock;
    this.idFactory = idFactory;
    this.items = [];
    this.loaded = false;
  }

  load() {
    if (this.loaded) {
      return this.list();
    }
    this.loaded = true;
    const raw = this.storage?.get(this.key);
    if (!raw) {
      this.items = [];
      return this.list();
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.items)) {
        this.items = [];
        return this.list();
      }
      this.items = parsed.items.map(normalizePrompt).filter(Boolean);
      return this.list();
    } catch {
      this.items = [];
      return this.list();
    }
  }

  list() {
    this.ensureLoaded();
    return [...this.items].sort(comparePrompts).map(clonePrompt);
  }

  search(query = "") {
    const normalizedQuery = String(query).trim().toLocaleLowerCase();
    return this.list().filter((prompt) => {
      if (!normalizedQuery) return true;
      return `${prompt.name}\n${prompt.content}`.toLocaleLowerCase().includes(normalizedQuery);
    });
  }

  get(id) {
    this.ensureLoaded();
    const prompt = this.items.find((item) => item.id === id);
    return prompt ? clonePrompt(prompt) : null;
  }

  create({ name, content, favorite = false } = {}) {
    this.ensureLoaded();
    const normalized = validatePromptInput({ name, content });
    const now = this.clock();
    const prompt = {
      id: String(this.idFactory()),
      name: normalized.name,
      content: normalized.content,
      favorite: Boolean(favorite),
      order: this.nextOrder(),
      createdAt: now,
      updatedAt: now
    };
    this.items.push(prompt);
    this.persist();
    return clonePrompt(prompt);
  }

  update(id, patch = {}) {
    this.ensureLoaded();
    const prompt = this.items.find((item) => item.id === id);
    if (!prompt) return null;
    const normalized = validatePromptInput({
      name: patch.name ?? prompt.name,
      content: patch.content ?? prompt.content
    });
    prompt.name = normalized.name;
    prompt.content = normalized.content;
    if (patch.favorite !== undefined) prompt.favorite = Boolean(patch.favorite);
    if (patch.order !== undefined && Number.isFinite(Number(patch.order))) prompt.order = Number(patch.order);
    prompt.updatedAt = this.clock();
    this.persist();
    return clonePrompt(prompt);
  }

  setFavorite(id, favorite) {
    return this.update(id, { favorite: Boolean(favorite) });
  }

  toggleFavorite(id) {
    const prompt = this.get(id);
    return prompt ? this.setFavorite(id, !prompt.favorite) : null;
  }

  delete(id) {
    this.ensureLoaded();
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    this.persist();
    return true;
  }

  ensureLoaded() {
    if (!this.loaded) this.load();
  }

  nextOrder() {
    return this.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1;
  }

  persist() {
    const payload = JSON.stringify({
      version: SCHEMA_VERSION,
      items: this.items.map(clonePrompt)
    });
    return this.storage?.set(this.key, payload) ?? false;
  }
}

export function normalizePrompt(value) {
  if (!value || typeof value !== "object") return null;
  try {
    const input = validatePromptInput({ name: value.name, content: value.content });
    const createdAt = finiteTimestamp(value.createdAt) ?? Date.now();
    const updatedAt = finiteTimestamp(value.updatedAt) ?? createdAt;
    return {
      id: String(value.id || defaultIdFactory()),
      name: input.name,
      content: input.content,
      favorite: Boolean(value.favorite),
      order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0,
      createdAt,
      updatedAt
    };
  } catch {
    return null;
  }
}

function validatePromptInput({ name, content }) {
  const normalizedName = String(name ?? "").trim();
  const normalizedContent = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  if (!normalizedName) throw new Error("Prompt name is required");
  if (!normalizedContent) throw new Error("Prompt content is required");
  return { name: normalizedName, content: normalizedContent };
}

function comparePrompts(left, right) {
  if (left.order !== right.order) return left.order - right.order;
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  return left.id.localeCompare(right.id);
}

function clonePrompt(prompt) {
  return { ...prompt };
}

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
