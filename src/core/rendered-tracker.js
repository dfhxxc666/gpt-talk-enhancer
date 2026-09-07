export class RenderedTracker {
  constructor({ adapter, registry, onChange = () => {}, clock = () => Date.now() } = {}) {
    this.adapter = adapter;
    this.registry = registry;
    this.onChange = onChange;
    this.clock = clock;
    this.root = null;
    this.scrollContainer = null;
    this.lastTurns = [];
    this.lastFingerprint = null;
    this.refreshCount = 0;
    this.changeCount = 0;
    this.disposed = false;
  }

  bind(root, scrollContainer) {
    this.root = root;
    this.scrollContainer = scrollContainer;
    this.lastFingerprint = null;
    this.disposed = false;
    return this.refresh("bind");
  }

  refresh(reason = "manual") {
    if (this.disposed || !this.root) {
      return [];
    }
    this.refreshCount += 1;
    this.lastTurns = this.adapter.getRenderedUserTurns(this.root, this.scrollContainer);
    const records = this.registry.syncRendered(this.lastTurns, this.clock());
    const fingerprint = this.lastTurns.map((turn) => [
      turn.key,
      turn.text,
      turn.logicalOrder
    ]).map((part) => JSON.stringify(part)).join("|");
    const changed = fingerprint !== this.lastFingerprint;
    this.lastFingerprint = fingerprint;
    if (changed) {
      this.changeCount += 1;
      this.onChange({ reason, turns: this.lastTurns, records });
    }
    return records;
  }

  getRenderedTurns() {
    return [...this.lastTurns];
  }

  dispose() {
    this.disposed = true;
    this.root = null;
    this.scrollContainer = null;
    this.lastTurns = [];
    this.lastFingerprint = null;
  }

  status() {
    return {
      bound: Boolean(this.root),
      refreshCount: this.refreshCount,
      changeCount: this.changeCount,
      renderedCount: this.lastTurns.length
    };
  }
}
