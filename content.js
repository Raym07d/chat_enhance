(function () {
  "use strict";

  const MARKDOWN_BUTTON_ATTRIBUTE = "data-chat-enhance-copy-markdown";
  const WORD_BUTTON_ATTRIBUTE = "data-chat-enhance-copy-word";
  const MESSAGE_SELECTOR = '[data-message-author-role="assistant"]';
  const COPY_TEST_IDS = new Set([
    "copy-turn-action-button",
    "copy-response-button"
  ]);
  let compactMathEnabled = true;

  if (globalThis.chrome?.storage?.sync) {
    chrome.storage.sync.get({ compactMath: true }, (settings) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[ChatGPT Markdown Copy] Unable to read settings:",
          chrome.runtime.lastError.message
        );
        return;
      }
      compactMathEnabled = settings.compactMath !== false;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes.compactMath) return;
      compactMathEnabled = changes.compactMath.newValue !== false;
    });
  }

  function normalizedLabel(button) {
    return [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
  }

  function responseContent(message) {
    return message.querySelector(
      ".markdown, [data-message-content], [class*='markdown']"
    );
  }

  function resolveAssistantMessage(button) {
    const direct = button.closest(MESSAGE_SELECTOR);
    if (direct) return direct;

    const turn = button.closest(
      'article[data-turn="assistant"], article[data-testid^="conversation-turn"], [data-turn="assistant"], [data-testid^="conversation-turn"]'
    );
    if (!turn) return null;
    return turn.querySelector(MESSAGE_SELECTOR);
  }

  function isNativeResponseCopyButton(button) {
    if (!(button instanceof HTMLButtonElement)) return false;
    if (button.hasAttribute(MARKDOWN_BUTTON_ATTRIBUTE) ||
        button.hasAttribute(WORD_BUTTON_ATTRIBUTE)) return false;
    if (button.closest("pre, code")) return false;

    const testId = button.getAttribute("data-testid") || "";
    if (COPY_TEST_IDS.has(testId)) return true;

    const label = normalizedLabel(button);
    const matchesCopy = /(^|\s)(copy|复制)(\s|$)/i.test(label) ||
      label.includes("copy response") ||
      label.includes("复制回复");
    if (!matchesCopy) return false;

    // Avoid copy buttons that belong to code blocks or other nested widgets.
    const message = resolveAssistantMessage(button);
    const content = message && responseContent(message);
    return Boolean(message) && (!content || !content.contains(button));
  }

  function createMarkdownIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "19");
    svg.setAttribute("height", "19");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 16V8l5 5 5-5v8"/>';
    return svg;
  }

  function createWordIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "19");
    svg.setAttribute("height", "19");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M6.5 8l2.2 8L12 10.5l3.3 5.5 2.2-8"/>';
    return svg;
  }

  function showToast(text, kind = "success") {
    const existing = document.querySelector(".chat-enhance-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = `chat-enhance-toast chat-enhance-toast--${kind}`;
    toast.textContent = text;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("chat-enhance-toast--visible"));
    window.setTimeout(() => {
      toast.classList.remove("chat-enhance-toast--visible");
      window.setTimeout(() => toast.remove(), 180);
    }, 1800);
  }

  function hideActionTooltip() {
    document.querySelector(".chat-enhance-action-tooltip")?.remove();
  }

  function showActionTooltip(button, label) {
    hideActionTooltip();

    const tooltip = document.createElement("div");
    tooltip.className = "chat-enhance-action-tooltip";
    tooltip.textContent = label;
    document.body.appendChild(tooltip);

    const buttonRect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const halfWidth = tooltipRect.width / 2;
    const center = Math.min(
      window.innerWidth - halfWidth - 8,
      Math.max(halfWidth + 8, buttonRect.left + buttonRect.width / 2)
    );
    const below = buttonRect.bottom + 9;
    const top = below + tooltipRect.height <= window.innerHeight - 8
      ? below
      : buttonRect.top - tooltipRect.height - 9;

    tooltip.style.left = `${center}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  async function writeClipboard(text) {
    if (!text) throw new Error("没有可复制的回复内容");

    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("浏览器拒绝写入剪贴板");
  }

  async function writeWordClipboard(html, plainText) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("当前浏览器不支持富文本剪贴板");
    }

    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" })
    });
    await navigator.clipboard.write([item]);
  }

  async function copyMessage(message, button) {
    const originalLabel = button.getAttribute("aria-label");
    button.disabled = true;

    try {
      const markdown = globalThis.ChatEnhanceMarkdown.responseToMarkdown(message, {
        compactMath: compactMathEnabled
      });
      await writeClipboard(markdown);
      button.classList.add("chat-enhance-copy--done");
      button.setAttribute("aria-label", "Markdown 已复制");
      showToast("Markdown 已复制");
    } catch (error) {
      console.error("[ChatGPT Markdown Copy] Copy failed:", error);
      button.classList.add("chat-enhance-copy--error");
      showToast(error.message || "复制失败", "error");
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.classList.remove("chat-enhance-copy--done", "chat-enhance-copy--error");
        button.setAttribute("aria-label", originalLabel || "复制 Markdown");
      }, 1600);
    }
  }

  async function copyMessageToWord(message, button) {
    const originalLabel = button.getAttribute("aria-label");
    button.disabled = true;

    try {
      const html = globalThis.ChatEnhanceWord.responseToWordHTML(message);
      const plainText = globalThis.ChatEnhanceMarkdown.responseToMarkdown(message, {
        compactMath: compactMathEnabled
      });
      await writeWordClipboard(html, plainText);
      button.classList.add("chat-enhance-copy--done");
      button.setAttribute("aria-label", "Word 内容已复制");
      showToast("Word 内容已复制");
    } catch (error) {
      console.error("[ChatGPT Markdown Copy] Word copy failed:", error);
      button.classList.add("chat-enhance-copy--error");
      showToast(error.message || "Word 复制失败", "error");
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        button.classList.remove("chat-enhance-copy--done", "chat-enhance-copy--error");
        button.setAttribute("aria-label", originalLabel || "复制到 Word");
      }, 1600);
    }
  }

  function makeActionButton(nativeButton, attribute, label, modifierClass, content, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${nativeButton.className || ""} chat-enhance-copy ${modifierClass}`.trim();
    button.setAttribute(attribute, "true");
    button.setAttribute("aria-label", label);
    button.appendChild(content);
    button.addEventListener("mouseenter", () => showActionTooltip(button, label));
    button.addEventListener("mouseleave", hideActionTooltip);
    button.addEventListener("focus", () => showActionTooltip(button, label));
    button.addEventListener("blur", hideActionTooltip);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideActionTooltip();
      handler(button);
    });
    return button;
  }

  function addButtons(nativeButton) {
    if (!nativeButton.parentElement) return;

    const message = resolveAssistantMessage(nativeButton);
    if (!message) return;

    let markdownButton = nativeButton.parentElement.querySelector(
      `[${MARKDOWN_BUTTON_ATTRIBUTE}]`
    );
    if (!markdownButton) {
      markdownButton = makeActionButton(
        nativeButton,
        MARKDOWN_BUTTON_ATTRIBUTE,
        "复制 Markdown",
        "chat-enhance-copy--markdown",
        createMarkdownIcon(),
        (button) => copyMessage(message, button)
      );
      nativeButton.insertAdjacentElement("afterend", markdownButton);
    }

    if (!nativeButton.parentElement.querySelector(`[${WORD_BUTTON_ATTRIBUTE}]`)) {
      const wordButton = makeActionButton(
        nativeButton,
        WORD_BUTTON_ATTRIBUTE,
        "复制到 Word",
        "chat-enhance-copy--word",
        createWordIcon(),
        (button) => copyMessageToWord(message, button)
      );
      markdownButton.insertAdjacentElement("afterend", wordButton);
    }
  }

  function enhance() {
    for (const button of document.querySelectorAll("button")) {
      if (isNativeResponseCopyButton(button)) addButtons(button);
    }
  }

  let enhancementTimer = 0;
  const observer = new MutationObserver((records) => {
    const addedElement = records.some((record) =>
      Array.from(record.addedNodes).some((node) => node.nodeType === Node.ELEMENT_NODE)
    );
    if (!addedElement) return;

    window.clearTimeout(enhancementTimer);
    enhancementTimer = window.setTimeout(enhance, 80);
  });

  enhance();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", hideActionTooltip, true);
  window.addEventListener("resize", hideActionTooltip);
})();
