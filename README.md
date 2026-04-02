# DolanClaw — 大模型 API 学习调试工具

<p align="center">
  <strong>一个面向开发者学习与交流的多模型调试工具</strong><br>
  <sub>⚠️ 本项目仅供学习研究用途，请勿用于商业用途</sub>
</p>

<p align="center">
  <a href="#项目说明">项目说明</a> •
  <a href="#功能概览">功能概览</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#支持的模型">支持的模型</a> •
  <a href="#许可证">许可证</a>
</p>

---

## 项目说明

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

## 这个项目能做什么？

DolanClaw 是一个**本地运行**的多模型调试工具，帮助开发者：

- 🔍 **对比不同大模型的表现** — 同一个 prompt 在 MiniMax / DeepSeek / Claude / Gemini 上的效果差异
- 🛠️ **学习 LLM API 的调用方式** — 支持 OpenAI 兼容格式 + Anthropic 原生格式
- 📖 **理解流式输出原理** — SSE 实时流式输出，可观察 token 逐字生成过程
- 💡 **研究工具调用机制** — 可视化 Tool Calls 的请求和响应

---

## 功能概览

### 多模型调度

- 国内：MiniMax、DeepSeek、Kimi、通义千问、GLM
- 国际：Claude、Gemini、GPT-4o
- 动态模型选择器 — 只显示已配置 API Key 的模型

### 开发辅助

- 文件浏览器（树状目录 + 语法高亮）
- Git 变更视图（Staged / Unstaged）
- 任务看板（Kanban 风格）
- 记忆管理（项目/用户/团队三级）

### 安全特性

- API Key 仅在后端处理，前端不接触
- 可选的访问密钥保护（`DOLANCLAW_API_SECRET`）
- 每 IP 请求频率限制（60 次/分钟）
- 文件访问路径安全校验

### 交互

- 斜杠命令（`/clear` `/compact` `/cost` 等）
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
                  ↑                        ↑
             不接触 Key               Key 仅在此处
```

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 样式 | Vanilla CSS 设计系统 |
| 字体 | Outfit + JetBrains Mono |
| 后端 | Bun |
| API 协议 | OpenAI 兼容 + Anthropic 原生 |
| 流式传输 | Server-Sent Events (SSE) |

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
- [Outfit](https://fonts.google.com/specimen/Outfit) — UI 字体
- [JetBrains Mono](https://www.jetbrains.com/mono/) — 等宽代码字体

---

<p align="center">
  仅供学习交流 · 请勿商用
</p>
