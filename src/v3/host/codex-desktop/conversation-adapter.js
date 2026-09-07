const CHATGPT_CONVERSATION_PREFIX = "chatgpt:conversation:";
const STABLE_LOCAL_THREAD = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSidebarConversationKey(value) {
  const key = String(value ?? "").trim();
  if (!key) return null;
  if (key.startsWith(CHATGPT_CONVERSATION_PREFIX)) {
    return key.slice(CHATGPT_CONVERSATION_PREFIX.length) || null;
  }
  return key;
}

export function isStableLocalThreadIdentity(value, { host = "", kind = "" } = {}) {
  return String(host).toLowerCase() === "local"
    && String(kind).toLowerCase() === "local"
    && STABLE_LOCAL_THREAD.test(String(value ?? "").trim());
}

export class ConversationAdapter {
  constructor({ document, window } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
  }

  getConversationId() {
    return this.getConversationIdentity()?.id ?? null;
  }

  getConversationIdentity() {
    const pathname = String(this.window?.location?.pathname ?? "");
    const routeMatch = pathname.match(/\/(?:c|conversation|chat)\/([^/?#]+)/i);
    if (routeMatch?.[1]) {
      return { id: decodeURIComponent(routeMatch[1]), source: "route", host: "chatgpt", kind: "conversation", stable: true };
    }

    const selectedLocal = this.getSelectedLocalThreadRow();
    const localId = selectedLocal?.getAttribute?.("data-app-action-sidebar-thread-id");
    const host = selectedLocal?.getAttribute?.("data-app-action-sidebar-thread-host-id") ?? "";
    const kind = selectedLocal?.getAttribute?.("data-app-action-sidebar-thread-kind") ?? "";
    if (isStableLocalThreadIdentity(localId, { host, kind })) {
      return { id: String(localId), source: "sidebar-local", host: "local", kind: "local", stable: true };
    }

    const selectedChatgpt = this.getSelectedChatgptConversationId();
    if (selectedChatgpt) {
      return { id: selectedChatgpt, source: "sidebar-chatgpt", host: "chatgpt", kind: "conversation", stable: true };
    }

    const explicit = this.document?.querySelector?.("[data-conversation-id], [data-thread-id]");
    const explicitId = explicit?.getAttribute?.("data-conversation-id")
      || explicit?.getAttribute?.("data-thread-id")
      || null;
    return explicitId
      ? { id: String(explicitId), source: "dom-explicit", host: null, kind: null, stable: false }
      : null;
  }

  getSelectedLocalThreadRow() {
    return this.document?.querySelector?.(
      "[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected='true'], [data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active='true']"
    ) ?? null;
  }

  getSelectedChatgptConversationId() {
    const rows = this.document?.querySelectorAll?.("[data-sidebar-chatgpt-conversation-key]") ?? [];
    for (const row of rows) {
      const selected = row?.getAttribute?.("aria-current") === "page"
        || Boolean(row?.querySelector?.("[aria-current='page']"));
      if (!selected) continue;
      const value = row?.getAttribute?.("data-sidebar-chatgpt-conversation-key");
      const parsed = parseSidebarConversationKey(value);
      if (parsed) return parsed;
    }
    return null;
  }

  getRoute() {
    const location = this.window?.location;
    return `${location?.pathname ?? ""}${location?.search ?? ""}${location?.hash ?? ""}`;
  }

  getStableConversationRoot() {
    return this.document?.querySelector?.("[data-thread-find-target='conversation']")
      ?? this.document?.querySelector?.("[data-chatgpt-conversation-selection-target='true']")
      ?? this.document?.querySelector?.("main [data-testid='conversation-turn-list']")
      ?? null;
  }

  isVisibleConversationRoot(root) {
    if (!root || root.isConnected === false || root.hidden === true) return false;
    const style = this.window?.getComputedStyle?.(root);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    const rect = root.getBoundingClientRect?.();
    return !rect || (Number(rect.width) > 0 && Number(rect.height) > 0);
  }

  hasVisibleConversationContent() {
    const root = this.getStableConversationRoot();
    if (!this.isVisibleConversationRoot(root)) return false;
    return Boolean(this.document?.querySelector?.(
      "[data-markdown-text-tone='user-message'], [data-turn-key], [data-content-search-turn-key], [data-turn-id], [data-turn-id-container]"
    ));
  }

  getConversationRoot() {
    return this.getStableConversationRoot()
      ?? this.document?.querySelector?.("main")
      ?? null;
  }

  getScrollContainer() {
    const root = this.getConversationRoot();
    let node = root;
    while (node && node !== this.document?.body) {
      const style = this.window?.getComputedStyle?.(node);
      const overflowY = style?.overflowY ?? "";
      if ((overflowY === "auto" || overflowY === "scroll") && Number(node.scrollHeight) > Number(node.clientHeight)) return node;
      node = node.parentElement;
    }
    return this.document?.scrollingElement ?? this.document?.documentElement ?? this.document?.body ?? null;
  }
}
