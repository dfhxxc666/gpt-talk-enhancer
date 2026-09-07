import { VERSION, STORAGE_KEYS, TIMELINE_MODE } from "./core/constants.js";
import { CodexAdapter } from "./core/codex-adapter.js";
import { TurnRegistry } from "./core/turn-registry.js";
import { RenderedTracker } from "./core/rendered-tracker.js";
import { ConversationObserver } from "./core/conversation-observer.js";
import { RootObserver } from "./core/root-observer.js";
import { ActiveTracker } from "./core/active-tracker.js";
import { TimelineRenderer, removeTimelineArtifacts } from "./core/timeline-renderer.js";
import { LocalStorageAdapter, SettingsStore } from "./core/storage-adapter.js";
import { PromptStore } from "./core/prompt-store.js";
import { ComposerAdapter } from "./core/composer-adapter.js";
import { NoOpBridgeAdapter } from "./core/bridge-adapter.js";
import { PromptPicker, removePromptArtifacts, showToast } from "./core/prompt-picker.js";
import { safeIsConnected } from "./core/dom-utils.js";
import { runVirtualizationSpike } from "./core/virtualization-spike.js";

export class TalkEnhancerApp {
  constructor({
    document: documentRef = globalThis.document,
    window: windowRef = globalThis.window,
    adapter = null,
    storageAdapter = null,
    bridgeAdapter = null,
    clock = () => Date.now()
  } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.clock = clock;
    this.adapter = adapter ?? new CodexAdapter({ document: documentRef, window: windowRef });
    this.storage = storageAdapter ?? new LocalStorageAdapter(getWindowStorage(windowRef));
    this.bridge = bridgeAdapter ?? new NoOpBridgeAdapter();
    this.settings = new SettingsStore({ storage: this.storage, key: STORAGE_KEYS.settings });
    this.promptStore = new PromptStore({ storage: this.storage, key: STORAGE_KEYS.prompts, clock });
    this.registry = new TurnRegistry({ clock });
    this.composer = new ComposerAdapter({
      document: documentRef,
      window: windowRef,
      onToast: (message) => this.toast(message)
    });
    this.timeline = new TimelineRenderer({
      document: documentRef,
      adapter: this.adapter,
      expanded: this.settings.load().data.timelineExpanded,
      onSelect: (key) => this.jumpToTurn(key),
      onEarlier: () => this.discoverEarlier(),
      onExpandedChange: (expanded) => this.settings.save({ timelineExpanded: expanded })
    });
    this.promptPicker = new PromptPicker({
      document: documentRef,
      window: windowRef,
      store: this.promptStore,
      composer: this.composer,
      onToast: (message) => this.toast(message)
    });
    this.renderedTracker = new RenderedTracker({
      adapter: this.adapter,
      registry: this.registry,
      clock,
      onChange: ({ reason, records }) => this.updateTimeline(reason, records)
    });
    this.activeTracker = new ActiveTracker({
      adapter: this.adapter,
      registry: this.registry,
      document: documentRef,
      window: windowRef,
      onActiveChange: (key) => {
        this.activeKey = key;
        this.updateTimeline("active-change");
      }
    });
    this.conversationObserver = new ConversationObserver({
      tracker: this.renderedTracker,
      document: documentRef,
      window: windowRef
    });
    this.rootObserver = new RootObserver({
      adapter: this.adapter,
      document: documentRef,
      window: windowRef,
      onContextChange: (context) => this.bindContext(context)
    });
    this.context = null;
    this.activeKey = null;
    this.initialized = false;
    this.destroyed = false;
    this.lastSpike = null;
    this.earlierRequestId = 0;
    this.earlierTimer = null;
    this.earlierWaitResolve = null;
    this.earlierPending = false;
    this.jumpRequestId = 0;
  }

