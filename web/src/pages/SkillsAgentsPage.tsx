import { useState, useEffect, useCallback } from 'react'

// ─── Types ──────────────────────────────────────────────

interface Skill {
  name: string
  source: 'builtin' | 'project' | 'user' | 'plugin'
  description: string
  trigger: string
  active: boolean
  filePath: string
  content: string
}

interface AgentRunRecord {
  id: string
  time: string
  task: string
  status: 'completed' | 'error'
  durationMs: number
  outputPreview: string
}

interface AgentConfig {
  model: string
  tools: string[]
  systemPrompt: string
}

interface Agent {
  name: string
  type: 'built-in' | 'custom'
  description: string
  status: 'idle' | 'running' | 'completed' | 'error'
  lastRun: string | null
  history: AgentRunRecord[]
  config: AgentConfig
}

interface ModelOption {
  key: string
  displayName: string
  hasApiKey: boolean
}

interface ToolOption {
  name: string
  description: string
}

// ─── Demo Skills ────────────────────────────────────────

// Removed DEMO_SKILLS — now fetched from /api/skills

const SOURCE_META: Record<string, { icon: string; label: string; color: string }> = {
  builtin: { icon: '📦', label: '内置', color: '#0a84ff' },
  project: { icon: '📁', label: '项目', color: '#30d158' },
  user: { icon: '👤', label: '用户', color: '#ff9f0a' },
  plugin: { icon: '🧩', label: '插件', color: '#bf5af2' },
}

