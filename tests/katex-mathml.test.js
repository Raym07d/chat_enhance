"use strict";

const assert = require("node:assert/strict");
const katex = require("../vendor/katex/katex.min.js");

const samples = [
  String.raw`X=\$100`,
  String.raw`\frac{P(A\cap B)}{P(B)}`,
  String.raw`\hat{\theta}=\arg\min_{\theta\in\Theta}\left\{\frac{1}{n}\sum_{i=1}^{n}(y_i-f_\theta(x_i))^2+\lambda\lVert\theta\rVert_2^2\right\}`,
  String.raw`\Pr\left[\sup_{x\in\mathbb R}|F_n(x)-F(x)|>\varepsilon\right]\le 2e^{-2n\varepsilon^2}`,
  String.raw`F_n(x)=\frac{1}{n}\sum_{i=1}^{n}\mathbf 1_{\{X_i\le x\}}`,
  String.raw`\operatorname{Corr}(X,Y)=\frac{E[(X-\mu_X)(Y-\mu_Y)]}{\sqrt{E[(X-\mu_X)^2]}\sqrt{E[(Y-\mu_Y)^2]}}`,
  String.raw`\begin{aligned}a&=b\\c&=d\end{aligned}`
];

for (const latex of samples) {
  const mathML = katex.renderToString(latex, {
    displayMode: true,
    output: "mathml",
    throwOnError: true,
    strict: "ignore",
    trust: false
  });
  assert.match(mathML, /<math\b/);
  assert.match(mathML, /<annotation encoding="application\/x-tex">/);
}

console.log("KaTeX MathML tests passed.");
