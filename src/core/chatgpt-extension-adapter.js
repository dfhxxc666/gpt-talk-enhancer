import { CodexAdapter } from "./codex-adapter.js";
import { elementText, queryAll, safeIsConnected, shortenText } from "./dom-utils.js";

// GPL-derived adaptation from houyanchao/chatgpt-gemini-timeline
// See extension/NOTICE.md and extension/THIRD_PARTY_GPL-3.0.txt.
export class ChatGPTExtensionAdapter extends CodexAdapter {
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
