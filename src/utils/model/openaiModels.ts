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
 * ⚠️  Domain & Model ID verified against live APIs on 2026-04-02.
 *     MiniMax uses api.minimax.chat (大陆) / api.minimaxi.chat (国际)
 *     DeepSeek uses api.deepseek.com
 *     Kimi uses api.moonshot.cn (大陆) / api.moonshot.ai (国际)
 *     Qwen uses dashscope.aliyuncs.com (大陆)
 *     GLM uses open.bigmodel.cn
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

  // ══════════════════════════════════════════════════════
  // MiniMax — api.minimax.chat (大陆) / api.minimaxi.chat (国际)
  // 验证日期: 2026-04-02, Key 环境: 大陆
  // 可用模型: MiniMax-M2.7, MiniMax-M2.7-highspeed, MiniMax-M2.5, MiniMax-Text-01
  // ══════════════════════════════════════════════════════
  'minimax-m2.7': {
    displayName: 'MiniMax M2.7 (旗舰)',
    apiBase: 'https://api.minimax.chat/v1',
    modelId: 'MiniMax-M2.7',
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
  'minimax-m2.7-hs': {
    displayName: 'MiniMax M2.7 极速版',
    apiBase: 'https://api.minimax.chat/v1',
    modelId: 'MiniMax-M2.7-highspeed',
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
  'minimax-m2.5': {
    displayName: 'MiniMax M2.5',
    apiBase: 'https://api.minimax.chat/v1',
    modelId: 'MiniMax-M2.5',
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
  'minimax-text-01': {
    displayName: 'MiniMax Text 01',
    apiBase: 'https://api.minimax.chat/v1',
    modelId: 'MiniMax-Text-01',
    apiKeyEnvVar: 'MINIMAX_API_KEY',
    maxOutputTokens: 16000,
    contextWindow: 1000000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 1.0,
    costPer1MOutput: 8.0,
    currency: '¥',
    provider: 'MiniMax',
  },

  // ══════════════════════════════════════════════════════
  // DeepSeek — api.deepseek.com
  // 验证日期: 2026-04-02
  // deepseek-chat = V3.2 非思考模式, deepseek-reasoner = V3.2 思考模式
  // ══════════════════════════════════════════════════════
  'deepseek-v3': {
    displayName: 'DeepSeek V3 (Chat)',
    apiBase: 'https://api.deepseek.com',
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
    displayName: 'DeepSeek R1 (推理)',
    apiBase: 'https://api.deepseek.com',
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

  // ══════════════════════════════════════════════════════
  // Kimi / Moonshot — api.moonshot.cn (大陆) / api.moonshot.ai (国际)
  // 验证日期: 2026-04-02
  // 最新模型: kimi-k2.5
  // ══════════════════════════════════════════════════════
  'kimi-k2.5': {
    displayName: 'Kimi K2.5 (最新)',
    apiBase: 'https://api.moonshot.cn/v1',
    modelId: 'kimi-k2.5',
    apiKeyEnvVar: 'MOONSHOT_API_KEY',
    maxOutputTokens: 8000,
    contextWindow: 128000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 24.0,
    costPer1MOutput: 24.0,
    currency: '¥',
    provider: 'Moonshot',
  },
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

  // ══════════════════════════════════════════════════════
  // 通义千问 / Qwen — dashscope.aliyuncs.com (大陆)
  // 验证日期: 2026-04-02
  // 最新: qwen3-max (旗舰), qwen3.5-plus, qwen3.5-flash
  // ══════════════════════════════════════════════════════
  'qwen3-max': {
    displayName: '通义千问 Qwen3 Max',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen3-max',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    maxOutputTokens: 8192,
    contextWindow: 256000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 20.0,
    costPer1MOutput: 60.0,
    currency: '¥',
    provider: 'Alibaba',
  },
  'qwen3.5-plus': {
    displayName: '通义千问 Qwen3.5 Plus',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen3.5-plus',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    maxOutputTokens: 8192,
    contextWindow: 131072,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 0.8,
    costPer1MOutput: 2.0,
    currency: '¥',
    provider: 'Alibaba',
  },
  'qwen3.5-flash': {
    displayName: '通义千问 Qwen3.5 Flash',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelId: 'qwen3.5-flash',
    apiKeyEnvVar: 'DASHSCOPE_API_KEY',
    maxOutputTokens: 8192,
    contextWindow: 131072,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.6,
    currency: '¥',
    provider: 'Alibaba',
  },

  // ══════════════════════════════════════════════════════
  // 智谱 GLM — open.bigmodel.cn
  // 验证日期: 2026-04-02
  // 最新: glm-5 (旗舰), glm-4.7, glm-z1 (推理)
  // ══════════════════════════════════════════════════════
  'glm-5': {
    displayName: 'GLM-5 (旗舰)',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    modelId: 'glm-5',
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

  // ══════════════════════════════════════════════════════
  // Claude / Anthropic — api.anthropic.com (国际)
  // 注意：Anthropic API 格式与 OpenAI 不同，openaiClient.ts 中有适配层
  // ══════════════════════════════════════════════════════
  'claude-sonnet-4': {
    displayName: 'Claude Sonnet 4',
    apiBase: 'https://api.anthropic.com',
    modelId: 'claude-sonnet-4-20250514',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    maxOutputTokens: 16384,
    contextWindow: 200000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    currency: '$',
    provider: 'Anthropic',
  },
  'claude-3.5-sonnet': {
    displayName: 'Claude 3.5 Sonnet',
    apiBase: 'https://api.anthropic.com',
    modelId: 'claude-3-5-sonnet-20241022',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    maxOutputTokens: 8192,
    contextWindow: 200000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: true,
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    currency: '$',
    provider: 'Anthropic',
  },
  'claude-3.5-haiku': {
    displayName: 'Claude 3.5 Haiku',
    apiBase: 'https://api.anthropic.com',
    modelId: 'claude-3-5-haiku-20241022',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    maxOutputTokens: 8192,
    contextWindow: 200000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsVision: false,
    costPer1MInput: 0.8,
    costPer1MOutput: 4.0,
    currency: '$',
    provider: 'Anthropic',
  },

  // ══════════════════════════════════════════════════════
  // Gemini — generativelanguage.googleapis.com (国际)
  // ══════════════════════════════════════════════════════
  'gemini-2.5-pro': {
    displayName: 'Gemini 2.5 Pro',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelId: 'gemini-2.5-pro',
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
    modelId: 'gemini-2.5-flash',
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

  // ══════════════════════════════════════════════════════
  // OpenAI — api.openai.com (国际)
  // ══════════════════════════════════════════════════════
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