  init() {
    if (this.initialized) {
      return this;
    }

    const existing = this.window?.__GPTTalkEnhancer;
    if (existing && existing !== this && typeof existing.destroy === "function") {
      existing.destroy();
    }
    removeTimelineArtifacts(this.document);
    removePromptArtifacts(this.document);
    this.timeline.mount();
    this.rootObserver.start();
    this.initialized = true;
    this.destroyed = false;
    this.refresh();
    return this;
  }

  refresh() {
    if (!this.initialized && this.destroyed) {
      return this.status();
    }
    const context = this.adapter.getContext();
    this.bindContext(context);
    return this.status();
  }

  bindContext(context) {
    const previous = this.context;
    const hostContextChanged = !previous
      || previous.root !== context.root
      || previous.scrollContainer !== context.scrollContainer;
    const conversationChanged = !previous || previous.rootIdentity !== context.rootIdentity;
    this.context = context;

    if (conversationChanged) {
      this.registry.setConversation(context.rootIdentity);
      this.activeKey = null;
    }

    if (hostContextChanged || conversationChanged) {
      this.cancelEarlierDiscovery();
      this.updateTimeline(conversationChanged ? "conversation-reset" : "context-reset", null, { refreshActive: false });
      this.timeline.setEarlierState("↑ Earlier");
    }

    const renderedBindingChanged = this.renderedTracker.root !== context.root
      || this.renderedTracker.scrollContainer !== context.scrollContainer;
    const activeBindingChanged = this.activeTracker.scrollContainer !== context.scrollContainer;

    if (hostContextChanged || renderedBindingChanged || activeBindingChanged) {
      this.conversationObserver.bind(context.root);
      this.renderedTracker.bind(context.root, context.scrollContainer);
      this.activeTracker.bind(context.scrollContainer);
    } else if (context.root && context.scrollContainer) {
      this.renderedTracker.refresh("context-refresh");
      this.activeTracker.refresh();
    }

    this.promptPicker.mount(context.mount);
    this.updateTimeline(conversationChanged ? "conversation-change" : "context-change");
  }

  updateTimeline(reason = "manual", records = null, { refreshActive = true } = {}) {
    if (!this.timeline) return;
    const currentRecords = records ?? this.registry.getUserRecords();
    const statusText = this.context?.root
      ? `${currentRecords.length} 条用户消息 · ${reason}`
      : "未检测到 Conversation";
    this.timeline.setState({
      records: currentRecords,
      activeKey: this.activeKey,
      mode: TIMELINE_MODE,
      statusText
    });
    if (refreshActive) this.activeTracker.refresh();
  }

  async jumpToTurn(key) {
    const record = this.registry.get(key);
    if (!record) return { ok: false, reason: "unknown-turn" };
    const requestId = ++this.jumpRequestId;
    const result = await this.adapter.scrollToTurn(record, {
      shouldContinue: () => requestId === this.jumpRequestId
    });
    if (requestId !== this.jumpRequestId) return { ok: false, reason: "superseded" };
    if (result.ok) {
      this.activeTracker.refresh();
      const requestFrame = this.window?.requestAnimationFrame;
      if (typeof requestFrame === "function") {
        requestFrame(() => {
          if (requestId === this.jumpRequestId) this.activeTracker.refresh();
        });
      }
    } else if (result.reason !== "superseded") {
      this.toast("未能定位到该消息，请再试一次");
    }
    return result;
  }

