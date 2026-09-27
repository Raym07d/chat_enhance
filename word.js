(function () {
  "use strict";

  const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
  const SKIP_TAGS = new Set(["BUTTON", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

  function escapeHTML(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function safeURL(value) {
    const url = String(value || "").trim();
    if (/^(https?:|mailto:|data:image\/)/i.test(url)) return url;
    return "";
  }

  function presentationOnly(math) {
    for (const annotation of Array.from(
      math.querySelectorAll("annotation, annotation-xml")
    )) {
      annotation.remove();
    }

    for (const semantics of Array.from(math.querySelectorAll("semantics"))) {
      semantics.replaceWith(...Array.from(semantics.childNodes));
    }
  }

  function latexToMathML(latex, display) {
    if (!globalThis.katex?.renderToString) {
      throw new Error("Word 公式转换器没有加载，请重新加载扩展");
    }

    let rendered;
    try {
      rendered = globalThis.katex.renderToString(latex, {
        displayMode: display,
        output: "mathml",
        throwOnError: true,
        strict: "ignore",
        trust: false
      });
    } catch (error) {
      const preview = latex.replace(/\s+/g, " ").slice(0, 80);
      throw new Error(`无法转换 Word 公式：${preview}`);
    }

    const template = document.createElement("template");
    template.innerHTML = rendered;
    const math = template.content.querySelector("math");
    if (!math) throw new Error("公式转换器没有生成 MathML");

    presentationOnly(math);
    math.setAttribute("xmlns", MATHML_NAMESPACE);
    math.setAttribute("display", display ? "block" : "inline");
    return math.outerHTML;
  }

  function findResponseContent(message) {
    return (
      message.querySelector('[data-markdown-text-style="assistant-message"]') ||
      message.querySelector("[data-message-content]") ||
      message.querySelector(".markdown") ||
      message.querySelector("[class*='markdown']") ||
      message
    );
  }

  function responseBodyToWordHTML(message) {
    const source = findResponseContent(message);

    function children(node) {
      return Array.from(node.childNodes).map(visit).join("");
    }

    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) return escapeHTML(node.nodeValue);
      if (node.nodeType !== Node.ELEMENT_NODE) return "";

      const element = node;
      const tag = element.tagName;
      if (SKIP_TAGS.has(tag) || element.getAttribute("role") === "button") return "";

      if (element.hasAttribute("data-math-source")) {
        const latex = element.getAttribute("data-math-source").trim();
        if (!latex) throw new Error("发现没有源码的公式");
        const display = element.getAttribute("data-math-display") === "true" ||
          Boolean(element.querySelector(".katex-display")) ||
          element.style.display === "block";
        const mathML = latexToMathML(latex, display);
        return display
          ? `<div style="margin:8pt 0;text-align:center;">${mathML}</div>`
          : mathML;
      }

      if ((tag === "SPAN" && element.classList.contains("katex")) ||
          tag === "MATH" || element.getAttribute("role") === "math") {
        throw new Error("发现无法读取源码的公式，请刷新页面或更新扩展");
      }

      if (tag === "BR") return "<br>";
      if (tag === "HR") return '<hr style="border:0;border-top:1px solid #d1d5db;">';
      if (/^H[1-6]$/.test(tag)) return `<${tag.toLowerCase()}>${children(element)}</${tag.toLowerCase()}>`;
      if (tag === "P") return `<p style="margin:0 0 8pt;">${children(element)}</p>`;
      if (tag === "STRONG" || tag === "B") return `<strong>${children(element)}</strong>`;
      if (tag === "EM" || tag === "I") return `<em>${children(element)}</em>`;
      if (tag === "S" || tag === "DEL") return `<del>${children(element)}</del>`;
      if (tag === "SUP" || tag === "SUB") return `<${tag.toLowerCase()}>${children(element)}</${tag.toLowerCase()}>`;

      if (tag === "PRE") {
        return `<pre style="margin:8pt 0;padding:8pt;background:#f3f4f6;border:1px solid #e5e7eb;font-family:Consolas,Menlo,monospace;white-space:pre-wrap;">${escapeHTML(element.textContent)}</pre>`;
      }
      if (tag === "CODE") {
        return `<code style="font-family:Consolas,Menlo,monospace;background:#f3f4f6;">${escapeHTML(element.textContent)}</code>`;
      }

      if (tag === "A") {
        const href = safeURL(element.getAttribute("href"));
        const body = children(element);
        return href
          ? `<a href="${escapeHTML(href)}" style="color:#0563c1;text-decoration:underline;">${body}</a>`
          : body;
      }

      if (tag === "IMG") {
        const src = safeURL(element.getAttribute("src"));
        if (!src) return escapeHTML(element.getAttribute("alt") || "");
        return `<img src="${escapeHTML(src)}" alt="${escapeHTML(element.getAttribute("alt") || "")}" style="max-width:100%;height:auto;">`;
      }

      if (tag === "BLOCKQUOTE") {
        return `<blockquote style="margin:8pt 0;padding-left:10pt;border-left:3px solid #cbd5e1;color:#475569;">${children(element)}</blockquote>`;
      }

      if (tag === "UL" || tag === "OL") {
        const name = tag.toLowerCase();
        const start = tag === "OL" && element.hasAttribute("start")
          ? ` start="${Number(element.getAttribute("start")) || 1}"`
          : "";
        return `<${name}${start} style="margin:6pt 0;padding-left:22pt;">${children(element)}</${name}>`;
      }
      if (tag === "LI") return `<li style="margin:2pt 0;">${children(element)}</li>`;

      if (tag === "TABLE") {
        return `<table style="border-collapse:collapse;margin:8pt 0;width:100%;">${children(element)}</table>`;
      }
      if (["THEAD", "TBODY", "TFOOT", "TR"].includes(tag)) {
        return `<${tag.toLowerCase()}>${children(element)}</${tag.toLowerCase()}>`;
      }
      if (tag === "TH" || tag === "TD") {
        const name = tag.toLowerCase();
        const weight = tag === "TH" ? "font-weight:bold;background:#f3f4f6;" : "";
        return `<${name} style="border:1px solid #cbd5e1;padding:5pt;${weight}">${children(element)}</${name}>`;
      }

      return children(element);
    }

    return children(source);
  }

  function responseToWordHTML(message) {
    const body = responseBodyToWordHTML(message);
    return [
      "<!doctype html>",
      '<html><head><meta charset="utf-8"></head>',
      '<body><!--StartFragment-->',
      '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.35;color:#111827;">',
      body,
      "</div><!--EndFragment--></body></html>"
    ].join("");
  }

  globalThis.ChatEnhanceWord = {
    responseToWordHTML
  };
})();
