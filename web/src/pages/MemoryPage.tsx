import { useState, useEffect, useCallback } from 'react'

interface MemoryFile {
  path: string
  scope: 'project' | 'user' | 'team'
  content: string
  exists: boolean
  lastModified?: string
}

const SCOPES = ['project', 'user', 'team'] as const

const SCOPE_META: Record<string, { icon: string; label: string; color: string; desc: string }> = {
  project: { icon: '📁', label: '项目级', color: '#0a84ff', desc: '当前项目的 CLAUDE.md' },
  user: { icon: '👤', label: '用户级', color: '#30d158', desc: '~/.claude/CLAUDE.md' },
  team: { icon: '👥', label: '团队级', color: '#bf5af2', desc: '.claude/CLAUDE.md' },
}

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryFile[]>([])
  const [selectedScope, setSelectedScope] = useState<string>('project')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  // Fetch all memory scopes
  const fetchMemories = useCallback(async () => {
    setLoading(true)
    const results: MemoryFile[] = []
    for (const scope of SCOPES) {
      try {
        const res = await fetch(`/api/memory?scope=${scope}`)
        if (res.ok) {
          const data = await res.json()
          results.push({
            path: data.path,
            scope,
            content: data.content || '',
            exists: data.exists,
          })
        } else {
          results.push({
            path: `(${scope})`,
            scope,
            content: '',
            exists: false,
          })
        }
      } catch {
        results.push({
          path: `(${scope})`,
          scope,
          content: '',
          exists: false,
        })
      }
    }
    setMemories(results)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  const selectedMemory = memories.find(m => m.scope === selectedScope)

  const handleEdit = () => {
    if (selectedMemory) {
      setEditContent(selectedMemory.content)
      setEditing(true)
    }
  }

  const handleSave = async () => {
    if (!selectedMemory) return
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch('/api/memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: selectedMemory.scope,
          content: editContent,
        }),
      })
      if (res.ok) {
        setSaveStatus('success')
        setEditing(false)
        // Update local state
        setMemories(prev =>
          prev.map(m =>
            m.scope === selectedMemory.scope
              ? { ...m, content: editContent, exists: true }
              : m
          )
        )
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    if (!selectedMemory || selectedMemory.exists) return
    setEditContent(`# ${SCOPE_META[selectedMemory.scope].label}记忆\n\n## 注意事项\n- \n\n## 代码规范\n- \n`)
    setEditing(true)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">🧠 记忆管理</h1>
        <div className="page-header-actions">
          {saveStatus === 'success' && (
            <span style={{ color: '#30d158', fontSize: 12 }}>✓ 已保存</span>
          )}
          {saveStatus === 'error' && (
            <span style={{ color: '#ff453a', fontSize: 12 }}>✕ 保存失败</span>
          )}
          <button className="btn-secondary" onClick={fetchMemories}>🔄 刷新</button>
        </div>
      </div>
      <div className="page-body memory-layout">
        {/* Memory List */}
        <div className="memory-list">
          <div className="memory-list-header">记忆文件</div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <div className="spinner" />
            </div>
          ) : (
            memories.map(mem => {
              const scope = SCOPE_META[mem.scope]
              return (
                <div
                  key={mem.scope}
                  className={`memory-item ${selectedScope === mem.scope ? 'selected' : ''}`}
                  onClick={() => { setSelectedScope(mem.scope); setEditing(false) }}
                >
                  <div className="memory-item-header">
                    <span className="memory-item-icon">{scope.icon}</span>
                    <span className="memory-item-path">{mem.path}</span>
                  </div>
                  <div className="memory-item-footer">
                    <span className="memory-item-scope" style={{ color: scope.color }}>
                      {scope.label}
                    </span>
                    <span className="memory-item-time">
                      {mem.exists ? `${(mem.content.length / 1024).toFixed(1)} KB` : '未创建'}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Memory Editor */}
        <div className="memory-editor">
          {selectedMemory ? (
            <>
              <div className="memory-editor-header">
                <span className="memory-editor-path">
                  {selectedMemory.path}
                  {!selectedMemory.exists && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>
                      (不存在)
                    </span>
                  )}
                </span>
                <div className="memory-editor-actions">
                  {editing ? (
                    <>
                      <button className="btn-secondary" onClick={() => setEditing(false)}>取消</button>
                      <button
                        className="btn-primary"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? '保存中...' : '💾 保存'}
                      </button>
                    </>
                  ) : selectedMemory.exists ? (
                    <button className="btn-secondary" onClick={handleEdit}>✏️ 编辑</button>
                  ) : (
                    <button className="btn-primary" onClick={handleCreate}>➕ 新建 CLAUDE.md</button>
                  )}
                </div>
              </div>
              <div className="memory-editor-body">
                {editing ? (
                  <textarea
                    className="memory-textarea"
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    autoFocus
                  />
                ) : selectedMemory.exists ? (
                  <pre className="memory-preview">{selectedMemory.content}</pre>
                ) : (
                  <div className="empty-state">
                    <div className="empty-state-icon">📝</div>
                    <div className="empty-state-text">
                      {SCOPE_META[selectedMemory.scope].desc} 尚未创建
                    </div>
                    <button className="btn-primary" onClick={handleCreate}>
                      ➕ 创建 CLAUDE.md
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">🧠</div>
              <div className="empty-state-text">选择左侧记忆文件查看内容</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
