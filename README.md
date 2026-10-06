# edge-mcp

一个让你用自然语言控制 Microsoft Edge 浏览器的 MCP（Model Context Protocol）server。

它通过 Chrome DevTools Protocol (CDP) 连接到一个**已经启动好的** Edge 实例，把浏览器能力以 16 个工具的形式暴露给任何 MCP 客户端。模型可以打开网页、点击、输入、截图、读取页面内容、管理标签页。

## 两种运行模式

本 server 支持两种模式，覆盖所有 MCP 客户端的接入方式：

| 模式 | 启动方式 | 适用场景 | 地址 |
|---|---|---|---|
| **stdio**（默认） | `node src/index.js` | 客户端自己拉起子进程（ZCode / Claude Desktop 的 stdio 配置） | 无，进程间管道 |
| **HTTP 常驻**（推荐多 agent 共享） | `node src/index.js --http` | 一个 URL 让本机所有 agent 共享同一个 Edge 会话 | `http://127.0.0.1:7123/mcp` |

**为什么有 HTTP 模式？** stdio 模式下每个客户端各自启动一个 server 进程、各自独立。HTTP 模式下，server 常驻后台，所有 agent（ZCode、Claude Desktop、Cursor、Cline 等）指向同一个 URL，共享同一个 Edge 浏览器会话——你在 A 工具里打开的标签页，B 工具也能看到和操作。

> 关于"Edge 扩展"：浏览器扩展运行在沙箱内，不能监听端口、不能说 stdio，因此**无法直接做成 MCP server**。HTTP 常驻服务才是"独立地址 + 所有 agent 共享"的正确实现。

## 工作原理

```
                         stdio 模式:                          HTTP 模式:
  MCP 客户端 ──spawn──> edge-mcp 进程 ──CDP──> Edge      所有 MCP 客户端 ──HTTP──> edge-mcp 常驻进程 ──CDP──> Edge
  (一对一，各自独立)                                   (多对一，共享同一 Edge 会话)
```

- Edge 由你自己启动（带调试端口），server 不负责拉起浏览器，只负责连接。
- 连接是**懒加载**的：server 启动时不连 Edge，第一次调用工具时才连。即使 Edge 没开，server 也能正常启动；调用工具时返回友好错误。
- CDP 端口默认 `9222`，可用环境变量 `EDGE_CDP_PORT` 覆盖。

## 前置要求

- Node.js >= 20（已在 v24 上测试）
- Microsoft Edge（Chromium 内核，已测试 Edg/150）
- 一个 MCP 客户端（ZCode / Claude Desktop / Cursor / Cline 等）

## 安装

```bash
# 方式一：npm 全局安装（依赖自动装齐）
npm install -g edge-mcp
edge-mcp --http        # HTTP 常驻模式
edge-mcp               # stdio 模式

# 方式二：免安装直接运行
npx edge-mcp --http

# 方式三：从源码
git clone https://github.com/hualang-C/edge-mcp.git edge-mcp
cd edge-mcp
npm install
```

## 第一步：启动 Edge（带调试端口）

Edge 必须先启动并开放 CDP 端口。**用独立的 user-data-dir**，避免和你日常浏览的 Edge 冲突：

```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
  --remote-debugging-port=9222 \
  --user-data-dir="C:/Temp/EdgeMCP" \
  --remote-allow-origins=* \
  --no-first-run \
  --no-default-browser-check
```

> - `--user-data-dir` 指向空目录，会创建独立 profile（不影响你已登录的 Edge 会话）。
> - `--remote-allow-origins=*` 允许本地 Node 进程通过 WebSocket 连接（新版 Chromium 必需）。
> - 想复用你已登录的 Edge 会话？去掉 `--user-data-dir`，但要先完全退出日常使用的 Edge 再用这条命令启动。

验证 Edge 已就绪：
```bash
curl http://127.0.0.1:9222/json/version
# 应返回包含 "webSocketDebuggerUrl" 的 JSON
```

---

## 第二步（A）：HTTP 模式 —— 多 agent 共享（推荐）

### 启动常驻服务

```bash
# 在项目根目录（package.json 所在目录）执行
node src/index.js --http
# 或: npm run start:http
```

服务监听 `http://127.0.0.1:7123/mcp`。可用环境变量改地址：
```bash
PORT=8080 HOST=127.0.0.1 node src/index.js --http
```

验证：
```bash
curl http://127.0.0.1:7123/health
# {"ok":true,"service":"edge-mcp","tools":16}
```

> 想开机常驻？把这个命令设为 Windows 启动项，或用任务计划程序/PM2 守护。

### 各 MCP 客户端配置（指向同一 URL）

**ZCode**（`~/.zcode/cli/config.json`）：
```json
{
  "mcp": {
    "servers": {
      "edge": {
        "type": "http",
        "url": "http://127.0.0.1:7123/mcp"
      }
    }
  }
}
```

**Claude Desktop**（`claude_desktop_config.json`）：
```json
{
  "mcpServers": {
    "edge": {
      "url": "http://127.0.0.1:7123/mcp",
      "type": "http"
    }
  }
}
```

**Cursor / Cline / 其他**：在各自的 MCP 设置里填 URL `http://127.0.0.1:7123/mcp`，类型选 HTTP / streamable-http。

配置好后，所有客户端都共享同一个 Edge 浏览器会话。

---

## 第二步（B）：stdio 模式 —— 客户端各自拉起

适合不想常驻后台、让客户端按需启动的场景。每个客户端各自启动一个 server 进程（彼此独立）。

