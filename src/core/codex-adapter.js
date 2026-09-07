import { SELECTORS, SCROLL_MODEL } from "./constants.js";
import {
  closestAny,
  elementText,
  finiteNumber,
  parseTranslateOffset,
  queryAll,
  queryFirst,
  safeIsConnected,
  shortenText
} from "./dom-utils.js";
import {
  clamp,
  createScrollModel,
  scrollTopFromLogical
} from "./scroll-model.js";

const CONVERSATION_ID_ATTRIBUTES = [
  "data-thread-id",
  "data-conversation-id",
  "data-thread-key",
  "data-conversation-key"
];

const ORDER_ATTRIBUTES = ["data-index", "data-virtual-index", "data-turn-index", "aria-posinset"];
const SET_SIZE_ATTRIBUTES = ["aria-setsize", "data-set-size", "data-total-count"];

export class CodexAdapter {
  constructor({ document: documentRef = globalThis.document, window: windowRef = globalThis.window } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this._rootIds = new WeakMap();
    this._nextRootId = 1;
    this._lastContext = null;
  }

  getConversationRoot() {
    return queryFirst(this.document, SELECTORS.conversationRoots);
  }

  getScrollContainer(root = this.getConversationRoot()) {
    const candidates = [
      closestAny(root, SELECTORS.scrollContainers),
      queryFirst(root, SELECTORS.scrollContainers),
      queryFirst(this.document, SELECTORS.scrollContainers)
    ];
    return candidates.find((candidate) => safeIsConnected(candidate)) ?? null;
  }

  getPreferredEditor(scope = this.document) {
    const editors = queryAll(scope, SELECTORS.editors).filter((editor) => safeIsConnected(editor));
    const visible = editors.find((editor) => {
      const rect = editor.getBoundingClientRect?.();
      return rect && rect.width > 0 && rect.height > 0;
    });
    if (visible) return visible;
    if (editors[0]) return editors[0];
    const fallback = queryFirst(scope, SELECTORS.editors);
    return safeIsConnected(fallback) ? fallback : null;
  }

  getComposerRoot() {
    const editor = this.getPreferredEditor(this.document);
    if (editor) {
      const form = editor.closest?.("form") ?? null;
      if (safeIsConnected(form)) return form;
      const codexRoot = editor.closest?.("[data-codex-composer-root]") ?? null;
      if (safeIsConnected(codexRoot)) return codexRoot;
    }
    const direct = queryFirst(this.document, SELECTORS.composerRoots);
    return safeIsConnected(direct) ? direct : null;
  }

  getEditor(composerRoot = this.getComposerRoot()) {
    return this.getPreferredEditor(composerRoot ?? this.document);
  }

  getComposerMount(composerRoot = this.getComposerRoot(), editor = this.getEditor(composerRoot)) {
    if (!composerRoot) {
      return null;
    }
    const footer = queryFirst(composerRoot, SELECTORS.primaryComposerMounts);
    return {
      anchor: composerRoot,
      editor: safeIsConnected(editor) ? editor : null,
      footer: safeIsConnected(footer) ? footer : null,
      kind: "external"
    };
  }

  getConversationIdentity(root = this.getConversationRoot()) {
    if (!root) {
      return null;
    }

    for (const attribute of CONVERSATION_ID_ATTRIBUTES) {
      const value = root.getAttribute?.(attribute);
      if (value) {
        return `${attribute}:${value}`;
      }
    }

    let rootId = this._rootIds.get(root);
    if (!rootId) {
      rootId = `root:${this._nextRootId}`;
      this._nextRootId += 1;
      this._rootIds.set(root, rootId);
    }
    return rootId;
  }

  getContext() {
    const root = this.getConversationRoot();
    const scrollContainer = this.getScrollContainer(root);
    const composerRoot = this.getComposerRoot();
    const editor = this.getEditor(composerRoot);
    const mount = this.getComposerMount(composerRoot, editor);
    const context = {
      root,
      rootIdentity: this.getConversationIdentity(root),
      scrollContainer,
      composerRoot,
      editor,
      mount
    };
    this._lastContext = context;
    return context;
  }

  contextChanged(previous, next) {
    if (!previous) {
      return true;
    }
    return previous.root !== next.root
      || previous.rootIdentity !== next.rootIdentity
      || previous.scrollContainer !== next.scrollContainer
      || previous.composerRoot !== next.composerRoot
      || previous.editor !== next.editor
      || previous.mount?.anchor !== next.mount?.anchor
      || previous.mount?.footer !== next.mount?.footer
      || previous.mount?.container !== next.mount?.container
      || previous.mount?.before !== next.mount?.before;
  }

  readScrollBounds(container = this.getScrollContainer()) {
    if (!container) {
      return createScrollModel();
    }

    const computed = this.window?.getComputedStyle ? this.window.getComputedStyle(container) : null;
    const flexDirection = computed?.flexDirection ?? container.style?.flexDirection ?? "column";
    return createScrollModel({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      flexDirection
    });
  }

