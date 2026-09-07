;(() => {
  const __modules = {
    "src/core/constants.js": (exports, __require) => {
      const VERSION = "0.2.0";

      const TIMELINE_MODE = "progressive";

      const STORAGE_KEYS = Object.freeze({
        prompts: "gpt-talk-enhancer.prompts.v1",
        settings: "gpt-talk-enhancer.settings.v1"
      });

      const SCROLL_MODEL = Object.freeze({
        composerFooterHeight: 114,
        exactCorrectionOffset: 12
      });

      const SELECTORS = Object.freeze({
        conversationRoots: [
          '[data-thread-find-target="conversation"]',
          '[data-chatgpt-conversation-selection-target="true"]'
        ],
        scrollContainers: [
          '[data-app-action-timeline-scroll]',
          '.thread-scroll-container'
        ],
        userMessages: [
          '[data-turn="user"][data-turn-id]',
          '[data-user-message-bubble="true"]',
          '[data-markdown-text-tone="user-message"]'
        ],
        turnKeys: [
          '[data-turn-id-container]',
          '[data-turn-id]',
          '[data-content-search-turn-key]',
          '[data-turn-key]'
        ],
        composerRoots: [
          'form[data-thread-find-composer="true"][data-composer-placement="thread"]',
          'form[data-thread-find-composer="true"]',
          '[data-codex-composer-root][data-composer-placement="thread"]',
          '[data-codex-composer-root]'
        ],
        editors: [
          '#prompt-textarea',
          '[data-thread-find-composer="true"] [contenteditable="true"][role="textbox"][data-composer-markdown]',
          '[contenteditable="true"][role="textbox"][aria-label="给 ChatGPT 发消息"]'
        ],
        primaryComposerMounts: [
          '[data-thread-find-composer="true"] [data-composer-footer-responsive]',
          '[data-composer-footer-responsive]'
        ],
        fallbackComposerAnchors: [
          'button[data-composer-navigation-target="add-context"]'
        ]
      });

      const OWNED_SELECTORS = Object.freeze({
        timeline: '[data-gte-component="timeline"]',
        promptButton: '[data-gte-component="prompt-button"]',
        promptPopup: '[data-gte-component="prompt-popup"]',
        toast: '[data-gte-component="toast"]'
      });

      const OWNED_CLASSES = Object.freeze({
        timeline: "gte-timeline",
        timelineExpanded: "gte-timeline--expanded",
        timelineCollapsed: "gte-timeline--collapsed",
        promptButton: "gte-prompt-button",
        promptPopup: "gte-prompt-popup",
        toast: "gte-toast"
      });

      exports["VERSION"] = VERSION;
      exports["TIMELINE_MODE"] = TIMELINE_MODE;
      exports["STORAGE_KEYS"] = STORAGE_KEYS;
      exports["SCROLL_MODEL"] = SCROLL_MODEL;
      exports["SELECTORS"] = SELECTORS;
      exports["OWNED_SELECTORS"] = OWNED_SELECTORS;
      exports["OWNED_CLASSES"] = OWNED_CLASSES;
      return exports;
    },
    "src/core/dom-utils.js": (exports, __require) => {
      function isElement(value) {
        return Boolean(value && value.nodeType === 1);
      }

      function toNodeArray(value) {
        if (value === null || value === undefined) {
          return [];
        }
        try {
          return Array.from(value);
        } catch {
          return [];
        }
      }

      function asElement(value) {
        if (isElement(value)) {
          return value;
        }
        return value?.parentElement && isElement(value.parentElement) ? value.parentElement : null;
      }

      function queryFirst(root, selectors) {
        if (!root || !Array.isArray(selectors)) {
          return null;
        }

        for (const selector of selectors) {
          try {
            if (isElement(root) && root.matches(selector)) {
              return root;
            }
            const match = root.querySelector(selector);
            if (match) {
              return match;
            }
          } catch {
            // A selector contract error must not stop the rest of the adapter refresh.
          }
        }

        return null;
      }

      function queryAll(root, selectors) {
        if (!root || !Array.isArray(selectors)) {
          return [];
        }

        const result = [];
        const seen = new Set();
        for (const selector of selectors) {
          try {
            if (isElement(root) && root.matches(selector) && !seen.has(root)) {
              result.push(root);
              seen.add(root);
            }
            for (const element of root.querySelectorAll(selector)) {
              if (!seen.has(element)) {
                result.push(element);
                seen.add(element);
              }
            }
          } catch {
            // Ignore a broken fallback selector while preserving other contract selectors.
          }
        }
        return result;
      }

      function matchesAny(element, selectors) {
        if (!isElement(element)) {
          return false;
        }
        return selectors.some((selector) => {
          try {
            return element.matches(selector);
          } catch {
            return false;
          }
        });
      }

      function containsAny(element, selectors) {
        if (!element) {
          return false;
        }
        if (matchesAny(element, selectors)) {
          return true;
        }
        try {
          return selectors.some((selector) => Boolean(element.querySelector(selector)));
        } catch {
          return false;
        }
      }

      function closestAny(element, selectors) {
        let current = asElement(element);
        while (current) {
          if (matchesAny(current, selectors)) {
            return current;
          }
          current = current.parentElement ?? null;
        }
        return null;
      }

      function normalizeText(value) {
        return String(value ?? "")
          .replace(/\u00a0/g, " ")
          .replace(/\r\n?/g, "\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n[ \t]+/g, "\n")
          .trim();
      }

      function shortenText(value, maxLength = 96) {
        const text = normalizeText(value);
        const graphemes = typeof Intl?.Segmenter === "function"
          ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment)
          : Array.from(text);
        if (graphemes.length <= maxLength) return text;
        return `${graphemes.slice(0, Math.max(0, maxLength - 1)).join("").trimEnd()}…`;
      }

      function elementText(element) {
        if (!element) {
          return "";
        }
        return normalizeText(typeof element.innerText === "string" ? element.innerText : element.textContent);
      }

      function finiteNumber(value) {
        if (value === null || value === undefined || value === "") {
          return null;
        }
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      }

      function parseTranslateOffset(transform) {
        const value = String(transform ?? "");
        const translateY = value.match(/translateY\(\s*(-?[\d.]+)(?:px)?\s*\)/i);
        if (translateY) {
          return Number(translateY[1]);
        }
        const translate3d = value.match(/translate3d\(\s*(-?[\d.]+)(?:px)?\s*[, ]\s*(-?[\d.]+)(?:px)?/i);
        if (translate3d) {
          return Number(translate3d[2]);
        }
        const translate = value.match(/translate\(\s*(-?[\d.]+)(?:px)?(?:\s*[, ]\s*(-?[\d.]+)(?:px)?)?\s*\)/i);
        if (translate) {
          return Number(translate[2] ?? translate[1]);
        }
        const matrix = value.match(/matrix(?:3d)?\(([^)]+)\)/i);
        if (matrix) {
          const values = matrix[1].split(",").map((item) => Number(item.trim()));
          if (values.length === 6 && Number.isFinite(values[5])) {
            return values[5];
          }
          if (values.length === 16 && Number.isFinite(values[13])) {
            return values[13];
          }
        }
        return null;
      }

      function safeIsConnected(element) {
        return Boolean(element && (element.isConnected === undefined || element.isConnected));
      }

      exports["isElement"] = isElement;
      exports["toNodeArray"] = toNodeArray;
      exports["asElement"] = asElement;
      exports["queryFirst"] = queryFirst;
      exports["queryAll"] = queryAll;
      exports["matchesAny"] = matchesAny;
      exports["containsAny"] = containsAny;
      exports["closestAny"] = closestAny;
      exports["normalizeText"] = normalizeText;
      exports["shortenText"] = shortenText;
      exports["elementText"] = elementText;
      exports["finiteNumber"] = finiteNumber;
      exports["parseTranslateOffset"] = parseTranslateOffset;
      exports["safeIsConnected"] = safeIsConnected;
      return exports;
    },
    "src/core/scroll-model.js": (exports, __require) => {
      function clamp(value, minimum, maximum) {
        return Math.min(Math.max(value, minimum), maximum);
      }

      function getMaxLogicalPosition(scrollHeight, clientHeight) {
        return Math.max(0, Number(scrollHeight || 0) - Number(clientHeight || 0));
      }

      function logicalFromScrollTop(scrollTop, maxLogicalPosition, isColumnReverse) {
        const max = Math.max(0, Number(maxLogicalPosition || 0));
        const physical = Number(scrollTop || 0);
        if (isColumnReverse) {
          return clamp(max + physical, 0, max);
        }
        return clamp(physical, 0, max);
      }

      function scrollTopFromLogical(logicalPosition, maxLogicalPosition, isColumnReverse) {
        const max = Math.max(0, Number(maxLogicalPosition || 0));
        const logical = clamp(Number(logicalPosition || 0), 0, max);
        if (isColumnReverse) {
          return logical - max;
        }
        return logical;
      }

      function createScrollModel({ scrollTop = 0, scrollHeight = 0, clientHeight = 0, flexDirection = "column" } = {}) {
        const isColumnReverse = flexDirection === "column-reverse";
        const maxLogicalPosition = getMaxLogicalPosition(scrollHeight, clientHeight);
        return Object.freeze({
          scrollTop: Number(scrollTop || 0),
          scrollHeight: Number(scrollHeight || 0),
          clientHeight: Number(clientHeight || 0),
          flexDirection,
          isColumnReverse,
          minLogicalPosition: 0,
          maxLogicalPosition,
          logicalPosition: logicalFromScrollTop(scrollTop, maxLogicalPosition, isColumnReverse),
          minScrollTop: isColumnReverse ? -maxLogicalPosition : 0,
          maxScrollTop: isColumnReverse ? 0 : maxLogicalPosition
        });
      }

      exports["clamp"] = clamp;
      exports["getMaxLogicalPosition"] = getMaxLogicalPosition;
      exports["logicalFromScrollTop"] = logicalFromScrollTop;
      exports["scrollTopFromLogical"] = scrollTopFromLogical;
      exports["createScrollModel"] = createScrollModel;
      return exports;
    },
    "src/core/codex-adapter.js": (exports, __require) => {
      const { SELECTORS, SCROLL_MODEL } = __require("src/core/constants.js");
      const { closestAny, elementText, finiteNumber, parseTranslateOffset, queryAll, queryFirst, safeIsConnected, shortenText } = __require("src/core/dom-utils.js");
      const { clamp, createScrollModel, scrollTopFromLogical } = __require("src/core/scroll-model.js");
      const CONVERSATION_ID_ATTRIBUTES = [
        "data-thread-id",
        "data-conversation-id",
        "data-thread-key",
        "data-conversation-key"
      ];

      const ORDER_ATTRIBUTES = ["data-index", "data-virtual-index", "data-turn-index", "aria-posinset"];
      const SET_SIZE_ATTRIBUTES = ["aria-setsize", "data-set-size", "data-total-count"];

      class CodexAdapter {
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

      exports["CodexAdapter"] = CodexAdapter;
      return exports;
    },
    "src/core/turn-registry.js": (exports, __require) => {
      const { shortenText } = __require("src/core/dom-utils.js");
      class TurnRegistry {
        constructor({ clock = () => Date.now() } = {}) {
          this.clock = clock;
          this.records = new Map();
          this.conversationId = null;
          this.sequence = 0;
        }

        setConversation(conversationId) {
          if (this.conversationId === conversationId) {
            return false;
          }
          this.conversationId = conversationId;
          this.records.clear();
          this.sequence = 0;
          return true;
        }

        clear() {
          this.records.clear();
          this.sequence = 0;
        }

        upsert(input, now = this.clock()) {
          if (!input?.key) {
            return null;
          }

          const previous = this.records.get(input.key);
          const hasOrder = Number.isFinite(input.logicalOrder);
          const record = previous ?? {
            key: String(input.key),
            text: "",
            shortText: "",
            element: null,
            rendered: false,
            approximatePosition: null,
            discoveredAt: now,
            lastSeenAt: now,
            logicalOrder: this.sequence++
          };

          if (input.text !== undefined) record.text = String(input.text);
          if (input.shortText !== undefined) record.shortText = String(input.shortText);
          else if (input.text !== undefined) record.shortText = shortenText(input.text);
          if (input.element !== undefined) record.element = input.element;
          if (input.approximatePosition !== undefined) record.approximatePosition = input.approximatePosition;
          if (hasOrder) record.logicalOrder = input.logicalOrder;
          if (input.rendered !== undefined) record.rendered = Boolean(input.rendered);
          else if (input.element !== undefined) record.rendered = Boolean(input.element);
          if (record.rendered) record.lastSeenAt = now;

          this.records.set(record.key, record);
          return record;
        }

        syncRendered(turns, now = this.clock()) {
          const seenKeys = new Set();
          for (const turn of turns ?? []) {
            if (!turn?.key) continue;
            seenKeys.add(String(turn.key));
            this.upsert({ ...turn, rendered: true }, now);
          }

          for (const record of this.records.values()) {
            if (!seenKeys.has(record.key)) {
              record.rendered = false;
              record.element = null;
            }
          }
          return this.getUserRecords();
        }

        markUnrendered(turnKey) {
          const record = this.records.get(turnKey);
          if (!record) {
            return false;
          }
          record.rendered = false;
          record.element = null;
          return true;
        }

        get(turnKey) {
          return this.records.get(turnKey) ?? null;
        }

        getAll() {
          return [...this.records.values()].sort(compareRecords);
        }

        getUserRecords() {
          return this.getAll();
        }

        getRenderedRecords() {
          return this.getAll().filter((record) => record.rendered && record.element);
        }

        get size() {
          return this.records.size;
        }
      }

      function compareRecords(left, right) {
        const leftOrder = Number.isFinite(left.logicalOrder) ? left.logicalOrder : Number.MAX_SAFE_INTEGER;
        const rightOrder = Number.isFinite(right.logicalOrder) ? right.logicalOrder : Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        if (left.discoveredAt !== right.discoveredAt) return left.discoveredAt - right.discoveredAt;
        return left.key.localeCompare(right.key);
      }

      exports["TurnRegistry"] = TurnRegistry;
      return exports;
    },
    "src/core/rendered-tracker.js": (exports, __require) => {
      class RenderedTracker {
        constructor({ adapter, registry, onChange = () => {}, clock = () => Date.now() } = {}) {
          this.adapter = adapter;
          this.registry = registry;
          this.onChange = onChange;
          this.clock = clock;
          this.root = null;
          this.scrollContainer = null;
          this.lastTurns = [];
          this.lastFingerprint = null;
          this.refreshCount = 0;
          this.changeCount = 0;
          this.disposed = false;
        }

        bind(root, scrollContainer) {
          this.root = root;
          this.scrollContainer = scrollContainer;
          this.lastFingerprint = null;
          this.disposed = false;
          return this.refresh("bind");
        }

        refresh(reason = "manual") {
          if (this.disposed || !this.root) {
            return [];
          }
          this.refreshCount += 1;
          this.lastTurns = this.adapter.getRenderedUserTurns(this.root, this.scrollContainer);
          const records = this.registry.syncRendered(this.lastTurns, this.clock());
          const fingerprint = this.lastTurns.map((turn) => [
            turn.key,
            turn.text,
            turn.logicalOrder
          ]).map((part) => JSON.stringify(part)).join("|");
          const changed = fingerprint !== this.lastFingerprint;
          this.lastFingerprint = fingerprint;
          if (changed) {
            this.changeCount += 1;
            this.onChange({ reason, turns: this.lastTurns, records });
          }
          return records;
        }

        getRenderedTurns() {
          return [...this.lastTurns];
        }

        dispose() {
          this.disposed = true;
          this.root = null;
          this.scrollContainer = null;
          this.lastTurns = [];
          this.lastFingerprint = null;
        }

        status() {
          return {
            bound: Boolean(this.root),
            refreshCount: this.refreshCount,
            changeCount: this.changeCount,
            renderedCount: this.lastTurns.length
          };
        }
      }

      exports["RenderedTracker"] = RenderedTracker;
      return exports;
    },
    "src/core/conversation-observer.js": (exports, __require) => {
      const { SELECTORS } = __require("src/core/constants.js");
      const { asElement, containsAny, closestAny, isElement, toNodeArray } = __require("src/core/dom-utils.js");
      class ConversationObserver {
        constructor({ root = null, tracker, document: documentRef = globalThis.document, window: windowRef = globalThis.window } = {}) {
          this.root = null;
          this.tracker = tracker;
          this.document = documentRef;
          this.window = windowRef;
          this.observer = null;
          this.frame = null;
          this.mutationCount = 0;
          if (root) {
            this.bind(root);
          }
        }

        bind(root) {
          this.disposeObserver();
          this.root = root;
          const MutationObserverCtor = globalThis.MutationObserver ?? this.window?.MutationObserver;
          if (!root || !MutationObserverCtor) {
            return false;
          }

          this.observer = new MutationObserverCtor((mutations) => {
            if (!mutations.some((mutation) => this.isRelevantMutation(mutation))) {
              return;
            }
            this.mutationCount += mutations.length;
            this.scheduleRefresh();
          });
          this.observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true
          });
          return true;
        }

        isRelevantMutation(mutation) {
          if (!mutation) {
            return false;
          }
          const target = asElement(mutation.target);
          if (mutation.type === "characterData") {
            return Boolean(closestAny(target, SELECTORS.userMessages));
          }
          if (mutation.type !== "childList") {
            return false;
          }

          if (closestAny(target, SELECTORS.userMessages)) {
            return true;
          }

          for (const node of [...toNodeArray(mutation.addedNodes), ...toNodeArray(mutation.removedNodes)]) {
            if (containsAny(node, SELECTORS.userMessages)) {
              return true;
            }
            if (isElement(node) && closestAny(node, SELECTORS.userMessages)) {
              return true;
            }
          }
          return false;
        }

        scheduleRefresh() {
          if (this.frame !== null || !this.tracker) {
            return;
          }
          const requestFrame = this.window?.requestAnimationFrame;
          if (typeof requestFrame === "function") {
            this.frame = requestFrame(() => {
              this.frame = null;
              this.tracker.refresh("user-turn-mutation");
            });
            return;
          }
          this.frame = setTimeout(() => {
            this.frame = null;
            this.tracker.refresh("user-turn-mutation");
          }, 0);
        }

        disposeObserver() {
          if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
          }
          if (this.frame !== null) {
            if (this.window?.cancelAnimationFrame && typeof this.frame === "number") {
              this.window.cancelAnimationFrame(this.frame);
            } else {
              clearTimeout(this.frame);
            }
            this.frame = null;
          }
        }

        dispose() {
          this.disposeObserver();
          this.root = null;
        }

        status() {
          return {
            bound: Boolean(this.root),
            observerActive: Boolean(this.observer),
            mutationCount: this.mutationCount
          };
        }
      }

      exports["ConversationObserver"] = ConversationObserver;
      return exports;
    },
    "src/core/root-observer.js": (exports, __require) => {
      const { SELECTORS } = __require("src/core/constants.js");
      const { containsAny, isElement, matchesAny, toNodeArray } = __require("src/core/dom-utils.js");
      const ROOT_OBSERVER_SELECTORS = [
        ...SELECTORS.conversationRoots,
        ...SELECTORS.scrollContainers,
        ...SELECTORS.composerRoots,
        ...SELECTORS.editors,
        ...SELECTORS.primaryComposerMounts,
        ...SELECTORS.fallbackComposerAnchors
      ];

      const ROOT_OBSERVER_ATTRIBUTES = [
        "data-thread-find-target",
        "data-chatgpt-conversation-selection-target",
        "data-app-action-timeline-scroll",
        "data-thread-find-composer",
        "data-composer-placement",
        "data-codex-composer-root",
        "data-composer-footer-responsive",
        "data-composer-navigation-target",
        "data-composer-markdown",
        "data-thread-id",
        "data-conversation-id",
        "data-thread-key",
        "data-conversation-key",
        "contenteditable",
        "role"
      ];

      class RootObserver {
        constructor({ adapter, onContextChange = () => {}, document: documentRef = globalThis.document, window: windowRef = globalThis.window } = {}) {
          this.adapter = adapter;
          this.onContextChange = onContextChange;
          this.document = documentRef;
          this.window = windowRef;
          this.observer = null;
          this.frame = null;
          this.lastContext = null;
          this.disposed = false;
        }

        start() {
          this.dispose();
          this.disposed = false;
          const target = this.document ?? this.document?.documentElement;
          const MutationObserverCtor = this.window?.MutationObserver ?? globalThis.MutationObserver;
          if (!target || !MutationObserverCtor) {
            this.refresh();
            return false;
          }

          this.observer = new MutationObserverCtor((mutations) => {
            if (mutations.some((mutation) => this.isRelevantMutation(mutation))) this.scheduleRefresh();
          });
          this.observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ROOT_OBSERVER_ATTRIBUTES
          });
          this.refresh();
          return true;
        }

        isRelevantMutation(mutation) {
          if (!mutation) return false;
          const current = this.lastContext;
          const target = isElement(mutation.target) ? mutation.target : null;

          if (mutation.type === "attributes") {
            if (!target) return false;
            if (current && (target === current.root
              || target === current.scrollContainer
              || target === current.composerRoot
              || target === current.editor
              || target === current.mount?.anchor
              || target === current.mount?.container)) {
              return true;
            }
            return matchesAny(target, ROOT_OBSERVER_SELECTORS) || containsAny(target, ROOT_OBSERVER_SELECTORS);
          }

          if (mutation.type !== "childList") return false;
          const addedNodes = toNodeArray(mutation.addedNodes);
          const removedNodes = toNodeArray(mutation.removedNodes);
          if (current && removedNodes.some((node) => node === current.root
            || node === current.scrollContainer
            || node === current.composerRoot
            || node === current.editor
            || node === current.mount?.anchor
            || node === current.mount?.container)) {
            return true;
          }

          return [...addedNodes, ...removedNodes]
            .some((node) => isElement(node) && (matchesAny(node, ROOT_OBSERVER_SELECTORS) || containsAny(node, ROOT_OBSERVER_SELECTORS)));
        }

        scheduleRefresh() {
          if (this.frame !== null || this.disposed) return;
          const requestFrame = this.window?.requestAnimationFrame;
          if (typeof requestFrame === "function") {
            this.frame = requestFrame(() => {
              this.frame = null;
              this.refresh();
            });
            return;
          }
          this.frame = setTimeout(() => {
            this.frame = null;
            this.refresh();
          }, 0);
        }

        refresh() {
          if (this.disposed || !this.adapter) return null;
          const context = this.adapter.getContext();
          const changed = this.adapter.contextChanged(this.lastContext, context);
          this.lastContext = context;
          this.onContextChange(context, { changed });
          return context;
        }

        dispose() {
          this.disposed = true;
          this.observer?.disconnect?.();
          this.observer = null;
          if (this.frame !== null) {
            if (this.window?.cancelAnimationFrame && typeof this.frame === "number") this.window.cancelAnimationFrame(this.frame);
            else clearTimeout(this.frame);
            this.frame = null;
          }
          this.lastContext = null;
        }

        status() {
          return {
            observerActive: Boolean(this.observer),
            reconciliationActive: false,
            eventDriven: true,
            bound: Boolean(this.lastContext)
          };
        }
      }
      exports["RootObserver"] = RootObserver;
      return exports;
    },
    "src/core/active-tracker.js": (exports, __require) => {
      const { SCROLL_MODEL } = __require("src/core/constants.js");
      const { safeIsConnected } = __require("src/core/dom-utils.js");
      class ActiveTracker {
        constructor({ adapter, registry, onActiveChange = () => {}, document: documentRef = globalThis.document, window: windowRef = globalThis.window, footerHeight = SCROLL_MODEL.composerFooterHeight } = {}) {
          this.adapter = adapter;
          this.registry = registry;
          this.onActiveChange = onActiveChange;
          this.document = documentRef;
          this.window = windowRef;
          this.footerHeight = footerHeight;
          this.scrollContainer = null;
          this.intersectionObserver = null;
          this.scrollHandler = null;
          this.frame = null;
          this.activeKey = null;
          this.observedElements = new Set();
          this.disposed = false;
        }

        bind(scrollContainer) {
          this.dispose();
          this.disposed = false;
          this.scrollContainer = safeIsConnected(scrollContainer) ? scrollContainer : null;
          if (!this.scrollContainer) {
            return;
          }

          const IntersectionObserverCtor = this.window?.IntersectionObserver ?? globalThis.IntersectionObserver;
          if (IntersectionObserverCtor) {
            try {
              this.intersectionObserver = new IntersectionObserverCtor(
                () => this.scheduleUpdate(),
                {
                  root: scrollContainer,
                  rootMargin: `0px 0px -${this.footerHeight}px 0px`,
                  threshold: [0, 0.25, 0.5, 0.75, 1]
                }
              );
            } catch {
              this.intersectionObserver = null;
            }
          }

          this.scrollHandler = () => this.scheduleUpdate();
          scrollContainer.addEventListener?.("scroll", this.scrollHandler, { passive: true });
          this.refresh();
        }

        refresh() {
          if (!this.scrollContainer || this.disposed) {
            return null;
          }
          const records = this.registry?.getRenderedRecords?.() ?? [];
          if (this.intersectionObserver) {
            const nextElements = new Set(records
              .map((record) => record.element)
              .filter((element) => safeIsConnected(element)));
            for (const element of this.observedElements) {
              if (!nextElements.has(element)) this.intersectionObserver.unobserve?.(element);
            }
            for (const element of nextElements) {
              if (this.observedElements.has(element)) continue;
              try {
                this.intersectionObserver.observe(element);
              } catch {
                // Virtualized elements may detach between registry refresh and observe.
              }
            }
            this.observedElements = nextElements;
          }
          return this.updateFromGeometry();
        }

        scheduleUpdate() {
          if (this.frame !== null || this.disposed) {
            return;
          }
          const requestFrame = this.window?.requestAnimationFrame;
          if (typeof requestFrame === "function") {
            this.frame = requestFrame(() => {
              this.frame = null;
              this.updateFromGeometry();
            });
            return;
          }
          this.frame = setTimeout(() => {
            this.frame = null;
            this.updateFromGeometry();
          }, 0);
        }

        updateFromGeometry() {
          if (!this.scrollContainer || this.disposed) {
            return null;
          }
          const containerRect = this.scrollContainer.getBoundingClientRect?.();
          if (!containerRect) {
            return null;
          }
          const contentBottom = containerRect.bottom - this.footerHeight;
          const usableHeight = Math.max(1, contentBottom - containerRect.top);
          const activationLine = containerRect.top + Math.min(140, Math.max(72, usableHeight * 0.22));
          let beforeLine = null;
          let afterLine = null;

          for (const record of this.registry?.getRenderedRecords?.() ?? []) {
            if (!safeIsConnected(record.element)) continue;
            if (typeof this.adapter?.getTurnKey === "function"
              && this.adapter.getTurnKey(record.element) !== record.key) continue;
            const rect = record.element?.getBoundingClientRect?.();
            if (!rect || rect.top >= contentBottom) continue;
            const candidate = { record, rect };
            if (rect.top <= activationLine) {
              if (!beforeLine || rect.top > beforeLine.rect.top) beforeLine = candidate;
            } else if (!afterLine || rect.top < afterLine.rect.top) {
              afterLine = candidate;
            }
          }

          const nextKey = (beforeLine ?? afterLine)?.record.key ?? null;
          if (nextKey !== this.activeKey) {
            this.activeKey = nextKey;
            this.onActiveChange(nextKey);
          }
          return nextKey;
        }

        setActiveKey(key, { notify = false } = {}) {
          this.activeKey = key ?? null;
          if (notify) this.onActiveChange(this.activeKey);
        }

        dispose() {
          this.disposed = true;
          if (this.scrollContainer && this.scrollHandler) {
            this.scrollContainer.removeEventListener?.("scroll", this.scrollHandler);
          }
          this.intersectionObserver?.disconnect?.();
          this.intersectionObserver = null;
          this.observedElements.clear();
          if (this.frame !== null) {
            if (this.window?.cancelAnimationFrame && typeof this.frame === "number") {
              this.window.cancelAnimationFrame(this.frame);
            } else {
              clearTimeout(this.frame);
            }
            this.frame = null;
          }
          this.scrollContainer = null;
          this.scrollHandler = null;
          this.activeKey = null;
        }

        status() {
          const bound = !this.disposed && safeIsConnected(this.scrollContainer);
          return {
            bound,
            intersectionObserverActive: bound && Boolean(this.intersectionObserver),
            activeKey: this.activeKey,
            observedCount: this.observedElements.size
          };
        }
      }

      exports["ActiveTracker"] = ActiveTracker;
      return exports;
    },
    "src/core/timeline-renderer.js": (exports, __require) => {
      const { OWNED_CLASSES, OWNED_SELECTORS, TIMELINE_MODE } = __require("src/core/constants.js");
      const { shortenText } = __require("src/core/dom-utils.js");
      const RAIL_MIN_GAP = 30;
      const RAIL_MAX_MARKERS = 28;
      const RAIL_FALLBACK_CAPACITY = 18;

      const TIMELINE_STYLE = `
      .gte-timeline,
      .gte-timeline * {
        box-sizing: border-box;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .gte-timeline {
        --gte-timeline-accent: #8b5cf6;
        --gte-timeline-text: light-dark(rgba(31, 31, 35, .92), rgba(244, 244, 245, .94));
        --gte-timeline-muted: light-dark(rgba(63, 63, 70, .58), rgba(212, 212, 216, .58));
        --gte-timeline-faint: light-dark(rgba(63, 63, 70, .18), rgba(228, 228, 231, .18));
        --gte-timeline-border: light-dark(rgba(24, 24, 27, .08), rgba(255, 255, 255, .09));
        --gte-timeline-soft: light-dark(rgba(24, 24, 27, .045), rgba(255, 255, 255, .055));
        position: fixed;
        top: 84px;
        right: 14px;
        bottom: 104px;
        z-index: 2147482900;
        width: 28px;
        color: var(--gte-timeline-text);
        pointer-events: none;
        color-scheme: light dark;
        isolation: isolate;
      }
      .gte-timeline--expanded { width: min(296px, calc(100vw - 24px)); }
      .gte-timeline__rail {
        position: absolute;
        inset: 0 0 0 auto;
        z-index: 2;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 28px;
        min-height: 176px;
        padding: 5px 0;
        overflow: visible;
        border: 1px solid var(--gte-timeline-border);
        border-radius: 13px;
        background: light-dark(rgba(248, 248, 250, .78), rgba(36, 36, 39, .80));
        box-shadow: 0 3px 14px rgba(0, 0, 0, .10), inset 0 0 0 1px light-dark(rgba(255,255,255,.40), rgba(255,255,255,.025));
        backdrop-filter: blur(10px) saturate(125%);
        -webkit-backdrop-filter: blur(10px) saturate(125%);
        pointer-events: auto;
      }
      .gte-timeline__earlier,
      .gte-timeline__toggle {
        position: relative;
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        min-height: 26px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        color: var(--gte-timeline-muted);
        background: transparent;
        cursor: pointer;
        font: inherit;
        font-size: 15px;
        line-height: 1;
        pointer-events: auto;
      }
      .gte-timeline__earlier:hover,
      .gte-timeline__earlier:focus-visible,
      .gte-timeline__toggle:hover,
      .gte-timeline__toggle:focus-visible {
        color: var(--gte-timeline-text);
        background: var(--gte-timeline-soft);
        outline: none;
      }
      .gte-timeline__earlier--loading .gte-timeline__earlier-icon { animation: gte-timeline-spin 850ms linear infinite; }
      .gte-timeline__earlier--exhausted { color: var(--gte-timeline-faint); }
      .gte-timeline__track {
        position: relative;
        flex: 1 1 auto;
        width: 28px;
        min-height: 96px;
        margin: 4px 0;
        overflow: visible;
      }
      .gte-timeline__track-line {
        position: absolute;
        top: 10px;
        bottom: 10px;
        left: 50%;
        width: 1px;
        background: linear-gradient(to bottom, transparent, var(--gte-timeline-faint) 12%, var(--gte-timeline-faint) 88%, transparent);
        opacity: .55;
        pointer-events: none;
      }
      .gte-timeline__track-empty {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--gte-timeline-faint);
        transform: translate(-50%, -50%);
      }
      .gte-timeline__node {
        position: absolute;
        left: 50%;
        width: 30px;
        height: 30px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        color: inherit;
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
        touch-action: manipulation;
        transform: translate(-50%, -50%);
        -webkit-tap-highlight-color: transparent;
      }
      .gte-timeline__node:focus-visible { outline: 1px solid rgba(139, 92, 246, .58); outline-offset: -2px; }
      .gte-timeline__node-dot {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: light-dark(rgba(82, 82, 91, .46), rgba(212, 212, 216, .48));
        transform: translate(-50%, -50%);
        pointer-events: none;
        transition: transform 120ms ease, background 120ms ease, box-shadow 120ms ease;
      }
      .gte-timeline__node:hover .gte-timeline__node-dot,
      .gte-timeline__node:focus-visible .gte-timeline__node-dot {
        background: light-dark(rgba(63, 63, 70, .74), rgba(244, 244, 245, .80));
        transform: translate(-50%, -50%) scale(1.35);
      }
      .gte-timeline__node--active .gte-timeline__node-dot {
        width: 6px;
        height: 6px;
        background: var(--gte-timeline-accent);
        box-shadow: 0 0 0 4px rgba(139, 92, 246, .18);
      }
      .gte-timeline__earlier::after,
      .gte-timeline__node::after {
        position: absolute;
        top: 50%;
        right: calc(100% + 9px);
        z-index: 8;
        width: max-content;
        max-width: min(300px, calc(100vw - 86px));
        padding: 8px 10px;
        border: 1px solid var(--gte-timeline-border);
        border-radius: 10px;
        color: var(--gte-timeline-text);
        background: light-dark(rgba(255, 255, 255, .97), rgba(31, 31, 35, .97));
        box-shadow: 0 8px 24px rgba(0, 0, 0, .16);
        content: attr(data-tooltip);
        font-size: 12px;
        font-weight: 450;
        line-height: 1.45;
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(-50%) translateX(4px);
        transition: opacity 120ms ease, visibility 120ms ease, transform 120ms ease;
      }
      .gte-timeline__earlier::before,
      .gte-timeline__node::before {
        position: absolute;
        top: 50%;
        right: calc(100% + 4px);
        z-index: 9;
        width: 7px;
        height: 7px;
        border-top: 1px solid var(--gte-timeline-border);
        border-right: 1px solid var(--gte-timeline-border);
        background: light-dark(rgba(255, 255, 255, .97), rgba(31, 31, 35, .97));
        content: "";
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(-50%) rotate(45deg);
        transition: opacity 120ms ease, visibility 120ms ease;
      }
      .gte-timeline__earlier:hover::after,
      .gte-timeline__earlier:focus-visible::after,
      .gte-timeline__node:hover::after,
      .gte-timeline__node:focus-visible::after,
      .gte-timeline__earlier:hover::before,
      .gte-timeline__earlier:focus-visible::before,
      .gte-timeline__node:hover::before,
      .gte-timeline__node:focus-visible::before { opacity: 1; visibility: visible; }
      .gte-timeline__earlier:hover::after,
      .gte-timeline__earlier:focus-visible::after,
      .gte-timeline__node:hover::after,
      .gte-timeline__node:focus-visible::after { transform: translateY(-50%) translateX(0); }
      .gte-timeline--expanded .gte-timeline__earlier::after,
      .gte-timeline--expanded .gte-timeline__earlier::before,
      .gte-timeline--expanded .gte-timeline__node::after,
      .gte-timeline--expanded .gte-timeline__node::before { display: none; }
      .gte-timeline__node::after,
      .gte-timeline__node::before { display: none; }
      .gte-timeline__rail-tooltip {
        position: absolute;
        right: calc(100% + 9px);
        z-index: 12;
        width: max-content;
        max-width: min(300px, calc(100vw - 86px));
        padding: 8px 10px;
        border: 1px solid var(--gte-timeline-border);
        border-radius: 10px;
        color: var(--gte-timeline-text);
        background: light-dark(rgba(255, 255, 255, .97), rgba(31, 31, 35, .97));
        box-shadow: 0 8px 24px rgba(0, 0, 0, .16);
        font-size: 12px;
        font-weight: 450;
        line-height: 1.45;
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transform: translateY(-50%) translateX(4px);
        transition: opacity 120ms ease, visibility 120ms ease, transform 120ms ease;
      }
      .gte-timeline__rail-tooltip::before {
        position: absolute;
        top: 50%;
        left: 100%;
        width: 7px;
        height: 7px;
        border-top: 1px solid var(--gte-timeline-border);
        border-right: 1px solid var(--gte-timeline-border);
        background: inherit;
        content: "";
        transform: translate(-4px, -50%) rotate(45deg);
      }
      .gte-timeline__rail-tooltip--visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(-50%) translateX(0);
      }
      .gte-timeline--expanded .gte-timeline__rail-tooltip { display: none; }
      .gte-timeline__panel {
        position: absolute;
        top: 0;
        right: 36px;
        bottom: 0;
        z-index: 1;
        display: flex;
        flex-direction: column;
        width: 260px;
        min-width: 0;
        overflow: hidden;
        border: 1px solid var(--gte-timeline-border);
        border-radius: 14px;
        color: var(--gte-timeline-text);
        background: light-dark(rgba(255, 255, 255, .95), rgba(31, 31, 35, .96));
        box-shadow: 0 14px 40px rgba(0, 0, 0, .18), 0 2px 8px rgba(0, 0, 0, .08);
        backdrop-filter: blur(14px) saturate(135%);
        -webkit-backdrop-filter: blur(14px) saturate(135%);
        pointer-events: auto;
      }
      .gte-timeline__header {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 44px;
        padding: 9px 11px 8px 13px;
        border-bottom: 1px solid light-dark(rgba(24, 24, 27, .055), rgba(255, 255, 255, .065));
      }
      .gte-timeline__title {
        position: relative;
        min-width: 0;
        padding-bottom: 5px;
        overflow: hidden;
        font-size: 13px;
        font-weight: 680;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .gte-timeline__title::after {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 30px;
        height: 2px;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--gte-timeline-accent), rgba(139, 92, 246, .16));
        content: "";
      }
      .gte-timeline__count {
        min-width: 24px;
        padding: 2px 7px;
        border-radius: 999px;
        color: var(--gte-timeline-muted);
        background: var(--gte-timeline-soft);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        text-align: center;
      }
      .gte-timeline__list {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 2px;
        min-height: 0;
        padding: 6px;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: light-dark(rgba(63,63,70,.20), rgba(244,244,245,.18)) transparent;
        pointer-events: auto;
      }
      .gte-timeline__item {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 12px minmax(0, 1fr);
        gap: 6px;
        align-items: center;
        width: 100%;
        min-height: 40px;
        margin: 0;
        padding: 7px 8px;
        border: 1px solid transparent;
        border-radius: 9px;
        color: inherit;
        background: transparent;
        text-align: left;
        cursor: pointer;
        pointer-events: auto;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        transition: background 110ms ease, border-color 110ms ease;
      }
      .gte-timeline__item:hover,
      .gte-timeline__item:focus-visible {
        border-color: rgba(139, 92, 246, .10);
        background: var(--gte-timeline-soft);
        outline: none;
      }
      .gte-timeline__item:focus-visible { box-shadow: inset 0 0 0 1px rgba(139, 92, 246, .34); }
      .gte-timeline__item--active { border-color: rgba(139, 92, 246, .13); background: rgba(139, 92, 246, .085); }
      .gte-timeline__dot {
        width: 6px;
        height: 6px;
        margin-left: 2px;
        border-radius: 50%;
        background: var(--gte-timeline-faint);
        pointer-events: none;
      }
      .gte-timeline__item--active .gte-timeline__dot {
        background: var(--gte-timeline-accent);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, .15);
      }
      .gte-timeline__item-text {
        min-width: 0;
        overflow: hidden;
        font-size: 12px;
        line-height: 1.4;
        text-overflow: clip;
        white-space: nowrap;
        pointer-events: none;
      }
      .gte-timeline__empty,
      .gte-timeline__status { color: var(--gte-timeline-muted); font-size: 11px; line-height: 1.45; pointer-events: none; }
      .gte-timeline__empty { padding: 22px 12px; text-align: center; }
      .gte-timeline__status {
        flex: 0 0 auto;
        padding: 7px 10px 8px;
        overflow: hidden;
        border-top: 1px solid light-dark(rgba(24,24,27,.045), rgba(255,255,255,.055));
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: .72;
      }
      /* GPL-derived Question List Panel styling from houyanchao/chatgpt-gemini-timeline. */
      .ait-question-list-popup {
        width: 250px;
        background: light-dark(#fff, #2c2c2e);
        border: 1px solid light-dark(rgba(0,0,0,.12), rgba(255,255,255,.08));
        border-radius: 10px;
        box-shadow: light-dark(0 12px 40px rgba(0,0,0,.12), 0 12px 40px rgba(0,0,0,.4));
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: ait-ql-in .18s cubic-bezier(.16,1,.3,1);
        -webkit-font-smoothing: antialiased;
      }
      @keyframes ait-ql-in { from { opacity:0; transform:scale(.96) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }
      .ait-ql-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:10px 8px 10px 12px;
        border-bottom:1px solid light-dark(rgba(0,0,0,.06),rgba(255,255,255,.06));
        flex-shrink:0;
      }
      .ait-ql-title { font-size:13px; font-weight:600; letter-spacing:-.01em; }
      .ait-ql-list { flex:1; overflow-y:auto; overflow-x:hidden; padding:4px 2px; overscroll-behavior:contain; }
      .ait-ql-list::-webkit-scrollbar { width:8px; }
      .ait-ql-list::-webkit-scrollbar-thumb { background:light-dark(rgba(0,0,0,.2),rgba(255,255,255,.2)); border-radius:10px; }
      .ait-ql-item {
        display:flex; align-items:center; gap:6px;
        min-height:0; padding:6px 4px 6px 8px; margin:0 0 1px;
        border:0; border-radius:6px; background:transparent;
        cursor:pointer; transition:background .1s;
      }
      .ait-ql-item:hover { background:light-dark(rgba(0,0,0,.04),rgba(255,255,255,.06)); }
      .ait-ql-item.active { background:light-dark(rgba(0,0,0,.05),rgba(255,255,255,.08)); }
      .ait-ql-item-index {
        font-size:12px; font-weight:600; color:var(--gte-timeline-muted);
        min-width:24px; text-align:right; flex-shrink:0;
        font-variant-numeric:tabular-nums; letter-spacing:.02em; pointer-events:none;
      }
      .ait-ql-item.active .ait-ql-item-index { color:var(--gte-timeline-text); font-weight:700; }
      .ait-ql-item-text {
        flex:1; min-width:0; font-size:12.5px; color:var(--gte-timeline-text);
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.5;
      }
      .ait-ql-item.active .ait-ql-item-text { font-weight:500; }
      .ait-question-list-popup .gte-timeline__title { padding-bottom:0; }
      .ait-question-list-popup .gte-timeline__title::after { display:none; }
      .ait-question-list-popup .gte-timeline__count,
      .ait-question-list-popup .gte-timeline__status { display:none; }
      @keyframes gte-timeline-spin { to { transform: rotate(360deg); } }
      `;

      function truncateTimelineLabel(value, maxUnits = 34) {
        const text = String(value ?? "").replace(/\s+/g, " " ).trim();
        if (!text) return "";
        const graphemes = typeof Intl?.Segmenter === "function"
          ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment)
          : Array.from(text);
        const isWide = (glyph) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(glyph);
        let units = 0;
        let output = "";
        for (const glyph of graphemes) {
          const width = isWide(glyph) ? 2 : 1;
          if (units + width > maxUnits - 1) return output.trimEnd() + "…";
          output += glyph;
          units += width;
        }
        return output;
      }

      const EARLIER_UI = Object.freeze({
        "↑ Earlier": { icon: "⌃", state: "ready", label: "查看更早对话", tooltip: "查看更早对话" },
        "Loading…": { icon: "↻", state: "loading", label: "正在发现更早对话", tooltip: "正在发现更早对话" },
        "No more discovered": { icon: "·", state: "exhausted", label: "本次未发现更早对话，可再次点击重试", tooltip: "本次未发现更早对话，可再次点击重试" }
      });

      function getEarlierUi(state) { return EARLIER_UI[state] ?? EARLIER_UI["↑ Earlier"]; }

      class TimelineRenderer {
        constructor({ document: documentRef = globalThis.document, adapter, onSelect = async () => {}, onEarlier = async () => {}, onExpandedChange = () => {}, expanded = false } = {}) {
          this.document = documentRef;
          this.adapter = adapter;
          this.onSelect = onSelect;
          this.onEarlier = onEarlier;
          this.onExpandedChange = onExpandedChange;
          this.expanded = Boolean(expanded);
          this.root = null;
          this.records = [];
          this.activeKey = null;
          this.mode = TIMELINE_MODE;
          this.statusText = "等待 Conversation";
          this.earlierState = "↑ Earlier";
          this.focusKey = null;
          this.styleElement = null;
          this.panelScrollTop = 0;
          this.panelViewportAnchor = null;
          this.recordsSignature = "";
          this.railTooltip = null;
          this.boundKeyDown = (event) => this.handleKeyDown(event);
          this.boundPointerDown = (event) => this.handlePointerDown(event);
          this.boundClick = (event) => this.handleClick(event);
          this.boundPointerOver = (event) => this.handleRailTooltipEnter(event);
          this.boundPointerOut = (event) => this.handleRailTooltipLeave(event);
          this.boundFocusIn = (event) => this.handleRailTooltipEnter(event);
          this.boundFocusOut = (event) => this.handleRailTooltipLeave(event);
          this.boundPanelScroll = (event) => {
            this.panelScrollTop = Number(event?.target?.scrollTop) || 0;
            this.panelViewportAnchor = this.capturePanelViewport(event?.target) ?? this.panelViewportAnchor;
          };
        }

        mount() {
          if (this.root || !this.document?.body) return this.root;
          this.styleElement = this.document.createElement("style");
          this.styleElement.dataset.gteStyle = "timeline";
          this.styleElement.textContent = TIMELINE_STYLE;
          this.document.head?.appendChild(this.styleElement);
          this.root = this.document.createElement("aside");
          this.root.className = `${OWNED_CLASSES.timeline} ${this.expanded ? OWNED_CLASSES.timelineExpanded : OWNED_CLASSES.timelineCollapsed}`;
          this.root.dataset.gteComponent = "timeline";
          this.root.setAttribute("aria-label", "Conversation Timeline");
          this.root.addEventListener("pointerdown", this.boundPointerDown, true);
          this.root.addEventListener("click", this.boundClick, true);
          this.root.addEventListener("keydown", this.boundKeyDown);
          this.root.addEventListener("pointerover", this.boundPointerOver);
          this.root.addEventListener("pointerout", this.boundPointerOut);
          this.root.addEventListener("focusin", this.boundFocusIn);
          this.root.addEventListener("focusout", this.boundFocusOut);
          this.document.body.appendChild(this.root);
          this.render();
          return this.root;
        }

        setState({ records = [], activeKey = null, statusText = this.statusText, mode = this.mode } = {}) {
          const nextRecords = [...records];
          const nextSignature = this.getRecordsSignature(nextRecords);
          const structureChanged = nextSignature !== this.recordsSignature;
          const activeChanged = this.activeKey !== activeKey;
          this.records = nextRecords;
          this.activeKey = activeKey;
          this.statusText = statusText;
          this.mode = mode;
          if (structureChanged || !this.root) {
            this.recordsSignature = nextSignature;
            this.render();
            return;
          }
          this.updateRecordContentUi();
          if (activeChanged) this.updateActiveState(activeKey);
          this.updateStatusUi();
        }

        setEarlierState(state) {
          if (!Object.hasOwn(EARLIER_UI, state)) return false;
          this.earlierState = state;
          if (this.root) this.updateEarlierControl();
          return true;
        }

        setExpanded(expanded) {
          this.expanded = Boolean(expanded);
          if (this.root) {
            this.root.classList.toggle(OWNED_CLASSES.timelineExpanded, this.expanded);
            this.root.classList.toggle(OWNED_CLASSES.timelineCollapsed, !this.expanded);
            this.render();
          }
          this.onExpandedChange(this.expanded);
        }

        render() {
          if (!this.root) return;
          const previousFocusKey = this.root.contains(this.document.activeElement)
            ? this.document.activeElement?.dataset?.turnKey ?? this.focusKey
            : this.focusKey;
          const previousPanelList = this.root.querySelector?.(".gte-timeline__list");
          const viewportAnchor = this.capturePanelViewport(previousPanelList) ?? this.panelViewportAnchor;
          if (previousPanelList && Number.isFinite(Number(previousPanelList.scrollTop))) {
            this.panelScrollTop = Number(previousPanelList.scrollTop) || 0;
          }
          this.root.replaceChildren();

          const rail = this.document.createElement("div");
          rail.className = "gte-timeline__rail";
          const railEarlier = this.document.createElement("button");
          railEarlier.type = "button";
          railEarlier.className = "gte-timeline__earlier";
          railEarlier.dataset.gteAction = "earlier";
          const earlierUi = getEarlierUi(this.earlierState);
          railEarlier.classList.add(`gte-timeline__earlier--${earlierUi.state}`);
          railEarlier.dataset.gteState = earlierUi.state;
          railEarlier.dataset.tooltip = earlierUi.tooltip;
          railEarlier.setAttribute("aria-label", earlierUi.label);
          const earlierIcon = this.document.createElement("span");
          earlierIcon.className = "gte-timeline__earlier-icon";
          earlierIcon.textContent = earlierUi.icon;
          earlierIcon.setAttribute("aria-hidden", "true");
          railEarlier.appendChild(earlierIcon);
          rail.appendChild(railEarlier);

          const track = this.document.createElement("div");
          track.className = "gte-timeline__track";
          track.dataset.gteTimelineTrack = "true";
          track.setAttribute("role", "listbox");
          track.setAttribute("aria-label", "Conversation turns");
          rail.appendChild(track);

          const toggle = this.document.createElement("button");
          toggle.type = "button";
          toggle.className = "gte-timeline__toggle";
          toggle.dataset.gteAction = "toggle";
          toggle.textContent = this.expanded ? "›" : "‹";
          toggle.setAttribute("aria-label", this.expanded ? "收起 Timeline" : "展开 Timeline");
          toggle.setAttribute("aria-expanded", String(this.expanded));
          rail.appendChild(toggle);
          const railTooltip = this.document.createElement("div");
          railTooltip.className = "gte-timeline__rail-tooltip";
          railTooltip.setAttribute("role", "tooltip");
          railTooltip.setAttribute("aria-hidden", "true");
          rail.appendChild(railTooltip);
          this.railTooltip = railTooltip;
          this.root.appendChild(rail);
          this.renderRailMarkers(track);

          if (!this.expanded) {
            this.focusKey = previousFocusKey;
            return;
          }
          const panel = this.document.createElement("section");
          panel.className = "gte-timeline__panel ait-question-list-popup";
          panel.setAttribute("aria-label", "Conversation Timeline panel");
          const header = this.document.createElement("header");
          header.className = "gte-timeline__header ait-ql-header";
          const title = this.document.createElement("span");
          title.className = "gte-timeline__title ait-ql-title";
          title.textContent = "时间轴";
          const count = this.document.createElement("span");
          count.className = "gte-timeline__count";
          count.textContent = String(this.records.length);
          header.append(title, count);
          panel.appendChild(header);

          const list = this.document.createElement("div");
          list.className = "gte-timeline__list ait-ql-list";
          list.dataset.gteTimelineList = "true";
          list.setAttribute("role", "listbox");
          list.setAttribute("aria-label", "User turns");
          list.addEventListener("scroll", this.boundPanelScroll, { passive: true });
          for (const record of this.records) {
            const item = this.document.createElement("button");
            item.type = "button";
            item.className = "gte-timeline__item ait-ql-item";
            item.dataset.gteAction = "jump";
            item.dataset.turnKey = record.key;
            item.setAttribute("role", "option");
            item.setAttribute("aria-selected", String(record.key === this.activeKey));
            if (record.key === this.activeKey) item.classList.add("gte-timeline__item--active", "active");
            const dot = this.document.createElement("span");
            dot.className = "gte-timeline__dot";
            dot.setAttribute("aria-hidden", "true");
            const text = this.document.createElement("span");
            text.className = "gte-timeline__item-text";
            text.textContent = record.shortText || record.text || record.key;
            item.append(dot, text);
            list.appendChild(item);
          }
          if (this.records.length === 0) {
            const empty = this.document.createElement("div");
            empty.className = "gte-timeline__empty";
            empty.textContent = "发现用户消息后会显示在这里。";
            list.appendChild(empty);
          }
          panel.appendChild(list);
          const status = this.document.createElement("div");
          status.className = "gte-timeline__status";
          status.textContent = `${this.mode === TIMELINE_MODE ? "渐进模式" : this.mode} · ${this.statusText}`;
          panel.appendChild(status);
          this.root.appendChild(panel);
          this.restorePanelViewport(list, viewportAnchor);
          this.focusKey = previousFocusKey;
          if (this.focusKey) this.focusItem(this.focusKey, false);
        }
        getRecordsSignature(records = this.records) {
          return records.map((record) => record.key).join("\u0002");
        }

        getRailCapacity(track) {
          const rectHeight = Number(track?.getBoundingClientRect?.()?.height) || 0;
          const clientHeight = Number(track?.clientHeight) || 0;
          const fallbackHeight = Math.max(180, (this.document?.documentElement?.clientHeight || 768) - 252);
          const measuredHeight = Math.max(rectHeight, clientHeight);
          const height = measuredHeight >= 80 ? measuredHeight : fallbackHeight;
          const rawCapacity = Math.floor((height * 0.84) / RAIL_MIN_GAP) + 1;
          return Math.max(4, Math.min(RAIL_MAX_MARKERS, rawCapacity || RAIL_FALLBACK_CAPACITY));
        }

        getRailSampleIndices(capacity) {
          const count = this.records.length;
          if (count <= capacity) return this.records.map((_record, index) => index);
          const chosen = new Set();
          for (let slot = 0; slot < capacity; slot += 1) {
            chosen.add(Math.round((slot * (count - 1)) / Math.max(1, capacity - 1)));
          }
          const activeIndex = this.records.findIndex((record) => record.key === this.activeKey);
          if (activeIndex >= 0) chosen.add(activeIndex);
          const minIndexGap = Math.max(1, Math.floor((count - 1) / Math.max(1, capacity - 1)));
          let sorted = [...chosen].sort((left, right) => left - right);
          let changed = true;
          while (changed) {
            changed = false;
            for (let index = 1; index < sorted.length; index += 1) {
              const left = sorted[index - 1];
              const right = sorted[index];
              if (right - left >= minIndexGap) continue;
              if (right === activeIndex) sorted.splice(index - 1, 1);
              else if (left === activeIndex) sorted.splice(index, 1);
              else if (left === 0) sorted.splice(index, 1);
              else if (right === count - 1) sorted.splice(index - 1, 1);
              else sorted.splice(index, 1);
              changed = true;
              break;
            }
          }
          return sorted;
        }

        renderRailMarkers(track = this.root?.querySelector?.(".gte-timeline__track")) {
          if (!track) return;
          track.replaceChildren();
          const line = this.document.createElement("span");
          line.className = "gte-timeline__track-line";
          line.setAttribute("aria-hidden", "true");
          track.appendChild(line);
          if (!this.records.length) {
            const emptyDot = this.document.createElement("span");
            emptyDot.className = "gte-timeline__track-empty";
            emptyDot.setAttribute("aria-hidden", "true");
            track.appendChild(emptyDot);
            return;
          }
          const capacity = this.getRailCapacity(track) || RAIL_FALLBACK_CAPACITY;
          const indices = this.getRailSampleIndices(capacity);
          for (const index of indices) {
            track.appendChild(this.createRailNode(this.records[index], index, this.records.length));
          }
        }

        createRailNode(record, index, total = this.records.length) {
          const node = this.document.createElement("button");
          const summary = shortenText(record.text || record.shortText || record.key, 320);
          const position = total <= 1 ? 50 : 8 + (index / Math.max(1, total - 1)) * 84;
          node.type = "button";
          node.className = `gte-timeline__node${record.key === this.activeKey ? " gte-timeline__node--active" : ""}`;
          node.dataset.gteAction = "jump";
          node.dataset.turnKey = record.key;
          node.dataset.tooltip = summary;
          node.dataset.gteSampleIndex = String(index);
          node.style.top = `${position}%`;
          node.setAttribute("role", "option");
          node.setAttribute("aria-selected", String(record.key === this.activeKey));
          node.setAttribute("aria-label", summary || record.key);
          const dot = this.document.createElement("span");
          dot.className = "gte-timeline__node-dot";
          dot.setAttribute("aria-hidden", "true");
          node.appendChild(dot);
          return node;
        }

        capturePanelViewport(list = this.root?.querySelector?.(".gte-timeline__list")) {
          if (!list) return null;
          const scrollTop = Number(list.scrollTop) || 0;
          const rows = [...(list.querySelectorAll?.(".gte-timeline__item[data-turn-key]") ?? [])];
          let anchor = null;
          for (const row of rows) {
            const offsetTop = Number(row.offsetTop);
            const offsetHeight = Number(row.offsetHeight) || 38;
            if (!Number.isFinite(offsetTop)) continue;
            if (offsetTop + offsetHeight > scrollTop) {
              anchor = { key: row.dataset.turnKey, offset: offsetTop - scrollTop };
              break;
            }
          }
          return { scrollTop, anchor };
        }

        restorePanelViewport(list, snapshot = this.panelViewportAnchor) {
          if (!list) return;
          let restored = false;
          const anchorKey = snapshot?.anchor?.key;
          if (anchorKey) {
            const row = [...(list.querySelectorAll?.(".gte-timeline__item[data-turn-key]") ?? [])]
              .find((candidate) => candidate.dataset.turnKey === anchorKey);
            const offsetTop = Number(row?.offsetTop);
            if (row && Number.isFinite(offsetTop)) {
              list.scrollTop = Math.max(0, offsetTop - Number(snapshot.anchor.offset || 0));
              restored = true;
            }
          }
          if (!restored) list.scrollTop = Number(snapshot?.scrollTop ?? this.panelScrollTop) || 0;
          this.panelScrollTop = Number(list.scrollTop) || 0;
          this.panelViewportAnchor = this.capturePanelViewport(list) ?? snapshot ?? null;
        }

        updateRecordContentUi() {
          const byKey = new Map(this.records.map((record) => [record.key, record]));
          const rows = this.root ? [...this.root.querySelectorAll(".gte-timeline__item[data-turn-key]")] : [];
          for (const row of rows) {
            const record = byKey.get(row.dataset.turnKey);
            const text = row.querySelector?.(".gte-timeline__item-text");
            if (record && text) text.textContent = record.shortText || record.text || record.key;
          }
          const nodes = this.root ? [...this.root.querySelectorAll(".gte-timeline__node")] : [];
          for (const node of nodes) {
            const record = byKey.get(node.dataset.turnKey);
            if (!record) continue;
            const summary = shortenText(record.text || record.shortText || record.key, 320);
            node.dataset.tooltip = summary;
            node.setAttribute("aria-label", summary || record.key);
          }
        }

        updateStatusUi() {
          const count = this.root?.querySelector?.(".gte-timeline__count");
          if (count) count.textContent = String(this.records.length);
          const status = this.root?.querySelector?.(".gte-timeline__status");
          if (status) status.textContent = `${this.mode === TIMELINE_MODE ? "渐进模式" : this.mode} · ${this.statusText}`;
        }

        updateEarlierControl() {
          const control = this.root?.querySelector?.(".gte-timeline__earlier");
          if (!control) return;
          const ui = getEarlierUi(this.earlierState);
          for (const state of ["ready", "loading", "exhausted"]) {
            control.classList.remove(`gte-timeline__earlier--${state}`);
          }
          control.classList.add(`gte-timeline__earlier--${ui.state}`);
          control.dataset.gteState = ui.state;
          control.dataset.tooltip = ui.tooltip;
          control.setAttribute("aria-label", ui.label);
          const icon = control.querySelector?.(".gte-timeline__earlier-icon");
          if (icon) icon.textContent = ui.icon;
        }

        updateActiveState(activeKey) {
          const rows = this.root ? [...this.root.querySelectorAll(".gte-timeline__item[data-turn-key]")] : [];
          for (const row of rows) {
            const active = row.dataset.turnKey === activeKey;
            row.classList.toggle("gte-timeline__item--active", active);
            row.classList.toggle("active", active);
            row.setAttribute("aria-selected", String(active));
          }
          let nodes = this.root ? [...this.root.querySelectorAll(".gte-timeline__node")] : [];
          if (activeKey && !nodes.some((node) => node.dataset.turnKey === activeKey)) {
            this.renderRailMarkers();
            nodes = this.root ? [...this.root.querySelectorAll(".gte-timeline__node")] : [];
          }
          for (const node of nodes) {
            const active = node.dataset.turnKey === activeKey;
            node.classList.toggle("gte-timeline__node--active", active);
            node.setAttribute("aria-selected", String(active));
          }
        }


        getRailTooltipTarget(event) {
          const target = event?.target?.closest?.(".gte-timeline__node") ?? null;
          return target && this.root?.contains(target) ? target : null;
        }

        handleRailTooltipEnter(event) {
          const target = this.getRailTooltipTarget(event);
          if (target) this.showRailTooltip(target);
        }

        handleRailTooltipLeave(event) {
          const target = this.getRailTooltipTarget(event);
          if (!target) return;
          if (event?.relatedTarget && target.contains?.(event.relatedTarget)) return;
          this.hideRailTooltip();
        }

        showRailTooltip(target) {
          if (this.expanded || !target || !this.railTooltip) return false;
          const text = target.dataset?.tooltip ?? "";
          if (!text) return false;
          const rail = this.root?.querySelector?.(".gte-timeline__rail");
          const targetRect = target.getBoundingClientRect?.();
          const railRect = rail?.getBoundingClientRect?.();
          if (!targetRect || !railRect) return false;
          this.railTooltip.textContent = text;
          this.railTooltip.style.top = `${Math.round(targetRect.top - railRect.top + targetRect.height / 2)}px`;
          this.railTooltip.classList.add("gte-timeline__rail-tooltip--visible");
          this.railTooltip.setAttribute("aria-hidden", "false");
          return true;
        }

        hideRailTooltip() {
          if (!this.railTooltip) return;
          this.railTooltip.classList.remove("gte-timeline__rail-tooltip--visible");
          this.railTooltip.setAttribute("aria-hidden", "true");
        }
        handlePointerDown(event) {
          const actionElement = this.getActionElement(event);
          if (actionElement?.dataset.gteAction !== "jump" || !actionElement.dataset.turnKey) return;
          this.consumePointerEvent(event);
          this.lastPointerJumpAt = Date.now();
          this.selectTurn(actionElement.dataset.turnKey);
        }

        handleClick(event) {
          const actionElement = this.getActionElement(event);
          if (!actionElement) return;
          const action = actionElement.dataset.gteAction;
          if (action === "jump"
            && Number(event?.detail) > 0
            && Date.now() - this.lastPointerJumpAt < 500) {
            this.consumePointerEvent(event);
            return;
          }
          this.consumePointerEvent(event);
          if (action === "toggle") { this.setExpanded(!this.expanded); return; }
          if (action === "earlier") {
            if (this.earlierState !== "Loading…") void this.onEarlier();
            return;
          }
          if (action === "jump" && actionElement.dataset.turnKey) this.selectTurn(actionElement.dataset.turnKey);
        }

        getActionElement(event) {
          const actionElement = event?.target?.closest?.("[data-gte-action]") ?? null;
          return actionElement && this.root?.contains(actionElement) ? actionElement : null;
        }

        consumePointerEvent(event) {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          event?.stopImmediatePropagation?.();
        }

        selectTurn(turnKey) {
          const list = this.root?.querySelector?.(".gte-timeline__list");
          this.panelViewportAnchor = this.capturePanelViewport(list) ?? this.panelViewportAnchor;
          this.focusKey = turnKey;
          void this.onSelect(turnKey);
        }

        handleKeyDown(event) {
          if (!this.expanded || !this.root?.contains(event.target)) return;
          const items = this.getItems();
          if (!items.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const currentIndex = Math.max(0, items.findIndex((item) => item.dataset.turnKey === this.focusKey));
            const nextIndex = event.key === "ArrowDown" ? Math.min(items.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
            this.focusItem(items[nextIndex].dataset.turnKey);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            this.focusItem(items[event.key === "Home" ? 0 : items.length - 1].dataset.turnKey);
          } else if (event.key === "Enter" && this.focusKey) {
            event.preventDefault();
            void this.onSelect(this.focusKey);
          }
        }

        getItems() { return this.root ? [...this.root.querySelectorAll(".gte-timeline__item[data-turn-key]")] : []; }

        focusItem(key, focus = true) {
          this.focusKey = key;
          const item = this.getItems().find((candidate) => candidate.dataset.turnKey === key);
          if (item && focus) item.focus();
        }

        destroy() {
          this.root?.removeEventListener("pointerdown", this.boundPointerDown, true);
          this.root?.removeEventListener("click", this.boundClick, true);
          this.root?.removeEventListener("keydown", this.boundKeyDown);
          this.root?.removeEventListener("pointerover", this.boundPointerOver);
          this.root?.removeEventListener("pointerout", this.boundPointerOut);
          this.root?.removeEventListener("focusin", this.boundFocusIn);
          this.root?.removeEventListener("focusout", this.boundFocusOut);
          this.root?.remove();
          this.styleElement?.remove();
          this.root = null;
          this.styleElement = null;
          this.railTooltip = null;
          this.records = [];
        }
      }

      function removeTimelineArtifacts(documentRef = globalThis.document) {
        documentRef?.querySelectorAll?.(OWNED_SELECTORS.timeline)?.forEach((element) => element.remove());
        documentRef?.querySelectorAll?.('style[data-gte-style="timeline"]')?.forEach((element) => element.remove());
      }

      exports["TimelineRenderer"] = TimelineRenderer;
      exports["removeTimelineArtifacts"] = removeTimelineArtifacts;
      return exports;
    },
    "src/core/storage-adapter.js": (exports, __require) => {
      class StorageAdapter {
        get(_key) {
          throw new Error("StorageAdapter.get must be implemented");
        }

        set(_key, _value) {
          throw new Error("StorageAdapter.set must be implemented");
        }

        remove(_key) {
          throw new Error("StorageAdapter.remove must be implemented");
        }
      }

      class LocalStorageAdapter extends StorageAdapter {
        constructor(storage = getGlobalStorage()) {
          super();
          this.storage = storage ?? null;
        }

        get(key) {
          if (!this.storage) return null;
          try {
            return this.storage.getItem(key);
          } catch {
            return null;
          }
        }

        set(key, value) {
          if (!this.storage) return false;
          try {
            this.storage.setItem(key, value);
            return true;
          } catch {
            return false;
          }
        }

        remove(key) {
          if (!this.storage) return false;
          try {
            this.storage.removeItem(key);
            return true;
          } catch {
            return false;
          }
        }
      }

      function getGlobalStorage() {
        try {
          return globalThis.localStorage ?? null;
        } catch {
          return null;
        }
      }

      class MemoryStorageAdapter extends StorageAdapter {
        constructor(initial = {}) {
          super();
          this.values = new Map(Object.entries(initial));
        }

        get(key) {
          return this.values.has(key) ? this.values.get(key) : null;
        }

        set(key, value) {
          this.values.set(key, value);
          return true;
        }

        remove(key) {
          return this.values.delete(key);
        }
      }

      class SettingsStore {
        constructor({ storage, key = "gpt-talk-enhancer.settings.v1" } = {}) {
          this.storage = storage;
          this.key = key;
        }

        load() {
          const fallback = { version: 1, data: { timelineExpanded: false } };
          const raw = this.storage?.get(this.key);
          if (!raw) return fallback;
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.version !== 1 || typeof parsed.data !== "object") return fallback;
            return {
              version: 1,
              data: {
                timelineExpanded: Boolean(parsed.data.timelineExpanded)
              }
            };
          } catch {
            return fallback;
          }
        }

        save(data) {
          return this.storage?.set(this.key, JSON.stringify({
            version: 1,
            data: { timelineExpanded: Boolean(data?.timelineExpanded) }
          })) ?? false;
        }
      }

      exports["StorageAdapter"] = StorageAdapter;
      exports["LocalStorageAdapter"] = LocalStorageAdapter;
      exports["MemoryStorageAdapter"] = MemoryStorageAdapter;
      exports["SettingsStore"] = SettingsStore;
      return exports;
    },
    "src/core/prompt-store.js": (exports, __require) => {
      const { STORAGE_KEYS } = __require("src/core/constants.js");
      const SCHEMA_VERSION = 1;

      class PromptStore {
        constructor({
          storage,
          key = STORAGE_KEYS.prompts,
          clock = () => Date.now(),
          idFactory = defaultIdFactory
        } = {}) {
          this.storage = storage;
          this.key = key;
          this.clock = clock;
          this.idFactory = idFactory;
          this.items = [];
          this.loaded = false;
        }

        load() {
          if (this.loaded) {
            return this.list();
          }
          this.loaded = true;
          const raw = this.storage?.get(this.key);
          if (!raw) {
            this.items = [];
            return this.list();
          }
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.items)) {
              this.items = [];
              return this.list();
            }
            this.items = parsed.items.map(normalizePrompt).filter(Boolean);
            return this.list();
          } catch {
            this.items = [];
            return this.list();
          }
        }

        list() {
          this.ensureLoaded();
          return [...this.items].sort(comparePrompts).map(clonePrompt);
        }

        search(query = "") {
          const normalizedQuery = String(query).trim().toLocaleLowerCase();
          return this.list().filter((prompt) => {
            if (!normalizedQuery) return true;
            return `${prompt.name}\n${prompt.content}`.toLocaleLowerCase().includes(normalizedQuery);
          });
        }

        get(id) {
          this.ensureLoaded();
          const prompt = this.items.find((item) => item.id === id);
          return prompt ? clonePrompt(prompt) : null;
        }

        create({ name, content, favorite = false } = {}) {
          this.ensureLoaded();
          const normalized = validatePromptInput({ name, content });
          const now = this.clock();
          const prompt = {
            id: String(this.idFactory()),
            name: normalized.name,
            content: normalized.content,
            favorite: Boolean(favorite),
            order: this.nextOrder(),
            createdAt: now,
            updatedAt: now
          };
          this.items.push(prompt);
          this.persist();
          return clonePrompt(prompt);
        }

        update(id, patch = {}) {
          this.ensureLoaded();
          const prompt = this.items.find((item) => item.id === id);
          if (!prompt) return null;
          const normalized = validatePromptInput({
            name: patch.name ?? prompt.name,
            content: patch.content ?? prompt.content
          });
          prompt.name = normalized.name;
          prompt.content = normalized.content;
          if (patch.favorite !== undefined) prompt.favorite = Boolean(patch.favorite);
          if (patch.order !== undefined && Number.isFinite(Number(patch.order))) prompt.order = Number(patch.order);
          prompt.updatedAt = this.clock();
          this.persist();
          return clonePrompt(prompt);
        }

        setFavorite(id, favorite) {
          return this.update(id, { favorite: Boolean(favorite) });
        }

        toggleFavorite(id) {
          const prompt = this.get(id);
          return prompt ? this.setFavorite(id, !prompt.favorite) : null;
        }

        delete(id) {
          this.ensureLoaded();
          const index = this.items.findIndex((item) => item.id === id);
          if (index < 0) return false;
          this.items.splice(index, 1);
          this.persist();
          return true;
        }

        ensureLoaded() {
          if (!this.loaded) this.load();
        }

        nextOrder() {
          return this.items.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1;
        }

        persist() {
          const payload = JSON.stringify({
            version: SCHEMA_VERSION,
            items: this.items.map(clonePrompt)
          });
          return this.storage?.set(this.key, payload) ?? false;
        }
      }

      function normalizePrompt(value) {
        if (!value || typeof value !== "object") return null;
        try {
          const input = validatePromptInput({ name: value.name, content: value.content });
          const createdAt = finiteTimestamp(value.createdAt) ?? Date.now();
          const updatedAt = finiteTimestamp(value.updatedAt) ?? createdAt;
          return {
            id: String(value.id || defaultIdFactory()),
            name: input.name,
            content: input.content,
            favorite: Boolean(value.favorite),
            order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0,
            createdAt,
            updatedAt
          };
        } catch {
          return null;
        }
      }

      function validatePromptInput({ name, content }) {
        const normalizedName = String(name ?? "").trim();
        const normalizedContent = String(content ?? "").replace(/\r\n?/g, "\n").trim();
        if (!normalizedName) throw new Error("Prompt name is required");
        if (!normalizedContent) throw new Error("Prompt content is required");
        return { name: normalizedName, content: normalizedContent };
      }

      function comparePrompts(left, right) {
        if (left.order !== right.order) return left.order - right.order;
        if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
        return left.id.localeCompare(right.id);
      }

      function clonePrompt(prompt) {
        return { ...prompt };
      }

      function finiteTimestamp(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
      }

      function defaultIdFactory() {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        return `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }

      exports["PromptStore"] = PromptStore;
      exports["normalizePrompt"] = normalizePrompt;
      return exports;
    },
    "src/core/composer-adapter.js": (exports, __require) => {
      const { SELECTORS } = __require("src/core/constants.js");
      const { elementText, normalizeText, queryFirst } = __require("src/core/dom-utils.js");
      class ComposerAdapter {
        constructor({ document: documentRef = globalThis.document, window: windowRef = globalThis.window, onToast = () => {} } = {}) {
          this.document = documentRef;
          this.window = windowRef;
          this.onToast = onToast;
        }

        getEditor() {
          return queryFirst(this.document, SELECTORS.editors);
        }

        getText() {
          return readEditorText(this.getEditor());
        }

        async insertText(text) {
          const content = String(text ?? "");
          const editor = this.getEditor();
          const result = insertTextIntoEditor({ editor, document: this.document, text: content });
          if (result.ok) {
            return result;
          }

          const copied = await copyTextToClipboard(content, {
            navigator: this.window?.navigator ?? globalThis.navigator,
            document: this.document
          });
          const message = copied
            ? "自动写入失败，Prompt 已复制到剪贴板"
            : "自动写入失败，请手动复制 Prompt";
          this.onToast(message);
          return { ...result, ok: false, copied, fallback: "clipboard" };
        }
      }

      function readEditorText(editor) {
        return normalizeText(elementText(editor));
      }

      function insertTextIntoEditor({ editor, document: documentRef, text }) {
        if (!editor || !documentRef || typeof documentRef.execCommand !== "function") {
          return { ok: false, reason: "editor-or-command-unavailable", readBack: readEditorText(editor) };
        }

        try {
          editor.focus?.();
          const commandResult = documentRef.execCommand("insertText", false, String(text ?? ""));
          const readBack = readEditorText(editor);
          const expected = normalizeText(text);
          const ok = commandResult !== false && containsInsertedText(readBack, expected);
          return {
            ok,
            commandResult,
            readBack,
            reason: ok ? null : "read-back-mismatch"
          };
        } catch (error) {
          return {
            ok: false,
            reason: "insert-command-failed",
            error: error instanceof Error ? error.message : String(error),
            readBack: readEditorText(editor)
          };
        }
      }

      async function copyTextToClipboard(text, { navigator: navigatorRef = globalThis.navigator, document: documentRef = globalThis.document } = {}) {
        if (navigatorRef?.clipboard?.writeText) {
          try {
            await navigatorRef.clipboard.writeText(String(text ?? ""));
            return true;
          } catch {
            // Fall through to the scoped legacy copy path.
          }
        }

        if (!documentRef?.createElement || !documentRef.body || typeof documentRef.execCommand !== "function") {
          return false;
        }
        const textarea = documentRef.createElement("textarea");
        textarea.value = String(text ?? "");
        textarea.setAttribute("aria-hidden", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        documentRef.body.appendChild(textarea);
        textarea.select?.();
        let copied = false;
        try {
          copied = documentRef.execCommand("copy");
        } catch {
          copied = false;
        }
        textarea.remove();
        return copied;
      }

      function containsInsertedText(readBack, expected) {
        if (!expected) return true;
        const normalizedReadBack = normalizeText(readBack);
        return normalizedReadBack.includes(expected) || normalizedReadBack.replace(/\s+/g, " ").includes(expected.replace(/\s+/g, " "));
      }

      exports["copyTextToClipboard"] = copyTextToClipboard;
      exports["ComposerAdapter"] = ComposerAdapter;
      exports["readEditorText"] = readEditorText;
      exports["insertTextIntoEditor"] = insertTextIntoEditor;
      return exports;
    },
    "src/core/bridge-adapter.js": (exports, __require) => {
      class BridgeAdapter {
        available() {
          return false;
        }

        request() {
          return Promise.reject(new Error("BridgeAdapter is not available in Phase 1"));
        }
      }

      class NoOpBridgeAdapter extends BridgeAdapter {
        available() {
          return false;
        }
      }

      exports["BridgeAdapter"] = BridgeAdapter;
      exports["NoOpBridgeAdapter"] = NoOpBridgeAdapter;
      return exports;
    },
    "src/core/prompt-picker.js": (exports, __require) => {
      const { OWNED_CLASSES, OWNED_SELECTORS } = __require("src/core/constants.js");
      const { safeIsConnected, shortenText } = __require("src/core/dom-utils.js");
      const TRIGGER_HIT_SIZE = 40;
      const TRIGGER_VISUAL_SIZE = 32;
      const TRIGGER_GAP = 10;
      const TRIGGER_INSET = (TRIGGER_HIT_SIZE - TRIGGER_VISUAL_SIZE) / 2;
      const POPUP_WIDTH = 336;
      const POPUP_HEIGHT = 400;

      const PROMPT_STYLE = `
      .gte-prompt-button,
      .gte-prompt-popup,
      .gte-prompt-popup *,
      .gte-toast {
        box-sizing: border-box;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .gte-prompt-button {
        position: fixed;
        z-index: 2147483000;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        margin: 0;
        padding: 4px;
        border: 0;
        border-radius: 11px;
        color: inherit;
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
        touch-action: manipulation;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      .gte-prompt-button__surface {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: 1px solid light-dark(rgba(0, 0, 0, .09), rgba(255, 255, 255, .10));
        border-radius: 9px;
        color: light-dark(#6d28d9, #c4b5fd);
        background: light-dark(rgba(255, 255, 255, .90), rgba(34, 34, 38, .90));
        box-shadow: 0 3px 12px rgba(0, 0, 0, .12), inset 0 0 0 1px light-dark(rgba(255,255,255,.35), rgba(255,255,255,.025));
        backdrop-filter: blur(10px) saturate(135%);
        -webkit-backdrop-filter: blur(10px) saturate(135%);
        transition: transform 120ms ease, color 120ms ease, border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
      }
      .gte-prompt-button:hover .gte-prompt-button__surface,
      .gte-prompt-button:focus-visible .gte-prompt-button__surface {
        color: light-dark(#5b21b6, #ddd6fe);
        border-color: rgba(139, 92, 246, .34);
        background: light-dark(rgba(255, 255, 255, .98), rgba(48, 44, 57, .96));
        box-shadow: 0 5px 16px rgba(0, 0, 0, .16), 0 0 0 2px rgba(139, 92, 246, .10);
        transform: translateY(-1px);
      }
      .gte-prompt-button:active .gte-prompt-button__surface { transform: translateY(0) scale(.97); }
      .gte-prompt-button:focus-visible { outline: none; }
      .gte-prompt-button__icon { font-size: 16px; line-height: 1; transform: translateY(-.5px); }
      .gte-prompt-button__label,
      .gte-prompt-popup__sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .gte-prompt-popup {
        --gte-prompt-accent: #8b5cf6;
        --gte-prompt-text: light-dark(rgba(24, 24, 27, .94), rgba(250, 250, 250, .94));
        --gte-prompt-muted: light-dark(rgba(24, 24, 27, .55), rgba(250, 250, 250, .55));
        --gte-prompt-soft: light-dark(rgba(20, 20, 24, .045), rgba(255, 255, 255, .055));
        --gte-prompt-border: light-dark(rgba(0, 0, 0, .10), rgba(255, 255, 255, .10));
        position: fixed;
        z-index: 2147483100;
        display: flex;
        flex-direction: column;
        width: min(336px, calc(100vw - 16px));
        height: min(400px, calc(100vh - 16px));
        min-height: min(360px, calc(100vh - 16px));
        max-height: calc(100vh - 16px);
        overflow: hidden;
        border: 1px solid var(--gte-prompt-border);
        border-radius: 14px;
        color: var(--gte-prompt-text);
        background: light-dark(rgba(255, 255, 255, .93), rgba(28, 28, 31, .94));
        box-shadow: 0 18px 48px rgba(0, 0, 0, .24), 0 2px 7px rgba(0, 0, 0, .12);
        backdrop-filter: blur(16px) saturate(140%);
        -webkit-backdrop-filter: blur(16px) saturate(140%);
        color-scheme: light dark;
        isolation: isolate;
      }
      .gte-prompt-popup__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex: 0 0 auto;
        min-height: 48px;
        padding: 10px 10px 8px 14px;
        border-bottom: 1px solid light-dark(rgba(0, 0, 0, .06), rgba(255, 255, 255, .07));
      }
      .gte-prompt-popup__title-group {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        min-height: 29px;
        padding-bottom: 6px;
      }
      .gte-prompt-popup__title { font-size: 14px; font-weight: 690; letter-spacing: .005em; }
      .gte-prompt-popup__title-accent {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 34px;
        height: 2px;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--gte-prompt-accent), rgba(139, 92, 246, .18));
      }
      .gte-prompt-popup__header-add,
      .gte-prompt-popup__header-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        min-height: 28px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        color: var(--gte-prompt-muted);
        background: transparent;
        cursor: pointer;
        font: inherit;
        line-height: 1;
      }
      .gte-prompt-popup__header-add { width: 22px; color: light-dark(#6d28d9, #b9a7fb); font-size: 17px; }
      .gte-prompt-popup__header-close { font-size: 18px; }
      .gte-prompt-popup__header-add:hover,
      .gte-prompt-popup__header-add:focus-visible,
      .gte-prompt-popup__header-close:hover,
      .gte-prompt-popup__header-close:focus-visible {
        color: var(--gte-prompt-text);
        background: var(--gte-prompt-soft);
        outline: none;
      }
      .gte-prompt-popup__toolbar { flex: 0 0 auto; padding: 10px 12px 4px; }
      .gte-prompt-popup__search,
      .gte-prompt-popup__input,
      .gte-prompt-popup__textarea {
        min-width: 0;
        border: 1px solid var(--gte-prompt-border);
        border-radius: 9px;
        color: var(--gte-prompt-text);
        background: var(--gte-prompt-soft);
        font: inherit;
        outline: none;
      }
      .gte-prompt-popup__search,
      .gte-prompt-popup__input { width: 100%; min-height: 33px; padding: 7px 9px; }
      .gte-prompt-popup__textarea { width: 100%; min-height: 160px; padding: 9px; resize: vertical; line-height: 1.45; }
      .gte-prompt-popup__search:focus,
      .gte-prompt-popup__input:focus,
      .gte-prompt-popup__textarea:focus {
        border-color: rgba(139, 92, 246, .65);
        box-shadow: 0 0 0 3px rgba(139, 92, 246, .12);
      }
      .gte-prompt-popup__list {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 2px;
        min-height: 0;
        padding: 6px 7px 9px;
        overflow: auto;
        overscroll-behavior: contain;
      }
      .gte-prompt-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
        align-items: center;
        min-height: 50px;
        padding: 7px 6px 7px 8px;
        border: 1px solid transparent;
        border-radius: 9px;
        transition: background 110ms ease, border-color 110ms ease;
      }
      .gte-prompt-row:hover,
      .gte-prompt-row--selected {
        border-color: rgba(139, 92, 246, .16);
        background: rgba(139, 92, 246, .075);
      }
      .gte-prompt-row__select {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        padding: 1px 0;
        border: 0;
        color: inherit;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }
      .gte-prompt-row__select:focus-visible { outline: 1px solid rgba(139, 92, 246, .55); outline-offset: 3px; border-radius: 4px; }
      .gte-prompt-row__name { overflow: hidden; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .gte-prompt-row__content {
        display: -webkit-box;
        overflow: hidden;
        color: var(--gte-prompt-muted);
        font-size: 11px;
        line-height: 1.35;
        white-space: normal;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .gte-prompt-row__actions { display: flex; align-items: center; gap: 1px; }
      .gte-prompt-row__action {
        width: 25px;
        height: 25px;
        padding: 0;
        border: 0;
        border-radius: 7px;
        color: var(--gte-prompt-muted);
        background: transparent;
        cursor: pointer;
        opacity: .30;
        transition: opacity 100ms ease, color 100ms ease, background 100ms ease;
      }
      .gte-prompt-row__action[data-gte-action="favorite"] { color: light-dark(#7c3aed, #c4b5fd); opacity: .62; }
      .gte-prompt-row:hover .gte-prompt-row__action,
      .gte-prompt-row__action:focus-visible { opacity: .82; }
      .gte-prompt-row__action:hover,
      .gte-prompt-row__action:focus-visible { color: var(--gte-prompt-text); background: var(--gte-prompt-soft); outline: none; }
      .gte-prompt-popup__empty-state {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 13px;
        min-height: 210px;
        padding: 30px 28px 40px;
        color: var(--gte-prompt-muted);
        text-align: center;
      }
      .gte-prompt-popup__empty-icon { color: light-dark(#7c3aed, #b9a7fb); font-size: 21px; opacity: .78; }
      .gte-prompt-popup__empty-copy { max-width: 236px; margin: 0; font-size: 12px; line-height: 1.55; }
      .gte-prompt-popup__empty,
      .gte-prompt-popup__error { padding: 18px 11px; color: var(--gte-prompt-muted); font-size: 12px; line-height: 1.45; }
      .gte-prompt-popup__error { color: light-dark(#b42318, #fda4af); }
      .gte-prompt-popup__button {
        min-height: 31px;
        padding: 5px 10px;
        border: 1px solid var(--gte-prompt-border);
        border-radius: 8px;
        color: var(--gte-prompt-muted);
        background: transparent;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
      }
      .gte-prompt-popup__button:hover,
      .gte-prompt-popup__button:focus-visible { color: var(--gte-prompt-text); background: var(--gte-prompt-soft); outline: none; }
      .gte-prompt-popup__button--primary {
        border-color: rgba(139, 92, 246, .40);
        color: #fff;
        background: rgba(124, 58, 237, .88);
      }
      .gte-prompt-popup__button--primary:hover,
      .gte-prompt-popup__button--primary:focus-visible { color: #fff; background: rgba(124, 58, 237, .98); }
      .gte-prompt-form { display: flex; flex: 1 1 auto; flex-direction: column; gap: 10px; min-height: 0; padding: 14px; }
      .gte-prompt-form__label { display: flex; flex-direction: column; gap: 5px; color: var(--gte-prompt-muted); font-size: 11px; }
      .gte-prompt-form__actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: auto; padding-top: 8px; }
      .gte-toast {
        position: fixed;
        right: 16px;
        bottom: 24px;
        z-index: 2147483200;
        max-width: min(360px, calc(100vw - 32px));
        padding: 9px 12px;
        border: 1px solid light-dark(rgba(0,0,0,.10), rgba(255,255,255,.12));
        border-radius: 9px;
        color: light-dark(#fff, #18181b);
        background: light-dark(#18181b, #fafafa);
        box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
        font-size: 12px;
      }
      `;

      class PromptPicker {
        constructor({ document: documentRef = globalThis.document, window: windowRef = globalThis.window, store, composer, onToast = () => {} } = {}) {
          this.document = documentRef;
          this.window = windowRef;
          this.store = store;
          this.composer = composer;
          this.onToast = onToast;
          this.button = null;
          this.popup = null;
          this.styleElement = null;
          this.anchor = null;
          this.mountInfo = null;
          this.resizeObserver = null;
          this.opened = false;
          this.query = "";
          this.selectedIndex = 0;
          this.editingId = null;
          this.pendingDeleteId = null;
          this.error = "";
          this.formInputs = null;
          this.lastPointerToggleAt = 0;
          this.boundDocumentPointerDown = (event) => {
            const target = event?.target ?? null;
            if (this.button?.contains?.(target)) {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              event?.stopImmediatePropagation?.();
              this.lastPointerToggleAt = Date.now();
              this.toggle();
              return;
            }
            if (!this.opened || this.popup?.contains?.(target)) return;
            this.close();
          };
          this.boundButtonClick = (event) => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            event?.stopImmediatePropagation?.();
            const pointerFollowUp = Number(event?.detail) > 0
              && Date.now() - this.lastPointerToggleAt < 500;
            if (!pointerFollowUp) this.toggle();
          };
          this.boundPopupClick = (event) => this.handleClick(event);
          this.boundPopupInput = (event) => this.handleInput(event);
          this.boundPopupKeyDown = (event) => this.handleKeyDown(event);
          this.boundWindowResize = () => { this.positionTrigger(); this.positionPopup(); };
        }

        mount(mountInfo) {
          const anchor = mountInfo?.anchor ?? mountInfo?.container ?? null;
          if (!anchor || !this.document?.body) { this.unmountButton(); return false; }
          if (this.button && this.anchor === anchor && safeIsConnected(this.button)) {
            const observerTargetChanged = this.mountInfo?.footer !== mountInfo?.footer
              || this.mountInfo?.editor !== mountInfo?.editor;
            this.mountInfo = mountInfo;
            if (observerTargetChanged) this.startAnchorObserver();
            this.positionTrigger();
            return true;
          }
          this.unmountButton();
          this.mountInfo = mountInfo;
          this.anchor = anchor;
          this.ensureStyle();
          this.document.querySelectorAll?.(OWNED_SELECTORS.promptButton)?.forEach((element) => element.remove());
          const button = this.document.createElement("button");
          button.type = "button";
          button.className = OWNED_CLASSES.promptButton;
          button.dataset.gteComponent = "prompt-button";
          button.dataset.gtePromptPlacement = "external";
          button.title = "提示词";
          button.setAttribute("aria-label", "提示词");
          button.setAttribute("aria-haspopup", "dialog");
          button.setAttribute("aria-expanded", "false");
          const surface = this.document.createElement("span");
          surface.className = "gte-prompt-button__surface";
          surface.setAttribute("aria-hidden", "true");
          const icon = this.document.createElement("span");
          icon.className = "gte-prompt-button__icon";
          icon.textContent = "✦";
          surface.appendChild(icon);
          const label = this.document.createElement("span");
          label.className = "gte-prompt-button__label";
          label.textContent = "提示词";
          button.append(surface, label);
          button.addEventListener("click", this.boundButtonClick, true);
          this.document.addEventListener?.("pointerdown", this.boundDocumentPointerDown, true);
          this.document.body.appendChild(button);
          this.button = button;
          this.startAnchorObserver();
          this.positionTrigger();
          return true;
        }

        ensureStyle() {
          if (this.styleElement || !this.document?.head) return;
          this.styleElement = this.document.createElement("style");
          this.styleElement.dataset.gteStyle = "prompt-picker";
          this.styleElement.textContent = PROMPT_STYLE;
          this.document.head.appendChild(this.styleElement);
        }

        startAnchorObserver() {
          this.stopAnchorObserver();
          const ResizeObserverCtor = this.window?.ResizeObserver ?? globalThis.ResizeObserver;
          if (!ResizeObserverCtor || !this.anchor) return;
          try {
            this.resizeObserver = new ResizeObserverCtor(() => { this.positionTrigger(); this.positionPopup(); });
            this.resizeObserver.observe(this.anchor);
            if (this.mountInfo?.footer && safeIsConnected(this.mountInfo.footer)) this.resizeObserver.observe(this.mountInfo.footer);
            if (this.mountInfo?.editor && safeIsConnected(this.mountInfo.editor)) this.resizeObserver.observe(this.mountInfo.editor);
            if (this.document?.documentElement && this.document.documentElement !== this.anchor) this.resizeObserver.observe(this.document.documentElement);
          } catch {
            this.resizeObserver?.disconnect?.();
            this.resizeObserver = null;
          }
        }

        stopAnchorObserver() { this.resizeObserver?.disconnect?.(); this.resizeObserver = null; }
        toggle() { if (this.opened) this.close(); else this.open(); }

        open() {
          if (!this.button || !this.anchor || this.opened) return;
          this.opened = true;
          this.query = "";
          this.selectedIndex = 0;
          this.editingId = null;
          this.pendingDeleteId = null;
          this.error = "";
          this.ensurePopup();
          this.button.setAttribute("aria-expanded", "true");
          this.window?.addEventListener?.("resize", this.boundWindowResize);
          this.renderListView();
          this.positionTrigger();
          this.positionPopup();
          this.popup?.querySelector(".gte-prompt-popup__search")?.focus?.();
        }

        close() {
          this.opened = false;
          this.button?.setAttribute("aria-expanded", "false");
          this.window?.removeEventListener?.("resize", this.boundWindowResize);
          this.popup?.remove();
          this.popup = null;
          this.editingId = null;
          this.formInputs = null;
          this.error = "";
        }

        ensurePopup() {
          if (this.popup || !this.document?.body) return;
          this.document.querySelectorAll?.(OWNED_SELECTORS.promptPopup)?.forEach((element) => element.remove());
          this.popup = this.document.createElement("section");
          this.popup.className = OWNED_CLASSES.promptPopup;
          this.popup.dataset.gteComponent = "prompt-popup";
          this.popup.setAttribute("role", "dialog");
          this.popup.setAttribute("aria-label", "Prompt Library");
          this.popup.addEventListener("click", this.boundPopupClick);
          this.popup.addEventListener("input", this.boundPopupInput);
          this.popup.addEventListener("keydown", this.boundPopupKeyDown);
          this.document.body.appendChild(this.popup);
        }

        renderListView() {
          if (!this.popup) return;
          this.editingId = null;
          this.formInputs = null;
          this.popup.replaceChildren();
          const header = this.document.createElement("header");
          header.className = "gte-prompt-popup__header";
          const titleGroup = this.document.createElement("div");
          titleGroup.className = "gte-prompt-popup__title-group";
          const title = this.document.createElement("span");
          title.className = "gte-prompt-popup__title";
          title.textContent = "提示词";
          const create = this.makeButton("+", "create", "gte-prompt-popup__header-add");
          create.title = "添加提示词";
          create.setAttribute("aria-label", "添加提示词");
          const accent = this.document.createElement("span");
          accent.className = "gte-prompt-popup__title-accent";
          accent.setAttribute("aria-hidden", "true");
          titleGroup.append(title, create, accent);
          const close = this.makeButton("×", "close", "gte-prompt-popup__header-close");
          close.title = "关闭";
          close.setAttribute("aria-label", "关闭");
          header.append(titleGroup, close);
          this.popup.appendChild(header);
          const promptCount = this.store?.search("").length ?? 0;
          if (promptCount >= 5) {
            const toolbar = this.document.createElement("div");
            toolbar.className = "gte-prompt-popup__toolbar";
            const search = this.document.createElement("input");
            search.className = "gte-prompt-popup__search";
            search.type = "search";
            search.placeholder = "搜索提示词";
            search.value = this.query;
            search.setAttribute("aria-label", "搜索提示词");
            toolbar.appendChild(search);
            this.popup.appendChild(toolbar);
          }
          const list = this.document.createElement("div");
          list.className = "gte-prompt-popup__list";
          list.dataset.gtePromptList = "true";
          list.setAttribute("role", "listbox");
          this.popup.appendChild(list);
          this.updateResults();
        }

        updateResults() {
          const list = this.popup?.querySelector("[data-gte-prompt-list]");
          if (!list) return;
          const results = this.store?.search(this.query) ?? [];
          const allPrompts = this.store?.search("") ?? [];
          this.selectedIndex = results.length ? Math.min(this.selectedIndex, results.length - 1) : 0;
          list.replaceChildren();
          results.forEach((prompt, index) => list.appendChild(this.renderRow(prompt, index === this.selectedIndex)));
          if (!results.length) {
            if (!this.query && allPrompts.length === 0) list.appendChild(this.renderEmptyState());
            else {
              const empty = this.document.createElement("div");
              empty.className = "gte-prompt-popup__empty";
              empty.textContent = "没有匹配的提示词。";
              list.appendChild(empty);
            }
          }
          if (this.error) {
            const error = this.document.createElement("div");
            error.className = "gte-prompt-popup__error";
            error.textContent = this.error;
            list.appendChild(error);
          }
        }

        renderEmptyState() {
          const empty = this.document.createElement("div");
          empty.className = "gte-prompt-popup__empty-state";
          const icon = this.document.createElement("span");
          icon.className = "gte-prompt-popup__empty-icon";
          icon.textContent = "✦";
          icon.setAttribute("aria-hidden", "true");
          const copy = this.document.createElement("p");
          copy.className = "gte-prompt-popup__empty-copy";
          copy.textContent = "保存常用提示词，需要时可以直接插入输入框。";
          const add = this.makeButton("+ 添加提示词", "create", "gte-prompt-popup__button gte-prompt-popup__button--primary");
          empty.append(icon, copy, add);
          return empty;
        }

        renderRow(prompt, selected) {
          const row = this.document.createElement("div");
          row.className = `gte-prompt-row${selected ? " gte-prompt-row--selected" : ""}`;
          row.dataset.promptId = prompt.id;
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(selected));
          const select = this.document.createElement("button");
          select.type = "button";
          select.className = "gte-prompt-row__select";
          select.dataset.gteAction = "insert";
          select.dataset.promptId = prompt.id;
          const name = this.document.createElement("span");
          name.className = "gte-prompt-row__name";
          name.textContent = prompt.name;
          const content = this.document.createElement("span");
          content.className = "gte-prompt-row__content";
          content.textContent = shortenText(prompt.content, 140);
          select.append(name, content);
          const actions = this.document.createElement("div");
          actions.className = "gte-prompt-row__actions";
          const favorite = this.makeButton(prompt.favorite ? "★" : "☆", "favorite", "gte-prompt-row__action");
          favorite.dataset.promptId = prompt.id;
          favorite.title = prompt.favorite ? "取消收藏" : "收藏";
          favorite.setAttribute("aria-label", favorite.title);
          const edit = this.makeButton("✎", "edit", "gte-prompt-row__action");
          edit.dataset.promptId = prompt.id;
          edit.title = "编辑";
          edit.setAttribute("aria-label", "编辑");
          const pendingDelete = this.pendingDeleteId === prompt.id;
          const remove = this.makeButton(pendingDelete ? "确认" : "×", "delete", "gte-prompt-row__action");
          remove.dataset.promptId = prompt.id;
          remove.title = pendingDelete ? "再次点击确认删除" : "删除";
          remove.setAttribute("aria-label", remove.title);
          actions.append(favorite, edit, remove);
          row.append(select, actions);
          return row;
        }

        showForm(prompt = null) {
          if (!this.popup) return;
          this.editingId = prompt?.id ?? null;
          this.pendingDeleteId = null;
          this.error = "";
          this.popup.replaceChildren();
          const header = this.document.createElement("header");
          header.className = "gte-prompt-popup__header";
          const titleGroup = this.document.createElement("div");
          titleGroup.className = "gte-prompt-popup__title-group";
          const title = this.document.createElement("span");
          title.className = "gte-prompt-popup__title";
          title.textContent = prompt ? "编辑提示词" : "添加提示词";
          const accent = this.document.createElement("span");
          accent.className = "gte-prompt-popup__title-accent";
          accent.setAttribute("aria-hidden", "true");
          titleGroup.append(title, accent);
          const close = this.makeButton("×", "cancel-form", "gte-prompt-popup__header-close");
          close.title = "取消";
          close.setAttribute("aria-label", "取消");
          header.append(titleGroup, close);
          this.popup.appendChild(header);
          const form = this.document.createElement("form");
          form.className = "gte-prompt-form";
          form.dataset.gtePromptForm = "true";
          const nameLabel = this.document.createElement("label");
          nameLabel.className = "gte-prompt-form__label";
          nameLabel.textContent = "名称";
          const name = this.document.createElement("input");
          name.className = "gte-prompt-popup__input";
          name.name = "name";
          name.required = true;
          name.value = prompt?.name ?? "";
          nameLabel.appendChild(name);
          const contentLabel = this.document.createElement("label");
          contentLabel.className = "gte-prompt-form__label";
          contentLabel.textContent = "内容";
          const content = this.document.createElement("textarea");
          content.className = "gte-prompt-popup__textarea";
          content.name = "content";
          content.required = true;
          content.value = prompt?.content ?? "";
          contentLabel.appendChild(content);
          const actions = this.document.createElement("div");
          actions.className = "gte-prompt-form__actions";
          const cancel = this.makeButton("取消", "cancel-form", "gte-prompt-popup__button");
          const save = this.makeButton("保存", "save-form", "gte-prompt-popup__button gte-prompt-popup__button--primary");
          save.type = "button";
          actions.append(cancel, save);
          form.append(nameLabel, contentLabel, actions);
          this.popup.appendChild(form);
          this.formInputs = { name, content };
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            this.saveCurrentForm();
          });
          name.focus?.();
        }

        saveCurrentForm() {
          if (!this.formInputs) return false;
          this.saveForm(this.formInputs.name?.value ?? "", this.formInputs.content?.value ?? "");
          return true;
        }

        saveForm(name, content) {
          try {
            if (this.editingId) this.store.update(this.editingId, { name, content });
            else this.store.create({ name, content });
            this.query = "";
            this.selectedIndex = 0;
            this.renderListView();
          } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.renderFormError();
          }
        }

        renderFormError() {
          this.popup?.querySelector(".gte-prompt-popup__error")?.remove();
          const error = this.document.createElement("div");
          error.className = "gte-prompt-popup__error";
          error.textContent = this.error;
          this.popup?.appendChild(error);
        }

        handleClick(event) {
          const actionElement = event.target?.closest?.("[data-gte-action]");
          if (!actionElement || !this.popup?.contains(actionElement)) return;
          event.preventDefault?.();
          event.stopPropagation?.();
          const action = actionElement.dataset.gteAction;
          const id = actionElement.dataset.promptId;
          this.error = "";
          if (action === "close" || action === "cancel-form") this.close();
          else if (action === "save-form") this.saveCurrentForm();
          else if (action === "create") this.showForm();
          else if (action === "favorite" && id) { this.store.toggleFavorite(id); this.updateResults(); }
          else if (action === "edit" && id) this.showForm(this.store.get(id));
          else if (action === "delete" && id) {
            if (this.pendingDeleteId !== id) { this.pendingDeleteId = id; this.updateResults(); }
            else { this.store.delete(id); this.pendingDeleteId = null; this.updateResults(); }
          } else if (action === "insert" && id) void this.insert(id);
        }

        handleInput(event) {
          if (event.target?.matches?.(".gte-prompt-popup__search")) {
            this.query = event.target.value;
            this.selectedIndex = 0;
            this.error = "";
            this.updateResults();
          }
        }

        handleKeyDown(event) {
          if (!this.opened) return;
          if (event.key === "Escape") { event.preventDefault(); this.close(); return; }
          if (this.editingId !== null || this.popup?.querySelector("[data-gte-prompt-form]")) return;
          const results = this.store?.search(this.query) ?? [];
          if (!results.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            this.selectedIndex = event.key === "ArrowDown" ? Math.min(results.length - 1, this.selectedIndex + 1) : Math.max(0, this.selectedIndex - 1);
            this.updateResults();
            this.focusSelectedRow();
          } else if (event.key === "Enter") { event.preventDefault(); void this.insert(results[this.selectedIndex].id); }
        }

        focusSelectedRow() {
          const rows = this.popup ? [...this.popup.querySelectorAll(".gte-prompt-row__select")] : [];
          rows[this.selectedIndex]?.focus?.();
        }

        async insert(id) {
          const prompt = this.store?.get(id);
          if (!prompt) return;
          const result = await this.composer?.insertText(prompt.content);
          if (result?.ok) this.close();
        }

        getTriggerAnchorRect() {
          const anchorRect = this.anchor?.getBoundingClientRect?.();
          if (!anchorRect) return null;
          let top = anchorRect.top;
          let bottom = anchorRect.bottom;
          const footer = this.mountInfo?.footer;
          const footerRect = safeIsConnected(footer) ? footer.getBoundingClientRect?.() : null;
          if (footerRect
            && Number.isFinite(footerRect.top)
            && footerRect.top > top + TRIGGER_HIT_SIZE
            && footerRect.top < bottom) {
            bottom = footerRect.top;
          }
          if (bottom - top < TRIGGER_HIT_SIZE) {
            top = anchorRect.top;
            bottom = anchorRect.bottom;
          }
          return { ...anchorRect, top, bottom, height: Math.max(0, bottom - top) };
        }

        positionTrigger() {
          if (!this.button || !this.anchor) return false;
          const anchorRect = this.getTriggerAnchorRect();
          if (!anchorRect) return false;
          const viewportWidth = this.document.documentElement?.clientWidth || 1024;
          const viewportHeight = this.document.documentElement?.clientHeight || 768;
          const anchorHeight = Number.isFinite(anchorRect.height) ? anchorRect.height : Math.max(0, anchorRect.bottom - anchorRect.top);
          const desiredLeft = anchorRect.left - TRIGGER_GAP - TRIGGER_VISUAL_SIZE - TRIGGER_INSET;
          const desiredTop = anchorRect.top + Math.min(10, Math.max(4, (anchorHeight - TRIGGER_HIT_SIZE) / 2));
          const left = Math.max(4, Math.min(desiredLeft, viewportWidth - TRIGGER_HIT_SIZE - 4));
          const top = Math.max(4, Math.min(desiredTop, viewportHeight - TRIGGER_HIT_SIZE - 4));
          this.button.style.left = `${Math.round(left)}px`;
          this.button.style.top = `${Math.round(top)}px`;
          return true;
        }

        positionPopup() {
          if (!this.popup || !this.anchor) return false;
          const anchorRect = this.anchor.getBoundingClientRect?.();
          if (!anchorRect) return false;
          const viewportWidth = this.document.documentElement?.clientWidth || 1024;
          const viewportHeight = this.document.documentElement?.clientHeight || 768;
          const width = Math.min(POPUP_WIDTH, Math.max(240, viewportWidth - 16));
          const height = Math.min(POPUP_HEIGHT, Math.max(220, viewportHeight - 16));
          const left = Math.max(8, Math.min(anchorRect.left, viewportWidth - width - 8));
          const above = anchorRect.top - height - 10;
          const below = anchorRect.bottom + 10;
          const top = above >= 8 ? above : Math.max(8, Math.min(below, viewportHeight - height - 8));
          this.popup.style.width = `${Math.round(width)}px`;
          this.popup.style.maxHeight = `${Math.max(160, viewportHeight - 16)}px`;
          this.popup.style.left = `${Math.round(left)}px`;
          this.popup.style.top = `${Math.round(top)}px`;
          return true;
        }

        makeButton(label, action, className) {
          const button = this.document.createElement("button");
          button.type = "button";
          button.className = className;
          button.dataset.gteAction = action;
          button.textContent = label;
          return button;
        }

        unmountButton() {
          this.close();
          this.stopAnchorObserver();
          this.document?.removeEventListener?.("pointerdown", this.boundDocumentPointerDown, true);
          this.button?.removeEventListener("click", this.boundButtonClick, true);
          this.button?.remove();
          this.button = null;
          this.anchor = null;
          this.mountInfo = null;
        }

        destroy() {
          this.unmountButton();
          this.popup?.removeEventListener("click", this.boundPopupClick);
          this.popup?.removeEventListener("input", this.boundPopupInput);
          this.popup?.removeEventListener("keydown", this.boundPopupKeyDown);
          this.popup?.remove();
          this.popup = null;
          this.styleElement?.remove();
          this.styleElement = null;
        }
      }

      function removePromptArtifacts(documentRef = globalThis.document) {
        documentRef?.querySelectorAll?.(OWNED_SELECTORS.promptButton)?.forEach((element) => element.remove());
        documentRef?.querySelectorAll?.(OWNED_SELECTORS.promptPopup)?.forEach((element) => element.remove());
        documentRef?.querySelectorAll?.('style[data-gte-style="prompt-picker"]')?.forEach((element) => element.remove());
      }

      function showToast(documentRef, message, durationMs = 2600) {
        if (!documentRef?.body) return null;
        documentRef.querySelectorAll?.(OWNED_SELECTORS.toast)?.forEach((element) => element.remove());
        const toast = documentRef.createElement("div");
        toast.className = OWNED_CLASSES.toast;
        toast.dataset.gteComponent = "toast";
        toast.textContent = message;
        toast.setAttribute("role", "status");
        documentRef.body.appendChild(toast);
        setTimeout(() => toast.remove(), durationMs);
        return toast;
      }
      exports["PromptPicker"] = PromptPicker;
      exports["removePromptArtifacts"] = removePromptArtifacts;
      exports["showToast"] = showToast;
      return exports;
    },
    "src/core/virtualization-spike.js": (exports, __require) => {
      const { readEditorText } = __require("src/core/composer-adapter.js");
      async function runVirtualizationSpike({
        adapter,
        root,
        scrollContainer,
        editor = null,
        document: documentRef = globalThis.document,
        window: windowRef = globalThis.window,
        maxSteps = 256,
        settleMs = 80
      } = {}) {
        const startedAt = Date.now();
        if (!adapter || !root || !scrollContainer) {
          return failedSpike("missing-conversation-or-scroll-context", startedAt);
        }

        const before = captureUserState({ adapter, scrollContainer, editor, document: documentRef, window: windowRef });
        const initialBounds = adapter.getScrollBounds();
        const initialRenderedTurns = adapter.getRenderedUserTurns(root, scrollContainer);
        const metadata = new Map();
        const discoveredKeys = new Set();
        const positions = [];
        const step = Math.max(1, Math.floor(initialBounds.clientHeight * 0.8) || 1);
        const targets = buildScanTargets(initialBounds.maxLogicalPosition, step, maxSteps, before.logicalPosition);

        for (const target of targets) {
          adapter.setLogicalScrollPosition(target, { behavior: "auto", container: scrollContainer });
          await settle(windowRef, settleMs);
          const actualPosition = adapter.getLogicalScrollPosition();
          positions.push({ requested: target, actual: actualPosition });
          for (const turn of adapter.getRenderedUserTurns(root, scrollContainer)) {
            discoveredKeys.add(turn.key);
            metadata.set(turn.key, {
              key: turn.key,
              logicalOrder: turn.logicalOrder,
              approximatePosition: turn.approximatePosition,
              metadata: turn.metadata
            });
          }
        }

        const finalBounds = adapter.getScrollBounds();
        const setSizes = [...metadata.values()]
          .map((item) => item.metadata?.ariaSetsize)
          .filter((value) => Number.isFinite(value));
        const declaredSize = setSizes.length ? Math.max(...setSizes) : null;
        const reachedStart = positions.some((position) => Math.abs(position.actual - 0) <= 2);
        const reachedEnd = positions.some((position) => Math.abs(position.actual - finalBounds.maxLogicalPosition) <= 2);
        const reliableCoverage = declaredSize !== null && discoveredKeys.size >= declaredSize;
        const complete = reliableCoverage && reachedStart && reachedEnd;

        const restored = await restoreUserState({
          adapter,
          scrollContainer,
          state: before,
          document: documentRef,
          window: windowRef
        });
        const after = captureUserState({ adapter, scrollContainer, editor, document: documentRef, window: windowRef });
        const restoreDelta = Math.abs(after.logicalPosition - before.logicalPosition);
        const composerPreserved = before.composerText === after.composerText;
        const focusPreserved = before.activeElement === after.activeElement;
        const selectionPreserved = selectionsEqual(before.selection, after.selection);
        const noPersistentObserver = true;
        const pass = complete && restored && restoreDelta <= 2 && composerPreserved && focusPreserved && selectionPreserved && noPersistentObserver;

        const failureReasons = [];
        if (!reliableCoverage) failureReasons.push("no-reliable-total-turn-metadata");
        if (!reachedStart || !reachedEnd) failureReasons.push("virtual-scroll-range-not-confirmed");
        if (restoreDelta > 2) failureReasons.push(`scroll-restore-delta-${restoreDelta.toFixed(2)}px`);
        if (!composerPreserved) failureReasons.push("composer-content-changed");
        if (!focusPreserved) failureReasons.push("focus-not-restored");
        if (!selectionPreserved) failureReasons.push("selection-not-restored");

        return {
          pass,
          mode: pass ? "full" : "progressive",
          startedAt,
          completedAt: Date.now(),
          evidence: {
            initialBounds,
            finalBounds,
            flexDirection: initialBounds.flexDirection,
            isColumnReverse: initialBounds.isColumnReverse,
            renderedTurnCountAtStart: initialRenderedTurns.length,
            discoveredUserTurnCount: discoveredKeys.size,
            declaredSize,
            metadata: [...metadata.values()],
            positions,
            reachedStart,
            reachedEnd,
            restoreDelta,
            composerPreserved,
            focusPreserved,
            selectionPreserved,
            noPersistentObserver
          },
          failureReasons
        };
      }

      function captureUserState({ adapter, scrollContainer, editor, document: documentRef, window: windowRef } = {}) {
        const selection = captureSelection(documentRef, windowRef);
        return {
          logicalPosition: adapter?.getLogicalScrollPosition?.() ?? 0,
          physicalScrollTop: scrollContainer?.scrollTop ?? 0,
          activeElement: documentRef?.activeElement ?? null,
          selection,
          composerText: readEditorText(editor)
        };
      }

      async function restoreUserState({ adapter, scrollContainer, state, document: documentRef, window: windowRef } = {}) {
        if (!state) return false;
        adapter?.setLogicalScrollPosition?.(state.logicalPosition, { behavior: "auto", container: scrollContainer });
        await settle(windowRef, 0);
        if (state.activeElement && state.activeElement.isConnected !== false) {
          state.activeElement.focus?.();
        }
        restoreSelection(documentRef, windowRef, state.selection);
        return true;
      }

      function buildScanTargets(maxLogicalPosition, step, maxSteps, initialPosition) {
        const max = Math.max(0, maxLogicalPosition);
        const targets = [0];
        for (let position = step; position < max && targets.length < maxSteps - 1; position += step) {
          targets.push(position);
        }
        targets.push(max);
        if (Number.isFinite(initialPosition) && !targets.some((target) => Math.abs(target - initialPosition) <= 0.5)) {
          targets.push(initialPosition);
        }
        return [...new Set(targets)];
      }

      function captureSelection(documentRef, windowRef) {
        const selection = windowRef?.getSelection?.() ?? documentRef?.getSelection?.();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        return {
          anchorNode: selection.anchorNode,
          anchorOffset: selection.anchorOffset,
          focusNode: selection.focusNode,
          focusOffset: selection.focusOffset,
          range: typeof range.cloneRange === "function" ? range.cloneRange() : null
        };
      }

      function restoreSelection(documentRef, windowRef, selectionState) {
        if (!selectionState || !selectionState.anchorNode || !selectionState.focusNode) return false;
        if (selectionState.anchorNode.isConnected === false || selectionState.focusNode.isConnected === false) return false;
        const selection = windowRef?.getSelection?.() ?? documentRef?.getSelection?.();
        if (!selection) return false;
        try {
          selection.removeAllRanges();
          if (selectionState.range) selection.addRange(selectionState.range);
          if (typeof selection.setBaseAndExtent === "function") {
            selection.setBaseAndExtent(
              selectionState.anchorNode,
              selectionState.anchorOffset,
              selectionState.focusNode,
              selectionState.focusOffset
            );
          }
          return true;
        } catch {
          return false;
        }
      }

      function selectionsEqual(left, right) {
        if (!left || !right) return left === right;
        return left.anchorNode === right.anchorNode
          && left.anchorOffset === right.anchorOffset
          && left.focusNode === right.focusNode
          && left.focusOffset === right.focusOffset;
      }

      async function settle(windowRef, milliseconds) {
        if (milliseconds <= 0) {
          await Promise.resolve();
          return;
        }
        await new Promise((resolve) => {
          const setTimer = windowRef?.setTimeout ?? setTimeout;
          setTimer(resolve, milliseconds);
        });
      }

      function failedSpike(reason, startedAt) {
        return {
          pass: false,
          mode: "progressive",
          startedAt,
          completedAt: Date.now(),
          evidence: {
            initialBounds: null,
            finalBounds: null,
            flexDirection: null,
            isColumnReverse: null,
            renderedTurnCountAtStart: 0,
            discoveredUserTurnCount: 0,
            declaredSize: null,
            metadata: [],
            positions: [],
            reachedStart: false,
            reachedEnd: false,
            restoreDelta: null,
            composerPreserved: null,
            focusPreserved: null,
            selectionPreserved: null,
            noPersistentObserver: true
          },
          failureReasons: [reason]
        };
      }

      exports["runVirtualizationSpike"] = runVirtualizationSpike;
      exports["restoreUserState"] = restoreUserState;
      exports["captureUserState"] = captureUserState;
      return exports;
    },
    "src/app.js": (exports, __require) => {
      const { VERSION, STORAGE_KEYS, TIMELINE_MODE } = __require("src/core/constants.js");
      const { CodexAdapter } = __require("src/core/codex-adapter.js");
      const { TurnRegistry } = __require("src/core/turn-registry.js");
      const { RenderedTracker } = __require("src/core/rendered-tracker.js");
      const { ConversationObserver } = __require("src/core/conversation-observer.js");
      const { RootObserver } = __require("src/core/root-observer.js");
      const { ActiveTracker } = __require("src/core/active-tracker.js");
      const { TimelineRenderer, removeTimelineArtifacts } = __require("src/core/timeline-renderer.js");
      const { LocalStorageAdapter, SettingsStore } = __require("src/core/storage-adapter.js");
      const { PromptStore } = __require("src/core/prompt-store.js");
      const { ComposerAdapter } = __require("src/core/composer-adapter.js");
      const { NoOpBridgeAdapter } = __require("src/core/bridge-adapter.js");
      const { PromptPicker, removePromptArtifacts, showToast } = __require("src/core/prompt-picker.js");
      const { safeIsConnected } = __require("src/core/dom-utils.js");
      const { runVirtualizationSpike } = __require("src/core/virtualization-spike.js");
      class TalkEnhancerApp {
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

      function cleanupOwnedUi(documentRef = globalThis.document) {
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

      exports["TalkEnhancerApp"] = TalkEnhancerApp;
      exports["cleanupOwnedUi"] = cleanupOwnedUi;
      return exports;
    },
    "src/core/chatgpt-extension-adapter.js": (exports, __require) => {
      const { CodexAdapter } = __require("src/core/codex-adapter.js");
      const { elementText, queryAll, safeIsConnected, shortenText } = __require("src/core/dom-utils.js");
      // GPL-derived adaptation from houyanchao/chatgpt-gemini-timeline
      // See extension/NOTICE.md and extension/THIRD_PARTY_GPL-3.0.txt.
      class ChatGPTExtensionAdapter extends CodexAdapter {
        constructor(options = {}) {
          super(options);
          this._turnTextCache = new Map();
          this._capturedTextIds = new Set();
          this._textCacheConvId = null;
        }

        extractConversationId(pathname = this.window?.location?.pathname ?? "") {
          const segments = String(pathname).split("/").filter(Boolean);
          const gIndex = segments.indexOf("g");
          if (gIndex >= 0 && segments[gIndex + 2] === "c") return segments[gIndex + 3] || null;
          const cIndex = segments.indexOf("c");
          if (cIndex >= 0) return segments[cIndex + 1] || null;
          const shareIndex = segments.indexOf("share");
          if (shareIndex >= 0) return segments[shareIndex + 1] === "e" ? segments[shareIndex + 2] || null : segments[shareIndex + 1] || null;
          return null;
        }

        getConversationIdentity(root = this.getConversationRoot()) {
          const conversationId = this.extractConversationId();
          return conversationId ? `chatgpt:${conversationId}` : super.getConversationIdentity(root);
        }

        _cacheTurnText(nodeId, text) {
          const compact = String(text || "").replace(/\s+/g, " ").trim();
          if (!nodeId || !compact) return;
          const value = compact.length > 240 ? compact.slice(0, 240) : compact;
          if (!this._turnTextCache.has(nodeId) && this._turnTextCache.size >= 3000) {
            const oldest = this._turnTextCache.keys().next().value;
            this._turnTextCache.delete(oldest);
          }
          this._turnTextCache.set(nodeId, value);
        }

        _pullCapturedTexts(conversationId) {
          if (!conversationId || !this.document?.dispatchEvent) return 0;
          let received = null;
          const handler = (event) => {
            if (typeof event.detail !== "string") return;
            try {
              const payload = JSON.parse(event.detail);
              if (payload?.conversationId === conversationId) received = payload;
            } catch {
              received = null;
            }
          };
          this.document.addEventListener?.("ait-gpt-user-texts-result", handler, { once: true });
          this.document.dispatchEvent(new CustomEvent("ait-gpt-user-texts-pull", { detail: conversationId }));
          this.document.removeEventListener?.("ait-gpt-user-texts-result", handler);
          const texts = received?.texts;
          if (!texts) return 0;
          const nextCaptured = new Set(Object.keys(texts));
          let changed = 0;
          for (const id of this._capturedTextIds) {
            if (!nextCaptured.has(id) && this._turnTextCache.delete(id)) changed += 1;
          }
          for (const [id, text] of Object.entries(texts)) {
            const before = this._turnTextCache.get(id);
            this._cacheTurnText(id, text);
            if (this._turnTextCache.get(id) !== before) changed += 1;
          }
          this._capturedTextIds = nextCaptured;
          return changed;
        }

        syncCapturedChatsData() {
          const conversationId = this.extractConversationId();
          if (!conversationId || conversationId === this._textCacheConvId) return 0;
          this._textCacheConvId = conversationId;
          this._turnTextCache.clear();
          this._capturedTextIds.clear();
          return this._pullCapturedTexts(conversationId);
        }

        subscribeCapturedChatsDataUpdated(callback) {
          if (typeof callback !== "function" || !this.document?.addEventListener) return () => {};
          const handler = (event) => {
            const conversationId = typeof event.detail === "string" ? event.detail : "";
            if (!conversationId || conversationId !== this.extractConversationId()) return;
            if (this._textCacheConvId !== conversationId) {
              this._textCacheConvId = conversationId;
              this._turnTextCache.clear();
              this._capturedTextIds.clear();
            }
            const changedCount = this._pullCapturedTexts(conversationId);
            if (changedCount > 0) callback({ conversationId, changedCount });
          };
          this.document.addEventListener("ait-gpt-user-texts-updated", handler);
          return () => this.document.removeEventListener("ait-gpt-user-texts-updated", handler);
        }

        _markTurnRoles() {
          const all = queryAll(this.document, ['[data-turn-id-container][data-is-intersecting]']);
          if (!all.length) return [];
          const seen = new Set();
          const containers = [];
          for (const element of all) {
            const id = element.getAttribute?.("data-turn-id-container");
            if (!id || seen.has(id)) continue;
            seen.add(id);
            containers.push(element);
          }
          const roles = new Array(containers.length).fill(null);
          let nextRole = null;
          for (let index = containers.length - 1; index >= 0; index -= 1) {
            const real = containers[index].querySelector?.("[data-turn]")?.getAttribute?.("data-turn");
            let role = real === "user" || real === "assistant" ? real : null;
            if (!role && nextRole) role = nextRole === "user" ? "assistant" : "user";
            roles[index] = role;
            if (role) nextRole = role;
          }
          if (roles[0] === "assistant") roles[0] = null;
          containers.forEach((element, index) => {
            const role = roles[index];
            const id = element.getAttribute?.("data-turn-id-container");
            if (role === "user" && id && !this._turnTextCache.has(id)) {
              const text = element.querySelector?.(".whitespace-pre-wrap")?.textContent;
              if (text) this._cacheTurnText(id, text);
            }
            if (role) element.setAttribute?.("data-gte-turn", role);
            else element.removeAttribute?.("data-gte-turn");
          });
          return containers;
        }

        extractTurnText(turnElement) {
          const key = this.getTurnKey(turnElement);
          const renderedText = turnElement?.querySelector?.(".whitespace-pre-wrap")?.textContent
            || turnElement?.querySelector?.('[data-user-message-bubble="true"]')?.textContent
            || turnElement?.querySelector?.('[data-markdown-text-tone="user-message"]')?.textContent
            || elementText(turnElement);
          const compact = String(renderedText || "").replace(/\s+/g, " ").trim();
          if (compact) {
            if (key) this._cacheTurnText(key, compact);
            return compact;
          }
          if (key && this._turnTextCache.has(key)) return this._turnTextCache.get(key);
          return Number(turnElement?.childElementCount) === 0 ? "[未加载的提问]" : "[图片或文件]";
        }

        getRenderedUserTurns(root = this.getConversationRoot(), container = this.getScrollContainer(root)) {
          if (!root) return [];
          this.syncCapturedChatsData();
          const containers = this._markTurnRoles();
          const virtualizedUsers = containers.filter((element) => element.getAttribute?.("data-gte-turn") === "user");
          if (!virtualizedUsers.length) return super.getRenderedUserTurns(root, container);
          const turns = [];
          const seenKeys = new Set();
          virtualizedUsers.forEach((turnElement, domIndex) => {
            if (!safeIsConnected(turnElement)) return;
            const key = this.getTurnKey(turnElement);
            if (!key || seenKeys.has(key)) return;
            seenKeys.add(key);
            const text = this.extractTurnText(turnElement);
            const metadata = this.readTurnMetadata(turnElement);
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
      }

      exports["ChatGPTExtensionAdapter"] = ChatGPTExtensionAdapter;
      return exports;
    },
    "src/extension-controller.js": (exports, __require) => {
      const { TalkEnhancerApp, cleanupOwnedUi } = __require("src/app.js");
      const { ChatGPTExtensionAdapter } = __require("src/core/chatgpt-extension-adapter.js");
      const MEDIA_OVERLAY_SELECTORS = [
        '[role="dialog"] img',
        '[role="dialog"] video',
        '[data-testid*="image-viewer"]',
        '[data-testid*="lightbox"]',
        '[data-testid*="media-viewer"]'
      ];

      class ExtensionController {
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

      exports["ExtensionController"] = ExtensionController;
      return exports;
    },
    "src/extension-entry.js": (exports, __require) => {
      const { ExtensionController } = __require("src/extension-controller.js");
      const start = () => {
        document.documentElement?.setAttribute?.("data-gte-extension-active", "true");
        document.dispatchEvent(new CustomEvent("gte:extension-active"));
        const previous = window.__GPTTalkEnhancerExtension;
        previous?.destroy?.();
        const controller = new ExtensionController({ document, window });
        window.__GPTTalkEnhancerExtension = controller;
        controller.start();
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
      } else {
        start();
      }

      return exports;
    },
  };
  const __cache = Object.create(null);
  const __require = (id) => {
    if (__cache[id]) return __cache[id];
    const factory = __modules[id];
    if (!factory) throw new Error(`GPT TalkEnhancer extension module not found: ${id}`);
    const exports = {};
    __cache[id] = exports;
    factory(exports, __require);
    return exports;
  };
  __require("src/extension-entry.js");
})();
