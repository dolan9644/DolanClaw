import { useState, useEffect, useCallback } from 'react'
import { IconCheck, IconX, IconAlert, IconInfo, IconCopy, IconFile, IconMenu } from './components/Icons'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { DashboardPage } from './pages/DashboardPage'
import { ModelsPage } from './pages/ModelsPage'
import { FileBrowserPage } from './pages/FileBrowserPage'
import { DiffViewPage } from './pages/DiffViewPage'
import { TaskBoardPage } from './pages/TaskBoardPage'
import { MemoryPage } from './pages/MemoryPage'
import { McpPage } from './pages/McpPage'
import { SkillsAgentsPage } from './pages/SkillsAgentsPage'
import { ToolsPage } from './pages/ToolsPage'
import { RegistryPage } from './pages/RegistryPage'
import { PermissionsPage, SessionsPage, SettingsPage } from './pages/MorePages'
import { CommandPalette } from './components/CommandPalette'
import { KeyboardShortcutsHelp } from './components/KeyboardShortcutsHelp'
import './index.css'

export type PageId =
  | 'chat' | 'dashboard'
  | 'files' | 'diff' | 'tasks' | 'memory'
  | 'mcp' | 'skills' | 'tools' | 'registry'
  | 'models' | 'permissions' | 'sessions' | 'settings'

// ─── Syntax highlighting helpers ─────────────────────────
const KEYWORDS = new Set([
  'import', 'export', 'from', 'const', 'let', 'var', 'function', 'class',
  'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break',
  'continue', 'new', 'this', 'async', 'await', 'try', 'catch', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'default', 'extends', 'implements',
  'interface', 'type', 'enum', 'public', 'private', 'protected', 'static',
  'readonly', 'abstract', 'override', 'as', 'is', 'keyof', 'true', 'false',
  'null', 'undefined', 'void', 'never', 'any', 'string', 'number', 'boolean',
])