  getScrollBounds(container = this.getScrollContainer()) {
    return this.readScrollBounds(container);
  }

  getLogicalScrollPosition(container = this.getScrollContainer()) {
    return this.readScrollBounds(container).logicalPosition;
  }

  setLogicalScrollPosition(logicalPosition, { behavior = "auto", container = this.getScrollContainer() } = {}) {
    if (!container) {
      return null;
    }
    const model = this.readScrollBounds(container);
    const target = clamp(logicalPosition, model.minLogicalPosition, model.maxLogicalPosition);
    const top = scrollTopFromLogical(target, model.maxLogicalPosition, model.isColumnReverse);

    if (typeof container.scrollTo === "function") {
      try {
        container.scrollTo({ top, behavior });
      } catch {
        container.scrollTop = top;
      }
    } else {
      container.scrollTop = top;
    }
    return this.getLogicalScrollPosition(container);
  }

  getEarlierScrollStep(container = this.getScrollContainer(), factor = 0.9) {
    const model = this.readScrollBounds(container);
    const boundedFactor = clamp(Number(factor) || 0.9, 0.7, 1.2);
    return Math.max(1, Math.round(Math.max(1, model.clientHeight) * boundedFactor));
  }

  moveEarlier({
    behavior = "auto",
    container = this.getScrollContainer(),
    factor = 0.9
  } = {}) {
    if (!container) {
      return { ok: false, reason: "missing-scroll-context" };
    }

    const model = this.readScrollBounds(container);
    const from = model.logicalPosition;
    const step = this.getEarlierScrollStep(container, factor);
    const target = clamp(
      from - step,
      model.minLogicalPosition,
      model.maxLogicalPosition
    );
    const logicalPosition = this.setLogicalScrollPosition(target, { behavior, container });
    const moved = Math.abs(logicalPosition - from) > 0.5;
    return {
      ok: true,
      from,
      to: logicalPosition,
      step,
      moved,
      atBoundary: !moved && from <= model.minLogicalPosition
    };
  }

  getTurnElement(userMessage) {
    return closestAny(userMessage, SELECTORS.turnKeys);
  }

  getTurnKey(turnElement, userMessage = null) {
    const element = turnElement ?? this.getTurnElement(userMessage);
    if (!element) {
      return null;
    }
    return element.getAttribute?.("data-turn-id-container")
      ?? element.getAttribute?.("data-turn-id")
      ?? element.getAttribute?.("data-content-search-turn-key")
      ?? element.getAttribute?.("data-turn-key")
      ?? null;
  }

  readTurnMetadata(turnElement) {
    const metadata = {
      dataIndex: null,
      virtualIndex: null,
      turnIndex: null,
      ariaPosinset: null,
      ariaSetsize: null,
      translateOffset: null,
      rectTop: null,
      rectBottom: null
    };

    for (const attribute of ORDER_ATTRIBUTES) {
      const value = finiteNumber(turnElement?.getAttribute?.(attribute));
      if (value === null) {
        continue;
      }
      if (attribute === "data-index") metadata.dataIndex = value;
      if (attribute === "data-virtual-index") metadata.virtualIndex = value;
      if (attribute === "data-turn-index") metadata.turnIndex = value;
      if (attribute === "aria-posinset") metadata.ariaPosinset = value;
    }
    for (const attribute of SET_SIZE_ATTRIBUTES) {
      const value = finiteNumber(turnElement?.getAttribute?.(attribute));
      if (value !== null) {
        metadata.ariaSetsize = value;
        break;
      }
    }

    const inlineTransform = turnElement?.style?.transform;
    const computedTransform = this.window?.getComputedStyle && turnElement
      ? this.window.getComputedStyle(turnElement).transform
      : null;
    metadata.translateOffset = parseTranslateOffset(inlineTransform || computedTransform);

    const rect = turnElement?.getBoundingClientRect?.();
    if (rect) {
      metadata.rectTop = rect.top;
      metadata.rectBottom = rect.bottom;
    }
    return metadata;
  }

  inferLogicalOrder(metadata, domIndex) {
    return metadata.ariaPosinset
      ?? metadata.dataIndex
      ?? metadata.virtualIndex
      ?? metadata.turnIndex
      ?? domIndex;
  }

  getApproximatePosition(turnElement, container = this.getScrollContainer()) {
    if (!turnElement || !container) {
      return null;
    }
    const turnRect = turnElement.getBoundingClientRect?.();
    const containerRect = container.getBoundingClientRect?.();
    if (!turnRect || !containerRect) {
      return null;
    }
    return clamp(
      this.getLogicalScrollPosition(container) + (turnRect.top - containerRect.top) - SCROLL_MODEL.exactCorrectionOffset,
      0,
      this.getScrollBounds(container).maxLogicalPosition
    );
  }

