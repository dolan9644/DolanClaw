import { useState, useEffect, useCallback } from 'react'

interface McpServerEntry {
  name: string
  description: string
  command: string
  args: string[]
  category: string
  stars: number
  official: boolean
  envRequired?: string
  installed?: boolean
  connected?: boolean
}

interface SkillEntry {
  name: string
  description: string
  category: string
  builtin?: boolean
  url?: string
}

interface RegistryData {
  mcpServers: McpServerEntry[]
  skills: SkillEntry[]
  categories: string[]
}

// ─── Status Dot Component ────────────────────────────

function StatusDot({ status }: { status: 'connected' | 'installed' | 'available' }) {
  const colors = {
    connected: '#10b981',
    installed: '#f59e0b',
    available: 'var(--text-muted)',
  }
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[status],
        boxShadow: status === 'connected' ? `0 0 6px ${colors[status]}` : 'none',
      }}
    />
  )
}

// ─── Env Key Modal ──────────────────────────────────

function EnvKeyModal({
  server,
  onConfirm,
  onCancel,
}: {
  server: McpServerEntry
  onConfirm: (env: Record<string, string>) => void
  onCancel: () => void
}) {
  const [envValue, setEnvValue] = useState('')

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="page-header" style={{ padding: 0, marginBottom: 16, borderBottom: 'none' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>API Key 配置</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.6 }}>
          <strong>{server.name}</strong> 需要环境变量{' '}
          <code style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            padding: '2px 6px',
            borderRadius: 4,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}>
            {server.envRequired}
          </code>
        </p>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            密钥值
          </label>
          <input
            type="password"
            className="search-input"
            placeholder={`输入 ${server.envRequired}...`}
            value={envValue}
            onChange={e => setEnvValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && envValue.trim()) {
                const env: Record<string, string> = {}
                if (server.envRequired) env[server.envRequired] = envValue
                onConfirm(env)
              }
            }}
            style={{ width: '100%' }}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} style={{ fontSize: 13 }}>取消</button>
          <button
            className="btn-primary"
            style={{ fontSize: 13 }}
            disabled={!envValue.trim()}
            onClick={() => {
              const env: Record<string, string> = {}
              if (server.envRequired) env[server.envRequired] = envValue
              onConfirm(env)
            }}
          >
            安装并配置
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────

