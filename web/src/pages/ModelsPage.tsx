import { useState, useEffect, useCallback } from 'react'

interface ModelInfo {
  key: string
  displayName: string
  provider: string
  modelId: string
  apiBase: string
  apiKeyEnvVar: string
  maxOutputTokens: number
  contextWindow: number
  supportsToolCalls: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  costPer1MInput: number
  costPer1MOutput: number
  currency: string
  hasApiKey: boolean
  testStatus?: 'online' | 'offline' | 'testing' | 'unknown'
  testLatency?: number
}

interface ModelsPageProps {
  currentModel: string
  onSelectModel: (key: string) => void
}

export function ModelsPage({ currentModel, onSelectModel }: ModelsPageProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data = await res.json()
        setModels(data.map((m: ModelInfo) => ({ ...m, testStatus: 'unknown' })))
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  const handleTest = async (key: string) => {
    setTesting(key)
    setModels(prev => prev.map(m =>
      m.key === key ? { ...m, testStatus: 'testing' as const } : m
    ))
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(key)}/test`, { method: 'POST' })
      const result = await res.json()
      setModels(prev => prev.map(m =>
        m.key === key
          ? { ...m, testStatus: result.ok ? 'online' as const : 'offline' as const, testLatency: result.latencyMs }
          : m
      ))
    } catch {
      setModels(prev => prev.map(m =>
        m.key === key ? { ...m, testStatus: 'offline' as const } : m
      ))
    }
    setTesting(null)
  }

  const handleSaveKey = async (envVar: string) => {
    if (!keyInput.trim()) return
    setSavingKey(true)
    try {
      const res = await fetch('/api/models/key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envVar, value: keyInput.trim() }),
      })
      if (res.ok) {
        // Refresh model list to get updated hasApiKey
        await fetchModels()
        setEditingKey(null)
        setKeyInput('')
      }
    } catch { /* ignore */ }
    setSavingKey(false)
  }

  const formatCtx = (n: number) => {
    if (n >= 1_000_000) return `${n / 1_000_000}M`
    if (n >= 1_000) return `${n / 1_000}K`
    return String(n)
  }

  // Group by provider
  const providers = [...new Set(models.map(m => m.provider))]

  // Provider descriptions
  const providerInfo: Record<string, { emoji: string; region: string }> = {
    'MiniMax': { emoji: '🔮', region: '大陆' },
    'DeepSeek': { emoji: '🌊', region: '大陆' },
    'Moonshot': { emoji: '🌙', region: '大陆' },
    'Alibaba': { emoji: '☁️', region: '大陆' },
    'Zhipu': { emoji: '🧠', region: '大陆' },
    'Anthropic': { emoji: '🤖', region: '国际' },
    'Google': { emoji: '💎', region: '国际' },
    'OpenAI': { emoji: '⚡', region: '国际' },
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">🤖 模型管理</h1>
        </div>
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <span className="spinner-small" /> 加载中...
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">🤖 模型管理</h1>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)' }}>
          {models.filter(m => m.hasApiKey).length}/{models.length} 已配置
        </span>
      </div>

      <div className="page-body">
        {providers.map(provider => {
          const info = providerInfo[provider] || { emoji: '🔧', region: '' }
          const providerModels = models.filter(m => m.provider === provider)
          const anyConfigured = providerModels.some(m => m.hasApiKey)
          const envVar = providerModels[0]?.apiKeyEnvVar || ''

          return (
            <div key={provider} style={{ marginBottom: 28 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
              }}>
                <span style={{ fontSize: 16 }}>{info.emoji}</span>
                <h3 style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  letterSpacing: 0.3,
                  margin: 0,
                }}>
                  {provider}
                </h3>
                {info.region && (
                  <span style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-full)',
                    background: info.region === '大陆' ? 'var(--accent-subtle)' : 'rgba(245, 158, 11, 0.15)',
                    color: info.region === '大陆' ? 'var(--accent)' : '#f59e0b',
                    fontWeight: 600,
                  }}>
                    {info.region}
                  </span>
                )}
                <span style={{
                  fontSize: 11,
                  color: anyConfigured ? '#10b981' : 'var(--text-quaternary)',
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  <span style={{
                    width: 6, height: 6,
                    borderRadius: '50%',
                    background: anyConfigured ? '#10b981' : 'var(--text-quaternary)',
                    display: 'inline-block',
                  }} />
                  {anyConfigured ? 'Key 已配置' : '未配置'}
                </span>
              </div>

              {/* API Key configuration bar (when no key is set) */}
              {!anyConfigured && editingKey !== envVar && (
                <div
                  className="model-key-bar"
                  onClick={() => { setEditingKey(envVar); setKeyInput('') }}
                >
                  <span className="model-key-bar-icon">🔑</span>
                  <span className="model-key-bar-text">
                    点击配置 <code>{envVar}</code> 以启用 {provider} 模型
                  </span>
                  <span className="model-key-bar-arrow">→</span>
                </div>
              )}

              {/* Key input form */}
              {editingKey === envVar && (
                <div className="model-key-form animate-slide-down">
                  <div className="model-key-form-header">
                    <span>🔑 配置 <code>{envVar}</code></span>
                    <button
                      className="model-key-form-close"
                      onClick={() => setEditingKey(null)}
                    >✕</button>
                  </div>
                  <div className="model-key-form-body">
                    <input
                      type="password"
                      className="model-key-input"
                      placeholder={`输入你的 ${provider} API Key...`}
                      value={keyInput}
                      onChange={e => setKeyInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSaveKey(envVar)
                        if (e.key === 'Escape') setEditingKey(null)
                      }}
                      autoFocus
                    />
                    <button
                      className="btn btn-primary"
                      style={{ flexShrink: 0, fontSize: 12, padding: '6px 16px' }}
                      onClick={() => handleSaveKey(envVar)}
                      disabled={savingKey || !keyInput.trim()}
                    >
                      {savingKey ? '保存中...' : '保存'}
                    </button>
                  </div>
                  <div className="model-key-form-hint">
                    Key 将保存到项目 .env 文件中，不会上传到任何服务器
                  </div>
                </div>
              )}

              <div className="models-grid">
                {providerModels.map(model => (
                  <div
                    key={model.key}
                    className={`model-card ${currentModel === model.key ? 'active' : ''} ${!model.hasApiKey ? 'no-key' : ''}`}
                    onClick={() => model.hasApiKey && onSelectModel(model.key)}
                    style={{ cursor: model.hasApiKey ? 'pointer' : 'default' }}
                  >
                    <div className="model-card-header">
                      <span className="model-card-name">{model.displayName}</span>
                      <span className={`model-card-status ${model.testStatus || 'unknown'} ${!model.hasApiKey ? 'no-key' : ''}`}>
                        {!model.hasApiKey ? '🔴' :
                         model.testStatus === 'online' ? '🟢' :
                         model.testStatus === 'offline' ? '🔴' :
                         model.testStatus === 'testing' ? '🟡' :
                         '⚪'}
                      </span>
                    </div>
                    <div className="model-card-provider">
                      {model.modelId} · 上下文 {formatCtx(model.contextWindow)}
                    </div>
                    <div className="model-card-specs">
                      <span className={`model-card-spec ${model.supportsToolCalls ? 'supported' : ''}`}>
                        {model.supportsToolCalls ? '✓' : '✕'} 工具
                      </span>
                      <span className={`model-card-spec ${model.supportsVision ? 'supported' : ''}`}>
                        {model.supportsVision ? '✓' : '✕'} 视觉
                      </span>
                      <span className="model-card-spec">
                        {model.currency}{model.costPer1MInput}/{model.currency}{model.costPer1MOutput} /M
                      </span>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
                      {model.hasApiKey ? (
                        <>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            onClick={(e) => { e.stopPropagation(); handleTest(model.key) }}
                            disabled={testing === model.key}
                          >
                            {testing === model.key ? '测试中...' : '测试连接'}
                          </button>
                          {model.testLatency && (
                            <span style={{ fontSize: 10, color: 'var(--text-quaternary)' }}>
                              {model.testLatency}ms
                            </span>
                          )}
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: '3px 8px', marginLeft: 'auto' }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingKey(model.apiKeyEnvVar)
                              setKeyInput('')
                            }}
                          >
                            更换 Key
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-quaternary)' }}>
                          需配置 API Key
                        </span>
                      )}
                      {currentModel === model.key && (
                        <span style={{
                          fontSize: 10, color: 'var(--accent)',
                          fontWeight: 700, marginLeft: 'auto',
                        }}>
                          ✓ 当前
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
