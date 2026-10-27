"use strict";

// Extension-only entry point, called through Chrome's local debugging connection.
globalThis.exportChatGPT = async function (url) {
  const source = new URL(url);
  if (source.origin !== "https://chatgpt.com" || !/\/c\/[^/]+\/?$/.test(source.pathname)) {
    throw new Error("需要完整的 ChatGPT 对话 URL");
  }
  const tabs = (await chrome.tabs.query({ url: "https://chatgpt.com/*" })).filter((tab) => {
    const candidate = new URL(tab.url);
    return candidate.pathname.replace(/\/$/, "") === source.pathname.replace(/\/$/, "");
  });
  if (tabs.length !== 1) throw new Error("请在此 Chrome 中打开且只打开一个目标对话标签页");
  // Keep lazy rendering active while the temporary API tab waits for the result.
  await chrome.tabs.update(tabs[0].id, { active: true });
  const result = await chrome.tabs.sendMessage(tabs[0].id, {
    type: "chat-enhance-create-html"
  });
  if (!result?.ok) throw new Error(result?.error || "请重新加载 Chat Enhance 扩展并刷新对话页面");
  const { html, filename, turns, warnings = [] } = result;
  return { html, filename, turns, warnings };
};