export function RegistryPage() {
  const [data, setData] = useState<RegistryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'mcp' | 'skills'>('mcp')
  const [activeCategory, setActiveCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [envModal, setEnvModal] = useState<McpServerEntry | null>(null)

  const fetchRegistry = useCallback(async () => {
    try {
      const res = await fetch('/api/registry')
      const json = await res.json()
      setData(json)
    } catch (err) {
      console.error('Failed to fetch registry:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRegistry() }, [fetchRegistry])

  const installMcp = useCallback(async (server: McpServerEntry, env?: Record<string, string>) => {
    setInstalling(server.name)
    try {
      await fetch('/api/registry/install-mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: server.name,
          command: server.command,
          args: server.args,
          env,
        }),
      })
      await fetchRegistry()
    } catch (err) {
      console.error('Install failed:', err)
    } finally {
      setInstalling(null)
    }
  }, [fetchRegistry])

  const installSkill = useCallback(async (skill: SkillEntry) => {
    setInstalling(skill.name)
    try {
      await fetch('/api/registry/install-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: skill.name, url: skill.url }),
      })
      await fetchRegistry()
    } catch (err) {
      console.error('Install failed:', err)
    } finally {
      setInstalling(null)
    }
  }, [fetchRegistry])

  const handleInstallClick = useCallback((server: McpServerEntry) => {
    if (server.envRequired) {
      setEnvModal(server)
    } else {
      installMcp(server)
    }
  }, [installMcp])

  // ── Loading State ──
  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <div className="spinner" />
          <span>加载扩展目录...</span>
        </div>
      </div>
    )
  }

  // ── Error State ──
  if (!data) {
    return (
      <div className="page">
        <div className="page-loading">
          <span style={{ color: 'var(--text-secondary)' }}>无法加载扩展目录</span>
        </div>
      </div>
    )
  }

  const allCategories = ['all', ...(data.categories || [])]
  const installedCount = data.mcpServers.filter(s => s.installed).length
  const connectedCount = data.mcpServers.filter(s => s.connected).length

  const filteredMcp = data.mcpServers.filter(s => {
    if (activeCategory !== 'all' && s.category !== activeCategory) return false
    if (searchQuery && !s.name.includes(searchQuery.toLowerCase()) && !s.description.includes(searchQuery)) return false
    return true
  })

  const filteredSkills = data.skills.filter(s => {
    if (searchQuery && !s.name.includes(searchQuery.toLowerCase()) && !s.description.includes(searchQuery)) return false
    return true
  })

  return (
    <div className="page">
      {/* ── Header ── */}
      <div className="page-header">
        <h1 className="page-title">扩展市场</h1>
        <div className="page-header-actions">
          <span className="page-badge">
            {connectedCount} 已连接
          </span>
          <span className="page-badge">
            {installedCount}/{data.mcpServers.length} 已安装
          </span>
        </div>
      </div>

      {/* ── Toolbar: Tabs + Search ── */}
      <div className="page-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder={activeTab === 'mcp' ? '搜索 MCP 服务器...' : '搜索技能模板...'}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <div className="filter-tabs">
          <button
            className={`filter-tab ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => { setActiveTab('mcp'); setActiveCategory('all') }}
          >
            MCP 服务器 <span className="filter-count">{data.mcpServers.length}</span>
          </button>
          <button
            className={`filter-tab ${activeTab === 'skills' ? 'active' : ''}`}
            onClick={() => { setActiveTab('skills'); setActiveCategory('all') }}
          >
            技能模板 <span className="filter-count">{data.skills.length}</span>
          </button>
        </div>
      </div>

      {/* ── Category Filter (MCP only) ── */}
      {activeTab === 'mcp' && (
        <div className="filter-tabs" style={{ padding: '0 24px 16px', gap: 4 }}>
          {allCategories.map(cat => (
            <button
              key={cat}
              className={`filter-tab ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
              style={{ fontSize: 12 }}
            >
              {cat === 'all' ? '全部' : cat}
            </button>
          ))}
        </div>
      )}

      {/* ── Body ── */}
      <div className="page-body">

        {/* ── MCP Server Grid ── */}
        {activeTab === 'mcp' && (
          <div className="tools-grid">
            {filteredMcp.map(server => {
              const statusType = server.connected ? 'connected' : server.installed ? 'installed' : 'available'
              const statusLabel = server.connected ? '已连接' : server.installed ? '已安装' : '未安装'
              const isInstalling = installing === server.name

              return (
                <div
                  key={server.name}
                  className={`tool-card ${server.installed ? 'tool-card-active' : ''}`}
                >
                  {/* Card Header */}
                  <div className="tool-card-header">
                    <span className="tool-card-icon" style={{ color: server.connected ? '#10b981' : '#6b7280' }}>
                      {server.connected ? '◉' : server.installed ? '◎' : '○'}
                    </span>
                    <span className="tool-card-name">{server.name}</span>
                    <span className="tool-card-perm" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <StatusDot status={statusType} />
                      <span style={{ color: statusType === 'connected' ? '#10b981' : statusType === 'installed' ? '#f59e0b' : 'var(--text-muted)' }}>
                        {statusLabel}
                      </span>
                    </span>
                  </div>

                  {/* Description */}
                  <div className="tool-card-desc">{server.description}</div>

                  {/* Footer — row 1: meta */}
                  <div className="tool-card-footer" style={{ flexWrap: 'nowrap' }}>
                    <span className="tool-card-category">{server.category}</span>
                    {server.official && (
                      <span style={{ fontSize: 10, color: '#3b82f6', whiteSpace: 'nowrap' }}>Official</span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {server.stars.toLocaleString()}
                    </span>
                    <span style={{ flex: 1 }} />
                    {!server.installed ? (
                      <button
                        className="btn-primary"
                        style={{ fontSize: 11, padding: '3px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                        disabled={isInstalling}
                        onClick={() => handleInstallClick(server)}
                      >
                        {isInstalling ? '安装中...' : '安装'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: '#10b981', fontWeight: 500, flexShrink: 0 }}>✓</span>
                    )}
                  </div>
                  {/* Footer — row 2: env key (only if needed) */}
                  {server.envRequired && (
                    <div style={{ marginTop: 6 }}>
                      <span style={{
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(245,158,11,0.08)',
                        color: '#d97706',
                        border: '1px solid rgba(245,158,11,0.15)',
                      }}>
                        {server.envRequired}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Skills Grid ── */}
        {activeTab === 'skills' && (
          <div className="tools-grid">
            {filteredSkills.map(skill => {
              const isInstalling = installing === skill.name
              return (
                <div key={skill.name} className="tool-card">
                  <div className="tool-card-header">
                    <span className="tool-card-icon" style={{ color: skill.builtin ? '#f59e0b' : '#6b7280' }}>
                      {skill.builtin ? '◆' : '◇'}
                    </span>
                    <span className="tool-card-name">{skill.name}</span>
                    <span className="tool-card-perm" style={{
                      color: skill.builtin ? '#f59e0b' : 'var(--text-muted)',
                    }}>
                      {skill.builtin ? '内置' : '远程'}
                    </span>
                  </div>
                  <div className="tool-card-desc">{skill.description}</div>
                  <div className="tool-card-footer">
                    <span className="tool-card-category">{skill.category}</span>
                    <span style={{ flex: 1 }} />
                    {!skill.builtin && skill.url ? (
                      <button
                        className="btn-primary"
                        style={{ fontSize: 11, padding: '3px 12px' }}
                        disabled={isInstalling}
                        onClick={() => installSkill(skill)}
                      >
                        {isInstalling ? '安装中...' : '安装'}
                      </button>
                    ) : skill.builtin ? (
                      <span style={{ fontSize: 11, color: '#10b981', fontWeight: 500 }}>已就绪</span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Empty State ── */}
        {((activeTab === 'mcp' && filteredMcp.length === 0) ||
          (activeTab === 'skills' && filteredSkills.length === 0)) && (
          <div style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>没有匹配的结果</div>
            <div style={{ fontSize: 12 }}>尝试调整搜索关键词或分类筛选</div>
          </div>
        )}
      </div>

      {/* ── Env Key Modal ── */}
      {envModal && (
        <EnvKeyModal
          server={envModal}
          onConfirm={(env) => {
            installMcp(envModal, env)
            setEnvModal(null)
          }}
          onCancel={() => setEnvModal(null)}
        />
      )}
    </div>
  )
}
