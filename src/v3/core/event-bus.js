export class EventBus {
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
