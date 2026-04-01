# DolanClaw — 国产大模型统一调度平台

<p align="center">
  <strong>为国产大模型精心打造的本地 Web 开发助手</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#支持的模型">支持的模型</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#许可证">许可证</a>
</p>

---

> **声明**：本项目与 Anthropic 公司无任何关联，不包含任何 Anthropic 原始代码。
> 本项目基于 [Claude Code Best](https://github.com/anthropics/claude-code) 的开源架构，
> 独立开发了面向国产大模型的 Web UI 界面和调度层。

---

## 功能特性

### 核心

- **多模型统一调度** — 支持 MiniMax、Gemini、GPT-4o、DeepSeek、Kimi、通义千问、GLM 等 10+ 国内外模型
- **流式对话** — SSE 实时流式输出，支持思考过程面板、工具调用可视化
- **MCP 服务器集成** — 连接外部工具服务器，扩展 AI 能力边界

### 开发工具

- **文件浏览器** — 树状目录 + 代码预览 + 语法高亮
- **变更视图** — Git diff 可视化，支持 Staged/Unstaged 分组
- **任务看板** — Kanban 风格任务管理（创建/编辑/拖拽/删除）
- **工具浏览器** — 查看所有可用工具，支持在线试用
- **记忆管理** — 项目/用户/团队三级记忆文件编辑

### 交互增强

- **斜杠命令** — `/clear` `/compact` `/cost` `/help` `/plan` 等 20+ 命令
- **@ 文件引用** — 输入 `@` 快速引用项目文件
- **消息编辑** — 可编辑已发送的用户消息并重新发送
- **Command Palette** — `⌘K` 快速导航至任意页面
- **键盘快捷键** — `?` 查看完整快捷键列表
- **浅色/深色主题** — 一键切换，支持跟随系统

### 设计细节

- **Outfit + JetBrains Mono 字体**
- **SVG 图标系统** — 干净的单色线条图标
- **Liquid Glass 毛玻璃效果**
- **微动画 + 触觉反馈**
- **响应式布局** — 移动端侧边栏自适应

---

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Bun](https://bun.sh/) >= 1.0（后端运行时）
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

### 配置模型 API Key

在项目根目录创建 `.env` 文件：

```bash
# MiniMax (推荐)
MINIMAX_API_KEY=your_key_here

# 或其他模型
OPENAI_API_KEY=your_key_here
DEEPSEEK_API_KEY=your_key_here
```

### 启动

```bash
# 方式一：分别启动前后端（开发模式）
bun run src/entrypoints/web.ts --port 3000   # 后端 API
cd web && npm run dev                          # 前端 (端口 5173)

# 方式二：生产构建
cd web && npm run build                        # 构建前端
bun run src/entrypoints/web.ts --port 3000     # 后端会自动 serve 构建产物
```

打开浏览器访问 `http://localhost:5173`（开发模式）或 `http://localhost:3000`（生产模式）

---

## 支持的模型

| 模型 | 提供商 | 状态 |
|------|--------|------|
| MiniMax M2.7 HS | MiniMax | ✅ 推荐 |
| Gemini 2.5 Pro / Flash | Google | ✅ |
| GPT-4o / GPT-4.1 | OpenAI | ✅ |
| o3 | OpenAI | ✅ |
| DeepSeek V3 / R1 | 深度求索 | ✅ |
| Kimi 32K | 月之暗面 | ✅ |
| 通义千问 Max | 阿里云 | ✅ |
| GLM-4 Plus | 智谱 AI | ✅ |

所有模型通过 OpenAI 兼容接口统一调度。

---

## 项目结构

```
DolanClaw/
├── src/                    # 后端源码 (TypeScript + Bun)
│   ├── entrypoints/
│   │   └── web.ts          # Web 服务器入口
│   ├── services/api/       # OpenAI 兼容层
│   └── utils/model/        # 模型注册 & 配置
├── web/                    # 前端源码 (React + Vite)
│   ├── src/
│   │   ├── components/     # 通用组件 (Sidebar, Icons, CommandPalette)
│   │   ├── pages/          # 13 个页面
│   │   ├── App.tsx         # 路由 & 全局状态
│   │   └── index.css       # 设计系统 (3700+ 行)
│   └── index.html
├── .env                    # API Key 配置 (需自建)
└── README.md
```

---

## 开发指南

### 前端开发

```bash
cd web
npm run dev          # 启动开发服务器 (HMR)
npx tsc --noEmit     # TypeScript 类型检查
npm run build        # 生产构建
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite |
| 样式 | Vanilla CSS (3700+ 行设计系统) |
| 字体 | Outfit + JetBrains Mono |
| 图标 | 自定义 SVG 组件 |
| 后端运行时 | Bun |
| API 协议 | OpenAI Chat Completion (兼容) |
| 流式传输 | Server-Sent Events (SSE) |

### 代码规范

- TypeScript 严格模式
- 无 emoji — 全部使用 SVG 图标组件
- CSS 变量设计系统 — 统一色彩/间距/动画
- 组件化架构 — 页面 + 组件分离

---

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。

---

## 致谢

- [Claude Code](https://github.com/anthropics/claude-code) — 原始架构参考
- [Outfit](https://fonts.google.com/specimen/Outfit) — UI 字体
- [JetBrains Mono](https://www.jetbrains.com/mono/) — 等宽代码字体

---

<p align="center">
  用 ❤️ 为国产大模型社区打造
</p>
