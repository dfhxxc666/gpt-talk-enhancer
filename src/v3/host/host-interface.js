export const SURFACE = Object.freeze({
  NEW_CHAT: "NEW_CHAT",
  CONVERSATION: "CONVERSATION",
  MEDIA_VIEWER: "MEDIA_VIEWER",
  SETTINGS: "SETTINGS",
  PLUGIN_MANAGER: "PLUGIN_MANAGER",
  OTHER: "OTHER"
});

export class HostInterface {
  getSurface() { return SURFACE.OTHER; }
  getConversationId() { return null; }
  getConversationIdentity() { return null; }
  getVisibleTurns() { return []; }
  resolveTurn(_turnId) { return null; }
  navigateToTurn(_turnId, _context) { return Promise.resolve({ ok: false, reason: "not-implemented" }); }
  getComposer() { return null; }
  getComposerRect() { return null; }
  getConversationViewportElement() { return null; }
  getConversationViewportRect() { return null; }
  insertPrompt(_text) { return { ok: false, reason: "not-implemented" }; }
  isMediaViewerOpen() { return false; }
  getCompatibilityReport() { return null; }
  getNavigationCompatibility() { return null; }
  getTheme() { return "dark"; }
  destroy() {}
}
