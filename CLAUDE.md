# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **reverse-engineered / decompiled** version of Anthropic's official Claude Code CLI tool. The goal is to restore core functionality while trimming secondary capabilities. Many modules are stubbed or feature-flagged off. The codebase has ~1341 tsc errors from decompilation (mostly `unknown`/`never`/`{}` types) — these do **not** block Bun runtime execution.

## Commands

```bash
# Install dependencies
bun install

# Dev mode (direct execution via Bun)
bun run dev
# equivalent to: bun run src/entrypoints/cli.tsx

# Pipe mode
echo "say hello" | bun run src/entrypoints/cli.tsx -p

# Build (outputs dist/cli.js, ~25MB)
bun run build
```

No test runner is configured. No linter is configured.

## Architecture

### Runtime & Build

- **Runtime**: Bun (not Node.js). All imports, builds, and execution use Bun APIs.
- **Build**: `bun build src/entrypoints/cli.tsx --outdir dist --target bun` — single-file bundle.
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: Bun workspaces — internal packages live in `packages/` resolved via `workspace:*`.

### Entry & Bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint. Injects runtime polyfills at the top:
   - `feature()` always returns `false` (all feature flags disabled, skipping unimplemented branches).
   - `globalThis.MACRO` — simulates build-time macro injection (VERSION, BUILD_TIME, etc.).
   - `BUILD_TARGET`, `BUILD_ENV`, `INTERFACE_TYPE` globals.
2. **`src/main.tsx`** — Commander.js CLI definition. Parses args, initializes services (auth, analytics, policy), then launches the REPL or runs in pipe mode.
3. **`src/entrypoints/init.ts`** — One-time initialization (telemetry, config, trust dialog).

### Core Loop

- **`src/query.ts`** — The main API query function. Sends messages to Claude API, handles streaming responses, processes tool calls, and manages the conversation turn loop.
- **`src/QueryEngine.ts`** — Higher-level orchestrator wrapping `query()`. Manages conversation state, compaction, file history snapshots, attribution, and turn-level bookkeeping. Used by the REPL screen.
- **`src/screens/REPL.tsx`** — The interactive REPL screen (React/Ink component). Handles user input, message display, tool permission prompts, and keyboard shortcuts.

### API Layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, and processes `BetaRawMessageStreamEvent` events.
- Supports multiple providers: Anthropic direct, AWS Bedrock, Google Vertex, Azure.
- Provider selection in `src/utils/model/providers.ts`.

### Tool System

- **`src/Tool.ts`** — Tool interface definition (`Tool` type) and utilities (`findToolByName`, `toolMatchesName`).
- **`src/tools.ts`** — Tool registry. Assembles the tool list; some tools are conditionally loaded via `feature()` flags or `process.env.USER_TYPE`.
- **`src/tools/<ToolName>/`** — Each tool in its own directory (e.g., `BashTool`, `FileEditTool`, `GrepTool`, `AgentTool`).
- Tools define: `name`, `description`, `inputSchema` (JSON Schema), `call()` (execution), and optionally a React component for rendering results.

### UI Layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`src/ink/`** — Custom Ink framework (forked/internal): custom reconciler, hooks (`useInput`, `useTerminalSize`, `useSearchHighlight`), virtual list rendering.
- **`src/components/`** — React components rendered in terminal via Ink. Key ones:
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics).
  - `Messages.tsx` / `MessageRow.tsx` — Conversation message rendering.
  - `PromptInput/` — User input handling.
  - `permissions/` — Tool permission approval UI.
- Components use React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls throughout.

### State Management

- **`src/state/AppState.tsx`** — Central app state type and context provider. Contains messages, tools, permissions, MCP connections, etc.
- **`src/state/store.ts`** — Zustand-style store for AppState.
- **`src/bootstrap/state.ts`** — Module-level singletons for session-global state (session ID, CWD, project root, token counts).

### Context & System Prompt

- **`src/context.ts`** — Builds system/user context for the API call (git status, date, CLAUDE.md contents, memory files).
- **`src/utils/claudemd.ts`** — Discovers and loads CLAUDE.md files from project hierarchy.

### Feature Flag System

All `feature('FLAG_NAME')` calls come from `bun:bundle` (a build-time API). In this decompiled version, `feature()` is polyfilled to always return `false` in `cli.tsx`. This means all Anthropic-internal features (COORDINATOR_MODE, KAIROS, PROACTIVE, etc.) are disabled.

### Stubbed/Deleted Modules

| Module | Status |
|--------|--------|
| Computer Use (`@ant/*`) | Stub packages in `packages/@ant/` |
| `*-napi` packages (audio, image, url, modifiers) | Stubs in `packages/` (except `color-diff-napi` which is fully implemented) |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / Voice Mode / LSP Server | Removed |
| Plugins / Marketplace | Removed |
| MCP OAuth | Simplified |

