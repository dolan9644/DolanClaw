import { useState, useEffect } from 'react'
import type { PageId } from '../App'
import {
  IconChat, IconDashboard, IconFolder, IconDiff,
  IconTasks, IconMemory, IconPlug, IconPuzzle,
  IconWrench, IconBot, IconShield, IconSessions, IconSettings,
} from './Icons'

const MODELS = [
  { key: 'minimax-m2.7-hs', label: 'MiniMax M2.7 HS' },
  { key: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { key: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { key: 'gpt-4o', label: 'GPT-4o' },
  { key: 'gpt-4.1', label: 'GPT-4.1' },
  { key: 'o3', label: 'o3' },
  { key: 'deepseek-v3', label: 'DeepSeek V3' },
  { key: 'deepseek-r1', label: 'DeepSeek R1' },
  { key: 'kimi-32k', label: 'Kimi 32K' },
  { key: 'qwen-max', label: '通义千问 Max' },
  { key: 'glm-4-plus', label: 'GLM-4 Plus' },
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
          {MODELS.map(m => (
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
