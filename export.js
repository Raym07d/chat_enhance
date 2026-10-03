(function () {
  "use strict";

  const UNIT_SELECTOR = [
    '[data-content-search-unit-key$=":user"]',
    '[data-content-search-unit-key$=":assistant"]',
    '[data-chatgpt-search-unit-key$=":user"]',
    '[data-chatgpt-search-unit-key$=":assistant"]'
  ].join(",");
  const REMOVE_SELECTOR = [
    "script", "style", "link", "meta", "base", "template", "iframe", "frame", "frameset", "object", "embed", "form",
    "input", "textarea", "select", "noscript", "video", "audio",
    ".turn-action-controls", '[data-testid="conversation-turn-actions"]',
    "[data-selected-text-overlay]", "[data-chat-enhance-copy-markdown]",
    "[data-chat-enhance-copy-word]", "svg script", "svg foreignObject"
  ].join(",");

  // The live stylesheet supplies typography, code panes, tables and theme colors.
  // These overrides only remove app/virtualizer constraints from the saved document.
  const EXPORT_CSS = `
    html, body { height: auto !important; min-height: 100%; overflow: visible !important; }
    body { margin: 0; }
    .export-header { max-width: var(--export-width); margin: 0 auto; padding: 24px 20px; }
    .export-header h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
    .export-header a { font-size: 13px; text-decoration: underline; }
    .export-container { container-type: inline-size; container-name: thread-content; }
    .export-transcript { width: 100%; max-width: var(--export-width); margin: 0 auto; padding: 0 20px 64px; }
    .export-transcript > .turn { margin-bottom: 12px; }
    .export-transcript [data-virtualized-turn-content] { content-visibility: visible !important; contain: none !important; }
    .export-transcript img { max-width: 100%; }
    .export-transcript .cm-content { white-space: pre !important; }
    .export-transcript .cm-line { display: block; }
    .export-transcript .cm-gap, .export-transcript .cm-announced, .export-transcript .cm-cursorLayer,
    .export-transcript .cm-selectionLayer, .export-transcript .sr-only, .export-transcript [hidden] { display: none !important; }
    .export-transcript .cm-scroller { overflow: auto; }
    .export-transcript .export-static-code { padding-top: 12px; }
    .export-code-comment { color: var(--color-codex-syntax-comment); font-style: normal; }
    @container style(--theme-variant: light) { .export-code-comment { font-style: italic; } }
    .export-transcript [data-markdown-text-style] { overflow-wrap: anywhere; }
    @media print { .export-header a { display: none; } }
  `;

  const usedFonts = new Set();
  function rememberFonts(root) {
    for (const element of [root, ...root.querySelectorAll(".cm-content, .katex, .katex *")]) {
      for (const family of getComputedStyle(element).fontFamily.split(",")) {
        usedFonts.add(family.trim().replace(/^['"]|['"]$/g, "").toLowerCase());
      }
    }
  }

  async function captureAppearance() {
    const container = document.querySelector("[data-thread-user-message-navigation-content]") || document.body;
    const computed = getComputedStyle(container);
    const body = getComputedStyle(document.body);
    const variables = Array.from(computed).filter((name) => name.startsWith("--"))
      .map((name) => `${name}:${computed.getPropertyValue(name)};`).join("");
    const fontCache = new Map();
    const sheets = [];
    for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
      try { sheets.push({ css: Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n"), base: sheet.href || location.href }); }
      catch { throw new Error("无法读取网页样式，请刷新页面后重试"); }
    }
    const styles = await Promise.all(sheets.map(async ({ css, base }) => {
      const faces = Array.from(css.matchAll(/@font-face\s*\{[^}]*\}/gi));
      for (const [face] of faces) {
        const family = /font-family:\s*([^;]+)/i.exec(face)?.[1].trim().replace(/^['"]|['"]$/g, "").toLowerCase();
        let replacement = "";
        if (usedFonts.has(family)) {
          const sources = Array.from(face.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi));
          const source = sources.find((match) => /woff2(?:[?#]|$)/i.test(match[1])) || sources[0];
          if (source) {
            const url = new URL(source[1], base).href;
            if (!fontCache.has(url)) fontCache.set(url, (async () => {
              const response = await fetch(url);
              if (!response.ok) throw new Error(`字体读取失败：HTTP ${response.status}`);
              return blobDataURL(await response.blob());
            })());
            const data = await fontCache.get(url);
            replacement = face.replace(/src:[^;]+;/i, `src:url("${data}");`);
          }
        }
        css = css.replace(face, replacement);
      }
      // Saved files must not make hidden network requests for unrelated app assets.
      return css.replace(/@import\s+[^;]+;/gi, "")
        .replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi, (match, url) => url.startsWith("data:") ? match : 'url("")');
    }));
    return {
      css: styles.join("\n") + `\n:root{${variables}} body{background:${body.backgroundColor};color:${body.color};font:${body.font};}`,
      htmlClass: document.documentElement.className,
      bodyClass: document.body.className,
      width: container === document.body ? "808px" : computed.width,
      containerClass: container.className
    };
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function currentConversationURL() {
    const url = new URL(location.href);
    if (!(["chatgpt.com", "chat.openai.com"].includes(url.hostname) &&
          /^\/(?:g\/[^/]+\/)?c\/[^/]+\/?$/.test(url.pathname))) {
      throw new Error("请先打开一条 ChatGPT 对话");
    }
    return `${url.origin}${url.pathname}`;
  }

  function filenameForTitle(title) {
    const safe = String(title || "ChatGPT 对话")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 100) || "ChatGPT 对话";
    return `${safe}.html`;
  }

  function turnRoots() {
    const units = Array.from(document.querySelectorAll(UNIT_SELECTOR));
    if (units.length) {
      return Array.from(new Set(units.map((unit) =>
        unit.closest("[data-turn-key], article") || unit
      )));
    }
    return Array.from(document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'));
  }

  function roleForUnit(unit) {
    const key = unit.getAttribute("data-content-search-unit-key") ||
      unit.getAttribute("data-chatgpt-search-unit-key") || "";
    return key.endsWith(":user") || unit.getAttribute("data-message-author-role") === "user"
      ? "user"
      : "assistant";
  }

  function replaceMath(clone) {
    const wrappers = Array.from(clone.querySelectorAll("[data-math-source], .katex"));
    for (const wrapper of wrappers) {
      if (!wrapper.isConnected && !clone.contains(wrapper)) continue;
      if (wrapper.closest("pre, code")) continue;
      if (wrapper.classList.contains("katex") && wrapper.closest("[data-math-source]")) continue;
      let math = wrapper.querySelector("math");
      if (!math && wrapper.hasAttribute("data-math-source") && globalThis.katex?.renderToString) {
        const rendered = globalThis.katex.renderToString(wrapper.getAttribute("data-math-source"), {
          output: "mathml", throwOnError: true, strict: "ignore", trust: false
        });
        const template = document.createElement("template");
        template.innerHTML = rendered;
        math = template.content.querySelector("math");
      }
      if (!math) {
        throw new Error("有公式无法离线保存，请刷新页面后重试");
      }
      // Keep KaTeX's visual tree when available; MathML remains for accessibility.
      if (wrapper.querySelector(".katex-html")) continue;
      const replacement = math.cloneNode(true);
      const display = wrapper.getAttribute("data-math-display") === "true" ||
        Boolean(wrapper.querySelector(".katex-display")) ||
        math.getAttribute("display") === "block";
      replacement.setAttribute("display", display ? "block" : "inline");
      wrapper.replaceWith(replacement);
    }
  }

  function blobDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片数据读取失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function renderedImageDataURL(image) {
    if (!image.complete || !image.naturalWidth) await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片尚未加载完成");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const blob = await new Promise((resolve, reject) => {
      try {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片快照失败")), "image/png");
      } catch (error) {
        reject(error);
      }
    });
    return blobDataURL(blob);
  }

  async function imageDataURL(source, image, cache) {
    if (source.startsWith("data:image/")) return source;
    if (!/^(https?:|blob:)/i.test(source)) throw new Error("对话图片地址无效，无法离线保存");
    if (cache.has(source)) return cache.get(source);
    const promise = (async () => {
      // Extension background fetches bypass image CORS; avoid two doomed attempts first.
      if (source.startsWith("https:") && new URL(source).origin !== location.origin && globalThis.chrome?.runtime?.sendMessage) {
        const result = await chrome.runtime.sendMessage({ type: "chat-enhance-read-image", url: source });
        if (result?.ok && result.data?.startsWith("data:image/")) return result.data;
        if (result?.permissionOrigin) {
          const error = new Error(`需要允许读取 ${new URL(source).hostname} 的图片`);
          error.permissionOrigin = result.permissionOrigin;
          throw error;
        }
        if (result?.error) throw new Error(`无法读取 ${new URL(source).hostname} 的图片（${result.error}）`);
      }
      try {
        const response = await fetch(source);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("返回内容不是图片");
        return await blobDataURL(blob);
      } catch (fetchError) {
        // A visible blob image may still be readable from the rendered pixels.
        try {
          return await renderedImageDataURL(image);
        } catch {
          if (source.startsWith("https:") && globalThis.chrome?.runtime?.sendMessage) {
            const result = await chrome.runtime.sendMessage({
              type: "chat-enhance-read-image", url: source
            });
            if (result?.ok && result.data?.startsWith("data:image/")) return result.data;
            if (result?.permissionOrigin) {
              const error = new Error(`需要允许读取 ${new URL(source).hostname} 的图片`);
              error.permissionOrigin = result.permissionOrigin;
              throw error;
            }
            if (result?.error) throw new Error(`无法读取 ${new URL(source).hostname} 的图片（${result.error}）`);
          }
          const host = source.startsWith("blob:") ? "页面临时图片" : new URL(source).hostname;
          throw new Error(`无法读取 ${host} 的图片（${fetchError.message}），请确认图片已加载后重试`);
        }
      }
    })();
    cache.set(source, promise);
    promise.catch(() => cache.delete(source));
    return promise;
  }

  async function inlineMedia(original, clone, cache) {
    const sourceImages = Array.from(original.querySelectorAll("img"));
    const clonedImages = Array.from(clone.querySelectorAll("img"));
    await Promise.all(clonedImages.map(async (image, index) => {
      const source = sourceImages[index]?.currentSrc || sourceImages[index]?.src || "";
      if (!source) {
        clonedImages[index].replaceWith(document.createTextNode(clonedImages[index].alt || "[图片]"));
        return;
      }
      try {
        clonedImages[index].src = await imageDataURL(source, sourceImages[index], cache);
      } catch (error) {
        const wrapped = new Error(`图片无法保存：${error.message}`);
        if (error.permissionOrigin) wrapped.permissionOrigin = error.permissionOrigin;
        throw wrapped;
      }
      clonedImages[index].removeAttribute("srcset");
      clonedImages[index].removeAttribute("loading");
    }));

    const sourceCanvases = Array.from(original.querySelectorAll("canvas"));
    const clonedCanvases = Array.from(clone.querySelectorAll("canvas"));
    for (let index = 0; index < clonedCanvases.length; index += 1) {
      let source;
      try {
        source = sourceCanvases[index].toDataURL("image/png");
      } catch {
        throw new Error("对话图表无法离线保存");
      }
      const image = document.createElement("img");
      image.src = source;
      image.alt = sourceCanvases[index].getAttribute("aria-label") || "图表";
      clonedCanvases[index].replaceWith(image);
    }
  }

  function sanitize(clone) {
    for (const unwanted of Array.from(clone.querySelectorAll(REMOVE_SELECTOR))) unwanted.remove();
    for (const use of Array.from(clone.querySelectorAll("svg use"))) {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      if (!href.startsWith("#")) continue;
      const symbol = document.getElementById(href.slice(1));
      if (!symbol) continue;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.append(...Array.from(symbol.childNodes, (node) => node.cloneNode(true)));
      use.replaceWith(group);
    }
    for (const element of [clone, ...clone.querySelectorAll("*")]) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name) || [
          "contenteditable", "autofocus", "srcdoc", "nonce", "integrity",
          "formaction", "action", "ping", "poster", "srcset"
        ].includes(attribute.name)) element.removeAttribute(attribute.name);
      }
      if (element.hasAttribute("style")) {
        for (const property of Array.from(element.style)) {
          if (/url\(|expression\(|@import/i.test(element.style.getPropertyValue(property))) element.style.removeProperty(property);
        }
      }
      if (element.tagName === "A") {
        const href = element.getAttribute("href") || "";
        if (!href || !href.startsWith("#")) {
          try {
            const resolved = new URL(href, location.href);
            if (!href || !["https:", "http:", "mailto:"].includes(resolved.protocol)) {
              element.removeAttribute("href");
            } else {
              element.href = resolved.href;
              element.rel = "noreferrer noopener";
              element.target = "_blank";
            }
          } catch {
            element.removeAttribute("href");
          }
        }
      }
      if (element.namespaceURI === "http://www.w3.org/2000/svg") {
        for (const name of ["href", "xlink:href"]) {
          const href = element.getAttribute(name);
          if (href && !href.startsWith("#")) element.removeAttribute(name);
        }
      }
    }
    for (const button of Array.from(clone.querySelectorAll("button, [role='button']"))) {
      if (button.matches("[data-chat-enhance-copy-markdown], [data-chat-enhance-copy-word]")) {
        button.remove();
      } else {
        const text = button.textContent.trim();
        if (text) {
          const span = document.createElement("span");
          span.textContent = text;
          button.replaceWith(span);
        } else button.remove();
      }
    }
  }

  // Offscreen Python panes are plain-text placeholders in ChatGPT's virtualizer.
  // Tokenize that text without changing it, using the same syntax colors as the editor.
  function highlightStaticPython(clone) {
    const keywords = new Set("and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield".split(" "));
    const tokens = /(?<string>(?:[rbuf]{1,2})?(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))|(?<comment>#[^\n]*)|(?<number>\b(?:0[xob][\da-f_]+|\d[\d_]*(?:\.[\d_]*)?(?:e[+-]?[\d_]+)?j?)\b)|(?<identifier>[_\p{ID_Start}][_\p{ID_Continue}]*)|(?<operator>[+*/%=<>!&|^~.:-])/giu;
    for (const frame of clone.querySelectorAll('[data-markdown-copy="code-block"]')) {
      const code = frame.querySelector("code");
      if (code && Array.from(code.classList).some((name) => name.startsWith("CodeContent-"))) code.classList.add("export-static-code");
      const label = frame.querySelector('[data-markdown-copy="exclude"]')?.textContent.trim() || "";
      if (!code || !/^python\b/i.test(label)) continue;
      // Some placeholder variants use <br> for empty lines instead of text nodes.
      for (const lineBreak of code.querySelectorAll("br")) lineBreak.replaceWith(document.createTextNode("\n"));
      const text = code.textContent;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const token of text.matchAll(tokens)) {
        fragment.append(document.createTextNode(text.slice(offset, token.index)));
        const value = token[0];
        let type = token.groups.string ? "string" : token.groups.number ? "literal" : token.groups.operator ? "keyword" : "variable";
        if (keywords.has(value)) type = "keyword";
        if (["True", "False", "None"].includes(value)) type = "literal";
        if (token.groups.identifier && text[token.index - 1] === ".") type = "";
        const span = document.createElement("span");
        span.className = token.groups.comment ? "export-code-comment" : type ? `text-codex-syntax-${type}` : "";
        span.textContent = value;
        fragment.append(span);
        offset = token.index + value.length;
      }
      fragment.append(document.createTextNode(text.slice(offset)));
      code.replaceChildren(fragment);
    }
  }

  async function captureTurn(root, cache) {
    rememberFonts(root);
    const clone = root.cloneNode(true);
    await inlineMedia(root, clone, cache);
    replaceMath(clone);
    highlightStaticPython(clone);
    sanitize(clone);
    clone.classList.add("turn");
    const candidates = [clone, ...clone.querySelectorAll(UNIT_SELECTOR)]
      .filter((unit) => unit.matches(UNIT_SELECTOR) || unit.hasAttribute("data-message-author-role"));
    for (const unit of candidates.filter((unit) => !candidates.some((parent) => parent !== unit && parent.contains(unit)))) {
      unit.classList.add("message", `message--${roleForUnit(unit)}`);
    }
    return clone.outerHTML;
  }

  async function collectConversation() {
    usedFonts.clear();
    const cache = new Map();
    const collected = new Map();
    const capturedIndices = new Set();
    const scroller = document.querySelector(".thread-scroll-container");
    const originalTop = scroller?.scrollTop;
    const reverse = scroller && getComputedStyle(scroller).flexDirection === "column-reverse";
    const deadline = Date.now() + 300000;

    function historyLoading() {
      // During pagination, fallback-turn-0 refers to the oldest *loaded* turn.
      // It cannot prove that the actual beginning of the conversation is loaded.
      const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/^(?:Loading older messages|正在加载(?:较早|更早|历史|以前|旧).*消息|加载(?:较早|更早|历史|以前|旧).*消息)/i.test(node.textContent.trim()) &&
            !node.parentElement.closest("[data-turn-key], article")) return true;
      }
      return Boolean(scroller.querySelector('[aria-busy="true"]'));
    }

    async function captureRendered() {
      const roots = turnRoots();
      const pending = [];
      for (const root of roots) {
        const key = root.getAttribute("data-turn-key") ||
          root.getAttribute("data-message-id") ||
          root.getAttribute("data-content-search-unit-key") ||
          root.getAttribute("data-chatgpt-search-unit-key") ||
          root.getAttribute("data-testid");
        if (!key) continue;
        if (collected.has(key)) continue;
        const capture = captureTurn(root, cache);
        collected.set(key, capture);
        pending.push(capture);
        const marker = root.querySelector("[data-content-search-turn-key]")?.getAttribute("data-content-search-turn-key") || "";
        const index = /^fallback-turn-(\d+)$/.exec(marker);
        if (index) capturedIndices.add(Number(index[1]));
      }
      await Promise.all(pending);
    }

    try {
      if (!scroller) {
        await captureRendered();
      } else {
        const historyDeadline = Date.now() + 90000;
        let stableAtTop = 0;
        let lastHeight = -1;
        while (Date.now() < historyDeadline) {
          scroller.scrollTop = reverse ? -scroller.scrollHeight : 0;
          await delay(500);
          const start = reverse ? -Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
          const atTop = Math.abs(scroller.scrollTop - start) < 3;
          const firstMarker = scroller.querySelector("[data-content-search-turn-key]")
            ?.getAttribute("data-content-search-turn-key") || "";
          const firstIndex = /^fallback-turn-(\d+)$/.exec(firstMarker);
          const hasOldestTurn = !firstIndex || Number(firstIndex[1]) === 0;
          stableAtTop = atTop && hasOldestTurn && !historyLoading() && scroller.scrollHeight === lastHeight
            ? stableAtTop + 1 : 0;
          lastHeight = scroller.scrollHeight;
          if (stableAtTop >= (firstIndex ? 2 : 12)) break;
        }
        if (Date.now() >= historyDeadline) throw new Error("对话历史未能加载到第一条消息，请稍后重试");

        while (Date.now() < deadline) {
          await delay(100);
          await captureRendered();
          const end = reverse ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          if (scroller.scrollTop >= end - 2) {
            await delay(300);
            await captureRendered();
            break;
          }
          // Every mounted turn is captured in full, including the virtualizer's overscan.
          // Jump to its last boundary instead of walking hundreds of empty viewports.
          const roots = turnRoots();
          const viewport = scroller.getBoundingClientRect();
          const lastBottom = Math.max(...roots.map((root) => root.getBoundingClientRect().bottom));
          const step = Math.max(scroller.clientHeight * 0.75, lastBottom - viewport.top - 100);
          scroller.scrollTop = Math.min(end, scroller.scrollTop + step);
        }
        if (Date.now() >= deadline) throw new Error("对话过长，尚未完整读取，请重试");
      }
    } finally {
      if (scroller) scroller.scrollTop = originalTop;
    }
    if (!collected.size) throw new Error("没有找到可导出的对话内容");
    if (capturedIndices.size) {
      const last = Math.max(...capturedIndices);
      for (let index = 0; index <= last; index += 1) {
        if (!capturedIndices.has(index)) throw new Error(`第 ${index + 1} 轮对话未能读取，请重试`);
      }
    }
    return Promise.all(collected.values());
  }

  function buildHTML(title, sourceURL, turns, appearance = {}) {
    const safeTitle = escapeHTML(title);
    const safeURL = escapeHTML(sourceURL);
    return `<!doctype html>
<html lang="zh-CN" class="${escapeHTML(appearance.htmlClass || "")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${safeTitle}</title><style>${(appearance.css || "").replace(/<\/style/gi, "<\\/style")}
${EXPORT_CSS}
:root { --export-width: ${appearance.width || "808px"}; }
</style></head><body class="${escapeHTML(appearance.bodyClass || "")}">
<header class="export-header"><h1>${safeTitle}</h1><a href="${safeURL}" target="_blank" rel="noreferrer noopener">打开原对话</a></header>
<div class="export-container"><main class="export-transcript ${escapeHTML(appearance.containerClass || "")}">${turns.join("\n")}</main></div></body></html>`;
  }

  async function createConversationHTML() {
    const sourceURL = currentConversationURL();
    const title = document.title.trim() || "ChatGPT 对话";
    const turns = await collectConversation();
    if (currentConversationURL() !== sourceURL) throw new Error("页面已切换到其他对话，请重试");
    const appearance = await captureAppearance();
    return {
      html: buildHTML(title, sourceURL, turns, appearance),
      filename: filenameForTitle(title),
      turns: turns.length
    };
  }

  function downloadHTML(result) {
    const { html } = result;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobURL = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobURL;
    link.download = result.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobURL), 60000);
    return { filename: link.download, turns: result.turns };
  }

  let exporting = false;
  async function exportConversation() {
    if (exporting) throw new Error("当前对话正在导出，请稍候");
    exporting = true;
    try {
      return downloadHTML(await createConversationHTML());
    } finally {
      exporting = false;
    }
  }

  globalThis.ChatEnhanceExport = {
    exportConversation, createConversationHTML, collectConversation, buildHTML,
    downloadHTML, filenameForTitle, captureAppearance, highlightStaticPython
  };

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "chat-enhance-export-html") return false;
      exportConversation()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => {
          console.error("[Chat Enhance] HTML export failed:", error);
          sendResponse({
            ok: false, error: error.message || "导出失败",
            permissionOrigin: error.permissionOrigin
          });
        });
      return true;
    });
  }
})();
