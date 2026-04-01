import { useState, useEffect, useRef } from 'react'

interface Stats {
  totalCost: number
  totalTokens: { input: number; output: number }
  contextUsage: number
  codeChanges: { added: number; removed: number }
  avgLatency: number
  requestCount: number
  modelDistribution: Record<string, number>
  recentRequests: RecentRequest[]
}

interface RecentRequest {
  time: string
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
  latency: number
}

const MOCK_STATS: Stats = {
  totalCost: 0,
  totalTokens: { input: 0, output: 0 },
  contextUsage: 0,
  codeChanges: { added: 0, removed: 0 },
  avgLatency: 0,
  requestCount: 0,
  modelDistribution: {},
  recentRequests: [],
}

// ─── Animated Counter ──────────────────────────────────
function AnimatedValue({ value, prefix = '', suffix = '', decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; decimals?: number
}) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    const from = prev.current
    const to = value
    if (from === to) return
    prev.current = to

    const duration = 600
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setDisplay(from + (to - from) * ease)
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [value])

  return <>{prefix}{display.toFixed(decimals)}{suffix}</>
}

// ─── Mini Sparkline (SVG) ──────────────────────────────
function Sparkline({ data, color = '#0a84ff', height = 32 }: {
  data: number[]; color?: string; height?: number
}) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const w = 120
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${height - (v / max) * (height - 4)}`
  ).join(' ')

  return (
    <svg width={w} height={height} style={{ display: 'block', opacity: 0.7 }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Last point glow dot */}
      {data.length > 0 && (
        <circle
          cx={(data.length - 1) / (data.length - 1) * w}
          cy={height - (data[data.length - 1] / max) * (height - 4)}
          r={3}
          fill={color}
          opacity={0.9}
        >
          <animate attributeName="r" values="3;4.5;3" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  )
}

export function DashboardPage() {
  const [stats, setStats] = useState<Stats>(MOCK_STATS)
  const [timeRange, setTimeRange] = useState<'session' | 'all'>('session')
  const [uptime, setUptime] = useState(0)
  const [tokenHistory, setTokenHistory] = useState<number[]>([0])
  const [costHistory, setCostHistory] = useState<number[]>([0])

  // Track uptime
  useEffect(() => {
    const start = Date.now()
    const tick = setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(tick)
  }, [])

  // Poll stats from backend
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/stats?range=${timeRange}`)
        if (res.ok) {
          const data = await res.json()
          setStats(data)
          setTokenHistory(prev => [...prev.slice(-19), data.totalTokens.input + data.totalTokens.output])
          setCostHistory(prev => [...prev.slice(-19), data.totalCost])
        }
      } catch {
        // Backend not connected — keep mock data
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [timeRange])

  const contextLevel =
    stats.contextUsage < 50 ? 'low' :
    stats.contextUsage < 80 ? 'mid' : 'high'

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  const formatUptime = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${sec}s`
    return `${sec}s`
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">📊 监控面板</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#30d158',
              display: 'inline-block', boxShadow: '0 0 6px #30d158',
            }} />
            运行 {formatUptime(uptime)}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`btn ${timeRange === 'session' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTimeRange('session')}
            >
              本次会话
            </button>
            <button
              className={`btn ${timeRange === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTimeRange('all')}
            >
              全部
            </button>
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* KPI Cards */}
        <div className="dashboard-grid">
          <div className="stat-card">
            <div className="stat-card-label">总费用</div>
            <div className="stat-card-value accent">
              <AnimatedValue value={stats.totalCost} prefix="¥" decimals={2} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="stat-card-sub">{stats.requestCount} 次请求</div>
              <Sparkline data={costHistory} color="#0a84ff" />
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-label">Token 用量</div>
            <div className="stat-card-value">
              {formatTokens(stats.totalTokens.input)} ↑
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="stat-card-sub">
                {formatTokens(stats.totalTokens.output)} ↓ 输出
              </div>
              <Sparkline data={tokenHistory} color="#bf5af2" />
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-label">上下文窗口</div>
            <div className="stat-card-value">
              <AnimatedValue value={stats.contextUsage} decimals={0} suffix="%" />
            </div>
            <div className="context-bar">
              <div
                className={`context-bar-fill ${contextLevel}`}
                style={{ width: `${stats.contextUsage}%`, transition: 'width 0.6s var(--ease-out)' }}
              />
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-label">代码变更</div>
            <div className="stat-card-value success">
              +<AnimatedValue value={stats.codeChanges.added} decimals={0} />
            </div>
            <div className="stat-card-sub" style={{ color: 'var(--error)' }}>
              -<AnimatedValue value={stats.codeChanges.removed} decimals={0} /> 行
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-label">平均延迟</div>
            <div className="stat-card-value">
              {stats.avgLatency > 0
                ? <><AnimatedValue value={stats.avgLatency / 1000} decimals={1} />s</>
                : '—'}
            </div>
            <div className="stat-card-sub">API 响应时间</div>
          </div>

          <div className="stat-card">
            <div className="stat-card-label">模型分布</div>
            <div style={{ marginTop: 8 }}>
              {Object.entries(stats.modelDistribution).length > 0
                ? Object.entries(stats.modelDistribution).map(([model, count]) => (
                    <div key={model} style={{
                      display: 'flex', justifyContent: 'space-between',
                      fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4,
                    }}>
                      <span>{model}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{count}</span>
                    </div>
                  ))
                : <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>暂无数据</div>
              }
            </div>
          </div>
        </div>

        {/* Recent Requests Log */}
        <div style={{ marginTop: 8 }}>
          <h3 style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
            marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.3,
          }}>
            最近请求
          </h3>

          {stats.recentRequests.length > 0 ? (
            <table className="log-table">
              <thead>
                <tr>
                  <th>时间</th><th>模型</th><th>输入</th><th>输出</th><th>费用</th><th>延迟</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentRequests.map((req, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{req.time}</td>
                    <td>{req.model}</td>
                    <td>{formatTokens(req.inputTokens)}</td>
                    <td>{formatTokens(req.outputTokens)}</td>
                    <td>¥{req.cost.toFixed(4)}</td>
                    <td>{(req.latency / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-text">
                发送第一条消息后，请求日志将在此显示
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
