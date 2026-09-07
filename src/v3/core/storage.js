export class StorageAdapter {
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

export class LocalStorageAdapter extends StorageAdapter {
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

export class MemoryStorageAdapter extends StorageAdapter {
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
