/**
 * DolanClaw Web Server — Backend Bridge
 *
 * Starts a local HTTP server that:
 * 1. Serves the DolanClaw Web UI (Vite build output)
 * 2. Proxies /api/* requests to LLM providers (keys stay server-side)
 * 3. Streams chat responses via SSE
 *
 * Security:
 * - API Keys are server-side only, never exposed to frontend
 * - Optional auth via DOLANCLAW_API_SECRET env var
 * - Per-IP rate limiting (60 requests/min)
 *
 * Usage:
 *   bun run src/entrypoints/web.ts [--port 3000]
 */

import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, extname, basename, relative, resolve } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import {
  toOpenAIMessages,
  toOpenAITools,
  fromOpenAIResponse,
  fromOpenAIStream,
} from '../services/api/openaiCompat.js'
import {
  openaiChatCompletion,
  openaiChatCompletionStream,
  testOpenAIConnection,
} from '../services/api/openaiClient.js'
import {
  getOpenAIModelRegistry,
  getOpenAIModelConfig,
  reloadCustomModels,
  getModelApiKey,
  type OpenAIModelConfig,
} from '../utils/model/openaiModels.js'

import type { OpenAITool, OpenAIToolCall, OpenAIChatMessage } from '../services/api/openaiCompat.js'
import { McpManager } from '../services/mcp/McpManager.js'

// ─── MCP Manager (singleton) ────────────────────────────
const mcpManager = McpManager.getInstance()

// ─── Config ─────────────────────────────────────────────
const DEFAULT_PORT = 3000
const MAX_TOOL_TURNS = 25 // Prevent infinite tool loops

// Server instance reference (for graceful restart)
let serverInstance: ReturnType<typeof Bun.serve> | null = null

// ─── Workspace (mutable working directory) ──────────────
let workingDirectory = process.cwd()

export function getWorkingDirectory(): string {
  return workingDirectory
}

function setWorkingDirectory(newDir: string): { ok: boolean; error?: string } {
  const resolved = resolve(newDir)
  if (!existsSync(resolved)) {
    return { ok: false, error: `目录不存在: ${resolved}` }
  }
  try {
    const stat = statSync(resolved)
    if (!stat.isDirectory()) {
      return { ok: false, error: `不是目录: ${resolved}` }
    }
  } catch (e) {
    return { ok: false, error: `无法访问: ${resolved}` }
  }
  workingDirectory = resolved
  return { ok: true }
}

// ─── Tool Definitions (OpenAI function calling format) ──

const TOOL_DEFINITIONS: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: '在终端执行 shell 命令。可用于运行脚本、安装依赖、查看文件、搜索代码等。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 bash 命令' },
          timeout: { type: 'number', description: '超时时间（毫秒），默认 30000' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'FileRead',
      description: '读取文件内容。传入文件的绝对路径或相对于项目根目录的路径。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要读取的文件路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'FileEdit',
      description: '编辑文件。用 new_string 替换 old_string 的首次出现。old_string 应包含足够的上下文以唯一标识替换位置。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要编辑的文件路径' },
          old_string: { type: 'string', description: '要被替换的原始文本（必须精确匹配）' },
          new_string: { type: 'string', description: '替换后的新文本' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'FileWrite',
      description: '创建或覆盖一个文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: '在文件中搜索正则表达式模式。返回匹配的行。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式搜索模式' },
          path: { type: 'string', description: '要搜索的目录或文件路径，默认为项目根目录' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: '使用 glob 模式查找文件。例如 "*.tsx" 或 "src/**/*.ts"。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob 模式' },
          path: { type: 'string', description: '搜索的根目录，默认为项目根目录' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ListFiles',
      description: '列出目录中的文件和子目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要列出的目录路径，默认为当前目录' },
        },
        required: [],
      },
    },
  },
]

// ─── Tool Permission Classification ─────────────────────
// read-only tools auto-execute; write tools require user permission
const AUTO_ALLOW_TOOLS = new Set([
  'FileRead', 'Grep', 'Glob', 'ListFiles', 'WebSearch', 'TodoWrite',
])
const WRITE_TOOLS = new Set([
  'Bash', 'FileEdit', 'FileWrite', 'WebFetch',
])

// Session-level "always allow" memory (reset on server restart)
const sessionAllowedTools = new Set<string>()

// ─── Permission Request Queue ───────────────────────────
// Used for async coordination between SSE stream and permission endpoint
const pendingPermissions = new Map<string, {
  resolve: (decision: 'allow' | 'deny' | 'allow_all') => void
  toolName: string
  toolInput: string
}>()

// ─── Auth ───────────────────────────────────────────────
// Optional: set DOLANCLAW_API_SECRET in .env to protect API endpoints.
// If not set, auth is disabled (local dev mode — default).
const API_SECRET = process.env.DOLANCLAW_API_SECRET || ''

// Routes that require auth (write/invoke operations)
const AUTH_PROTECTED_ROUTES = [
  '/api/chat',
  '/api/tools/execute',
  '/api/files/write',
  '/api/memories',
  '/api/tasks',
  '/api/bash',
  '/api/chat/permission',
]

function checkAuth(req: Request, path: string, corsHeaders: Record<string, string>): Response | null {
  if (!API_SECRET) return null // Auth disabled in local mode
  // Only protect write/invoke endpoints
  if (!AUTH_PROTECTED_ROUTES.some(r => path.startsWith(r))) return null
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  if (token !== API_SECRET) {
    return Response.json(
      { error: '未授权：请在设置中配置正确的访问密钥' },
      { status: 401, headers: corsHeaders },
    )
  }
  return null
}

// ─── Rate Limiter (sliding window) ──────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(req: Request, corsHeaders: Record<string, string>): Response | null {
  const ip = req.headers.get('x-forwarded-for')
    || req.headers.get('x-real-ip')
    || 'local'
  const now = Date.now()
  const timestamps = rateLimitMap.get(ip) || []
  const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS)
  if (valid.length >= RATE_LIMIT_MAX) {
    return Response.json(
      { error: `请求频率超限：每分钟最多 ${RATE_LIMIT_MAX} 次请求` },
      { status: 429, headers: corsHeaders },
    )
  }
  valid.push(now)
  rateLimitMap.set(ip, valid)
  return null
}

// Clean up every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, timestamps] of rateLimitMap) {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS)
    if (valid.length === 0) rateLimitMap.delete(ip)
    else rateLimitMap.set(ip, valid)
  }
}, 300_000)

// ─── Path Safety ────────────────────────────────────────
function isPathSafe(filePath: string): boolean {
  const normalizedResolved = resolve(filePath)
  return normalizedResolved.startsWith(workingDirectory)
}


// ─── MIME Types ─────────────────────────────────────────
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// ─── Stats Tracking ─────────────────────────────────────
const sessionStats = {
  totalCostUSD: 0,
  totalCostCNY: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  requestCount: 0,
  totalLatencyMs: 0,
  modelCounts: {} as Record<string, number>,
  recentRequests: [] as Array<{
    time: string
    model: string
    inputTokens: number
    outputTokens: number
    cost: number
    latency: number
  }>,
}

function recordRequest(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  latencyMs: number,
) {
  sessionStats.totalInputTokens += inputTokens
  sessionStats.totalOutputTokens += outputTokens
  sessionStats.requestCount += 1
  sessionStats.totalLatencyMs += latencyMs
  if (cost > 0) {
    sessionStats.totalCostCNY += cost
  }
  sessionStats.modelCounts[model] = (sessionStats.modelCounts[model] || 0) + 1

  sessionStats.recentRequests.unshift({
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    model,
    inputTokens,
    outputTokens,
    cost,
    latency: latencyMs,
  })
  // Keep last 50 entries
  if (sessionStats.recentRequests.length > 50) {
    sessionStats.recentRequests.length = 50
  }
}

// ─── Agent State Tracking ───────────────────────────────

interface AgentRunRecord {
  id: string
  time: string
  task: string
  status: 'completed' | 'error'
  durationMs: number
  outputPreview: string
}

interface AgentState {
  name: string
  type: 'built-in' | 'custom'
  description: string
  status: 'idle' | 'running' | 'completed' | 'error'
  lastRun: string | null
  history: AgentRunRecord[]
  config: {
    model: string
    tools: string[]
    systemPrompt: string
  }
}

const DEFAULT_AGENTS: Record<string, AgentState> = {
  CodeAgent: {
    name: 'CodeAgent', type: 'built-in', description: '通用代码编写代理',
    status: 'idle', lastRun: null, history: [],
    config: { model: 'minimax-m2.7', tools: ['BashTool', 'FileEditTool', 'FileReadTool', 'GrepTool', 'GlobTool'], systemPrompt: '你是一个专业的代码编写助手。请根据用户需求编写高质量的代码，遵循最佳实践。' },
  },
  TestAgent: {
    name: 'TestAgent', type: 'built-in', description: '测试编写和运行代理',
    status: 'idle', lastRun: null, history: [],
    config: { model: 'minimax-m2.7', tools: ['BashTool', 'FileReadTool', 'FileEditTool'], systemPrompt: '你是一个测试专家。请编写全面的单元测试和集成测试，确保代码覆盖率和质量。' },
  },
  ReviewAgent: {
    name: 'ReviewAgent', type: 'built-in', description: '代码审查代理',
    status: 'idle', lastRun: null, history: [],
    config: { model: 'minimax-m2.7', tools: ['FileReadTool', 'GrepTool', 'GlobTool'], systemPrompt: '你是一个代码审查专家。请仔细审查代码，指出潜在问题、安全漏洞和改进建议。' },
  },
  DocAgent: {
    name: 'DocAgent', type: 'custom', description: '文档生成代理',
    status: 'idle', lastRun: null, history: [],
    config: { model: 'minimax-m2.7', tools: ['FileReadTool', 'FileEditTool', 'GlobTool'], systemPrompt: '你是一个文档专家。请为代码生成清晰、完整的文档，包括 JSDoc 注释、README 和 API 文档。' },
  },
}

