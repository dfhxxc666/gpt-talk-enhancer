import { SURFACE } from "../host/host-interface.js";
import { TimelineRail } from "./timeline/timeline-rail.js";
import { QuestionListPanel } from "./timeline/question-list.js";
import { PromptTrigger } from "./prompt/prompt-trigger.js";
import { PromptPanel } from "./prompt/prompt-panel.js";
import { Toast } from "./toast.js";
import { BUNDLED_STYLE_TEXT } from "./style-bundle.js";

export class AppShell {
  constructor({ document, window, host, promptStore, onNavigate, initialPanelOpen = false } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.host = host;
    this.promptStore = promptStore;
    this.onNavigate = onNavigate ?? (() => {});
    this.initialPanelOpen = initialPanelOpen;
    this.hostElement = null;
    this.root = null;
    this.shell = null;
    this.surface = SURFACE.OTHER;
    this.timelineLayoutTarget = null;
    this.timelineLayoutObserver = null;
    this.boundViewportResize = () => this.refreshTimelineLayout();
    this.navigationToastActive = false;
  }

  mount() {
    this.document?.getElementById?.("gte-root")?.remove?.();
    const hostElement = this.document.createElement("div");
    hostElement.id = "gte-root";
    const root = hostElement.attachShadow?.({ mode: "open" }) ?? hostElement;
    const style = this.document.createElement("style");
    style.textContent = BUNDLED_STYLE_TEXT;
    const shell = this.document.createElement("div");
    shell.className = "gte-shell";
    root.append(style, shell);
    (this.document.body ?? this.document.documentElement).append(hostElement);
    this.hostElement = hostElement;
    this.root = root;
    this.shell = shell;

    this.toast = new Toast({ document: this.document, window: this.window });
    this.rail = new TimelineRail({
      document: this.document,
      onSelect: (turnId) => this.onNavigate(turnId),
      onTogglePanel: () => this.questionList.toggle(),
      maxMarkers: 28
    });
    this.questionList = new QuestionListPanel({
      document: this.document,
      window: this.window,
      onSelect: (turnId) => this.onNavigate(turnId),
      onOpenChange: (open) => { this.panelOpen = open; },
      getAnchorRect: () => this.rail?.getAnchorRect?.() ?? null
    });
    this.promptPanel = new PromptPanel({
      document: this.document,
      window: this.window,
      store: this.promptStore,
      host: this.host,
      onToast: (message) => this.toast.show(message),
      getTriggerRect: () => this.promptTrigger?.element?.getBoundingClientRect?.() ?? null
    });
    this.promptTrigger = new PromptTrigger({
      document: this.document,
      window: this.window,
      host: this.host,
      onClick: () => this.promptPanel.toggle(),
      onPositionChange: () => this.promptPanel?.updatePosition?.()
    });

    this.rail.mount(shell);
    this.questionList.mount(shell);
    this.promptTrigger.mount(shell);
    this.promptPanel.mount(shell);
    this.toast.mount(shell);
    this.questionList.setOpen(this.initialPanelOpen);
    this.setTheme(this.host.getTheme());
    this.window?.addEventListener?.("resize", this.boundViewportResize, { passive: true });
    this.window?.visualViewport?.addEventListener?.("resize", this.boundViewportResize, { passive: true });
    this.refreshTimelineLayout();
    return this;
  }

  setSurface(surface) {
    this.surface = surface;
    const timelineVisible = surface === SURFACE.CONVERSATION;
    const promptBlocked = Boolean(this.host?.isPromptOverlayBlocked?.());
    const promptVisible = (surface === SURFACE.CONVERSATION || surface === SURFACE.NEW_CHAT) && !promptBlocked;
    this.rail?.setVisible(timelineVisible);
    this.questionList?.setVisible(timelineVisible);
    this.promptTrigger?.setVisible(promptVisible);
    if (!promptVisible) this.promptPanel?.setOpen?.(false);
    this.promptPanel?.setVisible(promptVisible);
    if (this.hostElement?.getAttribute?.("data-gte-surface") !== surface) this.hostElement?.setAttribute?.("data-gte-surface", surface);
  }

