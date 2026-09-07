const DEFAULT_CAPTURE = Object.freeze({ status: "unavailable", turnCount: 0, lastError: "" });

export class ConversationStore {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.states = new Map();
    this.activeConversationId = null;
  }

  ensureConversation(conversationId, route = "") {
    if (!conversationId) return null;
    const existing = this.states.get(conversationId);
    const state = existing ?? {
      conversationId,
      route,
      turnCount: 0,
      activeTurnId: null,
      captureStatus: { ...DEFAULT_CAPTURE },
      lastUpdated: this.clock()
    };
    if (route) state.route = route;
    if (!existing) this.states.set(conversationId, state);
    return state;
  }

  activateConversation(conversationId, route = "") {
    if (!conversationId) {
      this.activeConversationId = null;
      return null;
    }
    const state = this.ensureConversation(conversationId, route);
    state.lastUpdated = this.clock();
    this.activeConversationId = conversationId;
    return state;
  }

  update(conversationId, patch = {}) {
    const state = this.ensureConversation(conversationId);
    if (!state) return null;
    Object.assign(state, patch, { lastUpdated: this.clock() });
    return state;
  }

  setCaptureStatus(conversationId, captureStatus) {
    return this.update(conversationId, {
      captureStatus: { ...DEFAULT_CAPTURE, ...(captureStatus ?? {}) }
    });
  }

  setActiveTurn(conversationId, activeTurnId) {
    return this.update(conversationId, { activeTurnId: activeTurnId ?? null });
  }

  get(conversationId) {
    return this.states.get(conversationId) ?? null;
  }

  getActive() {
    return this.activeConversationId ? this.get(this.activeConversationId) : null;
  }

  snapshot(conversationId = this.activeConversationId) {
    const state = conversationId ? this.get(conversationId) : null;
    return state ? { ...state, captureStatus: { ...state.captureStatus } } : null;
  }
}