// Load persisted agent configs from localStorage-like file
const agentStatesPath = join(process.env.HOME || '~', '.claude', 'dolanclaw-agents.json')
function loadAgentStates(): Record<string, AgentState> {
  try {
    if (existsSync(agentStatesPath)) {
      const raw = JSON.parse(readFileSync(agentStatesPath, 'utf-8'))
      // Merge saved configs into defaults
      const result = { ...DEFAULT_AGENTS }
      for (const [name, saved] of Object.entries(raw)) {
        if (result[name]) {
          const s = saved as Partial<AgentState>
          if (s.config) result[name].config = { ...result[name].config, ...s.config }
          if (s.history) result[name].history = (s.history as AgentRunRecord[]).slice(0, 20)
          if (s.lastRun) result[name].lastRun = s.lastRun as string
        } else {
          // Custom agent added by user
          result[name] = saved as AgentState
        }
      }
      return result
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_AGENTS }
}

function saveAgentStates(states: Record<string, AgentState>) {
  try {
    const dir = join(process.env.HOME || '~', '.claude')
    if (!existsSync(dir)) { Bun.spawnSync(['mkdir', '-p', dir]) }
    writeFileSync(agentStatesPath, JSON.stringify(states, null, 2), 'utf-8')
  } catch { /* ignore */ }
}

const agentStates = loadAgentStates()

// ─── API Routes ─────────────────────────────────────────

async function handleApiRequest(
  req: Request,
  url: URL,
): Promise<Response> {
  const path = url.pathname
  const method = req.method

  // CORS headers for dev mode
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    // Auth check
    const authError = checkAuth(req, path, corsHeaders)
    if (authError) return authError

    // Rate limit check
    const rateLimitError = checkRateLimit(req, corsHeaders)
    if (rateLimitError) return rateLimitError

    // POST /api/restart — Graceful server restart
    if (path === '/api/restart' && method === 'POST') {
      console.log('\n  🔄 收到重启请求，正在重启服务器...')
      const response = Response.json({ ok: true, message: '服务器正在重启...' }, { headers: corsHeaders })

      // Schedule restart after response is sent
      setTimeout(() => {
        // 1. Stop current server to free the port
        if (serverInstance) {
          serverInstance.stop()
        }

        // 2. Spawn a new process with the same arguments
        const args = ['bun', 'run', import.meta.path, ...process.argv.slice(2)]
        const child = Bun.spawn(args, {
          stdout: 'inherit',
          stderr: 'inherit',
          stdin: 'ignore',
        })
        child.unref()

        // 3. Exit current process
        console.log('  ✅ 新进程已启动，旧进程退出\n')
        process.exit(0)
      }, 500)

      return response
    }

    // POST /api/chat — Streaming chat with agentic tool loop
    if (path === '/api/chat' && method === 'POST') {
      return handleChat(req, corsHeaders)
    }

    // POST /api/chat/permission — Frontend responds to permission requests
    if (path === '/api/chat/permission' && method === 'POST') {
      const body = await req.json() as { id: string; decision: 'allow' | 'deny' | 'allow_all' }
      const pending = pendingPermissions.get(body.id)
      if (pending) {
        pending.resolve(body.decision)
        return Response.json({ ok: true }, { headers: corsHeaders })
      }
      return Response.json({ error: 'Permission request not found or expired' }, { status: 404, headers: corsHeaders })
    }

    // GET /api/models — List models
    if (path === '/api/models' && method === 'GET') {
      const registry = getOpenAIModelRegistry()
      const models = Object.entries(registry).map(([key, config]) => ({
        key,
        ...config,
        hasApiKey: !!getModelApiKey(config),
      }))
      return Response.json(models, { headers: corsHeaders })
    }

    // POST /api/models/:key/test — Test model connection
    const testMatch = path.match(/^\/api\/models\/([^/]+)\/test$/)
    if (testMatch && method === 'POST') {
      const modelKey = decodeURIComponent(testMatch[1])
      const result = await testOpenAIConnection(modelKey)
      return Response.json(result, { headers: corsHeaders })
    }

    // PUT /api/models/key — Save API key to .env and process.env
    if (path === '/api/models/key' && method === 'PUT') {
      try {
        const body = await req.json() as { envVar: string; value: string }
        if (!body.envVar || !body.value) {
          return Response.json(
            { error: '需要 envVar 和 value' },
            { status: 400, headers: corsHeaders },
          )
        }

        // Validate envVar is one we know about
        const registry = getOpenAIModelRegistry()
        const validEnvVars = new Set(Object.values(registry).map(c => c.apiKeyEnvVar))
        if (!validEnvVars.has(body.envVar)) {
          return Response.json(
            { error: `未知的环境变量: ${body.envVar}` },
            { status: 400, headers: corsHeaders },
          )
        }

        // Update process.env immediately
        process.env[body.envVar] = body.value

        // Persist to .env file
        const envPath = join(workingDirectory, '.env')
        let envContent = ''
        try {
          envContent = readFileSync(envPath, 'utf-8')
        } catch { /* file doesn't exist yet */ }

        // Also try project root .env
        const rootEnvPath = join(process.cwd(), '.env')
        if (envPath !== rootEnvPath) {
          try {
            envContent = readFileSync(rootEnvPath, 'utf-8')
          } catch {}
        }

        const targetEnvPath = existsSync(rootEnvPath) ? rootEnvPath : envPath
        const lines = envContent.split('\n')
        const existingLine = lines.findIndex(l => l.startsWith(`${body.envVar}=`))
        if (existingLine >= 0) {
          lines[existingLine] = `${body.envVar}=${body.value}`
        } else {
          lines.push(`${body.envVar}=${body.value}`)
        }

        const { writeFileSync } = await import('fs')
        writeFileSync(targetEnvPath, lines.join('\n'))

        return Response.json({
          ok: true,
          envVar: body.envVar,
          savedTo: targetEnvPath,
        }, { headers: corsHeaders })
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        )
      }
    }

    // ─── Workspace API ──────────────────────────────────

    // GET /api/workspace — Return current working directory
    if (path === '/api/workspace' && method === 'GET') {
      return Response.json({
        path: workingDirectory,
        name: basename(workingDirectory),
      }, { headers: corsHeaders })
    }

    // PUT /api/workspace — Switch working directory
    if (path === '/api/workspace' && method === 'PUT') {
      const body = await req.json() as { path: string }
      if (!body.path) {
        return Response.json({ ok: false, error: '缺少 path 参数' }, { status: 400, headers: corsHeaders })
      }
      const result = setWorkingDirectory(body.path)
      if (!result.ok) {
        return Response.json(result, { status: 400, headers: corsHeaders })
      }
      return Response.json({
        ok: true,
        path: workingDirectory,
        name: basename(workingDirectory),
      }, { headers: corsHeaders })
    }

    // GET /api/workspace/browse?path=... — Browse directories for workspace picker
    if (path === '/api/workspace/browse' && method === 'GET') {
      const browsePath = url.searchParams.get('path') || homedir()
      try {
        const resolved = resolve(browsePath)
        const entries = readdirSync(resolved, { withFileTypes: true })
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => ({
            name: e.name,
            path: join(resolved, e.name),
            hasChildren: (() => {
              try {
                return readdirSync(join(resolved, e.name), { withFileTypes: true })
                  .some(c => c.isDirectory())
              } catch { return false }
            })(),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
        return Response.json({
          current: resolved,
          parent: resolve(resolved, '..'),
          dirs,
        }, { headers: corsHeaders })
      } catch (err) {
        return Response.json(
          { error: `无法浏览目录: ${browsePath}` },
          { status: 400, headers: corsHeaders },
        )
      }
    }

    // GET /api/stats — Session stats
    if (path === '/api/stats' && method === 'GET') {
      // Get real code changes from git
      let codeChanges = { added: 0, removed: 0 }
      try {
        const gitProc = Bun.spawnSync(['git', 'diff', '--numstat'], { cwd: workingDirectory })
        const gitText = new TextDecoder().decode(gitProc.stdout).trim()
        if (gitText) {
          for (const line of gitText.split('\n')) {
            const parts = line.split('\t')
            if (parts.length >= 2) {
              const added = parseInt(parts[0]) || 0
              const removed = parseInt(parts[1]) || 0
              codeChanges.added += added
              codeChanges.removed += removed
            }
          }
        }
      } catch { /* ignore git errors */ }

      // Context usage: approximate as % of 200K window
      const totalTokens = sessionStats.totalInputTokens + sessionStats.totalOutputTokens
      const contextUsage = totalTokens > 0 ? Math.min(99, Math.round((totalTokens / 200000) * 100)) : 0

      return Response.json({
        totalCost: sessionStats.totalCostCNY,
        totalTokens: {
          input: sessionStats.totalInputTokens,
          output: sessionStats.totalOutputTokens,
        },
        contextUsage,
        codeChanges,
        avgLatency: sessionStats.requestCount > 0
          ? sessionStats.totalLatencyMs / sessionStats.requestCount
          : 0,
        requestCount: sessionStats.requestCount,
        modelDistribution: sessionStats.modelCounts,
        recentRequests: sessionStats.recentRequests,
      }, { headers: corsHeaders })
    }

    // GET /api/tools — List available tools (builtin + MCP, with usage stats)
    if (path === '/api/tools' && method === 'GET') {
      const TOOL_META: Record<string, { category: string; icon: string; permission: string }> = {
        Bash: { category: '核心开发', icon: '⚡', permission: 'ask' },
        FileEdit: { category: '核心开发', icon: '✏️', permission: 'ask' },
        FileWrite: { category: '核心开发', icon: '📝', permission: 'ask' },
        FileRead: { category: '核心开发', icon: '📖', permission: 'auto' },
        Glob: { category: '搜索工具', icon: '🔎', permission: 'auto' },
        Grep: { category: '搜索工具', icon: '🔍', permission: 'auto' },
        ListFiles: { category: '搜索工具', icon: '📁', permission: 'auto' },
      }

      // Built-in tools
      const builtinTools = TOOL_DEFINITIONS.map(t => {
        const meta = TOOL_META[t.function.name] || { category: '其他', icon: '🔧', permission: 'auto' }
        return {
          name: t.function.name,
          description: t.function.description,
          source: 'builtin',
          category: meta.category,
          icon: meta.icon,
          permission: meta.permission,
          readOnly: meta.permission === 'auto',
          usageCount: toolUsageStats[t.function.name] || 0,
        }
      })

      // MCP tools
      const mcpToolsList = mcpManager.getAllTools().map(t => ({
        name: t.fullName,
        description: t.description,
        source: `mcp:${t.serverName}`,
        category: `MCP: ${t.serverName}`,
        icon: '🔌',
        permission: 'ask',
        readOnly: false,
        usageCount: toolUsageStats[t.fullName] || 0,
      }))

      // Sort by usage (most used first)
      const allTools = [...builtinTools, ...mcpToolsList]
        .sort((a, b) => b.usageCount - a.usageCount)

      return Response.json(allTools, { headers: corsHeaders })
    }

    // ─── File System APIs ────────────────────────────

    // GET /api/files/tree?path=... — List directory tree
    if (path === '/api/files/tree' && method === 'GET') {
      const dirPath = url.searchParams.get('path') || workingDirectory
      if (!isPathSafe(dirPath)) {
        return Response.json(
          { error: '路径不安全：不允许访问项目目录之外的文件' },
          { status: 403, headers: corsHeaders },
        )
      }
      try {
        const tree = buildFileTree(dirPath, 3)
        return Response.json(tree, { headers: corsHeaders })
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        )
      }
    }

    // GET /api/files/read?path=... — Read file content
    if (path === '/api/files/read' && method === 'GET') {
      const filePath = url.searchParams.get('path')
      if (!filePath) {
        return Response.json(
          { error: 'Missing path parameter' },
          { status: 400, headers: corsHeaders },
        )
      }
      if (!isPathSafe(filePath)) {
        return Response.json(
          { error: '路径不安全：不允许访问项目目录之外的文件' },
          { status: 403, headers: corsHeaders },
        )
      }
      try {
        if (!existsSync(filePath)) {
          return Response.json(
            { error: 'File not found' },
            { status: 404, headers: corsHeaders },
          )
        }
        const stat = statSync(filePath)
        if (stat.size > 2 * 1024 * 1024) {
          return Response.json(
            { error: 'File too large (>2MB)', size: stat.size },
            { status: 413, headers: corsHeaders },
          )
        }
        const content = readFileSync(filePath, 'utf-8')
        const ext = extname(filePath).slice(1)
        return Response.json({
          path: filePath,
          name: basename(filePath),
          content,
          language: EXT_TO_LANG[ext] || ext || 'text',
          size: stat.size,
          modified: stat.mtime.toISOString(),
        }, { headers: corsHeaders })
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        )
      }
    }

    // ─── Shell Execution API ─────────────────────────

    // POST /api/bash — Execute a shell command
    if (path === '/api/bash' && method === 'POST') {
      const body = await req.json() as { command: string; cwd?: string; timeout?: number }
      if (!body.command) {
        return Response.json(
          { error: 'Missing command' },
          { status: 400, headers: corsHeaders },
        )
      }

      // Dangerous command filter
      const FORBIDDEN_PATTERNS = [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf *',
        'mkfs.',
        '> /dev/',
        'dd if=',
        ':(){ :|:& };:',
        'chmod -R 777 /',
        'curl.*| bash',
        'wget.*| bash',
        'shutdown',
        'reboot',
        'init 0',
        'init 6',
      ]
      const cmdLower = body.command.toLowerCase()
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (cmdLower.includes(pattern.toLowerCase())) {
          return Response.json(
            { error: `禁止执行的危险命令: 包含 "${pattern}"` },
            { status: 403, headers: corsHeaders },
          )
        }
      }
      try {
        const proc = Bun.spawn(['bash', '-c', body.command], {
          cwd: body.cwd || workingDirectory,
          stdout: 'pipe',
          stderr: 'pipe',
          env: process.env,
        })

        const timeout = body.timeout || 30_000
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          try { proc.kill() } catch {}
        }, timeout)

        try {
          const exitCode = await proc.exited
          clearTimeout(timer)
          if (timedOut) {
            return Response.json({
              exitCode: -1,
              stdout: '',
              stderr: `Command timed out after ${timeout / 1000}s`,
              command: body.command,
            }, { headers: corsHeaders })
          }
          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()

          return Response.json({
            exitCode,
            stdout,
            stderr,
            command: body.command,
          }, { headers: corsHeaders })
        } catch (err) {
          clearTimeout(timer)
          throw err
        }
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        )
      }
    }

    // ─── MCP Servers API ────────────────────────────────

    // GET /api/mcp — List MCP servers: merge config files + live connection status
    if (path === '/api/mcp' && method === 'GET') {
      const cwd = workingDirectory
      type ServerEntry = {
        name: string; url: string; type: string; scope: 'project' | 'user'
        command?: string; args?: string[]
        status: 'connected' | 'disconnected' | 'connecting' | 'error'
        tools: Array<{ name: string; fullName: string; description: string }>
        resources: number; error?: string; pid?: number
      }
      const servers: ServerEntry[] = []

      // Helper: parse config entries from mcpServers object
      const parseConfigs = (mcpServers: Record<string, unknown>, scope: 'project' | 'user') => {
        for (const [name, config] of Object.entries(mcpServers)) {
          if (servers.some(s => s.name === name)) continue
          const cfg = config as Record<string, unknown>
          const type = (cfg.type as string) || 'stdio'
          let url = ''
          const command = cfg.command as string || ''
          const args = (cfg.args as string[]) || []
          if (type === 'stdio') {
            url = `stdio://${command}${args.length ? ' ' + args.join(' ') : ''}`
          } else if ('url' in cfg) {
            url = cfg.url as string
          }

          // Merge live status from McpManager
          const live = mcpManager.getStatus(name)
          servers.push({
            name, url, type, scope, command, args,
            status: live?.status || 'disconnected',
            tools: live?.tools?.map(t => ({ name: t.name, fullName: t.fullName, description: t.description })) || [],
            resources: 0,
            error: live?.error,
            pid: live?.pid,
          })
        }
      }

      // Read project-level .mcp.json
      const mcpJsonPath = join(cwd, '.mcp.json')
      if (existsSync(mcpJsonPath)) {
        try {
          const raw = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
          parseConfigs(raw.mcpServers || {}, 'project')
        } catch { /* ignore */ }
      }

      // Read global ~/.claude/settings.json
      const globalSettingsPath = join(process.env.HOME || '~', '.claude', 'settings.json')
      if (existsSync(globalSettingsPath)) {
        try {
          const raw = JSON.parse(readFileSync(globalSettingsPath, 'utf-8'))
          parseConfigs(raw.mcpServers || {}, 'user')
        } catch { /* ignore */ }
      }

      return Response.json({
        servers,
        totalCount: servers.length,
        connectedCount: servers.filter(s => s.status === 'connected').length,
        totalTools: servers.reduce((s, srv) => s + srv.tools.length, 0),
        projectConfigPath: mcpJsonPath,
        projectConfigExists: existsSync(mcpJsonPath),
      }, { headers: corsHeaders })
    }

    // POST /api/mcp/:name/connect — Connect to an MCP server
    const mcpConnectMatch = path.match(/^\/api\/mcp\/([^/]+)\/connect$/)
    if (mcpConnectMatch && method === 'POST') {
      const serverName = decodeURIComponent(mcpConnectMatch[1])
      // Find config from .mcp.json or settings.json
      let serverConfig: { command: string; args: string[]; type: string; scope: 'project' | 'user' } | null = null

      const mcpJsonPath = join(workingDirectory, '.mcp.json')
      if (existsSync(mcpJsonPath)) {
        try {
          const raw = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
          const cfg = (raw.mcpServers || {})[serverName]
          if (cfg) {
            serverConfig = {
              command: cfg.command || '',
              args: cfg.args || [],
              type: cfg.type || 'stdio',
              scope: 'project',
            }
          }
        } catch { /* ignore */ }
      }

      if (!serverConfig) {
        const globalPath = join(process.env.HOME || '~', '.claude', 'settings.json')
        if (existsSync(globalPath)) {
          try {
            const raw = JSON.parse(readFileSync(globalPath, 'utf-8'))
            const cfg = (raw.mcpServers || {})[serverName]
            if (cfg) {
              serverConfig = {
                command: cfg.command || '',
                args: cfg.args || [],
                type: cfg.type || 'stdio',
                scope: 'user',
              }
            }
          } catch { /* ignore */ }
        }
      }

      if (!serverConfig) {
        return Response.json({ error: `MCP 服务器配置不存在: ${serverName}` }, { status: 404, headers: corsHeaders })
      }

      try {
        await mcpManager.connect({
          name: serverName,
          command: serverConfig.command,
          args: serverConfig.args,
          scope: serverConfig.scope,
          type: 'stdio',
        })
        const status = mcpManager.getStatus(serverName)
        return Response.json({
          ok: true,
          name: serverName,
          status: status?.status,
          tools: status?.tools?.map(t => ({ name: t.name, fullName: t.fullName, description: t.description })) || [],
        }, { headers: corsHeaders })
      } catch (err) {
        return Response.json({
          error: err instanceof Error ? err.message : String(err),
          name: serverName,
        }, { status: 500, headers: corsHeaders })
      }
    }

    // POST /api/mcp/:name/disconnect — Disconnect MCP server
    const mcpDisconnectMatch = path.match(/^\/api\/mcp\/([^/]+)\/disconnect$/)
    if (mcpDisconnectMatch && method === 'POST') {
      const serverName = decodeURIComponent(mcpDisconnectMatch[1])
      await mcpManager.disconnect(serverName)
      return Response.json({ ok: true, name: serverName }, { headers: corsHeaders })
    }

    // POST /api/mcp/:name/restart — Restart MCP server
    const mcpRestartMatch = path.match(/^\/api\/mcp\/([^/]+)\/restart$/)
    if (mcpRestartMatch && method === 'POST') {
      const serverName = decodeURIComponent(mcpRestartMatch[1])
      try {
        await mcpManager.restart(serverName)
        const status = mcpManager.getStatus(serverName)
        return Response.json({ ok: true, name: serverName, status: status?.status }, { headers: corsHeaders })
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, headers: corsHeaders })
      }
    }

    // POST /api/mcp/add — Add MCP server config to .mcp.json
    if (path === '/api/mcp/add' && method === 'POST') {
      const body = await req.json() as { name: string; command: string; args?: string[]; env?: Record<string, string> }
      if (!body.name || !body.command) {
        return Response.json({ error: '需要 name 和 command' }, { status: 400, headers: corsHeaders })
      }

      const mcpJsonPath = join(workingDirectory, '.mcp.json')
      let mcpConfig: Record<string, unknown> = {}
      if (existsSync(mcpJsonPath)) {
        try { mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf-8')) } catch { /* start fresh */ }
      }

      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {}
      ;(mcpConfig.mcpServers as Record<string, unknown>)[body.name] = {
        command: body.command,
        args: body.args || [],
        ...(body.env ? { env: body.env } : {}),
      }

      writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf-8')
      return Response.json({ ok: true, name: body.name, path: mcpJsonPath }, { headers: corsHeaders })
    }

    // DELETE /api/mcp/:name — Remove MCP server config
    const mcpDeleteMatch = path.match(/^\/api\/mcp\/([^/]+)$/)
    if (mcpDeleteMatch && method === 'DELETE') {
      const serverName = decodeURIComponent(mcpDeleteMatch[1])

      // Disconnect first
      await mcpManager.disconnect(serverName)

      // Remove from .mcp.json
      const mcpJsonPath = join(workingDirectory, '.mcp.json')
      if (existsSync(mcpJsonPath)) {
        try {
          const mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
          if (mcpConfig.mcpServers?.[serverName]) {
            delete mcpConfig.mcpServers[serverName]
            writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf-8')
          }
        } catch { /* ignore */ }
      }

      return Response.json({ ok: true, name: serverName }, { headers: corsHeaders })
    }
    // ─── Skills API ─────────────────────────────────────

    // GET /api/skills — Scan .claude/skills/*.md from project + user dirs
    if (path === '/api/skills' && method === 'GET') {
      interface SkillEntry {
        name: string
        source: 'project' | 'user' | 'builtin'
        description: string
        trigger: string
        active: boolean
        filePath: string
        content: string
      }

      const skills: SkillEntry[] = []

      const scanSkillsDir = (dir: string, source: 'project' | 'user') => {
        if (!existsSync(dir)) return
        try {
          const files = readdirSync(dir).filter(f => f.endsWith('.md'))
          for (const f of files) {
            const filePath = join(dir, f)
            const raw = readFileSync(filePath, 'utf-8')

            // Parse YAML frontmatter
            let name = f.replace(/\.md$/, '')
            let description = ''
            let trigger = 'auto'
            let content = raw

            const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
            if (fmMatch) {
              const fm = fmMatch[1]
              content = fmMatch[2]
              const nameMatch = fm.match(/name:\s*(.+)/)
              const descMatch = fm.match(/description:\s*(.+)/)
              const trigMatch = fm.match(/trigger:\s*(.+)/)
              if (nameMatch) name = nameMatch[1].trim()
              if (descMatch) description = descMatch[1].trim()
              if (trigMatch) trigger = trigMatch[1].trim()
            } else {
              // No frontmatter, use first line as description
              const firstLine = raw.split('\n').find(l => l.trim() && !l.startsWith('#'))
              if (firstLine) description = firstLine.trim().slice(0, 100)
            }

            // Check disabled state from localStorage-like file
            const disabledPath = join(process.env.HOME || '~', '.claude', 'disabled-skills.json')
            let disabledSet: Set<string> = new Set()
            if (existsSync(disabledPath)) {
              try { disabledSet = new Set(JSON.parse(readFileSync(disabledPath, 'utf-8'))) } catch {}
            }

            skills.push({
              name,
              source,
              description,
              trigger,
              active: !disabledSet.has(filePath),
              filePath,
              content: content.trim(),
            })
          }
        } catch { /* ignore */ }
      }

      // Project skills
      scanSkillsDir(join(workingDirectory, '.claude', 'skills'), 'project')
      // User skills
      scanSkillsDir(join(process.env.HOME || '~', '.claude', 'skills'), 'user')

      // Built-in default skills
      const builtinSkills: SkillEntry[] = [
        {
          name: 'code-review',
          source: 'builtin',
          description: '代码审查最佳实践',
          trigger: 'auto',
          active: true,
          filePath: '',
          content: '当用户要求审查代码时，分析代码质量、安全性、性能和可维护性。',
        },
        {
          name: 'git-workflow',
          source: 'builtin',
          description: 'Git 提交工作流',
          trigger: 'auto',
          active: true,
          filePath: '',
          content: '当用户操作 Git 时，遵循 conventional commits 规范，先 git diff 检查变更再提交。',
        },
      ]

      return Response.json([...skills, ...builtinSkills], { headers: corsHeaders })
    }

    // PUT /api/skills/toggle — Toggle skill active state
    if (path === '/api/skills/toggle' && method === 'PUT') {
      const body = await req.json() as { filePath: string; active: boolean }
      const disabledPath = join(process.env.HOME || '~', '.claude', 'disabled-skills.json')
      let disabled: string[] = []
      if (existsSync(disabledPath)) {
        try { disabled = JSON.parse(readFileSync(disabledPath, 'utf-8')) } catch {}
      }

      if (body.active) {
        disabled = disabled.filter(p => p !== body.filePath)
      } else {
        if (!disabled.includes(body.filePath)) disabled.push(body.filePath)
      }

      const dir = join(process.env.HOME || '~', '.claude')
      if (!existsSync(dir)) { Bun.spawnSync(['mkdir', '-p', dir]) }
      writeFileSync(disabledPath, JSON.stringify(disabled, null, 2), 'utf-8')
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    // ─── Slash Commands API ─────────────────────────────

    // GET /api/commands — Scan .claude/commands/*.md
    if (path === '/api/commands' && method === 'GET') {
      interface CommandEntry {
        name: string
        source: 'project' | 'user'
        description: string
        content: string
        filePath: string
      }

      const commands: CommandEntry[] = []

      const scanCommandsDir = (dir: string, source: 'project' | 'user') => {
        if (!existsSync(dir)) return
        try {
          const files = readdirSync(dir).filter(f => f.endsWith('.md'))
          for (const f of files) {
            const filePath = join(dir, f)
            const raw = readFileSync(filePath, 'utf-8')
            const name = f.replace(/\.md$/, '')
            // First non-empty line as description
            const firstLine = raw.split('\n').find(l => l.trim() && !l.startsWith('#'))
            commands.push({
              name,
              source,
              description: firstLine?.trim().slice(0, 100) || name,
              content: raw,
              filePath,
            })
          }
        } catch { /* ignore */ }
      }

      scanCommandsDir(join(workingDirectory, '.claude', 'commands'), 'project')
      scanCommandsDir(join(process.env.HOME || '~', '.claude', 'commands'), 'user')

      return Response.json(commands, { headers: corsHeaders })
    }

    // ─── Hooks API ──────────────────────────────────────

    // GET /api/hooks — Read hooks configuration
    if (path === '/api/hooks' && method === 'GET') {
      const hooksPaths = [
        join(workingDirectory, '.claude', 'hooks.json'),
        join(process.env.HOME || '~', '.claude', 'hooks.json'),
      ]
      let hooks = { PreToolUse: [] as Array<{ matcher: string; command: string }>, PostToolUse: [] as Array<{ matcher: string; command: string }> }
      let source = 'none'
      for (const hp of hooksPaths) {
        if (existsSync(hp)) {
          try {
            hooks = JSON.parse(readFileSync(hp, 'utf-8'))
            source = hp
            break
          } catch {}
        }
      }
      return Response.json({ hooks, source }, { headers: corsHeaders })
    }

    // PUT /api/hooks — Save hooks configuration
    if (path === '/api/hooks' && method === 'PUT') {
      const body = await req.json() as { hooks: Record<string, unknown> }
      const hooksPath = join(workingDirectory, '.claude', 'hooks.json')
      const dir = join(workingDirectory, '.claude')
      if (!existsSync(dir)) { Bun.spawnSync(['mkdir', '-p', dir]) }
      writeFileSync(hooksPath, JSON.stringify(body.hooks, null, 2), 'utf-8')
      return Response.json({ ok: true, path: hooksPath }, { headers: corsHeaders })
    }

    // ─── Community Registry API ─────────────────────────

    // GET /api/registry — Curated list of popular MCP servers & skills
    if (path === '/api/registry' && method === 'GET') {
      const registry = {
        mcpServers: [
          {
            name: 'filesystem',
            description: '安全的文件系统操作 — 读写文件、目录管理',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', workingDirectory],
            category: '核心工具',
            stars: 4800,
            official: true,
          },
          {
            name: 'memory',
            description: '基于知识图谱的持久化记忆系统',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory'],
            category: '核心工具',
            stars: 3200,
            official: true,
          },
          {
            name: 'fetch',
            description: 'HTTP 请求工具 — 抓取网页和 API',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-fetch'],
            category: '核心工具',
            stars: 2900,
            official: true,
          },
          {
            name: 'sequential-thinking',
            description: '结构化思维链 — 复杂问题分步推理',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
            category: '推理增强',
            stars: 2100,
            official: true,
          },
          {
            name: 'brave-search',
            description: 'Brave 搜索引擎 — 网页/新闻搜索',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search'],
            category: '搜索',
            stars: 1800,
            official: true,
            envRequired: 'BRAVE_API_KEY',
          },
          {
            name: 'github',
            description: 'GitHub API — 仓库/Issue/PR/文件操作',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            category: '开发工具',
            stars: 3500,
            official: true,
            envRequired: 'GITHUB_PERSONAL_ACCESS_TOKEN',
          },
          {
            name: 'puppeteer',
            description: '浏览器自动化 — 截图、爬虫、页面交互',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-puppeteer'],
            category: '浏览器',
            stars: 2400,
            official: true,
          },
          {
            name: 'sqlite',
            description: 'SQLite 数据库查询和管理',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-sqlite'],
            category: '数据库',
            stars: 1500,
            official: true,
          },
          {
            name: 'postgres',
            description: 'PostgreSQL 数据库只读查询',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-postgres'],
            category: '数据库',
            stars: 1200,
            official: true,
          },
          {
            name: 'slack',
            description: 'Slack 消息发送和频道管理',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-slack'],
            category: '协作',
            stars: 900,
            official: true,
            envRequired: 'SLACK_BOT_TOKEN',
          },
          {
            name: 'everything',
            description: 'MCP 测试参考服务器 — 所有功能演示',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-everything'],
            category: '开发测试',
            stars: 800,
            official: true,
          },
          {
            name: 'firecrawl',
            description: '高级网页爬虫 — 结构化数据提取',
            command: 'npx',
            args: ['-y', 'firecrawl-mcp'],
            category: '搜索',
            stars: 1100,
            official: false,
            envRequired: 'FIRECRAWL_API_KEY',
          },
        ],
        skills: [
          {
            name: 'code-review',
            description: '代码审查最佳实践 — 安全、性能、可维护性',
            category: '开发',
            builtin: true,
          },
          {
            name: 'git-workflow',
            description: 'Git 工作流 — Conventional Commits 规范',
            category: '开发',
            builtin: true,
          },
          {
            name: 'docker-deploy',
            description: 'Docker 构建和部署流程',
            category: '运维',
            url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/skills/docker-deploy.md',
          },
          {
            name: 'test-writing',
            description: '单元测试编写最佳实践',
            category: '测试',
            url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/skills/test-writing.md',
          },
          {
            name: 'api-docs',
            description: '自动生成 API 文档',
            category: '文档',
            url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/skills/api-docs.md',
          },
        ],
        categories: ['核心工具', '搜索', '开发工具', '数据库', '浏览器', '协作', '推理增强', '开发测试'],
      }

      // Check which are already installed
      const mcpJsonPath = join(workingDirectory, '.mcp.json')
      let installed: Set<string> = new Set()
      if (existsSync(mcpJsonPath)) {
        try {
          const cfg = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
          installed = new Set(Object.keys(cfg.mcpServers || {}))
        } catch {}
      }

      const enriched = {
        ...registry,
        mcpServers: registry.mcpServers.map(s => ({
          ...s,
          installed: installed.has(s.name),
          connected: mcpManager.getStatus(s.name)?.status === 'connected',
        })),
      }

      return Response.json(enriched, { headers: corsHeaders })
    }

    // POST /api/registry/install-mcp — One-click install MCP server
    if (path === '/api/registry/install-mcp' && method === 'POST') {
      const body = await req.json() as {
        name: string
        command: string
        args: string[]
        env?: Record<string, string>
      }
      if (!body.name || !body.command) {
        return Response.json({ error: '缺少 name 或 command' }, { status: 400, headers: corsHeaders })
      }

      // Write to .mcp.json
      const mcpJsonPath = join(workingDirectory, '.mcp.json')
      let mcpConfig: Record<string, unknown> = { mcpServers: {} }
      if (existsSync(mcpJsonPath)) {
        try { mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf-8')) } catch {}
      }
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {}

      const serverConfig: Record<string, unknown> = {
        command: body.command,
        args: body.args || [],
      }
      if (body.env && Object.keys(body.env).length > 0) {
        serverConfig.env = body.env
      }
      ;(mcpConfig.mcpServers as Record<string, unknown>)[body.name] = serverConfig

      writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf-8')

      // Auto-connect
      try {
        await mcpManager.connect({
          name: body.name,
          command: body.command,
          args: body.args || [],
          env: body.env,
          scope: 'project',
          type: 'stdio',
        })
      } catch { /* connection error is non-fatal */ }

      return Response.json({
        ok: true,
        name: body.name,
        status: mcpManager.getStatus(body.name)?.status || 'disconnected',
      }, { headers: corsHeaders })
    }

    // POST /api/registry/install-skill — Download and install a skill
    if (path === '/api/registry/install-skill' && method === 'POST') {
      const body = await req.json() as {
        name: string
        url?: string
        content?: string
      }
      if (!body.name) {
        return Response.json({ error: '缺少技能名称' }, { status: 400, headers: corsHeaders })
      }

      const skillDir = join(workingDirectory, '.claude', 'skills')
      if (!existsSync(skillDir)) {
        Bun.spawnSync(['mkdir', '-p', skillDir])
      }

      const skillPath = join(skillDir, `${body.name}.md`)
      let content = body.content || ''

      // Download from URL if provided
      if (body.url && !content) {
        try {
          const res = await fetch(body.url)
          if (res.ok) {
            content = await res.text()
          } else {
            return Response.json({ error: `下载失败: ${res.status}` }, { status: 400, headers: corsHeaders })
          }
        } catch (err) {
          return Response.json({ error: `网络错误: ${err instanceof Error ? err.message : String(err)}` }, { status: 500, headers: corsHeaders })
        }
      }

      if (!content) {
        // Create a template
        content = `---\nname: ${body.name}\ndescription: ${body.name} 技能\ntrigger: auto\n---\n\n# ${body.name}\n\n在这里编写技能指令...\n`
      }

      writeFileSync(skillPath, content, 'utf-8')
      return Response.json({
        ok: true,
        name: body.name,
        path: skillPath,
        size: content.length,
      }, { headers: corsHeaders })
    }

    // DELETE /api/registry/uninstall-skill/:name — Remove a skill file
    const uninstallSkillMatch = path.match(/^\/api\/registry\/uninstall-skill\/(.+)$/)
    if (uninstallSkillMatch && method === 'DELETE') {
      const skillName = decodeURIComponent(uninstallSkillMatch[1])
      const skillPath = join(workingDirectory, '.claude', 'skills', `${skillName}.md`)
      if (existsSync(skillPath)) {
        const { unlinkSync } = await import('node:fs')
        unlinkSync(skillPath)
        return Response.json({ ok: true, name: skillName }, { headers: corsHeaders })
      }
      return Response.json({ error: `技能不存在: ${skillName}` }, { status: 404, headers: corsHeaders })
    }

    // ─── Permissions API ────────────────────────────────

    // GET /api/permissions — Read permission rules from settings files
    if (path === '/api/permissions' && method === 'GET') {
      const rules: Array<{
        id: string
        tool: string
        pattern: string
        decision: 'allow' | 'deny'
        source: 'user' | 'project'
      }> = []

      let ruleId = 0

      // Read global settings (~/.claude/settings.json)
      const globalSettingsPath = join(homedir(), '.claude', 'settings.json')
      if (existsSync(globalSettingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(globalSettingsPath, 'utf-8'))
          if (Array.isArray(settings.permissions?.allow)) {
            for (const pattern of settings.permissions.allow) {
              rules.push({
                id: String(ruleId++),
                tool: pattern.split(':')[0] || 'All',
                pattern: pattern.split(':').slice(1).join(':') || pattern,
                decision: 'allow',
                source: 'user',
              })
            }
          }
          if (Array.isArray(settings.permissions?.deny)) {
            for (const pattern of settings.permissions.deny) {
              rules.push({
                id: String(ruleId++),
                tool: pattern.split(':')[0] || 'All',
                pattern: pattern.split(':').slice(1).join(':') || pattern,
                decision: 'deny',
                source: 'user',
              })
            }
          }
        } catch { /* ignore */ }
      }

      // Read project settings (.claude/settings.json)
      const projectSettingsPath = join(workingDirectory, '.claude', 'settings.json')
      if (existsSync(projectSettingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(projectSettingsPath, 'utf-8'))
          if (Array.isArray(settings.permissions?.allow)) {
            for (const pattern of settings.permissions.allow) {
              rules.push({
                id: String(ruleId++),
                tool: pattern.split(':')[0] || 'All',
                pattern: pattern.split(':').slice(1).join(':') || pattern,
                decision: 'allow',
                source: 'project',
              })
            }
          }
          if (Array.isArray(settings.permissions?.deny)) {
            for (const pattern of settings.permissions.deny) {
              rules.push({
                id: String(ruleId++),
                tool: pattern.split(':')[0] || 'All',
                pattern: pattern.split(':').slice(1).join(':') || pattern,
                decision: 'deny',
                source: 'project',
              })
            }
          }
        } catch { /* ignore */ }
      }

      return Response.json({
        rules,
        totalCount: rules.length,
        globalSettingsPath,
        projectSettingsPath,
      }, { headers: corsHeaders })
    }

    // ─── Git Diff API ────────────────────────────────

    // GET /api/diff — Get git diff
    if (path === '/api/diff' && method === 'GET') {
      const cwd = url.searchParams.get('cwd') || workingDirectory
      const staged = url.searchParams.get('staged') === 'true'
      try {
        const args = staged
          ? ['git', 'diff', '--staged', '--stat']
          : ['git', 'diff', '--stat']
        const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
        await proc.exited
        const stat = await new Response(proc.stdout).text()

        const diffArgs = staged
          ? ['git', 'diff', '--staged']
          : ['git', 'diff']
        const diffProc = Bun.spawn(diffArgs, { cwd, stdout: 'pipe', stderr: 'pipe' })
        await diffProc.exited
        const diff = await new Response(diffProc.stdout).text()

        // Parse numstat for summary
        const numstatArgs = staged
          ? ['git', 'diff', '--staged', '--numstat']
          : ['git', 'diff', '--numstat']
        const numstatProc = Bun.spawn(numstatArgs, { cwd, stdout: 'pipe', stderr: 'pipe' })
        await numstatProc.exited
        const numstat = await new Response(numstatProc.stdout).text()
        let additions = 0, deletions = 0, filesChanged = 0
        for (const line of numstat.trim().split('\n')) {
          if (!line) continue
          const [a, d] = line.split('\t')
          if (a !== '-') additions += parseInt(a) || 0
          if (d !== '-') deletions += parseInt(d) || 0
          filesChanged++
        }

        return Response.json({ stat, diff, stats: { filesChanged, additions, deletions } }, { headers: corsHeaders })
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        )
      }
    }

    // ─── Memory (CLAUDE.md) API ──────────────────────

    // GET /api/memory?scope=project|user|team
    if (path === '/api/memory' && method === 'GET') {
      const scope = url.searchParams.get('scope') || 'project'
      const cwd = workingDirectory
      let memoryPath = ''
      if (scope === 'project') {
        memoryPath = join(cwd, 'CLAUDE.md')
      } else if (scope === 'user') {
        memoryPath = join(process.env.HOME || '~', '.claude', 'CLAUDE.md')
      } else if (scope === 'team') {
        memoryPath = join(cwd, '.claude', 'CLAUDE.md')
      }
      const content = existsSync(memoryPath)
        ? readFileSync(memoryPath, 'utf-8')
        : ''
      return Response.json({
        scope,
        path: memoryPath,
        content,
        exists: existsSync(memoryPath),
      }, { headers: corsHeaders })
    }

    // PUT /api/memory — Save memory file
    if (path === '/api/memory' && method === 'PUT') {
      const body = await req.json() as { scope: string; content: string }
      const cwd = workingDirectory
      let memoryPath = ''
      if (body.scope === 'project') {
        memoryPath = join(cwd, 'CLAUDE.md')
      } else if (body.scope === 'user') {
        memoryPath = join(process.env.HOME || '~', '.claude', 'CLAUDE.md')
      } else if (body.scope === 'team') {
        memoryPath = join(cwd, '.claude', 'CLAUDE.md')
      }
      try {
        writeFileSync(memoryPath, body.content, 'utf-8')
        return Response.json({ ok: true, path: memoryPath }, { headers: corsHeaders })
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        )
      }
    }

    // ─── Session API ────────────────────────────────

    // GET /api/sessions — List recent sessions
    if (path === '/api/sessions' && method === 'GET') {
      const sessionsDir = join(
        process.env.HOME || '~',
        '.claude', 'projects',
      )
      const sessions: Array<{
        id: string
        name: string
        date: string
        messageCount: number
      }> = []
      try {
        if (existsSync(sessionsDir)) {
          for (const dir of readdirSync(sessionsDir).slice(0, 20)) {
            const dirPath = join(sessionsDir, dir)
            const stat = statSync(dirPath)
            if (stat.isDirectory()) {
              sessions.push({
                id: dir,
                name: dir,
                date: stat.mtime.toISOString(),
                messageCount: 0,
              })
            }
          }
        }
      } catch {
        // Ignore errors
      }
      return Response.json(sessions, { headers: corsHeaders })
    }

    // ─── Tool Execution API ─────────────────────────

    // POST /api/tools/execute — Execute a tool after permission granted
    if (path === '/api/tools/execute' && method === 'POST') {
      const body = await req.json() as {
        toolId: string
        toolName: string
        input: Record<string, unknown>
      }

      const startTime = Date.now()

      try {
        let result: { output: string; exitCode?: number; error?: string } = { output: '' }

        switch (body.toolName) {
          case 'BashTool':
          case 'Bash': {
            const command = (body.input.command || body.input.input || '') as string
            const cwd = (body.input.cwd || workingDirectory) as string
            const timeout = (body.input.timeout || 30_000) as number

            const proc = Bun.spawn(['bash', '-c', command], {
              cwd,
              stdout: 'pipe',
              stderr: 'pipe',
              env: process.env,
            })

            let timedOut = false
            const timer = setTimeout(() => {
              timedOut = true
              try { proc.kill() } catch {}
            }, timeout)

            try {
              const exitCode = await proc.exited
              clearTimeout(timer)
              if (timedOut) {
                result = { output: `Command timed out after ${timeout / 1000}s`, exitCode: -1 }
              } else {
                const stdout = await new Response(proc.stdout).text()
                const stderr = await new Response(proc.stderr).text()
                result = {
                  output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
                  exitCode: exitCode as number,
                }
              }
            } catch (err) {
              clearTimeout(timer)
              result = { output: '', error: err instanceof Error ? err.message : String(err) }
            }
            break
          }

          case 'FileReadTool':
          case 'FileRead': {
            const filePath = (body.input.file_path || body.input.path || '') as string
            if (!existsSync(filePath)) {
              result = { output: '', error: `File not found: ${filePath}` }
            } else {
              const content = readFileSync(filePath, 'utf-8')
              result = { output: content }
            }
            break
          }

          case 'FileEditTool':
          case 'FileEdit': {
            const filePath = (body.input.file_path || body.input.path || '') as string
            const oldStr = (body.input.old_string || body.input.old_str || '') as string
            const newStr = (body.input.new_string || body.input.new_str || '') as string

            if (!existsSync(filePath)) {
              result = { output: '', error: `File not found: ${filePath}` }
            } else {
              const content = readFileSync(filePath, 'utf-8')
              if (!content.includes(oldStr)) {
                result = { output: '', error: 'Target string not found in file' }
              } else {
                const newContent = content.replace(oldStr, newStr)
                writeFileSync(filePath, newContent, 'utf-8')
                result = { output: `Successfully edited ${filePath}` }
              }
            }
            break
          }

          case 'FileWriteTool':
          case 'FileWrite': {
            const filePath = (body.input.file_path || body.input.path || '') as string
            const content = (body.input.content || '') as string
            writeFileSync(filePath, content, 'utf-8')
            result = { output: `Successfully wrote ${filePath} (${content.length} bytes)` }
            break
          }

          case 'GrepTool':
          case 'Grep': {
            const pattern = (body.input.pattern || body.input.query || '') as string
            const searchPath = (body.input.path || workingDirectory) as string
            const proc = Bun.spawn(
              ['grep', '-rn', '--color=never', '-I', pattern, searchPath],
              { stdout: 'pipe', stderr: 'pipe' },
            )
            await proc.exited
            const stdout = await new Response(proc.stdout).text()
            result = { output: stdout || '(no matches)' }
            break
          }

          case 'GlobTool':
          case 'Glob': {
            const pattern = (body.input.pattern || body.input.glob || '') as string
            const searchPath = (body.input.path || workingDirectory) as string
            const proc = Bun.spawn(
              ['find', searchPath, '-name', pattern, '-maxdepth', '5'],
              { stdout: 'pipe', stderr: 'pipe' },
            )
            await proc.exited
            const stdout = await new Response(proc.stdout).text()
            result = { output: stdout || '(no matches)' }
            break
          }

          default:
            result = { output: '', error: `Tool ${body.toolName} not yet implemented in web bridge` }
        }

        const elapsed = Date.now() - startTime

        return Response.json({
          toolId: body.toolId,
          toolName: body.toolName,
          ...result,
          elapsed,
        }, { headers: corsHeaders })

      } catch (err) {
        return Response.json({
          toolId: body.toolId,
          toolName: body.toolName,
          output: '',
          error: err instanceof Error ? err.message : String(err),
          elapsed: Date.now() - startTime,
        }, { headers: corsHeaders })
      }
    }

    // ─── Agent APIs ─────────────────────────────────────

    // GET /api/agents — List agents with status and history
    if (path === '/api/agents' && method === 'GET') {
      const agents = Object.values(agentStates).map(a => ({
        ...a,
        // Don't send full history output in listing — trim it
        history: a.history.map(h => ({ ...h, outputPreview: h.outputPreview.slice(0, 200) })),
      }))
      return Response.json(agents, { headers: corsHeaders })
    }

    // POST /api/agents/:name/run — Run an agent (delegates to chat)
    const agentRunMatch = path.match(/^\/api\/agents\/([^/]+)\/run$/)
    if (agentRunMatch && method === 'POST') {
      const agentName = decodeURIComponent(agentRunMatch[1])
      const agent = agentStates[agentName]
      if (!agent) {
        return Response.json({ error: `代理不存在: ${agentName}` }, { status: 404, headers: corsHeaders })
      }

      const body = await req.json() as { task: string }
      if (!body.task?.trim()) {
        return Response.json({ error: '请输入任务描述' }, { status: 400, headers: corsHeaders })
      }

      // Mark as running
      agent.status = 'running'

      const startTime = Date.now()
      const runId = `run-${Date.now()}`

      try {
        // Get model config
        const config = getOpenAIModelConfig(agent.config.model)
        if (!config) {
          throw new Error(`模型不可用: ${agent.config.model}`)
        }
        const apiKey = getModelApiKey(config)
        if (!apiKey) {
          throw new Error(`API Key 未配置: ${config.apiKeyEnvVar}`)
        }

        // Build agent-specific system prompt
        const systemContent = [
          agent.config.systemPrompt,
          `\n你是 DolanClaw 的 ${agentName} 代理。`,
          `可用工具: ${agent.config.tools.join(', ')}`,
          `请直接执行用户给出的任务，使用工具完成操作后输出结果。`,
        ].join('\n')

        // ── Agent Agentic Loop (multi-turn tool execution) ──
        const agentToolDefs: OpenAITool[] = agent.config.tools
          .map(toolName => {
            const toolDef = TOOL_DEFINITIONS.find(t => t.function.name === toolName)
            return toolDef || null
          })
          .filter((t): t is OpenAITool => t !== null)

        // Also add MCP tools if agent has mcp tools configured
        const mcpAgentTools = mcpManager.getAllTools()
          .filter(t => agent.config.tools.includes(t.fullName))
          .map(t => ({
            type: 'function' as const,
            function: {
              name: t.fullName,
              description: `[MCP:${t.serverName}] ${t.description}`,
              parameters: t.inputSchema as Record<string, unknown>,
            },
          }))

        const allAgentTools = [...agentToolDefs, ...mcpAgentTools]

        const agentMessages: OpenAIChatMessage[] = [
          { role: 'system', content: systemContent },
          { role: 'user', content: body.task },
        ]

        const MAX_AGENT_ITERATIONS = 10
        let agentOutput = ''
        let totalInputTok = 0
        let totalOutputTok = 0

        for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
          const response = await openaiChatCompletion(
            {
              model: config.modelId,
              messages: agentMessages.map(m => {
                if (m.role === 'tool') return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || '' }
                if (m.role === 'assistant' && m.tool_calls) {
                  return {
                    role: 'assistant' as const,
                    content: m.content || null,
                    tool_calls: m.tool_calls.map(tc => ({
                      id: tc.id,
                      type: 'function' as const,
                      function: { name: tc.function.name, arguments: tc.function.arguments },
                    })),
                  }
                }
                return { role: m.role as 'system' | 'user' | 'assistant', content: m.content }
              }),
              max_tokens: Math.min(config.maxOutputTokens, 8192),
              tools: allAgentTools.length > 0 ? allAgentTools : undefined,
            },
            { modelKey: agent.config.model },
          )

          totalInputTok += response.usage?.prompt_tokens || 0
          totalOutputTok += response.usage?.completion_tokens || 0

          const choice = response.choices?.[0]
          if (!choice) break

          const assistantMsg = choice.message
          const toolCalls = assistantMsg.tool_calls

          if (!toolCalls || toolCalls.length === 0) {
            // No tool calls — final response
            agentOutput = assistantMsg.content || '(无输出)'
            break
          }

          // Has tool calls — execute them
          agentMessages.push({
            role: 'assistant',
            content: assistantMsg.content || '',
            tool_calls: toolCalls.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          })

          for (const tc of toolCalls) {
            try {
              const args = JSON.parse(tc.function.arguments || '{}')
              const result = await executeToolForLoop(tc.function.name, args)
              agentMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
              })
            } catch (err) {
              agentMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
              })
            }
          }

          // If last iteration, force a text response
          if (iteration === MAX_AGENT_ITERATIONS - 1) {
            agentOutput = assistantMsg.content || '(达到最大迭代次数)'
          }
        }

        if (!agentOutput) agentOutput = '(无输出)'

        const durationMs = Date.now() - startTime
        const cost = (totalInputTok / 1_000_000) * config.costPer1MInput +
                     (totalOutputTok / 1_000_000) * config.costPer1MOutput
        recordRequest(config.displayName, totalInputTok, totalOutputTok, cost, durationMs)

        // Update agent state
        agent.status = 'completed'
        agent.lastRun = new Date().toISOString()
        agent.history.unshift({
          id: runId,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          task: body.task.slice(0, 100),
          status: 'completed',
          durationMs,
          outputPreview: agentOutput.slice(0, 500),
        })
        if (agent.history.length > 20) agent.history.length = 20
        saveAgentStates(agentStates)

        return Response.json({
          id: runId,
          agentName,
          status: 'completed',
          output: agentOutput,
          durationMs,
          inputTokens: totalInputTok,
          outputTokens: totalOutputTok,
          cost,
        }, { headers: corsHeaders })

      } catch (err) {
        const durationMs = Date.now() - startTime
        const errorMsg = err instanceof Error ? err.message : String(err)

        agent.status = 'error'
        agent.lastRun = new Date().toISOString()
        agent.history.unshift({
          id: runId,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          task: body.task.slice(0, 100),
          status: 'error',
          durationMs,
          outputPreview: errorMsg.slice(0, 500),
        })
        if (agent.history.length > 20) agent.history.length = 20
        saveAgentStates(agentStates)

        return Response.json({
          id: runId,
          agentName,
          status: 'error',
          error: errorMsg,
          durationMs,
        }, { status: 500, headers: corsHeaders })
      }
    }

    // PUT /api/agents/:name/config — Save agent config
    const agentConfigMatch = path.match(/^\/api\/agents\/([^/]+)\/config$/)
    if (agentConfigMatch && method === 'PUT') {
      const agentName = decodeURIComponent(agentConfigMatch[1])
      const agent = agentStates[agentName]
      if (!agent) {
        return Response.json({ error: `代理不存在: ${agentName}` }, { status: 404, headers: corsHeaders })
      }

      const body = await req.json() as {
        model?: string
        tools?: string[]
        systemPrompt?: string
      }

      if (body.model) agent.config.model = body.model
      if (body.tools) agent.config.tools = body.tools
      if (body.systemPrompt !== undefined) agent.config.systemPrompt = body.systemPrompt

      saveAgentStates(agentStates)

      return Response.json({ ok: true, config: agent.config }, { headers: corsHeaders })
    }

    return Response.json(
      { error: 'Not Found' },
      { status: 404, headers: corsHeaders },
    )
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: corsHeaders },
    )
  }
}

