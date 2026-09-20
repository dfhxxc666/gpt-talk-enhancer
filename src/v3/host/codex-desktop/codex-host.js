import { HostInterface } from "../host-interface.js";
import { ConversationAdapter, isStableLocalThreadIdentity } from "./conversation-adapter.js";
import { TurnAdapter } from "./turn-adapter.js";
import { WorkTurnAdapter } from "./work-turn-adapter.js";
import { ComposerAdapter } from "./composer-adapter.js";
import { OverlayDetector } from "./overlay-detector.js";
import { SurfaceDetector } from "./surface-detector.js";
import { ConversationCapture } from "./conversation-capture.js";
import { NavigationAdapter, computeActiveTurnId } from "./navigation-adapter.js";
import { WorkNavigationAdapter } from "./work-navigation-adapter.js";
import { HostContractDiagnostics } from "./host-contract.js";

export function computeTailActiveTurnId({ visibleTurns = [], resolveTurn, container = null, windowRef = globalThis.window, tolerance = 2 } = {}) {
  if (!container) return null;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  if (flexDirection !== "column-reverse") return null;
  const scrollTop = Number(container.scrollTop);
  if (!Number.isFinite(scrollTop) || Math.abs(scrollTop) > tolerance) return null;
  const scrollHeight = Number(container.scrollHeight);
  const clientHeight = Number(container.clientHeight);
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight) || scrollHeight <= clientHeight + tolerance) return null;
  const containerRect = container.getBoundingClientRect?.();
  if (!containerRect) return null;

  let tailTurnId = null;
  let tailTop = Number.NEGATIVE_INFINITY;
  let tailBottom = Number.NEGATIVE_INFINITY;
  for (const turn of visibleTurns) {
    if (!turn?.id) continue;
    const rect = resolveTurn?.(turn.id)?.getBoundingClientRect?.();
    if (!rect) continue;
    if (rect.top >= containerRect.bottom) return null;
    if (rect.bottom <= containerRect.top) continue;
    if (rect.top > tailTop || (rect.top === tailTop && rect.bottom > tailBottom)) {
      tailTurnId = turn.id;
      tailTop = rect.top;
      tailBottom = rect.bottom;
    }
  }
  return tailTurnId;
}

export class CodexDesktopHost extends HostInterface {
  constructor({ document, window, onCapture, onCaptureStatus } = {}) {
    super();
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.conversation = new ConversationAdapter({ document: this.document, window: this.window });
    this.chatTurns = new TurnAdapter({ document: this.document });
    this.workTurns = new WorkTurnAdapter({ document: this.document });
    this.lastHostMode = null;
    this.turns = createRoutedTurnAdapter(this);
    this.composer = new ComposerAdapter({ document: this.document, window: this.window });
    this.overlay = new OverlayDetector({ document: this.document });
    this.surface = new SurfaceDetector({
      document: this.document,
      window: this.window,
      conversationAdapter: this.conversation,
      overlayDetector: this.overlay
    });
    this.chatNavigation = new NavigationAdapter({
      window: this.window,
      conversationAdapter: this.conversation,
      activationOffset: 120,
      maxHydrationSteps: 256,
      maxConsecutiveStalls: 4,
      hydrationWaitMs: 900,
      inactivityNavigationMs: 5000,
      absoluteMaxNavigationMs: 45000,
      postSettleWaitMs: 160,
      maxPostSettleCorrections: 2,
      turnAdapter: this.chatTurns
    });
    this.workNavigation = new WorkNavigationAdapter({
      window: this.window,
      conversationAdapter: this.conversation,
      activationOffset: 120,
      maxHydrationSteps: 256,
      maxConsecutiveStalls: 4,
      hydrationWaitMs: 900,
      inactivityNavigationMs: 5000,
      absoluteMaxNavigationMs: 45000,
      postSettleWaitMs: 160,
      maxPostSettleCorrections: 2,
      turnAdapter: this.workTurns
    });
    this.navigation = createRoutedNavigationAdapter(this);
    this.capture = new ConversationCapture({
      window: this.window,
      onCapture,
      onStatus: onCaptureStatus
    });
    this.contract = new HostContractDiagnostics({
      document: this.document,
      window: this.window,
      conversationAdapter: this.conversation,
      turnAdapter: this.turns,
      composerAdapter: this.composer,
      surfaceDetector: this.surface,
      capture: this.capture
    });
    this.navigationRequestId = 0;
    this.hostTailIntentGeneration = 0;
    this.boundHostPointerDown = (event) => this.handleHostPointerDown(event);
  }

