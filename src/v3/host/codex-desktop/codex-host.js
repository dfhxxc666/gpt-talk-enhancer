import { HostInterface } from "../host-interface.js";
import { ConversationAdapter, isStableLocalThreadIdentity } from "./conversation-adapter.js";
import { TurnAdapter } from "./turn-adapter.js";
import { ComposerAdapter } from "./composer-adapter.js";
import { OverlayDetector } from "./overlay-detector.js";
import { SurfaceDetector } from "./surface-detector.js";
import { ConversationCapture } from "./conversation-capture.js";
import { NavigationAdapter, computeActiveTurnId } from "./navigation-adapter.js";
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
    this.turns = new TurnAdapter({ document: this.document });
    this.composer = new ComposerAdapter({ document: this.document, window: this.window });
    this.overlay = new OverlayDetector({ document: this.document });
    this.surface = new SurfaceDetector({
      document: this.document,
      window: this.window,
      conversationAdapter: this.conversation,
      overlayDetector: this.overlay
    });
    this.navigation = new NavigationAdapter({
      window: this.window,
      turnAdapter: this.turns,
      conversationAdapter: this.conversation,
      activationOffset: 120,
      maxHydrationSteps: 256,
      maxConsecutiveStalls: 4,
      hydrationWaitMs: 900,
      inactivityNavigationMs: 5000,
      absoluteMaxNavigationMs: 45000,
      postSettleWaitMs: 160,
      maxPostSettleCorrections: 2
    });
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
  }

  start() {
    this.capture.install();
    return this;
  }

  getSurface() {
    return this.surface.getSurface();
  }

  getConversationId() {
    return this.conversation.getConversationId();
  }

  getConversationIdentity() {
    return this.conversation.getConversationIdentity();
  }

  getRoute() {
    return this.conversation.getRoute();
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
    return computeActiveTurnId({
      visibleTurns,
      resolveTurn,
      container,
      activationOffset: 120
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
    this.capture.dispose();
  }
}
