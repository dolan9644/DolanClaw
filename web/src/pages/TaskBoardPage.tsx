import React, { useState, useEffect } from 'react'

interface Task {
  id: string
  name: string
  status: 'running' | 'completed' | 'failed' | 'queued' | 'stopped'
  agent: string
  description: string
  progress: number
  startTime: number
  elapsedMs: number
  output?: string
}

const STATUS_MAP: Record<Task['status'], { icon: string; label: string; color: string }> = {
  running: { icon: '', label: '运行中', color: '#0a84ff' },
  completed: { icon: '✓', label: '已完成', color: '#30d158' },
  failed: { icon: '✕', label: '失败', color: '#ff453a' },
  queued: { icon: '⏳', label: '排队中', color: '#8e8e93' },
  stopped: { icon: '⏹', label: '已停止', color: '#ff9f0a' },
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

const SEED_TASKS: Task[] = [
  {
    id: 'task-001', name: '重构 API 层', status: 'running', agent: 'CodeAgent',
    description: '将 REST 接口迁移到 OpenAI 兼容格式', progress: 65,
    startTime: Date.now() - 120000, elapsedMs: 120000,
    output: '✓ 分析现有 API 端点...\n✓ 创建兼容层模板...\n⏳ 迁移 /chat 端点...',
  },
  {
    id: 'task-002', name: '运行测试套件', status: 'completed', agent: 'TestAgent',
    description: '执行全部单元测试和集成测试', progress: 100,
    startTime: Date.now() - 300000, elapsedMs: 45000,
    output: 'Tests: 142 passed, 3 skipped\nDuration: 45.2s',
  },
  {
    id: 'task-003', name: '安全审查', status: 'queued', agent: 'SecurityAgent',
    description: '扫描依赖漏洞和代码安全问题', progress: 0,
    startTime: Date.now(), elapsedMs: 0,
  },
  {
    id: 'task-004', name: '文档生成', status: 'failed', agent: 'DocAgent',
    description: '自动生成 API 文档', progress: 30,
    startTime: Date.now() - 60000, elapsedMs: 30000,
    output: '✓ 解析 TypeScript 类型...\n✕ 缺少 JSDoc 注释: src/Tool.ts',
  },
  {
    id: 'task-005', name: '性能基准测试', status: 'stopped', agent: 'PerfAgent',
    description: '运行工具调用性能基准', progress: 45,
    startTime: Date.now() - 180000, elapsedMs: 90000,
    output: '✓ BashTool: 12ms avg\n✓ FileReadTool: 3ms avg\n⏹ 用户中断',
  },
]

export function TaskBoardPage() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try {
      const saved = localStorage.getItem('dolanclaw-tasks')
      return saved ? JSON.parse(saved) : SEED_TASKS
    } catch { return SEED_TASKS }
  })
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [filter, setFilter] = useState<'all' | Task['status']>('all')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newAgent, setNewAgent] = useState('CodeAgent')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // Persist
  useEffect(() => {
    localStorage.setItem('dolanclaw-tasks', JSON.stringify(tasks))
  }, [tasks])

  // Update running tasks progress
  useEffect(() => {
    const runningTasks = tasks.filter(t => t.status === 'running')
    if (runningTasks.length === 0) return
    const interval = setInterval(() => {
      setTasks(prev => prev.map(t => {
        if (t.status !== 'running') return t
        const newProgress = Math.min(t.progress + 0.5, 99)
        return { ...t, progress: newProgress, elapsedMs: Date.now() - t.startTime }
      }))
    }, 1000)
    return () => clearInterval(interval)
  }, [tasks.filter(t => t.status === 'running').length])

  // Keep selected in sync
  useEffect(() => {
    if (selectedTask) {
      const updated = tasks.find(t => t.id === selectedTask.id)
      if (updated) setSelectedTask(updated)
    }
  }, [tasks])

  const filteredTasks = filter === 'all' ? tasks : tasks.filter(t => t.status === filter)

  const counts = {
    all: tasks.length,
    running: tasks.filter(t => t.status === 'running').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    failed: tasks.filter(t => t.status === 'failed').length,
    queued: tasks.filter(t => t.status === 'queued').length,
    stopped: tasks.filter(t => t.status === 'stopped').length,
  }

  const handleAddTask = () => {
    if (!newName.trim()) return
    const task: Task = {
      id: `task-${Date.now()}`,
      name: newName.trim(),
      description: newDesc.trim() || '新任务',
      agent: newAgent,
      status: 'queued',
      progress: 0,
      startTime: Date.now(),
      elapsedMs: 0,
    }
    setTasks(prev => [...prev, task])
    setNewName('')
    setNewDesc('')
    setShowNewForm(false)
  }

  const handleStatusChange = (taskId: string, newStatus: Task['status']) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t
      const updates: Partial<Task> = { status: newStatus }
      if (newStatus === 'running') {
        updates.startTime = Date.now()
        updates.progress = Math.max(t.progress, 1)
      }
      if (newStatus === 'completed') updates.progress = 100
      return { ...t, ...updates }
    }))
  }

  const handleDelete = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    if (selectedTask?.id === taskId) setSelectedTask(null)
  }

  // Drag-and-drop reorder
  const handleDragStart = (id: string) => setDragId(id)
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    setDragOverId(id)
  }
  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    setTasks(prev => {
      const copy = [...prev]
      const fromIdx = copy.findIndex(t => t.id === dragId)
      const toIdx = copy.findIndex(t => t.id === targetId)
      const [moved] = copy.splice(fromIdx, 1)
      copy.splice(toIdx, 0, moved)
      return copy
    })
    setDragId(null)
    setDragOverId(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📋 任务看板</h1>
        <div className="page-header-actions">
          <span className="page-badge">{tasks.length} 个任务</span>
          <button className="btn-primary" onClick={() => setShowNewForm(!showNewForm)}>
            {showNewForm ? '取消' : '➕ 新建任务'}
          </button>
        </div>
      </div>

      {/* Add task form */}
      {showNewForm && (
        <div className="stat-card animate-slide-up" style={{ margin: '0 0 12px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="任务名称"
              className="search-input"
              onKeyDown={e => e.key === 'Enter' && handleAddTask()}
              autoFocus
            />
            <input
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="描述"
              className="search-input"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={newAgent}
                onChange={e => setNewAgent(e.target.value)}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', fontSize: 13,
                }}
              >
                <option>CodeAgent</option>
                <option>TestAgent</option>
                <option>DocAgent</option>
                <option>ReviewAgent</option>
              </select>
              <button className="btn btn-primary" onClick={handleAddTask}>添加</button>
            </div>
          </div>
        </div>
      )}

      <div className="page-toolbar">
        <div className="filter-tabs">
          {(['all', 'running', 'queued', 'completed', 'failed', 'stopped'] as const).map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '全部' : STATUS_MAP[f].label}
              <span className="filter-count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="page-body task-layout">
        <div className="task-list">
          {filteredTasks.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">暂无{filter === 'all' ? '' : STATUS_MAP[filter as Task['status']].label}任务</div>
            </div>
          ) : filteredTasks.map(task => {
            const st = STATUS_MAP[task.status]
            return (
              <div
                key={task.id}
                className={`task-card ${selectedTask?.id === task.id ? 'selected' : ''} task-status-${task.status} ${dragOverId === task.id ? 'drag-over' : ''}`}
                onClick={() => setSelectedTask(task)}
                draggable
                onDragStart={() => handleDragStart(task.id)}
                onDragOver={e => handleDragOver(e, task.id)}
                onDrop={() => handleDrop(task.id)}
                onDragEnd={() => { setDragId(null); setDragOverId(null) }}
              >
                <div className="task-card-header">
                  <span className="task-card-status" style={{ color: st.color }}>
                    {task.status === 'running' ? <span className="spinner-small" /> : st.icon}
                  </span>
                  <span className="task-card-name">{task.name}</span>
                  <span className="task-card-agent">{task.agent}</span>
                </div>
                <div className="task-card-desc">{task.description}</div>
                <div className="task-card-footer">
                  <div className="task-progress-bar">
                    <div
                      className="task-progress-fill"
                      style={{
                        width: `${task.progress}%`,
                        background: st.color,
                        transition: 'width 0.5s var(--ease-out)',
                      }}
                    />
                  </div>
                  <span className="task-card-time">{formatDuration(task.elapsedMs)}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Task Detail */}
        <div className="task-detail">
          {selectedTask ? (
            <>
              <div className="task-detail-header">
                <h2>{selectedTask.name}</h2>
                <div className="task-detail-meta">
                  <span>代理: {selectedTask.agent}</span>
                  <span>耗时: {formatDuration(selectedTask.elapsedMs)}</span>
                  <span>进度: {selectedTask.progress.toFixed(0)}%</span>
                </div>
              </div>
              <div className="task-detail-actions">
                {selectedTask.status === 'queued' && (
                  <button className="btn-primary" onClick={() => handleStatusChange(selectedTask.id, 'running')}>
                    ▶ 启动
                  </button>
                )}
                {selectedTask.status === 'running' && (
                  <>
                    <button className="btn-danger" onClick={() => handleStatusChange(selectedTask.id, 'stopped')}>
                      ⏹ 停止
                    </button>
                    <button className="btn-primary" onClick={() => handleStatusChange(selectedTask.id, 'completed')}>
                      ✓ 完成
                    </button>
                  </>
                )}
                {(selectedTask.status === 'failed' || selectedTask.status === 'stopped') && (
                  <button className="btn-primary" onClick={() => handleStatusChange(selectedTask.id, 'running')}>
                    🔄 重试
                  </button>
                )}
                <button className="btn-secondary" onClick={() => {
                  if (selectedTask.output) navigator.clipboard.writeText(selectedTask.output)
                }}>
                  📋 复制输出
                </button>
                <button
                  className="btn-danger"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => handleDelete(selectedTask.id)}
                >
                  🗑 删除
                </button>
              </div>
              {selectedTask.output && (
                <div className="task-detail-output">
                  <div className="task-detail-output-header">输出日志</div>
                  <pre className="task-detail-output-content">{selectedTask.output}</pre>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">选择左侧任务查看详情</div>
              <div className="empty-state-text" style={{ fontSize: 11, marginTop: 4, color: 'var(--text-quaternary)' }}>
                可拖拽卡片重新排序
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
