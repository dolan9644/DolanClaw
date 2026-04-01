import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'

// ─── Types ──────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls?: ToolCall[]
  timestamp: number
  costInfo?: { input: number; output: number; cost: number; latency: number }
}

interface ToolCall {
  id: string
  name: string
  input: string
  output?: string
  status: 'queued' | 'running' | 'done' | 'error' | 'rejected'
  description?: string
  filePath?: string
  diff?: DiffHunk[]
  elapsedMs?: number
  isExpanded: boolean
}

interface DiffHunk {
  type: 'add' | 'remove' | 'context'
  content: string
}

interface ChatPageProps {
  currentModel: string
  onOpenFile: (title: string, content: string, language?: string) => void
}

// ─── Tool Metadata ──────────────────────────────────────

const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  BashTool:        { icon: '⚡', label: 'Bash',       color: '#f59e0b' },
  Bash:            { icon: '⚡', label: 'Bash',       color: '#f59e0b' },
  SandboxedBash:   { icon: '🔒', label: 'Sandbox',    color: '#f59e0b' },
  FileEditTool:    { icon: '✏️', label: 'Edit',        color: '#3b82f6' },
  FileWriteTool:   { icon: '📝', label: 'Write',       color: '#3b82f6' },
  FileReadTool:    { icon: '📖', label: 'Read',        color: '#8b5cf6' },
  GlobTool:        { icon: '🔎', label: 'Glob',        color: '#8b5cf6' },
  GrepTool:        { icon: '🔍', label: 'Grep',        color: '#8b5cf6' },
  ListFilesTool:   { icon: '📁', label: 'List',        color: '#8b5cf6' },
  SearchTool:      { icon: '🔍', label: 'Search',      color: '#8b5cf6' },
  WebSearchTool:   { icon: '🌐', label: 'Web Search',  color: '#06b6d4' },
  WebFetchTool:    { icon: '🌐', label: 'Web Fetch',   color: '#06b6d4' },
  WebBrowserTool:  { icon: '🌐', label: 'Browser',     color: '#06b6d4' },
  AgentTool:       { icon: '🤖', label: 'Agent',       color: '#10b981' },
  MCPTool:         { icon: '🔌', label: 'MCP',         color: '#10b981' },
  TodoWriteTool:   { icon: '✅', label: 'Todo',        color: '#10b981' },
  NotebookEditTool:{ icon: '📓', label: 'Notebook',    color: '#f472b6' },
}

function getToolMeta(name: string) {
  return TOOL_META[name] || { icon: '🔧', label: name, color: '#6b7280' }
}

// ─── Slash Commands ─────────────────────────────────────

const SLASH_COMMANDS = [
  { name: '/compact',     desc: '压缩上下文，释放 token', icon: '📦' },
  { name: '/clear',       desc: '清空当前对话',           icon: '🗑️' },
  { name: '/cost',        desc: '查看当前会话费用',       icon: '💰' },
  { name: '/model',       desc: '切换模型',               icon: '🤖' },
  { name: '/help',        desc: '查看所有可用命令',       icon: '❓' },
  { name: '/diff',        desc: '查看本次会话的所有变更', icon: '📊' },
  { name: '/config',      desc: '查看/修改配置',          icon: '⚙️' },
  { name: '/permissions', desc: '管理工具权限',           icon: '🔐' },
  { name: '/review',      desc: '代码审查',               icon: '👀' },
  { name: '/init',        desc: '初始化 CLAUDE.md',       icon: '📋' },
  { name: '/memory',      desc: '管理 Memory 文件',       icon: '🧠' },
  { name: '/doctor',      desc: '诊断环境问题',           icon: '🏥' },
  { name: '/plan',        desc: '进入/退出计划模式',      icon: '📐' },
  { name: '/resume',      desc: '恢复上一次会话',         icon: '🔄' },
  { name: '/session',     desc: '会话管理',               icon: '📂' },
  { name: '/mcp',         desc: 'MCP 服务器管理',         icon: '🔌' },
  { name: '/export',      desc: '导出对话记录',           icon: '📤' },
  { name: '/vim',         desc: '切换 Vim 模式',          icon: '⌨️' },
  { name: '/theme',       desc: '切换主题',               icon: '🎨' },
  { name: '/files',       desc: '查看已读取的文件',       icon: '📑' },
  { name: '/run',         desc: '直接执行 Shell 命令',    icon: '⚡' },
]

// ─── Code Block with Copy ───────────────────────────────