// ─── Chat Handler (SSE Streaming) ───────────────────────

async function handleChat(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const body = await req.json() as {
    model: string
    message: string
    planMode?: boolean
    effortLevel?: string
    messages?: Array<{
      role: string
      content: string
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
      tool_call_id?: string
    }>
  }

  const modelKey = body.model
  const config = getOpenAIModelConfig(modelKey)
  if (!config) {
    return Response.json(
      { error: `未知模型: ${modelKey}` },
      { status: 400, headers: corsHeaders },
    )
  }

  const apiKey = getModelApiKey(config)
  if (!apiKey) {
    return Response.json(
      { error: `API Key 未配置，请设置环境变量 ${config.apiKeyEnvVar}` },
      { status: 400, headers: corsHeaders },
    )
  }

  // Build system prompt
  const modelDisplayName = config.displayName
  const modelProvider = config.provider
  let systemContent = [
    `你是 DolanClaw，一个面向开发者的 AI 编码助手。`,
    `你当前运行在 ${modelDisplayName} 模型上（由 ${modelProvider} 提供）。`,
    `你的工作目录是: ${workingDirectory}`,
    ``,
    `核心规则：`,
    `1. 当用户问你"你是什么模型"或"你用的什么模型"时，直接回答："我是 DolanClaw，当前使用 ${modelDisplayName} 模型。"`,
    `2. 绝对不要提及 Anthropic、OpenAI、Claude Code、claude.ts 或任何源码文件路径。`,
    `3. 绝对不要把自己描述为任何公司的产品或基于任何公司的技术。`,
    `4. 不要虚构自己的技术来源。如果不确定，就说"我是 DolanClaw，当前使用 ${modelDisplayName}。"`,
    `5. 使用与用户相同的语言回复。`,
    `6. 你是一个编程助手，专注于代码审查、调试、架构设计和编程问题解决。`,
    `7. 当需要执行操作时，请直接调用工具，不要输出代码块让用户手动执行。`,
    `8. 你可以调用多个工具来完成复杂任务。先调查（读取、搜索），再执行（编辑、写入、运行命令）。`,
    `9. 保持回复简洁。只输出最终结果和必要的解释，不要展示你的思考过程或推理路径，除非用户明确要求。`,
    `10. 不要重复用户的问题，不要输出冗余的"让我来..."、"好的我会..."等过渡语。直接给出答案或执行操作。`,
  ].join('\n')

  // Inject CLAUDE.md context if available
  const claudeMdPath = join(workingDirectory, 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    try {
      const claudeMd = readFileSync(claudeMdPath, 'utf-8')
      systemContent += `\n\n<project_context>\n${claudeMd}\n</project_context>`
    } catch { /* ignore */ }
  }

  // Plan mode: restrict to analysis only (no tools)
  if (body.planMode) {
    systemContent += '\n\n<mode>PLAN MODE: You are in read-only analysis mode. Do NOT execute tools or suggest code modifications. Only analyze, explain, and plan.</mode>'
  }

  // Effort level affects response depth
  if (body.effortLevel === 'low') {
    systemContent += '\n\n<effort>回复必须简短。不超过3句话。不要详细解释，不要列举，不要展开讨论。只给最核心的答案。</effort>'
  } else if (body.effortLevel === 'high') {
    systemContent += '\n\n<effort>提供全面、深入的分析。考虑边界情况、替代方案和影响。给出详细的代码示例和解释。</effort>'
  }

  // ── 技能注入 (Skills injection) ──
  // Scan .claude/skills/*.md and inject active auto-trigger skills into system prompt
  try {
    const skillDirs = [
      { dir: join(workingDirectory, '.claude', 'skills'), source: 'project' },
      { dir: join(process.env.HOME || '~', '.claude', 'skills'), source: 'user' },
    ]
    const disabledPath = join(process.env.HOME || '~', '.claude', 'disabled-skills.json')
    let disabledSet: Set<string> = new Set()
    if (existsSync(disabledPath)) {
      try { disabledSet = new Set(JSON.parse(readFileSync(disabledPath, 'utf-8'))) } catch {}
    }

    const skillContents: string[] = []
    for (const { dir } of skillDirs) {
      if (!existsSync(dir)) continue
      const files = readdirSync(dir).filter(f => f.endsWith('.md'))
      for (const f of files) {
        const filePath = join(dir, f)
        if (disabledSet.has(filePath)) continue
        const raw = readFileSync(filePath, 'utf-8')
        // Parse frontmatter
        const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
        let trigger = 'auto'
        let content = raw
        let name = f.replace(/\.md$/, '')
        if (fmMatch) {
          const fm = fmMatch[1]
          content = fmMatch[2]
          const trigMatch = fm.match(/trigger:\s*(.+)/)
          const nameMatch = fm.match(/name:\s*(.+)/)
          if (trigMatch) trigger = trigMatch[1].trim()
          if (nameMatch) name = nameMatch[1].trim()
        }
        if (trigger === 'auto') {
          skillContents.push(`<skill name="${name}">\n${content.trim()}\n</skill>`)
        }
      }
    }
    if (skillContents.length > 0) {
      systemContent += `\n\n<skills>\n${skillContents.join('\n')}\n</skills>`
    }
  } catch { /* ignore skill injection errors */ }

  // ── 斜杠命令识别 (Slash command recognition) ──
  let userMessage = body.message
  if (userMessage.startsWith('/')) {
    const cmdName = userMessage.slice(1).split(/\s/)[0]
    const cmdDirs = [
      join(workingDirectory, '.claude', 'commands'),
      join(process.env.HOME || '~', '.claude', 'commands'),
    ]
    for (const dir of cmdDirs) {
      const cmdPath = join(dir, `${cmdName}.md`)
      if (existsSync(cmdPath)) {
        const cmdContent = readFileSync(cmdPath, 'utf-8')
        // Replace the /command with the actual command content + any extra args
        const extraArgs = userMessage.slice(1 + cmdName.length).trim()
        userMessage = cmdContent + (extraArgs ? `\n\n额外指令: ${extraArgs}` : '')
        break
      }
    }
  }

  // Build initial conversation history (mutable — tool results are appended)
  const conversationMessages: OpenAIChatMessage[] = [
    { role: 'system', content: systemContent },
    ...(body.messages || []).map(m => {
      if (m.role === 'tool' && m.tool_call_id) {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.tool_call_id,
        }
      }
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }
      }
      return {
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }
    }),
    { role: 'user', content: userMessage },
  ]

  // Only pass tools if NOT in plan mode AND model supports tool_calls
  const useNativeTools = config.supportsToolCalls && !body.planMode

  // ── 动态合并 MCP 工具 ──
  const mcpTools: OpenAITool[] = mcpManager.getAllTools().map(t => ({
    type: 'function' as const,
    function: {
      name: t.fullName,
      description: `[MCP:${t.serverName}] ${t.description}`,
      parameters: t.inputSchema as OpenAITool['function']['parameters'],
    },
  }))
  const allToolDefinitions = [...TOOL_DEFINITIONS, ...mcpTools]

  const toolsForRequest = useNativeTools ? allToolDefinitions : undefined

  // For models without native tool_calls: inject tool definitions into system prompt
  const usePromptTools = !config.supportsToolCalls && !body.planMode
  if (usePromptTools) {
    const toolDescriptions = allToolDefinitions.map(t => {
      const f = t.function
      const params = Object.entries(f.parameters.properties || {})
        .map(([k, v]: [string, Record<string, unknown>]) => `  - ${k} (${v.type}${((f.parameters.required || []) as string[]).includes(k) ? ', 必需' : ''}): ${v.description}`)
        .join('\n')
      return `### ${f.name}\n${f.description}\n参数:\n${params}`
    }).join('\n\n')

    const toolPrompt = `
<available_tools>
你可以调用以下工具来完成任务。要调用工具，请使用 <tool_call> 标签：

<tool_call>
{"name": "工具名称", "input": {"参数名": "值"}}
</tool_call>

每次只调用一个工具，等待结果后再决定下一步。

${toolDescriptions}
</available_tools>`

    // Append to system message
    conversationMessages[0].content += toolPrompt
  }

  const startTime = Date.now()

  // Create SSE response with agentic tool loop
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch { /* controller may be closed */ }
      }

      let turnCount = 0

      try {
        // ═══════════════════════════════════════════════════════
        // AGENTIC TOOL LOOP — mirrors Claude Code's queryLoop
        // ═══════════════════════════════════════════════════════
        while (turnCount < MAX_TOOL_TURNS) {
          turnCount++

          // ── Step 1: Call LLM with tools ──────────────────
          let assistantContent = ''
          let toolCallsFromLLM: OpenAIToolCall[] = []
          let finishReason = ''

          if (config.supportsStreaming) {
            // ── Streaming mode ──
            const response = await openaiChatCompletionStream(
              {
                model: config.modelId,
                messages: conversationMessages,
                max_tokens: Math.min(config.maxOutputTokens, 8192),
                tools: toolsForRequest,
                tool_choice: toolsForRequest ? 'auto' : undefined,
              },
              { modelKey, signal: req.signal },
            )

            if (!response.ok) {
              const errorText = await response.text()
              send({ type: 'error', message: `API 错误 (${response.status}): ${errorText}` })
              break
            }

            const reader = response.body?.getReader()
            if (!reader) {
              send({ type: 'error', message: '无响应体' })
              break
            }

            // Parse the SSE stream, accumulating text and tool_calls
            const decoder = new TextDecoder()
            let sseBuffer = ''
            let totalOutputTokens = 0
            let totalInputTokens = 0
            let thinkBuffer = ''
            let insideThinking = false
            // Tool call accumulators: index → {id, name, args}
            const tcAccumulators = new Map<number, { id: string; name: string; args: string }>()

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              sseBuffer += decoder.decode(value, { stream: true })
              const lines = sseBuffer.split('\n')
              sseBuffer = lines.pop() || ''

              for (const line of lines) {
                const trimmed = line.trim()
                if (!trimmed.startsWith('data: ')) continue
                const data = trimmed.slice(6)
                if (data === '[DONE]') continue

                try {
                  const chunk = JSON.parse(data)
                  const choice = chunk.choices?.[0]
                  const delta = choice?.delta
                  if (!delta) continue

                  // Capture finish reason
                  if (choice.finish_reason) {
                    finishReason = choice.finish_reason
                  }

                  // Text content — filter out <think>...</think> and send as thinking events
                  if (delta.content) {
                    thinkBuffer += delta.content
                    while (thinkBuffer.length > 0) {
                      if (insideThinking) {
                        const closeIdx = thinkBuffer.indexOf('</think>')
                        if (closeIdx !== -1) {
                          // Send accumulated think content as thinking event
                          const thinkContent = thinkBuffer.slice(0, closeIdx)
                          if (thinkContent) {
                            send({ type: 'thinking', text: thinkContent })
                          }
                          thinkBuffer = thinkBuffer.slice(closeIdx + 8)
                          insideThinking = false
                        } else {
                          // Still inside thinking — send buffered content as thinking
                          if (thinkBuffer.length > 0) {
                            send({ type: 'thinking', text: thinkBuffer })
                          }
                          thinkBuffer = ''
                          break
                        }
                      } else {
                        const openIdx = thinkBuffer.indexOf('<think>')
                        if (openIdx !== -1) {
                          const before = thinkBuffer.slice(0, openIdx)
                          if (before) {
                            assistantContent += before
                            send({ type: 'text', text: before })
                          }
                          thinkBuffer = thinkBuffer.slice(openIdx + 7)
                          insideThinking = true
                        } else {
                          if (thinkBuffer.length > 7) {
                            const safe = thinkBuffer.slice(0, -7)
                            assistantContent += safe
                            send({ type: 'text', text: safe })
                            thinkBuffer = thinkBuffer.slice(-7)
                          }
                          break
                        }
                      }
                    }
                  }

                  // Handle reasoning_content (DeepSeek, QwQ, etc.)
                  if (delta.reasoning_content) {
                    send({ type: 'thinking', text: delta.reasoning_content })
                  }

                  // Accumulate tool calls from streaming deltas
                  if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                      const idx = tc.index ?? 0
                      let acc = tcAccumulators.get(idx)
                      if (!acc) {
                        acc = { id: tc.id || `call_${randomUUID()}`, name: '', args: '' }
                        tcAccumulators.set(idx, acc)
                      }
                      if (tc.id) acc.id = tc.id
                      if (tc.function?.name) acc.name += tc.function.name
                      if (tc.function?.arguments) acc.args += tc.function.arguments
                    }
                  }

                  // Usage
                  if (chunk.usage) {
                    totalInputTokens = chunk.usage.prompt_tokens || 0
                    totalOutputTokens = chunk.usage.completion_tokens || 0
                  }
                } catch { /* ignore parse errors */ }
              }
            }

            // Flush remaining text buffer
            if (thinkBuffer && !insideThinking) {
              assistantContent += thinkBuffer
              send({ type: 'text', text: thinkBuffer })
            }

            reader.releaseLock()

            // Record stats
            const latency = Date.now() - startTime
            const cost = (totalInputTokens / 1_000_000) * config.costPer1MInput +
                         (totalOutputTokens / 1_000_000) * config.costPer1MOutput
            recordRequest(config.displayName, totalInputTokens, totalOutputTokens, cost, latency)

            // Send cost event to frontend for context counter
            send({
              type: 'cost',
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              cost,
              latency,
            })

            // Collect accumulated tool calls
            for (const [, acc] of tcAccumulators) {
              if (acc.name) {
                toolCallsFromLLM.push({
                  id: acc.id,
                  type: 'function',
                  function: { name: acc.name, arguments: acc.args },
                })
              }
            }

          } else {
            // ── Non-streaming mode ──
            const response = await openaiChatCompletion(
              {
                model: config.modelId,
                messages: conversationMessages,
                max_tokens: Math.min(config.maxOutputTokens, 8192),
                tools: toolsForRequest,
                tool_choice: toolsForRequest ? 'auto' : undefined,
              },
              { modelKey },
            )

            const choice = response.choices?.[0]
            finishReason = choice?.finish_reason || 'stop'

            if (choice?.message?.content) {
              assistantContent = choice.message.content
              send({ type: 'text', text: assistantContent })
            }

            if (choice?.message?.tool_calls) {
              toolCallsFromLLM = choice.message.tool_calls
            }

            const latency = Date.now() - startTime
            const inputTok = response.usage?.prompt_tokens || 0
            const outputTok = response.usage?.completion_tokens || 0
            const cost = (inputTok / 1_000_000) * config.costPer1MInput +
                         (outputTok / 1_000_000) * config.costPer1MOutput
            recordRequest(config.displayName, inputTok, outputTok, cost, latency)
          }

          // ── Step 2: Check if LLM wants to call tools ──────
          // For prompt-based tools: parse <tool_call> from text content
          if (usePromptTools && assistantContent) {
            const toolCallRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g
            let match
            while ((match = toolCallRegex.exec(assistantContent)) !== null) {
              try {
                const parsed = JSON.parse(match[1])
                if (parsed.name) {
                  toolCallsFromLLM.push({
                    id: `call_${randomUUID()}`,
                    type: 'function',
                    function: {
                      name: parsed.name,
                      arguments: JSON.stringify(parsed.input || parsed.parameters || {}),
                    },
                  })
                }
              } catch { /* malformed JSON — skip */ }
            }
            // Strip <tool_call> blocks from visible content
            if (toolCallsFromLLM.length > 0) {
              assistantContent = assistantContent
                .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
                .trim()
            }
          }

          if (toolCallsFromLLM.length === 0) {
            // No tool calls — turn complete
            break
          }

          // Append assistant message to conversation history
          if (usePromptTools) {
            // For prompt-based tools: just add the assistant text (without tool_calls array)
            conversationMessages.push({
              role: 'assistant',
              content: assistantContent || '',
            })
          } else {
            // For native tool calls: include the tool_calls array
            const assistantMsg: OpenAIChatMessage = {
              role: 'assistant',
              content: assistantContent || null,
              tool_calls: toolCallsFromLLM,
            }
            conversationMessages.push(assistantMsg)
          }

          // ── Step 3: Execute each tool call ──────────────────
          const toolResults: string[] = []
          for (const tc of toolCallsFromLLM) {
            const toolName = tc.function.name
            let toolInput: Record<string, unknown> = {}
            try {
              toolInput = JSON.parse(tc.function.arguments || '{}')
            } catch {
              toolInput = { raw: tc.function.arguments }
            }

            // ── Permission check ──
            let allowed = true
            if (AUTO_ALLOW_TOOLS.has(toolName) || sessionAllowedTools.has(toolName)) {
              // Auto-allow: read-only or user said "always allow"
              allowed = true
            } else if (WRITE_TOOLS.has(toolName)) {
              // Write tool: ask user for permission via SSE + /api/chat/permission
              const permId = randomUUID()
              const permPromise = new Promise<'allow' | 'deny' | 'allow_all'>((resolve) => {
                pendingPermissions.set(permId, { resolve, toolName, toolInput: tc.function.arguments })
                // Auto-timeout after 120s → deny
                setTimeout(() => {
                  if (pendingPermissions.has(permId)) {
                    pendingPermissions.delete(permId)
                    resolve('deny')
                  }
                }, 120_000)
              })

              // Send permission request to frontend
              send({
                type: 'permission_request',
                id: permId,
                toolCallId: tc.id,
                name: toolName,
                input: tc.function.arguments,
                description: toolName === 'Bash'
                  ? (toolInput.command || tc.function.arguments)
                  : (toolInput.path || tc.function.arguments),
              })

              // Wait for user decision
              const decision = await permPromise
              pendingPermissions.delete(permId)

              if (decision === 'allow_all') {
                sessionAllowedTools.add(toolName)
                allowed = true
              } else if (decision === 'allow') {
                allowed = true
              } else {
                allowed = false
              }
            }

            // ── Execute or reject ──
            let toolResult: string
            if (!allowed) {
              toolResult = '用户拒绝了此操作'
              send({
                type: 'tool_done',
                id: tc.id,
                name: toolName,
                output: toolResult,
                status: 'rejected',
              })
            } else {
              // Send tool_start event
              send({
                type: 'tool_start',
                id: tc.id,
                name: toolName,
                input: tc.function.arguments,
                description: toolName === 'Bash'
                  ? (toolInput.command as string || '')
                  : (toolInput.path as string || toolName),
              })

              const toolStartTime = Date.now()
              toolResult = await executeToolForLoop(toolName, toolInput)
              const elapsed = Date.now() - toolStartTime

              // Send tool_done event
              send({
                type: 'tool_done',
                id: tc.id,
                name: toolName,
                output: toolResult.slice(0, 5000), // Cap output sent to frontend
                elapsed,
                status: 'done',
              })
            }

            // Append tool result to conversation
            if (usePromptTools) {
              // Prompt-based: collect results and append as a single user message
              toolResults.push(`<tool_result name="${toolName}">\n${toolResult.slice(0, 50000)}\n</tool_result>`)
            } else {
              // Native: append as role=tool with tool_call_id
              conversationMessages.push({
                role: 'tool',
                content: toolResult.slice(0, 50000), // Cap what goes back to LLM
                tool_call_id: tc.id,
              })
            }
          }

          // For prompt-based tools: append all results as a single user message
          if (usePromptTools && toolResults.length > 0) {
            conversationMessages.push({
              role: 'user',
              content: toolResults.join('\n\n'),
            })
          }

          // Loop back → LLM sees the tool results and continues
        } // end while(turnCount < MAX_TOOL_TURNS)

        if (turnCount >= MAX_TOOL_TURNS) {
          send({ type: 'text', text: '\n\n⚠️ 达到最大工具调用轮数限制，已停止。' })
        }

      } catch (err) {
        send({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ─── Tool Executor for Agentic Loop ─────────────────────
// Shared by handleChat's tool loop. Returns output string.
// ─── Tool Usage Stats ───────────────────────────────────
const toolUsageStats: Record<string, number> = {}

// PostToolUse hook runner
async function runPostToolHooks(
  hooks: { PostToolUse?: Array<{ matcher: string; command: string }> },
  toolName: string,
  input: Record<string, unknown>,
  result: string,
) {
  if (!hooks.PostToolUse) return
  for (const hook of hooks.PostToolUse) {
    if (hook.matcher === '*' || toolName.includes(hook.matcher)) {
      try {
        Bun.spawn(['bash', '-c', hook.command], {
          cwd: workingDirectory,
          env: {
            ...process.env,
            HOOK_TOOL_NAME: toolName,
            HOOK_TOOL_INPUT: JSON.stringify(input),
            HOOK_TOOL_OUTPUT: result.slice(0, 10000), // Limit env var size
          },
          stdout: 'ignore',
          stderr: 'ignore',
        })
      } catch (err) {
        console.error(`[Hook] PostToolUse error:`, err)
      }
    }
  }
}

async function executeToolForLoop(
  toolName: string,
  input: Record<string, unknown>,
): Promise<string> {
  // Track usage
  toolUsageStats[toolName] = (toolUsageStats[toolName] || 0) + 1

  // ── 钩子系统 (Hooks) ──
  // Load hooks from .claude/settings.json or .claude/hooks.json
  let hooks: {
    PreToolUse?: Array<{ matcher: string; command: string }>
    PostToolUse?: Array<{ matcher: string; command: string }>
  } = {}
  const hooksPaths = [
    join(workingDirectory, '.claude', 'hooks.json'),
    join(process.env.HOME || '~', '.claude', 'hooks.json'),
  ]
  for (const hp of hooksPaths) {
    if (existsSync(hp)) {
      try { hooks = JSON.parse(readFileSync(hp, 'utf-8')); break } catch {}
    }
  }

  // Execute PreToolUse hooks
  if (hooks.PreToolUse) {
    for (const hook of hooks.PreToolUse) {
      if (hook.matcher === '*' || toolName.includes(hook.matcher)) {
        try {
          const hookProc = Bun.spawn(['bash', '-c', hook.command], {
            cwd: workingDirectory,
            env: {
              ...process.env,
              HOOK_TOOL_NAME: toolName,
              HOOK_TOOL_INPUT: JSON.stringify(input),
            },
            stdout: 'pipe',
            stderr: 'pipe',
          })
          const exitCode = await hookProc.exited
          if (exitCode !== 0) {
            const stderr = await new Response(hookProc.stderr).text()
            return `[PreToolUse Hook 已拦截] ${hook.command}\n${stderr}`
          }
        } catch (err) {
          console.error(`[Hook] PreToolUse error:`, err)
        }
      }
    }
  }

  try {
    // ── MCP 工具路由 ──
    if (McpManager.isMcpTool(toolName)) {
      const result = await mcpManager.callTool(toolName, input)
      await runPostToolHooks(hooks, toolName, input, result)
      return result
    }

    switch (toolName) {
      case 'Bash': {
        const command = (input.command || '') as string
        const timeout = (input.timeout || 30_000) as number
        const cwd = workingDirectory
        const proc = Bun.spawn(['bash', '-c', command], {
          cwd,
          stdout: 'pipe',
          stderr: 'pipe',
          env: process.env,
        })
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          try { proc.kill() } catch {}
        }, timeout)
        try {
          const exitCode = await proc.exited
          clearTimeout(timer)
          if (timedOut) {
            return `[错误] 命令执行超时 (${timeout / 1000}s)\n命令: ${command}`
          }
          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()
          let output = stdout
          if (stderr) output += `\n[stderr]\n${stderr}`
          if (exitCode !== 0) output += `\n[exit code: ${exitCode}]`
          // Truncate very long output to prevent context overflow
          if (output.length > 50000) {
            output = output.slice(0, 25000) + `\n\n... [输出被截断, 总长 ${output.length} 字符] ...\n\n` + output.slice(-25000)
          }
          const result = output || '(no output)'
          await runPostToolHooks(hooks, toolName, input, result)
          return result
        } catch (err) {
          clearTimeout(timer)
          return `[错误] ${err instanceof Error ? err.message : String(err)}`
        }
      }

      case 'FileRead': {
        const filePath = resolve(workingDirectory, (input.path || '') as string)
        if (!existsSync(filePath)) return `Error: File not found: ${filePath}`
        const stat = statSync(filePath)
        if (stat.size > 2 * 1024 * 1024) return `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB)`
        const result = readFileSync(filePath, 'utf-8')
        await runPostToolHooks(hooks, toolName, input, result)
        return result
      }

      case 'FileEdit': {
        const filePath = resolve(workingDirectory, (input.path || '') as string)
        const oldStr = (input.old_string || '') as string
        const newStr = (input.new_string || '') as string
        if (!existsSync(filePath)) return `Error: File not found: ${filePath}`
        const content = readFileSync(filePath, 'utf-8')
        if (!content.includes(oldStr)) return `Error: Target string not found in file`
        const newContent = content.replace(oldStr, newStr)
        writeFileSync(filePath, newContent, 'utf-8')
        const result = `Successfully edited ${filePath}`
        await runPostToolHooks(hooks, toolName, input, result)
        return result
      }

      case 'FileWrite': {
        const filePath = resolve(workingDirectory, (input.path || '') as string)
        const content = (input.content || '') as string
        // Ensure parent directory exists
        const dir = join(filePath, '..')
        if (!existsSync(dir)) {
          Bun.spawnSync(['mkdir', '-p', dir])
        }
        writeFileSync(filePath, content, 'utf-8')
        const result = `Successfully wrote ${filePath} (${content.length} bytes)`
        await runPostToolHooks(hooks, toolName, input, result)
        return result
      }

      case 'Grep': {
        const pattern = (input.pattern || '') as string
        const searchPath = resolve(workingDirectory, (input.path || '.') as string)
        const proc = Bun.spawn(
          ['grep', '-rn', '--color=never', '-I', '--include=*.{ts,tsx,js,jsx,json,md,css,html,py,go,rs,java,c,h,cpp,yaml,yml,toml,sh}', pattern, searchPath],
          { stdout: 'pipe', stderr: 'pipe' },
        )
        await proc.exited
        const output = await new Response(proc.stdout).text()
        return output.trim() || 'No matches found'
      }

      case 'Glob': {
        const pattern = (input.pattern || '') as string
        const searchPath = (input.path || '.') as string
        const proc = Bun.spawn(
          ['find', resolve(workingDirectory, searchPath), '-name', pattern, '-type', 'f', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'],
          { stdout: 'pipe', stderr: 'pipe' },
        )
        await proc.exited
        const output = await new Response(proc.stdout).text()
        return output.trim() || 'No files found matching pattern'
      }

      case 'ListFiles': {
        const dirPath = resolve(workingDirectory, (input.path || '.') as string)
        if (!existsSync(dirPath)) return `Error: Directory not found: ${dirPath}`
        const entries = readdirSync(dirPath)
        const resultLines: string[] = []
        for (const entry of entries.slice(0, 200)) {
          try {
            const fullPath = join(dirPath, entry)
            const stat = statSync(fullPath)
            const type = stat.isDirectory() ? 'dir' : 'file'
            const size = stat.isDirectory() ? '' : ` (${stat.size} bytes)`
            resultLines.push(`${type === 'dir' ? '📁' : '📄'} ${entry}${size}`)
          } catch { resultLines.push(`? ${entry}`) }
        }
        if (entries.length > 200) resultLines.push(`... and ${entries.length - 200} more`)
        return resultLines.join('\n') || '(empty directory)'
      }

      default:
        return `Error: Unknown tool: ${toolName}`
    }
  } catch (err) {
    return `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ─── File Tree Builder ──────────────────────────────────

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: FileNode[]
  extension?: string
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  '.cache', '.turbo', '__pycache__', '.venv', 'venv',
  'coverage', '.nyc_output', '.svn', '.hg',
])

function buildFileTree(dirPath: string, maxDepth: number, depth = 0): FileNode[] {
  if (depth >= maxDepth) return []

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    const nodes: FileNode[] = []

    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of sorted) {
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue
      if (IGNORED_DIRS.has(entry.name)) continue

      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children: buildFileTree(fullPath, maxDepth, depth + 1),
        })
      } else {
        try {
          const stat = statSync(fullPath)
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            size: stat.size,
            extension: extname(entry.name).slice(1),
          })
        } catch {
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
          })
        }
      }
    }

    return nodes
  } catch {
    return []
  }
}

// ─── File Extension to Language ─────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
  toml: 'toml', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  sql: 'sql', graphql: 'graphql', proto: 'proto',
  swift: 'swift', kt: 'kotlin', dart: 'dart', lua: 'lua',
  vim: 'vim', dockerfile: 'dockerfile', makefile: 'makefile',
}

// ─── Static File Server ─────────────────────────────────

function serveStaticFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null
  try {
    const content = readFileSync(filePath)
    const ext = extname(filePath)
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    })
  } catch {
    return null
  }
}

// ─── Main Server ────────────────────────────────────────

export function startWebServer(port: number = DEFAULT_PORT) {
  // Determine static files directory
  const webDistDir = join(import.meta.dir, '../../web/dist')
  const webSrcDir = join(import.meta.dir, '../../web')
  const staticDir = existsSync(webDistDir) ? webDistDir : null

  console.log(`
  ╔═══════════════════════════════════════╗
  ║       🤖 DolanClaude Web Server       ║
  ╠═══════════════════════════════════════╣
  ║  地址:  http://localhost:${port}         ║
  ║  状态:  就绪                          ║
  ╚═══════════════════════════════════════╝
  `)

  if (!staticDir) {
    console.log('  ⚠️  Web UI 未构建。前端开发服务器请运行:')
    console.log('     cd web && npm run dev')
    console.log('  API 服务器已启动，可接受 /api/* 请求\n')
  }

  const server = Bun.serve({
    port,
    idleTimeout: 120, // Prevent SSE timeout during long tool executions
    async fetch(req) {
      const url = new URL(req.url)

      // API routes
      if (url.pathname.startsWith('/api/')) {
        return handleApiRequest(req, url)
      }

      // Static files (production build)
      if (staticDir) {
        let filePath = join(staticDir, url.pathname)
        if (url.pathname === '/' || !extname(url.pathname)) {
          filePath = join(staticDir, 'index.html')
        }
        const response = serveStaticFile(filePath)
        if (response) return response
        // SPA fallback
        const indexResponse = serveStaticFile(join(staticDir, 'index.html'))
        if (indexResponse) return indexResponse
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  // Store server reference for restart capability
  serverInstance = server

  console.log(`  服务器运行中: http://localhost:${server.port}\n`)
  return server
}

// ─── CLI Entry Point ────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2)
  let port = DEFAULT_PORT

  const portIdx = args.indexOf('--port')
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10)
  }

  startWebServer(port)
}
