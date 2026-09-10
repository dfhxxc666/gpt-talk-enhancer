export class ComposerAdapter {
  constructor({ document, window } = {}) {
    this.document = document ?? globalThis.document;
    this.window = window ?? globalThis.window;
  }

  getComposer() {
    return this.document?.querySelector?.("#prompt-textarea")
      ?? this.document?.querySelector?.("textarea[placeholder]")
      ?? this.document?.querySelector?.("[contenteditable='true'][role='textbox']")
      ?? null;
  }

  getComposerForm() {
    const composer = this.getComposer();
    if (!composer) return null;
    const composerRect = composer.getBoundingClientRect?.() ?? null;
    const form = composer.closest?.("form") ?? null;
    if (form && isUsableComposerAnchor(form.getBoundingClientRect?.() ?? null, composerRect)) return form;
    const parent = composer.parentElement ?? null;
    if (parent && isUsableComposerAnchor(parent.getBoundingClientRect?.() ?? null, composerRect)) return parent;
    return composer;
  }

  getComposerRect() {
    const composer = this.getComposer();
    if (!composer) return null;
    const composerRect = composer.getBoundingClientRect?.() ?? null;
    const anchor = this.getComposerForm();
    const anchorRect = anchor?.getBoundingClientRect?.() ?? null;
    return isUsableComposerAnchor(anchorRect, composerRect) ? anchorRect : composerRect;
  }

  insertText(text) {
    const composer = this.getComposer();
    if (!composer) return { ok: false, reason: "composer-not-found" };
    const insertion = String(text ?? "");
    if (!insertion) return { ok: false, reason: "empty-prompt" };
    const before = readComposerText(composer);
    composer.focus?.();
    const inserted = isTextControl(composer)
      ? insertIntoTextControl(composer, insertion)
      : insertIntoEditable(composer, insertion, this.document, this.window);
    if (inserted) dispatchInput(composer, this.window);
    const after = readComposerText(composer);
    const ok = inserted && after !== before && after.includes(insertion);
    return { ok, reason: ok ? "inserted" : "readback-failed", before, after };
  }
}

export function readComposerText(composer) {
  if (!composer) return "";
  if (isTextControl(composer)) return String(composer.value ?? "");
  return String(composer.innerText ?? composer.textContent ?? "");
}

function isTextControl(element) {
  return element && "value" in element && typeof element.value === "string";
}

function insertIntoTextControl(composer, insertion) {
  const start = Number.isFinite(composer.selectionStart) ? composer.selectionStart : composer.value.length;
  const end = Number.isFinite(composer.selectionEnd) ? composer.selectionEnd : start;
  composer.value = `${composer.value.slice(0, start)}${insertion}${composer.value.slice(end)}`;
  try { composer.selectionStart = composer.selectionEnd = start + insertion.length; } catch {}
  return true;
}

function insertIntoEditable(composer, insertion, documentRef, windowRef) {
  const selection = windowRef?.getSelection?.();
  let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !composer.contains?.(range.commonAncestorContainer)) {
    range = documentRef?.createRange?.();
    if (!range) return false;
    range.selectNodeContents?.(composer);
    range.collapse?.(false);
  }
  range.deleteContents?.();
  const node = documentRef?.createTextNode?.(insertion);
  if (!node) return false;
  range.insertNode?.(node);
  range.setStartAfter?.(node);
  range.collapse?.(true);
  selection?.removeAllRanges?.();
  selection?.addRange?.(range);
  return true;
}

function dispatchInput(composer, windowRef) {
  const EventCtor = windowRef?.InputEvent ?? windowRef?.Event;
  if (!EventCtor) return;
  composer.dispatchEvent?.(new EventCtor("input", { bubbles: true }));
}

function isUsableComposerAnchor(anchorRect, composerRect) {
  if (!isFiniteRect(anchorRect) || !isFiniteRect(composerRect)) return false;
  const composerHeight = Math.max(1, Number(composerRect.height) || Number(composerRect.bottom) - Number(composerRect.top) || 1);
  const anchorHeight = Math.max(0, Number(anchorRect.height) || Number(anchorRect.bottom) - Number(anchorRect.top) || 0);
  const topGap = Math.abs(Number(anchorRect.top) - Number(composerRect.top));
  const bottomGap = Math.abs(Number(anchorRect.bottom) - Number(composerRect.bottom));
  const maxHeight = Math.max(240, composerHeight * 6);
  return anchorHeight <= maxHeight && topGap <= 160 && bottomGap <= 180;
}

function isFiniteRect(rect) {
  if (!rect) return false;
  return [rect.left, rect.top, rect.right, rect.bottom].every((value) => Number.isFinite(Number(value)));
}
