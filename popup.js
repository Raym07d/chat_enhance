(function () {
  "use strict";

  const checkbox = document.querySelector("#compact-math");
  const status = document.querySelector("#status");

  function showStatus(message) {
    status.textContent = message;
    window.setTimeout(() => {
      if (status.textContent === message) status.textContent = "";
    }, 1200);
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
})();