  updateTimeline(turns, activeTurnId) {
    this.questionList?.setTurns(turns);
    this.questionList?.setActive(activeTurnId);
    this.rail?.setState(turns, activeTurnId);
    this.questionList?.updatePosition?.();
  }

  setNavigationState({ state = "idle", target = null, targetOrder = null, pendingVisible = false } = {}) {
    const pendingTarget = state === "pending" ? target : null;
    this.questionList?.setPending?.(pendingTarget);
    this.rail?.setPending?.(pendingTarget);
    if (state === "pending" && pendingVisible) {
      const label = Number.isFinite(targetOrder) ? `Q${targetOrder + 1}` : String(target ?? "");
      this.toast?.show(`正在定位 ${label}…`, 0);
      this.navigationToastActive = true;
    } else if (this.navigationToastActive) {
      this.toast?.hide?.();
      this.navigationToastActive = false;
    }
  }

  syncTimelineLayoutObserver() {
    const target = this.host?.getConversationViewportElement?.() ?? null;
    if (target === this.timelineLayoutTarget) return;
    this.timelineLayoutObserver?.disconnect?.();
    this.timelineLayoutTarget = target;
    if (!target || typeof this.window?.ResizeObserver !== "function") return;
    if (!this.timelineLayoutObserver) {
      this.timelineLayoutObserver = new this.window.ResizeObserver(() => this.refreshTimelineLayout());
    }
    this.timelineLayoutObserver.observe(target);
  }

  refreshTimelineLayout() {
    this.syncTimelineLayoutObserver();
    const rect = this.host?.getConversationViewportRect?.() ?? null;
    const viewportWidth = Number(this.window?.visualViewport?.width ?? this.window?.innerWidth ?? 0);
    const contentRight = Number(rect?.right);
    const inset = viewportWidth > 0 && Number.isFinite(contentRight)
      ? Math.max(14, viewportWidth - Math.min(viewportWidth, Math.max(0, contentRight)) + 14)
      : 14;
    this.rail?.setRightInset?.(inset);
    this.toast?.setViewportRect?.(rect, viewportWidth);
    this.questionList?.updatePosition?.();
    return Math.round(inset);
  }

  refreshComposerAnchor() {
    this.refreshTimelineLayout();
    this.promptTrigger?.refreshAnchor();
    this.promptPanel?.updatePosition?.();
  }

  setTheme(theme) {
    const value = theme === "light" ? "light" : "dark";
    if (this.hostElement?.getAttribute?.("data-theme") !== value) this.hostElement?.setAttribute?.("data-theme", value);
    if (this.shell?.getAttribute?.("data-theme") !== value) this.shell?.setAttribute?.("data-theme", value);
  }

  showToast(message) {
    this.navigationToastActive = false;
    this.toast?.show(message);
  }

  getStatus() {
    return {
      timelineMounted: Boolean(this.rail?.element),
      questionPanelOpen: Boolean(this.questionList?.opened),
      questionRenderCount: this.questionList?.renderCount ?? 0,
      promptMounted: Boolean(this.promptTrigger?.element),
      promptPanelOpen: Boolean(this.promptPanel?.opened)
    };
  }

  destroy() {
    this.window?.removeEventListener?.("resize", this.boundViewportResize);
    this.window?.visualViewport?.removeEventListener?.("resize", this.boundViewportResize);
    this.timelineLayoutObserver?.disconnect?.();
    this.timelineLayoutObserver = null;
    this.timelineLayoutTarget = null;
    this.navigationToastActive = false;
    this.promptTrigger?.destroy();
    this.promptPanel?.destroy();
    this.questionList?.destroy();
    this.rail?.destroy();
    this.toast?.destroy();
    this.hostElement?.remove?.();
    this.hostElement = null;
    this.root = null;
    this.shell = null;
  }
}
