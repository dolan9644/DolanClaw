# DolanClaw 开发文档

> 本文档记录 DolanClaw 平台的完整功能、架构、文件结构和 API，供新窗口或新开发者参考。
> 最后更新：2026-04-02

---

## 一、项目定位

DolanClaw 是一个**本地运行的 Agentic AI 编程平台**，核心能力：

1. **Agentic AI** — AI 自主规划任务、多轮工具调用、子任务委派
2. **AI 编程** — 读写文件、执行命令、搜索代码、管理项目
3. **多模型调度** — 9+ 家国内外模型统一接入
4. **MCP 工具生态** — 通过 Model Context Protocol 接入任意外部工具
5. **技能系统** — Markdown 驱动的可复用工作流

---

## 二、技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Bun (TypeScript) |
| 前端 | React 18 + TypeScript + Vite |
| 样式 | Vanilla CSS 设计系统 |
| 字体 | Outfit + JetBrains Mono |
| 图标 | SVG 描边图标系统（16x16, stroke-based, currentColor） |
| API 协议 | OpenAI 兼容格式 + Anthropic 原生适配 |
| 流式传输 | Server-Sent Events (SSE) |
| MCP | JSON-RPC 2.0 over stdio |
| 设计规范 | `design-taste-frontend/SKILL.md` |

---

## 三、运行环境

```bash
# 后端（端口 3000）
bun run src/entrypoints/web.ts --port 3000

# 前端（端口 5173，代理到 3000）
cd web && npm run dev
```

**环境变量**（`.env` 文件）：
- `MINIMAX_API_KEY` — MiniMax
- `DEEPSEEK_API_KEY` — DeepSeek
- `MOONSHOT_API_KEY` — Kimi
- `DASHSCOPE_API_KEY` — 通义千问
- `ZHIPU_API_KEY` — GLM
- `ANTHROPIC_API_KEY` — Claude
- `GEMINI_API_KEY` — Gemini
- `OPENAI_API_KEY` — GPT
- `DOLANCLAW_API_SECRET` — 可选访问密钥

---

## 四、项目文件结构

```
DolanClaw/
├── src/
│   ├── entrypoints/
│   │   └── web.ts              # 后端主入口（3166 行，所有 API 端点）
│   ├── services/
│   │   ├── api/
│   │   │   └── openaiClient.ts # OpenAI 兼容客户端（637 行）
│   │   └── mcp/
│   │       └── McpManager.ts   # MCP 核心管理器（558 行）
│   ├── assistant/              # 会话管理
│   ├── ink/                    # 终端 UI 渲染（CLI 模式）
│   └── vim/                    # Vim 模式支持
│
├── web/
│   └── src/
│       ├── App.tsx             # 路由 + 页面切换
│       ├── main.tsx            # React 入口
│       ├── index.css           # 全局设计系统
│       ├── components/
│       │   ├── Sidebar.tsx     # 侧边栏导航
│       │   ├── Icons.tsx       # SVG 图标系统
│       │   ├── CommandPalette.tsx # ⌘K 命令面板
│       │   └── KeyboardShortcutsHelp.tsx
│       └── pages/
│           ├── ChatPage.tsx         # 对话页面（核心）
│           ├── DashboardPage.tsx    # 监控面板
│           ├── FileBrowserPage.tsx  # 文件浏览器
│           ├── DiffViewPage.tsx     # Git 变更视图
│           ├── TaskBoardPage.tsx    # 任务看板
│           ├── MemoryPage.tsx       # 记忆管理
│           ├── McpPage.tsx          # MCP 服务器管理
│           ├── SkillsAgentsPage.tsx # 技能 & 代理
│           ├── ToolsPage.tsx        # 工具浏览器
│           ├── RegistryPage.tsx     # 扩展市场
│           ├── ModelsPage.tsx       # 模型管理
│           └── MorePages.tsx        # 权限管理 + 会话管理 + 设置
│
├── .claude/
│   ├── skills/                 # 技能目录（*.md）
│   ├── commands/               # 斜杠命令（*.md）
│   └── hooks.json              # 工具调用钩子
│
├── .mcp.json                   # MCP 服务器项目配置
├── design-taste-frontend/      # 前端设计规范（SKILL.md）
└── tests/                      # 测试文件
```