  getRenderedUserTurns(root = this.getConversationRoot(), container = this.getScrollContainer(root)) {
    if (!root) {
      return [];
    }
    const userMessages = queryAll(root, SELECTORS.userMessages);
    const turns = [];
    const seenKeys = new Set();
    userMessages.forEach((userMessage, domIndex) => {
      const turnElement = this.getTurnElement(userMessage);
      const key = this.getTurnKey(turnElement, userMessage);
      if (!turnElement || !key || seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      const metadata = this.readTurnMetadata(turnElement);
      const text = elementText(userMessage) || elementText(turnElement);
      turns.push({
        key,
        text,
        shortText: shortenText(text),
        element: turnElement,
        rendered: true,
        approximatePosition: this.getApproximatePosition(turnElement, container),
        metadata,
        logicalOrder: this.inferLogicalOrder(metadata, domIndex)
      });
    });
    return turns;
  }

  findRenderedTurn(turnKey, root = this.getConversationRoot()) {
    if (!root || !turnKey) {
      return null;
    }
    return queryAll(root, SELECTORS.turnKeys).find((element) => this.getTurnKey(element) === turnKey) ?? null;
  }

  findRenderedUserTurn(turnKey, root = this.getConversationRoot()) {
    const turn = this.findRenderedTurn(turnKey, root);
    if (!turn) {
      return null;
    }
    return queryAll(turn, SELECTORS.userMessages)[0] ?? null;
  }

  isLiveTurnElement(element, turnKey) {
    return safeIsConnected(element) && this.getTurnKey(element) === turnKey;
  }

  getLiveTurnElement(turnKey, cachedElement = null) {
    return this.findRenderedTurn(turnKey)
      ?? (this.isLiveTurnElement(cachedElement, turnKey) ? cachedElement : null);
  }

  async waitForRenderedTurn(turnKey, { timeoutMs = 1200, intervalMs = 40 } = {}) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      const element = this.findRenderedTurn(turnKey);
      if (element) {
        return element;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  async settleLayoutFrame() {
    await new Promise((resolve) => {
      const requestFrame = this.window?.requestAnimationFrame;
      if (typeof requestFrame === "function") requestFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  exactScrollTarget(element, container) {
    const turnRect = element?.getBoundingClientRect?.();
    const containerRect = container?.getBoundingClientRect?.();
    if (!turnRect || !containerRect) return null;
    return this.getLogicalScrollPosition(container)
      + (turnRect.top - containerRect.top)
      - SCROLL_MODEL.exactCorrectionOffset;
  }

  async hydrateTurnAroundApproximate(record, container, timeoutMs, shouldContinue = () => true) {
    if (!Number.isFinite(record.approximatePosition)) return null;
    const model = this.getScrollBounds(container);
    const viewport = Math.max(1, Number(model.clientHeight) || Number(container.clientHeight) || 600);
    const offsets = [0, -0.55, 0.55, -1.1, 1.1, -1.8, 1.8].map((factor) => factor * viewport);
    const startedAt = Date.now();
    let probeIndex = 0;
    while (Date.now() - startedAt <= timeoutMs) {
      if (!shouldContinue()) return null;
      const live = this.findRenderedTurn(record.key);
      if (live) return live;
      if (probeIndex < offsets.length) {
        const target = clamp(record.approximatePosition + offsets[probeIndex], model.minLogicalPosition, model.maxLogicalPosition);
        this.setLogicalScrollPosition(target, { behavior: "auto", container });
        probeIndex += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    return null;
  }

  async scrollToTurn(record, { behavior = "auto", correctionTimeoutMs = 1800, shouldContinue = () => true } = {}) {
    const container = this.getScrollContainer();
    if (!container || !record) {
      return { ok: false, reason: "missing-scroll-context" };
    }

    let element = this.getLiveTurnElement(record.key, record.element);
    if (!element) {
      if (!Number.isFinite(record.approximatePosition)) {
        return { ok: false, reason: "missing-approximate-position" };
      }
      element = await this.hydrateTurnAroundApproximate(record, container, correctionTimeoutMs, shouldContinue);
    }

    if (!shouldContinue()) return { ok: false, reason: "superseded" };
    if (!element || !this.isLiveTurnElement(element, record.key)) {
      return { ok: false, reason: "virtualizer-hydration-timeout" };
    }

    let target = this.exactScrollTarget(element, container);
    if (!Number.isFinite(target)) {
      return { ok: false, reason: "missing-layout-rect" };
    }
    this.setLogicalScrollPosition(target, { behavior, container });

    await this.settleLayoutFrame();
    if (!shouldContinue()) return { ok: false, reason: "superseded" };
    const refreshed = this.getLiveTurnElement(record.key, element);
    if (refreshed) {
      const correctedTarget = this.exactScrollTarget(refreshed, container);
      if (Number.isFinite(correctedTarget)) {
        target = correctedTarget;
        this.setLogicalScrollPosition(correctedTarget, { behavior: "auto", container });
        element = refreshed;
      }
    }
    return { ok: true, corrected: true, element, target };
  }
}
