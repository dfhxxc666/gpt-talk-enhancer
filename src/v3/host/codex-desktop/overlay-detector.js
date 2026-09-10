export class OverlayDetector {
  constructor({ document } = {}) {
    this.document = document ?? globalThis.document;
  }

  isMediaViewerOpen() {
    const selectors = [
      "[data-testid='modal-image-viewer']",
      "[data-testid*='image-viewer']",
      "[role='dialog'] [data-testid*='image']",
      "[role='dialog'] img[src^='blob:']"
    ];
    return selectors.some((selector) => Boolean(this.document?.querySelector?.(selector)));
  }

  isBlockingDialogOpen() {
    const selectors = ["[role='dialog']", "[aria-modal='true']"];
    for (const selector of selectors) {
      const nodes = Array.from(this.document?.querySelectorAll?.(selector) ?? []);
      for (const node of nodes) {
        if (!isVisibleHostOverlay(node)) continue;
        return true;
      }
    }
    return false;
  }

  isPromptFloatingLayerOpen({ composerRect = null } = {}) {
    if (!isFiniteRect(composerRect)) return false;
    const promptZone = {
      left: Number(composerRect.left) - 56,
      top: Number(composerRect.top) - 240,
      right: Number(composerRect.right) + 24,
      bottom: Number(composerRect.bottom) + 24
    };
    const selectors = [
      "[data-radix-popper-content-wrapper]",
      "[role='menu']",
      "[role='listbox']",
      "[role='tooltip']"
    ];
    for (const selector of selectors) {
      const nodes = Array.from(this.document?.querySelectorAll?.(selector) ?? []);
      for (const node of nodes) {
        if (!isVisibleHostOverlay(node)) continue;
        const rect = node.getBoundingClientRect?.() ?? null;
        if (rectsIntersect(promptZone, rect)) return true;
      }
    }
    return false;
  }
}
function isVisibleHostOverlay(node) {
  if (!node || node.hidden === true) return false;
  if (String(node.getAttribute?.("aria-hidden") ?? "").toLowerCase() === "true") return false;
  if (node.closest?.("#gte-root")) return false;
  const rect = node.getBoundingClientRect?.() ?? null;
  if (!isFiniteRect(rect)) return false;
  const width = Number(rect.width) || Number(rect.right) - Number(rect.left);
  const height = Number(rect.height) || Number(rect.bottom) - Number(rect.top);
  return width > 0 && height > 0;
}

function isFiniteRect(rect) {
  if (!rect) return false;
  return [rect.left, rect.top, rect.right, rect.bottom].every((value) => Number.isFinite(Number(value)));
}

function rectsIntersect(a, b) {
  if (!isFiniteRect(a) || !isFiniteRect(b)) return false;
  return Number(a.left) < Number(b.right)
    && Number(a.right) > Number(b.left)
    && Number(a.top) < Number(b.bottom)
    && Number(a.bottom) > Number(b.top);
}
