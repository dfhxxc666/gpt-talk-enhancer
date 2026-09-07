const CAPTURE_OWNER_KEY = "__GPTTalkEnhancerV3CaptureOwner";
const CONVERSATION_PATH = /^\/backend-api\/conversation\/([^/?#]+)\/?$/;

export class ConversationCapture {
  constructor({ window, onCapture, onStatus } = {}) {
    this.window = window ?? globalThis.window;
    this.onCapture = onCapture ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.originalFetch = null;
    this.wrapper = null;
    this.installed = false;
  }

  install() {
    const win = this.window;
    if (!win || typeof win.fetch !== "function") {
      this.onStatus({ status: "unavailable", lastError: "fetch-unavailable" });
      return false;
    }
    win[CAPTURE_OWNER_KEY]?.dispose?.();
    this.originalFetch = win.fetch;
    const owner = this;
    this.wrapper = function gteConversationFetch(input, init) {
      const pending = owner.originalFetch.call(this, input, init);
      Promise.resolve(pending).then((response) => owner.inspect(input, init, response)).catch(() => {});
      return pending;
    };
    win.fetch = this.wrapper;
    win[CAPTURE_OWNER_KEY] = { dispose: () => this.dispose() };
    this.installed = true;
    this.onStatus({ status: "active", lastError: "" });
    return true;
  }

  inspect(input, init, response) {
    const match = matchConversationRequest(input, init, this.window?.location?.href);
    if (!match || !response?.clone) return;
    let clone;
    try { clone = response.clone(); } catch { return; }
    Promise.resolve(clone.json()).then((payload) => {
      const turns = parseConversationPayload(payload);
      this.onCapture({ conversationId: match.conversationId, turns, payload });
      this.onStatus({ status: "active", turnCount: turns.length, lastError: "" });
    }).catch((error) => {
      this.onStatus({ status: "degraded", lastError: String(error?.message ?? error) });
    });
  }

  dispose() {
    if (!this.installed) return;
    if (this.window?.fetch === this.wrapper && this.originalFetch) this.window.fetch = this.originalFetch;
    if (this.window?.[CAPTURE_OWNER_KEY]?.dispose) delete this.window[CAPTURE_OWNER_KEY];
    this.installed = false;
    this.wrapper = null;
    this.originalFetch = null;
  }
}

export function matchConversationRequest(input, init = {}, baseUrl = "https://chatgpt.com/") {
  const method = String(init?.method ?? input?.method ?? "GET").toUpperCase();
  if (method !== "GET") return null;
  const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
  if (!rawUrl) return null;
  let url;
  try { url = new URL(rawUrl, baseUrl); } catch { return null; }
  const match = url.pathname.match(CONVERSATION_PATH);
  return match ? { conversationId: decodeURIComponent(match[1]), url: url.href } : null;
}

export function parseConversationPayload(payload) {
  const mapping = payload?.mapping;
  const currentNode = payload?.current_node;
  if (!mapping || typeof mapping !== "object" || !currentNode) return [];
  const branch = [];
  const visited = new Set();
  let nodeId = currentNode;
  while (nodeId && !visited.has(nodeId)) {
    visited.add(nodeId);
    const node = mapping[nodeId];
    if (!node) break;
    branch.push(node);
    nodeId = node.parent ?? null;
  }
  branch.reverse();
  const turns = [];
  for (const node of branch) {
    const message = node?.message;
    if (message?.author?.role !== "user") continue;
    const text = extractVisibleText(message?.content);
    if (!text) continue;
    turns.push({
      id: String(node.id ?? message.id ?? ""),
      order: turns.length,
      text,
      type: "text",
      source: "capture",
      visible: false,
      lastSeen: Date.now()
    });
  }
  return turns.filter((turn) => turn.id);
}

export function extractVisibleText(content) {
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = [];
  for (const part of parts) {
    if (typeof part === "string") text.push(part);
    else if (part && typeof part === "object" && typeof part.text === "string") text.push(part.text);
  }
  return text.join("\n").replace(/\s+/g, " ").trim();
}
