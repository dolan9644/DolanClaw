import { useState, useEffect, useRef, useCallback } from 'react'
import type { PageId } from '../App'
import {
  IconChat, IconDashboard, IconFolder, IconDiff,
  IconTasks, IconMemory, IconPlug, IconPuzzle,
  IconWrench, IconStore, IconBot, IconShield, IconSessions, IconSettings,
} from './Icons'

// Fallback model list (only used if backend is unreachable)
const FALLBACK_MODELS = [
  { key: 'minimax-m2.7', label: 'MiniMax M2.7 旗舰' },
]

interface DirEntry {
  name: string
  path: string
  hasChildren: boolean
}

interface SavedWorkspace {
  path: string
  name: string
  lastUsed: number
}

// ─── Persistence helpers ────────────────────────────
const WORKSPACES_KEY = 'dolanclaw-workspaces'

function loadSavedWorkspaces(): SavedWorkspace[] {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACES_KEY) || '[]')
  } catch { return [] }
}

function saveWorkspaceToHistory(ws: { path: string; name: string }) {
  const list = loadSavedWorkspaces()
  const existing = list.findIndex(w => w.path === ws.path)
  if (existing !== -1) {
    list[existing].lastUsed = Date.now()
    list[existing].name = ws.name
  } else {
    list.unshift({ ...ws, lastUsed: Date.now() })
  }
  // Keep max 20 recent workspaces
  const trimmed = list.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 20)
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(trimmed))
}

function removeWorkspaceFromHistory(path: string) {
  const list = loadSavedWorkspaces().filter(w => w.path !== path)
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(list))
}

