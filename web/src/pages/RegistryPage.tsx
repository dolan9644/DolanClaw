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

interface SkillPack {
  id: string
  name: string
  icon: string
  description: string
  category: string
  installed: boolean
  componentCount: number
  agents?: string[]
  skills?: string[]
  commands?: string[]
  rules?: string[]
}

interface IndividualSkill {
  id: string
  name: string
  icon: string
  description: string
  type: 'agent' | 'skill' | 'command'
  installed: boolean
}

interface SkillPackData {
  packs: SkillPack[]
  individuals: IndividualSkill[]
  eccAvailable: boolean
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

// ─── Skill Pack Details Modal ───────────────────────

function SkillPackDetailsModal({
  pack,
  isInstalling,
  onInstall,
  onUninstall,
  onClose,
}: {
  pack: SkillPack
  isInstalling: boolean
  onInstall: () => void
  onUninstall: () => void
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="page-header" style={{ padding: 0, marginBottom: 16, borderBottom: 'none' }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{pack.icon} {pack.name}</h3>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.6 }}>
          {pack.description}
        </p>
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {pack.agents && <span className="page-badge">{pack.agents.length} Agents</span>}
          {pack.skills && <span className="page-badge">{pack.skills.length} Skills</span>}
          {pack.commands && <span className="page-badge">{pack.commands.length} Commands</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} style={{ fontSize: 13 }}>关闭</button>
          {!pack.installed ? (
            <button className="btn-primary" onClick={onInstall} disabled={isInstalling}>
              {isInstalling ? '安装中...' : '安装技能包'}
            </button>
          ) : (
            <button className="btn" onClick={onUninstall} style={{ color: '#ef4444' }} disabled={isInstalling}>
              {isInstalling ? '卸载中...' : '卸载'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────

export function RegistryPage() {
  const [data, setData] = useState<RegistryData | null>(null)
  const [packData, setPackData] = useState<SkillPackData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'packs' | 'mcp' | 'skills'>('packs')
  const [activeCategory, setActiveCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [envModal, setEnvModal] = useState<McpServerEntry | null>(null)
  const [selectedPack, setSelectedPack] = useState<SkillPack | null>(null)

  const fetchRegistry = useCallback(async () => {
    try {
      const regRes = await fetch('/api/registry')
      if (regRes.ok) {
        const regJson = await regRes.json()
        setData(regJson)
      } else {
        setData({ mcpServers: [], skills: [], categories: [] })
      }
    } catch (err) {
      console.error('Failed to fetch registry:', err)
      setData({ mcpServers: [], skills: [], categories: [] })
    }

    try {
      const packRes = await fetch('/api/skill-packs')
      if (packRes.ok) {
        const packJson = await packRes.json()
        setPackData(packJson)
      }
    } catch {}

    setLoading(false)
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

  const installPack = useCallback(async (packId: string) => {
    setInstalling(packId)
    try {
      await fetch('/api/skill-packs/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      await fetchRegistry()
      setSelectedPack(null)
    } catch (err) {
      console.error('Install failed:', err)
    } finally {
      setInstalling(null)
    }
  }, [fetchRegistry])

  const uninstallPack = useCallback(async (packId: string) => {
    setInstalling(packId)
    try {
      await fetch('/api/skill-packs/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      await fetchRegistry()
      setSelectedPack(null)
    } catch (err) {
      console.error('Uninstall failed:', err)
    } finally {
      setInstalling(null)
    }
  }, [fetchRegistry])

  const installIndividual = useCallback(async (individualId: string) => {
    setInstalling(individualId)
    try {
      await fetch('/api/skill-packs/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ individualId }),
      })
      await fetchRegistry()
    } catch (err) {
      console.error('Install failed:', err)
    } finally {
      setInstalling(null)
    }
  }, [fetchRegistry])

  const uninstallIndividual = useCallback(async (individualId: string) => {
    setInstalling(individualId)
    try {
      await fetch('/api/skill-packs/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ individualId }),
      })
      await fetchRegistry()
    } catch (err) {
      console.error('Uninstall failed:', err)
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
  const packsInstalledCount = packData?.packs.filter(p => p.installed).length || 0

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
      <div className="page-header">
        <h1 className="page-title">扩展市场</h1>
        <div className="page-header-actions">
          <span className="page-badge">
            {connectedCount} 已连接
          </span>
          <span className="page-badge">
            {packsInstalledCount} 技能包已装
          </span>
          <span className="page-badge">
            {installedCount}/{data.mcpServers.length} MCP
          </span>
        </div>
      </div>

      <div className="page-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder={activeTab === 'mcp' ? '搜索 MCP 服务器...' : activeTab === 'packs' ? '搜索技能包...' : '搜索技能模板...'}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <div className="filter-tabs">
          <button
            className={`filter-tab ${activeTab === 'packs' ? 'active' : ''}`}
            onClick={() => { setActiveTab('packs'); setActiveCategory('all') }}
          >
            技能包 <span className="filter-count">{packData?.packs.length || 0}</span>
          </button>
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

      <div className="page-body">
        {activeTab === 'packs' && packData && (
          <>
            <div style={{ padding: '0 24px 12px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
              📦 技能包 — 一键安装全套组件
            </div>
            <div className="tools-grid">
              {packData.packs
                .filter(p => !searchQuery || p.name.includes(searchQuery) || p.description.includes(searchQuery))
                .map(pack => {
                return (
                  <div key={pack.id} className={`tool-card ${pack.installed ? 'tool-card-active' : ''}`}>
                    <div className="tool-card-header">
                      <span className="tool-card-icon">{pack.icon}</span>
                      <span className="tool-card-name">{pack.name}</span>
                      <span className="tool-card-perm" style={{
                        color: pack.installed ? '#10b981' : 'var(--text-muted)',
                        fontSize: 11,
                      }}>
                        {pack.installed ? '✓ 已安装' : `${pack.componentCount} 组件`}
                      </span>
                    </div>
                    <div className="tool-card-desc">{pack.description}</div>
                    <div className="tool-card-footer" style={{ gap: 4 }}>
                      <span className="tool-card-category">{pack.componentCount} 组件</span>
                      <span style={{ flex: 1 }} />
                      <button
                        className="btn"
                        style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)' }}
                        onClick={() => setSelectedPack(pack)}
                      >
                        详情
                      </button>
                      {!pack.installed ? (
                        <button
                          className="btn-primary"
                          style={{ fontSize: 11, padding: '3px 12px', whiteSpace: 'nowrap' }}
                          disabled={installing === pack.id}
                          onClick={() => installPack(pack.id)}
                        >
                          {installing === pack.id ? '安装中...' : '安装'}
                        </button>
                      ) : (
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '3px 10px', color: '#ef4444' }}
                          disabled={installing === pack.id}
                          onClick={() => uninstallPack(pack.id)}
                        >
                          {installing === pack.id ? '卸载中...' : '卸载'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ padding: '20px 24px 12px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
              ⭐ 热门单品 — 按需安装
            </div>
            <div className="tools-grid">
              {packData.individuals
                .filter(s => !searchQuery || s.name.includes(searchQuery) || s.description.includes(searchQuery))
                .map(item => {
                const isInstalling = installing === item.id
                const typeLabel = item.type === 'agent' ? 'Agent' : item.type === 'skill' ? 'Skill' : 'Command'
                return (
                  <div key={item.id} className={`tool-card ${item.installed ? 'tool-card-active' : ''}`}>
                    <div className="tool-card-header">
                      <span className="tool-card-icon">{item.icon}</span>
                      <span className="tool-card-name">{item.name}</span>
                      <span className="tool-card-perm" style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                      }}>
                        {typeLabel}
                      </span>
                    </div>
                    <div className="tool-card-desc">{item.description}</div>
                    <div className="tool-card-footer">
                      <span style={{ flex: 1 }} />
                      {!item.installed ? (
                        <button
                          className="btn-primary"
                          style={{ fontSize: 11, padding: '3px 12px' }}
                          disabled={isInstalling}
                          onClick={() => installIndividual(item.id)}
                        >
                          {isInstalling ? '安装中...' : '安装'}
                        </button>
                      ) : (
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '3px 10px', color: '#ef4444' }}
                          disabled={isInstalling}
                          onClick={() => uninstallIndividual(item.id)}
                        >
                          {isInstalling ? '卸载中...' : '卸载'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

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

                  <div className="tool-card-desc">{server.description}</div>

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

      {/* ── Skill Pack Details Modal ── */}
      {selectedPack && (
        <SkillPackDetailsModal
          pack={selectedPack}
          isInstalling={installing === selectedPack.id}
          onInstall={() => installPack(selectedPack.id)}
          onUninstall={() => uninstallPack(selectedPack.id)}
          onClose={() => setSelectedPack(null)}
        />
      )}
    </div>
  )
}
