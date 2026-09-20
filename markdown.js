(function () {
  "use strict";

  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET",
    "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4",
    "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
    "SECTION", "TABLE", "UL"
  ]);

  const REMOVE_SELECTORS = [
    "script",
    "style",
    "template",
    "button",
    "[role='button']",
    "[data-chat-enhance-copy-markdown]",
    "[aria-hidden='true']:not(.katex):not(.katex *)"
  ].join(",");

  function normalizeNewlines(value) {
    return String(value || "").replace(/\r\n?/g, "\n");
  }

  function cleanTex(rawTex) {
    // The formula was already accepted by the page renderer. Preserve its source
    // exactly (apart from surrounding whitespace and newline normalization).
    return normalizeNewlines(rawTex).trim();
  }

  function findUnescapedPercent(line) {
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== "%") continue;

      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) return index;
    }
    return -1;
  }

  function compactMathNewlines(rawTex) {
    const lines = cleanTex(rawTex).split("\n");
    if (lines.length === 1) return lines[0];

    let output = "";
    let separatorAfterPreviousLine = "";

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const commentIndex = findUnescapedPercent(line);
      const withoutComment = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
      const segment = withoutComment.replace(/^[\t ]+|[\t ]+$/g, "");

      if (index > 0 && separatorAfterPreviousLine && output && !output.endsWith(" ")) {
        output += separatorAfterPreviousLine;
      }
      output += segment;
      separatorAfterPreviousLine = commentIndex >= 0
        ? (/[\t ]$/.test(withoutComment) ? " " : "")
        : " ";
    }

    return output.trim();
  }

  function makeMathPlaceholder(documentRef, tex, display) {
    const element = documentRef.createElement(display ? "div" : "span");
    element.setAttribute("data-chat-enhance-math", display ? "display" : "inline");
    element.textContent = tex;
    return element;
  }

  function replaceMath(root, options) {
    const documentRef = root.ownerDocument;

    // ChatGPT keeps the original TeX on an outer semantic wrapper:
    // <span role="math" data-math-source="..."><span class="katex">...</span></span>
    for (const wrapper of Array.from(root.querySelectorAll('[role="math"][data-math-source]'))) {
      if (wrapper.closest("pre, code")) continue;
      const source = wrapper.getAttribute("data-math-source");
      const tex = options.compactMath
        ? compactMathNewlines(source)
        : cleanTex(source);
      if (!tex) continue;
      const display = Boolean(wrapper.querySelector(".katex-display")) ||
        wrapper.style.display === "block";
      wrapper.replaceWith(makeMathPlaceholder(documentRef, tex, display));
    }

    const unresolvedMath = Array.from(root.querySelectorAll('[role="math"], .katex'))
      .find((element) => !element.closest("pre, code, [data-chat-enhance-math]"));
    if (unresolvedMath) {
      throw new Error("发现无法读取源码的公式，请刷新页面或更新扩展");
    }
  }

  function escapeMarkdownText(text) {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/([`*_[\]<>$])/g, "\\$1");
  }

  function escapeLinkDestination(url) {
    return String(url || "").replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
  }

  function inlineCode(value) {
    const text = normalizeNewlines(value).replace(/\n+/g, " ");
    const runs = text.match(/`+/g) || [];
    const longest = runs.reduce((length, run) => Math.max(length, run.length), 0);
    const fence = "`".repeat(longest + 1);
    const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
    return `${fence}${padding}${text}${padding}${fence}`;
  }

  function codeFence(value, language) {
    const text = normalizeNewlines(value).replace(/\n$/, "");
    const runs = text.match(/`{3,}/g) || [];
    const longest = runs.reduce((length, run) => Math.max(length, run.length), 2);
    const fence = "`".repeat(longest + 1);
    return `\n\n${fence}${language || ""}\n${text}\n${fence}\n\n`;
  }

  function indentLines(value, prefix) {
    return value
      .replace(/^\n+|\n+$/g, "")
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
  }

  function tableToMarkdown(table, serializeChildren) {
    const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"));
    if (!rows.length) return "";

    const matrix = rows.map((row) =>
      Array.from(row.children)
        .filter((cell) => cell.matches("th, td"))
        .map((cell) =>
          serializeChildren(cell)
            .replace(/\|/g, "\\|")
            .replace(/\n+/g, "<br>")
            .trim()
        )
    );

    const width = Math.max(...matrix.map((row) => row.length));
    if (!width) return "";
    for (const row of matrix) while (row.length < width) row.push("");

    const hasHeader = rows[0].children.length > 0 &&
      Array.from(rows[0].children).every((cell) => cell.tagName === "TH");
    const header = matrix[0];
    const body = hasHeader ? matrix.slice(1) : matrix.slice(1);
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...body.map((row) => `| ${row.join(" | ")} |`)
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  }

  function serialize(root) {
    function children(node, context = {}) {
      return Array.from(node.childNodes).map((child) => visit(child, context)).join("");
    }

    function visit(node, context = {}) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = normalizeNewlines(node.nodeValue);
        if (context.preformatted) return text;
        return escapeMarkdownText(text.replace(/[\t\n ]+/g, " "));
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const element = node;
      const tag = element.tagName;

      if (element.hasAttribute("data-chat-enhance-math")) {
        const tex = element.textContent;
        return element.getAttribute("data-chat-enhance-math") === "display"
          ? `\n\n$$\n${tex}\n$$\n\n`
          : `$${tex}$`;
      }

      if (tag === "BR") return "\n";
      if (tag === "HR") return "\n\n---\n\n";

      if (/^H[1-6]$/.test(tag)) {
        return `\n\n${"#".repeat(Number(tag[1]))} ${children(element).trim()}\n\n`;
      }

      if (tag === "P") return `\n\n${children(element).trim()}\n\n`;
      if (tag === "STRONG" || tag === "B") return `**${children(element)}**`;
      if (tag === "EM" || tag === "I") return `*${children(element)}*`;
      if (tag === "S" || tag === "DEL") return `~~${children(element)}~~`;

      if (tag === "PRE") {
        const code = element.querySelector("code") || element;
        const className = code.getAttribute("class") || "";
        const match = className.match(/(?:language-|lang-)([\w#+.-]+)/i);
        return codeFence(code.textContent, match ? match[1] : "");
      }

      if (tag === "CODE") return inlineCode(element.textContent);

      if (tag === "A") {
        const label = children(element).trim();
        const href = element.getAttribute("href") || "";
        if (!href || href.startsWith("javascript:")) return label;
        const title = element.getAttribute("title");
        return `[${label || href}](${escapeLinkDestination(href)}${title ? ` \"${title.replace(/\"/g, "\\\"")}\"` : ""})`;
      }

      if (tag === "IMG") {
        const src = element.getAttribute("src") || "";
        const alt = (element.getAttribute("alt") || "").replace(/\]/g, "\\]");
        return src ? `![${alt}](${escapeLinkDestination(src)})` : "";
      }

      if (tag === "BLOCKQUOTE") {
        return `\n\n${indentLines(children(element), "> ")}\n\n`;
      }

      if (tag === "UL" || tag === "OL") {
        const ordered = tag === "OL";
        const start = Number(element.getAttribute("start")) || 1;
        const items = Array.from(element.children).filter((child) => child.tagName === "LI");
        const rendered = items.map((item, index) => {
          const marker = ordered ? `${start + index}. ` : "- ";
          const value = children(item, { ...context, listItem: true })
            .replace(/^\n+|\n+$/g, "")
            .replace(/\n/g, `\n${" ".repeat(marker.length)}`);
          return `${marker}${value}`;
        });
        return `\n\n${rendered.join("\n")}\n\n`;
      }

      if (tag === "LI") return children(element, context);
      if (tag === "TABLE") return tableToMarkdown(element, (cell) => children(cell));

      const content = children(element, context);
      if (BLOCK_TAGS.has(tag)) return `\n${content}\n`;
      return content;
    }

    return children(root)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function findResponseContent(message) {
    return (
      message.querySelector("[data-message-content]") ||
      message.querySelector(".markdown") ||
      message.querySelector("[class*='markdown']") ||
      message
    );
  }

  function responseToMarkdown(message, options = {}) {
    const source = findResponseContent(message);
    const clone = source.cloneNode(true);
    const normalizedOptions = {
      compactMath: options.compactMath !== false
    };

    replaceMath(clone, normalizedOptions);
    for (const unwanted of Array.from(clone.querySelectorAll(REMOVE_SELECTORS))) {
      unwanted.remove();
    }

    return serialize(clone);
  }

  globalThis.ChatEnhanceMarkdown = {
    cleanTex,
    compactMathNewlines,
    responseToMarkdown
  };
})();
