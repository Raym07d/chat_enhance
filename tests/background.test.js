const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

const source = readFileSync(require("node:path").join(__dirname, "..", "background.js"), "utf8");
let listener;
let fetches = 0;
let permitted = true;
const context = {
  URL, AbortController, Uint8Array, setTimeout, clearTimeout, btoa,
  chrome: {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    permissions: { async contains() { return permitted; } }
  },
  async fetch() {
    fetches += 1;
    return new Response(new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" }));
  }
};
vm.runInNewContext(source, context);

function request(url, sender = { tab: { id: 1 }, url: "https://chatgpt.com/c/test" }) {
  return new Promise((resolve) => {
    assert.equal(listener({ type: "chat-enhance-read-image", url }, sender, resolve), true);
  });
}

(async () => {
  const image = await request("https://t0.gstatic.com/faviconV2?url=example.com");
  assert.equal(image.ok, true);
  assert.equal(image.data, "data:image/png;base64,iVBORw==");
  assert.equal(fetches, 1);

  permitted = false;
  const denied = await request("https://images.example.com/a.png");
  assert.equal(denied.ok, false);
  assert.equal(denied.permissionOrigin, "https://images.example.com/*");
  assert.equal(fetches, 1);

  const invalid = await request("http://images.example.com/a.png");
  assert.match(invalid.error, /HTTPS/);
  assert.equal(fetches, 1);

  const wrongSender = await request("https://t0.gstatic.com/faviconV2", { tab: { id: 2 }, url: "https://example.com/" });
  assert.match(wrongSender.error, /来源无效/);
  assert.equal(fetches, 1);
  console.log("Background image-fetch tests passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
