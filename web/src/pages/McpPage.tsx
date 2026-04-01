import { useState, useEffect } from 'react'

interface McpServer {
  name: string
  url: string
  type: string
  status: 'connected' | 'disconnected' | 'error' | 'connecting'
  scope: 'project' | 'user'
  tools: McpToolDef[]
  resources: number
  latency?: number
}

interface McpToolDef {
  name: string
  description: string
}

const STATUS_MAP: Record<McpServer['status'], { icon: string; label: string; color: string }> = {
  connected: { icon: '●', label: '已连接', color: '#30d158' },
  disconnected: { icon: '○', label: '未连接', color: '#8e8e93' },
  error: { icon: '●', label: '错误', color: '#ff453a' },
  connecting: { icon: '◐', label: '连接中', color: '#ff9f0a' },
}

const SCOPE_LABELS: Record<string, string> = {
  project: '项目级',
  user: '全局级',
}

export function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedServer, setSelectedServer] = useState<McpServer | null>(null)
  const [loading, setLoading] = useState(true)
  const [configInfo, setConfigInfo] = useState<{
    projectConfigPath?: string
    projectConfigExists?: boolean
  }>({})

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const res = await fetch('/api/mcp')
        if (res.ok) {
          const data = await res.json()
          setServers(data.servers || [])
          setConfigInfo({
            projectConfigPath: data.projectConfigPath,
            projectConfigExists: data.projectConfigExists,
          })
        }
      } catch {
        // fallback — no backend connection
      } finally {
        setLoading(false)
      }
    }
    fetchServers()
  }, [])

  const connectedCount = servers.filter(s => s.status === 'connected').length
  const totalTools = servers.reduce((s, srv) => s + srv.tools.length, 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">🔌 MCP 服务器</h1>
        <div className="page-header-actions">
          <span className="page-badge">{connectedCount}/{servers.length} 已连接</span>
          <span className="page-badge">{totalTools} 个工具</span>
          <button className="btn-primary" onClick={() => {
            // Open .mcp.json in chat via /run
            window.dispatchEvent(new CustomEvent('navigate', { detail: 'chat' }))
          }}>
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
                  : '在项目根目录创建 .mcp.json 或在 ~/.claude/settings.json 中配置'
                }
              </div>
              <div style={{ marginTop: 16, fontFamily: 'var(--font-mono)', fontSize: 11, opacity: 0.4 }}>
                {configInfo.projectConfigPath || ''}
              </div>
            </div>
          ) : (
            servers.map(srv => {
              const st = STATUS_MAP[srv.status]
              return (
                <div
                  key={`${srv.scope}-${srv.name}`}
                  className={`mcp-server-card ${selectedServer?.name === srv.name ? 'selected' : ''}`}
                  onClick={() => setSelectedServer(srv)}
                >
                  <div className="mcp-server-header">
                    <span className="mcp-server-status" style={{ color: st.color }}>{st.icon}</span>
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
                    {srv.latency && (
                      <span className="mcp-server-latency">{srv.latency}ms</span>
                    )}
                  </div>
                  <div className="mcp-server-url">{srv.url}</div>
                  <div className="mcp-server-footer">
                    <span>📦 {srv.type}</span>
                    <span>🔧 {srv.tools.length} 工具</span>
                    {srv.resources > 0 && <span>📁 {srv.resources} 资源</span>}
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
                  {selectedServer.status === 'connected' ? (
                    <button className="btn-danger">断开</button>
                  ) : (
                    <button className="btn-primary">连接</button>
                  )}
                  <button className="btn-secondary">🔄 重启</button>
                  <button className="btn-danger">🗑 移除</button>
                </div>
              </div>
              <div className="mcp-detail-info">
                <div className="mcp-info-row">
                  <span className="mcp-info-label">名称</span>
                  <span className="mcp-info-value">{selectedServer.name}</span>
                </div>
                <div className="mcp-info-row">
                  <span className="mcp-info-label">URL</span>
                  <span className="mcp-info-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {selectedServer.url}
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
                    {STATUS_MAP[selectedServer.status].label}
                  </span>
                </div>
              </div>
              {selectedServer.tools.length > 0 && (
                <div className="mcp-tools-section">
                  <h3>可用工具 ({selectedServer.tools.length})</h3>
                  <div className="mcp-tools-grid">
                    {selectedServer.tools.map(tool => (
                      <div key={tool.name} className="mcp-tool-card">
                        <div className="mcp-tool-name">🔧 {tool.name}</div>
                        <div className="mcp-tool-desc">{tool.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">🔌</div>
              <div className="empty-state-text">选择服务器查看详情</div>
              <div className="empty-state-hint">MCP 服务器提供额外的工具能力</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
