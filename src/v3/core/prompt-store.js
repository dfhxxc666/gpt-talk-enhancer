export class PromptStore {
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
