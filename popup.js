(function () {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const active = value => ["running", "cancelling"].includes(value?.status);
  let tabId, state = { status: "idle", stage: "准备导出" }, localError, starting = false, polling, timer;

  function render(next = state) {
    if (!next?.status) throw new Error("请重新加载扩展并刷新 ChatGPT 页面。");
    state = next;
    const value = active(state) ? state : localError || state;
    const busy = starting || active(value);
    document.body.dataset.status = value.status;
    $("#status").textContent = value.stage;
    $("#detail").textContent = value.detail || (value.status === "idle" ? "准备好后，即可保存完整对话。" : "正在读取图片和字体…");
    $("#elapsed").textContent = value.startedAt ? `${Math.max(0, Math.floor(((value.endedAt || Date.now()) - value.startedAt) / 1000))} 秒` : "";
    $("#counts").hidden = !value.startedAt;
    $("#counts").textContent = `${value.turns || 0} 轮对话 · 资源 ${value.completed || 0} / ${value.total || 0}`;
    $("#progress").hidden = !busy && value.status !== "done";
    if (busy) $("#progress").removeAttribute("value");
    else $("#progress").value = 1;
    $("#export-html").disabled = !tabId || busy;
    $("#export-label").textContent = busy ? "正在导出…" : value.status === "done" ? "再次导出" : value.status === "error" ? "重试导出" : "保存为 HTML";
    $("#cancel-export").hidden = !active(value);
    $("#cancel-export").disabled = value.status === "cancelling";
    $("#grant-image-access").hidden = !value.permissionOrigin;
    if (value.permissionOrigin) $("#grant-image-access").textContent = `允许读取 ${new URL(value.permissionOrigin).hostname} 的图片并重试`;
  }

  function showError(error, permissionOrigin) {
    localError = { status: "error", stage: "暂时无法导出", detail: /receiving end|message port closed/i.test(error.message || "") ? "请刷新对话页面后重试。" : error.message || "导出失败，请重试。", permissionOrigin };
    render(localError);
  }

  function poll() {
    if (!tabId) return Promise.resolve();
    if (polling) return polling;
    polling = (async () => {
      try {
        const next = await chrome.tabs.sendMessage(tabId, { type: "chat-enhance-export-status" });
        if (active(next)) localError = null;
        if (!starting || next?.status !== "idle") render(next);
      } catch (error) { showError(error); }
      finally { polling = null; }
    })();
    return polling;
  }

  async function start() {
    if (!tabId || starting || active(state)) return;
    localError = null;
    starting = true;
    render({ status: "running", stage: "正在开始", detail: "正在连接对话页面…", startedAt: Date.now() });
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "chat-enhance-export-html" });
      if (!result?.ok) showError(new Error(result?.error || "导出失败"), result?.permissionOrigin);
      else await poll();
    } catch (error) { showError(error); }
    finally { starting = false; render(); }
  }

  $("#export-html").onclick = start;
  $("#cancel-export").onclick = async () => {
    try { render(await chrome.tabs.sendMessage(tabId, { type: "chat-enhance-cancel-export" })); }
    catch (error) { showError(error); }
  };
  $("#grant-image-access").onclick = async () => {
    const origin = (localError || state).permissionOrigin;
    if (!origin) return;
    $("#grant-image-access").disabled = true;
    try {
      if (await chrome.permissions.request({ origins: [origin] })) await start();
      else showError(new Error("未获得图片访问权限，请授权后重试。"), origin);
    } catch (error) { showError(error, origin); }
    finally { $("#grant-image-access").disabled = false; }
  };

  chrome.storage.sync.get({ compactMath: true }).then(settings => {
    $("#compact-math").checked = settings.compactMath !== false;
  }, () => { $("#compact-math").checked = true; $("#settings-status").textContent = "无法读取设置，请重试。"; });
  $("#compact-math").onchange = async () => {
    try {
      await chrome.storage.sync.set({ compactMath: $("#compact-math").checked });
      $("#settings-status").textContent = "设置已保存";
    } catch { $("#settings-status").textContent = "保存失败，请重试。"; }
  };

  (async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\//.test(tab.url || "")) throw new Error("请先打开一条 ChatGPT 对话。");
      tabId = tab.id;
      await poll();
      timer = setInterval(poll, 700);
    } catch (error) { showError(error); }
  })();
  window.addEventListener("pagehide", () => clearInterval(timer));
})();