function highlightLine(line: string, lang?: string): React.ReactNode {
  if (!lang || !['typescript', 'javascript', 'ts', 'tsx', 'js', 'jsx'].includes(lang)) {
    return <>{line}</>
  }
  // Simple regex-based highlighting
  const parts: React.ReactNode[] = []
  let remaining = line
  let key = 0
  while (remaining.length > 0) {
    // Comments
    const commentMatch = remaining.match(/^(\/\/.*)/)
    if (commentMatch) {
      parts.push(<span key={key++} className="hl-comment">{commentMatch[1]}</span>)
      remaining = remaining.slice(commentMatch[1].length)
      continue
    }
    // Strings
    const stringMatch = remaining.match(/^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/)
    if (stringMatch) {
      parts.push(<span key={key++} className="hl-string">{stringMatch[1]}</span>)
      remaining = remaining.slice(stringMatch[1].length)
      continue
    }
    // Numbers
    const numMatch = remaining.match(/^(\b\d+\.?\d*\b)/)
    if (numMatch) {
      parts.push(<span key={key++} className="hl-number">{numMatch[1]}</span>)
      remaining = remaining.slice(numMatch[1].length)
      continue
    }
    // Keywords
    const kwMatch = remaining.match(/^(\b[a-zA-Z_$]\w*\b)/)
    if (kwMatch && KEYWORDS.has(kwMatch[1])) {
      parts.push(<span key={key++} className="hl-keyword">{kwMatch[1]}</span>)
      remaining = remaining.slice(kwMatch[1].length)
      continue
    }
    // Default: take one char
    parts.push(<span key={key++}>{remaining[0]}</span>)
    remaining = remaining.slice(1)
  }
  return <>{parts}</>
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>(() => {
    return (localStorage.getItem('dolanclaw-page') as PageId) || 'chat'
  })
  const [currentModel, setCurrentModel] = useState(() => {
    return localStorage.getItem('dolanclaw-model') || 'minimax-m2.7'
  })
  const [panelOpen, setPanelOpen] = useState(false)
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [panelContent, setPanelContent] = useState<{
    title: string
    content: string
    language?: string
  } | null>(null)

  // Toast notification state
  const [toasts, setToasts] = useState<Array<{
    id: number; type: 'success' | 'error' | 'info' | 'warning'; message: string; exiting?: boolean
  }>>([])

  const addToast = useCallback((type: 'success' | 'error' | 'info' | 'warning', message: string) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t))
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300)
    }, 3000)
  }, [])

  // Persist page and model
  useEffect(() => {
    localStorage.setItem('dolanclaw-page', currentPage)
  }, [currentPage])
  useEffect(() => {
    localStorage.setItem('dolanclaw-model', currentModel)
  }, [currentModel])

  // Theme management
  useEffect(() => {
    const applyTheme = () => {
      const saved = localStorage.getItem('dolanclaw-theme') || '深色 (默认)'
      if (saved === '浅色') {
        document.documentElement.setAttribute('data-theme', 'light')
      } else if (saved === '跟随系统') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
      } else {
        document.documentElement.removeAttribute('data-theme')
      }
    }
    applyTheme()
    // Listen for storage changes (from Settings page)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dolanclaw-theme') applyTheme()
    }
    window.addEventListener('storage', onStorage)
    // Also poll for same-tab changes
    const interval = setInterval(applyTheme, 1000)
    return () => { window.removeEventListener('storage', onStorage); clearInterval(interval) }
  }, [])

  const openPanel = (title: string, content: string, language?: string) => {
    setPanelContent({ title, content, language })
    setPanelOpen(true)
  }

  // ─── Global Keyboard Shortcuts ──────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey

    // Escape: close panel or command palette
    if (e.key === 'Escape') {
      if (cmdPaletteOpen) {
        setCmdPaletteOpen(false)
        e.preventDefault()
        return
      }
      if (panelOpen) {
        setPanelOpen(false)
        e.preventDefault()
      }
      return
    }

    // Cmd/Ctrl+K: toggle command palette
    if (isMod && e.key === 'k') {
      e.preventDefault()
      setCmdPaletteOpen(prev => !prev)
      return
    }

    // ? key: toggle keyboard shortcuts help (only when not typing)
    if (e.key === '?' && !isMod && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault()
      setShortcutsOpen(prev => !prev)
      return
    }

    // Cmd/Ctrl+P: go to files
    if (isMod && e.key === 'p') {
      e.preventDefault()
      setCurrentPage('files')
      return
    }

    // Cmd/Ctrl+B: toggle sidebar (handled by CSS)
    // Cmd/Ctrl+1: Chat
    if (isMod && e.key === '1') {
      e.preventDefault()
      setCurrentPage('chat')
      return
    }
    // Cmd/Ctrl+2: Dashboard
    if (isMod && e.key === '2') {
      e.preventDefault()
      setCurrentPage('dashboard')
      return
    }
    // Cmd/Ctrl+3: Files
    if (isMod && e.key === '3') {
      e.preventDefault()
      setCurrentPage('files')
      return
    }
    // Cmd/Ctrl+4: Diff
    if (isMod && e.key === '4') {
      e.preventDefault()
      setCurrentPage('diff')
      return
    }
  }, [panelOpen, cmdPaletteOpen])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const renderPage = () => {
    switch (currentPage) {
      case 'chat':
        return (
          <ChatPage
            currentModel={currentModel}
            onOpenFile={openPanel}
          />
        )
      case 'dashboard':
        return <DashboardPage />
      case 'files':
        return <FileBrowserPage onOpenFile={openPanel} />
      case 'diff':
        return <DiffViewPage />
      case 'tasks':
        return <TaskBoardPage />
      case 'memory':
        return <MemoryPage />
      case 'mcp':
        return <McpPage />
      case 'skills':
        return <SkillsAgentsPage />
      case 'tools':
        return <ToolsPage />
      case 'registry':
        return <RegistryPage />
      case 'models':
        return (
          <ModelsPage
            currentModel={currentModel}
            onSelectModel={setCurrentModel}
          />
        )
      case 'permissions':
        return <PermissionsPage />
      case 'sessions':
        return <SessionsPage />
      case 'settings':
        return <SettingsPage />
      default:
        return null
    }
  }

  // Line-numbered + highlighted content
  const renderPanelContent = () => {
    if (!panelContent) return null
    const lines = panelContent.content.split('\n')
    const gutterWidth = String(lines.length).length
    return (
      <div className="panel-code">
        {lines.map((line, i) => (
          <div key={i} className="panel-code-line">
            <span className="panel-line-num" style={{ width: `${gutterWidth + 1}ch` }}>
              {i + 1}
            </span>
            <span className="panel-line-text">
              {highlightLine(line, panelContent.language)}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="app-layout">
      {/* Mobile sidebar toggle */}
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(prev => !prev)}><IconMenu /></button>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => { setCurrentPage(page); setSidebarOpen(false) }}
        currentModel={currentModel}
        onModelChange={setCurrentModel}
        isOpen={sidebarOpen}
        onWorkspaceChange={(path, name) => {
          addToast('success', `已切换工作区至 ${name}`)
          setCurrentPage('chat')
          setSidebarOpen(false)
          // Dispatch custom event so ChatPage can add a system message
          window.dispatchEvent(new CustomEvent('dolanclaw-workspace-change', {
            detail: { path, name },
          }))
        }}
      />
      <div className="main-content">
        {renderPage()}

        {/* Right Panel — File Preview / Artifacts */}
        <div className={`right-panel ${panelOpen ? '' : 'collapsed'}`}>
          <div className="right-panel-header">
            <span className="right-panel-title">
              {panelContent?.title || '文件预览'}
            </span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {panelContent && (
                <button
                  className="btn-icon"
                  title="复制内容"
                  onClick={() => {
                    navigator.clipboard.writeText(panelContent.content)
                    addToast('success', '已复制到剪贴板')
                  }}
                ><IconCopy size={14} /></button>
              )}
              <button
                className="right-panel-close"
                onClick={() => setPanelOpen(false)}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="right-panel-body">
            {panelContent ? (
              renderPanelContent()
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon"><IconFile size={32} /></div>
                <div className="empty-state-text">点击文件名可在此预览</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette
        isOpen={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        onNavigate={(page) => {
          setCurrentPage(page)
          setCmdPaletteOpen(false)
        }}
      />

      {/* Keyboard Shortcuts Help (?) */}
      <KeyboardShortcutsHelp
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast toast-${t.type} ${t.exiting ? 'toast-exit' : ''}`}>
              <span className="toast-icon">
                {t.type === 'success' ? <IconCheck size={14} /> : t.type === 'error' ? <IconX size={14} /> : t.type === 'warning' ? <IconAlert size={14} /> : <IconInfo size={14} />}
              </span>
              <span className="toast-text">{t.message}</span>
              <button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
