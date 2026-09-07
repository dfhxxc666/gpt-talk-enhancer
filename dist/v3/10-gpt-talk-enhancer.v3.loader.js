(() => {
  "use strict";
  if (window.top !== window || !String(location.href).startsWith("app://-/")) return;
  const bundle = window.__GPTTalkEnhancerV3Bundle;
  if (!bundle?.mount) {
    console.error("[GPT TalkEnhancer] v3 bundle is not loaded; ensure 00-gpt-talk-enhancer.v3.bundle.js is enabled before this loader.");
    return;
  }
  window.__GPTTalkEnhancerV3?.destroy?.();
  bundle.mount();
})();
