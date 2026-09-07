export class SettingsStore {
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