  start() {
    this.capture.install();
    this.window?.addEventListener?.("pointerdown", this.boundHostPointerDown, true);
    return this;
  }

  getSurface() {
    return this.surface.getSurface();
  }

  isPromptOverlayBlocked() {
    if (this.overlay.isBlockingDialogOpen?.()) return true;
    return this.overlay.isPromptFloatingLayerOpen?.({ composerRect: this.getComposerRect?.() ?? null }) ?? false;
  }

  getConversationId() {
    return this.conversation.getConversationId();
  }

  getConversationIdentity() {
    return this.conversation.getConversationIdentity();
  }

  getDirectConversationIdentity() {
    return this.conversation.getDirectConversationIdentity?.() ?? null;
  }

  setInferredChatConversationId(conversationId) {
    return this.conversation.setInferredChatConversationId?.(conversationId) ?? false;
  }

  clearInferredChatConversationId() {
    return this.conversation.clearInferredChatConversationId?.() ?? false;
  }

  getChatVisibleTurns() {
    return this.chatTurns.getVisibleTurns?.() ?? [];
  }

  getRoute() {
    return this.conversation.getRoute();
  }

  getHostMode() {
    const identity = this.conversation.getConversationIdentity?.() ?? null;
    const conversationId = this.conversation.getConversationId?.() ?? null;
    if (identity?.host === "local" || String(conversationId ?? "").startsWith("local:")) {
      this.lastHostMode = "work";
      return "work";
    }
    if (identity?.host === "chatgpt") {
      this.lastHostMode = "chat";
      return "chat";
    }
    return this.lastHostMode ?? "chat";
  }

  getTurnAdapter() {
    return this.getHostMode() === "work" ? this.workTurns : this.chatTurns;
  }

  getNavigationAdapter() {
    return this.getHostMode() === "work" ? this.workNavigation : this.chatNavigation;
  }

  getVisibleTurns() {
    return this.turns.getVisibleTurns();
  }

  resolveTurn(turnId) {
    return this.turns.resolveTurn(turnId);
  }

  getActiveTurnId() {
    const visibleTurns = this.getVisibleTurns();
    const container = this.getScrollContainer();
    const resolveTurn = (turnId) => this.resolveTurn(turnId);
    const tailActiveTurnId = computeTailActiveTurnId({
      visibleTurns,
      resolveTurn,
      container,
      windowRef: this.window
    });
    if (tailActiveTurnId) return tailActiveTurnId;
    const identity = this.getConversationIdentity();
    const activationOffset = identity?.stable && identity?.host === "local" && identity?.source === "sidebar-local" ? 132 : 120;
    return computeActiveTurnId({
      visibleTurns,
      resolveTurn,
      container,
      activationOffset
    });
  }

  async navigateToTurn(turnId, { turns = [], getTurns = null, isCurrent = () => true, allowMountedFastSettle = false, onTraceStep = null } = {}) {
    const requestId = ++this.navigationRequestId;
    const stillCurrent = () => requestId === this.navigationRequestId && isCurrent();
    const result = await this.navigation.navigateToTurn(turnId, {
      turns,
      getTurns,
      isCurrent: stillCurrent,
      allowMountedFastSettle,
      onTraceStep
    });
    if (result?.ok && result?.verified && stillCurrent()) this.persistLocalScrollPosition();
    return result;
  }

  notifyNavigationIntent() {
    const container = this.getScrollContainer();
    if (!container || container.isConnected === false) return false;
    return this.getNavigationAdapter()?.notifyCodexPlusScrollIntent?.(container, () => true) ?? false;
  }

  isWorkEarlierBoundary() {
    if (this.getHostMode() !== "work") return false;
    return this.workNavigation?.isEarlierBoundary?.() ?? false;
  }

  hydrateWorkEarlierHistory(options = {}) {
    if (this.getHostMode() !== "work") {
      return Promise.resolve({ ok: false, started: false, reason: "not-work" });
    }
    return this.workNavigation?.hydrateEarlierHistory?.(options)
      ?? Promise.resolve({ ok: false, started: false, reason: "unsupported" });
  }

