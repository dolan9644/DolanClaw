import { useState, useEffect, useRef, useMemo } from 'react'
import type { PageId } from '../App'

interface CommandItem {
  id: string
  icon: string
  label: string
  desc?: string
  category: string
  action: () => void
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (page: PageId) => void
}

export function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // All available commands
  const commands: CommandItem[] = useMemo(() => [
    // Navigation
    { id: 'nav-chat', icon: '💬', label: '对话', desc: '返回聊天界面', category: '导航', action: () => onNavigate('chat') },
    { id: 'nav-dashboard', icon: '📊', label: '监控面板', desc: '查看运行统计', category: '导航', action: () => onNavigate('dashboard') },
    { id: 'nav-files', icon: '📁', label: '文件浏览器', desc: '浏览项目文件', category: '导航', action: () => onNavigate('files') },
    { id: 'nav-diff', icon: '📊', label: '变更视图', desc: '查看 Git 变更', category: '导航', action: () => onNavigate('diff') },
    { id: 'nav-tasks', icon: '📋', label: '任务看板', desc: '管理异步任务', category: '导航', action: () => onNavigate('tasks') },
    { id: 'nav-memory', icon: '🧠', label: '记忆', desc: '编辑 CLAUDE.md', category: '导航', action: () => onNavigate('memory') },
    { id: 'nav-mcp', icon: '🔌', label: 'MCP 服务器', desc: '管理 MCP 扩展', category: '导航', action: () => onNavigate('mcp') },
    { id: 'nav-skills', icon: '🧩', label: '技能 & 代理', desc: '查看已安装技能', category: '导航', action: () => onNavigate('skills') },
    { id: 'nav-tools', icon: '🔧', label: '工具浏览器', desc: '浏览可用工具', category: '导航', action: () => onNavigate('tools') },
    { id: 'nav-models', icon: '🤖', label: '模型管理', desc: '切换和配置模型', category: '导航', action: () => onNavigate('models') },
    { id: 'nav-permissions', icon: '🔐', label: '权限管理', desc: '管理工具权限', category: '导航', action: () => onNavigate('permissions') },
    { id: 'nav-sessions', icon: '📂', label: '会话管理', desc: '管理对话历史', category: '导航', action: () => onNavigate('sessions') },
    { id: 'nav-settings', icon: '⚙️', label: '设置', desc: '配置应用参数', category: '导航', action: () => onNavigate('settings') },

    // Actions
    { id: 'act-clear', icon: '🗑', label: '清除对话', desc: '清除当前对话消息', category: '操作', action: () => {
      localStorage.removeItem('dolanclaw-messages')
      onNavigate('chat')
    }},
    { id: 'act-theme-dark', icon: '🌙', label: '切换深色主题', desc: '使用深色背景', category: '主题', action: () => {
      localStorage.setItem('dolanclaw-theme', '深色 (默认)')
    }},
    { id: 'act-theme-light', icon: '☀️', label: '切换浅色主题', desc: '使用浅色背景', category: '主题', action: () => {
      localStorage.setItem('dolanclaw-theme', '浅色')
    }},
    { id: 'act-theme-system', icon: '🖥', label: '跟随系统主题', desc: '根据系统偏好自动切换', category: '主题', action: () => {
      localStorage.setItem('dolanclaw-theme', '跟随系统')
    }},
    { id: 'act-export', icon: '📤', label: '导出对话', desc: '导出当前对话为 JSON', category: '操作', action: () => {
      const msgs = localStorage.getItem('dolanclaw-messages')
      if (msgs) {
        const blob = new Blob([msgs], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `dolanclaw-chat-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      }
    }},
    { id: 'act-copy-session', icon: '📋', label: '复制会话 ID', desc: '复制当前模型和状态信息', category: '操作', action: () => {
      const info = `Model: ${localStorage.getItem('dolanclaw-model') || 'unknown'}\nPage: ${localStorage.getItem('dolanclaw-page') || 'chat'}`
      navigator.clipboard.writeText(info)
    }},
  ], [onNavigate])

  // Filter commands
  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      (c.desc || '').toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q)
    )
  }, [query, commands])

  // Group by category
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {}
    filtered.forEach(cmd => {
      if (!groups[cmd.category]) groups[cmd.category] = []
      groups[cmd.category].push(cmd)
    })
    return groups
  }, [filtered])

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector('.cmd-item.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      filtered[selectedIndex].action()
      onClose()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <span className="cmd-input-icon">⌘</span>
          <input
            ref={inputRef}
            className="cmd-input"
            type="text"
            placeholder="搜索命令、页面、操作..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmd-kbd">ESC</kbd>
        </div>
        <div className="cmd-list" ref={listRef}>
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="cmd-group">
              <div className="cmd-group-label">{category}</div>
              {items.map(item => {
                const idx = filtered.indexOf(item)
                return (
                  <div
                    key={item.id}
                    className={`cmd-item ${idx === selectedIndex ? 'selected' : ''}`}
                    onClick={() => { item.action(); onClose() }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="cmd-item-icon">{item.icon}</span>
                    <div className="cmd-item-info">
                      <span className="cmd-item-label">{item.label}</span>
                      {item.desc && <span className="cmd-item-desc">{item.desc}</span>}
                    </div>
                    {idx === selectedIndex && <kbd className="cmd-kbd-sm">↵</kbd>}
                  </div>
                )
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="cmd-empty">
              <span>🔍</span>
              <span>没有找到 "{query}" 相关的命令</span>
            </div>
          )}
        </div>
        <div className="cmd-footer">
          <span><kbd>↑↓</kbd> 导航</span>
          <span><kbd>↵</kbd> 执行</span>
          <span><kbd>ESC</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}
