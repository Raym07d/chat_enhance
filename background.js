"use strict";

function imageOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? `${parsed.origin}/*` : null;
  } catch {
    return null;
  }
}

async function imageAsDataURL(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.toLowerCase().startsWith("image/")) throw new Error("返回内容不是图片");
    if (blob.size > 25 * 1024 * 1024) throw new Error("单张图片超过 25 MB");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 24576) {
      chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
    }
    return `data:${blob.type};base64,${chunks.join("")}`;
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "chat-enhance-read-image") return false;
  (async () => {
    if (!sender.tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(sender.url || "")) {
      throw new Error("图片请求来源无效");
    }
    const origin = imageOrigin(message.url);
    if (!origin) throw new Error("只支持 HTTPS 图片地址");
    if (!await chrome.permissions.contains({ origins: [origin] })) {
      return { ok: false, permissionOrigin: origin };
    }
    return { ok: true, data: await imageAsDataURL(message.url) };
  })().then(sendResponse, (error) => sendResponse({ ok: false, error: error.message || "图片读取失败" }));
  return true;
});
