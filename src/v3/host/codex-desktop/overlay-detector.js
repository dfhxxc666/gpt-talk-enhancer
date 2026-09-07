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
}
