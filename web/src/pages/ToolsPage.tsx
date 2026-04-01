import { useState, useEffect, useCallback } from 'react'

interface ToolDef {
  name: string
  category: string
  description: string
  permission: 'auto' | 'confirm' | 'deny' | 'ask'
  readOnly: boolean
  icon: string
  color: string
  usageCount: number
}

const FALLBACK_TOOLS: ToolDef[] = [
  { name: 'Bash', category: '核心开发', description: '执行任意 Shell 命令', permission: 'confirm', readOnly: false, icon: '⚡', color: '#f59e0b', usageCount: 0 },
  { name: 'FileEdit', category: '核心开发', description: '字符串替换编辑文件', permission: 'confirm', readOnly: false, icon: '✏️', color: '#3b82f6', usageCount: 0 },
  { name: 'FileWrite', category: '核心开发', description: '创建或覆写整个文件', permission: 'confirm', readOnly: false, icon: '📝', color: '#3b82f6', usageCount: 0 },
  { name: 'FileRead', category: '核心开发', description: '读取文件内容', permission: 'auto', readOnly: true, icon: '📖', color: '#8b5cf6', usageCount: 0 },
  { name: 'Glob', category: '核心开发', description: '文件名模式匹配搜索', permission: 'auto', readOnly: true, icon: '🔎', color: '#8b5cf6', usageCount: 0 },
  { name: 'Grep', category: '核心开发', description: '正则表达式内容搜索', permission: 'auto', readOnly: true, icon: '🔍', color: '#8b5cf6', usageCount: 0 },
  { name: 'Agent', category: '代理任务', description: '创建子代理执行复杂任务', permission: 'auto', readOnly: false, icon: '🤖', color: '#10b981', usageCount: 0 },
  { name: 'MCPTool', category: 'MCP 扩展', description: '调用 MCP 服务器工具', permission: 'confirm', readOnly: false, icon: '🔌', color: '#06b6d4', usageCount: 0 },
  { name: 'WebSearch', category: '网络工具', description: '搜索互联网', permission: 'auto', readOnly: true, icon: '🌐', color: '#06b6d4', usageCount: 0 },
  { name: 'WebFetch', category: '网络工具', description: '抓取网页内容', permission: 'auto', readOnly: true, icon: '🌐', color: '#06b6d4', usageCount: 0 },
  { name: 'TodoWrite', category: '计划流程', description: '管理待办事项列表', permission: 'auto', readOnly: false, icon: '✅', color: '#30d158', usageCount: 0 },
  { name: 'NotebookEdit', category: '核心开发', description: '编辑 Jupyter Notebook', permission: 'confirm', readOnly: false, icon: '📓', color: '#f472b6', usageCount: 0 },
]

const PERMISSION_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  auto: { icon: '✅', label: '自动', color: '#30d158' },
  confirm: { icon: '⚠️', label: '需确认', color: '#ff9f0a' },
  ask: { icon: '⚠️', label: '需确认', color: '#ff9f0a' },
  deny: { icon: '🚫', label: '禁止', color: '#ff453a' },
}

// Tool-specific input configs for the Try It panel
const TOOL_INPUT_CONFIGS: Record<string, { placeholder: string; paramName: string; label: string }> = {
  Bash: { placeholder: 'echo "hello world"', paramName: 'command', label: '命令' },
  BashTool: { placeholder: 'echo "hello world"', paramName: 'command', label: '命令' },
  FileRead: { placeholder: '/path/to/file.ts', paramName: 'path', label: '文件路径' },
  FileReadTool: { placeholder: '/path/to/file.ts', paramName: 'path', label: '文件路径' },
  Grep: { placeholder: 'function.*export', paramName: 'pattern', label: '搜索模式' },
  GrepTool: { placeholder: 'function.*export', paramName: 'pattern', label: '搜索模式' },
  Glob: { placeholder: '*.tsx', paramName: 'pattern', label: '文件模式' },
  GlobTool: { placeholder: '*.tsx', paramName: 'pattern', label: '文件模式' },
}

// ─── Try It Panel ──────────────────────────────────

