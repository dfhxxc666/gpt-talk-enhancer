import { OWNED_CLASSES, OWNED_SELECTORS } from "./constants.js";
import { safeIsConnected, shortenText } from "./dom-utils.js";

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

export class PromptPicker {
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

export function removePromptArtifacts(documentRef = globalThis.document) {
  documentRef?.querySelectorAll?.(OWNED_SELECTORS.promptButton)?.forEach((element) => element.remove());
  documentRef?.querySelectorAll?.(OWNED_SELECTORS.promptPopup)?.forEach((element) => element.remove());
  documentRef?.querySelectorAll?.('style[data-gte-style="prompt-picker"]')?.forEach((element) => element.remove());
}

export function showToast(documentRef, message, durationMs = 2600) {
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