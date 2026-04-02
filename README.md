# DolanClaw — Agentic 开发平台

<p align="center">
  <strong>一个面向开发者学习与交流的 Agentic AI 开发平台</strong><br>
  <sub>多模型调度 · MCP 工具扩展 · 技能系统 · 社区注册中心</sub><br>
  <sub>⚠️ 本项目仅供学习研究用途，请勿用于商业用途</sub>
</p>

<p align="center">
  <a href="#项目说明">项目说明</a> •
  <a href="#功能概览">功能概览</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#mcp-扩展体系">MCP 扩展</a> •
  <a href="#支持的模型">支持的模型</a> •
  <a href="#许可证">许可证</a>
</p>

---

## 项目说明

> **⚠️ 重要声明**
>
> 1. 本项目**仅供学习、研究和技术交流**，不得用于任何商业用途。
> 2. 本项目基于 [Claude Code Best](https://github.com/claude-code-best/claude-code) 的开源架构进行学习性二次开发，**核心代码来自上游项目**，本项目主要贡献在于 Web UI 界面、Agentic Loop 架构和国产大模型适配层。
> 3. 本项目与 Anthropic、OpenAI、MiniMax、DeepSeek 等模型提供商**无任何关联**，也未获得上述任何公司的授权或背书。

> **商标声明**：本项目中提及的 MiniMax、DeepSeek、Kimi、通义千问、GLM、Claude、Gemini、GPT
> 等均为各自公司的注册商标。本项目不包含任何上述公司的 Logo 或品牌素材，仅通过
> 标准 API 接口进行调用。

> **数据安全**：本工具不存储任何用户数据。所有对话记录仅存在于浏览器本地 (localStorage)，
> API 请求直接转发至用户自行配置的模型服务商，本项目不做任何中间存储或日志记录。
> 用户应自行评估将敏感代码/数据发送至第三方 API 的风险。

---

## 这个项目能做什么？

DolanClaw 是一个**本地运行**的 Agentic AI 开发平台，对标 Claude Code 的核心扩展能力：

- **Agentic Loop** — 多轮工具调用循环，Agent 可自主规划和执行复杂任务
- **MCP 扩展** — 完整的 Model Context Protocol 支持，12+ 预置服务器一键安装
- **技能系统** — Markdown 驱动的可复用技能模块，自动注入 System Prompt
- **斜杠命令** — 内置 + 自定义命令补全，快速触发复杂工作流
- **社区注册中心** — 扩展市场，一键安装 MCP 服务器和技能模板

---

## 功能概览

### Agentic Loop 引擎

- 多轮工具调用循环（最多 10 轮自主迭代）
- 内置工具 + MCP 工具混合调用
- PreToolUse / PostToolUse 钩子拦截
- Agent 子任务委派

### MCP 扩展体系

- 基于 stdio 的 JSON-RPC 2.0 协议
- 自动重连 + 优雅关闭
- `mcp__{server}__{tool}` 命名空间隔离
- 项目级 `.mcp.json` + 全局 `~/.claude/settings.json` 配置
- 12 个预置服务器：filesystem、memory、fetch、sequential-thinking、brave-search、github、puppeteer、sqlite、postgres、slack、everything、firecrawl

### 技能 & 命令

- 技能：`.claude/skills/*.md`，YAML Frontmatter 配置，`trigger: auto` 自动注入
- 命令：`.claude/commands/*.md`，斜杠命令 `/xxx` 自动展开为 Prompt 模板
- 钩子：`.claude/hooks.json`，通过 Shell 脚本拦截工具调用

### 多模型调度

- 国内：MiniMax、DeepSeek、Kimi、通义千问、GLM
- 国际：Claude、Gemini、GPT-4o
- 动态模型选择器 — 只显示已配置 API Key 的模型

### 开发辅助

- 文件浏览器（树状目录 + 语法高亮）
- Git 变更视图（Staged / Unstaged）
- 任务看板（Kanban 风格）
- 记忆管理（项目/用户/团队三级）
- 工具浏览器（试用面板 + 使用统计）

### 社区注册中心

- 扩展市场 — 12 个 MCP 服务器 + 5 个技能模板目录
- 一键安装 — 自动写入 `.mcp.json` 并连接
- API Key 引导 — 需要密钥的服务器弹出配置弹窗
- 分类筛选 — 核心工具/搜索/开发工具/数据库/浏览器/协作/推理增强

### 安全特性

- API Key 仅在后端处理，前端不接触
- 可选的访问密钥保护（`DOLANCLAW_API_SECRET`）
- 每 IP 请求频率限制（60 次/分钟）
- 文件访问路径安全校验

### 交互

- 斜杠命令（`/clear` `/compact` `/cost` + 自定义 `.claude/commands/*.md`）
- `@` 文件引用
- `⌘K` 命令面板
- 浅色/深色主题切换

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

## MCP 扩展体系

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

### 快速安装

通过扩展市场一键安装，或手动添加：

```bash
# API 安装
curl -X POST http://localhost:3000/api/registry/install-mcp \
  -H 'Content-Type: application/json' \
  -d '{"name": "brave-search", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"], "env": {"BRAVE_API_KEY": "your_key"}}'
```

### 工具命名

MCP 工具在 Agentic Loop 中以 `mcp__{server}__{tool}` 格式注册：

```
mcp__filesystem__read_file
mcp__memory__create_entities
mcp__brave-search__web_search
```

### 预置服务器

| 服务器 | 类别 | 说明 |
|--------|------|------|
| filesystem | 核心工具 | 安全的文件系统操作 |
| memory | 核心工具 | 知识图谱持久化记忆 |
| fetch | 核心工具 | HTTP 请求工具 |
| sequential-thinking | 推理增强 | 结构化思维链推理 |
| brave-search | 搜索 | Brave 搜索引擎 |
| github | 开发工具 | GitHub API 操作 |
| puppeteer | 浏览器 | 浏览器自动化 |
| sqlite | 数据库 | SQLite 数据库操作 |
| postgres | 数据库 | PostgreSQL 操作 |
| slack | 协作 | Slack 消息管理 |
| firecrawl | 搜索 | 高级网页爬虫 |
| everything | 开发测试 | MCP 测试参考服务器 |

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

`trigger: auto` 的技能会自动注入到 System Prompt。

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

在 `.claude/hooks.json` 配置工具拦截规则：

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
浏览器 (React)  ──HTTP──>  后端 (Bun)  ──HTTPS──>  各模型 API
      │                      │                        ↑
      │                      ├── McpManager ──stdio──> MCP 服务器
      │                      ├── Agentic Loop          ↑
      │                      ├── Hooks 拦截       Key 仅在此处
      │                      └── Skills/Commands
  不接触 Key
```

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 样式 | Vanilla CSS 设计系统 |
| 字体 | Outfit + JetBrains Mono |
| 图标 | SVG 描边图标系统（16x16, stroke-based） |
| 后端 | Bun |
| API 协议 | OpenAI 兼容 + Anthropic 原生 |
| 流式传输 | Server-Sent Events (SSE) |
| MCP 协议 | JSON-RPC 2.0 over stdio |
| 工具系统 | 内置 12 工具 + MCP 动态扩展 |

### 后端 API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 流式对话（SSE） |
| `/api/agents/:name/run` | POST | Agentic Loop 执行 |
| `/api/tools` | GET | 工具列表（内置 + MCP） |
| `/api/tools/execute` | POST | 单次工具执行 |
| `/api/mcp/status` | GET | MCP 服务器状态 |
| `/api/mcp/connect` | POST | 连接 MCP 服务器 |
| `/api/mcp/disconnect` | POST | 断开连接 |
| `/api/mcp/restart` | POST | 重启服务器 |
| `/api/mcp/add` | POST | 添加新服务器 |
| `/api/skills` | GET | 技能列表 |
| `/api/skills/toggle` | PUT | 启用/禁用技能 |
| `/api/commands` | GET | 斜杠命令列表 |
| `/api/hooks` | GET/PUT | 钩子配置 |
| `/api/registry` | GET | 扩展市场目录 |
| `/api/registry/install-mcp` | POST | 一键安装 MCP |
| `/api/registry/install-skill` | POST | 安装技能模板 |
| `/api/models` | GET | 可用模型列表 |

---

## 免责声明

1. 本项目**仅供学习和技术交流**，使用者需自行承担使用风险。
2. 使用各模型 API 产生的费用由使用者自行承担。
3. 本项目作者不对因使用本项目而产生的任何直接或间接损失负责。
4. 使用者应遵守各模型提供商的使用条款和当地法律法规。

---

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。

**再次强调：本项目仅供学习交流，禁止商用。**

---

## 致谢

- [Claude Code Best](https://github.com/claude-code-best/claude-code) — 核心架构来源
- [Model Context Protocol](https://modelcontextprotocol.io/) — MCP 协议规范
- [Outfit](https://fonts.google.com/specimen/Outfit) — UI 字体
- [JetBrains Mono](https://www.jetbrains.com/mono/) — 等宽代码字体

---

<p align="center">
  仅供学习交流 · 请勿商用
</p>
