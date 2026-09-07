import { VERSION } from "./core/constants.js";
import { TalkEnhancerApp } from "./app.js";

export { VERSION, TalkEnhancerApp };
export * from "./core/bridge-adapter.js";
export * from "./core/codex-adapter.js";
export * from "./core/composer-adapter.js";
export * from "./core/prompt-store.js";
export * from "./core/scroll-model.js";
export * from "./core/turn-registry.js";
export * from "./core/virtualization-spike.js";

export function bootstrap(options = {}) {
  const windowRef = options.window ?? globalThis.window;
  const existing = windowRef?.__GPTTalkEnhancer;
  if (existing && typeof existing.destroy === "function") {
    existing.destroy();
  }
  const app = new TalkEnhancerApp(options);
  if (windowRef) {
    windowRef.__GPTTalkEnhancer = app;
  }
  app.init();
  return app;
}
