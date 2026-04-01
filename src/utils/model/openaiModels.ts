/**
 * OpenAI-compatible model registry for third-party LLM providers.
 *
 * Each entry defines how to reach the model's API, its capabilities,
 * and pricing info for cost tracking. The registry is used by:
 * - openaiClient.ts  → to build the HTTP request
 * - openaiCompat.ts  → to decide which features to enable/disable
 * - context.ts       → for max_tokens / context window
 * - modelCost.ts     → for cost tracking on Dashboard
 *
 * Users can add custom models via the DolanClaude Web UI. Custom
 * entries are persisted to ~/.claude/dolan-models.json and merged
 * with this built-in list at runtime.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'

// ─── Types ──────────────────────────────────────────────

export interface OpenAIModelConfig {
  /** Human-readable name shown in UI */
  displayName: string
  /** API base URL (without trailing slash) */
  apiBase: string
  /** The model ID sent in the request body */
  modelId: string
  /** Environment variable name for the API key */
  apiKeyEnvVar: string
  /** Maximum output tokens the model supports */
  maxOutputTokens: number
  /** Context window size in tokens */
  contextWindow: number
  /** Whether the model supports OpenAI-style tool_calls */
  supportsToolCalls: boolean
  /** Whether the model supports SSE streaming */
  supportsStreaming: boolean
  /** Whether the model supports vision (image inputs) */
  supportsVision: boolean
  /** Cost per 1M input tokens (in the model's native currency, e.g. ¥ or $) */
  costPer1MInput: number
  /** Cost per 1M output tokens */
  costPer1MOutput: number
  /** Currency symbol for cost display */
  currency: '¥' | '$'
  /** Provider group for UI organization */
  provider: string
}

// ─── Built-in Models ────────────────────────────────────

export const BUILTIN_OPENAI_MODELS: Record<string, OpenAIModelConfig> = {
  // ── MiniMax ──────────────────────────────────────────
  'minimax-m2.7-hs': {
    displayName: 'MiniMax M2.7 High Speed',
    apiBase: 'https://api.minimaxi.chat/v1',
    modelId: 'MiniMax-M2.7-High-Speed',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    maxOutputTokens: 16000,
    contextWindow: 1000000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 1.0,
    costPer1MOutput: 8.0,
    currency: '¥',
    provider: 'MiniMax',
  },

  // ── Gemini (OpenAI-compatible endpoint) ──────────────
  'gemini-2.5-pro': {
    displayName: 'Gemini 2.5 Pro',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'gemini-2.5-pro-preview-05-06',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    maxOutputTokens: 65536,
    contextWindow: 1000000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 1.25,
    costPer1MOutput: 10.0,
    currency: '$',
    provider: 'Google',
  },
  'gemini-2.5-flash': {
    displayName: 'Gemini 2.5 Flash',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'gemini-2.5-flash-preview-05-20',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    maxOutputTokens: 65536,
    contextWindow: 1000000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    currency: '$',
    provider: 'Google',
  },

  // ── OpenAI ───────────────────────────────────────────
  'gpt-4o': {
    displayName: 'GPT-4o',
    apiBase: 'https://api.openai.com/v1',
    modelId: 'gpt-4o',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxOutputTokens: 16384,
    contextWindow: 128000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 2.5,
    costPer1MOutput: 10.0,
    currency: '$',
    provider: 'OpenAI',
  },
  'gpt-4.1': {
    displayName: 'GPT-4.1',
    apiBase: 'https://api.openai.com/v1',
    modelId: 'gpt-4.1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxOutputTokens: 32768,
    contextWindow: 1000000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 2.0,
    costPer1MOutput: 8.0,
    currency: '$',
    provider: 'OpenAI',
  },
  'o3': {
    displayName: 'o3',
    apiBase: 'https://api.openai.com/v1',
    modelId: 'o3',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    maxOutputTokens: 100000,
    contextWindow: 200000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 2.0,
    costPer1MOutput: 8.0,
    currency: '$',
    provider: 'OpenAI',
  },

  // ── DeepSeek ─────────────────────────────────────────
  'deepseek-v3': {
    displayName: 'DeepSeek V3',
    apiBase: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-chat',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    maxOutputTokens: 8000,
    contextWindow: 128000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 0.27,
    costPer1MOutput: 1.1,
    currency: '¥',
    provider: 'DeepSeek',
  },
  'deepseek-r1': {
    displayName: 'DeepSeek R1',
    apiBase: 'https://api.deepseek.com/v1',
    modelId: 'deepseek-reasoner',
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    maxOutputTokens: 64000,
    contextWindow: 128000,
    supportsToolCalls: false,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 0.55,
    costPer1MOutput: 2.19,
    currency: '¥',
    provider: 'DeepSeek',
  },

  // ── Kimi (Moonshot) ──────────────────────────────────
  'kimi-32k': {
    displayName: 'Kimi (32K)',
    apiBase: 'https://api.moonshot.cn/v1',
    modelId: 'moonshot-v1-32k',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
    maxOutputTokens: 8000,
    contextWindow: 32000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 24.0,
    costPer1MOutput: 24.0,
    currency: '¥',
    provider: 'Moonshot',
  },
  'kimi-128k': {
    displayName: 'Kimi (128K)',
    apiBase: 'https://api.moonshot.cn/v1',
    modelId: 'moonshot-v1-128k',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
    maxOutputTokens: 8000,
    contextWindow: 128000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 60.0,
    costPer1MOutput: 60.0,
    currency: '¥',
    provider: 'Moonshot',
  },

  // ── Qwen (通义千问) ──────────────────────────────────
  'qwen-max': {
    displayName: '通义千问 Max',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen-max',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    maxOutputTokens: 8192,
    contextWindow: 32000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 20.0,
    costPer1MOutput: 60.0,
    currency: '¥',
    provider: 'Alibaba',
  },
  'qwen-plus': {
    displayName: '通义千问 Plus',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen-plus',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    maxOutputTokens: 8192,
    contextWindow: 131072,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 0.8,
    costPer1MOutput: 2.0,
    currency: '¥',
    provider: 'Alibaba',
  },

  // ── GLM (智谱) ───────────────────────────────────────
  'glm-4-plus': {
    displayName: 'GLM-4 Plus',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    modelId: 'glm-4-plus',
    apiKeyEnvVar: 'ZHIPU_API_KEY',
    maxOutputTokens: 4096,
    contextWindow: 128000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 50.0,
    costPer1MOutput: 50.0,
    currency: '¥',
    provider: 'Zhipu',
  },
}

