import { useState, useEffect } from 'react'

interface PermissionRule {
  id: string
  tool: string
  pattern: string
  decision: 'allow' | 'deny' | 'ask'
  source: 'user' | 'project' | 'session'
}

interface Session {
  id: string
  title: string
  model: string
  messages: number
  cost: number
  startTime: string
  duration: string
  status: 'active' | 'completed' | 'saved'
}

// ─── Permissions Page ──────────────────────────────────

const DECISION_META: Record<string, { icon: string; label: string; color: string }> = {
  allow: { icon: '✅', label: '允许', color: '#30d158' },
  deny: { icon: '🚫', label: '拒绝', color: '#ff453a' },
  ask: { icon: '❓', label: '询问', color: '#ff9f0a' },
}

export function PermissionsPage() {
  const [rules, setRules] = useState<PermissionRule[]>([])
  const [permMode, setPermMode] = useState<'default' | 'auto' | 'plan'>('default')
  const [loading, setLoading] = useState(true)
  const [sessionRules, setSessionRules] = useState<PermissionRule[]>(() => {
    try {
      const saved = localStorage.getItem('dolanclaw-session-permissions')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  useEffect(() => {
    const fetchPermissions = async () => {
      try {
        const res = await fetch('/api/permissions')
        if (res.ok) {
          const data = await res.json()
          setRules(data.rules || [])
        }
      } catch { /* keep empty */ }
      finally { setLoading(false) }
    }
    fetchPermissions()
  }, [])

  // Merge backend rules + session rules
  const allRules = [...rules, ...sessionRules]

  const handleAddSessionRule = () => {
    const newRule: PermissionRule = {
      id: `session-${Date.now()}`,
      tool: 'Bash',
      pattern: 'echo *',
      decision: 'allow',
      source: 'session',
    }
    const updated = [...sessionRules, newRule]
    setSessionRules(updated)
    localStorage.setItem('dolanclaw-session-permissions', JSON.stringify(updated))
  }

  const handleDeleteSessionRule = (id: string) => {
    const updated = sessionRules.filter(r => r.id !== id)
    setSessionRules(updated)
    localStorage.setItem('dolanclaw-session-permissions', JSON.stringify(updated))
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">🔐 权限管理</h1>
        <div className="page-header-actions">
          <span className="page-badge">{allRules.length} 条规则</span>
          <button className="btn-primary" onClick={handleAddSessionRule}>➕ 添加规则</button>
        </div>
      </div>
      <div className="page-toolbar">
        <div className="perm-mode-selector">
          <span className="perm-mode-label">权限模式:</span>
          {(['default', 'auto', 'plan'] as const).map(m => (
            <button
              key={m}
              className={`perm-mode-btn ${permMode === m ? 'active' : ''}`}
              onClick={() => setPermMode(m)}
            >
              {m === 'default' ? '🛡 默认' : m === 'auto' ? '⚡ 自动' : '📐 计划'}
            </button>
          ))}
        </div>
      </div>
      <div className="page-body">
        {loading ? (
          <div className="page-loading">
            <div className="spinner" />
            <span>加载权限规则...</span>
          </div>
        ) : allRules.length === 0 ? (
          <div className="page-empty">
            <div className="page-empty-icon">🔐</div>
            <div className="page-empty-title">暂无权限规则</div>
            <div className="page-empty-desc">
              在 <code>~/.claude/settings.json</code> 的 permissions.allow / permissions.deny 数组中添加规则
            </div>
          </div>
        ) : (
          <div className="perm-table">
            <div className="perm-table-header">
              <span>工具</span>
              <span>模式匹配</span>
              <span>决策</span>
              <span>来源</span>
              <span>操作</span>
            </div>
            {allRules.map(rule => {
              const dec = DECISION_META[rule.decision]
              return (
                <div key={rule.id} className="perm-table-row">
                  <span className="perm-tool">{rule.tool}</span>
                  <span className="perm-pattern"><code>{rule.pattern}</code></span>
                  <span className="perm-decision" style={{ color: dec.color }}>
                    {dec.icon} {dec.label}
                  </span>
                  <span className="perm-source">
                    {rule.source === 'user' ? '👤 全局' : rule.source === 'project' ? '📁 项目' : '🔄 会话'}
                  </span>
                  <span className="perm-actions">
                    {rule.source === 'session' ? (
                      <button className="btn-icon" title="删除" onClick={() => handleDeleteSessionRule(rule.id)}>🗑</button>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-quaternary)' }}>只读</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sessions Page ──────────────────────────────────


const SESSION_STATUS: Record<string, { icon: string; label: string; color: string }> = {
  active: { icon: '●', label: '进行中', color: '#30d158' },
  completed: { icon: '✓', label: '已完成', color: '#8e8e93' },
  saved: { icon: '💾', label: '已保存', color: '#0a84ff' },
}

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeId, setActiveId] = useState('')

  // Load sessions from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dolanclaw-sessions') || '[]')
      setSessions(saved)
      setActiveId(localStorage.getItem('dolanclaw-active-session') || '')
    } catch { /* ignore */ }
  }, [])

  const saveSessions = (list: Session[]) => {
    setSessions(list)
    localStorage.setItem('dolanclaw-sessions', JSON.stringify(list))
  }

  // Create new session
  const handleNewSession = () => {
    // Save current messages to current session
    if (activeId) {
      const msgs = JSON.parse(localStorage.getItem('dolanclaw-messages') || '[]')
      const updated = sessions.map(s => {
        if (s.id !== activeId) return s
        return {
          ...s,
          messages: msgs.length,
          cost: msgs.reduce((sum: number, m: any) => sum + (m.costInfo?.cost || 0), 0),
          status: 'saved' as const,
        }
      })
      saveSessions(updated)
    }

    const newSession: Session = {
      id: `s_${Date.now()}`,
      title: `新会话 ${sessions.length + 1}`,
      model: localStorage.getItem('dolanclaw-model') || 'minimax-m2.7',
      messages: 0,
      cost: 0,
      startTime: new Date().toLocaleString('zh-CN'),
      duration: '0s',
      status: 'active',
    }

    localStorage.setItem('dolanclaw-messages', '[]')
    localStorage.setItem('dolanclaw-active-session', newSession.id)
    setActiveId(newSession.id)
    saveSessions([newSession, ...sessions])
  }

  // Switch to session
  const handleRestore = (session: Session) => {
    if (session.id === activeId) return

    // Save current messages
    if (activeId) {
      const msgs = JSON.parse(localStorage.getItem('dolanclaw-messages') || '[]')
      const updated = sessions.map(s => {
        if (s.id !== activeId) return s
        return { ...s, messages: msgs.length, status: 'saved' as const }
      })
      saveSessions(updated)
    }

    // Load target session messages
    try {
      const savedMsgs = localStorage.getItem(`dolanclaw-session-${session.id}`) || '[]'
      localStorage.setItem('dolanclaw-messages', savedMsgs)
    } catch {
      localStorage.setItem('dolanclaw-messages', '[]')
    }

    localStorage.setItem('dolanclaw-active-session', session.id)
    setActiveId(session.id)

    // Mark as active
    saveSessions(sessions.map(s => ({
      ...s,
      status: s.id === session.id ? 'active' as const : s.status === 'active' ? 'saved' as const : s.status,
    })))
  }

  // Save current session's messages for backup
  useEffect(() => {
    if (!activeId) return
    const interval = setInterval(() => {
      try {
        const msgs = localStorage.getItem('dolanclaw-messages') || '[]'
        localStorage.setItem(`dolanclaw-session-${activeId}`, msgs)
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [activeId])

  // Delete session
  const handleDelete = (id: string) => {
    if (id === activeId) {
      localStorage.setItem('dolanclaw-messages', '[]')
      localStorage.removeItem('dolanclaw-active-session')
      setActiveId('')
    }
    localStorage.removeItem(`dolanclaw-session-${id}`)
    saveSessions(sessions.filter(s => s.id !== id))
  }

  // Export session
  const handleExport = (session: Session) => {
    try {
      const msgs = localStorage.getItem(`dolanclaw-session-${session.id}`) || '[]'
      const blob = new Blob([JSON.stringify({ ...session, messages_data: JSON.parse(msgs) }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `session-${session.id}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.model.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📂 会话管理</h1>
        <div className="page-header-actions">
          <span className="page-badge">{sessions.length} 个会话</span>
          <button className="btn-primary btn-sm" onClick={handleNewSession}>
            ＋ 新建会话
          </button>
        </div>
      </div>
      <div className="page-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="搜索会话..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="page-body">
        {filtered.length === 0 ? (
          <div className="page-empty">
            <div className="page-empty-icon">📂</div>
            <div className="page-empty-title">暂无会话记录</div>
            <div className="page-empty-desc">点击「新建会话」开始</div>
          </div>
        ) : (
          <div className="sessions-list">
            {filtered.map(session => {
              const st = SESSION_STATUS[session.status]
              const isActive = session.id === activeId
              return (
                <div key={session.id} className={`session-card ${isActive ? 'session-active' : ''}`}>
                  <div className="session-card-header">
                    <span className="session-status" style={{ color: st.color }}>{st.icon}</span>
                    <span className="session-title">{session.title}</span>
                    {isActive && <span className="page-badge" style={{ fontSize: 10 }}>当前</span>}
                    <span className="session-time">{session.startTime}</span>
                  </div>
                  <div className="session-card-body">
                    <span className="session-meta">🤖 {session.model}</span>
                    <span className="session-meta">💬 {session.messages} 条消息</span>
                    <span className="session-meta">💰 ¥{session.cost.toFixed(2)}</span>
                  </div>
                  <div className="session-card-actions">
                    {!isActive && (
                      <button className="btn-primary btn-sm" onClick={() => handleRestore(session)}>
                        恢复
                      </button>
                    )}
                    <button className="btn-secondary btn-sm" onClick={() => handleExport(session)}>
                      导出
                    </button>
                    <button className="btn-icon" title="删除" onClick={() => handleDelete(session.id)}>🗑</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Settings Page ──────────────────────────────────

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState('general')

  // All settings backed by localStorage
  const load = (key: string, def: string) => localStorage.getItem(`dolanclaw-${key}`) || def
  const save = (key: string, val: string) => { localStorage.setItem(`dolanclaw-${key}`, val) }

  const [language, setLanguage] = useState(load('lang', 'zh-CN'))
  const [defaultModel, setDefaultModel] = useState(load('model', 'minimax-m2.7'))

  // Dynamically fetch available models (only those with API keys)
  const [availableModels, setAvailableModels] = useState<Array<{key: string, label: string}>>([]) 
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then((models: Array<{key: string, displayName: string, hasApiKey: boolean}>) => {
        const withKey = models
          .filter(m => m.hasApiKey)
          .map(m => ({ key: m.key, label: m.displayName }))
        setAvailableModels(withKey)
      })
      .catch(() => {})
  }, [])

  const [autoSave, setAutoSave] = useState(load('autoSave', 'true') === 'true')
  const [notifications, setNotifications] = useState(load('notifications', 'true') === 'true')
  const [theme, setTheme] = useState(load('theme', '深色 (默认)'))
  const [fontSize, setFontSize] = useState(load('fontSize', '14'))
  const [fontFamily, setFontFamily] = useState(load('fontFamily', 'Outfit'))
  const [debugMode, setDebugMode] = useState(load('debugMode', 'false') === 'true')
  const [savedMsg, setSavedMsg] = useState('')

  const showSaved = () => {
    setSavedMsg('✓ 已保存')
    setTimeout(() => setSavedMsg(''), 1500)
  }

  const updateSetting = (key: string, val: string, setter: (v: string) => void) => {
    setter(val)
    save(key, val)
    showSaved()
  }

  const updateToggle = (key: string, val: boolean, setter: (v: boolean) => void) => {
    setter(val)
    save(key, String(val))
    showSaved()
  }

  // Apply font size live
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`)
  }, [fontSize])

  // Apply font family live
  useEffect(() => {
    const FONT_MAP: Record<string, string> = {
      'Outfit': "'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
      'System': "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
      'SF Pro': "'SF Pro Text', -apple-system, BlinkMacSystemFont, sans-serif",
    }
    const stack = FONT_MAP[fontFamily] || FONT_MAP['Outfit']
    document.documentElement.style.setProperty('--font-sans', stack)
  }, [fontFamily])

  const sections = [
    { id: 'general', icon: '⚙️', label: '通用' },
    { id: 'models', icon: '🤖', label: '模型配置' },
    { id: 'appearance', icon: '🎨', label: '外观' },
    { id: 'editor', icon: '📝', label: '编辑器' },
    { id: 'keybindings', icon: '⌨️', label: '快捷键' },
    { id: 'privacy', icon: '🔒', label: '隐私' },
    { id: 'advanced', icon: '🛠', label: '高级' },
    { id: 'about', icon: 'ℹ️', label: '关于' },
  ]

  const KEYBINDINGS = [
    { keys: '⌘ P', desc: '文件浏览器' },
    { keys: '⌘ 1', desc: '对话页面' },
    { keys: '⌘ 2', desc: '监控面板' },
    { keys: '⌘ 3', desc: '文件浏览器' },
    { keys: '⌘ 4', desc: '变更视图' },
    { keys: 'Esc', desc: '关闭面板' },
    { keys: 'Enter', desc: '发送消息' },
    { keys: '⇧ Enter', desc: '换行' },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">⚙️ 设置</h1>
        {savedMsg && (
          <span style={{
            color: '#30d158', fontSize: 13, fontWeight: 500,
            animation: 'fadeIn 0.2s ease',
          }}>{savedMsg}</span>
        )}
      </div>
      <div className="page-body settings-layout">
        <div className="settings-nav">
          {sections.map(s => (
            <button
              key={s.id}
              className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => setActiveSection(s.id)}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <div className="settings-content">
          {activeSection === 'general' && (
            <div className="settings-section">
              <h2 className="settings-section-title">通用设置</h2>
              <div className="settings-group">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">界面语言</div>
                    <div className="settings-item-desc">选择 Web UI 的显示语言</div>
                  </div>
                  <select className="settings-select" value={language}
                    onChange={e => updateSetting('lang', e.target.value, setLanguage)}>
                    <option value="zh-CN">中文 (简体)</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">默认模型</div>
                    <div className="settings-item-desc">新对话默认使用的模型</div>
                  </div>
                  <select className="settings-select" value={defaultModel}
                    onChange={e => updateSetting('model', e.target.value, setDefaultModel)}>
                    {availableModels.map(m => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </select>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">自动保存会话</div>
                    <div className="settings-item-desc">自动保存对话记录到本地</div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={autoSave}
                      onChange={e => updateToggle('autoSave', e.target.checked, setAutoSave)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">系统通知</div>
                    <div className="settings-item-desc">长任务完成后发送系统通知</div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={notifications}
                      onChange={e => updateToggle('notifications', e.target.checked, setNotifications)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}
          {activeSection === 'models' && (
            <div className="settings-section">
              <h2 className="settings-section-title">模型配置</h2>
              <div className="settings-group">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">API Provider</div>
                    <div className="settings-item-desc">OpenAI-compatible API 端点</div>
                  </div>
                  <select className="settings-select" defaultValue="openai-compat">
                    <option value="openai-compat">OpenAI Compatible</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">API Base URL</div>
                    <div className="settings-item-desc">自定义 API 端点地址</div>
                  </div>
                  <input className="settings-input" type="text" placeholder="https://api.minimax.chat/v1"
                    style={{ width: 280, padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">Max Context Window</div>
                    <div className="settings-item-desc">模型最大上下文窗口 (tokens)</div>
                  </div>
                  <select className="settings-select" defaultValue="200000">
                    <option value="128000">128K</option>
                    <option value="200000">200K</option>
                    <option value="1000000">1M (Gemini)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          {activeSection === 'appearance' && (
            <div className="settings-section">
              <h2 className="settings-section-title">外观设置</h2>
              <div className="settings-group">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">主题</div>
                    <div className="settings-item-desc">选择界面主题</div>
                  </div>
                  <select className="settings-select" value={theme}
                    onChange={e => updateSetting('theme', e.target.value, setTheme)}>
                    <option>深色 (默认)</option>
                    <option>浅色</option>
                    <option>跟随系统</option>
                  </select>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">字体大小</div>
                    <div className="settings-item-desc">调整界面字体大小 (当前: {fontSize}px)</div>
                  </div>
                  <select className="settings-select" value={fontSize}
                    onChange={e => updateSetting('fontSize', e.target.value, setFontSize)}>
                    <option value="12">小 (12px)</option>
                    <option value="14">中 (14px)</option>
                    <option value="16">大 (16px)</option>
                  </select>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">字体</div>
                    <div className="settings-item-desc">选择界面显示字体 (当前: {fontFamily})</div>
                  </div>
                  <select className="settings-select" value={fontFamily}
                    onChange={e => updateSetting('fontFamily', e.target.value, setFontFamily)}>
                    <option value="Outfit">Outfit (推荐)</option>
                    <option value="SF Pro">SF Pro</option>
                    <option value="System">系统默认</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          {activeSection === 'editor' && (
            <div className="settings-section">
              <h2 className="settings-section-title">编辑器设置</h2>
              <div className="settings-group">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">Tab 宽度</div>
                    <div className="settings-item-desc">代码缩进的空格数</div>
                  </div>
                  <select className="settings-select" defaultValue="2">
                    <option value="2">2 空格</option>
                    <option value="4">4 空格</option>
                    <option value="8">8 空格</option>
                  </select>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">代码字体</div>
                    <div className="settings-item-desc">代码块和终端的字体</div>
                  </div>
                  <select className="settings-select" defaultValue="menlo">
                    <option value="menlo">Menlo</option>
                    <option value="firacode">Fira Code</option>
                    <option value="jetbrains">JetBrains Mono</option>
                  </select>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">显示行号</div>
                    <div className="settings-item-desc">在代码预览中显示行号</div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            </div>
          )}
          {activeSection === 'keybindings' && (
            <div className="settings-section">
              <h2 className="settings-section-title">键盘快捷键</h2>
              <div className="settings-group">
                {KEYBINDINGS.map(kb => (
                  <div key={kb.keys} className="settings-item">
                    <div className="settings-item-info">
                      <div className="settings-item-label">{kb.desc}</div>
                    </div>
                    <kbd style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'var(--text-secondary)',
                    }}>{kb.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeSection === 'privacy' && (
            <div className="settings-section">
              <h2 className="settings-section-title">隐私设置</h2>
              <div className="settings-group">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">遥测数据</div>
                    <div className="settings-item-desc">允许发送匿名使用统计以改善产品</div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">清除所有本地数据</div>
                    <div className="settings-item-desc">删除所有保存的会话、设置和缓存</div>
                  </div>
                  <button className="btn-danger" onClick={() => {
                    if (confirm('确定要清除所有本地数据吗？此操作不可撤销。')) {
                      localStorage.clear()
                      location.reload()
                    }
                  }}>🗑 清除数据</button>
                </div>
              </div>
            </div>
          )}
          {activeSection === 'advanced' && (
            <div className="settings-section">
              <h2 className="settings-section-title">高级设置</h2>
              <div className="settings-group">
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">环境诊断</div>
                    <div className="settings-item-desc">运行 /doctor 检查环境配置</div>
                  </div>
                  <button className="btn-secondary">🩺 运行诊断</button>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">调试模式</div>
                    <div className="settings-item-desc">输出详细调试日志到控制台</div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={debugMode}
                      onChange={e => updateToggle('debugMode', e.target.checked, setDebugMode)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="settings-item">
                  <div className="settings-item-info">
                    <div className="settings-item-label">Hooks 管理</div>
                    <div className="settings-item-desc">管理 PreToolUse / PostToolUse 钩子</div>
                  </div>
                  <button className="btn-secondary">📎 配置 Hooks</button>
                </div>
              </div>
            </div>
          )}
          {activeSection === 'about' && (
            <div className="settings-section">
              <h2 className="settings-section-title">关于 DolanClaw</h2>
              <div className="settings-about">
                <div className="about-logo">✦</div>
                <div className="about-name">DolanClaw</div>
                <div className="about-version">v1.0.0-beta</div>
                <div className="about-desc">原生国产大模型开发助手</div>
                <div className="about-links">
                  <button className="btn-secondary">📋 更新日志</button>
                  <button className="btn-secondary">💬 反馈</button>
                  <button className="btn-primary">⬆️ 检查更新</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
