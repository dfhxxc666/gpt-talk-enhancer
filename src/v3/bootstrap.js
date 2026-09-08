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
import { parseSidebarConversationKey } from "./host/codex-desktop/conversation-adapter.js";
import { AppShell } from "./ui/app-shell.js";

export const VERSION = "0.5.1";
const NAVIGATION_PENDING_DELAY_MS = 650;
const LOCAL_NAVIGATION_SETTLE_MS = 500;
const CHAT_CONVERSATION_SETTLE_DELAYS_MS = [240, 600, 1200];
const NAVIGATION_HISTORY_LIMIT = 5;
const NAVIGATION_STEP_LIMIT = 16;
const SLOW_NAVIGATION_HISTORY_LIMIT = 10;
const SLOW_NAVIGATION_STORAGE_KEY = "gte.v3.navigation-diagnostics";

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
    this.navigationRunSequence = 0;
    this.activeNavigation = null;
    this.navigationHistory = [];
    this.slowNavigationHistory = sanitizeSlowNavigationHistory(
      this.storage?.read?.(SLOW_NAVIGATION_STORAGE_KEY, [])
    );
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
    this.localNavigationSettleUntil = 0;
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
    const localId = row?.getAttribute?.("data-app-action-sidebar-thread-id") ?? null;
    const chatKey = row?.getAttribute?.("data-sidebar-chatgpt-conversation-key") ?? null;
    const expectedChatId = chatKey ? parseSidebarConversationKey(chatKey) : null;
    const localThreadSelected = Boolean(localId);
    this.localNavigationSettleUntil = localThreadSelected ? appNowMs(this.window) + LOCAL_NAVIGATION_SETTLE_MS : 0;
    this.invalidateNavigation("conversation-select");
    this.scheduleRefresh("conversation-select");
    this.clearConversationSelectTimer();
    if (localThreadSelected || !expectedChatId) {
      this.scheduleConversationSelectRetry({ expectedChatId: null, attempt: 0, delays: [240] });
      return;
    }
    this.scheduleConversationSelectRetry({ expectedChatId, attempt: 0, delays: CHAT_CONVERSATION_SETTLE_DELAYS_MS });
  }

  clearConversationSelectTimer() {
    if (this.conversationSelectTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.conversationSelectTimer);
    this.conversationSelectTimer = null;
  }

  scheduleConversationSelectRetry({ expectedChatId = null, attempt = 0, delays = CHAT_CONVERSATION_SETTLE_DELAYS_MS } = {}) {
    if (this.destroyed || attempt >= delays.length) return;
    const set = this.window?.setTimeout ?? setTimeout;
    this.conversationSelectTimer = set(() => {
      this.conversationSelectTimer = null;
      this.refresh("conversation-select-settled");
      if (expectedChatId && this.host.getConversationId?.() !== expectedChatId) {
        this.scheduleConversationSelectRetry({ expectedChatId, attempt: attempt + 1, delays });
      }
    }, delays[attempt]);
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
    } else if (surface === SURFACE.CONVERSATION && this.currentConversationId) {
      if (this.navigationUx.state === "pending") this.invalidateNavigation("conversation-identity-transient");
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

  beginNavigationRun({ targetOrder, identity }) {
    const startedAtMs = Date.now();
    const run = {
      runId: ++this.navigationRunSequence,
      targetOrder,
      targetLabel: Number.isFinite(targetOrder) ? `Q${Number(targetOrder) + 1}` : null,
      host: identity?.host ?? null,
      source: identity?.source ?? null,
      status: "running",
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      currentStep: null,
      steps: []
    };
    this.activeNavigation = run;
    this.publishNavigationDiagnostics();
    return run;
  }

  recordNavigationStep(run, entry, steps = null) {
    if (!run) return;
    run.steps = (Array.isArray(steps) ? steps : [...(run.steps ?? []), entry]).slice(-NAVIGATION_STEP_LIMIT);
    run.currentStep = entry ?? null;
    if (this.activeNavigation?.runId === run.runId) {
      this.activeNavigation = run;
      this.publishNavigationDiagnostics();
    }
  }

  completeNavigationRun(run, result = {}) {
    if (!run) return;
    const finishedAtMs = Date.now();
    const steps = Array.isArray(result?.steps) && result.steps.length ? result.steps.slice(-NAVIGATION_STEP_LIMIT) : (run.steps ?? []).slice(-NAVIGATION_STEP_LIMIT);
    const slowestStep = steps.reduce((best, step) => Number(step?.elapsedMs ?? -1) > Number(best?.elapsedMs ?? -1) ? step : best, null);
    const completed = {
      ...run,
      status: result?.reason === "superseded" ? "superseded" : result?.ok ? "success" : "failed",
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalElapsedMs: Math.max(0, finishedAtMs - Number(run.startedAtMs || finishedAtMs)),
      resultElapsedMs: Number.isFinite(result?.elapsedMs) ? Number(result.elapsedMs) : null,
      reason: result?.reason ?? (result?.ok ? "ok" : "unknown"),
      ok: Boolean(result?.ok),
      verified: Boolean(result?.verified),
      slowestStep,
      currentStep: null,
      steps
    };
    delete completed.startedAtMs;
    this.navigationHistory = [...this.navigationHistory, completed].slice(-NAVIGATION_HISTORY_LIMIT);
    const slowSteps = steps.filter(isSlowNavigationStep);
    if (slowSteps.length > 0) {
      const slowRecord = sanitizeSlowNavigationRecord({
        runId: completed.runId,
        targetOrder: completed.targetOrder,
        targetLabel: completed.targetLabel,
        host: completed.host,
        source: completed.source,
        startedAt: completed.startedAt,
        finishedAt: completed.finishedAt,
        totalElapsedMs: completed.totalElapsedMs,
        resultElapsedMs: completed.resultElapsedMs,
        status: completed.status,
        reason: completed.reason,
        ok: completed.ok,
        verified: completed.verified,
        slowestStep: completed.slowestStep,
        slowSteps,
        steps
      });
      if (slowRecord) {
        this.slowNavigationHistory = [...this.slowNavigationHistory, slowRecord].slice(-SLOW_NAVIGATION_HISTORY_LIMIT);
        this.storage?.write?.(SLOW_NAVIGATION_STORAGE_KEY, this.slowNavigationHistory);
      }
    }
    if (this.activeNavigation?.runId === run.runId) this.activeNavigation = null;
    this.publishNavigationDiagnostics();
  }

  publishNavigationDiagnostics() {
    if (!this.window) return;
    const current = this.window.__GPTTalkEnhancerDebug ?? {};
    this.window.__GPTTalkEnhancerDebug = {
      ...current,
      activeNavigation: this.activeNavigation ? { ...this.activeNavigation, steps: [...(this.activeNavigation.steps ?? [])] } : null,
      navigationHistory: this.navigationHistory.map((item) => ({ ...item, steps: [...(item.steps ?? [])] })),
      slowNavigationHistory: this.slowNavigationHistory.map(cloneSlowNavigationRecord),
      lastSlowNavigation: this.slowNavigationHistory.length ? cloneSlowNavigationRecord(this.slowNavigationHistory.at(-1)) : null
    };
  }

  async navigate(turnId) {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    if (!index) return { ok: false, reason: "no-conversation" };
    const record = index.get(turnId);
    const targetOrder = Number.isFinite(record?.order) ? Number(record.order) : null;
    const requestId = ++this.navigationRequestId;
    const identity = this.host.getConversationIdentity?.() ?? null;
    const navigationRun = this.beginNavigationRun({ targetOrder, identity });
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
    if (identity?.host === "local") {
      const remainingSettleMs = Math.max(0, this.localNavigationSettleUntil - appNowMs(this.window));
      if (remainingSettleMs > 0) {
        await waitMs(this.window, remainingSettleMs);
        if (!isCurrent()) {
          const superseded = { ok: false, target: turnId, verified: false, reason: "superseded" };
          this.completeNavigationRun(navigationRun, superseded);
          return superseded;
        }
      }
    }
    const allowMountedFastSettle = Boolean(identity?.stable && (identity.host === "chatgpt" || identity.host === "local"));
    const result = await this.host.navigateToTurn(turnId, {
      turns: index.getOrdered(),
      getTurns: () => index.getOrdered(),
      isCurrent,
      allowMountedFastSettle,
      onTraceStep: (entry, steps) => this.recordNavigationStep(navigationRun, entry, steps)
    });
    if (requestId !== this.navigationRequestId) {
      const supersededResult = result?.reason === "superseded"
        ? result
        : { ...result, ok: false, verified: false, reason: "superseded" };
      this.completeNavigationRun(navigationRun, supersededResult);
      return result;
    }
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
      settleMode: result?.settleMode ?? null,
      steps: Array.isArray(result?.steps) ? result.steps : [],
      targetOrder: latestTargetOrder
    };
    this.completeNavigationRun(navigationRun, this.lastNavigation);
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
      activeNavigation: this.activeNavigation ? { ...this.activeNavigation, steps: [...(this.activeNavigation.steps ?? [])] } : null,
      navigationHistory: this.navigationHistory.map((item) => ({ ...item, steps: [...(item.steps ?? [])] })),
      slowNavigationHistory: this.slowNavigationHistory.map(cloneSlowNavigationRecord),
      lastSlowNavigation: this.slowNavigationHistory.length ? cloneSlowNavigationRecord(this.slowNavigationHistory.at(-1)) : null,
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
    this.clearConversationSelectTimer();
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

function isSlowNavigationStep(step = {}) {
  const elapsedMs = Number(step?.elapsedMs) || 0;
  const waitMs = Number(step?.waitMs) || 0;
  if (step?.mode === "chat-progressive") return elapsedMs >= 100;
  if (step?.mode === "work-wheel") return elapsedMs >= Math.max(180, waitMs * 1.5);
  return elapsedMs >= Math.max(100, waitMs * 1.5);
}

function sanitizeSlowNavigationHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeSlowNavigationRecord).filter(Boolean).slice(-SLOW_NAVIGATION_HISTORY_LIMIT);
}

