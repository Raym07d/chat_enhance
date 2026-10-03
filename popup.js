(function () {
  "use strict";

  const checkbox = document.querySelector("#compact-math");
  const exportButton = document.querySelector("#export-html");
  const accessButton = document.querySelector("#grant-image-access");
  const status = document.querySelector("#status");
  let pendingOrigin = null;

  function showStatus(message, duration = 1200) {
    status.textContent = message;
    if (!duration) return;
    window.setTimeout(() => {
      if (status.textContent === message) status.textContent = "";
    }, duration);
  }

  chrome.storage.sync.get({ compactMath: true }, (settings) => {
    if (chrome.runtime.lastError) {
      status.textContent = "无法读取设置";
      checkbox.checked = true;
      return;
    }
    checkbox.checked = settings.compactMath !== false;
  });

  checkbox.addEventListener("change", () => {
    chrome.storage.sync.set({ compactMath: checkbox.checked }, () => {
      if (chrome.runtime.lastError) {
        status.textContent = "保存失败";
        return;
      }
      showStatus(checkbox.checked ? "已开启" : "已关闭");
    });
  });

  async function startExport() {
    exportButton.disabled = true;
    accessButton.hidden = true;
    pendingOrigin = null;
    showStatus("正在读取并保存当前对话…", 0);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
        throw new Error("请先打开一条 ChatGPT 对话");
      }
      const result = await chrome.tabs.sendMessage(tab.id, { type: "chat-enhance-export-html" });
      if (!result?.ok) {
        if (result?.permissionOrigin) {
          pendingOrigin = result.permissionOrigin;
          accessButton.textContent = `允许读取 ${new URL(pendingOrigin).hostname} 的图片并重试`;
          accessButton.hidden = false;
        }
        throw new Error(result?.error || "导出失败，请刷新对话页面后重试");
      }
      showStatus(`已保存 ${result.turns} 轮对话`, 5000);
    } catch (error) {
      const message = /receiving end|message port closed/i.test(error.message || "")
        ? "请刷新 ChatGPT 页面后重试"
        : error.message || "导出失败，请刷新对话页面后重试";
      showStatus(message, 0);
    } finally {
      exportButton.disabled = false;
    }
  }

  exportButton.addEventListener("click", startExport);
  accessButton.addEventListener("click", async () => {
    const origin = pendingOrigin;
    if (!origin) return;
    accessButton.disabled = true;
    try {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error("未获得图片网站读取权限");
      await startExport();
    } catch (error) {
      showStatus(error.message || "授权失败", 0);
    } finally {
      accessButton.disabled = false;
    }
  });
})();
