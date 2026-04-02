import { useState, useEffect, useCallback } from 'react'

interface McpToolDef {
  name: string
  fullName: string
  description: string
}

interface McpServer {
  name: string
  url: string
  type: string
  status: 'connected' | 'disconnected' | 'error' | 'connecting'
  scope: 'project' | 'user'
  command?: string
  args?: string[]
  tools: McpToolDef[]
  resources: number
  error?: string
  pid?: number
}

const STATUS_MAP: Record<McpServer['status'], { icon: string; label: string; color: string; glow?: string }> = {
  connected: { icon: '●', label: '已连接', color: '#30d158', glow: '0 0 6px rgba(48,209,88,0.5)' },
  disconnected: { icon: '○', label: '未连接', color: '#8e8e93' },
  error: { icon: '●', label: '错误', color: '#ff453a', glow: '0 0 6px rgba(255,69,58,0.5)' },
  connecting: { icon: '◐', label: '连接中', color: '#ff9f0a', glow: '0 0 6px rgba(255,159,10,0.5)' },
}

const SCOPE_LABELS: Record<string, string> = {
  project: '项目级',
  user: '全局级',
}

// ─── Add Server Modal ──────────────────────────────────
function AddServerModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('npx')
  const [args, setArgs] = useState('-y @modelcontextprotocol/server-')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim() || !command.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/mcp/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          command: command.trim(),
          args: args.trim().split(/\s+/).filter(Boolean),
        }),
      })
      const data = await res.json()
      if (data.ok) {
        onAdded()
        onClose()
      } else {
        setError(data.error || '添加失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="agent-config-modal animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="agent-config-header">
          <h3>➕ 添加 MCP 服务器</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="agent-config-body">
          <div className="agent-config-field">
            <label className="agent-config-label">服务器名称</label>
            <input
              type="text"
              className="tool-try-input"
              placeholder="my-server"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="agent-config-field">
            <label className="agent-config-label">启动命令</label>
            <input
              type="text"
              className="tool-try-input"
              placeholder="npx"
              value={command}
              onChange={e => setCommand(e.target.value)}
            />
          </div>
          <div className="agent-config-field">
            <label className="agent-config-label">参数（空格分隔）</label>
            <input
              type="text"
              className="tool-try-input"
              placeholder="-y @modelcontextprotocol/server-filesystem /path"
              value={args}
              onChange={e => setArgs(e.target.value)}
            />
          </div>
          {error && <div style={{ color: '#ff453a', fontSize: 12, marginTop: 8 }}>❌ {error}</div>}
        </div>
        <div className="agent-config-footer">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? '保存中...' : '添加'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({}) // name -> action
  const [configInfo, setConfigInfo] = useState<{
    projectConfigPath?: string
    projectConfigExists?: boolean
  }>({})

  const fetchServers = useCallback(async () => {
    try {
      const res = await fetch('/api/mcp')
      if (res.ok) {
        const data = await res.json()
        setServers(data.servers || [])
        setConfigInfo({
          projectConfigPath: data.projectConfigPath,
          projectConfigExists: data.projectConfigExists,
        })
        // Update selected server if it exists
        if (selectedServer) {
          const updated = (data.servers || []).find((s: McpServer) => s.name === selectedServer.name)
          if (updated) setSelectedServer(updated)
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [selectedServer])

  useEffect(() => { fetchServers() }, [])

  // ── 操作 API ──

  const handleConnect = async (name: string) => {
    setActionLoading(prev => ({ ...prev, [name]: 'connecting' }))
    // Optimistic UI: update status immediately
    setServers(prev => prev.map(s => s.name === name ? { ...s, status: 'connecting' as const } : s))
    try {
      const res = await fetch(`/api/mcp/${encodeURIComponent(name)}/connect`, { method: 'POST' })
      const data = await res.json()
      if (!data.ok) {
        setServers(prev => prev.map(s => s.name === name ? { ...s, status: 'error' as const, error: data.error } : s))
      }
    } catch { /* will be caught on refresh */ }
    finally {
      setActionLoading(prev => { const n = { ...prev }; delete n[name]; return n })
      fetchServers()
    }
  }

  const handleDisconnect = async (name: string) => {
    setActionLoading(prev => ({ ...prev, [name]: 'disconnecting' }))
    try {
      await fetch(`/api/mcp/${encodeURIComponent(name)}/disconnect`, { method: 'POST' })
    } finally {
      setActionLoading(prev => { const n = { ...prev }; delete n[name]; return n })
      fetchServers()
    }
  }

  const handleRestart = async (name: string) => {
    setActionLoading(prev => ({ ...prev, [name]: 'restarting' }))
    try {
      await fetch(`/api/mcp/${encodeURIComponent(name)}/restart`, { method: 'POST' })
    } finally {
      setActionLoading(prev => { const n = { ...prev }; delete n[name]; return n })
      fetchServers()
    }
  }

  const handleDelete = async (name: string) => {
    if (!confirm(`确定删除 ${name} 服务器？`)) return
    try {
      await fetch(`/api/mcp/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (selectedServer?.name === name) setSelectedServer(null)
      fetchServers()
    } catch { /* ignore */ }
  }

  const handleConnectAll = async () => {
    const disconnected = servers.filter(s => s.status === 'disconnected')
    for (const s of disconnected) {
      await handleConnect(s.name)
    }
  }

  const connectedCount = servers.filter(s => s.status === 'connected').length
  const totalTools = servers.reduce((s, srv) => s + srv.tools.length, 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">🔌 MCP 服务器</h1>
        <div className="page-header-actions">
          <span className="page-badge" style={{
            background: connectedCount > 0 ? 'rgba(48,209,88,0.15)' : undefined,
            color: connectedCount > 0 ? '#30d158' : undefined,
          }}>
            {connectedCount}/{servers.length} 已连接
          </span>
          <span className="page-badge">{totalTools} 个工具</span>
          {servers.some(s => s.status === 'disconnected') && (
            <button className="btn-secondary" onClick={handleConnectAll} style={{ fontSize: 12 }}>
              ⚡ 全部连接
            </button>
          )}
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>
            ➕ 添加服务器
          </button>
        </div>
      </div>
      <div className="page-body mcp-layout">
        {/* Server List */}
        <div className="mcp-server-list">
          {loading ? (
            <div className="page-loading">
              <div className="spinner" />
              <span>加载 MCP 配置...</span>
            </div>
          ) : servers.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">🔌</div>
              <div className="empty-state-text">未发现 MCP 服务器</div>
              <div className="empty-state-hint" style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
                {configInfo.projectConfigExists
                  ? `.mcp.json 已存在但无服务器配置`
                  : '点击"添加服务器"开始配置'
                }
              </div>
              <button className="btn-primary" onClick={() => setShowAddModal(true)} style={{ marginTop: 16 }}>
                ➕ 添加第一个 MCP 服务器
              </button>
            </div>
          ) : (
            servers.map(srv => {
              const st = STATUS_MAP[srv.status]
              const isLoading = !!actionLoading[srv.name]
              return (
                <div
                  key={`${srv.scope}-${srv.name}`}
                  className={`mcp-server-card ${selectedServer?.name === srv.name ? 'selected' : ''} ${isLoading ? 'loading' : ''}`}
                  onClick={() => setSelectedServer(srv)}
                >
                  <div className="mcp-server-header">
                    <span
                      className="mcp-server-status"
                      style={{
                        color: st.color,
                        textShadow: st.glow,
                        animation: srv.status === 'connecting' ? 'pulse 1s infinite' : undefined,
                      }}
                    >
                      {srv.status === 'connecting' ? '◐' : st.icon}
                    </span>
                    <span className="mcp-server-name">{srv.name}</span>
                    <span className="mcp-server-scope" style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: srv.scope === 'project' ? 'rgba(10,132,255,0.15)' : 'rgba(142,142,147,0.15)',
                      color: srv.scope === 'project' ? '#0a84ff' : '#8e8e93',
                    }}>
                      {SCOPE_LABELS[srv.scope] || srv.scope}
                    </span>
                  </div>
                  <div className="mcp-server-url" style={{ fontSize: 11, opacity: 0.5 }}>
                    {srv.command} {(srv.args || []).join(' ')}
                  </div>
                  <div className="mcp-server-footer">
                    <span>📦 {srv.type}</span>
                    <span style={{ color: srv.tools.length > 0 ? '#30d158' : '#8e8e93' }}>
                      🔧 {srv.tools.length} 工具
                    </span>
                    {srv.error && <span style={{ color: '#ff453a', fontSize: 10 }}>⚠ {srv.error.slice(0, 30)}</span>}
                  </div>

                  {/* Quick action buttons */}
                  <div style={{
                    display: 'flex', gap: 6, marginTop: 8, paddingTop: 8,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }} onClick={e => e.stopPropagation()}>
                    {srv.status === 'disconnected' || srv.status === 'error' ? (
                      <button
                        className="btn-primary"
                        style={{ flex: 1, fontSize: 11, padding: '4px 8px' }}
                        onClick={() => handleConnect(srv.name)}
                        disabled={isLoading}
                      >
                        {actionLoading[srv.name] === 'connecting' ? '连接中...' : '▶ 连接'}
                      </button>
                    ) : srv.status === 'connected' ? (
                      <>
                        <button
                          className="btn-secondary"
                          style={{ flex: 1, fontSize: 11, padding: '4px 8px' }}
                          onClick={() => handleRestart(srv.name)}
                          disabled={isLoading}
                        >
                          🔄 重启
                        </button>
                        <button
                          className="btn-danger"
                          style={{ flex: 1, fontSize: 11, padding: '4px 8px' }}
                          onClick={() => handleDisconnect(srv.name)}
                          disabled={isLoading}
                        >
                          ⏹ 断开
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Server Details */}
        <div className="mcp-detail">
          {selectedServer ? (
            <>
              <div className="mcp-detail-header">
                <h2>{selectedServer.name}</h2>
                <div className="mcp-detail-actions">
                  <button className="btn-danger" onClick={() => handleDelete(selectedServer.name)} style={{ fontSize: 12 }}>
                    🗑 删除配置
                  </button>
                </div>
              </div>
              <div className="mcp-detail-info">
                <div className="mcp-info-row">
                  <span className="mcp-info-label">名称</span>
                  <span className="mcp-info-value">{selectedServer.name}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">命令</span>
                  <span className="mcp-info-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {selectedServer.command} {(selectedServer.args || []).join(' ')}
                  </span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">类型</span>
                  <span className="mcp-info-value">{selectedServer.type}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">作用域</span>
                  <span className="mcp-info-value">{SCOPE_LABELS[selectedServer.scope] || selectedServer.scope}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">状态</span>
                  <span className="mcp-info-value" style={{ color: STATUS_MAP[selectedServer.status].color }}>
                    {STATUS_MAP[selectedServer.status].icon} {STATUS_MAP[selectedServer.status].label}
                  </span>
                </div>
                {selectedServer.pid && (
                  <div className="mcp-info-row">
                    <span className="mcp-info-label">PID</span>
                    <span className="mcp-info-value" style={{ fontFamily: 'var(--font-mono)' }}>{selectedServer.pid}</span>
                  </div>
                )}
                {selectedServer.error && (
                  <div className="mcp-info-row">
                    <span className="mcp-info-label">错误</span>
                    <span className="mcp-info-value" style={{ color: '#ff453a', fontSize: 12 }}>{selectedServer.error}</span>
                  </div>
                )}
              </div>
              {selectedServer.tools.length > 0 ? (
                <div className="mcp-tools-section">
                  <h3>可用工具 ({selectedServer.tools.length})</h3>
                  <div className="mcp-tools-grid">
                    {selectedServer.tools.map(tool => (
                      <div key={tool.name} className="mcp-tool-card">
                        <div className="mcp-tool-name">🔧 {tool.name}</div>
                        <div className="mcp-tool-desc">{tool.description}</div>
                        {tool.fullName && (
                          <div style={{ fontSize: 10, opacity: 0.3, fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                            {tool.fullName}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : selectedServer.status === 'disconnected' ? (
                <div className="empty-state" style={{ padding: '30px 20px' }}>
                  <div className="empty-state-icon">🔌</div>
                  <div className="empty-state-text">服务器未连接</div>
                  <div className="empty-state-hint">连接后可查看可用工具</div>
                  <button
                    className="btn-primary"
                    style={{ marginTop: 12 }}
                    onClick={() => handleConnect(selectedServer.name)}
                  >
                    ▶ 连接此服务器
                  </button>
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '30px 20px' }}>
                  <div className="empty-state-icon">📦</div>
                  <div className="empty-state-text">该服务器未提供工具</div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">🔌</div>
              <div className="empty-state-text">选择服务器查看详情</div>
              <div className="empty-state-hint">MCP 服务器为 AI 提供额外的工具能力</div>
            </div>
          )}
        </div>
      </div>

      {/* Add Server Modal */}
      {showAddModal && (
        <AddServerModal
          onClose={() => setShowAddModal(false)}
          onAdded={fetchServers}
        />
      )}
    </div>
  )
}
