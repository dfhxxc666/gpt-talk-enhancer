import { EventBus } from "./core/event-bus.js";
import { LocalStorageAdapter } from "./core/storage.js";
import { ConversationStore } from "./core/conversation-store.js";
import { TurnIndex } from "./core/turn-index.js";
import { TimelineState } from "./core/timeline-state.js";
import { PromptStore } from "./core/prompt-store.js";
import { SettingsStore } from "./core/settings-store.js";
import { TimelineCache } from "./core/timeline-cache.js";
import { SURFACE } from "./host/host-interface.js";
import { CodexDesktopHost } from "./host/codex-desktop/codex-host.js";
import { AppShell } from "./ui/app-shell.js";

export const VERSION = "0.4.5";
const NAVIGATION_PENDING_DELAY_MS = 650;

export class TalkEnhancerV3App {
  constructor({ document, window, host = null, storage = null } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.eventBus = new EventBus();
    this.storage = storage ?? new LocalStorageAdapter(this.window?.localStorage);
    this.conversations = new ConversationStore();
    this.timelineState = new TimelineState();
    this.promptStore = new PromptStore({ storage: this.storage });
    this.settings = new SettingsStore({ storage: this.storage });
    this.timelineCache = new TimelineCache({ storage: this.storage });
    this.cacheHydrationCounts = new Map();
    this.turnIndexes = new Map();
    this.currentConversationId = null;
    this.lastNavigation = { target: null, verified: false, reason: "none" };
    this.navigationRequestId = 0;
    this.navigationUxTimer = null;
    this.navigationUx = { state: "idle", target: null, targetOrder: null, pendingVisible: false };
    this.captureStatus = { status: "unavailable", turnCount: 0, lastError: "" };
    this.destroyed = false;
    this.refreshFrame = null;
    this.observer = null;
    this.scrollContainer = null;
    this.boundScroll = () => this.scheduleRefresh("scroll");
    this.boundRoute = () => this.scheduleRefresh("route");
    this.conversationSelectTimer = null;
    this.boundConversationSelect = (event) => this.handleConversationSelect(event);
    this.host = host ?? new CodexDesktopHost({
      document: this.document,
      window: this.window,
      onCapture: (payload) => this.handleCapture(payload),
      onCaptureStatus: (status) => this.handleCaptureStatus(status)
    });
    this.shell = new AppShell({
      document: this.document,
      window: this.window,
      host: this.host,
      promptStore: this.promptStore,
      onNavigate: (turnId) => this.navigate(turnId),
      initialPanelOpen: this.settings.load().timelinePanelOpen
    });
  }

  start() {
    this.window?.__GPTTalkEnhancerV3?.destroy?.();
    this.shell.mount();
    this.host.start?.();
    this.bindLifecycle();
    this.refresh("start");
    this.window.__GPTTalkEnhancerV3 = this;
    return this;
  }

  bindLifecycle() {
    if (typeof this.window?.MutationObserver === "function" && this.document?.body) {
      this.observer = new this.window.MutationObserver(() => this.scheduleRefresh("mutation"));
      this.observer.observe(this.document.body, { childList: true, subtree: true, attributes: true });
    }
    this.window?.addEventListener?.("popstate", this.boundRoute);
    this.window?.addEventListener?.("hashchange", this.boundRoute);
    this.document?.addEventListener?.("click", this.boundConversationSelect, true);
  }

  handleConversationSelect(event) {
    const row = event?.target?.closest?.(
      "[data-sidebar-chatgpt-conversation-key], [data-app-action-sidebar-thread-id]"
    );
    if (!row) return;
    this.invalidateNavigation("conversation-select");
    this.scheduleRefresh("conversation-select");
    if (this.conversationSelectTimer != null) {
      const clear = this.window?.clearTimeout ?? clearTimeout;
      clear(this.conversationSelectTimer);
    }
    const set = this.window?.setTimeout ?? setTimeout;
    this.conversationSelectTimer = set(() => {
      this.conversationSelectTimer = null;
      this.refresh("conversation-select-settled");
    }, 240);
  }
  scheduleRefresh(reason = "event") {
    if (this.destroyed || this.refreshFrame != null) return;
    const run = () => {
      this.refreshFrame = null;
      this.refresh(reason);
    };
    if (typeof this.window?.requestAnimationFrame === "function") this.refreshFrame = this.window.requestAnimationFrame(run);
    else this.refreshFrame = this.window?.setTimeout?.(run, 0) ?? setTimeout(run, 0);
  }

