"use strict";

const assert = require("node:assert/strict");

require("../markdown.js");

const { cleanTex, compactMathNewlines } = globalThis.ChatEnhanceMarkdown;

assert.equal(cleanTex("  x = \\$5  \n"), "x = \\$5");
assert.equal(cleanTex("  x = $5 + $6  \n"), "x = $5 + $6");
assert.equal(cleanTex("\\text{price: \\$5}"), "\\text{price: \\$5}");
assert.equal(
  cleanTex("  P(X\\in[0,1))=\\int_{[0,1)} dF_X(x)  "),
  "P(X\\in[0,1))=\\int_{[0,1)} dF_X(x)"
);

assert.equal(
  compactMathNewlines("\\hat{\\theta}\n=\n\\arg\\min_{\\theta\\in\\Theta}"),
  "\\hat{\\theta} = \\arg\\min_{\\theta\\in\\Theta}"
);
assert.equal(
  compactMathNewlines("\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}"),
  "\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}"
);
assert.equal(compactMathNewlines("a% join without a space\nb"), "ab");
assert.equal(compactMathNewlines("a\n% comment-only line\nb"), "a b");
assert.equal(compactMathNewlines("\\foo % keep separator\nbar"), "\\foo bar");
assert.equal(compactMathNewlines("\\text{a% join\nb}"), "\\text{ab}");
assert.equal(compactMathNewlines("a\\%b\n+c"), "a\\%b +c");
assert.equal(compactMathNewlines("\\text{price: \\$5}\n+x"), "\\text{price: \\$5} +x");

console.log("Formula-preservation tests passed.");
