import { useState, useEffect } from 'react'
import type { PageId } from '../App'
import {
  IconChat, IconDashboard, IconFolder, IconDiff,
  IconTasks, IconMemory, IconPlug, IconPuzzle,
  IconWrench, IconBot, IconShield, IconSessions, IconSettings,
} from './Icons'

// Fallback model list (only used if backend is unreachable)
const FALLBACK_MODELS = [
  { key: 'minimax-m2.7', label: 'MiniMax M2.7 旗舰' },
]

interface SidebarProps {
  currentPage: PageId
  onNavigate: (page: PageId) => void
  currentModel: string
  onModelChange: (model: string) => void
  isOpen?: boolean
}

export function Sidebar({
  currentPage,
  onNavigate,
  currentModel,
  onModelChange,
  isOpen,
}: SidebarProps) {
  const [taskBadge, setTaskBadge] = useState('')
  const [contextPct, setContextPct] = useState(0)
  const [availableModels, setAvailableModels] = useState(FALLBACK_MODELS)

  // Fetch models with valid API keys from backend
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => {
        const withKeys = data
          .filter(m => m.hasApiKey)
          .map(m => ({ key: m.key, label: m.displayName }))
        if (withKeys.length > 0) {
          setAvailableModels(withKeys)
          // If current model has no key, switch to first available
          if (!withKeys.find(m => m.key === currentModel)) {
            onModelChange(withKeys[0].key)
          }
        }
      })
      .catch(() => { /* use fallback */ })
  }, [])

  useEffect(() => {
    const update = () => {
      try {
        const tasks = JSON.parse(localStorage.getItem('dolanclaw-tasks') || '[]')
        const running = tasks.filter((t: any) => t.status === 'running').length
        setTaskBadge(running > 0 ? String(running) : '')
      } catch { setTaskBadge('') }

      // Calculate context from messages
      try {
        const msgs = JSON.parse(localStorage.getItem('dolanclaw-messages') || '[]')
        const totalChars = msgs.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0)
        const tokens = Math.floor(totalChars / 4)
        const pct = Math.min(100, Math.round((tokens / 200000) * 100))
        setContextPct(pct)
      } catch { setContextPct(0) }
    }
    update()
    const interval = setInterval(update, 2000)
    return () => clearInterval(interval)
  }, [])

  const sections = [
    {
      label: '核心',
      items: [
        { id: 'chat' as PageId, icon: <IconChat />, label: '对话' },
        { id: 'dashboard' as PageId, icon: <IconDashboard />, label: '监控面板' },
      ]
    },
    {
      label: '开发',
      items: [
        { id: 'files' as PageId, icon: <IconFolder />, label: '文件浏览器' },
        { id: 'diff' as PageId, icon: <IconDiff />, label: '变更视图' },
        { id: 'tasks' as PageId, icon: <IconTasks />, label: '任务看板', badge: taskBadge },
        { id: 'memory' as PageId, icon: <IconMemory />, label: '记忆' },
      ]
    },
    {
      label: '扩展',
      items: [
        { id: 'mcp' as PageId, icon: <IconPlug />, label: 'MCP 服务器' },
        { id: 'skills' as PageId, icon: <IconPuzzle />, label: '技能 & 代理' },
        { id: 'tools' as PageId, icon: <IconWrench />, label: '工具浏览器' },
      ]
    },
    {
      label: '系统',
      items: [
        { id: 'models' as PageId, icon: <IconBot />, label: '模型管理' },
        { id: 'permissions' as PageId, icon: <IconShield />, label: '权限管理' },
        { id: 'sessions' as PageId, icon: <IconSessions />, label: '会话管理' },
        { id: 'settings' as PageId, icon: <IconSettings />, label: '设置' },
      ]
    },
  ]

  const ctxClass = contextPct < 50 ? 'ctx-low' : contextPct < 80 ? 'ctx-mid' : 'ctx-high'

  return (
    <nav className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">D</div>
        <span className="sidebar-brand">DolanClaw</span>
      </div>

      <div className="sidebar-nav">
        {sections.map(section => (
          <div className="sidebar-section" key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items.map(item => (
              <button
                key={item.id}
                className={`sidebar-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="sidebar-item-icon">{item.icon}</span>
                <span>{item.label}</span>
                {item.badge && (
                  <span className="sidebar-item-badge">{item.badge}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <select
          className="sidebar-model-select"
          value={currentModel}
          onChange={(e) => onModelChange(e.target.value)}
        >
          {availableModels.map(m => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>

        {/* Context Window Bar */}
        <div className="context-bar">
          <div className="context-bar-header">
            <span>上下文窗口</span>
            <span>{contextPct}%</span>
          </div>
          <div className="context-bar-track">
            <div
              className={`context-bar-fill ${ctxClass}`}
              style={{ width: `${Math.max(contextPct, 1)}%` }}
            />
          </div>
        </div>

        <div className="sidebar-status">
          <span>
            <span className="sidebar-status-dot online" />
            已就绪
          </span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <kbd style={{
              padding: '1px 4px', fontSize: '9px', fontFamily: 'var(--font-mono)',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: '3px', color: 'var(--text-quaternary)',
            }}>⌘K</kbd>
            <kbd style={{
              padding: '1px 4px', fontSize: '9px', fontFamily: 'var(--font-mono)',
              background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
              borderRadius: '3px', color: 'var(--text-quaternary)',
            }}>?</kbd>
          </span>
        </div>
      </div>
    </nav>
  )
}