function CodeBlockWithCopy({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="msg-code-block">
      <div className="msg-code-header">
        <span className="msg-code-lang">{lang || 'code'}</span>
        <button className="msg-code-copy" onClick={handleCopy} title="复制代码">
          {copied ? '✓ 已复制' : '📋 复制'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

// ─── Typing Indicator ───────────────────────────────────

function TypingIndicator() {
  return (
    <div className="typing-indicator">
      <span className="typing-dot" style={{ animationDelay: '0ms' }} />
      <span className="typing-dot" style={{ animationDelay: '150ms' }} />
      <span className="typing-dot" style={{ animationDelay: '300ms' }} />
    </div>
  )
}

// ─── Time Formatter ─────────────────────────────────────

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

// ─── Markdown-like Renderer ─────────────────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let codeBlock = false
  let codeLines: string[] = []
  let codeLang = ''
  let codeKey = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block toggle
    if (line.startsWith('```')) {
      if (!codeBlock) {
        codeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
      } else {
        elements.push(
          <CodeBlockWithCopy key={`code-${codeKey++}`} lang={codeLang} code={codeLines.join('\n')} />
        )
        codeBlock = false
      }
      continue
    }

    if (codeBlock) {
      codeLines.push(line)
      continue
    }

    // H1-H3
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="msg-h3">{line.slice(4)}</h4>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="msg-h2">{line.slice(3)}</h3>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="msg-h1">{line.slice(2)}</h2>)
    }
    // Bullet list
    else if (/^[-*]\s/.test(line)) {
      elements.push(
        <div key={i} className="msg-list-item">
          <span className="msg-bullet">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line)) {
      const num = line.match(/^(\d+)\./)?.[1] || '1'
      const rest = line.replace(/^\d+\.\s/, '')
      elements.push(
        <div key={i} className="msg-list-item">
          <span className="msg-num">{num}.</span>
          <span>{renderInline(rest)}</span>
        </div>
      )
    }
    // Empty line → spacing
    else if (line.trim() === '') {
      elements.push(<div key={i} className="msg-spacer" />)
    }
    // Regular paragraph
    else {
      elements.push(<p key={i} className="msg-p">{renderInline(line)}</p>)
    }
  }

  // Unclosed code block
  if (codeBlock && codeLines.length > 0) {
    elements.push(
      <CodeBlockWithCopy key={`code-${codeKey}`} lang={codeLang} code={codeLines.join('\n')} />
    )
  }

  return elements
}

