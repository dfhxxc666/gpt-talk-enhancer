import { sampleRailMarkers } from "../../core/timeline-state.js";
import { normalizeQuestionDisplayText } from "../../core/question-display.js";

export class TimelineRail {
  constructor({ document, onSelect, onTogglePanel, maxMarkers = 28 } = {}) {
    this.document = document ?? globalThis.document;
    this.onSelect = onSelect ?? (() => {});
    this.onTogglePanel = onTogglePanel ?? (() => {});
    this.maxMarkers = maxMarkers;
    this.element = null;
    this.markers = null;
    this.toggle = null;
    this.signature = "";
    this.rightInset = 10;
    this.pendingTurnId = null;
  }

  mount(root) {
    if (this.element) return this.element;
    const rail = this.document.createElement("nav");
    rail.className = "gte-timeline-rail";
    rail.setAttribute("aria-label", "Conversation timeline");

    const markers = this.document.createElement("div");
    markers.className = "gte-rail-markers";

    const toggle = this.document.createElement("button");
    toggle.type = "button";
    toggle.className = "gte-rail-toggle";
    toggle.textContent = "\u2637";
    toggle.title = "提问列表";
    toggle.setAttribute("aria-label", "提问列表");
    toggle.addEventListener("click", () => this.onTogglePanel());

    rail.append(markers, toggle);
    root.append(rail);
    this.element = rail;
    this.markers = markers;
    this.toggle = toggle;
    this.setRightInset(this.rightInset);
    return rail;
  }

  setState(turns, activeTurnId) {
    if (!this.markers) return;
    const source = Array.isArray(turns) ? turns : [];
    const sampled = sampleRailMarkers(source, activeTurnId, this.maxMarkers);
    const nextSignature = sampled.map((turn) => `${turn.id}:${turn.order}`).join("|") + `|${activeTurnId ?? ""}`;
    if (nextSignature === this.signature) return;
    this.signature = nextSignature;
    this.markers.replaceChildren();

    const finiteOrders = source.map((turn, index) => Number.isFinite(turn?.order) ? Number(turn.order) : index);
    const maxOrder = Math.max(0, ...finiteOrders);
    for (const [sampleIndex, turn] of sampled.entries()) {
      const sourceIndex = source.findIndex((candidate) => candidate.id === turn.id);
      const order = Number.isFinite(turn?.order) ? Number(turn.order) : Math.max(0, sourceIndex);
      const ratio = maxOrder > 0 ? Math.max(0, Math.min(1, order / maxOrder)) : sampled.length <= 1 ? 0 : sampleIndex / (sampled.length - 1);
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "gte-rail-marker";
      if (turn.id === activeTurnId) button.classList.add("is-active");
      if (turn.id === this.pendingTurnId) button.classList.add("is-pending");
      button.dataset.turnId = turn.id;
      button.dataset.turnOrder = String(order);
      button.style.top = `${(ratio * 100).toFixed(3)}%`;
      const displayText = normalizeQuestionDisplayText(turn.text);
      const shortText = compactRailTooltip(displayText);
      button.title = shortText ? `Q${order + 1} · ${shortText}` : `Q${order + 1}`;
      button.setAttribute("aria-label", displayText ? `Q${order + 1} ${displayText}` : `Q${order + 1}`);
      button.addEventListener("click", () => this.onSelect(turn.id));
      this.markers.append(button);
    }
  }

  setPending(turnId) {
    if (this.pendingTurnId === turnId) return;
    const previous = this.pendingTurnId;
    this.pendingTurnId = turnId ?? null;
    if (previous) this.findMarker(previous)?.classList.remove("is-pending");
    if (this.pendingTurnId) this.findMarker(this.pendingTurnId)?.classList.add("is-pending");
  }

  findMarker(turnId) {
    if (!turnId || !this.markers) return null;
    for (const marker of this.markers.children ?? []) if (marker.dataset?.turnId === turnId) return marker;
    return null;
  }

  setRightInset(value) {
    const numeric = Number(value);
    this.rightInset = Number.isFinite(numeric) ? Math.max(10, Math.round(numeric)) : 10;
    if (this.element) this.element.style.right = `${this.rightInset}px`;
    return this.rightInset;
  }

  setVisible(visible) {
    if (this.element) this.element.hidden = !visible;
  }

  getAnchorRect() {
    return this.element?.getBoundingClientRect?.() ?? null;
  }

  destroy() {
    this.element?.remove?.();
    this.element = null;
    this.markers = null;
    this.toggle = null;
    this.pendingTurnId = null;
  }
}

function compactRailTooltip(value, maxLength = 18) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}