  async discoverEarlier({ timeoutMs = 1000, intervalMs = 40, stableMs = 160 } = {}) {
    if (!this.initialized || this.destroyed) {
      return { ok: false, reason: "not-initialized" };
    }
    if (this.earlierPending) {
      return { ok: false, reason: "already-loading" };
    }

    let context = this.adapter.getContext();
    if (this.adapter.contextChanged?.(this.context, context)) {
      this.bindContext(context);
    }
    context = this.context ?? context;
    if (!context?.root || !context?.scrollContainer) {
      this.timeline.setEarlierState("No more discovered");
      return { ok: false, reason: "missing-scroll-context" };
    }

    const requestId = ++this.earlierRequestId;
    const beforeKeys = new Set(this.registry.getAll().map((record) => record.key));
    this.earlierPending = true;
    this.timeline.setEarlierState("Loading…");

    let movement;
    try {
      movement = this.adapter.moveEarlier({
        container: context.scrollContainer,
        behavior: "auto"
      });
    } catch {
      movement = { ok: false, reason: "scroll-move-failed" };
    }

    if (!movement?.ok) {
      if (this.isEarlierRequestCurrent(requestId, context)) {
        this.earlierPending = false;
        this.timeline.setEarlierState("No more discovered");
      }
      return movement ?? { ok: false, reason: "scroll-move-failed" };
    }

    const discovery = await this.waitForEarlierDiscovery({
      context,
      requestId,
      beforeKeys,
      timeoutMs,
      intervalMs,
      stableMs
    });

    if (!this.isEarlierRequestCurrent(requestId, context)) {
      return { ok: false, reason: "stale-discovery", movement, discovery };
    }

    this.earlierPending = false;
    const discovered = discovery.discoveredKeys.length > 0;
    this.timeline.setEarlierState(discovered ? "↑ Earlier" : "No more discovered");
    this.updateTimeline(discovered ? "earlier-discovery" : "earlier-no-new", null, { refreshActive: false });
    return { ok: true, movement, discovery, discovered };
  }

  waitForEarlierDiscovery({
    context,
    requestId,
    beforeKeys,
    timeoutMs,
    intervalMs,
    stableMs
  }) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastFingerprint = this.getRenderedFingerprint();
      let stableSince = null;

      const finish = (result) => {
        if (this.earlierTimer !== null) {
          this.clearEarlierTimer(this.earlierTimer);
          this.earlierTimer = null;
        }
        if (this.earlierWaitResolve === cancelWait) {
          this.earlierWaitResolve = null;
        }
        resolve({ discoveredKeys: [], ...result });
      };
      const cancelWait = () => finish({ cancelled: true });
      this.earlierWaitResolve = cancelWait;

      const check = () => {
        if (!this.isEarlierRequestCurrent(requestId, context)) {
          finish({ cancelled: true });
          return;
        }

        this.renderedTracker.refresh("earlier-hydration");
        const discoveredKeys = this.registry.getAll()
          .map((record) => record.key)
          .filter((key) => !beforeKeys.has(key));
        if (discoveredKeys.length > 0) {
          finish({ discoveredKeys });
          return;
        }

        const fingerprint = this.getRenderedFingerprint();
        const now = Date.now();
        if (fingerprint === lastFingerprint) {
          stableSince ??= now;
        } else {
          lastFingerprint = fingerprint;
          stableSince = now;
        }

        const timedOut = now - startedAt >= timeoutMs;
        const stable = stableSince !== null
          && now - startedAt >= stableMs
          && now - stableSince >= Math.min(120, stableMs);
        if (timedOut || stable) {
          finish({ discoveredKeys: [], timedOut, stable });
          return;
        }
        this.earlierTimer = this.scheduleEarlierTimer(check, intervalMs);
      };

