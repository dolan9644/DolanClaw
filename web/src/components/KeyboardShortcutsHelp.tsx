interface KeyboardShortcutsHelpProps {
  isOpen: boolean
  onClose: () => void
}

const SHORTCUTS = [
  {
    category: '全局',
    items: [
      { keys: ['⌘', 'K'], label: '打开命令面板' },
      { keys: ['⌘', 'P'], label: '打开文件浏览器' },
      { keys: ['⌘', '1'], label: '切换到对话' },
      { keys: ['⌘', '2'], label: '切换到监控面板' },
      { keys: ['⌘', '3'], label: '切换到文件浏览器' },
      { keys: ['⌘', '4'], label: '切换到变更视图' },
      { keys: ['ESC'], label: '关闭面板/弹窗' },
    ]
  },
  {
    category: '对话',
    items: [
      { keys: ['Enter'], label: '发送消息' },
      { keys: ['Shift', 'Enter'], label: '换行' },
      { keys: ['/'], label: '打开命令菜单' },
    ]
  },
  {
    category: '编辑',
    items: [
      { keys: ['⌘', 'C'], label: '复制选中文本' },
      { keys: ['⌘', 'V'], label: '粘贴' },
      { keys: ['⌘', 'Z'], label: '撤销' },
    ]
  },
]

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  if (!isOpen) return null

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-panel" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-header">
          <span className="shortcuts-title">⌨️ 键盘快捷键</span>
          <button className="shortcuts-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUTS.map(section => (
            <div key={section.category} className="shortcuts-section">
              <div className="shortcuts-section-label">{section.category}</div>
              {section.items.map((item, i) => (
                <div key={i} className="shortcuts-row">
                  <span className="shortcuts-label">{item.label}</span>
                  <div className="shortcuts-keys">
                    {item.keys.map((k, j) => (
                      <span key={j}>
                        <kbd className="shortcuts-kbd">{k}</kbd>
                        {j < item.keys.length - 1 && <span className="shortcuts-plus">+</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="shortcuts-footer">
          按 <kbd className="shortcuts-kbd">?</kbd> 随时查看此帮助
        </div>
      </div>
    </div>
  )
}
