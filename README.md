# DolanClaw — 本地 Agentic AI 编程平台

<p align="center">
  <strong>一个本地运行的 Agentic AI 编程平台，支持多模型调度与工具扩展</strong><br>
  <sub>自主编程 · 多模型调度 · MCP 工具生态 · 技能系统</sub><br>
  <sub>⚠️ 本项目仅供学习研究用途，请勿用于商业用途</sub>
</p>

<p align="center">
  <a href="#什么是-dolanclaw">什么是 DolanClaw</a> •
  <a href="#功能概览">功能概览</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#mcp-工具生态">MCP 工具生态</a> •
  <a href="#支持的模型">支持的模型</a> •
  <a href="#许可证">许可证</a>
</p>

---

> **⚠️ 重要声明**
>
> 1. 本项目**仅供学习、研究和技术交流**，不得用于任何商业用途。
> 2. 本项目基于 [Claude Code Best](https://github.com/claude-code-best/claude-code) 的开源架构进行学习性二次开发，**核心代码来自上游项目**，本项目主要贡献在于 Web UI 界面和国产大模型适配层。
> 3. 本项目与 Anthropic、OpenAI、MiniMax、DeepSeek 等模型提供商**无任何关联**，也未获得上述任何公司的授权或背书。

> **商标声明**：本项目中提及的 MiniMax、DeepSeek、Kimi、通义千问、GLM、Claude、Gemini、GPT
> 等均为各自公司的注册商标。本项目不包含任何上述公司的 Logo 或品牌素材，仅通过
> 标准 API 接口进行调用。

> **数据安全**：本工具不存储任何用户数据。所有对话记录仅存在于浏览器本地 (localStorage)，
> API 请求直接转发至用户自行配置的模型服务商，本项目不做任何中间存储或日志记录。
> 用户应自行评估将敏感代码/数据发送至第三方 API 的风险。

---

## 什么是 DolanClaw

DolanClaw 是一个**本地运行**的 Agentic AI 编程平台。它可以连接你喜欢的任何大语言模型，让 AI 像一个真正的编程搭档一样工作 —— 读写文件、执行命令、搜索代码、管理项目，而不仅仅是对话。

**核心理念：**

- **Agentic** — 不只是聊天。AI 可以自主规划任务、调用工具、多轮迭代，直到完成目标
- **本地优先** — 所有代码和数据留在你的机器上，API Key 不经过任何第三方
- **模型无关** — 不绑定任何一家模型提供商。MiniMax、DeepSeek、Kimi、Claude、Gemini、GPT 等均可接入
- **可扩展** — 通过 MCP 协议接入任意外部工具，通过技能系统定义可复用的工作流

---

## 功能概览

### AI 编程能力

DolanClaw 的核心是一个 **Agentic Loop 引擎** —— AI 不只是回答问题，而是可以自主完成编程任务：

- **读写文件** — AI 可以浏览项目目录、读取源码、创建和编辑文件
- **执行命令** — 运行构建、测试、部署等任意 Shell 命令
- **搜索代码** — 通过 grep / glob 在项目中精确搜索
- **多轮迭代** — AI 执行一个动作后可以观察结果，自主决定下一步（最多 10 轮）
- **子任务委派** — 将复杂任务拆分给子 Agent 并行处理

### MCP 工具生态

通过 [Model Context Protocol](https://modelcontextprotocol.io/) 接入外部工具，让 AI 的能力不再局限于文件系统：

- 12+ 预置工具服务器（文件系统、知识图谱、网页搜索、GitHub、数据库等）
- 扩展市场一键安装
- 基于 stdio 的 JSON-RPC 2.0 通信，自动重连
- 项目级 + 全局双层配置

### 技能 & 命令系统

- **技能** — Markdown 驱动的可复用知识模块，可自动注入 AI 上下文
- **斜杠命令** — 自定义 `/xxx` 快捷命令，一键触发预设 Prompt
- **钩子** — 工具调用前后的 Shell 拦截点，用于审计、日志、安全检查

### 多模型调度

- 统一接入国内外 9+ 家模型提供商
- OpenAI 兼容格式 + Anthropic 原生适配
- 动态模型选择器 — 只显示已配置 Key 的模型
- SSE 流式输出，实时观察 token 生成

### 开发辅助面板

- 文件浏览器（树状目录 + 语法高亮）
- Git 变更视图（Staged / Unstaged 统计）
- 任务看板（Kanban 风格进度追踪）
- 记忆管理（项目 / 用户 / 团队三级上下文）
- 工具浏览器（12 个内置工具 + MCP 扩展工具的可视化试用）

### 安全特性

- API Key 仅在后端处理，前端不接触
- 可选的访问密钥保护（`DOLANCLAW_API_SECRET`）
- 每 IP 请求频率限制（60 次/分钟）
- 文件访问路径安全校验
- 工具调用钩子拦截

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Bun](https://bun.sh/) >= 1.0
- 至少一个大模型的 API Key

### 安装

```bash
# 1. 克隆仓库
git clone https://github.com/dolan9644/DolanClaw.git
cd DolanClaw

# 2. 安装后端依赖
bun install

# 3. 安装前端依赖
cd web && npm install && cd ..
```

### 配置 API Key

在项目根目录创建 `.env` 文件，按需添加你拥有的 Key：

```bash
# ── 国内模型 ──
MINIMAX_API_KEY=your_key_here     # MiniMax (推荐国内首选)
DEEPSEEK_API_KEY=your_key_here    # DeepSeek
MOONSHOT_API_KEY=your_key_here    # Kimi
DASHSCOPE_API_KEY=your_key_here   # 通义千问
ZHIPU_API_KEY=your_key_here       # GLM

# ── 国际模型 ──
ANTHROPIC_API_KEY=your_key_here   # Claude
GEMINI_API_KEY=your_key_here      # Gemini
OPENAI_API_KEY=your_key_here      # GPT-4o

# ── 安全（可选）──
# DOLANCLAW_API_SECRET=your_secret  # 设置后所有写操作需要认证
```

只需配置你持有的 Key，侧边栏会自动只显示可用的模型。

### 启动

```bash
# 后端
bun run src/entrypoints/web.ts --port 3000

# 前端（另一个终端）
cd web && npm run dev
```

打开浏览器访问 `http://localhost:5173`。

---

## MCP 工具生态

### 什么是 MCP

[Model Context Protocol](https://modelcontextprotocol.io/) 是一个开放标准，让 AI 模型能够安全地访问外部工具和数据源。DolanClaw 完整实现了 MCP 客户端，你可以轻松接入社区中大量的 MCP 服务器。

### 项目配置

在项目根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"]
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

### 通过扩展市场安装

打开侧边栏「扩展市场」，浏览分类目录，点击「安装」即可。需要 API Key 的服务器会弹出配置弹窗。

### 预置服务器

| 服务器 | 类别 | 说明 |
|--------|------|------|
| filesystem | 核心工具 | 安全的文件系统读写操作 |
| memory | 核心工具 | 基于知识图谱的持久化记忆 |
| fetch | 核心工具 | HTTP 请求工具 |
| sequential-thinking | 推理增强 | 结构化思维链，复杂问题分步推理 |
| brave-search | 搜索 | Brave 搜索引擎集成 |
| github | 开发工具 | GitHub 仓库 / Issue / PR 操作 |
| puppeteer | 浏览器 | 浏览器自动化（截图、爬虫） |
| sqlite | 数据库 | SQLite 数据库查询和管理 |
| postgres | 数据库 | PostgreSQL 只读查询 |
| slack | 协作 | Slack 消息发送和频道管理 |
| firecrawl | 搜索 | 高级网页爬虫，结构化数据提取 |
| everything | 测试 | MCP 参考服务器，用于开发测试 |

---

## 技能 & 命令

### 创建技能

在 `.claude/skills/` 目录下创建 Markdown 文件：

```markdown
---
name: code-review
description: 代码审查最佳实践
trigger: auto
---

# 代码审查技能

审查代码时请关注以下方面：
- 安全性漏洞
- 性能瓶颈
- 可维护性
```

`trigger: auto` 的技能会自动注入到 AI 的上下文中。

### 创建命令

在 `.claude/commands/` 目录下创建 Markdown 文件：

```markdown
---
description: 代码审查命令
---

请审查以下变更，重点关注安全性和性能：
$ARGUMENTS
```

使用时在聊天框输入 `/review` 即可触发。

### 配置钩子

在 `.claude/hooks.json` 配置工具调用拦截：

```json
{
  "hooks": [
    {
      "type": "PreToolUse",
      "toolName": "Bash",
      "command": "echo \"即将执行命令: $HOOK_TOOL_INPUT\""
    }
  ]
}
```

---

## 支持的模型

| 模型 | 提供商 | Key 环境变量 |
|------|--------|-------------|
| MiniMax M2.7 / M2.7 极速 | MiniMax | `MINIMAX_API_KEY` |
| MiniMax M2.5 / Text-01 | MiniMax | `MINIMAX_API_KEY` |
| DeepSeek V3 / R1 | 深度求索 | `DEEPSEEK_API_KEY` |
| Kimi K2.5 / 128K | 月之暗面 | `MOONSHOT_API_KEY` |
| 通义千问 Qwen3 Max | 阿里云 | `DASHSCOPE_API_KEY` |
| GLM-5 / GLM-4 Plus | 智谱 AI | `ZHIPU_API_KEY` |
| Claude Sonnet 4 / 3.5 / Haiku | Anthropic | `ANTHROPIC_API_KEY` |
| Gemini 2.5 Pro / Flash | Google | `GEMINI_API_KEY` |
| GPT-4o / GPT-4.1 / o3 | OpenAI | `OPENAI_API_KEY` |

所有模型通过统一的调度层调用（OpenAI 兼容格式 + Anthropic 原生适配）。

---

## 技术架构

```
浏览器 (React + Vite)
    │
    ├── 对话界面 ──SSE──> 后端 (Bun) ──HTTPS──> 各模型 API
    │                      │
    ├── 开发面板            ├── Agentic Loop（多轮工具调用引擎）
    │                      ├── McpManager（MCP 服务器管理）
    └── 扩展市场            ├── Skills / Commands / Hooks
                           └── 文件系统 / Git / 任务管理
```

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 样式 | Vanilla CSS 设计系统 |
| 字体 | Outfit + JetBrains Mono |
| 图标 | SVG 描边图标系统 |
| 后端 | Bun |
| API 协议 | OpenAI 兼容 + Anthropic 原生 |
| 流式传输 | Server-Sent Events (SSE) |
| MCP | JSON-RPC 2.0 over stdio |

---

## 免责声明

1. 本项目**仅供学习和技术交流**，使用者需自行承担使用风险。
2. 使用各模型 API 产生的费用由使用者自行承担。
3. 本项目作者不对因使用本项目而产生的任何直接或间接损失负责。
4. 使用者应遵守各模型提供商的使用条款和当地法律法规。

> **商标声明**：本项目中提及的 MiniMax、DeepSeek、Kimi、通义千问、GLM、Claude、Gemini、GPT
> 等均为各自公司的注册商标。本项目仅通过标准 API 接口进行调用，不包含任何上述公司的
> Logo 或品牌素材。

> **数据安全**：本工具不存储任何用户数据。所有对话记录仅存在于浏览器本地，API
> 请求直接转发至用户自行配置的模型服务商，本项目不做任何中间存储或日志记录。

---

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。

**再次强调：本项目仅供学习交流，禁止商用。**

---

## 致谢

- [Claude Code Best](https://github.com/claude-code-best/claude-code) — 项目灵感来源，感谢开源社区的贡献
- [Model Context Protocol](https://modelcontextprotocol.io/) — MCP 开放协议
- [Outfit](https://fonts.google.com/specimen/Outfit) — UI 字体
- [JetBrains Mono](https://www.jetbrains.com/mono/) — 等宽代码字体

---

<p align="center">
  仅供学习交流 · 请勿商用
</p>