// ─── Runtime Registry (built-in + user custom) ──────────

let _customModels: Record<string, OpenAIModelConfig> | null = null

function loadCustomModels(): Record<string, OpenAIModelConfig> {
  if (_customModels !== null) return _customModels
  _customModels = {}
  try {
    const configDir = getClaudeConfigHomeDir()
    const customPath = join(configDir, 'dolan-models.json')
    // eslint-disable-next-line custom-rules/no-sync-fs
    const raw = readFileSync(customPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      _customModels = parsed as Record<string, OpenAIModelConfig>
    }
  } catch {
    // File doesn't exist or invalid — that's fine
  }
  return _customModels
}

/**
 * Get the merged model registry (built-in + user custom).
 * Custom models override built-in ones with the same key.
 */
export function getOpenAIModelRegistry(): Record<string, OpenAIModelConfig> {
  return { ...BUILTIN_OPENAI_MODELS, ...loadCustomModels() }
}

/**
 * Look up a model config by its registry key.
 * Returns undefined if not found.
 */
export function getOpenAIModelConfig(
  modelKey: string,
): OpenAIModelConfig | undefined {
  return getOpenAIModelRegistry()[modelKey.toLowerCase()]
}

/**
 * Check if a model name corresponds to an OpenAI-compatible model.
 */
export function isOpenAICompatModel(model: string): boolean {
  return getOpenAIModelConfig(model) !== undefined
}

/**
 * Reload custom models from disk (called after Web UI saves changes).
 */
export function reloadCustomModels(): void {
  _customModels = null
}

/**
 * Get all unique provider names for UI grouping.
 */
export function getProviderGroups(): string[] {
  const registry = getOpenAIModelRegistry()
  return [...new Set(Object.values(registry).map(m => m.provider))]
}

/**
 * Get the API key for a model from environment variables.
 */
export function getModelApiKey(config: OpenAIModelConfig): string | undefined {
  return process.env[config.apiKeyEnvVar]
}