---

## 五、后端 API 完整列表

### 对话 & AI

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 流式对话（SSE），支持多模型切换 |
| POST | `/api/agents/:name/run` | Agentic Loop 执行（多轮工具调用，最多 10 轮） |

### 工具

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tools` | 工具列表（内置 12 个 + MCP 动态工具） |
| POST | `/api/tools/execute` | 单次工具执行 |

### MCP 服务器

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mcp/status` | 所有 MCP 服务器状态 |
| POST | `/api/mcp/connect` | 连接服务器 |
| POST | `/api/mcp/disconnect` | 断开连接 |
| POST | `/api/mcp/restart` | 重启服务器 |
| POST | `/api/mcp/add` | 运行时添加新服务器 |

### 技能 & 命令 & 钩子

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills` | 技能列表（扫描 `.claude/skills/*.md`） |
| PUT | `/api/skills/toggle` | 启用/禁用技能 |
| GET | `/api/commands` | 斜杠命令列表（扫描 `.claude/commands/*.md`） |
| GET | `/api/hooks` | 获取钩子配置 |
| PUT | `/api/hooks` | 更新钩子配置 |

### 社区注册中心

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/registry` | 扩展市场目录（12 MCP + 5 技能模板） |
| POST | `/api/registry/install-mcp` | 一键安装 MCP 服务器 |
| POST | `/api/registry/install-skill` | 安装远程技能模板 |

### 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/models` | 可用模型列表（根据 env 动态生成） |
| POST | `/api/bash` | Shell 命令执行（需认证） |
| GET | `/api/files` | 文件列表 |
| GET | `/api/file` | 读取文件内容 |
| GET | `/api/git/diff` | Git 差异统计 |
| GET | `/api/memory` | 记忆条目 |
| GET | `/api/sessions` | 会话列表 |

---

## 六、Agentic Loop 架构

```
用户消息
    │
    ▼
┌─────────────────────────────┐
│  POST /api/agents/:name/run │
│                             │
│  1. 构建 messages[]         │
│  2. 注入 auto 技能到 system │
│  3. 合并内置工具 + MCP 工具  │
│  4. 调用 LLM                │
│     ├── 有 tool_calls?      │
│     │   ├── YES → 执行工具   │
│     │   │   ├── 内置工具     │
│     │   │   └── mcp__ 路由   │
│     │   │       → McpManager │
│     │   ├── 追加结果到 msgs  │
│     │   └── 回到步骤 4      │
│     └── NO → 返回最终回复    │
│                             │
│  最多 10 次迭代             │
└─────────────────────────────┘
```

### 内置工具（12 个）

| 工具 | 说明 | 权限 |
|------|------|------|
| Bash / BashTool | 执行 Shell 命令 | confirm |
| FileEdit / FileEditTool | 字符串替换编辑文件 | confirm |
| FileWrite / FileWriteTool | 创建或覆写文件 | confirm |
| FileRead / FileReadTool | 读取文件内容 | auto |
| Glob / GlobTool | 文件名模式搜索 | auto |
| Grep / GrepTool | 正则内容搜索 | auto |
| Agent | 创建子代理 | auto |
| MCPTool | 调用 MCP 工具 | confirm |
| WebSearch | 搜索互联网 | auto |
| WebFetch | 抓取网页 | auto |
| TodoWrite | 管理待办事项 | auto |
| NotebookEdit | 编辑 Jupyter Notebook | confirm |

### MCP 工具命名

MCP 工具以 `mcp__{server}__{tool}` 格式注册，例如：
- `mcp__filesystem__read_file`
- `mcp__memory__create_entities`
- `mcp__brave-search__web_search`

---

## 七、MCP 管理器（McpManager）

**文件**：`src/services/mcp/McpManager.ts`（558 行）

### 核心功能
- stdio JSON-RPC 2.0 通信
- `Bun.spawn()` 管理子进程
- `initialize → initialized → tools/list` 三步握手
- `tools/call` 工具调用
- 自动重连（指数退避，最大 10s）
- 优雅关闭（SIGTERM → 超时 SIGKILL）

### 配置方式

**项目级**（`.mcp.json`）：
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    }
  }
}
```

### 预置 MCP 服务器（12 个）

| 服务器 | 类别 | NPM 包 | 需要 Key |
|--------|------|--------|---------|
| filesystem | 核心工具 | @modelcontextprotocol/server-filesystem | 否 |
| memory | 核心工具 | @modelcontextprotocol/server-memory | 否 |
| fetch | 核心工具 | @modelcontextprotocol/server-fetch | 否 |
| sequential-thinking | 推理增强 | @modelcontextprotocol/server-sequential-thinking | 否 |
| brave-search | 搜索 | @modelcontextprotocol/server-brave-search | BRAVE_API_KEY |
| github | 开发工具 | @modelcontextprotocol/server-github | GITHUB_PERSONAL_ACCESS_TOKEN |
| puppeteer | 浏览器 | @modelcontextprotocol/server-puppeteer | 否 |
| sqlite | 数据库 | @modelcontextprotocol/server-sqlite | 否 |
| postgres | 数据库 | @modelcontextprotocol/server-postgres | 否 |
| slack | 协作 | @modelcontextprotocol/server-slack | SLACK_BOT_TOKEN |
| everything | 测试 | @modelcontextprotocol/server-everything | 否 |
| firecrawl | 搜索 | @modelcontextprotocol/server-firecrawl | FIRECRAWL_API_KEY |

---

## 八、技能系统

### 目录结构

```
.claude/skills/
├── deploy.md          # 部署技能
├── code-review.md     # 代码审查技能
└── ...
```

### 文件格式

```markdown
---
name: code-review
description: 代码审查最佳实践
trigger: auto          # auto = 自动注入 System Prompt
---

# 审查要点
- 安全性
- 性能
- 可维护性
```

### API

- `GET /api/skills` — 返回所有技能（从文件系统扫描）
- `PUT /api/skills/toggle` — 启用/禁用指定技能

### 注入机制

`trigger: auto` 的技能内容会被追加到 System Prompt 的末尾，在 `/api/chat` 和 `/api/agents/:name/run` 中生效。

---

## 九、斜杠命令

### 目录结构

```
.claude/commands/
├── review.md          # /review 命令
└── ...
```

### 文件格式

```markdown
---
description: 代码审查命令
---

请审查以下变更：
$ARGUMENTS
```

### 内置命令

| 命令 | 说明 |
|------|------|
| `/clear` | 清空对话 |
| `/compact` | 压缩对话（保留摘要） |
| `/cost` | 显示累计 Token 使用 |
| `/help` | 帮助信息 |
| `/model` | 切换模型 |

自定义命令会与内置命令合并，在 ChatPage 输入 `/` 时显示补全列表。

---

## 十、Hooks 钩子

### 配置文件

`.claude/hooks.json`：

```json
{
  "hooks": [
    {
      "type": "PreToolUse",
      "toolName": "Bash",
      "command": "echo \"即将执行: $HOOK_TOOL_INPUT\""
    },
    {
      "type": "PostToolUse",
      "toolName": "*",
      "command": "logger -t dolanclaw \"工具完成: $HOOK_TOOL_NAME\""
    }
  ]
}
```

### 钩子类型

| 类型 | 触发时机 | 环境变量 |
|------|---------|---------|
| PreToolUse | 工具执行前 | `$HOOK_TOOL_NAME`, `$HOOK_TOOL_INPUT` |
| PostToolUse | 工具执行后 | `$HOOK_TOOL_NAME`, `$HOOK_TOOL_OUTPUT` |

如果 PreToolUse 返回非零退出码，工具调用会被阻止。

---

## 十一、前端页面

### 页面路由（App.tsx → PageId）

| PageId | 组件 | 功能 |
|--------|------|------|
| `chat` | ChatPage | 核心对话（SSE 流式 + 工具调用可视化） |
| `dashboard` | DashboardPage | 监控面板 |
| `files` | FileBrowserPage | 文件浏览器（树状目录 + 语法高亮） |
| `diff` | DiffViewPage | Git Staged/Unstaged 变更 |
| `tasks` | TaskBoardPage | Kanban 任务看板 |
| `memory` | MemoryPage | 记忆管理（项目/用户/团队） |
| `mcp` | McpPage | MCP 服务器管理（连接/断开/重启/添加） |
| `skills` | SkillsAgentsPage | 技能 & 代理管理 |
| `tools` | ToolsPage | 工具浏览器（试用面板） |
| `registry` | RegistryPage | 扩展市场（分类/搜索/安装） |
| `models` | ModelsPage | 模型管理 |
| `permissions` | MorePages | 权限管理 |
| `sessions` | MorePages | 会话管理 |
| `settings` | MorePages | 设置 |

### 侧边栏分组

```
核心: 对话 | 监控面板
开发: 文件浏览器 | 变更视图 | 任务看板 | 记忆
扩展: MCP 服务器 | 技能 & 代理 | 工具浏览器 | 扩展市场
系统: 模型管理 | 权限管理 | 会话管理 | 设置
```

### 设计规范

- **CSS 类层级**：`.page` → `.page-header` → `.page-toolbar` → `.page-body`
- **卡片**：`.tool-card`（header + desc + footer 三段式）
- **过滤器**：`.filter-tab` / `.filter-tab.active`
- **图标**：`Icons.tsx`，全部 16x16 SVG，`stroke: currentColor`

---

## 十二、支持的模型

| 模型 | 提供商 | Key 环境变量 | API 格式 |
|------|--------|-------------|---------|
| MiniMax M2.7 / M2.7 极速 | MiniMax | `MINIMAX_API_KEY` | OpenAI 兼容 |
| MiniMax M2.5 / Text-01 | MiniMax | `MINIMAX_API_KEY` | OpenAI 兼容 |
| DeepSeek V3 / R1 | 深度求索 | `DEEPSEEK_API_KEY` | OpenAI 兼容 |
| Kimi K2.5 / 128K | 月之暗面 | `MOONSHOT_API_KEY` | OpenAI 兼容 |
| 通义千问 Qwen3 Max | 阿里云 | `DASHSCOPE_API_KEY` | OpenAI 兼容 |
| GLM-5 / GLM-4 Plus | 智谱 AI | `ZHIPU_API_KEY` | OpenAI 兼容 |
| Claude Sonnet 4 / 3.5 / Haiku | Anthropic | `ANTHROPIC_API_KEY` | Anthropic 原生 |
| Gemini 2.5 Pro / Flash | Google | `GEMINI_API_KEY` | OpenAI 兼容 |
| GPT-4o / GPT-4.1 / o3 | OpenAI | `OPENAI_API_KEY` | OpenAI 原生 |

### 模型调度逻辑（openaiClient.ts）

1. 根据 `modelKey` 查表得到 `{ baseURL, apiKey, model }`
2. 不同提供商的 `baseURL` 不同：
   - MiniMax: `https://api.minimax.chat/v1`
   - DeepSeek: `https://api.deepseek.com/v1`
   - Kimi: `https://api.moonshot.cn/v1`
   - 通义: `https://dashscope.aliyuncs.com/compatible-mode/v1`
   - 智谱: `https://open.bigmodel.cn/api/paas/v4`
   - Anthropic: `https://api.anthropic.com/v1/messages`（特殊处理）
   - Gemini: `https://generativelanguage.googleapis.com/v1beta/openai`
3. 统一走 OpenAI SDK 兼容格式，Anthropic 走原生适配

---

## 十三、安全机制

| 机制 | 说明 |
|------|------|
| API Key 隔离 | Key 只在后端 `.env` 中，前端永远不接触 |
| 访问密钥 | `DOLANCLAW_API_SECRET` 保护写入类操作 |
| 频率限制 | 每 IP 60 次/分钟 |
| 路径校验 | 文件访问限制在工作目录内 |
| 钩子拦截 | PreToolUse 可阻止危险工具调用 |
| 命令过滤 | `/api/bash` 有基础命令过滤 |

---

## 十四、Git 提交历史（关键节点）

```
3dccade docs: 补充重要声明（上游致谢 + 商标 + 数据安全）
f6b81d4 docs: 致谢补充 Claude Code Best 项目
27fd465 docs: 重写 README — 独立定位为 Agentic AI 编程平台
1cd796f feat: 完成 Agentic Loop 全栈架构改造
fe3e40e fix: /api/bash 安全加固 + 代码规范优化
f90eb81 feat: 新增 Claude/Anthropic 接口支持 + 22 模型全面升级
d022448 初始发布: DolanClaw 国产大模型统一调度平台
```
