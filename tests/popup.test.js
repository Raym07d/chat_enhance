const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");

async function popup(initial = { status: "idle", stage: "准备导出" }) {
  const elements = new Map();
  for (const [, id] of fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8").matchAll(/id="([^"]+)"/g)) {
    elements.set(`#${id}`, { hidden: false, disabled: false, checked: false, textContent: "", removeAttribute(name) { delete this[name]; } });
  }
  const fixture = { state: initial, result: { ok: true }, permission: true, elements, setting: null };
  let interval;
  const chrome = {
    storage: { sync: { async get() { return { compactMath: true }; }, async set(setting) { fixture.setting = setting; } } },
    permissions: { async request() { return fixture.permission; } },
    tabs: {
      async query() { return [{ id: 4, url: "https://chatgpt.com/c/test" }]; },
      async sendMessage(_id, message) {
        if (message.type === "chat-enhance-export-status") return fixture.state;
        if (message.type === "chat-enhance-cancel-export") return fixture.state = { ...fixture.state, status: "cancelling", stage: "正在取消" };
        return fixture.result;
      }
    }
  };
  vm.runInNewContext(source, {
    document: { querySelector: id => elements.get(id), body: { dataset: {} } },
    window: { addEventListener() {} }, chrome, URL, Date,
    setInterval(callback) { interval = callback; return 1; }, clearInterval() {}
  });
  await new Promise(setImmediate);
  fixture.poll = () => interval();
  fixture.click = async id => { await elements.get(id).onclick(); await new Promise(setImmediate); };
  return fixture;
}

test("reopening the panel reads an existing job and supports cancellation", async () => {
  const p = await popup({ status: "running", stage: "加载完整对话", turns: 26, startedAt: Date.now() - 1000 });
  assert.equal(p.elements.get("#status").textContent, "加载完整对话");
  assert.equal(p.elements.get("#export-html").disabled, true);
  assert.equal(p.elements.get("#cancel-export").hidden, false);
  assert.match(p.elements.get("#counts").textContent, /26 轮/);
  await p.click("#cancel-export");
  assert.equal(p.elements.get("#cancel-export").disabled, true);
  p.state = { status: "cancelled", stage: "已取消导出" };
  await p.poll();
  assert.equal(p.elements.get("#export-html").disabled, false);
});

test("an early export error and its image permission survive idle polling", async () => {
  const p = await popup();
  p.result = { ok: false, error: "图片需要授权", permissionOrigin: "https://images.example.com/*" };
  await p.click("#export-html");
  await p.poll();
  assert.equal(p.elements.get("#detail").textContent, "图片需要授权");
  assert.equal(p.elements.get("#grant-image-access").hidden, false);
  p.permission = false;
  await p.click("#grant-image-access");
  await p.poll();
  assert.match(p.elements.get("#detail").textContent, /未获得图片访问权限/);
  assert.equal(p.elements.get("#grant-image-access").hidden, false);
  assert.equal(p.elements.get("#export-html").disabled, false);
});

test("a new external job clears an earlier error and its completion stays visible", async () => {
  const p = await popup();
  p.result = { ok: false, error: "暂时失败" };
  await p.click("#export-html");
  p.state = { status: "running", stage: "读取资源" };
  await p.poll();
  p.state = { status: "done", stage: "HTML 已生成" };
  await p.poll();
  assert.equal(p.elements.get("#status").textContent, "HTML 已生成");
  assert.equal(p.elements.get("#export-label").textContent, "再次导出");
  p.elements.get("#compact-math").checked = false;
  await p.elements.get("#compact-math").onchange();
  assert.equal(p.setting.compactMath, false);
});