function sanitizeSlowNavigationRecord(value = {}) {
  if (!value || typeof value !== "object") return null;
  const cleanStep = (step) => step && typeof step === "object" ? {
    mode: String(step.mode ?? "unknown"),
    direction: Number(step.direction) || 0,
    elapsedMs: Math.round(Number(step.elapsedMs) || 0),
    jumpPx: Math.round(Number(step.jumpPx) || 0),
    waitMs: Math.round(Number(step.waitMs) || 0),
    targetOrder: Number.isFinite(step.targetOrder) ? Number(step.targetOrder) : null,
    progressKind: String(step.progressKind ?? "none"),
    before: sanitizeTraceSnapshot(step.before),
    after: sanitizeTraceSnapshot(step.after)
  } : null;
  return {
    runId: Number(value.runId) || 0,
    targetOrder: Number.isFinite(value.targetOrder) ? Number(value.targetOrder) : null,
    targetLabel: typeof value.targetLabel === "string" ? value.targetLabel : null,
    host: typeof value.host === "string" ? value.host : null,
    source: typeof value.source === "string" ? value.source : null,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    totalElapsedMs: Math.round(Number(value.totalElapsedMs) || 0),
    resultElapsedMs: Number.isFinite(value.resultElapsedMs) ? Math.round(Number(value.resultElapsedMs)) : null,
    status: typeof value.status === "string" ? value.status : null,
    reason: typeof value.reason === "string" ? value.reason : null,
    ok: Boolean(value.ok),
    verified: Boolean(value.verified),
    slowestStep: cleanStep(value.slowestStep),
    slowSteps: (Array.isArray(value.slowSteps) ? value.slowSteps : []).map(cleanStep).filter(Boolean).slice(-NAVIGATION_STEP_LIMIT),
    steps: (Array.isArray(value.steps) ? value.steps : []).map(cleanStep).filter(Boolean).slice(-NAVIGATION_STEP_LIMIT)
  };
}

function sanitizeTraceSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    visibleRange: snapshot.visibleRange && Number.isFinite(snapshot.visibleRange.min) && Number.isFinite(snapshot.visibleRange.max)
      ? { min: Number(snapshot.visibleRange.min), max: Number(snapshot.visibleRange.max) }
      : null,
    scrollHeight: Math.round(Number(snapshot.scrollHeight) || 0),
    logicalPosition: Math.round(Number(snapshot.logicalPosition) || 0)
  };
}

function cloneSlowNavigationRecord(record) {
  return record ? JSON.parse(JSON.stringify(record)) : null;
}

function appNowMs(windowRef = globalThis.window) {
  const value = Number(windowRef?.performance?.now?.());
  return Number.isFinite(value) ? value : Date.now();
}

function waitMs(windowRef, ms) {
  const set = windowRef?.setTimeout ?? setTimeout;
  return new Promise((resolve) => set(resolve, Math.max(0, Number(ms) || 0)));
}
