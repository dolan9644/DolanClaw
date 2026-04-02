/**
 * McpManager — DolanClaw 的 MCP (Model Context Protocol) 客户端管理器
 *
 * 负责：
 *  1. 管理 MCP 服务器子进程（spawn / kill / reconnect）
 *  2. JSON-RPC 2.0 over stdio 通信
 *  3. MCP 协议握手（initialize → initialized → tools/list）
 *  4. 工具发现与缓存
 *  5. 工具调用转发
 *
 * 工具名格式：mcp__{serverName}__{toolName}
 */

import { spawn, type Subprocess } from 'bun'
import { EventEmitter } from 'events'

// ─── 类型定义 ────────────────────────────────────────

export interface McpServerConfig {
  /** 服务器名称（唯一标识） */
  name: string
  /** 启动命令 */
  command: string
  /** 命令参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 作用域 */
  scope: 'project' | 'user'
  /** 传输类型 */
  type: 'stdio' // 后续扩展 'sse' | 'http'
}

export interface McpToolDef {
  /** 完整工具名: mcp__{server}__{tool} */
  fullName: string
  /** 原始工具名 */
  name: string
  /** 所属服务器 */
  serverName: string
  /** 工具描述 */
  description: string
  /** 参数 JSON Schema */
  inputSchema: Record<string, unknown>
}

export interface McpServerStatus {
  name: string
  config: McpServerConfig
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: McpToolDef[]
  error?: string
  pid?: number
  latency?: number
}

// JSON-RPC 2.0 相关类型
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

// 内部连接状态
interface McpConnection {
  config: McpServerConfig
  process: Subprocess | null
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: McpToolDef[]
  error?: string
  rpcId: number
  pendingRequests: Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>
  buffer: string
  reconnectAttempts: number
  maxReconnectAttempts: number
}

// ─── McpManager 单例 ─────────────────────────────────

export class McpManager extends EventEmitter {
  private connections: Map<string, McpConnection> = new Map()
  private static instance: McpManager | null = null

  private constructor() {
    super()
  }

  static getInstance(): McpManager {
    if (!McpManager.instance) {
      McpManager.instance = new McpManager()
    }
    return McpManager.instance
  }

  // ─── 连接管理 ──────────────────────────────────────

  /**
   * 连接一个 stdio MCP 服务器
   */
  async connect(config: McpServerConfig): Promise<void> {
    const { name } = config

    // 如果已连接，先断开
    if (this.connections.has(name)) {
      await this.disconnect(name)
    }

    const conn: McpConnection = {
      config,
      process: null,
      status: 'connecting',
      tools: [],
      rpcId: 1,
      pendingRequests: new Map(),
      buffer: '',
      reconnectAttempts: 0,
      maxReconnectAttempts: 3,
    }
    this.connections.set(name, conn)
    this.emit('status', name, 'connecting')

    try {
      await this.spawnAndHandshake(conn)
    } catch (err) {
      conn.status = 'error'
      conn.error = err instanceof Error ? err.message : String(err)
      this.emit('status', name, 'error', conn.error)
      throw err
    }
  }

  /**
   * 启动子进程并完成 MCP 握手
   */
  private async spawnAndHandshake(conn: McpConnection): Promise<void> {
    const { config } = conn
    const startTime = Date.now()

    // 解析命令 — 处理 npx
    let command = config.command
    let args = config.args || []

    // 启动子进程
    const proc = spawn({
      cmd: [command, ...args],
      env: { ...process.env, ...config.env },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    conn.process = proc

    // 监听 stdout（JSON-RPC 响应）
    this.readStdout(conn)

    // 监听 stderr（日志）
    this.readStderr(conn)

    // 监听退出
    proc.exited.then((code) => {
      console.log(`[MCP] ${config.name} 退出, code=${code}`)
      if (conn.status === 'connected') {
        // 意外退出，尝试重连
        conn.status = 'disconnected'
        conn.process = null
        this.emit('status', config.name, 'disconnected')
        this.maybeReconnect(conn)
      }
    })

    // ── MCP 握手 ──

    // Step 1: initialize
    const initResult = await this.sendRequest(conn, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'DolanClaw',
        version: '1.0.0',
      },
    }) as { capabilities?: Record<string, unknown>; serverInfo?: { name: string; version: string } }

    console.log(`[MCP] ${config.name} initialized:`, initResult?.serverInfo)

    // Step 2: initialized 通知
    this.sendNotification(conn, 'notifications/initialized', {})

    // Step 3: tools/list
    const toolsResult = await this.sendRequest(conn, 'tools/list', {}) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
    }