function renderInline(text: string): (string | React.ReactNode)[] {
  // Handle **bold**, `code`, *italic*
  const parts: (string | React.ReactNode)[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const m = match[0]
    if (m.startsWith('**')) {
      parts.push(<strong key={match.index}>{m.slice(2, -2)}</strong>)
    } else if (m.startsWith('`')) {
      parts.push(<code key={match.index} className="msg-inline-code">{m.slice(1, -1)}</code>)
    } else if (m.startsWith('*')) {
      parts.push(<em key={match.index}>{m.slice(1, -1)}</em>)
    }
    lastIndex = match.index + m.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

// ─── Permission Dialog ──────────────────────────────────

function PermissionDialog({ toolCall, onAllow, onDeny, onAllowAll }: {
  toolCall: ToolCall
  onAllow: () => void
  onDeny: () => void
  onAllowAll: () => void
}) {
  const meta = getToolMeta(toolCall.name)
  return (
    <div className="permission-dialog animate-slide-up">
      <div className="permission-header">
        <span className="permission-icon">{meta.icon}</span>
        <span className="permission-title">{meta.label}</span>
        <span className="permission-badge">需要权限</span>
      </div>
      <div className="permission-body">
        <div className="permission-command">
          {toolCall.description || toolCall.input}
        </div>
        {toolCall.filePath && (
          <div className="permission-path">📁 {toolCall.filePath}</div>
        )}
      </div>
      <div className="permission-actions">
        <button className="permission-btn deny" onClick={onDeny}>
          拒绝
        </button>
        <button className="permission-btn allow" onClick={onAllow}>
          允许
        </button>
        <button className="permission-btn allow-all" onClick={onAllowAll}>
          始终允许
        </button>
      </div>
    </div>
  )
}

// ─── Diff Viewer ────────────────────────────────────────

function DiffViewer({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <div className="diff-viewer">
      {hunks.map((h, i) => (
        <div
          key={i}
          className={`diff-line diff-${h.type}`}
        >
          <span className="diff-indicator">
            {h.type === 'add' ? '+' : h.type === 'remove' ? '-' : ' '}
          </span>
          <span className="diff-content">{h.content}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Tool Call Component ────────────────────────────────

function ToolCallBlock({ tc, onOpenFile }: {
  tc: ToolCall
  onOpenFile: (title: string, content: string, language?: string) => void
}) {
  const [expanded, setExpanded] = useState(tc.isExpanded)
  const meta = getToolMeta(tc.name)

  const statusLabel = {
    queued: '排队中',
    running: '执行中',
    done: '完成',
    error: '错误',
    rejected: '已拒绝',
  }[tc.status]

  const statusIcon = {
    queued: '⏳',
    running: '',
    done: '✓',
    error: '✕',
    rejected: '⛔',
  }[tc.status]

  // Determine display text
  let displayText = tc.description || ''
  if (!displayText) {
    if (tc.name === 'BashTool' || tc.name === 'Bash') {
      displayText = tc.input
    } else if (tc.filePath) {
      displayText = tc.filePath
    } else {
      displayText = tc.input?.slice(0, 120) || tc.name
    }
  }

  const elapsedStr = tc.elapsedMs
    ? tc.elapsedMs > 1000
      ? `${(tc.elapsedMs / 1000).toFixed(1)}s`
      : `${tc.elapsedMs}ms`
    : null

  return (
    <div className={`tool-block tool-status-${tc.status}`}>
      <div
        className="tool-block-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="tool-block-left">
          <span className="tool-block-icon" style={{ color: meta.color }}>
            {meta.icon}
          </span>
          <span className="tool-block-name" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="tool-block-desc">{displayText}</span>
        </div>
        <div className="tool-block-right">
          {elapsedStr && (
            <span className="tool-block-elapsed">{elapsedStr}</span>
          )}
          <span className={`tool-block-status status-${tc.status}`}>
            {tc.status === 'running' && <span className="spinner-small" />}
            {statusIcon} {statusLabel}
          </span>
          <span className="tool-block-chevron">
            {expanded ? '▾' : '▸'}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="tool-block-body animate-slide-down">
          {/* Command/Input */}
          {tc.input && (tc.name === 'BashTool' || tc.name === 'Bash') && (
            <div className="tool-cmd">
              <span className="tool-cmd-prompt">$</span>
              <code>{tc.input}</code>
            </div>
          )}
          {tc.input && tc.name !== 'BashTool' && tc.name !== 'Bash' && (
            <div className="tool-input-block">
              <pre>{tc.input}</pre>
            </div>
          )}

          {/* Diff */}
          {tc.diff && tc.diff.length > 0 && (
            <DiffViewer hunks={tc.diff} />
          )}

          {/* Output */}
          {tc.output && (
            <div
              className="tool-output"
              onClick={() => onOpenFile(
                `${meta.label} Output`,
                tc.output!,
                tc.name === 'BashTool' || tc.name === 'Bash' ? 'shell' : undefined
              )}
            >
              <pre>{tc.output.slice(0, 2000)}</pre>
              {tc.output.length > 2000 && (
                <div className="tool-output-more">
                  点击在侧边栏查看完整输出 ({(tc.output.length / 1024).toFixed(1)} KB)
                </div>
              )}
            </div>
          )}

          {/* No output message for silent commands */}
          {tc.status === 'done' && !tc.output && !tc.diff && (
            <div className="tool-no-output">✓ 完成 (无输出)</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Context Bar ────────────────────────────────────────

function ContextBar({ messages, currentModel }: {
  messages: Message[]
  currentModel: string
}) {
  const totalTokens = messages.reduce((sum, m) => {
    return sum + (m.costInfo?.input || 0) + (m.costInfo?.output || 0)
  }, 0)
  const totalCost = messages.reduce((sum, m) => sum + (m.costInfo?.cost || 0), 0)
  const contextUsagePercent = Math.min(totalTokens / 200000 * 100, 100)

  return (
    <div className="context-bar">
      <div className="context-bar-item">
        <span className="context-bar-label">模型</span>
        <span className="context-bar-value">{currentModel}</span>
      </div>
      <div className="context-bar-divider" />
      <div className="context-bar-item">
        <span className="context-bar-label">上下文</span>
        <div className="context-bar-progress">
          <div
            className="context-bar-progress-fill"
            style={{
              width: `${contextUsagePercent}%`,
              background: contextUsagePercent > 80 ? '#ef4444' : contextUsagePercent > 50 ? '#f59e0b' : '#10b981'
            }}
          />
        </div>
        <span className="context-bar-value">
          {totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens}
        </span>
      </div>
      <div className="context-bar-divider" />
      <div className="context-bar-item">
        <span className="context-bar-label">费用</span>
        <span className="context-bar-value">¥{totalCost.toFixed(4)}</span>
      </div>
    </div>
  )
}

// ─── Main Chat Page ─────────────────────────────────────

export function ChatPage({ currentModel, onOpenFile }: ChatPageProps) {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = localStorage.getItem('dolanclaw-messages')
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return []
  })
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [thinking, setThinking] = useState('')
  const [isThinkingVisible, setIsThinkingVisible] = useState(true)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIdx, setSlashSelectedIdx] = useState(0)
  const [pendingPermission, setPendingPermission] = useState<ToolCall | null>(null)
  const [interruptable, setInterruptable] = useState(false)
  const [planMode, setPlanMode] = useState(false)
  const [effortLevel, setEffortLevel] = useState<'low' | 'medium' | 'high'>('high')
  const [allowedTools, setAllowedTools] = useState<Set<string>>(new Set())
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  // @ file reference
  const [showAtMenu, setShowAtMenu] = useState(false)
  const [atFilter, setAtFilter] = useState('')
  const [atFiles, setAtFiles] = useState<string[]>([])
  const [atSelectedIdx, setAtSelectedIdx] = useState(0)
  const [atCursorPos, setAtCursorPos] = useState(0)

  // Edit user message
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Persist messages to localStorage
  useEffect(() => {
    try {
      // Only save last 100 messages to avoid quota issues
      const toSave = messages.slice(-100)
      localStorage.setItem('dolanclaw-messages', JSON.stringify(toSave))
    } catch { /* ignore quota errors */ }
  }, [messages])

  // Scroll detection for scroll-to-bottom button
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 120)
    }
    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [messages.length > 0])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])
  const handleDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const names = files.map(f => f.name).join(', ')
      setInput(prev => prev + (prev ? '\n' : '') + `[附加文件: ${names}]`)
      inputRef.current?.focus()
    }
  }, [])

  // ─── Permission Handlers ──────────────────────────────

  const executeToolCall = useCallback(async (tc: ToolCall) => {
    // Parse input if it's a JSON string
    let inputObj: Record<string, unknown> = {}
    try {
      inputObj = typeof tc.input === 'string' ? JSON.parse(tc.input) : tc.input as unknown as Record<string, unknown>
    } catch {
      // If not JSON, treat as command/content
      if (tc.name === 'BashTool' || tc.name === 'Bash') {
        inputObj = { command: tc.input }
      } else {
        inputObj = { content: tc.input }
      }
    }

    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolId: tc.id,
          toolName: tc.name,
          input: inputObj,
        }),
      })
      const result = await res.json()

      // Update the tool call in messages
      setMessages(prev => prev.map(msg => {
        if (!msg.toolCalls) return msg
        const updatedTCs = msg.toolCalls.map(t => {
          if (t.id !== tc.id) return t
          return {
            ...t,
            status: result.error ? 'error' as const : 'done' as const,
            output: result.error || result.output,
            elapsedMs: result.elapsed,
            isExpanded: true,
          }
        })
        return { ...msg, toolCalls: updatedTCs }
      }))
    } catch (err) {
      setMessages(prev => prev.map(msg => {
        if (!msg.toolCalls) return msg
        const updatedTCs = msg.toolCalls.map(t => {
          if (t.id !== tc.id) return t
          return {
            ...t,
            status: 'error' as const,
            output: err instanceof Error ? err.message : String(err),
            isExpanded: true,
          }
        })
        return { ...msg, toolCalls: updatedTCs }
      }))
    }
  }, [])

  const handlePermissionAllow = useCallback(async () => {
    if (!pendingPermission) return
    const tc = pendingPermission
    setPendingPermission(null)

    // Mark as running
    setMessages(prev => prev.map(msg => {
      if (!msg.toolCalls) return msg
      return {
        ...msg,
        toolCalls: msg.toolCalls.map(t =>
          t.id === tc.id ? { ...t, status: 'running' as const } : t
        ),
      }
    }))

    await executeToolCall(tc)
  }, [pendingPermission, executeToolCall])

  const handlePermissionDeny = useCallback(() => {
    if (!pendingPermission) return
    const tc = pendingPermission
    setPendingPermission(null)

    setMessages(prev => prev.map(msg => {
      if (!msg.toolCalls) return msg
      return {
        ...msg,
        toolCalls: msg.toolCalls.map(t =>
          t.id === tc.id ? { ...t, status: 'rejected' as const, output: '用户拒绝了此操作' } : t
        ),
      }
    }))
  }, [pendingPermission])

  const handlePermissionAllowAll = useCallback(async () => {
    if (!pendingPermission) return
    const tc = pendingPermission
    setAllowedTools(prev => new Set(prev).add(tc.name))
    setPendingPermission(null)

    setMessages(prev => prev.map(msg => {
      if (!msg.toolCalls) return msg
      return {
        ...msg,
        toolCalls: msg.toolCalls.map(t =>
          t.id === tc.id ? { ...t, status: 'running' as const } : t
        ),
      }
    }))

    await executeToolCall(tc)
  }, [pendingPermission, executeToolCall])

  // Filtered slash commands
  const filteredSlash = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(
      c => c.name.includes(slashFilter) || c.desc.includes(slashFilter)
    )
  }, [slashFilter])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)

    // Textarea height
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'

    // Slash command detection
    if (val.startsWith('/')) {
      setShowSlashMenu(true)
      setSlashFilter(val)
      setSlashSelectedIdx(0)
    } else {
      setShowSlashMenu(false)
    }

    // @ file reference detection
    const cursorPos = e.target.selectionStart || 0
    const textBeforeCursor = val.slice(0, cursorPos)
    const atMatch = textBeforeCursor.match(/@([\w./\-]*)$/)
    if (atMatch) {
      setShowAtMenu(true)
      setAtFilter(atMatch[1])
      setAtCursorPos(cursorPos - atMatch[0].length) // position of @
      setAtSelectedIdx(0)
      // Fetch files if not yet loaded
      if (atFiles.length === 0) {
        fetch('/api/files/tree').then(r => r.ok ? r.json() : []).then(data => {
          const extractFiles = (items: any[]): string[] => {
            const result: string[] = []
            for (const item of (items || [])) {
              if (typeof item === 'string') { result.push(item) }
              else if (item.name || item.path) { result.push(item.path || item.name) }
              if (item.children) { result.push(...extractFiles(item.children)) }
            }
            return result
          }
          setAtFiles(extractFiles(Array.isArray(data) ? data : data.children || [data]).filter(Boolean))
        }).catch(() => {})
      }
    } else {
      setShowAtMenu(false)
    }
  }

  // Handle slash command selection
  const selectSlashCommand = (cmd: typeof SLASH_COMMANDS[0]) => {
    setShowSlashMenu(false)
    setSlashFilter('')

    // Execute local commands
    if (cmd.name === '/clear') {
      setMessages([])
      setThinking('')
      setInput('')
      localStorage.removeItem('dolanclaw-messages')
      return
    }
    if (cmd.name === '/cost') {
      const totalCost = messages.reduce((sum, m) => sum + (m.costInfo?.cost || 0), 0)
      const totalInput = messages.reduce((sum, m) => sum + (m.costInfo?.input || 0), 0)
      const totalOutput = messages.reduce((sum, m) => sum + (m.costInfo?.output || 0), 0)
      addSystemMessage(
        `💰 **会话费用报告**\n\n` +
        `- 输入 Tokens: ${totalInput.toLocaleString()}\n` +
        `- 输出 Tokens: ${totalOutput.toLocaleString()}\n` +
        `- 总费用: ¥${totalCost.toFixed(4)}\n` +
        `- 请求次数: ${messages.filter(m => m.role === 'assistant').length}`
      )
      setInput('')
      return
    }
    if (cmd.name === '/help') {
      addSystemMessage(
        `❓ **可用命令**\n\n` +
        SLASH_COMMANDS.map(c => `- \`${c.name}\` — ${c.desc}`).join('\n')
      )
      setInput('')
      return
    }
    if (cmd.name === '/plan') {
      setPlanMode(prev => !prev)
      addSystemMessage(planMode ? '📐 计划模式已**关闭**' : '📐 计划模式已**开启** — 只分析不执行')
      setInput('')
      return
    }
    if (cmd.name === '/compact') {
      const msgCount = messages.length
      if (msgCount <= 2) {
        addSystemMessage('📦 对话太短，无需压缩')
        setInput('')
        return
      }
      // Compact: keep system msgs + last 4 messages, summarize rest
      const toKeep = messages.slice(-4)
      const compacted = messages.slice(0, -4)
      const summary = compacted.map(m => {
        if (m.role === 'user') return `用户: ${m.content.slice(0, 80)}`
        if (m.role === 'assistant') {
          const toolCount = m.toolCalls?.length || 0
          return `助手: ${m.content.slice(0, 80)}${toolCount ? ` [${toolCount} 工具调用]` : ''}`
        }
        return `系统: ${m.content.slice(0, 60)}`
      }).join('\n')
      const compactMsg: Message = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `📦 **上下文已压缩** — ${compacted.length} 条消息被摘要\n\n\`\`\`\n${summary}\n\`\`\``,
        timestamp: Date.now(),
      }
      setMessages([compactMsg, ...toKeep])
      addSystemMessage(`📦 压缩完成: ${msgCount} → ${toKeep.length + 1} 条消息`)
      setInput('')
      return
    }

    // /run command — direct bash execution
    if (cmd.name === '/run') {
      setInput('/run ')
      inputRef.current?.focus()
      return
    }

    // Other commands are sent as prompts
    setInput(cmd.name + ' ')
    inputRef.current?.focus()
  }

  const addSystemMessage = (content: string) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: 'system',
      content,
      timestamp: Date.now(),
    }])
  }

  // ─── @ File Reference ──────────────────────────────

  const filteredAtFiles = useMemo(() => {
    if (!atFilter) return atFiles.slice(0, 15)
    const lower = atFilter.toLowerCase()
    return atFiles.filter(f => f.toLowerCase().includes(lower)).slice(0, 15)
  }, [atFilter, atFiles])

  const selectAtFile = useCallback((file: string) => {
    // Replace @partial with @file
    const before = input.slice(0, atCursorPos)
    const cursorEnd = atCursorPos + 1 + atFilter.length // @ + filter text
    const after = input.slice(cursorEnd)
    setInput(before + '@' + file + ' ' + after)
    setShowAtMenu(false)
    setAtFilter('')
    inputRef.current?.focus()
  }, [input, atCursorPos, atFilter])

  // ─── Edit User Message ─────────────────────────────

  const handleEditStart = useCallback((msg: Message) => {
    setEditingMsgId(msg.id)
    setEditingContent(msg.content)
  }, [])

  const handleEditCancel = useCallback(() => {
    setEditingMsgId(null)
    setEditingContent('')
  }, [])

  const handleEditSave = useCallback((msgId: string) => {
    if (!editingContent.trim()) return
    // Find the message index and remove everything after it
    const idx = messages.findIndex(m => m.id === msgId)
    if (idx === -1) return
    const updated = messages.slice(0, idx)
    updated.push({
      ...messages[idx],
      content: editingContent.trim(),
    })
    setMessages(updated)
    setEditingMsgId(null)
    setEditingContent('')
    // Re-send the edited message
    setInput(editingContent.trim())
    setTimeout(() => {
      const sendBtn = document.querySelector('.chat-send-btn') as HTMLButtonElement
      sendBtn?.click()
    }, 100)
  }, [editingContent, messages])

  // ─── Interrupt ──────────────────────────────────────

  const handleInterrupt = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      setIsStreaming(false)
      setInterruptable(false)
      addSystemMessage('⚠️ 已中断当前操作')
    }
  }

  // ─── Main Send Handler ────────────────────────────────

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    // Check for slash command
    if (text.startsWith('/')) {
      // /run <command> — direct bash execution
      if (text.startsWith('/run ')) {
        const command = text.slice(5).trim()
        if (!command) return
        setInput('')
        const tcId = crypto.randomUUID()
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: Date.now(),
        }
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          toolCalls: [{
            id: tcId,
            name: 'BashTool',
            input: command,
            status: 'running',
            isExpanded: true,
          }],
        }
        setMessages(prev => [...prev, userMsg, assistantMsg])

        // Execute
        try {
          const res = await fetch('/api/tools/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toolId: tcId,
              toolName: 'BashTool',
              input: { command },
            }),
          })
          const result = await res.json()
          setMessages(prev => prev.map(msg => {
            if (!msg.toolCalls) return msg
            return {
              ...msg,
              toolCalls: msg.toolCalls.map(t =>
                t.id === tcId
                  ? { ...t, status: result.error ? 'error' as const : 'done' as const, output: result.error || result.output, elapsedMs: result.elapsed, isExpanded: true }
                  : t
              ),
            }
          }))
        } catch (err) {
          setMessages(prev => prev.map(msg => {
            if (!msg.toolCalls) return msg
            return {
              ...msg,
              toolCalls: msg.toolCalls.map(t =>
                t.id === tcId
                  ? { ...t, status: 'error' as const, output: err instanceof Error ? err.message : String(err) }
                  : t
              ),
            }
          }))
        }
        return
      }

      // /diff — show git diff inline
      if (text === '/diff') {
        setInput('')
        addSystemMessage('📊 正在获取变更...')
        try {
          const res = await fetch('/api/diff')
          if (res.ok) {
            const data = await res.json()
            if (data.diff && data.diff.trim()) {
              const lines = data.diff.split('\n').length
              addSystemMessage(
                `📊 **当前变更** (${data.stats?.filesChanged || '?'} 文件, +${data.stats?.additions || '?'} -${data.stats?.deletions || '?'})\n\n\`\`\`diff\n${data.diff.slice(0, 5000)}\n\`\`\`${data.diff.length > 5000 ? `\n\n*...输出已截断 (${lines} 行)*` : ''}`
              )
            } else {
              addSystemMessage('📊 当前没有未提交的变更')
            }
          } else {
            addSystemMessage('📊 无法获取 diff — 后端未连接')
          }
        } catch {
          addSystemMessage('📊 无法获取 diff — 后端未连接')
        }
        return
      }

      // /export — download conversation as JSON
      if (text === '/export') {
        setInput('')
        const exportData = {
          exportedAt: new Date().toISOString(),
          messageCount: messages.length,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
            toolCalls: m.toolCalls?.map(tc => ({
              name: tc.name,
              input: tc.input,
              output: tc.output,
              status: tc.status,
            })),
            costInfo: m.costInfo,
          })),
        }
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `dolanclaw-export-${new Date().toISOString().split('T')[0]}.json`
        a.click()
        URL.revokeObjectURL(url)
        addSystemMessage(`📤 对话已导出 (${messages.length} 条消息)`)
        return
      }

      const matched = SLASH_COMMANDS.find(c => text.startsWith(c.name))
      if (matched) {
        selectSlashCommand(matched)
        return
      }
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsStreaming(true)
    setThinking('')
    setInterruptable(true)
    setShowSlashMenu(false)

    // Reset textarea
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: currentModel,
          message: text,
          planMode,
          effortLevel,
          messages: messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let assistantContent = ''
      const toolCalls: ToolCall[] = []
      const startTime = Date.now()

      const updateAssistantMessage = (costInfo?: Message['costInfo']) => {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: assistantContent,
                toolCalls: [...toolCalls],
                ...(costInfo ? { costInfo } : {}),
              },
            ]
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: assistantContent,
              toolCalls: [...toolCalls],
              timestamp: Date.now(),
              ...(costInfo ? { costInfo } : {}),
            },
          ]
        })
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') {
            // Final cost info
            const elapsed = Date.now() - startTime
            updateAssistantMessage({ input: 0, output: 0, cost: 0, latency: elapsed })
            continue
          }

          try {
            const event = JSON.parse(data)

            switch (event.type) {
              case 'thinking':
                setThinking(prev => prev + event.text)
                break

              case 'text':
                assistantContent += event.text
                updateAssistantMessage()
                break

              case 'tool_start':
                toolCalls.push({
                  id: event.id,
                  name: event.name,
                  input: event.input || '',
                  description: event.description || '',
                  filePath: event.filePath || '',
                  status: 'running',
                  isExpanded: true,
                })
                updateAssistantMessage()
                break

              case 'tool_progress':
                {
                  const tc = toolCalls.find(t => t.id === event.id)
                  if (tc) {
                    if (event.output) tc.output = event.output
                    if (event.elapsed) tc.elapsedMs = event.elapsed
                  }
                  updateAssistantMessage()
                }
                break

              case 'tool_done':
                {
                  const tc = toolCalls.find(t => t.id === event.id)
                  if (tc) {
                    tc.status = 'done'
                    tc.isExpanded = false
                    if (event.output) tc.output = event.output
                    if (event.diff) tc.diff = event.diff
                    if (event.elapsed) tc.elapsedMs = event.elapsed
                  }
                  updateAssistantMessage()
                }
                break

              case 'tool_error':
                {
                  const tc = toolCalls.find(t => t.id === event.id)
                  if (tc) {
                    tc.status = 'error'
                    tc.output = event.error || event.output
                  }
                  updateAssistantMessage()
                }
                break

              case 'permission_request':
                {
                  const newTc: ToolCall = {
                    id: event.id,
                    name: event.name,
                    input: event.input || '',
                    description: event.description || '',
                    filePath: event.filePath || '',
                    status: 'queued',
                    isExpanded: true,
                  }
                  // Add to tool calls for rendering
                  toolCalls.push(newTc)
                  updateAssistantMessage()

                  // Check if already allowed
                  if (allowedTools.has(event.name)) {
                    // Auto-execute
                    newTc.status = 'running'
                    updateAssistantMessage()
                    executeToolCall(newTc)
                  } else {
                    setPendingPermission(newTc)
                  }
                }
                break

              case 'cost':
                updateAssistantMessage({
                  input: event.inputTokens || 0,
                  output: event.outputTokens || 0,
                  cost: event.cost || 0,
                  latency: event.latency || (Date.now() - startTime),
                })
                break

              case 'error':
                assistantContent += `\n\n❌ 错误: ${event.message}`
                updateAssistantMessage()
                break
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User interrupted
      } else {
        const simMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            `⚠️ **后端服务未连接**\n\n` +
            `请运行 \`bun run src/entrypoints/web.ts\` 启动后端服务。\n\n` +
            `当前模型: **${currentModel}**\n\n` +
            `错误: \`${err instanceof Error ? err.message : String(err)}\``,
          timestamp: Date.now(),
        }
        setMessages(prev => [...prev, simMsg])
      }
    } finally {
      setIsStreaming(false)
      setInterruptable(false)
      abortRef.current = null
    }
  }

  // ─── Key Handling ─────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Slash menu navigation
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelectedIdx(prev =>
          Math.min(prev + 1, filteredSlash.length - 1)
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelectedIdx(prev => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filteredSlash[slashSelectedIdx]) {
          selectSlashCommand(filteredSlash[slashSelectedIdx])
        }
        return
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false)
        return
      }
    }

    // Ctrl+C to interrupt
    if (e.key === 'c' && e.ctrlKey && isStreaming) {
      e.preventDefault()
      handleInterrupt()
      return
    }

    // Enter to send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div className="chat-page" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* Toolbar — always visible */}
      <div className="chat-toolbar">
        <div className="chat-toolbar-left">
          {/* Plan Mode Toggle */}
          <button
            className={`toolbar-btn ${planMode ? 'active plan-active' : ''}`}
            onClick={() => {
              setPlanMode(!planMode)
              addSystemMessage(
                planMode
                  ? '📐 已退出计划模式 — 恢复完整工具能力'
                  : '📐 已进入计划模式 — 只读分析，不会修改任何文件'
              )
            }}
            title={planMode ? '退出计划模式' : '进入计划模式'}
          >
            <span className="toolbar-btn-icon">📐</span>
            <span className="toolbar-btn-label">{planMode ? '计划模式 ON' : '计划'}</span>
          </button>

          {/* Effort Level */}
          <div className="toolbar-effort">
            <span className="toolbar-effort-label">力度</span>
            <div className="toolbar-effort-pills">
              {(['low', 'medium', 'high'] as const).map(level => (
                <button
                  key={level}
                  className={`effort-pill ${effortLevel === level ? 'active' : ''}`}
                  onClick={() => {
                    setEffortLevel(level)
                    const labels = { low: '低 — 快速简短回答', medium: '中 — 平衡深度', high: '高 — 深入分析' }
                    addSystemMessage(`⚡ 推理力度: ${labels[level]}`)
                  }}
                >
                  {level === 'low' ? '低' : level === 'medium' ? '中' : '高'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="chat-toolbar-right">
          {/* Compact */}
          <button
            className="toolbar-btn"
            onClick={() => addSystemMessage('📦 **上下文压缩** — 已提交压缩请求，将保留关键信息并释放 token 空间')}
            title="压缩上下文 (/compact)"
            disabled={messages.length === 0}
          >
            <span className="toolbar-btn-icon">📦</span>
            <span className="toolbar-btn-label">压缩</span>
          </button>

          {/* Rewind */}
          <button
            className="toolbar-btn"
            onClick={() => {
              if (messages.length >= 2) {
                setMessages(prev => prev.slice(0, -2))
                addSystemMessage('⏪ 已回退上一轮对话')
              }
            }}
            title="回退上一轮对话"
            disabled={messages.length < 2}
          >
            <span className="toolbar-btn-icon">⏪</span>
            <span className="toolbar-btn-label">回退</span>
          </button>

          {/* Context Bar (inline) */}
          {hasMessages && (
            <ContextBar messages={messages} currentModel={currentModel} />
          )}
        </div>
      </div>

      {/* Thinking Panel */}
      {(thinking || isStreaming) && (
        <div className={`chat-thinking ${isThinkingVisible ? '' : 'collapsed'}`}>
          <div
            className="chat-thinking-header"
            onClick={() => setIsThinkingVisible(!isThinkingVisible)}
          >
            <div className="chat-thinking-header-left">
              {isStreaming && <div className="spinner" />}
              <span>💭 思考过程</span>
            </div>
            <span className="chat-thinking-toggle">
              {isThinkingVisible ? '收起 ▾' : '展开 ▸'}
            </span>
          </div>
          {isThinkingVisible && thinking && (
            <div className="chat-thinking-content">
              {thinking}
            </div>
          )}
        </div>
      )}

      {/* Messages or Welcome */}
      {hasMessages ? (
        <>
        <div className="chat-messages" ref={messagesContainerRef}>
          <div className="chat-messages-inner">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`message message-${msg.role} animate-fade-in`}
              >
                {/* Role Badge */}
                <div className={`message-badge ${msg.role}`}>
                  {msg.role === 'user' ? '你' : msg.role === 'system' ? 'SYS' : '✦'}
                </div>

                {/* Hover Actions */}
                <div className="message-actions">
                  <button
                    className="message-action-btn"
                    title="复制"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigator.clipboard.writeText(msg.content)
                    }}
                  >📋</button>
                  {msg.role === 'user' && (
                    <>
                    <button
                      className="message-action-btn"
                      title="编辑"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditStart(msg)
                      }}
                    >✏️</button>
                    <button
                      className="message-action-btn"
                      title="重新发送"
                      onClick={(e) => {
                        e.stopPropagation()
                        setInput(msg.content)
                        inputRef.current?.focus()
                      }}
                    >🔄</button>
                    </>
                  )}
                </div>

                {/* Content */}
                <div className="message-body">
                  {/* Timestamp */}
                  <div className="message-meta">
                    <span className="message-role-label">
                      {msg.role === 'user' ? '你' : msg.role === 'system' ? '系统' : 'DolanClaw'}
                    </span>
                    <span className="message-time">{formatRelativeTime(msg.timestamp)}</span>
                  </div>

                  {/* Edit mode or normal render */}
                  {editingMsgId === msg.id ? (
                    <div className="message-edit-area">
                      <textarea
                        className="message-edit-input"
                        value={editingContent}
                        onChange={e => setEditingContent(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleEditSave(msg.id)
                          }
                          if (e.key === 'Escape') handleEditCancel()
                        }}
                        autoFocus
                        rows={3}
                      />
                      <div className="message-edit-actions">
                        <button className="btn-primary btn-sm" onClick={() => handleEditSave(msg.id)}>
                          保存并重发
                        </button>
                        <button className="btn-secondary btn-sm" onClick={handleEditCancel}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="message-content">
                      {renderMarkdown(msg.content)}
                    </div>
                  )}

                  {/* Tool Calls */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="tool-calls-container">
                      {msg.toolCalls.map(tc => (
                        <ToolCallBlock
                          key={tc.id}
                          tc={tc}
                          onOpenFile={onOpenFile}
                        />
                      ))}
                    </div>
                  )}

                  {/* Cost Footer */}
                  {msg.costInfo && msg.role === 'assistant' && (
                    <div className="message-cost">
                      {msg.costInfo.input > 0 && (
                        <span>📥 {msg.costInfo.input.toLocaleString()}</span>
                      )}
                      {msg.costInfo.output > 0 && (
                        <span>📤 {msg.costInfo.output.toLocaleString()}</span>
                      )}
                      {msg.costInfo.latency > 0 && (
                        <span>⏱️ {(msg.costInfo.latency / 1000).toFixed(1)}s</span>
                      )}
                      {msg.costInfo.cost > 0 && (
                        <span>💰 ¥{msg.costInfo.cost.toFixed(4)}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing Indicator */}
            {isStreaming && (
              <div className="message message-assistant animate-fade-in">
                <div className="message-badge assistant">✦</div>
                <div className="message-body">
                  <TypingIndicator />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Scroll to Bottom Button */}
        {showScrollBtn && (
          <button className="scroll-to-bottom" onClick={scrollToBottom} title="滚动到底部">
            ↓
          </button>
        )}
        </>
      ) : (
        <div className="chat-welcome animate-fade-in">
          <div className="chat-welcome-logo">✦</div>
          <div className="chat-welcome-title">DolanClaw</div>
          <div className="chat-welcome-subtitle">
            原生国产大模型开发助手 · 支持所有 Claude Code 工具能力
          </div>
          <div className="chat-welcome-features">
            {[
              { icon: '⚡', title: '终端执行', desc: '运行任意 Shell 命令', prompt: '帮我查看当前目录结构和 git 状态' },
              { icon: '✏️', title: '文件编辑', desc: '查看 diff 确认变更', prompt: '分析 package.json 并优化依赖版本' },
              { icon: '🔍', title: '代码搜索', desc: 'Grep / Glob / 语义搜索', prompt: '搜索项目中所有 TODO 和 FIXME 注释' },
              { icon: '🤖', title: '子代理', desc: '复杂任务自动拆分', prompt: '分析整个项目架构并生成文档' },
              { icon: '🔌', title: 'MCP 扩展', desc: '连接外部服务器', prompt: '帮我配置和管理 MCP 服务器' },
              { icon: '📐', title: '计划模式', desc: '先思考后执行', prompt: '/plan 重构项目中的错误处理逻辑' },
            ].map(feat => (
              <div
                key={feat.title}
                className="welcome-feature welcome-feature-clickable"
                onClick={() => {
                  setInput(feat.prompt)
                  inputRef.current?.focus()
                }}
              >
                <div className="welcome-feature-icon">{feat.icon}</div>
                <div className="welcome-feature-title">{feat.title}</div>
                <div className="welcome-feature-desc">{feat.desc}</div>
              </div>
            ))}
          </div>
          <div className="chat-welcome-prompts">
            <div className="welcome-prompts-label">快速开始</div>
            <div className="welcome-prompts-grid">
              {[
                { icon: '🐞', text: '帮我找到并修复这个代码库中的 Bug' },
                { icon: '📝', text: '为这个项目写完整的 README 文档' },
                { icon: '🧪', text: '为关键模块编写单元测试' },
                { icon: '🔄', text: '重构代码以提高可读性和性能' },
              ].map(p => (
                <button
                  key={p.text}
                  className="welcome-prompt-btn"
                  onClick={() => {
                    setInput(p.text)
                    inputRef.current?.focus()
                  }}
                >
                  <span className="welcome-prompt-icon">{p.icon}</span>
                  <span className="welcome-prompt-text">{p.text}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="chat-welcome-hint">
            输入 <code>/</code> 查看所有命令 · 按 <code>Enter</code> 发送
          </div>
        </div>
      )}

      {/* Permission Dialog Overlay */}
      {pendingPermission && (
        <div className="permission-overlay">
          <PermissionDialog
            toolCall={pendingPermission}
            onAllow={handlePermissionAllow}
            onDeny={handlePermissionDeny}
            onAllowAll={handlePermissionAllowAll}
          />
        </div>
      )}

      {/* Slash Command Menu */}
      {showSlashMenu && filteredSlash.length > 0 && (
        <div className="slash-menu">
          {filteredSlash.map((cmd, idx) => (
            <div
              key={cmd.name}
              className={`slash-item ${idx === slashSelectedIdx ? 'selected' : ''}`}
              onClick={() => selectSlashCommand(cmd)}
              onMouseEnter={() => setSlashSelectedIdx(idx)}
            >
              <span className="slash-icon">{cmd.icon}</span>
              <span className="slash-name">{cmd.name}</span>
              <span className="slash-desc">{cmd.desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* @ File Reference Menu */}
      {showAtMenu && filteredAtFiles.length > 0 && (
        <div className="at-menu">
          <div className="at-menu-header">📁 文件引用</div>
          {filteredAtFiles.map((file, idx) => (
            <div
              key={file}
              className={`at-item ${idx === atSelectedIdx ? 'selected' : ''}`}
              onClick={() => selectAtFile(file)}
              onMouseEnter={() => setAtSelectedIdx(idx)}
            >
              <span className="at-icon">📄</span>
              <span className="at-name">{file}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="chat-input-area">
        {interruptable && (
          <div className="interrupt-hint" onClick={handleInterrupt}>
            <span className="interrupt-key">Ctrl+C</span> 中断
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isStreaming ? "AI 正在响应..." : "输入消息，/ 命令，@ 引用文件… (Shift+Enter 换行)"}
            rows={1}
            disabled={isStreaming}
          />
          <div className="chat-input-actions">
            <button
              className="chat-send-btn"
              onClick={isStreaming ? handleInterrupt : handleSend}
              disabled={!isStreaming && !input.trim()}
              title={isStreaming ? '中断 (Ctrl+C)' : '发送 (Enter)'}
            >
              {isStreaming ? '■' : '↑'}
            </button>
          </div>
        </div>
        <div className="chat-input-footer">
          <span className="chat-input-model">{currentModel}</span>
          <span className="chat-input-hint">
            Shift+Enter 换行 · /help 查看命令
          </span>
        </div>
      </div>
      {/* Drag Overlay */}
      {isDragOver && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <span className="drag-overlay-icon">📎</span>
            <span className="drag-overlay-text">拖放文件以附加到对话</span>
          </div>
        </div>
      )}
    </div>
  )
}
