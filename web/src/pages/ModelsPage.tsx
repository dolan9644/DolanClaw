import { useState } from 'react'

interface ModelInfo {
  key: string
  displayName: string
  provider: string
  modelId: string
  apiBase: string
  maxOutputTokens: number
  contextWindow: number
  supportsToolCalls: boolean
  supportsStreaming: boolean
  supportsVision: boolean
  costPer1MInput: number
  costPer1MOutput: number
  currency: string
  status: 'online' | 'offline' | 'unknown'
}

const BUILTIN_MODELS: ModelInfo[] = [
  {
    key: 'minimax-text-01', displayName: 'MiniMax Text 01',
    provider: 'MiniMax', modelId: 'MiniMax-M2.7-High-Speed',
    apiBase: 'https://api.minimaxi.chat/v1',
    maxOutputTokens: 16000, contextWindow: 1000000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: true,
    costPer1MInput: 1.0, costPer1MOutput: 8.0, currency: '¥', status: 'unknown',
  },
  {
    key: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro',
    provider: 'Google', modelId: 'gemini-2.5-pro-preview-05-06',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    maxOutputTokens: 65536, contextWindow: 1000000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: true,
    costPer1MInput: 1.25, costPer1MOutput: 10.0, currency: '$', status: 'unknown',
  },
  {
    key: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash',
    provider: 'Google', modelId: 'gemini-2.5-flash-preview-05-20',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    maxOutputTokens: 65536, contextWindow: 1000000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: true,
    costPer1MInput: 0.15, costPer1MOutput: 0.60, currency: '$', status: 'unknown',
  },
  {
    key: 'gpt-4o', displayName: 'GPT-4o',
    provider: 'OpenAI', modelId: 'gpt-4o',
    apiBase: 'https://api.openai.com/v1',
    maxOutputTokens: 16384, contextWindow: 128000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: true,
    costPer1MInput: 2.5, costPer1MOutput: 10.0, currency: '$', status: 'unknown',
  },
  {
    key: 'gpt-4.1', displayName: 'GPT-4.1',
    provider: 'OpenAI', modelId: 'gpt-4.1',
    apiBase: 'https://api.openai.com/v1',
    maxOutputTokens: 32768, contextWindow: 1000000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: true,
    costPer1MInput: 2.0, costPer1MOutput: 8.0, currency: '$', status: 'unknown',
  },
  {
    key: 'o3', displayName: 'o3',
    provider: 'OpenAI', modelId: 'o3',
    apiBase: 'https://api.openai.com/v1',
    maxOutputTokens: 100000, contextWindow: 200000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: true,
    costPer1MInput: 2.0, costPer1MOutput: 8.0, currency: '$', status: 'unknown',
  },
  {
    key: 'deepseek-v3', displayName: 'DeepSeek V3',
    provider: 'DeepSeek', modelId: 'deepseek-chat',
    apiBase: 'https://api.deepseek.com/v1',
    maxOutputTokens: 8000, contextWindow: 128000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: false,
    costPer1MInput: 0.27, costPer1MOutput: 1.1, currency: '¥', status: 'unknown',
  },
  {
    key: 'deepseek-r1', displayName: 'DeepSeek R1',
    provider: 'DeepSeek', modelId: 'deepseek-reasoner',
    apiBase: 'https://api.deepseek.com/v1',
    maxOutputTokens: 64000, contextWindow: 128000,
    supportsToolCalls: false, supportsStreaming: true, supportsVision: false,
    costPer1MInput: 0.55, costPer1MOutput: 2.19, currency: '¥', status: 'unknown',
  },
  {
    key: 'kimi-32k', displayName: 'Kimi (32K)',
    provider: 'Moonshot', modelId: 'moonshot-v1-32k',
    apiBase: 'https://api.moonshot.cn/v1',
    maxOutputTokens: 8000, contextWindow: 32000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: false,
    costPer1MInput: 24.0, costPer1MOutput: 24.0, currency: '¥', status: 'unknown',
  },
  {
    key: 'qwen-max', displayName: '通义千问 Max',
    provider: 'Alibaba', modelId: 'qwen-max',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    maxOutputTokens: 8192, contextWindow: 32000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: false,
    costPer1MInput: 20.0, costPer1MOutput: 60.0, currency: '¥', status: 'unknown',
  },
  {
    key: 'glm-4-plus', displayName: 'GLM-4 Plus',
    provider: 'Zhipu', modelId: 'glm-4-plus',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    maxOutputTokens: 4096, contextWindow: 128000,
    supportsToolCalls: true, supportsStreaming: true, supportsVision: false,
    costPer1MInput: 50.0, costPer1MOutput: 50.0, currency: '¥', status: 'unknown',
  },
]

