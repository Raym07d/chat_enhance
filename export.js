(function () {
  "use strict";
  const TURN = "[data-turn-key]";
  const REMOVE_SELECTOR = 'script, style, link, meta, base, template, object, embed, noscript, .turn-action-controls, [data-testid="conversation-turn-actions"], [data-selected-text-overlay], [data-chat-enhance-copy-markdown], [data-chat-enhance-copy-word]';
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let exporting = false;
  let cancelled = false, sourceURL = "", notice;
  let state = { status: "idle", stage: "准备导出", turns: 0, completed: 0, total: 0 };

  function updateState(patch) {
    state = { ...state, ...patch };
    if (!notice?.isConnected) {
      notice = document.createElement("aside");
      const shadow = notice.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>:host{position:fixed;right:20px;bottom:24px;z-index:2147483647;font:13px/1.6 system-ui;color:#182b26}section{background:#fff;border:1px solid #d9e4df;border-radius:14px;padding:14px 18px;box-shadow:0 8px 30px #0002;max-width:340px}strong{display:block}p{margin:4px 0 8px;color:#52645d}button{border:1px solid #ccd9d2;background:#fff;border-radius:6px;padding:3px 10px;color:inherit;cursor:pointer}</style><section role="status" aria-live="polite"><strong></strong><p></p><button></button></section>`;
      shadow.querySelector("button").onclick = () => exporting ? cancelExport() : notice.remove();
      document.body.append(notice);
    }
    notice.shadowRoot.querySelector("strong").textContent = state.stage;
    notice.shadowRoot.querySelector("p").textContent = state.detail || `已加载 ${state.turns} 轮 · 资源 ${state.completed}/${state.total}`;
    notice.shadowRoot.querySelector("button").textContent = ["running", "cancelling"].includes(state.status) ? "取消导出" : "关闭";
  }

  function cancelExport() {
    if (!exporting) return;
    cancelled = true;
    updateState({ status: "cancelling", stage: "正在取消", detail: "等待正在读取的资源结束，然后恢复页面…" });
  }

  function checkExport() {
    if (cancelled) throw new Error("已取消导出");
    if (location.href !== sourceURL) throw new Error("页面已切换到其他对话，请重试");
  }

  let resourceSlots = 0;
  const resourceQueue = [];
  async function resource(read) {
    checkExport();
    updateState({ total: state.total + 1 });
    if (resourceSlots < 6) resourceSlots++;
    else await new Promise(resolve => resourceQueue.push(resolve));
    try { checkExport(); return await read(); }
    finally {
      const next = resourceQueue.shift();
      if (next) next(); else resourceSlots--;
      updateState({ completed: state.completed + 1 });
    }
  }

  async function settleAll(tasks) {
    const results = await Promise.allSettled(tasks);
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    return results.map(result => result.value);
  }

  async function captureStyles() {
    // Let the browser parse CSS. Editing an entire stylesheet with regex corrupts
    // nested rules and quoted strings in the current ChatGPT stylesheets.
    const loadedFonts = new Set([...document.fonts].filter(face => face.status === "loaded")
      .map(face => face.family.replace(/['"]/g, "").toLowerCase()));
    const cache = new Map();
    async function sheetText(sheet) {
      let rules;
      try { rules = [...sheet.cssRules]; }
      catch { throw new Error("无法读取网页样式，请刷新页面后重试"); }
      return (await settleAll(rules.map(async rule => {
        if (rule.type !== CSSRule.IMPORT_RULE) return rule.cssText;
        let css = await sheetText(rule.styleSheet);
        if (rule.media.mediaText) css = `@media ${rule.media.mediaText}{${css}}`;
        if (rule.layerName !== null && rule.layerName !== undefined) css = `@layer ${rule.layerName}{${css}}`;
        return css;
      }))).join("\n");
    }
    async function rewrite(rules, base) {
      await settleAll([...rules].map(async rule => {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const family = rule.style.getPropertyValue("font-family").replace(/['"]/g, "").toLowerCase();
          if (!loadedFonts.has(family)) { rule.style.removeProperty("src"); return; }
          const src = rule.style.getPropertyValue("src");
          const match = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(src);
          if (!match) return;
          const url = new URL(match[1], base).href;
          if (!cache.has(url)) cache.set(url, resource(async () => {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`字体读取失败：HTTP ${response.status}`);
            return blobDataURL(await response.blob());
          }));
          rule.style.setProperty("src", `url("${await cache.get(url)}")`);
        } else if (rule.cssRules) await rewrite(rule.cssRules, base);
      }));
    }
    return settleAll([...document.styleSheets, ...document.adoptedStyleSheets].map(async sheet => {
      const copy = new CSSStyleSheet();
      copy.replaceSync(await sheetText(sheet));
      await rewrite(copy.cssRules, sheet.href || location.href);
      return [...copy.cssRules].map(rule => rule.cssText).join("\n");
    }));
  }

  function snapshotLayout(scroller, roots) {
    const html = document.documentElement.cloneNode(false);
    const body = document.body.cloneNode(false);
    html.append(document.createElement("head"), body);
    // Keep theme attributes, inherited variables and named container contexts.
    // Prune app chrome instead of inventing a new transcript layout.
    const ancestors = [];
    for (let element = scroller.parentElement; element !== document.body; element = element.parentElement) ancestors.unshift(element);
    let parent = body;
    for (const original of ancestors) {
      const clone = original.cloneNode(false);
      parent.append(clone);
      parent = clone;
      for (const [name, value] of Object.entries({ height:"auto", "min-height":"0", "max-height":"none", overflow:"visible", width:"100%", "max-width":"none", position:"relative" })) clone.style.setProperty(name, value, "important");
    }
    const paths = new Set([scroller]);
    for (const root of roots) for (let node = root; node !== scroller; node = node.parentElement) paths.add(node);
    const copies = [];
    function copyPath(original) {
      const clone = original.cloneNode(roots.includes(original));
      if (roots.includes(original)) { copies.push({ root:original, clone }); return clone; }
      for (const child of original.children) if (paths.has(child)) clone.append(copyPath(child));
      for (const [name, value] of Object.entries({ height:"auto", "min-height":"0", "max-height":"none", overflow:"visible", transform:"none", "margin-top":"0", "content-visibility":"visible", contain:"none" })) clone.style.setProperty(name, value, "important");
      return clone;
    }
    parent.append(copyPath(scroller));
    for (const node of [html, body]) {
      for (const [name, value] of Object.entries({ height:"auto", "min-height":"100%", overflow:"visible" })) node.style.setProperty(name, value, "important");
    }
    body.style.setProperty("max-width", `${scroller.getBoundingClientRect().width}px`);
    body.style.setProperty("margin", "0 auto");
    return { html, copies };
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
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

  function blobDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片数据读取失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function renderedImageDataURL(image) {
    if (!image.complete || !image.naturalWidth) throw new Error("图片尚未加载完成");
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
    if (!cache.has(source)) cache.set(source, resource(async () => {
      if (source.startsWith("https:") && new URL(source).origin !== location.origin) {
        const result = await chrome.runtime.sendMessage({ type: "chat-enhance-read-image", url: source });
        if (result?.ok) return result.data;
        const error = new Error(result?.permissionOrigin ? `需要允许读取 ${new URL(source).hostname} 的图片` : result?.error || "图片读取失败");
        error.permissionOrigin = result?.permissionOrigin;
        throw error;
      }
      try {
        const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("返回内容不是图片");
        return await blobDataURL(blob);
      } catch (error) {
        try { return await renderedImageDataURL(image); }
        catch { throw error; }
      }
    }));
    return cache.get(source);
  }

  async function inlineMedia(original, clone, cache) {
    const sourceImages = Array.from(original.querySelectorAll("img"));
    const clonedImages = Array.from(clone.querySelectorAll("img"));
    await settleAll(clonedImages.map(async (image, index) => {
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
      for (const attr of sourceCanvases[index].attributes) image.setAttribute(attr.name, attr.value);
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
    for (const control of clone.querySelectorAll("button, input, textarea, select")) {
      control.setAttribute("inert", "");
    }
  }

  function restoreStyle(element, style) {
    if (style === null) element.removeAttribute("style");
    else element.setAttribute("style", style);
  }

  function conversationScroller() {
    for (let element = document.querySelector(TURN)?.parentElement; element; element = element.parentElement) {
      if (["auto", "scroll"].includes(getComputedStyle(element).overflowY)) return element;
    }
    return null;
  }

  async function expandConversation(scroller) {
    const deadline = Date.now() + 300000;
    let height = 40000, previous = "", stable = 0, changedAt = Date.now();
    while (Date.now() < deadline) {
      checkExport();
      for (const name of ["height", "min-height"]) scroller.style.setProperty(name, `${height}px`, "important");
      scroller.style.setProperty("max-height", "none", "important");
      scroller.scrollTop = 0;
      await delay(600);
      checkExport();
      const turns = [...scroller.querySelectorAll(TURN)];
      const signature = turns.map(turn => `${turn.dataset.turnKey}:${turn.textContent.length}`).join("|");
      const replies = [...scroller.querySelectorAll('[data-content-search-unit-key$=":assistant"]')];
      const loading = scroller.querySelector('[aria-busy="true"], [role="progressbar"]') ||
        replies.some(reply => !reply.querySelector("[data-d-component], [data-markdown-text-style], .markdown, img, canvas"));
      const fits = scroller.scrollHeight <= scroller.clientHeight + 2;
      if (signature !== previous) changedAt = Date.now();
      updateState({ turns: turns.length, detail: `已加载 ${turns.length} 轮，正在确认历史消息完整…` });
      stable = turns.length && !loading && fits && signature === previous ? stable + 1 : 0;
      if (stable >= 5) return turns.map(turn => turn.dataset.turnKey);
      if (Date.now() - changedAt > 45000) throw new Error("历史加载超过 45 秒没有进展，请检查网络后重试");
      previous = signature;
      if (!fits) {
        const next = Math.max(height * 2, scroller.scrollHeight + 40000);
        if (next > 16000000) throw new Error("对话超过浏览器可展开的高度，无法保证完整导出");
        height = next;
      }
    }
    throw new Error("历史加载超过 5 分钟，请重试");
  }

  function buildHTML(layout, styles, title) {
    const head = layout.html.querySelector("head");
    head.innerHTML = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHTML(title)}</title>`;
    for (const css of styles) {
      const style = document.createElement("style");
      style.textContent = css.replace(/<\/style/gi, "<\\/style");
      head.append(style);
    }
    return `<!doctype html>\n${layout.html.outerHTML}`;
  }

  async function createConversationHTML() {
    if (exporting) throw new Error("当前对话正在导出，请稍候");
    const scroller = conversationScroller();
    if (!scroller) throw new Error("没有找到对话，请刷新页面后重试");
    exporting = true;
    cancelled = false;
    sourceURL = location.href;
    updateState({ status: "running", stage: "加载完整对话", detail: "正在加载隐藏的历史消息…", turns: 0, completed: 0, total: 0, startedAt: Date.now(), endedAt: null, permissionOrigin: null });
    const style = scroller.getAttribute("style"), top = scroller.scrollTop;
    const title = document.title || "ChatGPT";
    try {
      const keys = await expandConversation(scroller);
      const roots = [...scroller.querySelectorAll(TURN)];
      const cache = new Map();
      const warnings = [];
      updateState({ stage: "整理对话内容", detail: `正在保留 ${roots.length} 轮对话的原始布局…` });
      await delay(0);
      const layout = snapshotLayout(scroller, roots);
      checkExport();
      updateState({ stage: "保存图片和字体", detail: "" });
      const appearancePromise = captureStyles();
      const turnsPromise = settleAll(layout.copies.map(async ({root, clone}) => {
        await inlineMedia(root, clone, cache);
        for (const frame of clone.querySelectorAll("iframe")) {
          const note = document.createElement("p");
          note.textContent = "[嵌入式应用未保存，请打开原对话查看]";
          frame.replaceWith(note);
          warnings.push("嵌入式应用未保存");
        }
        sanitize(clone);
      }));
      // Wait for all resource work to settle before restoring the source page, even on error.
      const results = await Promise.allSettled([appearancePromise, turnsPromise]);
      const failure = results.find(result => result.status === "rejected");
      checkExport();
      if (failure) throw failure.reason;
      if (location.href !== sourceURL) throw new Error("页面已切换到其他对话，请重试");
      if (JSON.stringify([...scroller.querySelectorAll(TURN)].map(turn => turn.dataset.turnKey)) !== JSON.stringify(keys)) {
        throw new Error("导出过程中对话发生变化，请重试");
      }
      updateState({ stage: "生成 HTML", detail: `正在整理 ${keys.length} 轮对话…` });
      await delay(0);
      checkExport();
      const result = { html: buildHTML(layout, results[0].value, title),
        filename: filenameForTitle(title), turns: keys.length, warnings: [...new Set(warnings)] };
      updateState({ status: "done", stage: "HTML 已生成", detail: `${keys.length} 轮对话${warnings.length ? "；" + result.warnings.join("；") : "，可离线阅读"}`, endedAt: Date.now() });
      return result;
    } catch (error) {
      updateState({ status: cancelled ? "cancelled" : "error", stage: cancelled ? "已取消导出" : "导出失败", detail: error.message, permissionOrigin: error.permissionOrigin, endedAt: Date.now() });
      throw error;
    } finally {
      restoreStyle(scroller, style);
      scroller.scrollTop = top;
      exporting = false;
    }
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

  async function exportConversation() {
    const result = await createConversationHTML();
    const downloaded = downloadHTML(result);
    updateState({ stage: "已交给浏览器下载" });
    return { ...downloaded, warnings: result.warnings };
  }
  globalThis.ChatEnhanceExport = { createConversationHTML, exportConversation };
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "chat-enhance-export-status") { sendResponse(state); return false; }
    if (message?.type === "chat-enhance-cancel-export") { cancelExport(); sendResponse(state); return false; }
    if (!["chat-enhance-export-html", "chat-enhance-create-html"].includes(message?.type)) return false;
    const action = message.type === "chat-enhance-create-html" ? createConversationHTML : exportConversation;
    action().then(result => sendResponse({ ok: true, ...result }), error => sendResponse({
      ok: false, error: error.message || "导出失败", permissionOrigin: error.permissionOrigin
    }));
    return true;
  });
})();