    const tools = (toolsResult?.tools || []).map(t => ({
      fullName: `mcp__${config.name}__${t.name}`,
      name: t.name,
      serverName: config.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }))

    conn.tools = tools
    conn.status = 'connected'
    conn.reconnectAttempts = 0

    const latency = Date.now() - startTime
    this.emit('status', config.name, 'connected', undefined, latency)

    console.log(`[MCP] ${config.name} 已连接, ${tools.length} 个工具, ${latency}ms`)
  }

  /**
   * 持续读取子进程 stdout，解析 JSON-RPC 消息
   */
  private async readStdout(conn: McpConnection): Promise<void> {
    const proc = conn.process
    if (!proc?.stdout) return

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        conn.buffer += decoder.decode(value, { stream: true })

        // 尝试解析完整的 JSON-RPC 消息（换行分隔）
        let newlineIdx: number
        while ((newlineIdx = conn.buffer.indexOf('\n')) !== -1) {
          const line = conn.buffer.slice(0, newlineIdx).trim()
          conn.buffer = conn.buffer.slice(newlineIdx + 1)

          if (!line) continue

          try {
            const msg = JSON.parse(line)
            this.handleMessage(conn, msg)
          } catch {
            // 不是有效 JSON，可能是日志输出，忽略
          }
        }
      }
    } catch {
      // 读取结束
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 读取 stderr（MCP 服务器日志）
   */
  private async readStderr(conn: McpConnection): Promise<void> {
    const proc = conn.process
    if (!proc?.stderr) return

    const reader = proc.stderr.getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        // 只在 debug 时输出
        if (process.env.DEBUG_MCP) {
          console.log(`[MCP:${conn.config.name}:stderr]`, text.trim())
        }
      }
    } catch {
      // 读取结束
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * 处理收到的 JSON-RPC 消息
   */
  private handleMessage(conn: McpConnection, msg: JsonRpcResponse | JsonRpcNotification): void {
    // 响应消息（有 id）
    if ('id' in msg && msg.id != null) {
      const pending = conn.pendingRequests.get(msg.id)
      if (pending) {
        conn.pendingRequests.delete(msg.id)
        clearTimeout(pending.timer)

        if ('error' in msg && msg.error) {
          pending.reject(new Error(`MCP 错误 [${msg.error.code}]: ${msg.error.message}`))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // 通知消息（无 id）— 日志等
    if ('method' in msg) {
      this.emit('notification', conn.config.name, msg.method, msg.params)
    }
  }

  // ─── JSON-RPC 通信 ────────────────────────────────

  /**
   * 发送 JSON-RPC 请求并等待响应
   */
  private sendRequest(conn: McpConnection, method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!conn.process?.stdin) {
        reject(new Error('MCP 服务器未启动'))
        return
      }

      const id = conn.rpcId++
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      // 超时 30 秒
      const timer = setTimeout(() => {
        conn.pendingRequests.delete(id)
        reject(new Error(`MCP 请求超时: ${method} (30s)`))
      }, 30_000)

      conn.pendingRequests.set(id, { resolve, reject, timer })

      try {
        const msg = JSON.stringify(request) + '\n'
        conn.process.stdin.write(msg)
        conn.process.stdin.flush()
      } catch (err) {
        conn.pendingRequests.delete(id)
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /**
   * 发送 JSON-RPC 通知（无需响应）
   */
  private sendNotification(conn: McpConnection, method: string, params: Record<string, unknown>): void {
    if (!conn.process?.stdin) return

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    try {
      const msg = JSON.stringify(notification) + '\n'
      conn.process.stdin.write(msg)
      conn.process.stdin.flush()
    } catch {
      // 忽略写入错误
    }
  }

  // ─── 工具调用 ──────────────────────────────────────

  /**
   * 调用 MCP 工具
   * @param fullToolName 格式: mcp__{server}__{tool}
   * @param args 工具参数
   */
  async callTool(fullToolName: string, args: Record<string, unknown>): Promise<string> {
    const parts = fullToolName.split('__')
    if (parts.length < 3 || parts[0] !== 'mcp') {
      throw new Error(`无效的 MCP 工具名: ${fullToolName}`)
    }

    const serverName = parts[1]
    const toolName = parts.slice(2).join('__') // 处理工具名中可能的 __

    const conn = this.connections.get(serverName)
    if (!conn) {
      throw new Error(`MCP 服务器未找到: ${serverName}`)
    }
    if (conn.status !== 'connected') {
      throw new Error(`MCP 服务器未连接: ${serverName} (${conn.status})`)
    }

    const result = await this.sendRequest(conn, 'tools/call', {
      name: toolName,
      arguments: args,
    }) as { content?: Array<{ type: string; text?: string }>; isError?: boolean }

    // 提取文本内容
    if (result?.content) {
      return result.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text || '')
        .join('\n')
    }

    return JSON.stringify(result)
  }

  // ─── 断开 / 重启 / 重连 ────────────────────────────

  /**
   * 断开 MCP 服务器
   */
  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (!conn) return

    // 清理 pending requests
    for (const [id, pending] of conn.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('连接已关闭'))
      conn.pendingRequests.delete(id)
    }

    // 杀掉子进程
    if (conn.process) {
      try {
        conn.process.kill()
      } catch {
        // 进程可能已退出
      }
      conn.process = null
    }

    conn.status = 'disconnected'
    conn.tools = []
    this.emit('status', name, 'disconnected')
    this.connections.delete(name)

    console.log(`[MCP] ${name} 已断开`)
  }

  /**
   * 重启 MCP 服务器
   */
  async restart(name: string): Promise<void> {
    const conn = this.connections.get(name)
    if (!conn) throw new Error(`MCP 服务器不存在: ${name}`)

    const config = { ...conn.config }
    await this.disconnect(name)
    await this.connect(config)
  }

  /**
   * 意外断开时尝试重连
   */
  private async maybeReconnect(conn: McpConnection): Promise<void> {
    if (conn.reconnectAttempts >= conn.maxReconnectAttempts) {
      console.log(`[MCP] ${conn.config.name} 达到最大重连次数，放弃`)
      conn.status = 'error'
      conn.error = '多次重连失败'
      this.emit('status', conn.config.name, 'error', conn.error)
      return
    }

    conn.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, conn.reconnectAttempts), 10_000)
    console.log(`[MCP] ${conn.config.name} 将在 ${delay}ms 后重连 (第 ${conn.reconnectAttempts} 次)`)

    await new Promise(r => setTimeout(r, delay))

    if (conn.status === 'disconnected') {
      try {
        await this.spawnAndHandshake(conn)
      } catch (err) {
        console.error(`[MCP] ${conn.config.name} 重连失败:`, err)
        this.maybeReconnect(conn)
      }
    }
  }

  // ─── 查询接口 ──────────────────────────────────────

  /**
   * 获取所有已连接服务器的工具列表
   */
  getAllTools(): McpToolDef[] {
    const tools: McpToolDef[] = []
    for (const conn of this.connections.values()) {
      if (conn.status === 'connected') {
        tools.push(...conn.tools)
      }
    }
    return tools
  }

  /**
   * 获取所有服务器的状态
   */
  getAllStatuses(): McpServerStatus[] {
    return Array.from(this.connections.values()).map(conn => ({
      name: conn.config.name,
      config: conn.config,
      status: conn.status,
      tools: conn.tools,
      error: conn.error,
      pid: conn.process?.pid,
    }))
  }

  /**
   * 获取某个服务器的状态
   */
  getStatus(name: string): McpServerStatus | null {
    const conn = this.connections.get(name)
    if (!conn) return null
    return {
      name: conn.config.name,
      config: conn.config,
      status: conn.status,
      tools: conn.tools,
      error: conn.error,
      pid: conn.process?.pid,
    }
  }

  /**
   * 检查工具名是否是 MCP 工具
   */
  static isMcpTool(toolName: string): boolean {
    return toolName.startsWith('mcp__')
  }

  /**
   * 优雅关闭所有连接
   */
  async shutdownAll(): Promise<void> {
    const names = Array.from(this.connections.keys())
    await Promise.all(names.map(n => this.disconnect(n)))
    console.log('[MCP] 所有服务器已关闭')
  }
}