  hydrateChatEarlierHistory(options = {}) {
    if (this.getHostMode() !== "chat") {
      return Promise.resolve({ ok: false, started: false, reason: "not-chat" });
    }
    return this.chatNavigation?.hydrateEarlierHistory?.(options)
      ?? Promise.resolve({ ok: false, started: false, reason: "unsupported" });
  }

  sweepLoadedChatHistory(options = {}) {
    if (this.getHostMode() !== "chat") {
      return Promise.resolve({ ok: false, started: false, reason: "not-chat" });
    }
    return this.chatNavigation?.sweepLoadedChatHistory?.(options)
      ?? Promise.resolve({ ok: false, started: false, reason: "unsupported" });
  }

  handleHostPointerDown(event) {
    const identity = this.getConversationIdentity();
    if (!identity?.stable || identity.host !== "local" || identity.source !== "sidebar-local") return false;
    const container = this.getScrollContainer();
    if (!container || container.isConnected === false) return false;
    const button = findHostTailButtonCandidate(event?.target, container);
    if (!button) return false;

    const notified = this.workNavigation?.notifyCodexPlusScrollIntent?.(container, () => true) ?? false;
    if (!notified) return false;
    const generation = ++this.hostTailIntentGeneration;
    const delays = [0, 60, 180, 360];
    const set = this.window?.setTimeout ?? setTimeout;
    const check = (index) => {
      if (generation !== this.hostTailIntentGeneration) return;
      set(() => {
        if (generation !== this.hostTailIntentGeneration) return;
        const currentIdentity = this.getConversationIdentity();
        if (!currentIdentity?.stable || currentIdentity.id !== identity.id || currentIdentity.host !== "local" || currentIdentity.source !== "sidebar-local") return;
        if (this.getScrollContainer() !== container || container.isConnected === false) return;
        if (isPhysicalScrollTail(container, this.window)) {
          this.persistLocalScrollPosition();
          this.hostTailIntentGeneration += 1;
          return;
        }
        const nearTailTolerance = Math.min(96, Math.max(36, Number(container.clientHeight || 0) * 0.08));
        if (index >= 2 && distanceToPhysicalScrollTail(container, this.window) <= nearTailTolerance) {
          snapToPhysicalScrollTail(container, this.window);
          this.persistLocalScrollPosition();
          this.hostTailIntentGeneration += 1;
          return;
        }
        if (index + 1 < delays.length) check(index + 1);
      }, delays[index] ?? 0);
    };
    check(0);
    return true;
  }

  persistLocalScrollPosition() {
    const identity = this.getConversationIdentity();
    if (!identity?.stable || identity.source !== "sidebar-local") return false;
    if (!isStableLocalThreadIdentity(identity.id, { host: identity.host, kind: identity.kind })) return false;
    const container = this.getScrollContainer();
    if (!container || container.isConnected === false) return false;
    if (!(Number(container.scrollHeight) > 0) || !(Number(container.clientHeight) > 0)) return false;
    const handlers = this.window?.__codexThreadScrollHandlers;
    const saveNow = handlers?.saveNow;
    if (typeof saveNow !== "function") return false;
    const sessionId = String(identity.id).slice("local:".length);
    try {
      saveNow.call(handlers, sessionId, container);
      return true;
    } catch {
      return false;
    }
  }
  cancelNavigation() {
    this.navigationRequestId += 1;
  }

  getComposer() {
    return this.composer.getComposer();
  }

  getComposerForm() {
    return this.composer.getComposerForm();
  }

  getComposerRect() {
    return this.composer.getComposerRect();
  }

  insertPrompt(text) {
    return this.composer.insertText(text);
  }

  isMediaViewerOpen() {
    return this.overlay.isMediaViewerOpen();
  }

  getScrollContainer() {
    return this.conversation.getScrollContainer();
  }

  getConversationViewportElement() {
    return this.conversation.getScrollContainer?.() ?? this.conversation.getConversationRoot?.() ?? null;
  }

  getConversationViewportRect() {
    return this.getConversationViewportElement()?.getBoundingClientRect?.() ?? null;
  }