// ─── Directory Browser (used inside picker) ─────────
function DirectoryBrowser({
  initialPath,
  onSelect,
}: {
  initialPath: string
  onSelect: (path: string) => void
}) {
  const [browsePath, setBrowsePath] = useState(initialPath)
  const [dirs, setDirs] = useState<DirEntry[]>([])
  const [parent, setParent] = useState('')
  const [loading, setLoading] = useState(false)
  const [inputPath, setInputPath] = useState(initialPath)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/workspace/browse?path=${encodeURIComponent(browsePath)}`)
      .then(r => r.json())
      .then(data => {
        if (data.dirs) setDirs(data.dirs)
        if (data.parent) setParent(data.parent)
        if (data.current) {
          setInputPath(data.current)
          setBrowsePath(data.current)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [browsePath])

  return (
    <div className="workspace-browser">
      <div className="workspace-picker-pathbar">
        <input
          type="text"
          value={inputPath}
          onChange={e => setInputPath(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && inputPath.trim()) {
              setBrowsePath(inputPath.trim())
            }
          }}
          placeholder="输入路径..."
        />
        <button onClick={() => inputPath.trim() && setBrowsePath(inputPath.trim())}>前往</button>
      </div>

      <div className="workspace-picker-nav">
        {parent && parent !== browsePath && (
          <button
            className="workspace-picker-item workspace-picker-parent"
            onClick={() => setBrowsePath(parent)}
          >
            ⬆️ 上级目录
          </button>
        )}
      </div>

      <div className="workspace-picker-list">
        {/* Option to select the CURRENT browsed directory */}
        <div className="workspace-picker-item workspace-picker-select-current">
          <span className="workspace-picker-current-label">
            📍 当前目录: <code>{inputPath}</code>
          </span>
          <button
            className="workspace-picker-select-btn workspace-picker-select-btn-primary"
            onClick={() => onSelect(inputPath)}
          >
            选择此目录
          </button>
        </div>

        {loading ? (
          <div className="workspace-picker-loading">加载中...</div>
        ) : dirs.length === 0 ? (
          <div className="workspace-picker-empty">无子目录</div>
        ) : (
          dirs.map(d => (
            <div key={d.path} className="workspace-picker-item">
              <button
                className="workspace-picker-dirname"
                onClick={() => setBrowsePath(d.path)}
              >
                <span className="workspace-picker-icon">📁</span>
                <span>{d.name}</span>
              </button>
              <button
                className="workspace-picker-select-btn"
                onClick={() => onSelect(d.path)}
                title="选择此目录作为工作区"
              >
                选择
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Workspace Picker Modal ─────────────────────────
function WorkspacePicker({
  currentPath,
  onSelect,
  onClose,
}: {
  currentPath: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'recent' | 'browse'>('recent')
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>(loadSavedWorkspaces())
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  const handleDelete = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeWorkspaceFromHistory(path)
    setSavedWorkspaces(loadSavedWorkspaces())
  }

  return (
    <div className="workspace-picker-overlay">
      <div className="workspace-picker" ref={overlayRef}>
        <div className="workspace-picker-header">
          <span>📂 切换工作区</span>
          <button className="workspace-picker-close" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="workspace-picker-tabs">
          <button
            className={`workspace-tab ${tab === 'recent' ? 'active' : ''}`}
            onClick={() => setTab('recent')}
          >
            ⏱ 最近工作区
          </button>
          <button
            className={`workspace-tab ${tab === 'browse' ? 'active' : ''}`}
            onClick={() => setTab('browse')}
          >
            📁 浏览文件夹
          </button>
        </div>

        {tab === 'recent' ? (
          <div className="workspace-picker-list workspace-recent-list">
            {savedWorkspaces.length === 0 ? (
              <div className="workspace-picker-empty">
                暂无历史工作区<br/>
                <span style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                  点击"浏览文件夹"添加新的工作区
                </span>
              </div>
            ) : (
              savedWorkspaces.map(ws => (
                <div
                  key={ws.path}
                  className={`workspace-recent-item ${ws.path === currentPath ? 'active' : ''}`}
                  onClick={() => onSelect(ws.path)}
                >
                  <span className="workspace-recent-icon">
                    {ws.path === currentPath ? '✅' : '📂'}
                  </span>
                  <div className="workspace-recent-info">
                    <span className="workspace-recent-name">{ws.name}</span>
                    <span className="workspace-recent-path">{ws.path}</span>
                  </div>
                  <div className="workspace-recent-actions">
                    {ws.path === currentPath && (
                      <span className="workspace-recent-badge">当前</span>
                    )}
                    <button
                      className="workspace-recent-delete"
                      onClick={(e) => handleDelete(ws.path, e)}
                      title="删除此工作区记录"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <DirectoryBrowser
            initialPath={currentPath}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  )
}

// ─── Sidebar ────────────────────────────────────────
interface SidebarProps {
  currentPage: PageId
  onNavigate: (page: PageId) => void
  currentModel: string
  onModelChange: (model: string) => void
  isOpen?: boolean
  onWorkspaceChange?: (path: string, name: string) => void
}

export function Sidebar({
  currentPage,
  onNavigate,
  currentModel,
  onModelChange,
  isOpen,
  onWorkspaceChange,
}: SidebarProps) {
  const [taskBadge, setTaskBadge] = useState('')
  const [contextPct, setContextPct] = useState(0)
  const [availableModels, setAvailableModels] = useState(FALLBACK_MODELS)
  const [workspacePath, setWorkspacePath] = useState('')
  const [workspaceName, setWorkspaceName] = useState('...')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Fetch current workspace on mount
  useEffect(() => {
    fetch('/api/workspace')
      .then(r => r.json())
      .then(data => {
        if (data.path) {
          setWorkspacePath(data.path)
          setWorkspaceName(data.name || '...')
          // Save initial workspace to history
          saveWorkspaceToHistory({ path: data.path, name: data.name })
        }
      })
      .catch(() => {})
  }, [])

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
          if (!withKeys.find(m => m.key === currentModel)) {
            onModelChange(withKeys[0].key)
          }
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const update = () => {
      try {
        const tasks = JSON.parse(localStorage.getItem('dolanclaw-tasks') || '[]')
        const running = tasks.filter((t: any) => t.status === 'running').length
        setTaskBadge(running > 0 ? String(running) : '')
      } catch { setTaskBadge('') }

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

  const handleWorkspaceSelect = useCallback(async (dirPath: string) => {
    try {
      const res = await fetch('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      })
      const data = await res.json()
      if (data.ok) {
        setWorkspacePath(data.path)
        setWorkspaceName(data.name)
        setPickerOpen(false)
        // Persist to history
        saveWorkspaceToHistory({ path: data.path, name: data.name })
        // Notify parent (App) of workspace change
        onWorkspaceChange?.(data.path, data.name)
      } else {
        alert(data.error || '切换失败')
      }
    } catch {
      alert('网络错误')
    }
  }, [onWorkspaceChange])

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
        { id: 'registry' as PageId, icon: <IconStore />, label: '扩展市场' },
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

      {/* Workspace Selector */}
      <div className="sidebar-workspace" onClick={() => setPickerOpen(true)} title={workspacePath}>
        <span className="sidebar-workspace-icon">📂</span>
        <div className="sidebar-workspace-info">
          <span className="sidebar-workspace-name">{workspaceName}</span>
          <span className="sidebar-workspace-path">{workspacePath}</span>
        </div>
        <span className="sidebar-workspace-arrow">▸</span>
      </div>

      {pickerOpen && (
        <WorkspacePicker
          currentPath={workspacePath}
          onSelect={handleWorkspaceSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}

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
            <button
              className="sidebar-restart-btn"
              title="重启后端服务"
              onClick={async () => {
                if (!confirm('确定重启后端服务器？当前进行中的请求会中断。')) return

                // Create a visible overlay to show restart progress
                const overlay = document.createElement('div')
                overlay.id = 'restart-overlay'
                overlay.style.cssText = `
                  position: fixed; inset: 0; z-index: 99999;
                  background: rgba(0,0,0,0.75); backdrop-filter: blur(8px);
                  display: flex; flex-direction: column;
                  align-items: center; justify-content: center;
                  color: #fff; font-family: var(--font-sans, system-ui);
                `
                overlay.innerHTML = `
                  <div style="font-size: 36px; margin-bottom: 16px; animation: spin 1s linear infinite">🔄</div>
                  <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px">正在重启后端服务...</div>
                  <div id="restart-status" style="font-size: 13px; color: rgba(255,255,255,0.6)">发送重启请求中</div>
                  <style>@keyframes spin { to { transform: rotate(360deg) } }</style>
                `
                document.body.appendChild(overlay)

                const statusEl = document.getElementById('restart-status')

                try {
                  await fetch('/api/restart', { method: 'POST' })
                } catch { /* expected — server is restarting */ }

                if (statusEl) statusEl.textContent = '等待服务恢复...'

                // Poll until backend is back (max 15s)
                let recovered = false
                for (let i = 0; i < 30; i++) {
                  await new Promise(r => setTimeout(r, 500))
                  try {
                    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
                    if (res.ok) { recovered = true; break }
                  } catch { /* still restarting */ }
                  if (statusEl) statusEl.textContent = `等待服务恢复... (${Math.ceil((i + 1) / 2)}s)`
                }

                if (recovered) {
                  if (statusEl) statusEl.textContent = '✅ 服务已恢复，正在刷新...'
                  setTimeout(() => window.location.reload(), 800)
                } else {
                  if (statusEl) statusEl.textContent = '⚠️ 服务未响应，请手动刷新'
                  setTimeout(() => overlay.remove(), 3000)
                }
              }}
            >
              🔄
            </button>
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
