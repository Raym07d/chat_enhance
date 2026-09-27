# ChatGPT Markdown Copy

一个无需构建的 Chrome/Edge Manifest V3 扩展。在 ChatGPT 每条回复的原生复制按钮旁增加“复制 Markdown”和“复制到 Word”按钮，并从页面 DOM 的 `data-math-source` 恢复原始 LaTeX。兼容新版 ChatGPT 回复容器与 `data-math-display` 公式节点。

## 安装

1. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`）。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录。
5. 刷新已经打开的 ChatGPT 页面。

## 使用

在 ChatGPT assistant 回复底部找到两个与原生操作风格一致的线条按钮。悬停会立即在按钮下方显示名称；ChatGPT 原生复制按钮保持不变。

- 线条 `M` 按钮“复制 Markdown”：复制 Markdown 和 LaTeX 源码。
- 线条 `W` 按钮“复制到 Word”：复制富文本 HTML，并把公式转换为 Presentation MathML。支持的 Word 版本会将其粘贴为原生可编辑公式。

公式转换规则：

- 行内公式：`$...$`
- 块级公式：`$$` 独占一行
- 公式内部的美元符号及其他 LaTeX 内容按网页保存的源码原样保留

## 设置

点击浏览器工具栏中的扩展图标，可切换“合并公式内部换行”：

- 默认开启：把公式源码中的真实换行安全转换成空格，提高 Markdown 编辑器兼容性。
- 关闭：完整保留 `data-math-source` 中的内部换行。

LaTeX 的显式换行命令 `\\` 不受影响。设置通过浏览器同步存储保存，并在下次复制时立即生效，不需要刷新 ChatGPT 页面。

## 隐私

扩展不使用服务器、不发送网络请求、不读取剪贴板，也不调用任何 AI API。它只读取当前 ChatGPT 回复的 DOM，并在用户点击按钮后写入剪贴板。

Word 公式转换使用随扩展本地打包的 KaTeX 0.18.7（MIT License），运行时不从 CDN 加载资源。

## 已知限制

- ChatGPT 改动回复操作栏结构后，复制按钮定位规则可能需要更新。
- 公式从 ChatGPT 当前的 `[data-math-source]` 获取。如果发现公式节点却没有源码，扩展会明确报错，不会退回视觉文字并静默产生损坏结果。
- Word 粘贴为原生公式需要支持 MathML 导入的 Microsoft 365 Word；较旧版本可能把公式作为普通内容处理。
- 复杂的交互式组件、图表和 Canvas 无法完整转换为 Markdown。