  refresh(reason = "manual") {
    if (this.destroyed) return this.status();
    const surface = this.host.getSurface();
    const conversationId = this.host.getConversationId();
    const conversationIdentity = this.host.getConversationIdentity?.() ?? null;
    this.shell.setTheme(this.host.getTheme());
    this.shell.setSurface(surface);

    if (surface === SURFACE.CONVERSATION && conversationId) {
      this.activateConversation(conversationId);
      const index = this.getTurnIndex(conversationId);
      const visible = this.host.getVisibleTurns();
      index.setVisible(visible);
      if (conversationIdentity?.source === "sidebar-local" && conversationIdentity?.stable) index.reindexUuidV7?.();
      if (this.navigationUx.state === "pending" && this.navigationUx.target) {
        const pendingRecord = index.get(this.navigationUx.target);
        const pendingOrder = Number.isFinite(pendingRecord?.order) ? Number(pendingRecord.order) : null;
        if (pendingOrder !== this.navigationUx.targetOrder) {
          this.setNavigationUx({ targetOrder: pendingOrder }, "navigation-target-reindexed");
        }
      }
      this.persistTimelineCache(conversationId, index);
      const activeTurnId = index.resolveCanonicalId(this.host.getActiveTurnId());
      this.conversations.update(conversationId, { turnCount: index.size(), activeTurnId, route: this.host.getRoute?.() ?? "" });
      this.shell.updateTimeline(index.getOrdered(), activeTurnId);
      this.bindScrollContainer(this.host.getScrollContainer?.());
    } else {
      if (surface !== SURFACE.MEDIA_VIEWER) this.deactivateConversationView();
      this.bindScrollContainer(null);
    }

    this.shell.refreshComposerAnchor();
    this.updateDebug(reason);
    return this.status();
  }

  activateConversation(conversationId) {
    if (this.currentConversationId === conversationId) return;
    if (this.currentConversationId) {
      this.saveConversationView(this.currentConversationId);
      this.invalidateNavigation("conversation-changed");
    }
    this.currentConversationId = conversationId;
    const conversation = this.conversations.activateConversation(conversationId, this.host.getRoute?.() ?? "");
    if (conversation?.captureStatus?.status === "unavailable" && this.captureStatus?.status !== "unavailable") {
      this.conversations.setCaptureStatus(conversationId, this.captureStatus);
    }
    const state = this.timelineState.get(conversationId);
    queueMicrotask(() => this.shell.questionList?.restoreViewState?.(state));
  }

  deactivateConversationView() {
    if (this.currentConversationId) {
      this.saveConversationView(this.currentConversationId);
      this.invalidateNavigation("conversation-deactivated");
    }
    this.currentConversationId = null;
  }

  saveConversationView(conversationId) {
    if (!conversationId) return;
    const view = this.shell.questionList?.getViewState?.();
    if (view) this.timelineState.update(conversationId, view);
  }

  getTurnIndex(conversationId) {
    if (!this.turnIndexes.has(conversationId)) {
      const index = new TurnIndex();
      const cached = this.timelineCache.load(conversationId);
      if (cached.length) index.mergeMany(cached.map((turn) => ({ ...turn, source: "dom", visible: false })));
      this.cacheHydrationCounts.set(conversationId, cached.length);
      this.turnIndexes.set(conversationId, index);
    }
    return this.turnIndexes.get(conversationId);
  }

  persistTimelineCache(conversationId, index = this.turnIndexes.get(conversationId)) {
    if (!conversationId || !index) return false;
    return this.timelineCache.save(conversationId, index.getOrdered());
  }

  handleCapture({ conversationId, turns } = {}) {
    if (!conversationId) return;
    const index = this.getTurnIndex(conversationId);
    index.replaceCapture(turns ?? []);
    this.persistTimelineCache(conversationId, index);
    this.conversations.setCaptureStatus(conversationId, { status: "active", turnCount: index.size(), lastError: "" });
    if (this.currentConversationId === conversationId) this.scheduleRefresh("capture");
  }

