import { SURFACE } from "../host-interface.js";

export class SurfaceDetector {
  constructor({ document, window, conversationAdapter, overlayDetector } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
    this.conversationAdapter = conversationAdapter;
    this.overlayDetector = overlayDetector;
  }

  getSurface() {
    if (this.overlayDetector?.isMediaViewerOpen?.()) return SURFACE.MEDIA_VIEWER;
    const route = String(this.window?.location?.pathname ?? "").toLowerCase();
    if (/(^|\/)settings?(\/|$)/.test(route)) return SURFACE.SETTINGS;
    if (/(^|\/)(plugins?|skills?|mcp)(\/|$)/.test(route)) return SURFACE.PLUGIN_MANAGER;
    if (this.conversationAdapter?.getConversationId?.()) return SURFACE.CONVERSATION;
    if (this.conversationAdapter?.hasVisibleConversationContent?.()) return SURFACE.CONVERSATION;
    if (this.document?.querySelector?.("#prompt-textarea")
      ?? this.document?.querySelector?.("[contenteditable='true'][role='textbox']")) return SURFACE.NEW_CHAT;
    return SURFACE.OTHER;
  }
}
