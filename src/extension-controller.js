import { TalkEnhancerApp, cleanupOwnedUi } from "./app.js";
import { ChatGPTExtensionAdapter } from "./core/chatgpt-extension-adapter.js";

const MEDIA_OVERLAY_SELECTORS = [
  '[role="dialog"] img',
  '[role="dialog"] video',
  '[data-testid*="image-viewer"]',
  '[data-testid*="lightbox"]',
  '[data-testid*="media-viewer"]'
];

export class ExtensionController {
  constructor({ document: documentRef = globalThis.document, window: windowRef = globalThis.window } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.adapter = new ChatGPTExtensionAdapter({ document: documentRef, window: windowRef });
    this.app = null;
    this.observer = null;
    this.frame = null;
    this.destroyed = false;
    this.unsubscribeCaptured = null;
    this.boundSchedule = () => this.scheduleEvaluate();
  }

  start() {
    if (this.destroyed) return this;
    this.unsubscribeCaptured = this.adapter.subscribeCapturedChatsDataUpdated?.(() => {
      this.app?.renderedTracker?.refresh?.("captured-text");
      this.app?.updateTimeline?.("captured-text");
    }) ?? null;
    this.evaluate();
    const MutationObserverCtor = this.window?.MutationObserver ?? globalThis.MutationObserver;
    if (MutationObserverCtor && this.document?.body) {
      this.observer = new MutationObserverCtor(this.boundSchedule);
      this.observer.observe(this.document.body, { subtree: true, childList: true, attributes: true });
    }
    this.window?.addEventListener?.("popstate", this.boundSchedule);
    this.window?.addEventListener?.("hashchange", this.boundSchedule);
    this.window?.navigation?.addEventListener?.("navigatesuccess", this.boundSchedule);
    return this;
  }

  scheduleEvaluate() {
    if (this.destroyed || this.frame !== null) return;
    const requestFrame = this.window?.requestAnimationFrame;
    if (typeof requestFrame === "function") {
      this.frame = requestFrame(() => {
        this.frame = null;
        this.evaluate();
      });
      return;
    }
    this.frame = setTimeout(() => {
      this.frame = null;
      this.evaluate();
    }, 0);
  }

  isMediaOverlayOpen() {
    if (this.document?.fullscreenElement) return true;
    for (const selector of MEDIA_OVERLAY_SELECTORS) {
      const element = this.document?.querySelector?.(selector);
      if (!element) continue;
      const dialog = element.closest?.('[role="dialog"]') ?? element;
      const rect = dialog.getBoundingClientRect?.();
      if (!rect) return true;
      const viewportWidth = this.document.documentElement?.clientWidth || this.window?.innerWidth || 1;
      const viewportHeight = this.document.documentElement?.clientHeight || this.window?.innerHeight || 1;
      if (rect.width >= viewportWidth * 0.45 || rect.height >= viewportHeight * 0.45) return true;
    }
    return false;
  }

  ensureApp() {
    if (this.app && !this.app.destroyed) return this.app;
    this.app = new TalkEnhancerApp({
      document: this.document,
      window: this.window,
      adapter: this.adapter
    });
    this.window.__GPTTalkEnhancer = this.app;
    this.app.init();
    return this.app;
  }

  evaluate() {
    if (this.destroyed) return;
    const context = this.adapter.getContext();
    const hasConversation = Boolean(context.root && context.scrollContainer);
    const hasComposer = Boolean(context.composerRoot && context.editor);
    const shouldRun = hasConversation || hasComposer;

    if (!shouldRun) {
      if (this.app) {
        this.app.destroy();
        this.app = null;
      } else {
        cleanupOwnedUi(this.document);
      }
      return;
    }

    const app = this.ensureApp();
    app.refresh();
    const blocked = this.isMediaOverlayOpen();
    const timelineRoot = app.timeline?.root;
    if (timelineRoot) timelineRoot.style.display = hasConversation && !blocked ? "" : "none";
    const promptButton = app.promptPicker?.button;
    if (promptButton) promptButton.style.display = hasComposer && !blocked ? "flex" : "none";
    if (blocked) app.promptPicker?.close?.();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeCaptured?.();
    this.unsubscribeCaptured = null;
    this.observer?.disconnect?.();
    this.observer = null;
    this.window?.removeEventListener?.("popstate", this.boundSchedule);
    this.window?.removeEventListener?.("hashchange", this.boundSchedule);
    this.window?.navigation?.removeEventListener?.("navigatesuccess", this.boundSchedule);
    if (this.frame !== null) {
      if (typeof this.window?.cancelAnimationFrame === "function") this.window.cancelAnimationFrame(this.frame);
      else clearTimeout(this.frame);
      this.frame = null;
    }
    this.app?.destroy?.();
    this.app = null;
    cleanupOwnedUi(this.document);
    if (this.window?.__GPTTalkEnhancerExtension === this) delete this.window.__GPTTalkEnhancerExtension;
  }
}
