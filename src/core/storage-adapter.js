export class StorageAdapter {
  get(_key) {
    throw new Error("StorageAdapter.get must be implemented");
  }

  set(_key, _value) {
    throw new Error("StorageAdapter.set must be implemented");
  }

  remove(_key) {
    throw new Error("StorageAdapter.remove must be implemented");
  }
}

export class LocalStorageAdapter extends StorageAdapter {
  constructor(storage = getGlobalStorage()) {
    super();
    this.storage = storage ?? null;
  }

  get(key) {
    if (!this.storage) return null;
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  set(key, value) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  remove(key) {
    if (!this.storage) return false;
    try {
      this.storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}

function getGlobalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class MemoryStorageAdapter extends StorageAdapter {
  constructor(initial = {}) {
    super();
    this.values = new Map(Object.entries(initial));
  }

  get(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  set(key, value) {
    this.values.set(key, value);
    return true;
  }

  remove(key) {
    return this.values.delete(key);
  }
}

export class SettingsStore {
  constructor({ storage, key = "gpt-talk-enhancer.settings.v1" } = {}) {
    this.storage = storage;
    this.key = key;
  }

  load() {
    const fallback = { version: 1, data: { timelineExpanded: false } };
    const raw = this.storage?.get(this.key);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || typeof parsed.data !== "object") return fallback;
      return {
        version: 1,
        data: {
          timelineExpanded: Boolean(parsed.data.timelineExpanded)
        }
      };
    } catch {
      return fallback;
    }
  }

  save(data) {
    return this.storage?.set(this.key, JSON.stringify({
      version: 1,
      data: { timelineExpanded: Boolean(data?.timelineExpanded) }
    })) ?? false;
  }
}