**ZCode**（`~/.zcode/cli/config.json`）：
```json
{
  "mcp": {
    "servers": {
      "edge": {
        "command": "node",
        "args": ["<edge-mcp 的绝对路径>/src/index.js"]
      }
    }
  }
}
```

**Claude Desktop**：
```json
{
  "mcpServers": {
    "edge": {
      "command": "node",
      "args": ["<edge-mcp 的绝对路径>/src/index.js"]
    }
  }
}
```

> 把 `<edge-mcp 的绝对路径>` 替换为你机器上 clone 的实际路径（如 `C:/dev/edge-mcp` 或 `~/projects/edge-mcp`）。路径含空格时，args 必须用数组形式（如上）而不是单个字符串，避免被错误拆分。

---

## 工具列表（16 个）

所有导航/交互/读取工具都作用于**当前活动标签页**。要操作特定标签页，先用 `switch_tab` 切换。

### 导航（4）
| 工具 | 参数 | 说明 |
|---|---|---|
| `navigate` | `url`*, `waitUntil`=`load` | 跳转到 URL。`waitUntil`: `load`/`domcontentloaded`/`networkidle0`/`networkidle2` |
| `go_back` | — | 后退一步 |
| `go_forward` | — | 前进一步 |
| `reload` | `waitUntil`=`load` | 刷新当前页 |

### 交互（4）
| 工具 | 参数 | 说明 |
|---|---|---|
| `click` | `selector`*, `button`=`left`, `clickCount`=1, `delay`=0 | 点击元素（CSS 选择器） |
| `type` | `selector`*, `text`*, `delay`=0 | 逐字符输入（触发 keydown/keyup，适合 contenteditable） |
| `fill` | `selector`*, `text`* | 一次性设置 input/textarea/select 的值（清空后赋值，派发 input 事件，框架友好） |
| `press` | `key`*, `hold`=0 | 按键，如 `Enter`/`Tab`/`Escape`/`ArrowDown` 或单字符 `a` |

### 读取（4）
| 工具 | 参数 | 说明 |
|---|---|---|
| `screenshot` | `format`=`png`, `fullPage`=`true`, `quality`=80 | 截图，返回 base64 图片（模型可直接看到）。`quality` 仅 jpeg 生效 |
| `get_text` | `selector`? | 返回元素或整页的可见文本（`innerText`） |
| `get_html` | `selector`? | 返回元素的 `outerHTML` 或整页 HTML |
| `evaluate` | `expression`* | 在页面上下文执行 JS 表达式，返回 JSON 结果。可用 `document`/`window`，支持 `await` |

### 标签页（4）
| 工具 | 参数 | 说明 |
|---|---|---|
| `list_tabs` | — | 列出所有标签页的 `targetId`/`url`/`title` |
| `new_tab` | `url`? | 新建标签页（可带 URL），返回 `targetId` |
| `switch_tab` | `targetId`* | 切到指定标签页并前置（之后其他工具作用于它） |
| `close_tab` | `targetId`? | 关闭标签页（省略则关活动标签页） |

`*` = 必填，`?` = 可选。

## 典型用法示例

```
1. navigate       -> url: https://www.bing.com
2. fill           -> selector: "#sb_form_q", text: "MCP protocol"
3. press          -> key: Enter
4. screenshot     -> fullPage: false
5. get_text       -> selector: "#b_results"
```

## 常见问题

**调用工具报错："Could not reach Edge at http://127.0.0.1:9222"**
Edge 没启动或没带调试端口。按"第一步"启动 Edge，并用 `curl http://127.0.0.1:9222/json/version` 验证。

**HTTP 模式连不上 / 端口被占用**
换端口：`PORT=8080 node src/index.js --http`，并相应改客户端配置里的 URL。

**找不到元素**
页面可能还没加载完。`navigate` 时用 `waitUntil: "networkidle0"`，或先 `screenshot` 看当前状态。

**`type` vs `fill` 怎么选**
- `type`：逐字符输入，触发完整键盘事件，适合 contenteditable、自动补全下拉。
- `fill`：直接设 DOM value，更快，适合普通 input/textarea/select。

**关闭 server 会关掉 Edge 吗**
不会。server 退出只断开 CDP 连接，Edge 进程继续运行。

**stdio 和 HTTP 能同时用吗**
能。但更推荐统一用 HTTP 模式，避免多个 server 进程争抢同一个 Edge 调试端口。

## 项目结构

```
edge-mcp/
├── package.json
├── README.md
└── src/
    ├── index.js           # 入口：按 --http 参数分流到 stdio 或 HTTP
    ├── server.js          # 共享的 McpServer 工厂（注册 16 个工具）
    ├── http.js            # HTTP 常驻服务（Streamable HTTP, stateless）
    ├── browser.js         # Edge 连接管理：单例/懒连接/重连/取活动页
    └── tools/
        ├── navigation.js  # navigate / go_back / go_forward / reload
        ├── interaction.js # click / type / fill / press
        ├── read.js        # screenshot / get_text / get_html / evaluate
        └── tabs.js        # list_tabs / new_tab / switch_tab / close_tab
```

## 安全提示

- CDP 调试端口允许任意本地进程在浏览器里执行 JavaScript、读取 cookie 和敏感数据。**不要**把端口暴露到公网。
- HTTP 服务默认绑定 `127.0.0.1`（仅本机）。若设 `HOST=0.0.0.0` 暴露到局域网，务必了解风险——任何能访问该端口的人都能控制你的 Edge。
- `--remote-allow-origins=*` 仅用于本机开发。

## License

[MIT](LICENSE)
