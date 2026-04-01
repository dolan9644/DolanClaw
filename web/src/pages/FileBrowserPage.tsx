import { useState, useEffect, useMemo, useCallback } from 'react'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  size?: number
  extension?: string
  status?: 'added' | 'modified' | 'deleted' | 'untracked'
}

const FILE_ICONS: Record<string, string> = {
  ts: '🟦', tsx: '⚛️', js: '🟨', jsx: '⚛️',
  json: '📋', md: '📝', css: '🎨', html: '🌐',
  sh: '⚙️', yaml: '📄', yml: '📄', toml: '📄',
  py: '🐍', rs: '🦀', go: '🐹', rb: '💎',
  swift: '🐦', kt: '🟪', dart: '🎯',
}

function getFileIcon(name: string, ext?: string): string {
  const extension = ext || (name.includes('.') ? name.split('.').pop() || '' : '')
  return FILE_ICONS[extension] || '📄'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileTreeNode({ node, depth, onSelect, selectedPath, onExpand }: {
  node: FileNode
  depth: number
  onSelect: (node: FileNode) => void
  selectedPath: string | null
  onExpand: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)

  const handleClick = () => {
    if (node.type === 'directory') {
      if (!expanded) {
        onExpand(node.path)
      }
      setExpanded(!expanded)
    } else {
      onSelect(node)
    }
  }

  const isSelected = selectedPath === node.path

  return (
    <>
      <div
        className={`file-tree-item ${isSelected ? 'selected' : ''} ${node.status || ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
      >
        <span className="file-tree-icon">
          {node.type === 'directory'
            ? (expanded ? '📂' : '📁')
            : getFileIcon(node.name, node.extension)
          }
        </span>
        <span className="file-tree-name">{node.name}</span>
        {node.status && (
          <span className={`file-tree-status status-${node.status}`}>
            {node.status === 'modified' ? 'M' : node.status === 'added' ? 'A' : node.status === 'deleted' ? 'D' : 'U'}
          </span>
        )}
        {node.type === 'file' && node.size != null && (
          <span className="file-tree-size">{formatSize(node.size)}</span>
        )}
        {node.type === 'directory' && (
          <span className="file-tree-chevron">{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      {node.type === 'directory' && expanded && node.children && (
        node.children.map(child => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onSelect={onSelect}
            selectedPath={selectedPath}
            onExpand={onExpand}
          />
        ))
      )}
    </>
  )
}

interface FileBrowserPageProps {
  onOpenFile: (title: string, content: string, language?: string) => void
}

export function FileBrowserPage({ onOpenFile }: FileBrowserPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [tree, setTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [dirCount, setDirCount] = useState(0)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState('')
  const [previewLang, setPreviewLang] = useState('text')
  const [previewSize, setPreviewSize] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Fetch file tree from backend
  const fetchTree = useCallback(async (path?: string) => {
    try {
      setLoading(true)
      setError(null)
      const url = path
        ? `/api/files/tree?path=${encodeURIComponent(path)}`
        : '/api/files/tree'
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      setTree(data)
      const counts = countNodesInner(data)
      setFileCount(counts.files)
      setDirCount(counts.dirs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTree()
  }, [fetchTree])

  // Handle file selection — fetch real content and show preview
  const handleSelect = useCallback(async (node: FileNode) => {
    setSelectedPath(node.path)
    setPreviewLoading(true)
    setPreviewContent(null)
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(node.path)}`)
      if (!res.ok) {
        setPreviewContent(`// 无法读取文件: HTTP ${res.status}`)
        setPreviewName(node.name)
        setPreviewLang('text')
        setPreviewSize(0)
        return
      }
      const data = await res.json()
      setPreviewContent(data.content)
      setPreviewName(data.name)
      setPreviewLang(data.language || 'text')
      setPreviewSize(data.size || 0)
    } catch {
      setPreviewContent(`// 后端未连接，无法读取文件\n// 路径: ${node.path}`)
      setPreviewName(node.name)
      setPreviewLang('text')
      setPreviewSize(0)
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  // Handle directory expansion
  const handleExpand = useCallback(async (_path: string) => {
    // Already loaded if children exist
  }, [])

  // Flatten for search
  const flattenFiles = (nodes: FileNode[], result: FileNode[] = []): FileNode[] => {
    for (const n of nodes) {
      if (n.type === 'file') result.push(n)
      if (n.children) flattenFiles(n.children, result)
    }
    return result
  }

  const displayTree = useMemo(() => {
    if (!searchQuery) return tree
    const allFiles = flattenFiles(tree)
    return allFiles.filter(f =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.path.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [searchQuery, tree])

  const lineCount = previewContent ? previewContent.split('\n').length : 0

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📁 文件浏览器</h1>
        <div className="page-header-actions">
          <span className="page-badge">{fileCount} 文件</span>
          <span className="page-badge">{dirCount} 目录</span>
          <button
            className="btn-secondary"
            title="刷新"
            onClick={() => fetchTree()}
          >
            🔄 刷新
          </button>
        </div>
      </div>
      <div className="page-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="搜索文件名或路径... (Ctrl+P)"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="page-body file-browser-split">
        {/* Left: File Tree */}
        <div className="file-browser-tree-pane">
          {loading ? (
            <div className="page-loading">
              <div className="spinner" />
              <span>正在加载文件树...</span>
            </div>
          ) : error ? (
            <div className="page-empty">
              <div className="page-empty-icon">⚠️</div>
              <div className="page-empty-title">无法加载文件树</div>
              <div className="page-empty-desc">
                {error.includes('fetch')
                  ? '后端服务未启动'
                  : error
                }
              </div>
              <button className="btn-primary" onClick={() => fetchTree()}>
                重试
              </button>
            </div>
          ) : displayTree.length === 0 ? (
            <div className="page-empty">
              <div className="page-empty-icon">📂</div>
              <div className="page-empty-title">无文件</div>
            </div>
          ) : (
            <div className="file-tree">
              {displayTree.map(node => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  onSelect={handleSelect}
                  selectedPath={selectedPath}
                  onExpand={handleExpand}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: Preview Panel */}
        <div className={`file-preview-pane ${previewContent !== null ? 'visible' : ''}`}>
          {previewLoading ? (
            <div className="page-loading">
              <div className="spinner" />
              <span>加载中...</span>
            </div>
          ) : previewContent !== null ? (
            <>
              <div className="file-preview-header">
                <div className="file-preview-info">
                  <span className="file-preview-icon">{getFileIcon(previewName)}</span>
                  <span className="file-preview-name">{previewName}</span>
                  <span className="file-preview-lang">{previewLang}</span>
                </div>
                <div className="file-preview-meta">
                  <span>{lineCount} 行</span>
                  <span>{formatSize(previewSize)}</span>
                  <button
                    className="btn-icon"
                    title="在侧边栏打开"
                    onClick={() => onOpenFile(previewName, previewContent, previewLang)}
                  >📋</button>
                  <button
                    className="btn-icon"
                    title="复制"
                    onClick={() => navigator.clipboard.writeText(previewContent)}
                  >📎</button>
                </div>
              </div>
              <div className="file-preview-content">
                <pre><code>{previewContent}</code></pre>
              </div>
            </>
          ) : (
            <div className="file-preview-empty">
              <div className="page-empty-icon">📄</div>
              <div className="page-empty-title">选择文件查看预览</div>
              <div className="page-empty-desc">点击左侧文件树中的文件</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper
function countNodesInner(nodes: FileNode[]): { files: number; dirs: number } {
  let files = 0, dirs = 0
  for (const n of nodes) {
    if (n.type === 'file') files++
    else {
      dirs++
      if (n.children) {
        const sub = countNodesInner(n.children)
        files += sub.files
        dirs += sub.dirs
      }
    }
  }
  return { files, dirs }
}