interface ModelsPageProps {
  currentModel: string
  onSelectModel: (key: string) => void
}

export function ModelsPage({ currentModel, onSelectModel }: ModelsPageProps) {
  const [models, setModels] = useState<ModelInfo[]>(BUILTIN_MODELS)
  const [testing, setTesting] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const handleTest = async (key: string) => {
    setTesting(key)
    try {
      const res = await fetch(`/api/models/${key}/test`, { method: 'POST' })
      if (res.ok) {
        const result = await res.json()
        setModels(prev =>
          prev.map(m =>
            m.key === key
              ? { ...m, status: result.ok ? 'online' as const : 'offline' as const }
              : m
          )
        )
      }
    } catch {
      setModels(prev =>
        prev.map(m =>
          m.key === key ? { ...m, status: 'offline' as const } : m
        )
      )
    } finally {
      setTesting(null)
    }
  }

  const formatCtx = (n: number) => {
    if (n >= 1_000_000) return `${n / 1_000_000}M`
    if (n >= 1_000) return `${n / 1_000}K`
    return String(n)
  }

  // Group by provider
  const providers = [...new Set(models.map(m => m.provider))]

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">🤖 模型管理</h1>
        <button
          className="btn btn-primary"
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? '取消' : '+ 添加模型'}
        </button>
      </div>

      <div className="page-body">
        {/* Add Model Form */}
        {showAddForm && (
          <div className="stat-card animate-slide-up" style={{ marginBottom: 24 }}>
            <h3 style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 16,
            }}>
              添加自定义模型
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}>
              {[
                { label: '模型名称', placeholder: 'My Custom Model' },
                { label: 'Model ID', placeholder: 'model-name-v1' },
                { label: 'API Base URL', placeholder: 'https://api.example.com/v1' },
                { label: 'API Key 环境变量', placeholder: 'MY_API_KEY' },
                { label: '最大输出 Tokens', placeholder: '8192' },
                { label: '上下文窗口', placeholder: '128000' },
              ].map(field => (
                <div key={field.label}>
                  <label style={{
                    fontSize: 12,
                    color: 'var(--text-tertiary)',
                    display: 'block',
                    marginBottom: 4,
                  }}>
                    {field.label}
                  </label>
                  <input
                    type="text"
                    placeholder={field.placeholder}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      fontFamily: 'var(--font-sans)',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="btn btn-primary">保存</button>
              <button className="btn btn-ghost" onClick={() => setShowAddForm(false)}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* Model Cards by Provider */}
        {providers.map(provider => (
          <div key={provider} style={{ marginBottom: 28 }}>
            <h3 style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 12,
            }}>
              {provider}
            </h3>
            <div className="models-grid">
              {models
                .filter(m => m.provider === provider)
                .map(model => (
                  <div
                    key={model.key}
                    className={`model-card ${currentModel === model.key ? 'active' : ''}`}
                    onClick={() => onSelectModel(model.key)}
                  >
                    <div className="model-card-header">
                      <span className="model-card-name">{model.displayName}</span>
                      <span className={`model-card-status ${model.status}`} />
                    </div>
                    <div className="model-card-provider">
                      {model.modelId} · 上下文 {formatCtx(model.contextWindow)}
                    </div>
                    <div className="model-card-specs">
                      <span className={`model-card-spec ${model.supportsToolCalls ? 'supported' : ''}`}>
                        {model.supportsToolCalls ? '✓' : '✕'} 工具调用
                      </span>
                      <span className={`model-card-spec ${model.supportsVision ? 'supported' : ''}`}>
                        {model.supportsVision ? '✓' : '✕'} 视觉
                      </span>
                      <span className="model-card-spec">
                        {model.currency}{model.costPer1MInput}/{model.currency}{model.costPer1MOutput} /M
                      </span>
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleTest(model.key)
                        }}
                        disabled={testing === model.key}
                      >
                        {testing === model.key ? '测试中...' : '测试连接'}
                      </button>
                      {currentModel === model.key && (
                        <span style={{
                          fontSize: 11,
                          color: 'var(--accent)',
                          display: 'flex',
                          alignItems: 'center',
                        }}>
                          ✓ 当前使用
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}

        {/* Add Custom Model Card */}
        <div className="models-grid" style={{ marginTop: 8 }}>
          <div className="add-model-card" onClick={() => setShowAddForm(true)}>
            <div className="add-model-icon">+</div>
            <div className="add-model-text">添加自定义模型</div>
          </div>
        </div>
      </div>
    </div>
  )
}
