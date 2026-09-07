export class TimelineState {
  constructor({ maxRailMarkers = 14 } = {}) {
    this.states = new Map();
    this.maxRailMarkers = maxRailMarkers;
  }

  get(conversationId) {
    if (!conversationId) return defaultState(this.maxRailMarkers);
    if (!this.states.has(conversationId)) this.states.set(conversationId, defaultState(this.maxRailMarkers));
    return this.states.get(conversationId);
  }

  update(conversationId, patch) {
    const state = this.get(conversationId);
    Object.assign(state, patch);
    return state;
  }
}

export function sampleRailMarkers(turns, activeTurnId, maxMarkers = 14) {
  const ordered = Array.isArray(turns) ? turns : [];
  const limit = Math.max(2, Number(maxMarkers) || 14);
  if (ordered.length <= limit) return [...ordered];

  const indexes = new Set([0, ordered.length - 1]);
  for (let slot = 1; slot < limit - 1; slot += 1) {
    indexes.add(Math.round((slot * (ordered.length - 1)) / (limit - 1)));
  }

  const activeIndex = ordered.findIndex((turn) => turn.id === activeTurnId);
  if (activeIndex >= 0 && !indexes.has(activeIndex)) {
    let replace = null;
    let bestDistance = Infinity;
    for (const index of indexes) {
      if (index === 0 || index === ordered.length - 1) continue;
      const distance = Math.abs(index - activeIndex);
      if (distance < bestDistance) {
        bestDistance = distance;
        replace = index;
      }
    }
    if (replace != null) indexes.delete(replace);
    indexes.add(activeIndex);
  }

  return [...indexes].sort((a, b) => a - b).slice(0, limit).map((index) => ordered[index]);
}

function defaultState(maxRailMarkers) {
  return {
    panelOpen: false,
    manualBrowse: false,
    followActive: true,
    anchorTurnId: null,
    anchorOffset: 0,
    maxRailMarkers
  };
}