const STATUS_META: Record<string, { icon: string; label: string; color: string; glow?: string }> = {
  idle: { icon: '⏸', label: '空闲', color: '#8e8e93' },
  running: { icon: '', label: '运行中', color: '#0a84ff', glow: '0 0 8px rgba(10,132,255,0.6)' },
  completed: { icon: '✓', label: '完成', color: '#30d158' },
  error: { icon: '✕', label: '错误', color: '#ff453a' },
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

// ─── Agent Config Modal ─────────────────────────────────

function AgentConfigModal({
  agent, models, tools, onSave, onClose,
}: {
  agent: Agent
  models: ModelOption[]
  tools: ToolOption[]
  onSave: (config: Partial<AgentConfig>) => void
  onClose: () => void
}) {
  const [model, setModel] = useState(agent.config.model)
  const [selectedTools, setSelectedTools] = useState<string[]>(agent.config.tools)
  const [systemPrompt, setSystemPrompt] = useState(agent.config.systemPrompt)

  const toggleTool = (name: string) => {
    setSelectedTools(prev =>
      prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]
    )
  }

  const handleSave = () => {
    onSave({ model, tools: selectedTools, systemPrompt })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="agent-config-modal animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="agent-config-header">
          <h3>⚙️ {agent.name} 配置</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div className="agent-config-body">
          {/* Model Selection */}
          <div className="agent-config-field">
            <label className="agent-config-label">模型</label>
            <select
              className="agent-config-select"
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              {models.filter(m => m.hasApiKey).map(m => (
                <option key={m.key} value={m.key}>{m.displayName}</option>
              ))}
              {models.filter(m => !m.hasApiKey).length > 0 && (
                <optgroup label="未配置 Key">
                  {models.filter(m => !m.hasApiKey).map(m => (
                    <option key={m.key} value={m.key} disabled>{m.displayName} (无 Key)</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Tool Selection */}
          <div className="agent-config-field">
            <label className="agent-config-label">可用工具</label>
            <div className="agent-config-tools-grid">
              {tools.map(t => (
                <label
                  key={t.name}
                  className={`agent-config-tool-chip ${selectedTools.includes(t.name) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedTools.includes(t.name)}
                    onChange={() => toggleTool(t.name)}
                    style={{ display: 'none' }}
                  />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* System Prompt */}
          <div className="agent-config-field">
            <label className="agent-config-label">系统提示词</label>
            <textarea
              className="agent-config-textarea"
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={4}
              placeholder="输入代理的系统提示词..."
            />
          </div>
        </div>

        <div className="agent-config-footer">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={handleSave}>保存配置</button>
        </div>
      </div>
    </div>
  )
}

// ─── Agent Run Modal ────────────────────────────────────

function AgentRunModal({
  agent, onRun, onClose,
}: {
  agent: Agent
  onRun: (task: string) => void
  onClose: () => void
}) {
  const [task, setTask] = useState('')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="agent-run-modal animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="agent-config-header">
          <h3>▶ 运行 {agent.name}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="agent-config-body">
          <div className="agent-config-field">
            <label className="agent-config-label">任务描述</label>
            <textarea
              className="agent-config-textarea"
              value={task}
              onChange={e => setTask(e.target.value)}
              rows={3}
              placeholder={`告诉 ${agent.name} 你想让它做什么...`}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && task.trim()) {
                  e.preventDefault()
                  onRun(task)
                }
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: -4 }}>
            模型: {agent.config.model} · 工具: {agent.config.tools.length} 个
          </div>
        </div>
        <div className="agent-config-footer">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button
            className="btn-primary"
            onClick={() => task.trim() && onRun(task)}
            disabled={!task.trim()}
          >
            ▶ 开始执行
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Agent Result Modal ─────────────────────────────────

function AgentResultModal({
  result, onClose,
}: {
  result: { agentName: string; status: string; output?: string; error?: string; durationMs: number }
  onClose: () => void
}) {
  const isError = result.status === 'error'
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="agent-run-modal animate-slide-up" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
        <div className="agent-config-header">
          <h3>{isError ? '✕' : '✓'} {result.agentName} 执行{isError ? '失败' : '完成'}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="agent-config-body">
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
            耗时: {formatDuration(result.durationMs)}
          </div>
          <pre className="agent-result-output" style={{
            background: 'var(--bg-tertiary)',
            color: isError ? 'var(--error)' : 'var(--text-primary)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 400,
            overflow: 'auto',
          }}>
            {result.output || result.error || '(无输出)'}
          </pre>
        </div>
        <div className="agent-config-footer">
          <button
            className="btn-secondary"
            onClick={() => {
              navigator.clipboard.writeText(result.output || result.error || '')
            }}
          >📋 复制</button>
          <button className="btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────

export function SkillsAgentsPage() {
  const [activeTab, setActiveTab] = useState<'skills' | 'agents'>('agents')
  const [skills, setSkills] = useState<Skill[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null)
  const [configAgent, setConfigAgent] = useState<Agent | null>(null)
  const [runAgent, setRunAgent] = useState<Agent | null>(null)
  const [runResult, setRunResult] = useState<{
    agentName: string; status: string; output?: string; error?: string; durationMs: number
  } | null>(null)

  // Available models and tools for config
  const [models, setModels] = useState<ModelOption[]>([])
  const [toolOptions, setToolOptions] = useState<ToolOption[]>([])

  // Fetch agents from backend
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setAgents(data)
      }
    } catch { /* use current state */ }
    finally { setLoading(false) }
  }, [])

  // Fetch skills from backend
  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/skills')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setSkills(data)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchAgents()
    fetchSkills()
    const interval = setInterval(fetchAgents, 5000)
    return () => clearInterval(interval)
  }, [fetchAgents, fetchSkills])

  // Toggle skill active state
  const handleToggleSkill = async (skill: Skill) => {
    if (!skill.filePath) return // Can't toggle builtin
    const newActive = !skill.active
    setSkills(prev => prev.map(s => s.name === skill.name ? { ...s, active: newActive } : s))
    try {
      await fetch('/api/skills/toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: skill.filePath, active: newActive }),
      })
    } catch { /* revert on error */ fetchSkills() }
  }

  // Fetch models and tools for config modal
  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        setModels(data.map((m: ModelOption & Record<string, unknown>) => ({
          key: m.key, displayName: m.displayName, hasApiKey: m.hasApiKey,
        })))
      }
    }).catch(() => {})

    fetch('/api/tools').then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        setToolOptions(data.map((t: ToolOption & Record<string, unknown>) => ({
          name: t.name, description: t.description,
        })))
      }
    }).catch(() => {})
  }, [])

  // Save agent config
  const handleSaveConfig = async (agentName: string, config: Partial<AgentConfig>) => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setConfigAgent(null)
        fetchAgents() // Refresh
      }
    } catch { /* ignore */ }
  }

  // Run agent
  const handleRunAgent = async (agentName: string, task: string) => {
    setRunAgent(null) // Close modal

    // Optimistic: mark as running
    setAgents(prev => prev.map(a =>
      a.name === agentName ? { ...a, status: 'running' as const } : a
    ))

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      })
      const data = await res.json()
      setRunResult({
        agentName,
        status: data.status || (data.error ? 'error' : 'completed'),
        output: data.output,
        error: data.error,
        durationMs: data.durationMs || 0,
      })
      fetchAgents() // Refresh state
    } catch (err) {
      setRunResult({
        agentName,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      })
      fetchAgents()
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">
          {activeTab === 'skills' ? '🧩 技能中心' : '🤖 代理管理'}
        </h1>
        <div className="page-header-actions">
          <div className="btn-group">
            <button
              className={`btn-toggle ${activeTab === 'skills' ? 'active' : ''}`}
              onClick={() => setActiveTab('skills')}
            >🧩 技能</button>
            <button
              className={`btn-toggle ${activeTab === 'agents' ? 'active' : ''}`}
              onClick={() => setActiveTab('agents')}
            >🤖 代理</button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {activeTab === 'skills' ? (
          <div className="skills-grid">
            {skills.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px', gridColumn: '1/-1' }}>
                <div className="empty-state-icon">🧩</div>
                <div className="empty-state-text">未发现自定义技能</div>
                <div className="empty-state-hint" style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
                  在 .claude/skills/ 目录下创建 .md 文件即可添加技能
                </div>
              </div>
            ) : skills.map(skill => {
              const src = SOURCE_META[skill.source] || SOURCE_META.builtin
              const isExpanded = expandedSkill === skill.name
              return (
                <div
                  key={skill.name}
                  className={`skill-card ${skill.active ? '' : 'inactive'}`}
                  onClick={() => setExpandedSkill(isExpanded ? null : skill.name)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="skill-card-header">
                    <span className="skill-card-name">{skill.name}</span>
                    <span className="skill-card-source" style={{ color: src.color }}>
                      {src.icon} {src.label}
                    </span>
                  </div>
                  <div className="skill-card-desc">{skill.description}</div>
                  <div className="skill-card-footer">
                    <span className="skill-card-trigger">触发: {skill.trigger}</span>
                    {skill.filePath && (
                      <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={skill.active}
                          onChange={() => handleToggleSkill(skill)}
                        />
                        <span className="toggle-slider" />
                      </label>
                    )}
                  </div>
                  {isExpanded && skill.content && (
                    <div style={{
                      marginTop: 8, padding: '8px 10px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.03)', fontSize: 12,
                      lineHeight: 1.6, maxHeight: 200, overflow: 'auto',
                      whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)', borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      {skill.content}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : loading ? (
          <div className="page-loading">
            <div className="spinner" />
            <span>加载代理列表...</span>
          </div>
        ) : (
          <div className="agents-list">
            {agents.map(agent => {
              const st = STATUS_META[agent.status] || STATUS_META.idle
              const isExpanded = expandedAgent === agent.name
              return (
                <div key={agent.name} className="agent-card-v2">
                  {/* Card Header */}
                  <div
                    className="agent-card-v2-header"
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}
                  >
                    <div className="agent-status-dot-wrap">
                      {agent.status === 'running' ? (
                        <span className="spinner-small" />
                      ) : (
                        <span
                          className="agent-status-dot"
                          style={{ background: st.color, boxShadow: st.glow || 'none' }}
                        />
                      )}
                    </div>
                    <div className="agent-card-v2-info">
                      <div className="agent-card-v2-top">
                        <span className="agent-card-v2-name">{agent.name}</span>
                        <span className={`agent-card-type type-${agent.type}`}>
                          {agent.type === 'built-in' ? '内置' : '自定义'}
                        </span>
                        <span className="agent-card-v2-status" style={{ color: st.color }}>
                          {st.label}
                        </span>
                      </div>
                      <div className="agent-card-v2-desc">{agent.description}</div>
                      <div className="agent-card-v2-meta">
                        <span>模型: {agent.config.model}</span>
                        <span>工具: {agent.config.tools.length} 个</span>
                        {agent.lastRun && <span>上次运行: {formatTimeAgo(agent.lastRun)}</span>}
                        <span>历史: {agent.history.length} 次</span>
                      </div>
                    </div>
                    <div className="agent-card-v2-actions">
                      <button
                        className="agent-action-btn agent-action-run"
                        title="运行代理"
                        onClick={e => { e.stopPropagation(); setRunAgent(agent) }}
                        disabled={agent.status === 'running'}
                      >
                        {agent.status === 'running' ? '⏳' : '▶'}
                      </button>
                      <button
                        className="agent-action-btn agent-action-config"
                        title="编辑配置"
                        onClick={e => { e.stopPropagation(); setConfigAgent(agent) }}
                      >
                        ⚙️
                      </button>
                      <span className="agent-expand-arrow" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }}>
                        ▾
                      </span>
                    </div>
                  </div>

                  {/* Expanded: History Timeline */}
                  {isExpanded && (
                    <div className="agent-history-panel animate-slide-up">
                      <div className="agent-history-title">执行历史</div>
                      {agent.history.length === 0 ? (
                        <div className="agent-history-empty">暂无执行记录</div>
                      ) : (
                        <div className="agent-history-timeline">
                          {agent.history.map(record => (
                            <div key={record.id} className={`agent-history-item status-${record.status}`}>
                              <div className="agent-history-dot" style={{
                                background: record.status === 'completed' ? '#30d158' : '#ff453a',
                              }} />
                              <div className="agent-history-content">
                                <div className="agent-history-top">
                                  <span className="agent-history-time">{record.time}</span>
                                  <span className="agent-history-task">{record.task}</span>
                                  <span className="agent-history-duration">{formatDuration(record.durationMs)}</span>
                                </div>
                                {record.outputPreview && (
                                  <div className="agent-history-preview">
                                    {record.outputPreview.slice(0, 150)}
                                    {record.outputPreview.length > 150 ? '...' : ''}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Config Modal */}
      {configAgent && (
        <AgentConfigModal
          agent={configAgent}
          models={models}
          tools={toolOptions}
          onSave={config => handleSaveConfig(configAgent.name, config)}
          onClose={() => setConfigAgent(null)}
        />
      )}

      {/* Run Modal */}
      {runAgent && (
        <AgentRunModal
          agent={runAgent}
          onRun={task => handleRunAgent(runAgent.name, task)}
          onClose={() => setRunAgent(null)}
        />
      )}

      {/* Result Modal */}
      {runResult && (
        <AgentResultModal
          result={runResult}
          onClose={() => setRunResult(null)}
        />
      )}
    </div>
  )
}
