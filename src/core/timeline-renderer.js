import { OWNED_CLASSES, OWNED_SELECTORS, TIMELINE_MODE } from "./constants.js";
import { shortenText } from "./dom-utils.js";

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

export class TimelineRenderer {
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

export function removeTimelineArtifacts(documentRef = globalThis.document) {
  documentRef?.querySelectorAll?.(OWNED_SELECTORS.timeline)?.forEach((element) => element.remove());
  documentRef?.querySelectorAll?.('style[data-gte-style="timeline"]')?.forEach((element) => element.remove());
}