  getCompatibilityReport() {
    return this.contract.inspect();
  }

  getNavigationCompatibility() {
    return this.navigation.getCompatibilityStatus?.() ?? null;
  }

  getTheme() {
    const root = this.document?.documentElement;
    const explicit = root?.getAttribute?.("data-theme") ?? root?.getAttribute?.("data-color-scheme");
    if (explicit === "light" || explicit === "dark") return explicit;
    if (root?.classList?.contains?.("dark")) return "dark";
    return this.window?.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  destroy() {
    this.cancelNavigation();
    this.hostTailIntentGeneration += 1;
    this.window?.removeEventListener?.("pointerdown", this.boundHostPointerDown, true);
    this.capture.dispose();
  }
}

function findHostTailButtonCandidate(target, container) {
  let button = target ?? null;
  while (button && String(button.tagName ?? "").toUpperCase() !== "BUTTON") button = button.parentElement ?? null;
  if (!button) return null;
  for (let node = button; node; node = node.parentElement ?? null) {
    if (node.getAttribute?.("data-gte-component")) return null;
  }
  const buttonRect = button.getBoundingClientRect?.();
  const containerRect = container?.getBoundingClientRect?.();
  if (!buttonRect || !containerRect) return null;
  const width = Number(buttonRect.width) || Math.max(0, Number(buttonRect.right) - Number(buttonRect.left));
  const height = Number(buttonRect.height) || Math.max(0, Number(buttonRect.bottom) - Number(buttonRect.top));
  if (width < 20 || height < 20 || width > 72 || height > 72) return null;
  const containerWidth = Number(containerRect.width) || Math.max(0, Number(containerRect.right) - Number(containerRect.left));
  const containerHeight = Number(containerRect.height) || Math.max(0, Number(containerRect.bottom) - Number(containerRect.top));
  if (!(containerWidth > 0) || !(containerHeight > 0)) return null;
  const centerX = (Number(buttonRect.left) + Number(buttonRect.right)) / 2;
  const centerY = (Number(buttonRect.top) + Number(buttonRect.bottom)) / 2;
  const minX = Number(containerRect.left) + containerWidth * 0.28;
  const maxX = Number(containerRect.right) - containerWidth * 0.28;
  const minY = Number(containerRect.top) + containerHeight * 0.55;
  const maxY = Number(containerRect.bottom) + 48;
  return centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY ? button : null;
}

function distanceToPhysicalScrollTail(container, windowRef = globalThis.window) {
  if (!container) return Number.POSITIVE_INFINITY;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  const scrollTop = Number(container.scrollTop);
  if (!Number.isFinite(scrollTop)) return Number.POSITIVE_INFINITY;
  if (flexDirection === "column-reverse") return Math.abs(scrollTop);
  const max = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
  return Math.abs(max - scrollTop);
}

function snapToPhysicalScrollTail(container, windowRef = globalThis.window) {
  if (!container) return false;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  if (flexDirection === "column-reverse") container.scrollTop = 0;
  else container.scrollTop = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
  return true;
}

function isPhysicalScrollTail(container, windowRef = globalThis.window, tolerance = 3) {
  if (!container) return false;
  const flexDirection = windowRef?.getComputedStyle?.(container)?.flexDirection
    ?? container?.style?.flexDirection
    ?? "column";
  const scrollTop = Number(container.scrollTop);
  if (!Number.isFinite(scrollTop)) return false;
  if (flexDirection === "column-reverse") return Math.abs(scrollTop) <= tolerance;
  const max = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
  return Math.abs(max - scrollTop) <= tolerance;
}

function createRoutedTurnAdapter(host) {
  return {
    getVisibleTurns: (...args) => host.getTurnAdapter()?.getVisibleTurns?.(...args) ?? [],
    resolveTurn: (...args) => host.getTurnAdapter()?.resolveTurn?.(...args) ?? null,
    verifyTurnElement: (...args) => Boolean(host.getTurnAdapter()?.verifyTurnElement?.(...args))
  };
}

function createRoutedNavigationAdapter(host) {
  return {
    navigateToTurn: (...args) => host.getNavigationAdapter()?.navigateToTurn?.(...args),
    getCompatibilityStatus: () => host.getNavigationAdapter()?.getCompatibilityStatus?.() ?? null
  };
}
