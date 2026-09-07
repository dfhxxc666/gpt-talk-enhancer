import { SURFACE } from "../host-interface.js";

export const HOST_CONTRACT_REVISION = "codex-desktop-v1";
export const HOST_CONTRACT_STATUS = Object.freeze({
  READY: "ready",
  DEGRADED: "degraded",
  UNKNOWN: "unknown",
  UNAVAILABLE: "unavailable",
  OPTIONAL_UNAVAILABLE: "optional-unavailable"
});

const FALLBACK_TURN = /^fallback-turn-\d+$/;

export class HostContractDiagnostics {
  constructor({ document, window, conversationAdapter, turnAdapter, composerAdapter, surfaceDetector, capture } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.conversationAdapter = conversationAdapter;
    this.turnAdapter = turnAdapter;
    this.composerAdapter = composerAdapter;
    this.surfaceDetector = surfaceDetector;
    this.capture = capture;
  }

  inspect() {
    const surface = this.surfaceDetector?.getSurface?.() ?? SURFACE.OTHER;
    const conversationId = this.conversationAdapter?.getConversationId?.() ?? null;
    const conversationRoot = this.conversationAdapter?.getConversationRoot?.() ?? null;
    const scrollContainer = this.conversationAdapter?.getScrollContainer?.() ?? null;
    const visibleTurns = this.turnAdapter?.getVisibleTurns?.() ?? [];
    const composer = this.composerAdapter?.getComposer?.() ?? null;
    const rendererScheme = readRendererScheme(this.window?.location);
    const flexDirection = scrollContainer
      ? (this.window?.getComputedStyle?.(scrollContainer)?.flexDirection ?? scrollContainer?.style?.flexDirection ?? "")
      : "";

    return evaluateHostContract({
      surface,
      rendererScheme,
      conversationId,
      conversationRoot,
      scrollContainer,
      visibleTurns,
      composer,
      flexDirection,
      captureInstalled: Boolean(this.capture?.installed),
      fetchAvailable: typeof this.window?.fetch === "function"
    });
  }
}

export function evaluateHostContract({
  surface = SURFACE.OTHER,
  rendererScheme = "",
  conversationId = null,
  conversationRoot = null,
  scrollContainer = null,
  visibleTurns = [],
  composer = null,
  flexDirection = "",
  captureInstalled = false,
  fetchAvailable = false
} = {}) {
  const isConversation = surface === SURFACE.CONVERSATION;
  const isNewChat = surface === SURFACE.NEW_CHAT;
  const turns = Array.isArray(visibleTurns) ? visibleTurns : [];
  const turnIdMode = classifyTurnIdMode(turns);
  const scrollable = Boolean(scrollContainer)
    && Number(scrollContainer?.scrollHeight ?? 0) > Number(scrollContainer?.clientHeight ?? 0);

  const renderer = {
    status: rendererScheme === "app:" ? HOST_CONTRACT_STATUS.READY : HOST_CONTRACT_STATUS.UNKNOWN,
    scheme: rendererScheme || "unknown"
  };
  const surfaceReport = { status: HOST_CONTRACT_STATUS.READY, value: surface };
  const conversation = isConversation
    ? {
        status: conversationId && conversationRoot ? HOST_CONTRACT_STATUS.READY : HOST_CONTRACT_STATUS.UNAVAILABLE,
        required: true,
        idDetected: Boolean(conversationId),
        rootDetected: Boolean(conversationRoot)
      }
    : {
        status: HOST_CONTRACT_STATUS.READY,
        required: false,
        idDetected: Boolean(conversationId),
        rootDetected: Boolean(conversationRoot)
      };
  const scroll = isConversation
    ? {
        status: !scrollContainer
          ? HOST_CONTRACT_STATUS.UNAVAILABLE
          : scrollable
            ? HOST_CONTRACT_STATUS.READY
            : HOST_CONTRACT_STATUS.DEGRADED,
        required: true,
        containerDetected: Boolean(scrollContainer),
        scrollable,
        flexDirection: flexDirection || "unknown"
      }
    : {
        status: HOST_CONTRACT_STATUS.READY,
        required: false,
        containerDetected: Boolean(scrollContainer),
        scrollable,
        flexDirection: flexDirection || "unknown"
      };
  const turnsReport = isConversation
    ? {
        status: turns.length > 0 ? HOST_CONTRACT_STATUS.READY : HOST_CONTRACT_STATUS.UNKNOWN,
        required: true,
        visibleCount: turns.length,
        idMode: turnIdMode,
        fallbackIds: turnIdMode === "fallback" || turnIdMode === "mixed"
      }
    : {
        status: HOST_CONTRACT_STATUS.READY,
        required: false,
        visibleCount: turns.length,
        idMode: turnIdMode,
        fallbackIds: turnIdMode === "fallback" || turnIdMode === "mixed"
      };
  const composerReport = {
    status: composer
      ? HOST_CONTRACT_STATUS.READY
      : isNewChat
        ? HOST_CONTRACT_STATUS.UNAVAILABLE
        : isConversation
          ? HOST_CONTRACT_STATUS.DEGRADED
          : HOST_CONTRACT_STATUS.READY,
    required: isNewChat || isConversation,
    detected: Boolean(composer)
  };
  const navigation = isConversation
    ? {
        status: scroll.status === HOST_CONTRACT_STATUS.UNAVAILABLE
          || conversation.status === HOST_CONTRACT_STATUS.UNAVAILABLE
            ? HOST_CONTRACT_STATUS.UNAVAILABLE
            : turnsReport.status === HOST_CONTRACT_STATUS.READY
              ? HOST_CONTRACT_STATUS.READY
              : HOST_CONTRACT_STATUS.UNKNOWN,
        required: true
      }
    : { status: HOST_CONTRACT_STATUS.READY, required: false };
  const capture = {
    status: captureInstalled
      ? HOST_CONTRACT_STATUS.READY
      : HOST_CONTRACT_STATUS.OPTIONAL_UNAVAILABLE,
    required: false,
    installed: Boolean(captureInstalled),
    fetchAvailable: Boolean(fetchAvailable)
  };

  const required = [conversation, scroll, turnsReport, composerReport, navigation].filter((item) => item.required);
  const status = required.some((item) => item.status === HOST_CONTRACT_STATUS.UNAVAILABLE)
    ? HOST_CONTRACT_STATUS.UNAVAILABLE
    : required.some((item) => item.status === HOST_CONTRACT_STATUS.DEGRADED)
      ? HOST_CONTRACT_STATUS.DEGRADED
      : HOST_CONTRACT_STATUS.READY;

  return {
    revision: HOST_CONTRACT_REVISION,
    status,
    renderer,
    surface: surfaceReport,
    conversation,
    scroll,
    turns: turnsReport,
    composer: composerReport,
    navigation,
    capture
  };
}

export function classifyTurnIdMode(turns = []) {
  const ids = (Array.isArray(turns) ? turns : []).map((turn) => String(turn?.id ?? "")).filter(Boolean);
  if (!ids.length) return "unknown";
  const fallbackCount = ids.filter((id) => FALLBACK_TURN.test(id)).length;
  if (fallbackCount === ids.length) return "fallback";
  if (fallbackCount === 0) return "stable";
  return "mixed";
}

function readRendererScheme(location) {
  const protocol = String(location?.protocol ?? "").trim();
  if (protocol) return protocol;
  const href = String(location?.href ?? "").trim();
  const match = href.match(/^([a-z][a-z0-9+.-]*:)/i);
  return match?.[1]?.toLowerCase?.() ?? "";
}