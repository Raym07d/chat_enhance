const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../api.js'), 'utf8');
const url = 'https://chatgpt.com/c/example';
function api(tabs, response = { ok: true, html: '<html/>', filename: 'chat.html', turns: 3 }) {
  const messages = [];
  const context = vm.createContext({ URL, chrome: { tabs: {
    query: async () => tabs,
    update: async () => {},
    sendMessage: async (...args) => { messages.push(args); return response; }
  } } });
  vm.runInContext(source, context);
  return { call: context.exportChatGPT, messages };
}
test('targets the requested conversation and returns HTML without a download', async () => {
  const { call, messages } = api([{ id: 1, url: 'https://chatgpt.com/c/other' }, { id: 2, url }]);
  const result = await call(url + '?test=1');
  assert.equal(result.html, '<html/>');
  assert.equal(result.turns, 3);
  assert.equal(messages[0][0], 2);
  assert.equal(messages[0][1].type, 'chat-enhance-create-html');
});
test('rejects invalid, missing and ambiguous conversations without sending messages', async () => {
  for (const [input, tabs] of [ ['https://example.com/c/a', []], [url, []], [url, [{ id: 1, url }, { id: 2, url }]] ]) {
    const { call, messages } = api(tabs);
    await assert.rejects(call(input));
    assert.equal(messages.length, 0);
  }
});
test('propagates the real export error', async () => {
  await assert.rejects(api([{ id: 1, url }], { ok: false, error: 'Image download failed' }).call(url), /Image download failed/);
});
