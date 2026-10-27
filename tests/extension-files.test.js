const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('extension contains no Python cache or reserved underscore paths', () => {
  function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      assert.ok(!entry.name.startsWith('_'), `Chrome rejects this extension path: ${file}`);
      if (entry.isDirectory()) check(file);
    }
  }
  check(path.join(__dirname, '..'));
});
