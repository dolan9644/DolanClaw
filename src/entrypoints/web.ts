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
import { join, extname, basename, relative } from 'path'
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

// ─── Config ─────────────────────────────────────────────
const DEFAULT_PORT = 3000

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
  const { resolve } = require('path') as typeof import('path')
  const normalizedResolved = resolve(filePath)
  return normalizedResolved.startsWith(process.cwd())
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

    // POST /api/chat — Streaming chat
    if (path === '/api/chat' && method === 'POST') {
      return handleChat(req, corsHeaders)
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

    // GET /api/stats — Session stats
    if (path === '/api/stats' && method === 'GET') {
      // Get real code changes from git
      let codeChanges = { added: 0, removed: 0 }
      try {
        const gitProc = Bun.spawnSync(['git', 'diff', '--numstat'], { cwd: process.cwd() })
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

    // GET /api/tools — List available tools
    if (path === '/api/tools' && method === 'GET') {
      return Response.json([
        { name: 'BashTool', category: 'exec', description: '执行终端命令', icon: '⚡', permission: 'ask', usageCount: 0 },
        { name: 'FileEditTool', category: 'file', description: '编辑文件', icon: '✏️', permission: 'ask', usageCount: 0 },
        { name: 'FileWriteTool', category: 'file', description: '写入文件', icon: '📝', permission: 'ask', usageCount: 0 },
        { name: 'FileReadTool', category: 'file', description: '读取文件', icon: '📖', permission: 'auto', usageCount: 0 },
        { name: 'GlobTool', category: 'search', description: '文件匹配搜索', icon: '🔎', permission: 'auto', usageCount: 0 },
        { name: 'GrepTool', category: 'search', description: '文本正则搜索', icon: '🔍', permission: 'auto', usageCount: 0 },
        { name: 'ListFilesTool', category: 'search', description: '列出目录结构', icon: '📁', permission: 'auto', usageCount: 0 },
        { name: 'AgentTool', category: 'agent', description: '子代理任务', icon: '🤖', permission: 'auto', usageCount: 0 },
        { name: 'WebFetchTool', category: 'web', description: '抓取网页内容', icon: '🌐', permission: 'ask', usageCount: 0 },
        { name: 'WebSearchTool', category: 'web', description: '搜索互联网', icon: '🔍', permission: 'auto', usageCount: 0 },
        { name: 'NotebookEditTool', category: 'file', description: '编辑 Notebook', icon: '📓', permission: 'ask', usageCount: 0 },
        { name: 'TodoWriteTool', category: 'agent', description: '任务管理', icon: '✅', permission: 'auto', usageCount: 0 },
        { name: 'MCPTool', category: 'agent', description: 'MCP 服务器工具', icon: '🔌', permission: 'auto', usageCount: 0 },
      ], { headers: corsHeaders })
    }

    // ─── File System APIs ────────────────────────────

    // GET /api/files/tree?path=... — List directory tree
    if (path === '/api/files/tree' && method === 'GET') {
      const dirPath = url.searchParams.get('path') || process.cwd()
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
      try {
        const proc = Bun.spawn(['bash', '-c', body.command], {
          cwd: body.cwd || process.cwd(),
          stdout: 'pipe',
          stderr: 'pipe',
          env: process.env,
        })

        const timeout = body.timeout || 30_000
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => {
            proc.kill()
            reject(new Error(`Command timed out after ${timeout}ms`))
          }, timeout),
        )

        const exitCode = await Promise.race([proc.exited, timeoutPromise])
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()

        return Response.json({
          exitCode,
          stdout,
          stderr,
          command: body.command,
        }, { headers: corsHeaders })
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500, headers: corsHeaders },
        )
      }
    }

    // ─── MCP Servers API ────────────────────────────────

    // GET /api/mcp — List MCP server configs from .mcp.json + global settings
    if (path === '/api/mcp' && method === 'GET') {
      const cwd = process.cwd()
      const servers: Array<{
        name: string
        url: string
        type: string
        status: 'connected' | 'disconnected' | 'error'
        scope: 'project' | 'user'
        tools: Array<{ name: string; description: string }>
        resources: number
      }> = []

      // Read project-level .mcp.json
      const mcpJsonPath = join(cwd, '.mcp.json')
      if (existsSync(mcpJsonPath)) {
        try {
          const raw = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'))
          const mcpServers = raw.mcpServers || {}
          for (const [name, config] of Object.entries(mcpServers)) {
            const cfg = config as Record<string, unknown>
            const type = (cfg.type as string) || 'stdio'
            let url = ''
            if (type === 'stdio') {
              url = `stdio://${cfg.command}${(cfg.args as string[])?.length ? ' ' + (cfg.args as string[]).join(' ') : ''}`
            } else if ('url' in cfg) {
              url = cfg.url as string
            }
            servers.push({
              name,
              url,
              type,
              status: 'disconnected', // Not connected yet
              scope: 'project',
              tools: [],
              resources: 0,
            })
          }
        } catch { /* ignore parse errors */ }
      }

      // Read global ~/.claude/settings.json mcpServers
      const globalSettingsPath = join(process.env.HOME || '~', '.claude', 'settings.json')
      if (existsSync(globalSettingsPath)) {
        try {
          const raw = JSON.parse(readFileSync(globalSettingsPath, 'utf-8'))
          const mcpServers = raw.mcpServers || {}
          for (const [name, config] of Object.entries(mcpServers)) {
            // Skip if already defined in project scope
            if (servers.some(s => s.name === name)) continue
            const cfg = config as Record<string, unknown>
            const type = (cfg.type as string) || 'stdio'
            let url = ''
            if (type === 'stdio') {
              url = `stdio://${cfg.command}${(cfg.args as string[])?.length ? ' ' + (cfg.args as string[]).join(' ') : ''}`
            } else if ('url' in cfg) {
              url = cfg.url as string
            }
            servers.push({
              name,
              url,
              type,
              status: 'disconnected',
              scope: 'user',
              tools: [],
              resources: 0,
            })
          }
        } catch { /* ignore parse errors */ }
      }

      return Response.json({
        servers,
        totalCount: servers.length,
        projectConfigPath: mcpJsonPath,
        projectConfigExists: existsSync(mcpJsonPath),
      }, { headers: corsHeaders })
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
      const projectSettingsPath = join(process.cwd(), '.claude', 'settings.json')
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
      const cwd = url.searchParams.get('cwd') || process.cwd()
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
      const cwd = process.cwd()
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
      const cwd = process.cwd()
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
            const cwd = (body.input.cwd || process.cwd()) as string
            const timeout = (body.input.timeout || 30_000) as number

            const proc = Bun.spawn(['bash', '-c', command], {
              cwd,
              stdout: 'pipe',
              stderr: 'pipe',
              env: process.env,
            })

            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => {
                proc.kill()
                reject(new Error(`Command timed out after ${timeout}ms`))
              }, timeout),
            )

            const exitCode = await Promise.race([proc.exited, timeoutPromise])
            const stdout = await new Response(proc.stdout).text()
            const stderr = await new Response(proc.stderr).text()
            result = {
              output: stdout + (stderr ? `\n[stderr]\n${stderr}` : ''),
              exitCode: exitCode as number,
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
            const searchPath = (body.input.path || process.cwd()) as string
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
            const searchPath = (body.input.path || process.cwd()) as string
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
    messages?: Array<{ role: string; content: string }>
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

  // Build system prompt — tell the model who it is and which model powers it
  const modelDisplayName = config.displayName
  const modelProvider = config.provider
  let systemContent = [
    `你是 DolanClaw，一个面向开发者的 AI 编码助手。`,
    `你当前运行在 ${modelDisplayName} 模型上（由 ${modelProvider} 提供）。`,
    ``,
    `核心规则：`,
    `1. 当用户问你"你是什么模型"或"你用的什么模型"时，直接回答："我是 DolanClaw，当前使用 ${modelDisplayName} 模型。"`,
    `2. 绝对不要提及 Anthropic、OpenAI、Claude Code、claude.ts 或任何源码文件路径。`,
    `3. 绝对不要把自己描述为任何公司的产品或基于任何公司的技术。`,
    `4. 不要虚构自己的技术来源。如果不确定，就说"我是 DolanClaw，当前使用 ${modelDisplayName}。"`,
    `5. 使用与用户相同的语言回复。`,
    `6. 你是一个编程助手，专注于代码审查、调试、架构设计和编程问题解决。`,
  ].join('\n')

  // Inject CLAUDE.md context if available
  const claudeMdPath = join(process.cwd(), 'CLAUDE.md')
  if (existsSync(claudeMdPath)) {
    try {
      const claudeMd = readFileSync(claudeMdPath, 'utf-8')
      systemContent += `\n\n<project_context>\n${claudeMd}\n</project_context>`
    } catch { /* ignore */ }
  }

  // Plan mode: restrict to analysis only
  if (body.planMode) {
    systemContent += '\n\n<mode>PLAN MODE: You are in read-only analysis mode. Do NOT suggest code modifications or tool executions. Only analyze, explain, and plan. Describe what changes WOULD be needed without making them.</mode>'
  }

  // Effort level affects response depth
  if (body.effortLevel === 'low') {
    systemContent += '\n\n<effort>Respond concisely. Keep answers brief and to the point.</effort>'
  } else if (body.effortLevel === 'high') {
    systemContent += '\n\n<effort>Provide thorough, detailed analysis. Consider edge cases, alternatives, and implications.</effort>'
  }

  // Build conversation history
  const messages = [
    { role: 'system' as const, content: systemContent },
    ...(body.messages || []).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: body.message },
  ]

  const startTime = Date.now()

  // Create SSE response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        // Build OpenAI request
        const openaiMessages = messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }))

        if (config.supportsStreaming) {
          // Streaming mode
          const response = await openaiChatCompletionStream(
            {
              model: config.modelId,
              messages: openaiMessages,
              max_tokens: Math.min(config.maxOutputTokens, 8192),
            },
            { modelKey, signal: req.signal },
          )

          if (!response.ok) {
            const errorText = await response.text()
            send({
              type: 'error',
              message: `API 错误 (${response.status}): ${errorText}`,
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          }

          const reader = response.body?.getReader()
          if (!reader) {
            send({ type: 'error', message: '无响应体' })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
            return
          }

          const decoder = new TextDecoder()
          let sseBuffer = ''
          let totalOutputTokens = 0
          let totalInputTokens = 0
          let thinkBuffer = ''
          let insideThinking = false

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
                const delta = chunk.choices?.[0]?.delta
                if (!delta) continue

                // Text content — filter out <think>...</think> reasoning blocks
                if (delta.content) {
                  thinkBuffer += delta.content

                  // Process the buffer to strip thinking blocks
                  while (thinkBuffer.length > 0) {
                    if (insideThinking) {
                      const closeIdx = thinkBuffer.indexOf('</think>')
                      if (closeIdx !== -1) {
                        // Found close tag — skip everything up to and including it
                        thinkBuffer = thinkBuffer.slice(closeIdx + 8)
                        insideThinking = false
                      } else {
                        // Still inside thinking, consume all and wait for more
                        thinkBuffer = ''
                        break
                      }
                    } else {
                      const openIdx = thinkBuffer.indexOf('<think>')
                      if (openIdx !== -1) {
                        // Send everything before the <think> tag
                        const before = thinkBuffer.slice(0, openIdx)
                        if (before) send({ type: 'text', text: before })
                        thinkBuffer = thinkBuffer.slice(openIdx + 7)
                        insideThinking = true
                      } else {
                        // No thinking tag — but might be a partial match at the end
                        // Keep last 7 chars in case '<think>' is split across chunks
                        if (thinkBuffer.length > 7) {
                          const safe = thinkBuffer.slice(0, -7)
                          send({ type: 'text', text: safe })
                          thinkBuffer = thinkBuffer.slice(-7)
                        }
                        break
                      }
                    }
                  }
                }

                // Tool calls
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    if (tc.id) {
                      send({
                        type: 'tool_start',
                        id: tc.id,
                        name: tc.function?.name || 'unknown',
                        input: tc.function?.arguments || '',
                      })
                    }
                  }
                }

                // Usage
                if (chunk.usage) {
                  totalInputTokens = chunk.usage.prompt_tokens || 0
                  totalOutputTokens = chunk.usage.completion_tokens || 0
                }
              } catch {
                // Ignore parse errors in stream
              }
            }
          }

          // Flush any remaining buffered text (not inside a thinking block)
          if (thinkBuffer && !insideThinking) {
            send({ type: 'text', text: thinkBuffer })
          }

          reader.releaseLock()

          const latency = Date.now() - startTime
          const cost = (totalInputTokens / 1_000_000) * config.costPer1MInput +
                       (totalOutputTokens / 1_000_000) * config.costPer1MOutput
          recordRequest(config.displayName, totalInputTokens, totalOutputTokens, cost, latency)

        } else {
          // Non-streaming mode
          const response = await openaiChatCompletion(
            {
              model: config.modelId,
              messages: openaiMessages,
              max_tokens: Math.min(config.maxOutputTokens, 8192),
            },
            { modelKey },
          )

          const choice = response.choices?.[0]
          if (choice?.message?.content) {
            send({ type: 'text', text: choice.message.content })
          }

          const latency = Date.now() - startTime
          const inputTok = response.usage?.prompt_tokens || 0
          const outputTok = response.usage?.completion_tokens || 0
          const cost = (inputTok / 1_000_000) * config.costPer1MInput +
                       (outputTok / 1_000_000) * config.costPer1MOutput
          recordRequest(config.displayName, inputTok, outputTok, cost, latency)
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
