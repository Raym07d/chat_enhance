(function () {
  "use strict";

  const SELECTOR = '[data-d-component="math"], .katex-display, .katex, math';

  function roots(root) {
    const candidates = Array.from(root.querySelectorAll(SELECTOR));
    if (root.matches(SELECTOR)) candidates.unshift(root);
    return candidates.filter((element) => {
      const parent = element.parentElement?.closest(SELECTOR);
      return !parent || !root.contains(parent);
    }).filter((element) => !element.closest("pre, code"));
  }

  function read(element) {
    // Current ChatGPT renders standard KaTeX: its annotation retains exact TeX.
    const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
    const tex = (annotation?.textContent || "").replace(/\r\n?/g, "\n").trim();
    const displaySelector = '.katex-display, math[display="block"]';
    const display = element.matches(displaySelector) ||
      Boolean(element.querySelector(displaySelector)) || element.style.display === "block";
    const math = element.matches("math") ? element : element.querySelector("math");
    return { tex, display, math };
  }

  globalThis.ChatEnhanceMath = { SELECTOR, roots, read };
})();