### Key Type Files

- **`src/types/global.d.ts`** — Declares `MACRO`, `BUILD_TARGET`, `BUILD_ENV` and internal Anthropic-only identifiers.
- **`src/types/internal-modules.d.ts`** — Type declarations for `bun:bundle`, `bun:ffi`, `@anthropic-ai/mcpb`.
- **`src/types/message.ts`** — Message type hierarchy (UserMessage, AssistantMessage, SystemMessage, etc.).
- **`src/types/permissions.ts`** — Permission mode and result types.

## Working with This Codebase

- **Don't try to fix all tsc errors** — they're from decompilation and don't affect runtime.
- **`feature()` is always `false`** — any code behind a feature flag is dead code in this build.
- **React Compiler output** — Components have decompiled memoization boilerplate (`const $ = _c(N)`). This is normal.
- **`bun:bundle` import** — In `src/main.tsx` and other files, `import { feature } from 'bun:bundle'` works at build time. At dev-time, the polyfill in `cli.tsx` provides it.
- **`src/` path alias** — tsconfig maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.

## Extension System (DolanClaw)

DolanClaw supports a modular extension system via the `.claude/` directory. This section tells you where to install what and what is safe.

### Directory Structure

```
.claude/
├── skills/        # Skill definitions (auto-detected by /api/skills)
│   ├── my-skill.md           # Flat .md format
│   └── search-first/         # ECC-style subdirectory format
│       └── SKILL.md           # Must contain SKILL.md to be detected
├── agents/        # Agent definitions (auto-detected by /api/skills)
│   └── planner.md
├── commands/      # Slash commands (auto-detected by /api/skills)
│   └── plan.md
├── rules/         # Coding rules and conventions
│   └── common.md
└── hooks.json     # Hook configuration (⚠️ DANGEROUS — executes bash)
```

### Safety Levels for Installation

| Component | Location | Safety | Notes |
|-----------|----------|--------|-------|
| Skills (.md / SKILL.md) | `.claude/skills/` | ✅ SAFE | Pure markdown, affects prompts only |
| Agents (.md) | `.claude/agents/` | ✅ SAFE | Pure markdown, affects prompts only |
| Commands (.md) | `.claude/commands/` | ✅ SAFE | Pure markdown, slash command definitions |
| Rules (.md) | `.claude/rules/` | ✅ SAFE | Pure markdown, coding conventions |
| MCP servers | `.mcp.json` | ⚠️ MEDIUM | May fail to connect but won't crash |
| Hooks | `.claude/hooks.json` | 🔴 DANGEROUS | Executes arbitrary bash commands, has 5s timeout |
| Core code | `src/entrypoints/web.ts` | 🔴 NEVER MODIFY | Will crash the application |

### Installation Guidelines for Bots

When a user asks you to install an extension:

1. **Skills, agents, commands, rules** — Copy the .md file to the appropriate `.claude/` subdirectory. This is always safe.
2. **MCP servers** — Add to `.mcp.json` via `/api/registry/install-mcp` endpoint. Always verify the npx package name exists.
3. **Hooks** — NEVER install hooks without explicit user approval. Show the bash command to the user first.
4. **Never modify `src/entrypoints/web.ts`** — This is the reverse-engineered core. Modifying it will break the system.
5. **Everything Claude Code (ECC)** components are available via the Skill Pack Marketplace (扩展市场 → 技能包 tab). They can also be installed manually from `everything-claude-code/` repository clone.

### API Endpoints for Extensions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/skills` | GET | List all installed skills (scans `.claude/skills/`, `agents/`, `commands/`) |
| `/api/agents` | GET | List agent configurations |
| `/api/registry` | GET | List MCP servers and marketplace items |
| `/api/skill-packs` | GET | List ECC skill packs and individual items |
| `/api/skill-packs/install` | POST | Install a skill pack or individual item |
| `/api/skill-packs/uninstall` | POST | Uninstall a skill pack or individual item |
| `/api/hooks` | GET | List configured hooks |
| `/api/health` | GET | Server health check |

### Web UI (Frontend)

- **`web/src/pages/RegistryPage.tsx`** — Extension marketplace (3 tabs: Skill Packs / MCP / Skills)
- **`web/src/pages/SkillsAgentsPage.tsx`** — Skill center and agent management
- **`web/src/pages/ToolsPage.tsx`** — Tool browser
- **Frontend dev server**: `cd web && npm run dev` (Vite on port 5173, proxies `/api` to backend on 3000)
- **Backend**: `bun run src/entrypoints/web.ts` (port 3000)

