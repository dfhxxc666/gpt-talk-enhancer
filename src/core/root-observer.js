import { SELECTORS } from "./constants.js";
import { containsAny, isElement, matchesAny, toNodeArray } from "./dom-utils.js";

const ROOT_OBSERVER_SELECTORS = [
  ...SELECTORS.conversationRoots,
  ...SELECTORS.scrollContainers,
  ...SELECTORS.composerRoots,
  ...SELECTORS.editors,
  ...SELECTORS.primaryComposerMounts,
  ...SELECTORS.fallbackComposerAnchors
];

const ROOT_OBSERVER_ATTRIBUTES = [
  "data-thread-find-target",
  "data-chatgpt-conversation-selection-target",
  "data-app-action-timeline-scroll",
  "data-thread-find-composer",
  "data-composer-placement",
  "data-codex-composer-root",
  "data-composer-footer-responsive",
  "data-composer-navigation-target",
  "data-composer-markdown",
  "data-thread-id",
  "data-conversation-id",
  "data-thread-key",
  "data-conversation-key",
  "contenteditable",
  "role"
];

export class RootObserver {
  constructor({ adapter, onContextChange = () => {}, document: documentRef = globalThis.document, window: windowRef = globalThis.window } = {}) {
    this.adapter = adapter;
    this.onContextChange = onContextChange;
    this.document = documentRef;
    this.window = windowRef;
    this.observer = null;
    this.frame = null;
    this.lastContext = null;
    this.disposed = false;
  }

  start() {
    this.dispose();
    this.disposed = false;
    const target = this.document ?? this.document?.documentElement;
    const MutationObserverCtor = this.window?.MutationObserver ?? globalThis.MutationObserver;
    if (!target || !MutationObserverCtor) {
      this.refresh();
      return false;
    }

    this.observer = new MutationObserverCtor((mutations) => {
      if (mutations.some((mutation) => this.isRelevantMutation(mutation))) this.scheduleRefresh();
    });
    this.observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ROOT_OBSERVER_ATTRIBUTES
    });
    this.refresh();
    return true;
  }

  isRelevantMutation(mutation) {
    if (!mutation) return false;
    const current = this.lastContext;
    const target = isElement(mutation.target) ? mutation.target : null;

    if (mutation.type === "attributes") {
      if (!target) return false;
      if (current && (target === current.root
        || target === current.scrollContainer
        || target === current.composerRoot
        || target === current.editor
        || target === current.mount?.anchor
        || target === current.mount?.container)) {
        return true;
      }
      return matchesAny(target, ROOT_OBSERVER_SELECTORS) || containsAny(target, ROOT_OBSERVER_SELECTORS);
    }

    if (mutation.type !== "childList") return false;
    const addedNodes = toNodeArray(mutation.addedNodes);
    const removedNodes = toNodeArray(mutation.removedNodes);
    if (current && removedNodes.some((node) => node === current.root
      || node === current.scrollContainer
      || node === current.composerRoot
      || node === current.editor
      || node === current.mount?.anchor
      || node === current.mount?.container)) {
      return true;
    }

    return [...addedNodes, ...removedNodes]
      .some((node) => isElement(node) && (matchesAny(node, ROOT_OBSERVER_SELECTORS) || containsAny(node, ROOT_OBSERVER_SELECTORS)));
  }

  scheduleRefresh() {
    if (this.frame !== null || this.disposed) return;
    const requestFrame = this.window?.requestAnimationFrame;
    if (typeof requestFrame === "function") {
      this.frame = requestFrame(() => {
        this.frame = null;
        this.refresh();
      });
      return;
    }
    this.frame = setTimeout(() => {
      this.frame = null;
      this.refresh();
    }, 0);
  }

  refresh() {
    if (this.disposed || !this.adapter) return null;
    const context = this.adapter.getContext();
    const changed = this.adapter.contextChanged(this.lastContext, context);
    this.lastContext = context;
    this.onContextChange(context, { changed });
    return context;
  }

  dispose() {
    this.disposed = true;
    this.observer?.disconnect?.();
    this.observer = null;
    if (this.frame !== null) {
      if (this.window?.cancelAnimationFrame && typeof this.frame === "number") this.window.cancelAnimationFrame(this.frame);
      else clearTimeout(this.frame);
      this.frame = null;
    }
    this.lastContext = null;
  }

  status() {
    return {
      observerActive: Boolean(this.observer),
      reconciliationActive: false,
      eventDriven: true,
      bound: Boolean(this.lastContext)
    };
  }
}