  handleCaptureStatus(status = {}) {
    this.captureStatus = { ...this.captureStatus, ...status };
    if (this.currentConversationId) this.conversations.setCaptureStatus(this.currentConversationId, this.captureStatus);
    this.updateDebug("capture-status");
  }

  bindScrollContainer(container) {
    if (this.scrollContainer === container) return;
    this.scrollContainer?.removeEventListener?.("scroll", this.boundScroll);
    this.scrollContainer = container ?? null;
    this.scrollContainer?.addEventListener?.("scroll", this.boundScroll, { passive: true });
  }

  clearNavigationUxTimer() {
    if (this.navigationUxTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.navigationUxTimer);
    this.navigationUxTimer = null;
  }

  invalidateNavigation(reason = "navigation-invalidated") {
    this.navigationRequestId += 1;
    this.host?.cancelNavigation?.();
    this.clearNavigationUxTimer();
    if (this.navigationUx.state !== "idle" || this.navigationUx.target != null || this.navigationUx.pendingVisible) {
      this.setNavigationUx({ state: "idle", target: null, targetOrder: null, pendingVisible: false }, reason);
    }
  }

  setNavigationUx(next = {}, reason = "navigation-ux") {
    this.navigationUx = { ...this.navigationUx, ...next };
    this.shell?.setNavigationState?.(this.navigationUx);
    this.updateDebug(reason);
  }

  async navigate(turnId) {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    if (!index) return { ok: false, reason: "no-conversation" };
    const record = index.get(turnId);
    const targetOrder = Number.isFinite(record?.order) ? Number(record.order) : null;
    const requestId = ++this.navigationRequestId;
    this.clearNavigationUxTimer();
    this.setNavigationUx({ state: "pending", target: turnId, targetOrder, pendingVisible: false }, "navigate-start");

    const set = this.window?.setTimeout ?? setTimeout;
    this.navigationUxTimer = set(() => {
      this.navigationUxTimer = null;
      if (this.destroyed || requestId !== this.navigationRequestId || this.navigationUx.state !== "pending") return;
      this.setNavigationUx({ pendingVisible: true }, "navigate-pending-visible");
    }, NAVIGATION_PENDING_DELAY_MS);

    const isCurrent = () => !this.destroyed
      && requestId === this.navigationRequestId
      && conversationId === this.currentConversationId
      && conversationId === this.host.getConversationId?.();
    const result = await this.host.navigateToTurn(turnId, { turns: index.getOrdered(), getTurns: () => index.getOrdered(), isCurrent });
    if (requestId !== this.navigationRequestId) return result;
    this.clearNavigationUxTimer();
    const latestRecord = index.get(turnId);
    const latestTargetOrder = Number.isFinite(latestRecord?.order) ? Number(latestRecord.order) : targetOrder;
    this.lastNavigation = {
      target: turnId,
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      reason: result?.reason ?? (result?.ok ? "ok" : "unknown"),
      probes: Number.isFinite(result?.probes) ? result.probes : 0,
      stalls: Number.isFinite(result?.stalls) ? result.stalls : 0,
      elapsedMs: Number.isFinite(result?.elapsedMs) ? result.elapsedMs : null,
      inactiveMs: Number.isFinite(result?.inactiveMs) ? result.inactiveMs : null,
      budgetLimit: result?.budgetLimit ?? null,
      visibleRange: result?.visibleRange ?? null,
      scrollHeight: Number.isFinite(result?.scrollHeight) ? result.scrollHeight : null,
      maxLogicalPosition: Number.isFinite(result?.maxLogicalPosition) ? result.maxLogicalPosition : null,
      logicalPosition: Number.isFinite(result?.logicalPosition) ? result.logicalPosition : null,
      domId: result?.domId ?? null,
      settleChecks: Number.isFinite(result?.settleChecks) ? result.settleChecks : null,
      targetOrder: latestTargetOrder
    };
    if (result?.reason === "superseded") {
      this.setNavigationUx({ state: "idle", target: null, targetOrder: null, pendingVisible: false }, "navigate-superseded");
    } else if (result?.ok) {
      this.setNavigationUx({ state: "success", targetOrder: latestTargetOrder, pendingVisible: false }, "navigate-success");
    } else {
      this.setNavigationUx({ state: "failed", targetOrder: latestTargetOrder, pendingVisible: false }, "navigate-failed");
      const label = Number.isFinite(latestTargetOrder) ? `Q${latestTargetOrder + 1}` : String(turnId ?? "该消息");
      this.shell.showToast(`未能定位 ${label}，请再试一次`);
    }
    this.refresh("navigate-result");
    return result;
  }

