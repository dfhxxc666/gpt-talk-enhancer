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
import { OfficialNavigationProbe, analyzeOfficialNavigationLearning, analyzeOfficialNavigationMapping, sanitizeOfficialNavigationHistory, sanitizeOfficialNavigationLearningHistory, sanitizeOfficialNavigationRecord, selectTrustedOfficialBridgePair } from "./diagnostics/official-navigation-probe.js";
import { analyzeOfficialNavigationAutoMap, officialAutoMapSignature, sanitizeOfficialNavigationAutoSummary } from "./diagnostics/official-navigation-auto-map.js";
import { collectHostInternalDepthProbe, collectL3ExactKeyJoinDryRunMap } from "./diagnostics/host-internal-depth-probe.js";

export const VERSION = "0.5.2";
const OFFICIAL_NAVIGATION_RUNTIME_ENABLED = false;
const L3_RUNTIME_ENABLED = false;
const NAVIGATION_PENDING_DELAY_MS = 650;
const LOCAL_NAVIGATION_SETTLE_MS = 500;
const CHAT_CONVERSATION_SETTLE_DELAYS_MS = [240, 600, 1200];
const NAVIGATION_HISTORY_LIMIT = 5;
const NAVIGATION_STEP_LIMIT = 16;
const SLOW_NAVIGATION_HISTORY_LIMIT = 10;
const SLOW_NAVIGATION_STORAGE_KEY = "gte.v3.navigation-diagnostics";
const OFFICIAL_NAVIGATION_HISTORY_LIMIT = 10;
const OFFICIAL_NAVIGATION_STORAGE_KEY = "gte.v3.official-navigation-diagnostics";
const OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT = 32;
const OFFICIAL_NAVIGATION_LEARNING_STORAGE_KEY = "gte.v3.official-navigation-learning";
const OFFICIAL_BRIDGE_AUTO_RETRY_DELAYS_MS = [120, 400];
const L3_ADAPTIVE_RESCAN_DELAYS_MS = [50, 120, 250];
const L3_POST_NAVIGATION_SCAN_DELAY_MS = 180;
const L3_EVENT_RECOVERY_DEBOUNCE_MS = 140;

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
    this.lastNavigation = { target: null, verified: false, reason: "none", fastAttempted: false, fastSucceeded: false, fallbackReason: null, officialBridgeAttempted: false, officialBridgeSucceeded: false, officialBridgeFallbackReason: null };
    this.navigationRequestId = 0;
    this.navigationRunSequence = 0;
    this.activeNavigation = null;
    this.navigationHistory = [];
    this.slowNavigationHistory = sanitizeSlowNavigationHistory(
      this.storage?.read?.(SLOW_NAVIGATION_STORAGE_KEY, [])
    );
    this.officialNavigationHistory = sanitizeOfficialNavigationHistory(
      this.storage?.read?.(OFFICIAL_NAVIGATION_STORAGE_KEY, []),
      OFFICIAL_NAVIGATION_HISTORY_LIMIT
    );
    this.officialNavigationMapping = this.officialNavigationHistory.at(-1)?.mapping ?? null;
    this.officialNavigationLearningHistory = sanitizeOfficialNavigationLearningHistory(
      this.storage?.read?.(OFFICIAL_NAVIGATION_LEARNING_STORAGE_KEY, []),
      OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT
    );
    this.officialNavigationLearning = analyzeOfficialNavigationLearning(this.officialNavigationLearningHistory);
    this.officialBridgeAutoSessions = new Map();
    this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "idle" });
    this.officialBridgeAutoTimer = null;
    this.officialNavigationSessionLearningHistory = [];
    this.officialNavigationSessionLearning = analyzeOfficialNavigationLearning([]);
    this.officialBridgeInFlight = false;
    this.hostInternalDepthProbe = null;
    this.hostInternalDepthProbeByConversation = new Map();
    this.hostInternalDepthProbeAttempts = new Map();
    this.hostInternalDepthProbeTimer = null;
    this.l3KeyJoinDryRunSessions = new Map();
    this.l3KeyJoinDryRun = createL3KeyJoinDryRunSummary();
    this.l3AdaptiveRescanTimer = null;
    this.l3AdaptiveRescanGeneration = 0;
    this.l3PostNavigationScanTimer = null;
    this.l3EventRecoveryTimer = null;
    this.l3EventRecoveryWatch = null;
    this.officialNavigationPrivateMarkers = new Map();
    this.officialNavigationPrivateSessions = new Map();
    this.officialNavigationSessionPrivatePairsByTarget = new Map();
    this.officialNavigationSessionPrivateTargetsByKey = new Map();
    this.officialNavigationSessionPrivateConflictedTargets = new Set();
    this.officialNavigationSessionPrivateConflictedKeys = new Set();
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
    this.officialNavigationProbe = new OfficialNavigationProbe({
      document: this.document,
      window: this.window,
      getContext: () => {
        const identity = this.host.getConversationIdentity?.() ?? null;
        return {
          enabled: !this.destroyed && this.host.getSurface?.() === SURFACE.CONVERSATION && Boolean(this.currentConversationId),
          sessionKey: this.currentConversationId,
          host: identity?.host ?? null,
          source: identity?.source ?? null,
          stable: Boolean(identity?.stable)
        };
      },
      getScrollContainer: () => this.host.getScrollContainer?.(),
      getVisibleRange: () => this.getOfficialProbeVisibleRange(),
      isOwnedEvent: (event) => this.officialBridgeInFlight || ((event?.composedPath?.() ?? []).some((node) => node?.id === "gte-root")),
      onRecord: (record) => this.handleOfficialNavigationRecord(record)
    });
  }

  start() {
    this.window?.__GPTTalkEnhancerV3?.destroy?.();
    this.shell.mount();
    this.host.start?.();
    this.bindLifecycle();
    if (OFFICIAL_NAVIGATION_RUNTIME_ENABLED) this.officialNavigationProbe.start();
    this.refresh("start");
    this.window.__GPTTalkEnhancerV3 = this;
    return this;
  }

  bindLifecycle() {
    if (typeof this.window?.MutationObserver === "function" && this.document?.body) {
      this.observer = new this.window.MutationObserver((records) => {
        this.scheduleRefresh("mutation");
        if (L3_RUNTIME_ENABLED) this.handleL3EventRecoveryMutation(records);
      });
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
    const currentIdentity = this.host.getConversationIdentity?.() ?? null;
    const currentLocalId = currentIdentity?.stable
      && currentIdentity?.host === "local"
      && currentIdentity?.source === "sidebar-local"
      ? String(currentIdentity.id ?? "")
      : "";
    const leavingCurrentLocal = Boolean(currentLocalId && (!localId || String(localId) !== currentLocalId));
    if (leavingCurrentLocal) this.host.persistLocalScrollPosition?.();
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
      if (OFFICIAL_NAVIGATION_RUNTIME_ENABLED) {
        this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "fallback-self", recommendedMode: "fallback-self" });
      } else {
        this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "fallback-self", recommendedMode: "fallback-self" });
      }
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
      if (L3_RUNTIME_ENABLED) this.scheduleHostInternalDepthProbe(conversationId, index, conversationIdentity);
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
    this.clearOfficialBridgeAutoTimer();
    this.clearHostInternalDepthProbeTimer();
    this.clearL3AdaptiveRescanTimer();
    this.clearL3PostNavigationScanTimer();
    this.clearL3EventRecoveryWatch();
    this.hostInternalDepthProbe = this.hostInternalDepthProbeByConversation.get(conversationId) ?? null;
    const existingAutoSession = this.officialBridgeAutoSessions.get(conversationId);
    if (existingAutoSession) existingAutoSession.retryAttempt = 0;
    this.officialNavigationSessionLearningHistory = [];
    this.officialNavigationSessionLearning = analyzeOfficialNavigationLearning([]);
    const conversation = this.conversations.activateConversation(conversationId, this.host.getRoute?.() ?? "");
    if (conversation?.captureStatus?.status === "unavailable" && this.captureStatus?.status !== "unavailable") {
      this.conversations.setCaptureStatus(conversationId, this.captureStatus);
    }
    const state = this.timelineState.get(conversationId);
    queueMicrotask(() => this.shell.questionList?.restoreViewState?.(state));
  }

  deactivateConversationView() {
    this.clearL3EventRecoveryWatch();
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
      fastAttempted: Boolean(result?.fastAttempted),
      fastSucceeded: Boolean(result?.fastSucceeded),
      fallbackReason: result?.fallbackReason ?? null,
      officialBridgeAttempted: Boolean(result?.officialBridgeAttempted),
      officialBridgeSucceeded: Boolean(result?.officialBridgeSucceeded),
      officialBridgeFallbackReason: result?.officialBridgeFallbackReason ?? null,
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
        fastAttempted: completed.fastAttempted,
        fastSucceeded: completed.fastSucceeded,
        fallbackReason: completed.fallbackReason,
        officialBridgeAttempted: completed.officialBridgeAttempted,
        officialBridgeSucceeded: completed.officialBridgeSucceeded,
        officialBridgeFallbackReason: completed.officialBridgeFallbackReason,
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

  getOfficialProbeVisibleRange() {
    const index = this.currentConversationId ? this.getTurnIndex(this.currentConversationId) : null;
    const orders = [];
    for (const turn of this.host.getVisibleTurns?.() ?? []) {
      const record = turn?.id && index ? index.get(turn.id) : null;
      const order = Number.isFinite(record?.order) ? Number(record.order) : (!index && Number.isFinite(turn?.order) ? Number(turn.order) : null);
      if (Number.isFinite(order)) orders.push(order);
    }
    const unique = [...new Set(orders)].sort((a, b) => a - b);
    if (!unique.length) return null;
    return { min: unique[0], max: unique.at(-1), count: unique.length };
  }

  resetOfficialNavigationPrivateSession() {
    this.officialNavigationPrivateMarkers?.clear?.();
    this.officialNavigationSessionPrivatePairsByTarget = new Map();
    this.officialNavigationSessionPrivateTargetsByKey = new Map();
    this.officialNavigationSessionPrivateConflictedTargets = new Set();
    this.officialNavigationSessionPrivateConflictedKeys = new Set();
  }

  activateOfficialNavigationPrivateSession(conversationId) {
    this.officialNavigationPrivateMarkers?.clear?.();
    if (!conversationId) {
      this.resetOfficialNavigationPrivateSession();
      return;
    }
    let session = this.officialNavigationPrivateSessions.get(conversationId);
    if (!session) {
      session = {
        pairsByTarget: new Map(),
        targetsByKey: new Map(),
        conflictedTargets: new Set(),
        conflictedKeys: new Set()
      };
      this.officialNavigationPrivateSessions.set(conversationId, session);
    }
    this.officialNavigationSessionPrivatePairsByTarget = session.pairsByTarget;
    this.officialNavigationSessionPrivateTargetsByKey = session.targetsByKey;
    this.officialNavigationSessionPrivateConflictedTargets = session.conflictedTargets;
    this.officialNavigationSessionPrivateConflictedKeys = session.conflictedKeys;
  }

  handleOfficialPrivateMarker(marker) {
    const probeId = Number(marker?.probeId);
    const sessionKey = typeof marker?.sessionKey === "string" ? marker.sessionKey : null;
    const markerKey = typeof marker?.markerKey === "string" ? marker.markerKey.trim() : "";
    if (!Number.isInteger(probeId) || probeId <= 0 || !sessionKey || sessionKey !== this.currentConversationId || !markerKey) return;
    this.officialNavigationPrivateMarkers.set(probeId, { sessionKey, markerKey });
    while (this.officialNavigationPrivateMarkers.size > 32) this.officialNavigationPrivateMarkers.delete(this.officialNavigationPrivateMarkers.keys().next().value);
  }

  recordOfficialPrivateMarkerLearning({ probeId, targetOrder, knownTurnCount }) {
    const privateMarker = this.officialNavigationPrivateMarkers.get(Number(probeId));
    this.officialNavigationPrivateMarkers.delete(Number(probeId));
    if (!privateMarker || privateMarker.sessionKey !== this.currentConversationId || !Number.isInteger(targetOrder) || targetOrder < 0) return;
    const markerKey = privateMarker.markerKey;
    if (!markerKey || this.officialNavigationSessionPrivateConflictedKeys.has(markerKey) || this.officialNavigationSessionPrivateConflictedTargets.has(targetOrder)) return;
    const existingTarget = this.officialNavigationSessionPrivateTargetsByKey.get(markerKey);
    const existingPair = this.officialNavigationSessionPrivatePairsByTarget.get(targetOrder);
    if ((Number.isInteger(existingTarget) && existingTarget !== targetOrder) || (existingPair?.markerKey && existingPair.markerKey !== markerKey)) {
      this.officialNavigationSessionPrivateConflictedKeys.add(markerKey);
      this.officialNavigationSessionPrivateConflictedTargets.add(targetOrder);
      if (Number.isInteger(existingTarget)) this.officialNavigationSessionPrivateConflictedTargets.add(existingTarget);
      if (existingPair?.markerKey) this.officialNavigationSessionPrivateConflictedKeys.add(existingPair.markerKey);
      this.officialNavigationSessionPrivateTargetsByKey.delete(markerKey);
      this.officialNavigationSessionPrivatePairsByTarget.delete(targetOrder);
      return;
    }
    const hits = existingPair?.markerKey === markerKey ? Number(existingPair.hits || 0) + 1 : 1;
    this.officialNavigationSessionPrivateTargetsByKey.set(markerKey, targetOrder);
    this.officialNavigationSessionPrivatePairsByTarget.set(targetOrder, { markerKey, hits, knownTurnCount: Number(knownTurnCount) || 0 });
  }

  getTrustedOfficialPrivatePair({ targetOrder, index }) {
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index || this.officialNavigationSessionPrivateConflictedTargets.has(targetOrder)) return null;
    const pair = this.officialNavigationSessionPrivatePairsByTarget.get(targetOrder);
    if (!pair?.markerKey || Number(pair.hits) < 2 || this.officialNavigationSessionPrivateConflictedKeys.has(pair.markerKey)) return null;
    if (Number(pair.knownTurnCount) !== Number(index.size?.() ?? 0)) return null;
    const buttons = Array.from(this.document?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
    const matches = buttons.filter((button) => String(button?.getAttribute?.('data-thread-user-message-navigation-item-id') ?? '').trim() === pair.markerKey);
    if (matches.length !== 1) return null;
    return { marker: matches[0], targetOrder, hits: Number(pair.hits) };
  }

  handleOfficialNavigationRecord(record) {
    const index = this.currentConversationId ? this.getTurnIndex(this.currentConversationId) : null;
    const mapping = analyzeOfficialNavigationMapping({ document: this.document, turns: index?.getOrdered?.() ?? [] });
    const activeTurnId = index?.resolveCanonicalId?.(this.host.getActiveTurnId?.());
    const activeRecord = activeTurnId ? index?.get?.(activeTurnId) : null;
    const marker = record?.marker ?? null;
    const learningSample = marker && Number.isFinite(activeRecord?.order) ? {
      markerIndex: marker.markerIndex,
      markerCount: marker.markerCount,
      targetOrder: Number(activeRecord.order),
      knownTurnCount: index?.size?.() ?? null,
      host: record?.host ?? null,
      classification: record?.classification ?? null,
      observedAt: new Date().toISOString()
    } : null;
    const clean = sanitizeOfficialNavigationRecord({ ...record, mapping, learningSample });
    if (!clean) return;
    this.officialNavigationMapping = clean.mapping ?? null;
    if (clean.learningSample) {
      this.officialNavigationLearningHistory = [...this.officialNavigationLearningHistory, clean.learningSample].slice(-OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT);
      this.officialNavigationLearning = analyzeOfficialNavigationLearning(this.officialNavigationLearningHistory);
      this.storage?.write?.(OFFICIAL_NAVIGATION_LEARNING_STORAGE_KEY, this.officialNavigationLearningHistory);
      this.officialNavigationSessionLearningHistory = [...this.officialNavigationSessionLearningHistory, clean.learningSample].slice(-OFFICIAL_NAVIGATION_LEARNING_HISTORY_LIMIT);
      this.officialNavigationSessionLearning = analyzeOfficialNavigationLearning(this.officialNavigationSessionLearningHistory);
    }
    this.officialNavigationHistory = [...this.officialNavigationHistory, clean].slice(-OFFICIAL_NAVIGATION_HISTORY_LIMIT);
    this.storage?.write?.(OFFICIAL_NAVIGATION_STORAGE_KEY, this.officialNavigationHistory);
    this.publishOfficialNavigationDiagnostics();
  }

  publishOfficialNavigationDiagnostics() {
    if (!this.window) return;
    const current = this.window.__GPTTalkEnhancerDebug ?? {};
    this.window.__GPTTalkEnhancerDebug = {
      ...current,
      officialNavigationHistory: this.officialNavigationHistory.map((item) => JSON.parse(JSON.stringify(item))),
      lastOfficialNavigation: this.officialNavigationHistory.length ? JSON.parse(JSON.stringify(this.officialNavigationHistory.at(-1))) : null,
      officialNavigationMapping: this.officialNavigationMapping ? JSON.parse(JSON.stringify(this.officialNavigationMapping)) : null,
      officialNavigationLearning: JSON.parse(JSON.stringify(this.officialNavigationLearning)),
      officialNavigationSessionLearning: JSON.parse(JSON.stringify(this.officialNavigationSessionLearning)),
      officialBridgeAuto: JSON.parse(JSON.stringify(this.officialBridgeAuto)),
      officialBridgeSessionTrustedTargets: this.getOfficialBridgeSessionTrustedTargets(),
      hostInternalDepthProbe: this.hostInternalDepthProbe ? JSON.parse(JSON.stringify(this.hostInternalDepthProbe)) : null,
      l3RuntimeEnabled: L3_RUNTIME_ENABLED,
      l3KeyJoinDryRun: createL3KeyJoinDryRunSummary(this.l3KeyJoinDryRun),
      officialNavigationLearningHistory: this.officialNavigationLearningHistory.map((item) => ({ ...item }))
    };
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

  getOfficialBridgeAutoSession(conversationId) {
    if (!conversationId) return null;
    let session = this.officialBridgeAutoSessions.get(conversationId);
    if (!session) {
      session = {
        conversationId,
        status: "auto-scanning",
        stableScans: 0,
        lastSignature: null,
        pairsByTarget: new Map(),
        knownTurnCount: 0,
        retryAttempt: 0,
        summary: sanitizeOfficialNavigationAutoSummary({ status: "auto-scanning" })
      };
      this.officialBridgeAutoSessions.set(conversationId, session);
    }
    return session;
  }

  clearHostInternalDepthProbeTimer() {
    if (this.hostInternalDepthProbeTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.hostInternalDepthProbeTimer);
    this.hostInternalDepthProbeTimer = null;
  }

  getL3KeyJoinDryRunSession(conversationId) {
    if (!conversationId) return null;
    let session = this.l3KeyJoinDryRunSessions.get(conversationId);
    if (!session) {
      session = {
        status: "idle",
        stableScans: 0,
        patternKey: null,
        identityByTarget: new Map(),
        knownTurnCount: 0,
        pairsByTarget: new Map(),
        adaptiveRescanState: "idle",
        adaptiveRescanAttempt: 0,
        summary: createL3KeyJoinDryRunSummary()
      };
      this.l3KeyJoinDryRunSessions.set(conversationId, session);
    }
    return session;
  }

  runL3ResearchScan({ targetOrder = null } = {}) {
    if (this.isLocalWorkNavigationActive()) {
      return createL3KeyJoinDryRunSummary({ status: "research-blocked-navigation" });
    }
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    const identity = this.host.getConversationIdentity?.() ?? null;
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
      const unavailable = createL3KeyJoinDryRunSummary({ status: "research-unavailable" });
      this.l3KeyJoinDryRun = unavailable;
      this.updateDebug("l3-research-unavailable");
      return unavailable;
    }
    const session = this.getL3KeyJoinDryRunSession(conversationId);
    const scan = collectL3ExactKeyJoinDryRunMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      preferredPattern: session?.patternKey ?? null
    });
    const source = scan?.summary ?? {};
    const target = Number.isInteger(targetOrder) && targetOrder >= 0 ? targetOrder : -1;
    const result = createL3KeyJoinDryRunSummary({
      status: "research-one-shot",
      stableScans: session?.stableScans ?? 0,
      mappedTurnCount: Number(source.mappedTurnCount) || 0,
      coverage: Number(source.coverage) || 0,
      conflicts: Number(source.conflicts) || 0,
      exactPatternCount: Number(source.exactPatternCount) || 0,
      mappingAgreement: Boolean(source.mappingAgreement),
      ...createL3FreshDiagnostics(scan, target),
      mappingStable: null,
      adaptiveRescanState: "research-frozen",
      adaptiveRescanAttempt: 0,
      freshMapAccepted: false
    });
    this.l3KeyJoinDryRun = result;
    this.updateDebug("l3-research-one-shot");
    return result;
  }
  refreshL3KeyJoinDryRun({ conversationId, index, identity, finalAttempt = false } = {}) {
    if (this.isLocalWorkNavigationActive()) return null;
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
      this.l3KeyJoinDryRun = createL3KeyJoinDryRunSummary({ status: "unavailable" });
      return null;
    }
    const session = this.getL3KeyJoinDryRunSession(conversationId);
    const scan = collectL3ExactKeyJoinDryRunMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      preferredPattern: session.patternKey
    });
    const summary = scan?.summary ?? {};
    const exact = Boolean(
      summary.oneToOne
      && summary.coverage === 1
      && Number(summary.conflicts) === 0
      && scan?.patternKey
      && scan?.identityByTarget instanceof Map
      && scan.identityByTarget.size === Number(summary.knownTurnCount ?? 0)
    );
    if (exact) {
      const sameIdentity = Boolean(
        session.patternKey
        && session.patternKey === scan.patternKey
        && sameL3KeyJoinIdentityMap(session.identityByTarget, scan.identityByTarget)
      );
      session.stableScans = sameIdentity ? session.stableScans + 1 : 1;
      session.patternKey = scan.patternKey;
      session.identityByTarget = new Map(scan.identityByTarget);
      session.knownTurnCount = Number(summary.knownTurnCount) || 0;
      session.pairsByTarget = scan.pairsByTarget instanceof Map ? scan.pairsByTarget : new Map();
      session.status = session.stableScans >= 2 ? "dry-run-ready" : (finalAttempt ? "dry-run-unstable" : "dry-run-scanning");
    } else {
      session.status = "dry-run-unavailable";
      session.stableScans = 0;
      session.patternKey = null;
      session.identityByTarget = new Map();
      session.knownTurnCount = Number(summary.knownTurnCount) || Number(index.size?.() ?? 0);
      session.pairsByTarget = new Map();
    }
    session.summary = createL3KeyJoinDryRunSummary({
      status: session.status,
      stableScans: session.stableScans,
      mappedTurnCount: Number(summary.mappedTurnCount) || 0,
      coverage: Number(summary.coverage) || 0,
      conflicts: Number(summary.conflicts) || 0,
      exactPatternCount: Number(summary.exactPatternCount) || 0,
      mappingAgreement: Boolean(summary.mappingAgreement)
    });
    this.l3KeyJoinDryRun = session.summary;
    return session;
  }

  recordL3KeyJoinDryRunTarget({ targetOrder, index, identity } = {}) {
    if (this.isLocalWorkNavigationActive()) return this.l3KeyJoinDryRun;
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return this.l3KeyJoinDryRun;
    const conversationId = this.currentConversationId;
    const session = conversationId ? this.l3KeyJoinDryRunSessions.get(conversationId) : null;
    const currentScan = session?.patternKey ? collectL3ExactKeyJoinDryRunMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      preferredPattern: session.patternKey
    }) : null;
    const currentSummary = currentScan?.summary ?? null;
    const mappingStable = Boolean(
      session
      && session.status === "dry-run-ready"
      && Number(session.knownTurnCount) === Number(index.size?.() ?? 0)
      && currentSummary?.oneToOne
      && Number(currentSummary?.conflicts) === 0
      && currentScan?.patternKey === session.patternKey
      && sameL3KeyJoinIdentityMap(session.identityByTarget, currentScan?.identityByTarget)
    );
    const exactCurrent = isL3ExactKeyJoinScan(currentScan, index);
    let adaptiveRescanState = session?.adaptiveRescanState ?? "idle";
    let freshMapAccepted = null;
    if (session && exactCurrent) {
      this.clearL3AdaptiveRescanTimer();
      this.clearL3EventRecoveryWatch();
      if (!mappingStable) {
        adoptL3ExactKeyJoinScan(session, currentScan);
        adaptiveRescanState = "accepted-current";
        freshMapAccepted = true;
      } else {
        adaptiveRescanState = "stable";
        freshMapAccepted = false;
      }
      session.adaptiveRescanState = adaptiveRescanState;
      session.adaptiveRescanAttempt = 0;
    } else if (session && currentScan) {
      this.clearL3AdaptiveRescanTimer();
      this.clearL3EventRecoveryWatch();
      adaptiveRescanState = "pending";
      freshMapAccepted = false;
      session.adaptiveRescanState = adaptiveRescanState;
      session.adaptiveRescanAttempt = 0;
    }
    const summary = createL3KeyJoinDryRunSummary({
      ...(session?.summary ?? this.l3KeyJoinDryRun),
      status: session?.status ?? this.l3KeyJoinDryRun?.status,
      stableScans: session?.stableScans ?? this.l3KeyJoinDryRun?.stableScans,
      ...createL3FreshDiagnostics(currentScan, targetOrder),
      mappingStable,
      adaptiveRescanState,
      adaptiveRescanAttempt: session?.adaptiveRescanAttempt ?? 0,
      freshMapAccepted
    });
    this.l3KeyJoinDryRun = summary;
    if (session) session.summary = summary;
    this.updateDebug("l3-key-join-dry-run-target");
    if (session && currentScan && !exactCurrent && conversationId) {
      this.scheduleL3AdaptiveRescan({ conversationId, targetOrder, attempt: 0 });
    }
    return summary;
  }

  clearL3AdaptiveRescanTimer() {
    this.l3AdaptiveRescanGeneration += 1;
    if (this.l3AdaptiveRescanTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.l3AdaptiveRescanTimer);
    this.l3AdaptiveRescanTimer = null;
  }

  scheduleL3AdaptiveRescan({ conversationId, targetOrder, attempt = 0 } = {}) {
    if (this.isLocalWorkNavigationActive()) return;
    if (!conversationId || !Number.isInteger(targetOrder) || targetOrder < 0 || attempt >= L3_ADAPTIVE_RESCAN_DELAYS_MS.length) return;
    const session = this.l3KeyJoinDryRunSessions.get(conversationId);
    if (!session?.patternKey) return;
    const generation = this.l3AdaptiveRescanGeneration;
    const delayMs = L3_ADAPTIVE_RESCAN_DELAYS_MS[attempt];
    const set = this.window?.setTimeout ?? setTimeout;
    this.l3AdaptiveRescanTimer = set(() => {
      this.l3AdaptiveRescanTimer = null;
      if (this.destroyed || generation !== this.l3AdaptiveRescanGeneration || this.currentConversationId !== conversationId || this.isLocalWorkNavigationActive()) return;
      const index = this.getTurnIndex(conversationId);
      const identity = this.host.getConversationIdentity?.() ?? null;
      if (!index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return;
      const scan = collectL3ExactKeyJoinDryRunMap({
        document: this.document,
        turns: index.getOrdered?.() ?? [],
        preferredPattern: session.patternKey
      });
      session.adaptiveRescanAttempt = attempt + 1;
      const exact = isL3ExactKeyJoinScan(scan, index);
      let state = "pending";
      let freshMapAccepted = false;
      if (exact) {
        adoptL3ExactKeyJoinScan(session, scan);
        this.clearL3EventRecoveryWatch();
        state = "recovered";
        freshMapAccepted = true;
      } else if (attempt + 1 >= L3_ADAPTIVE_RESCAN_DELAYS_MS.length) {
        state = "exhausted-watching";
      }
      session.adaptiveRescanState = state;
      session.summary = createL3KeyJoinDryRunSummary({
        ...(session.summary ?? this.l3KeyJoinDryRun),
        status: session.status,
        stableScans: session.stableScans,
        ...createL3FreshDiagnostics(scan, targetOrder),
        mappingStable: false,
        adaptiveRescanState: state,
        adaptiveRescanAttempt: session.adaptiveRescanAttempt,
        freshMapAccepted
      });
      this.l3KeyJoinDryRun = session.summary;
      this.updateDebug("l3-key-join-adaptive-rescan");
      if (!exact && state === "pending") this.scheduleL3AdaptiveRescan({ conversationId, targetOrder, attempt: attempt + 1 });
      if (!exact && state === "exhausted-watching") this.startL3EventRecoveryWatch({ conversationId, targetOrder });
    }, delayMs);
  }

  clearL3EventRecoveryTimer() {
    if (this.l3EventRecoveryTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.l3EventRecoveryTimer);
    this.l3EventRecoveryTimer = null;
  }

  clearL3EventRecoveryWatch() {
    this.clearL3EventRecoveryTimer();
    this.l3EventRecoveryWatch = null;
  }

  startL3EventRecoveryWatch({ conversationId, targetOrder } = {}) {
    this.clearL3EventRecoveryWatch();
    if (!conversationId || !Number.isInteger(targetOrder) || targetOrder < 0) return;
    const session = this.l3KeyJoinDryRunSessions.get(conversationId);
    if (!session?.patternKey) return;
    this.l3EventRecoveryWatch = { conversationId, targetOrder };
  }

  handleL3EventRecoveryMutation(records = []) {
    const watch = this.l3EventRecoveryWatch;
    if (!watch || this.isLocalWorkNavigationActive() || this.l3EventRecoveryTimer != null) return;
    if (!Array.from(records ?? []).length) return;
    if (this.currentConversationId !== watch.conversationId) {
      this.clearL3EventRecoveryWatch();
      return;
    }
    const set = this.window?.setTimeout ?? setTimeout;
    this.l3EventRecoveryTimer = set(() => {
      this.l3EventRecoveryTimer = null;
      const currentWatch = this.l3EventRecoveryWatch;
      if (this.destroyed || !currentWatch || currentWatch.conversationId !== watch.conversationId || this.currentConversationId !== watch.conversationId || this.isLocalWorkNavigationActive()) return;
      const index = this.getTurnIndex(watch.conversationId);
      const identity = this.host.getConversationIdentity?.() ?? null;
      const session = this.l3KeyJoinDryRunSessions.get(watch.conversationId);
      if (!index || !session?.patternKey || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
        this.clearL3EventRecoveryWatch();
        return;
      }
      const scan = collectL3ExactKeyJoinDryRunMap({
        document: this.document,
        turns: index.getOrdered?.() ?? [],
        preferredPattern: session.patternKey
      });
      const exact = isL3ExactKeyJoinScan(scan, index);
      let state = "exhausted-watching";
      let freshMapAccepted = false;
      if (exact) {
        adoptL3ExactKeyJoinScan(session, scan);
        state = "recovered-event";
        freshMapAccepted = true;
      }
      session.adaptiveRescanState = state;
      session.summary = createL3KeyJoinDryRunSummary({
        ...(session.summary ?? this.l3KeyJoinDryRun),
        status: session.status,
        stableScans: session.stableScans,
        ...createL3FreshDiagnostics(scan, watch.targetOrder),
        mappingStable: false,
        adaptiveRescanState: state,
        adaptiveRescanAttempt: session.adaptiveRescanAttempt,
        freshMapAccepted
      });
      this.l3KeyJoinDryRun = session.summary;
      this.updateDebug("l3-key-join-event-recovery");
      if (exact) this.clearL3EventRecoveryWatch();
    }, L3_EVENT_RECOVERY_DEBOUNCE_MS);
    this.l3EventRecoveryTimer?.unref?.();
  }

  isLocalWorkNavigationActive() {
    return Boolean(this.activeNavigation?.status === "running"
      && this.activeNavigation?.host === "local"
      && this.activeNavigation?.source === "sidebar-local");
  }

  clearL3PostNavigationScanTimer() {
    if (this.l3PostNavigationScanTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.l3PostNavigationScanTimer);
    this.l3PostNavigationScanTimer = null;
  }

  scheduleL3PostNavigationScan({ conversationId, targetOrder, requestId } = {}) {
    this.clearL3PostNavigationScanTimer();
    if (!conversationId || !Number.isInteger(targetOrder) || targetOrder < 0) return;
    const set = this.window?.setTimeout ?? setTimeout;
    this.l3PostNavigationScanTimer = set(() => {
      this.l3PostNavigationScanTimer = null;
      if (this.destroyed || requestId !== this.navigationRequestId || this.currentConversationId !== conversationId || this.isLocalWorkNavigationActive()) return;
      const index = this.getTurnIndex(conversationId);
      const identity = this.host.getConversationIdentity?.() ?? null;
      if (!index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return;
      this.recordL3KeyJoinDryRunTarget({ targetOrder, index, identity });
    }, L3_POST_NAVIGATION_SCAN_DELAY_MS);
    this.l3PostNavigationScanTimer?.unref?.();
  }

  scheduleHostInternalDepthProbe(conversationId, index, identity) {
    if (this.isLocalWorkNavigationActive()) return;
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return;
    const existing = this.hostInternalDepthProbeByConversation.get(conversationId);
    const drySession = this.l3KeyJoinDryRunSessions.get(conversationId) ?? null;
    if (existing) {
      this.hostInternalDepthProbe = existing;
      if (!drySession || drySession.status !== "dry-run-scanning") {
        if (drySession?.summary) this.l3KeyJoinDryRun = drySession.summary;
        return;
      }
    }
    if (this.hostInternalDepthProbeTimer != null) return;
    const attempts = Number(this.hostInternalDepthProbeAttempts.get(conversationId) ?? 0);
    const delays = [180, 420, 900, 1600, 2600];
    const delayMs = delays[Math.min(attempts, delays.length - 1)];
    const set = this.window?.setTimeout ?? setTimeout;
    this.hostInternalDepthProbeTimer = set(() => {
      this.hostInternalDepthProbeTimer = null;
      if (this.destroyed || this.currentConversationId !== conversationId || this.isLocalWorkNavigationActive()) return;
      const currentIdentity = this.host.getConversationIdentity?.() ?? null;
      if (!currentIdentity?.stable || currentIdentity.host !== "local" || currentIdentity.source !== "sidebar-local") return;
      const currentIndex = this.getTurnIndex(conversationId);
      const attempt = attempts + 1;
      this.hostInternalDepthProbeAttempts.set(conversationId, attempt);
      try {
        const result = collectHostInternalDepthProbe({ window: this.window, document: this.document, host: this.host, turns: currentIndex?.getOrdered?.() ?? [] });
        const markerCount = Number(result?.level0?.officialMarkerCount ?? 0);
        const markerComplete = markerCount > 0 || attempt >= delays.length;
        const dryRunSession = markerCount > 0 ? this.refreshL3KeyJoinDryRun({ conversationId, index: currentIndex, identity: currentIdentity, finalAttempt: attempt >= delays.length }) : null;
        const dryRunNeedsRetry = dryRunSession?.status === "dry-run-scanning";
        this.hostInternalDepthProbe = { ...result, markerProbeAttempt: attempt, markerProbeComplete: markerComplete };
        if (markerComplete) this.hostInternalDepthProbeByConversation.set(conversationId, this.hostInternalDepthProbe);
        this.updateDebug("host-internal-depth-probe");
        if (!markerComplete || dryRunNeedsRetry) this.scheduleHostInternalDepthProbe(conversationId, currentIndex, currentIdentity);
      } catch (error) {
        this.hostInternalDepthProbe = { error: String(error?.message ?? error ?? "unknown"), markerProbeAttempt: attempt, markerProbeComplete: true };
        this.hostInternalDepthProbeByConversation.set(conversationId, this.hostInternalDepthProbe);
        this.l3KeyJoinDryRun = createL3KeyJoinDryRunSummary({ status: "error" });
        this.updateDebug("host-internal-depth-probe-error");
      }
    }, delayMs);
    this.hostInternalDepthProbeTimer?.unref?.();
  }

  clearOfficialBridgeAutoTimer() {
    if (this.officialBridgeAutoTimer == null) return;
    const clear = this.window?.clearTimeout ?? clearTimeout;
    clear(this.officialBridgeAutoTimer);
    this.officialBridgeAutoTimer = null;
  }

  scheduleOfficialBridgeAutoRetry(conversationId, session) {
    if (!conversationId || !session || session.status === "auto-official-ready" || this.officialBridgeAutoTimer != null) return;
    const attempt = Number(session.retryAttempt) || 0;
    if (attempt >= OFFICIAL_BRIDGE_AUTO_RETRY_DELAYS_MS.length) return;
    const delayMs = OFFICIAL_BRIDGE_AUTO_RETRY_DELAYS_MS[attempt];
    session.retryAttempt = attempt + 1;
    const set = this.window?.setTimeout ?? setTimeout;
    this.officialBridgeAutoTimer = set(() => {
      this.officialBridgeAutoTimer = null;
      if (this.destroyed || this.currentConversationId !== conversationId) return;
      this.refresh("official-bridge-auto-scan");
    }, delayMs);
  }

  refreshOfficialWorkAutoBridge({ conversationId, index, identity }) {
    if (!conversationId || !index || !identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") {
      if (conversationId === this.currentConversationId) this.officialBridgeAuto = sanitizeOfficialNavigationAutoSummary({ status: "fallback-self", recommendedMode: "fallback-self" });
      return this.officialBridgeAuto;
    }
    const session = this.getOfficialBridgeAutoSession(conversationId);
    const scan = analyzeOfficialNavigationAutoMap({
      document: this.document,
      turns: index.getOrdered?.() ?? [],
      resolveMarkerKey: (markerKey) => this.host.resolveOfficialNavigationMarkerKey?.(markerKey) ?? null,
      minCoverage: 0.8
    });
    const signature = scan.summary.readyCandidate ? officialAutoMapSignature(scan.privatePairs) : "";
    if (scan.summary.readyCandidate && signature) {
      session.stableScans = session.lastSignature === signature ? session.stableScans + 1 : 1;
      session.lastSignature = signature;
      session.knownTurnCount = scan.summary.knownTurnCount;
      if (session.stableScans >= 2) {
        session.status = "auto-official-ready";
        session.pairsByTarget = new Map(scan.privatePairs.map((pair) => [pair.targetOrder, { markerKey: pair.markerKey, strategies: pair.strategies }]));
        this.clearOfficialBridgeAutoTimer();
      } else {
        session.status = "auto-scanning";
      }
    } else {
      session.status = "fallback-self";
      session.stableScans = 0;
      session.lastSignature = null;
      session.pairsByTarget = new Map();
      session.knownTurnCount = scan.summary.knownTurnCount;
    }
    session.summary = sanitizeOfficialNavigationAutoSummary({
      ...scan.summary,
      status: session.status,
      stableScans: session.stableScans,
      recommendedMode: session.status === "auto-official-ready" ? "auto-official-ready" : session.status === "auto-scanning" ? "auto-scanning" : "fallback-self"
    });
    this.officialBridgeAuto = session.summary;
    this.scheduleOfficialBridgeAutoRetry(conversationId, session);
    return session.summary;
  }

  getOfficialAutoBridgePair({ targetOrder, index }) {
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index || !this.currentConversationId) return null;
    const session = this.officialBridgeAutoSessions.get(this.currentConversationId);
    if (!session || session.status !== "auto-official-ready" || Number(session.knownTurnCount) !== Number(index.size?.() ?? 0)) return null;
    const pair = session.pairsByTarget.get(targetOrder);
    if (!pair?.markerKey) return null;
    const buttons = Array.from(this.document?.querySelectorAll?.('[data-thread-user-message-navigation-item-id]') ?? []);
    const matches = buttons.filter((button) => String(button?.getAttribute?.('data-thread-user-message-navigation-item-id') ?? '').trim() === pair.markerKey);
    if (matches.length !== 1) return null;
    return { marker: matches[0], targetOrder, strategies: [...(pair.strategies ?? [])] };
  }

  getOfficialBridgeSessionTrustedTargets() {
    const session = this.currentConversationId ? this.officialBridgeAutoSessions.get(this.currentConversationId) : null;
    if (!session || session.status !== "auto-official-ready") return [];
    return [...session.pairsByTarget.entries()]
      .map(([targetOrder, pair]) => ({ targetOrder: Number(targetOrder), trusted: true, source: "auto", strategies: [...(pair?.strategies ?? [])] }))
      .sort((a, b) => a.targetOrder - b.targetOrder);
  }

  getOfficialBridgeActiveOrder(index) {
    if (!index) return null;
    const activeTurnId = index.resolveCanonicalId?.(this.host.getActiveTurnId?.());
    const activeRecord = activeTurnId ? index.get?.(activeTurnId) : null;
    return Number.isFinite(activeRecord?.order) ? Number(activeRecord.order) : null;
  }

  hasTrustedOfficialWorkBridgeCandidate({ targetOrder, index, identity }) {
    if (!OFFICIAL_NAVIGATION_RUNTIME_ENABLED) return false;
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return false;
    return Boolean(this.getOfficialAutoBridgePair({ targetOrder, index }));
  }

  async tryOfficialWorkBridge({ targetOrder, index, identity, isCurrent }) {
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return { attempted: false, fallbackReason: "not-local-work" };
    if (!Number.isInteger(targetOrder) || targetOrder < 0 || !index) return { attempted: false, fallbackReason: "invalid-target" };
    const pair = this.getOfficialAutoBridgePair({ targetOrder, index });
    if (!pair) return { attempted: false, fallbackReason: "auto-bridge-unavailable" };
    const marker = pair.marker;
    if (!marker || typeof marker.click !== "function") return { attempted: false, fallbackReason: "marker-unavailable" };

    const startedAt = appNowMs(this.window);
    let firstMatchedAt = null;
    try {
      this.officialBridgeInFlight = true;
      marker.click();
    } catch {
      return { attempted: true, succeeded: false, fallbackReason: "marker-click-failed", elapsedMs: Math.round(appNowMs(this.window) - startedAt) };
    } finally {
      this.officialBridgeInFlight = false;
    }

    while (appNowMs(this.window) - startedAt <= 650) {
      if (!isCurrent?.()) return { attempted: true, succeeded: false, fallbackReason: "superseded", elapsedMs: Math.round(appNowMs(this.window) - startedAt) };
      const activeOrder = this.getOfficialBridgeActiveOrder(index);
      const now = appNowMs(this.window);
      if (activeOrder === targetOrder) {
        if (firstMatchedAt == null) firstMatchedAt = now;
        if (now - firstMatchedAt >= 80) {
          this.host.persistLocalScrollPosition?.();
          return {
            attempted: true,
            succeeded: true,
            fallbackReason: null,
            elapsedMs: Math.round(now - startedAt),
            result: {
              ok: true,
              verified: true,
              reason: "official-bridge",
              settleMode: "official-bridge",
              officialBridgeAttempted: true,
              officialBridgeSucceeded: true,
              officialBridgeFallbackReason: null,
              steps: [{ mode: "official-bridge", direction: 0, elapsedMs: Math.round(now - startedAt), jumpPx: 0, waitMs: 0, targetOrder, progressKind: "target", before: null, after: null }]
            }
          };
        }
      } else {
        firstMatchedAt = null;
      }
      await waitMs(this.window, 24);
    }
    return { attempted: true, succeeded: false, fallbackReason: "verify-timeout", elapsedMs: Math.round(appNowMs(this.window) - startedAt) };
  }

  async navigate(turnId) {
    const conversationId = this.currentConversationId;
    const index = conversationId ? this.getTurnIndex(conversationId) : null;
    if (!index) return { ok: false, reason: "no-conversation" };
    const record = index.get(turnId);
    const targetOrder = Number.isFinite(record?.order) ? Number(record.order) : null;
    const requestId = ++this.navigationRequestId;
    const identity = this.host.getConversationIdentity?.() ?? null;
    const localWorkNavigation = Boolean(identity?.stable && identity.host === "local" && identity.source === "sidebar-local");
    if (localWorkNavigation) {
      this.clearL3AdaptiveRescanTimer();
      this.clearL3PostNavigationScanTimer();
      this.clearL3EventRecoveryWatch();
    }
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
    if (localWorkNavigation) this.host.notifyNavigationIntent?.();
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
    const bridge = { attempted: false, succeeded: false, fallbackReason: null, elapsedMs: 0 };
    if (!isCurrent()) {
      const superseded = { ok: false, target: turnId, verified: false, reason: "superseded", officialBridgeAttempted: Boolean(bridge.attempted), officialBridgeSucceeded: false, officialBridgeFallbackReason: bridge.fallbackReason ?? "superseded" };
      this.completeNavigationRun(navigationRun, superseded);
      return superseded;
    }

    const allowMountedFastSettle = Boolean(identity?.stable && (identity.host === "chatgpt" || identity.host === "local"));
    const cacheRestoredTurns = Number(this.cacheHydrationCounts.get(conversationId) ?? 0);
    const knownTurns = Number(index.size?.() ?? 0);
    const allowChatPredictiveFastPath = Boolean(
      identity?.stable
      && identity.host === "chatgpt"
      && knownTurns >= 20
      && cacheRestoredTurns >= Math.max(20, Math.ceil(knownTurns * 0.8))
    );
    let result = await this.host.navigateToTurn(turnId, {
      turns: index.getOrdered(),
      getTurns: () => index.getOrdered(),
      isCurrent,
      allowMountedFastSettle,
      allowChatPredictiveFastPath,
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
      fastAttempted: Boolean(result?.fastAttempted),
      fastSucceeded: Boolean(result?.fastSucceeded),
      fallbackReason: result?.fallbackReason ?? null,
      officialBridgeAttempted: Boolean(result?.officialBridgeAttempted),
      officialBridgeSucceeded: Boolean(result?.officialBridgeSucceeded),
      officialBridgeFallbackReason: result?.officialBridgeFallbackReason ?? null,
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
    if (L3_RUNTIME_ENABLED && localWorkNavigation && result?.ok && result?.verified && result?.reason !== "superseded") {
      this.scheduleL3PostNavigationScan({ conversationId, targetOrder: latestTargetOrder, requestId });
    }
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
      officialNavigationHistory: this.officialNavigationHistory.map((item) => JSON.parse(JSON.stringify(item))),
      lastOfficialNavigation: this.officialNavigationHistory.length ? JSON.parse(JSON.stringify(this.officialNavigationHistory.at(-1))) : null,
      officialNavigationMapping: this.officialNavigationMapping ? JSON.parse(JSON.stringify(this.officialNavigationMapping)) : null,
      officialNavigationLearning: JSON.parse(JSON.stringify(this.officialNavigationLearning)),
      officialNavigationSessionLearning: JSON.parse(JSON.stringify(this.officialNavigationSessionLearning)),
      officialBridgeAuto: JSON.parse(JSON.stringify(this.officialBridgeAuto)),
      officialBridgeSessionTrustedTargets: this.getOfficialBridgeSessionTrustedTargets(),
      hostInternalDepthProbe: this.hostInternalDepthProbe ? JSON.parse(JSON.stringify(this.hostInternalDepthProbe)) : null,
      l3RuntimeEnabled: L3_RUNTIME_ENABLED,
      l3KeyJoinDryRun: createL3KeyJoinDryRunSummary(this.l3KeyJoinDryRun),
      officialNavigationLearningHistory: this.officialNavigationLearningHistory.map((item) => ({ ...item })),
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
    this.clearOfficialBridgeAutoTimer();
    this.clearHostInternalDepthProbeTimer();
    this.clearL3AdaptiveRescanTimer();
    this.clearL3EventRecoveryWatch();
    this.officialNavigationProbe?.destroy?.();
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

function createL3KeyJoinDryRunSummary(value = {}) {
  const nullableBoolean = (input) => input === true ? true : input === false ? false : null;
  const nullableCount = (input) => input == null || !Number.isFinite(Number(input)) ? null : Math.max(0, Math.floor(Number(input)));
  const nullableRatio = (input) => input == null || !Number.isFinite(Number(input)) ? null : Math.max(0, Math.min(1, Number(input)));
  return {
    status: typeof value.status === "string" ? value.status : "idle",
    stableScans: Math.max(0, Number(value.stableScans) || 0),
    mappedTurnCount: Math.max(0, Number(value.mappedTurnCount) || 0),
    coverage: Math.max(0, Math.min(1, Number(value.coverage) || 0)),
    conflicts: Math.max(0, Number(value.conflicts) || 0),
    exactPatternCount: Math.max(0, Number(value.exactPatternCount) || 0),
    mappingAgreement: Boolean(value.mappingAgreement),
    currentMarkerCount: nullableCount(value.currentMarkerCount),
    currentKnownTurnCount: nullableCount(value.currentKnownTurnCount),
    currentExactPatternCount: nullableCount(value.currentExactPatternCount),
    currentRelationPatternCount: nullableCount(value.currentRelationPatternCount),
    currentMarkersWithKeyJoinCandidates: nullableCount(value.currentMarkersWithKeyJoinCandidates),
    currentKeyJoinMappedMarkers: nullableCount(value.currentKeyJoinMappedMarkers),
    currentKeyJoinUniqueTurns: nullableCount(value.currentKeyJoinUniqueTurns),
    currentBestKeyJoinCoverage: nullableRatio(value.currentBestKeyJoinCoverage),
    currentBestKeyJoinConflicts: nullableCount(value.currentBestKeyJoinConflicts),
    currentBestKeyJoinOneToOne: nullableBoolean(value.currentBestKeyJoinOneToOne),
    currentMappedTurnCount: nullableCount(value.currentMappedTurnCount),
    currentCoverage: nullableRatio(value.currentCoverage),
    currentConflicts: nullableCount(value.currentConflicts),
    currentOneToOne: nullableBoolean(value.currentOneToOne),
    preferredPatternPresent: nullableBoolean(value.preferredPatternPresent),
    alternateExactPatternAvailable: nullableBoolean(value.alternateExactPatternAvailable),
    mappingStable: nullableBoolean(value.mappingStable),
    targetResolvable: nullableBoolean(value.targetResolvable),
    markerConnected: nullableBoolean(value.markerConnected),
    adaptiveRescanState: typeof value.adaptiveRescanState === "string" ? value.adaptiveRescanState : "idle",
    adaptiveRescanAttempt: Math.max(0, Number(value.adaptiveRescanAttempt) || 0),
    freshMapAccepted: nullableBoolean(value.freshMapAccepted)
  };
}

function isL3ExactKeyJoinScan(scan, index) {
  const summary = scan?.summary ?? null;
  const expectedKnownTurnCount = Number(index?.size?.() ?? 0);
  return Boolean(
    summary?.oneToOne
    && Number(summary?.coverage) === 1
    && Number(summary?.conflicts) === 0
    && scan?.patternKey
    && scan?.identityByTarget instanceof Map
    && scan.identityByTarget.size === expectedKnownTurnCount
    && Number(summary?.knownTurnCount) === expectedKnownTurnCount
  );
}

function adoptL3ExactKeyJoinScan(session, scan) {
  if (!session || !scan?.patternKey || !(scan?.identityByTarget instanceof Map)) return false;
  session.patternKey = scan.patternKey;
  session.identityByTarget = new Map(scan.identityByTarget);
  session.knownTurnCount = Number(scan?.summary?.knownTurnCount) || 0;
  session.pairsByTarget = scan.pairsByTarget instanceof Map ? scan.pairsByTarget : new Map();
  session.status = "dry-run-ready";
  session.stableScans = Math.max(2, Number(session.stableScans) || 0);
  return true;
}

function createL3FreshDiagnostics(scan, targetOrder) {
  const currentSummary = scan?.summary ?? null;
  const pair = scan?.pairsByTarget instanceof Map ? scan.pairsByTarget.get(targetOrder) : null;
  const marker = pair?.marker ?? null;
  return {
    currentMarkerCount: currentSummary ? currentSummary.markerCount : null,
    currentKnownTurnCount: currentSummary ? currentSummary.knownTurnCount : null,
    currentExactPatternCount: currentSummary ? currentSummary.exactPatternCount : null,
    currentRelationPatternCount: currentSummary ? currentSummary.relationPatternCount : null,
    currentMarkersWithKeyJoinCandidates: currentSummary ? currentSummary.markersWithKeyJoinCandidates : null,
    currentKeyJoinMappedMarkers: currentSummary ? currentSummary.keyJoinMappedMarkers : null,
    currentKeyJoinUniqueTurns: currentSummary ? currentSummary.keyJoinUniqueTurns : null,
    currentBestKeyJoinCoverage: currentSummary ? currentSummary.bestKeyJoinCoverage : null,
    currentBestKeyJoinConflicts: currentSummary ? currentSummary.bestKeyJoinConflicts : null,
    currentBestKeyJoinOneToOne: currentSummary ? Boolean(currentSummary.bestKeyJoinOneToOne) : null,
    currentMappedTurnCount: currentSummary ? currentSummary.mappedTurnCount : null,
    currentCoverage: currentSummary ? currentSummary.coverage : null,
    currentConflicts: currentSummary ? currentSummary.conflicts : null,
    currentOneToOne: currentSummary ? Boolean(currentSummary.oneToOne) : null,
    preferredPatternPresent: currentSummary?.preferredPatternPresent ?? null,
    alternateExactPatternAvailable: currentSummary?.alternateExactPatternAvailable ?? null,
    targetResolvable: Boolean(pair && pair.markerIndex != null),
    markerConnected: Boolean(marker && marker.isConnected !== false)
  };
}
function sameL3KeyJoinIdentityMap(left, right) {
  if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
  for (const [targetOrder, identity] of left.entries()) {
    if (!right.has(targetOrder) || !Object.is(identity, right.get(targetOrder))) return false;
  }
  return true;
}

function isSlowNavigationStep(step = {}) {
  const elapsedMs = Number(step?.elapsedMs) || 0;
  const waitMs = Number(step?.waitMs) || 0;
  if (step?.mode === "chat-progressive" || step?.mode === "chat-fast") return elapsedMs >= 100;
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
    fastAttempted: Boolean(value.fastAttempted),
    fastSucceeded: Boolean(value.fastSucceeded),
    fallbackReason: typeof value.fallbackReason === "string" ? value.fallbackReason : null,
    officialBridgeAttempted: Boolean(value.officialBridgeAttempted),
    officialBridgeSucceeded: Boolean(value.officialBridgeSucceeded),
    officialBridgeFallbackReason: typeof value.officialBridgeFallbackReason === "string" ? value.officialBridgeFallbackReason : null,
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
