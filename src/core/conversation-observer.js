import { SELECTORS } from "./constants.js";
import { asElement, containsAny, closestAny, isElement, toNodeArray } from "./dom-utils.js";

export class ConversationObserver {
  constructor({ root = null, tracker, document: documentRef = globalThis.document, window: windowRef = globalThis.window } = {}) {
    this.root = null;
    this.tracker = tracker;
    this.document = documentRef;
    this.window = windowRef;
    this.observer = null;
    this.frame = null;
    this.mutationCount = 0;
    if (root) {
      this.bind(root);
    }
  }

  bind(root) {
    this.disposeObserver();
    this.root = root;
    const MutationObserverCtor = globalThis.MutationObserver ?? this.window?.MutationObserver;
    if (!root || !MutationObserverCtor) {
      return false;
    }

    this.observer = new MutationObserverCtor((mutations) => {
      if (!mutations.some((mutation) => this.isRelevantMutation(mutation))) {
        return;
      }
      this.mutationCount += mutations.length;
      this.scheduleRefresh();
    });
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true
    });
    return true;
  }

  isRelevantMutation(mutation) {
    if (!mutation) {
      return false;
    }
    const target = asElement(mutation.target);
    if (mutation.type === "characterData") {
      return Boolean(closestAny(target, SELECTORS.userMessages));
    }
    if (mutation.type !== "childList") {
      return false;
    }

    if (closestAny(target, SELECTORS.userMessages)) {
      return true;
    }

    for (const node of [...toNodeArray(mutation.addedNodes), ...toNodeArray(mutation.removedNodes)]) {
      if (containsAny(node, SELECTORS.userMessages)) {
        return true;
      }
      if (isElement(node) && closestAny(node, SELECTORS.userMessages)) {
        return true;
      }
    }
    return false;
  }

  scheduleRefresh() {
    if (this.frame !== null || !this.tracker) {
      return;
    }
    const requestFrame = this.window?.requestAnimationFrame;
    if (typeof requestFrame === "function") {
      this.frame = requestFrame(() => {
        this.frame = null;
        this.tracker.refresh("user-turn-mutation");
      });
      return;
    }
    this.frame = setTimeout(() => {
      this.frame = null;
      this.tracker.refresh("user-turn-mutation");
    }, 0);
  }

  disposeObserver() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.frame !== null) {
      if (this.window?.cancelAnimationFrame && typeof this.frame === "number") {
        this.window.cancelAnimationFrame(this.frame);
      } else {
        clearTimeout(this.frame);
      }
      this.frame = null;
    }
  }

  dispose() {
    this.disposeObserver();
    this.root = null;
  }

  status() {
    return {
      bound: Boolean(this.root),
      observerActive: Boolean(this.observer),
      mutationCount: this.mutationCount
    };
  }
}
