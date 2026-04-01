import { useState, useEffect, useCallback } from 'react'

interface DiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

interface DiffHunk {
  header: string
  lines: { type: 'add' | 'remove' | 'context'; content: string; lineNum?: number }[]
}

const STATUS_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  added: { icon: '+', color: '#10b981', label: '新增' },
  modified: { icon: 'M', color: '#f59e0b', label: '修改' },
  deleted: { icon: '-', color: '#ef4444', label: '删除' },
  renamed: { icon: 'R', color: '#8b5cf6', label: '重命名' },
}

// Parse git diff output into structured data
function parseGitDiff(diffText: string, _statText: string): DiffFile[] {
  if (!diffText.trim()) return []

  const files: DiffFile[] = []
  const fileSections = diffText.split(/^diff --git /m).filter(Boolean)

  for (const section of fileSections) {
    const lines = section.split('\n')

    // Parse file path
    const pathMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/)
    const filePath = pathMatch?.[2] || pathMatch?.[1] || 'unknown'

    // Detect status
    let status: DiffFile['status'] = 'modified'
    if (section.includes('new file mode')) status = 'added'
    else if (section.includes('deleted file mode')) status = 'deleted'
    else if (section.includes('rename from')) status = 'renamed'

    // Parse hunks
    const hunks: DiffHunk[] = []
    let currentHunk: DiffHunk | null = null
    let additions = 0
    let deletions = 0

    for (const line of lines) {
      if (line.startsWith('@@')) {
        if (currentHunk) hunks.push(currentHunk)
        currentHunk = { header: line, lines: [] }
      } else if (currentHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1) })
          additions++
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentHunk.lines.push({ type: 'remove', content: line.slice(1) })
          deletions++
        } else if (line.startsWith(' ') || line === '') {
          currentHunk.lines.push({ type: 'context', content: line.slice(1) || '' })
        }
      }
    }
    if (currentHunk) hunks.push(currentHunk)

    files.push({ path: filePath, status, additions, deletions, hunks })
  }

  return files
}

export function DiffViewPage() {
  const [diffs, setDiffs] = useState<DiffFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified')
  const [showStaged, setShowStaged] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDiff = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/diff?staged=${showStaged}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const parsed = parseGitDiff(data.diff || '', data.stat || '')
      setDiffs(parsed)
      if (parsed.length > 0 && !selectedFile) {
        setSelectedFile(parsed[0].path)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [showStaged])

  useEffect(() => {
    fetchDiff()
  }, [fetchDiff])

  const totalAdditions = diffs.reduce((s, d) => s + d.additions, 0)
  const totalDeletions = diffs.reduce((s, d) => s + d.deletions, 0)
  const selectedDiff = diffs.find(d => d.path === selectedFile)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📊 变更视图</h1>
        <div className="page-header-actions">
          <span className="page-badge diff-add">+{totalAdditions}</span>
          <span className="page-badge diff-del">-{totalDeletions}</span>
          <div className="btn-group">
            <button
              className={`btn-toggle ${!showStaged ? 'active' : ''}`}
              onClick={() => setShowStaged(false)}
            >未暂存</button>
            <button
              className={`btn-toggle ${showStaged ? 'active' : ''}`}
              onClick={() => setShowStaged(true)}
            >已暂存</button>
          </div>
          <div className="btn-group">
            <button
              className={`btn-toggle ${viewMode === 'unified' ? 'active' : ''}`}
              onClick={() => setViewMode('unified')}
            >统一</button>
            <button
              className={`btn-toggle ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
            >并排</button>
          </div>
          <button className="btn-secondary" onClick={fetchDiff}>🔄 刷新</button>
        </div>
      </div>
      <div className="page-body diff-layout">
        {/* File List */}
        <div className="diff-file-list">
          <div className="diff-file-list-header">
            已变更文件 ({diffs.length})
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <div className="spinner" />
            </div>
          ) : error ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
              ⚠️ {error.includes('fetch') ? '后端未连接' : error}
            </div>
          ) : diffs.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              ✨ 工作区干净，无变更
            </div>
          ) : (
            diffs.map(diff => {
              const st = STATUS_ICONS[diff.status]
              return (
                <div
                  key={diff.path}
                  className={`diff-file-item ${selectedFile === diff.path ? 'selected' : ''}`}
                  onClick={() => setSelectedFile(diff.path)}
                >
                  <span className="diff-file-status" style={{ color: st.color }}>{st.icon}</span>
                  <span className="diff-file-path">{diff.path}</span>
                  <span className="diff-file-stats">
                    <span className="diff-stat-add">+{diff.additions}</span>
                    <span className="diff-stat-del">-{diff.deletions}</span>
                  </span>
                </div>
              )
            })
          )}
        </div>

        {/* Diff Content */}
        <div className="diff-content-area">
          {selectedDiff ? (
            <div className="diff-detail">
              <div className="diff-detail-header">
                <span className="diff-detail-path">{selectedDiff.path}</span>
                <span className="diff-detail-stats">
                  <span className="diff-stat-add">+{selectedDiff.additions}</span>
                  <span className="diff-stat-del">-{selectedDiff.deletions}</span>
                </span>
              </div>
              {selectedDiff.hunks.map((hunk, hi) => (
                <div key={hi} className="diff-hunk">
                  <div className="diff-hunk-header">{hunk.header}</div>
                  {hunk.lines.map((line, li) => (
                    <div key={li} className={`diff-line diff-${line.type}`}>
                      <span className="diff-indicator">
                        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                      </span>
                      <span className="diff-content">{line.content}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : diffs.length > 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-text">选择左侧文件查看变更详情</div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">✨</div>
              <div className="empty-state-text">无变更</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