function TryItPanel({ tool, onClose }: { tool: ToolDef; onClose: () => void }) {
  const config = TOOL_INPUT_CONFIGS[tool.name] || { placeholder: '', paramName: 'input', label: '输入' }
  const [inputVal, setInputVal] = useState('')
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [elapsed, setElapsed] = useState(0)

  const handleExecute = useCallback(async () => {
    if (!inputVal.trim()) return
    setStatus('running')
    setOutput('')

    try {
      const res = await fetch('/api/tools/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolId: `try-${Date.now()}`,
          toolName: tool.name,
          input: { [config.paramName]: inputVal },
        }),
      })
      const result = await res.json()
      setElapsed(result.elapsed || 0)
      if (result.error) {
        setStatus('error')
        setOutput(result.error)
      } else {
        setStatus('done')
        setOutput(result.output || '(无输出)')
      }
    } catch (err) {
      setStatus('error')
      setOutput(err instanceof Error ? err.message : String(err))
    }
  }, [inputVal, tool.name, config.paramName])

  return (
    <div className="tool-try-panel animate-slide-up">
      <div className="tool-try-header">
        <span className="tool-try-icon" style={{ color: tool.color }}>{tool.icon}</span>
        <span className="tool-try-name">试用 {tool.name}</span>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>
      <div className="tool-try-body">
        <label className="tool-try-label">{config.label}</label>
        <div className="tool-try-input-row">
          <input
            type="text"
            className="tool-try-input"
            placeholder={config.placeholder}
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleExecute()}
            autoFocus
          />
          <button
            className={`btn-primary ${status === 'running' ? 'loading' : ''}`}
            onClick={handleExecute}
            disabled={status === 'running' || !inputVal.trim()}
          >
            {status === 'running' ? '执行中...' : '▶ 执行'}
          </button>
        </div>
        {status !== 'idle' && (
          <div className={`tool-try-output status-${status}`}>
            <div className="tool-try-output-header">
              <span>{status === 'running' ? '⏳ 执行中...' : status === 'done' ? '✓ 完成' : '✕ 错误'}</span>
              {elapsed > 0 && <span className="tool-try-elapsed">{elapsed}ms</span>}
            </div>
            <pre className="tool-try-output-content">{output || '...'}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────

export function ToolsPage() {
  const [tools, setTools] = useState<ToolDef[]>(FALLBACK_TOOLS)
  const [filter, setFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [tryingTool, setTryingTool] = useState<ToolDef | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchTools = async () => {
      try {
        const res = await fetch('/api/tools')
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data) && data.length > 0) {
            setTools(data.map((t: ToolDef) => ({
              name: t.name || 'Unknown',
              category: t.category || '其他',
              description: t.description || '',
              permission: (['auto','confirm','deny','ask'].includes(t.permission) ? t.permission : 'auto') as ToolDef['permission'],
              readOnly: t.readOnly ?? (t.permission === 'auto'),
              icon: t.icon || '🔧',
              color: t.color || '#6b7280',
              usageCount: t.usageCount || 0,
            })))
          }
        }
      } catch {
        // Use fallback tools
      } finally {
        setLoading(false)
      }
    }
    fetchTools()
  }, [])

  const categories = ['all', ...new Set(tools.map(t => t.category))]

  const filtered = tools.filter(t => {
    const matchCategory = categoryFilter === 'all' || t.category === categoryFilter
    const matchSearch = !filter ||
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      t.description.includes(filter)
    return matchCategory && matchSearch
  })

  // Executable tools (ones we can actually try)
  const executableTools = new Set(['Bash', 'BashTool', 'FileRead', 'FileReadTool', 'Grep', 'GrepTool', 'Glob', 'GlobTool'])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">🔧 工具浏览器</h1>
        <div className="page-header-actions">
          <span className="page-badge">{tools.length} 个工具可用</span>
        </div>
      </div>
      <div className="page-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="搜索工具名称或描述..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <div className="filter-tabs">
          {categories.map(cat => (
            <button
              key={cat}
              className={`filter-tab ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === 'all' ? '全部' : cat}
            </button>
          ))}
        </div>
      </div>
      <div className="page-body">
        {loading ? (
          <div className="page-loading">
            <div className="spinner" />
            <span>加载工具列表...</span>
          </div>
        ) : (
          <>
            <div className="tools-grid">
              {filtered.map(tool => {
                const perm = PERMISSION_LABELS[tool.permission] || PERMISSION_LABELS['auto']
                const canTry = executableTools.has(tool.name)
                return (
                  <div
                    key={tool.name}
                    className={`tool-card ${canTry ? 'tool-card-interactive' : ''} ${tryingTool?.name === tool.name ? 'tool-card-active' : ''}`}
                    onClick={() => canTry && setTryingTool(tryingTool?.name === tool.name ? null : tool)}
                  >
                    <div className="tool-card-header">
                      <span className="tool-card-icon" style={{ color: tool.color }}>{tool.icon}</span>
                      <span className="tool-card-name">{tool.name}</span>
                      <span className="tool-card-perm" style={{ color: perm.color }}>
                        {perm.icon} {perm.label}
                      </span>
                    </div>
                    <div className="tool-card-desc">{tool.description}</div>
                    <div className="tool-card-footer">
                      <span className="tool-card-category">{tool.category}</span>
                      {canTry && <span className="tool-card-try">▶ 试用</span>}
                      {tool.readOnly && <span className="tool-card-readonly">只读</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Try It Panel */}
            {tryingTool && (
              <TryItPanel tool={tryingTool} onClose={() => setTryingTool(null)} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
