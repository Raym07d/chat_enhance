# Chat Enhance

一个无需构建的 Chrome/Edge Manifest V3 扩展。在 ChatGPT 每条回复的原生复制按钮旁增加“复制 Markdown”和“复制到 Word”按钮，并从当前网页 KaTeX 的 `annotation[encoding="application/x-tex"]` 恢复原始 LaTeX。

## 安装

1. 打开 `chrome://extensions`（Edge 使用 `edge://extensions`）。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目目录。
5. 刷新已经打开的 ChatGPT 页面。

更新已有的本地扩展后，先在扩展管理页点“重新加载”，再刷新 ChatGPT 页面。

## 使用

在 ChatGPT assistant 回复底部找到两个与原生操作风格一致的线条按钮。悬停会立即在按钮下方显示名称；ChatGPT 原生复制按钮保持不变。

- 线条 `M` 按钮“复制 Markdown”：复制 Markdown 和 LaTeX 源码，多行代码保留语言标记、缩进和空行。
- 线条 `W` 按钮“复制到 Word”：复制富文本 HTML，多行代码保留等宽代码块格式，并把公式转换为 Presentation MathML。支持的 Word 版本会将其粘贴为原生可编辑公式。
- 点击浏览器工具栏中的 Chat Enhance 图标，再点“保存为 HTML”：扩展先展开被虚拟列表隐藏的对话，再由扩展保存页面样式、图片和字体，保留网页外观，生成可滚动阅读的单文件 HTML。导出期间保持对话标签页打开；结束后恢复原页面布局和滚动位置。面板显示当前阶段、已加载轮数、资源处理数和耗时；关闭面板后任务继续运行，重新打开可查看进度，也可取消任务。

公式转换规则：

- 行内公式：`$...$`
- 块级公式：`$$` 独占一行
- 公式内部的美元符号及其他 LaTeX 内容按网页保存的源码原样保留

## 设置

点击浏览器工具栏中的扩展图标，展开底部“复制设置”，可切换“合并公式内部换行”：

- 默认开启：把公式源码中的真实换行安全转换成空格，提高 Markdown 编辑器兼容性。
- 关闭：完整保留 LaTeX annotation 中的内部换行。

LaTeX 的显式换行命令 `\\` 不受影响。设置通过浏览器同步存储保存，并在下次复制时立即生效，不需要刷新 ChatGPT 页面。

## 网页结构变化

复制时会重新定位当前回复，避免网页替换消息节点后仍读取旧内容。回复定位优先使用消息语义属性和角色标记，不依赖操作栏的样式类；公式读取标准 MathML 中的 LaTeX annotation，代码读取文本和行结构。代码尚未完整加载时会明确提示，不会静默复制缺失的片段。

这些规则降低了对网页外观改动的敏感度；如果网页不再提供相应的语义结构或源码，仍需要更新扩展。

## 隐私

扩展不使用自有服务器、不上传对话内容、不读取剪贴板，也不调用任何 AI API。复制功能只读取当前回复的 DOM；HTML 导出在本机展开对话，直接保存页面样式、图片和字体到本地，不依赖其他浏览器扩展。跨站图片由扩展后台读取；未授权的图片网站会在弹窗中提示按站点授权。

HTML 保留消息原始 DOM、主题属性和所需的祖先容器，去掉侧栏、输入框等应用界面，并解除虚拟列表的固定高度。网页 CSS 由浏览器解析后保存，字体和图片内嵌；不会另套一份自定义的正文版式。

Word 公式转换使用随扩展本地打包的 KaTeX 0.18.7（MIT License），运行时不从 CDN 加载资源。

## 已知限制

- ChatGPT 改动回复操作栏结构后，复制按钮定位规则可能需要更新。
- 公式从 ChatGPT 当前的 KaTeX LaTeX annotation 获取。如果发现公式节点却没有源码，扩展会明确报错，不会退回视觉文字并静默产生损坏结果。
- Word 粘贴为原生公式需要支持 MathML 导入的 Microsoft 365 Word；较旧版本可能把公式作为普通内容处理。
- 复杂的交互式组件、图表和 Canvas 无法完整转换为 Markdown。
- HTML 供静态离线阅读，保留正文、代码、公式、图片和可读取的 Canvas 图表；答题判分等交互不保留。跨域 iframe 应用目前以明确的占位提示替代，并在导出结果的 `warnings` 中返回，不会假装已完整保存。

## Python 调用导出

Python 服务可以复用扩展的导出流程，直接取得 `{html, filename, turns, warnings}`，不触发浏览器下载。需要 Python 3.10+、`pip install 'websockets>=14'`，以及开启本机调试端口（默认 9222）的 Chrome。此 Chrome 中需安装本扩展，并已打开目标对话；同一 URL 只打开一个标签页。更新后重新加载扩展并刷新对话。

将 `examples/chat_enhance.py.txt` 复制到你的 Python 服务目录，并重命名为 `chat_enhance.py` 后导入。不要直接把扩展目录加入 Python 模块路径：Python 导入会生成 `__pycache__`，Chrome 会因此拒绝加载扩展。示例以 `.txt` 保存，避免在扩展目录中被直接导入。

```python
from pathlib import Path
from chat_enhance import export_chatgpt

result = export_chatgpt(
    "https://chatgpt.com/c/你的对话ID",
    extension_id="从 chrome://extensions 获取 Chat Enhance 的 ID",
)
Path("conversation.html").write_text(result["html"], encoding="utf-8")
```

也可以在复制后的 Python 服务目录使用命令行：

```sh
python chat_enhance.py 'https://chatgpt.com/c/你的对话ID' conversation.html --extension-id 扩展ID
```

入口是扩展内的 `api.html` / `exportChatGPT(url)`；Python 通过 CDP 创建临时入口标签页，调用时激活目标对话以便加载内容，结束后关闭临时标签页，不关闭 Chrome 或对话。复用扩展自身的导出逻辑。调用默认等待最多 300 秒；客户端超时不会取消已经开始的浏览器导出，不要立即重试。同一对话请串行调用；异步 Python 服务可用 `await asyncio.to_thread(export_chatgpt, ...)`。调试端口只应对本机开放。

### 接入现有 Flask 项目

将 `examples/chat_enhance.py.txt` 和 `examples/flask_export.py.txt` 复制到 Flask 项目并去掉 `.txt` 后缀，安装 `websockets>=14`，然后注册示例 Blueprint：

```python
from flask_export import chat_exports

app.config["CHAT_ENHANCE_EXTENSION_ID"] = "你的 Chat Enhance 扩展 ID"
app.register_blueprint(chat_exports)
```

扩展 ID 请以当前 Chrome 配置的扩展管理页为准。示例 Blueprint 需接入 Flask 项目现有鉴权。

`POST /api/chatgpt/export` 接收 `{"url":"https://chatgpt.com/c/对话ID"}`，成功返回 HTML 附件；响应头 `X-Chat-Enhance-Turns` 和 `X-Chat-Enhance-Warnings` 分别提供轮数和警告数。直接调用 `export_chatgpt()` 则返回完整的 HTML、文件名、轮数和警告列表，方便接入已有任务系统。

Flask 进程应与 Chrome 在同一台主机运行；目标对话须已打开。此示例同步等待导出，部署时需让 HTTP 服务和代理的超时长于 `CHAT_ENHANCE_TIMEOUT`（默认 300 秒），或复用项目已有后台任务机制。示例锁只限制单个 Flask 进程中的并发；多进程部署应通过已有队列或跨进程锁串行调度。错误响应：400 参数错误、409 正在导出、502 导出失败、503 Chrome 不可达、504 等待超时。
