import { SCROLL_MODEL } from "./constants.js";
import { safeIsConnected } from "./dom-utils.js";

export class ActiveTracker {
  constructor({ adapter, registry, onActiveChange = () => {}, document: documentRef = globalThis.document, window: windowRef = globalThis.window, footerHeight = SCROLL_MODEL.composerFooterHeight } = {}) {
    this.adapter = adapter;
    this.registry = registry;
    this.onActiveChange = onActiveChange;
    this.document = documentRef;
    this.window = windowRef;
    this.footerHeight = footerHeight;
    this.scrollContainer = null;
    this.intersectionObserver = null;
    this.scrollHandler = null;
    this.frame = null;
    this.activeKey = null;
    this.observedElements = new Set();
    this.disposed = false;
  }

  bind(scrollContainer) {
    this.dispose();
    this.disposed = false;
    this.scrollContainer = safeIsConnected(scrollContainer) ? scrollContainer : null;
    if (!this.scrollContainer) {
      return;
    }

    const IntersectionObserverCtor = this.window?.IntersectionObserver ?? globalThis.IntersectionObserver;
    if (IntersectionObserverCtor) {
      try {
        this.intersectionObserver = new IntersectionObserverCtor(
          () => this.scheduleUpdate(),
          {
            root: scrollContainer,
            rootMargin: `0px 0px -${this.footerHeight}px 0px`,
            threshold: [0, 0.25, 0.5, 0.75, 1]
          }
        );
      } catch {
        this.intersectionObserver = null;
      }
    }

    this.scrollHandler = () => this.scheduleUpdate();
    scrollContainer.addEventListener?.("scroll", this.scrollHandler, { passive: true });
    this.refresh();
  }

  refresh() {
    if (!this.scrollContainer || this.disposed) {
      return null;
    }
    const records = this.registry?.getRenderedRecords?.() ?? [];
    if (this.intersectionObserver) {
      const nextElements = new Set(records
        .map((record) => record.element)
        .filter((element) => safeIsConnected(element)));
      for (const element of this.observedElements) {
        if (!nextElements.has(element)) this.intersectionObserver.unobserve?.(element);
      }
      for (const element of nextElements) {
        if (this.observedElements.has(element)) continue;
        try {
          this.intersectionObserver.observe(element);
        } catch {
          // Virtualized elements may detach between registry refresh and observe.
        }
      }
      this.observedElements = nextElements;
    }
    return this.updateFromGeometry();
  }

  scheduleUpdate() {
    if (this.frame !== null || this.disposed) {
      return;
    }
    const requestFrame = this.window?.requestAnimationFrame;
    if (typeof requestFrame === "function") {
      this.frame = requestFrame(() => {
        this.frame = null;
        this.updateFromGeometry();
      });
      return;
    }
    this.frame = setTimeout(() => {
      this.frame = null;
      this.updateFromGeometry();
    }, 0);
  }

  updateFromGeometry() {
    if (!this.scrollContainer || this.disposed) {
      return null;
    }
    const containerRect = this.scrollContainer.getBoundingClientRect?.();
    if (!containerRect) {
      return null;
    }
    const contentBottom = containerRect.bottom - this.footerHeight;
    const usableHeight = Math.max(1, contentBottom - containerRect.top);
    const activationLine = containerRect.top + Math.min(140, Math.max(72, usableHeight * 0.22));
    let beforeLine = null;
    let afterLine = null;

    for (const record of this.registry?.getRenderedRecords?.() ?? []) {
      if (!safeIsConnected(record.element)) continue;
      if (typeof this.adapter?.getTurnKey === "function"
        && this.adapter.getTurnKey(record.element) !== record.key) continue;
      const rect = record.element?.getBoundingClientRect?.();
      if (!rect || rect.top >= contentBottom) continue;
      const candidate = { record, rect };
      if (rect.top <= activationLine) {
        if (!beforeLine || rect.top > beforeLine.rect.top) beforeLine = candidate;
      } else if (!afterLine || rect.top < afterLine.rect.top) {
        afterLine = candidate;
      }
    }

    const nextKey = (beforeLine ?? afterLine)?.record.key ?? null;
    if (nextKey !== this.activeKey) {
      this.activeKey = nextKey;
      this.onActiveChange(nextKey);
    }
    return nextKey;
  }

  setActiveKey(key, { notify = false } = {}) {
    this.activeKey = key ?? null;
    if (notify) this.onActiveChange(this.activeKey);
  }

  dispose() {
    this.disposed = true;
    if (this.scrollContainer && this.scrollHandler) {
      this.scrollContainer.removeEventListener?.("scroll", this.scrollHandler);
    }
    this.intersectionObserver?.disconnect?.();
    this.intersectionObserver = null;
    this.observedElements.clear();
    if (this.frame !== null) {
      if (this.window?.cancelAnimationFrame && typeof this.frame === "number") {
        this.window.cancelAnimationFrame(this.frame);
      } else {
        clearTimeout(this.frame);
      }
      this.frame = null;
    }
    this.scrollContainer = null;
    this.scrollHandler = null;
    this.activeKey = null;
  }

  status() {
    const bound = !this.disposed && safeIsConnected(this.scrollContainer);
    return {
      bound,
      intersectionObserverActive: bound && Boolean(this.intersectionObserver),
      activeKey: this.activeKey,
      observedCount: this.observedElements.size
    };
  }
}
