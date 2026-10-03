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

  const EXPORT_CSS = `
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #1f2937; font-size: 16px; line-height: 1.65; }
    header { border-bottom: 1px solid #e5e7eb; padding: 24px max(20px, calc((100vw - 860px) / 2)); }
    header h1 { margin: 0; font-size: 22px; line-height: 1.35; overflow-wrap: anywhere; }
    header a { display: inline-block; margin-top: 6px; font-size: 13px; }
    main { width: min(100%, 900px); margin: 0 auto; padding: 24px 20px 72px; }
    .turn { display: flow-root; margin: 0 0 32px; }
    .message { min-width: 0; margin: 0 0 16px; overflow-wrap: anywhere; }
    .message--user { max-width: 82%; margin-left: auto; padding: 12px 16px; border-radius: 18px; background: #f3f4f6; }
    .message--assistant { width: 100%; }
    .message .sr-only, .message [hidden] { display: none !important; }
    .message p { margin: 0 0 1em; }
    .message p:last-child { margin-bottom: 0; }
    .message h1, .message h2, .message h3, .message h4, .message h5, .message h6 { line-height: 1.35; margin: 1.3em 0 .55em; }
    .message h1 { font-size: 1.65em; } .message h2 { font-size: 1.35em; } .message h3 { font-size: 1.15em; }
    .message ul, .message ol { padding-left: 1.6em; margin: .6em 0 1em; }
    .message li { margin: .25em 0; }
    .message blockquote { margin: 1em 0; padding: .25em 1em; border-left: 3px solid #cbd5e1; color: #4b5563; }
    .message pre { overflow: auto; max-width: 100%; padding: 14px 16px; border-radius: 10px; background: #f3f4f6; white-space: pre; font-size: .88em; }
    .message code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
    .message :not(pre) > code { padding: .15em .35em; border-radius: 4px; background: #f3f4f6; }
    .message table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 1em 0; }
    .message th, .message td { border: 1px solid #d1d5db; padding: 7px 10px; text-align: left; white-space: nowrap; }
    .message th { background: #f3f4f6; font-weight: 650; }
    .message img, .message canvas { max-width: 100%; height: auto; border-radius: 6px; }
    .message math { font-size: 1.05em; }
    .message math[display="block"] { display: block; max-width: 100%; overflow-x: auto; margin: 1em 0; text-align: center; }
    .message svg { max-width: 100%; height: auto; }
    .message [data-user-message-bubble] { max-width: 100%; }
    a { color: #1167b1; }
    @media (max-width: 600px) { header { padding: 20px 16px; } main { padding: 20px 16px 50px; } .message--user { max-width: 94%; } }
    @media print { header a { display: none; } main { width: 100%; padding: 0; } .turn { break-inside: avoid; } }
  `;

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
    for (let index = 0; index < clonedImages.length; index += 1) {
      const source = sourceImages[index]?.currentSrc || sourceImages[index]?.src || "";
      if (!source) {
        clonedImages[index].replaceWith(document.createTextNode(clonedImages[index].alt || "[图片]"));
        continue;
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
    }

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
          "style", "contenteditable", "autofocus", "srcdoc", "nonce", "integrity",
          "formaction", "action", "ping", "poster", "srcset"
        ].includes(attribute.name)) element.removeAttribute(attribute.name);
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

  async function captureTurn(root, cache) {
    const candidates = Array.from(root.querySelectorAll(UNIT_SELECTOR));
    if (root.matches(UNIT_SELECTOR) || root.hasAttribute("data-message-author-role")) candidates.unshift(root);
    const units = candidates.filter((unit) => !candidates.some((parent) =>
      parent !== unit && parent.contains(unit)
    ));
    const messages = [];
    for (const unit of units) {
      const clone = unit.cloneNode(true);
      await inlineMedia(unit, clone, cache);
      replaceMath(clone);
      sanitize(clone);
      const role = roleForUnit(unit);
      messages.push(`<section class="message message--${role}" aria-label="${role === "user" ? "用户" : "ChatGPT"}">${clone.innerHTML}</section>`);
    }
    return `<article class="turn">${messages.join("")}</article>`;
  }

  async function collectConversation() {
    const cache = new Map();
    const collected = new Map();
    const capturedIndices = new Set();
    const scroller = document.querySelector(".thread-scroll-container");
    const originalTop = scroller?.scrollTop;
    const reverse = scroller && getComputedStyle(scroller).flexDirection === "column-reverse";
    const deadline = Date.now() + 300000;

    async function captureRendered() {
      const roots = turnRoots();
      for (const root of roots) {
        const key = root.getAttribute("data-turn-key") ||
          root.getAttribute("data-message-id") ||
          root.getAttribute("data-content-search-unit-key") ||
          root.getAttribute("data-chatgpt-search-unit-key") ||
          root.getAttribute("data-testid");
        if (!key) continue;
        if (collected.has(key)) continue;
        collected.set(key, await captureTurn(root, cache));
        const marker = root.querySelector("[data-content-search-turn-key]")?.getAttribute("data-content-search-turn-key") || "";
        const index = /^fallback-turn-(\d+)$/.exec(marker);
        if (index) capturedIndices.add(Number(index[1]));
      }
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
          stableAtTop = atTop && hasOldestTurn && scroller.scrollHeight === lastHeight
            ? stableAtTop + 1 : 0;
          lastHeight = scroller.scrollHeight;
          if (stableAtTop >= (firstIndex ? 2 : 12)) break;
        }
        if (Date.now() >= historyDeadline) throw new Error("对话历史未能加载到第一条消息，请稍后重试");

        while (Date.now() < deadline) {
          await delay(180);
          await captureRendered();
          const end = reverse ? 0 : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          if (scroller.scrollTop >= end - 2) {
            await delay(300);
            await captureRendered();
            break;
          }
          const step = Math.max(150, scroller.clientHeight * 0.75);
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
    return Array.from(collected.values());
  }

  function buildHTML(title, sourceURL, turns) {
    const safeTitle = escapeHTML(title);
    const safeURL = escapeHTML(sourceURL);
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${safeTitle}</title><style>${EXPORT_CSS}</style></head><body>
<header><h1>${safeTitle}</h1><a href="${safeURL}" target="_blank" rel="noreferrer noopener">打开原对话</a></header>
<main class="export-transcript">${turns.join("\n")}</main></body></html>`;
  }

  async function createConversationHTML() {
    const sourceURL = currentConversationURL();
    const title = document.title.trim() || "ChatGPT 对话";
    const turns = await collectConversation();
    if (currentConversationURL() !== sourceURL) throw new Error("页面已切换到其他对话，请重试");
    return {
      html: buildHTML(title, sourceURL, turns),
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
    downloadHTML, filenameForTitle
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