      this.earlierTimer = this.scheduleEarlierTimer(check, 0);
    });
  }

  getRenderedFingerprint() {
    return this.renderedTracker.getRenderedTurns()
      .map((turn) => JSON.stringify([turn.key, turn.text, turn.logicalOrder]))
      .join("|");
  }

  isEarlierRequestCurrent(requestId, context) {
    return this.initialized
      && !this.destroyed
      && this.earlierPending
      && this.earlierRequestId === requestId
      && this.context?.root === context.root
      && this.context?.scrollContainer === context.scrollContainer
      && this.context?.rootIdentity === context.rootIdentity;
  }

  scheduleEarlierTimer(callback, delay) {
    const setTimeoutRef = this.window?.setTimeout;
    return typeof setTimeoutRef === "function"
      ? setTimeoutRef.call(this.window, callback, delay)
      : setTimeout(callback, delay);
  }

  clearEarlierTimer(timer) {
    const clearTimeoutRef = this.window?.clearTimeout;
    if (typeof clearTimeoutRef === "function") {
      clearTimeoutRef.call(this.window, timer);
      return;
    }
    clearTimeout(timer);
  }

  cancelEarlierDiscovery() {
    this.earlierRequestId += 1;
    const resolve = this.earlierWaitResolve;
    this.earlierWaitResolve = null;
    if (this.earlierTimer !== null) {
      this.clearEarlierTimer(this.earlierTimer);
      this.earlierTimer = null;
    }
    this.earlierPending = false;
    resolve?.();
  }

  async runVirtualizationSpike(options = {}) {
    if (this.lastSpike?.running) return this.lastSpike.promise;
    const context = this.context ?? this.adapter.getContext();
    const promise = runVirtualizationSpike({
      adapter: this.adapter,
      root: context.root,
      scrollContainer: context.scrollContainer,
      editor: context.editor,
      document: this.document,
      window: this.window,
      ...options
    });
    this.lastSpike = { running: true, promise };
    const result = await promise;
    this.lastSpike = { running: false, result };
    return result;
  }

  toast(message) {
    return showToast(this.document, message);
  }

  status() {
    return {
      version: VERSION,
      health: this.getHealth(),
      initialized: this.initialized,
      destroyed: this.destroyed,
      timelineMode: TIMELINE_MODE,
      conversationDetected: Boolean(this.context?.root),
      scrollContainerDetected: safeIsConnected(this.context?.scrollContainer),
      composerDetected: Boolean(this.context?.editor),
      timelineMounted: Boolean(this.timeline?.root),
      promptButtonMounted: Boolean(this.promptPicker?.button),
      promptPopupOpen: Boolean(this.promptPicker?.popup),
      turnCount: this.registry.size,
      earlierState: this.timeline?.earlierState ?? "↑ Earlier",
      earlierPending: this.earlierPending,
      earlierTimerActive: this.earlierTimer !== null,
      activeTurnKey: this.activeKey,
      rootObserver: this.rootObserver.status(),
      conversationObserver: this.conversationObserver.status(),
      renderedTracker: this.renderedTracker.status(),
      activeTracker: this.activeTracker.status(),
      bridgeAvailable: Boolean(this.bridge?.available?.())
    };
  }

  getHealth() {
    if (!this.initialized || this.destroyed) {
      return "not-ready";
    }
    const activeStatus = this.activeTracker?.status?.() ?? {};
    const coreReady = Boolean(
      this.context?.root
      && safeIsConnected(this.context?.scrollContainer)
      && this.timeline?.root
      && this.renderedTracker?.root
      && this.renderedTracker?.scrollContainer === this.context.scrollContainer
      && this.activeTracker?.scrollContainer === this.context.scrollContainer
      && activeStatus.bound
      && activeStatus.intersectionObserverActive
    );
    const composerReady = !this.context?.composerRoot || Boolean(this.promptPicker?.button);
    return coreReady && composerReady ? "healthy" : "degraded";
  }

  destroy() {
    if (this.destroyed) return;
    this.cancelEarlierDiscovery();
    this.rootObserver.dispose();
    this.conversationObserver.dispose();
    this.renderedTracker.dispose();
    this.activeTracker.dispose();
    this.promptPicker.destroy();
    this.timeline.destroy();
    removeTimelineArtifacts(this.document);
    removePromptArtifacts(this.document);
    this.context = null;
    this.initialized = false;
    this.destroyed = true;
    if (this.window?.__GPTTalkEnhancer === this) {
      delete this.window.__GPTTalkEnhancer;
    }
  }
}

export function cleanupOwnedUi(documentRef = globalThis.document) {
  removeTimelineArtifacts(documentRef);
  removePromptArtifacts(documentRef);
}

function getWindowStorage(windowRef) {
  try {
    return windowRef?.localStorage ?? null;
  } catch {
    return null;
  }
}