  status() {
    const conversation = this.currentConversationId ? this.conversations.snapshot(this.currentConversationId) : null;
    const index = this.currentConversationId ? this.getTurnIndex(this.currentConversationId) : null;
    const shell = this.shell?.getStatus?.() ?? {};
    const surface = this.host?.getSurface?.() ?? SURFACE.OTHER;
    const capture = conversation?.captureStatus ?? this.captureStatus;
    const hostContract = this.host?.getCompatibilityReport?.() ?? null;
    const conversationIdentity = this.host?.getConversationIdentity?.()
      ?? (this.currentConversationId ? { id: this.currentConversationId, source: "unknown", host: null, kind: null, stable: false } : null);
    const captureHasData = Number(capture?.turnCount ?? 0) > 0;
    const fallbackDegraded = capture?.status === "degraded"
      || capture?.status === "unavailable"
      || (surface === SURFACE.CONVERSATION && (index?.size?.() ?? 0) > 0 && !captureHasData);
    const degraded = hostContract
      ? hostContract.status === "degraded" || hostContract.status === "unavailable"
      : fallbackDegraded;
    return {
      version: VERSION,
      host: "codex-desktop",
      surface,
      conversationId: this.currentConversationId,
      conversationIdentity,
      capture: { active: capture?.status === "active", status: capture?.status ?? "unavailable", turnCount: capture?.turnCount ?? 0, lastError: capture?.lastError ?? "" },
      timeline: {
        knownTurns: index?.size?.() ?? 0,
        visibleTurns: index?.getVisible?.().length ?? 0,
        activeTurnId: conversation?.activeTurnId ?? null,
        mounted: Boolean(shell.timelineMounted),
        questionPanelOpen: Boolean(shell.questionPanelOpen),
        renderCount: shell.questionRenderCount ?? 0,
        cacheRestoredTurns: this.cacheHydrationCounts.get(this.currentConversationId) ?? 0
      },
      prompt: { composerDetected: Boolean(this.host?.getComposer?.()), mounted: Boolean(shell.promptMounted), panelOpen: Boolean(shell.promptPanelOpen) },
      overlayBlocked: surface === SURFACE.MEDIA_VIEWER,
      navigation: { ...this.lastNavigation },
      navigationUx: { ...this.navigationUx },
      navigationCompatibility: this.host?.getNavigationCompatibility?.() ?? null,
      hostContract,
      health: degraded ? "degraded" : "healthy"
    };
  }

  updateDebug(reason = "manual") {
    if (this.window) this.window.__GPTTalkEnhancerDebug = { ...this.status(), lastRefreshReason: reason };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.navigationRequestId += 1;
    this.clearNavigationUxTimer();
    this.shell?.setNavigationState?.({ state: "idle", target: null, targetOrder: null, pendingVisible: false });
    this.saveConversationView(this.currentConversationId);
    this.observer?.disconnect?.();
    this.bindScrollContainer(null);
    this.window?.removeEventListener?.("popstate", this.boundRoute);
    this.window?.removeEventListener?.("hashchange", this.boundRoute);
    this.document?.removeEventListener?.("click", this.boundConversationSelect, true);
    if (this.conversationSelectTimer != null) {
      const clear = this.window?.clearTimeout ?? clearTimeout;
      clear(this.conversationSelectTimer);
      this.conversationSelectTimer = null;
    }
    if (this.refreshFrame != null && typeof this.window?.cancelAnimationFrame === "function") this.window.cancelAnimationFrame(this.refreshFrame);
    this.host?.destroy?.();
    this.shell?.destroy?.();
    if (this.window?.__GPTTalkEnhancerV3 === this) delete this.window.__GPTTalkEnhancerV3;
  }
}

export function registerBundle(windowRef = globalThis.window) {
  if (!windowRef) return null;
  const bundle = {
    version: VERSION,
    mount(options = {}) {
      return new TalkEnhancerV3App({ window: windowRef, document: windowRef.document, ...options }).start();
    }
  };
  windowRef.__GPTTalkEnhancerV3Bundle = bundle;
  return bundle;
}

if (typeof window !== "undefined") registerBundle(window);
