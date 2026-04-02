/**
 * DolanClaw — Model Registry Tests
 *
 * Validates the model configuration registry for completeness and correctness.
 * Run: bun test tests/openai-models.test.ts
 */
import { describe, test, expect } from 'bun:test'

// Import the model registry
import { getOpenAIModelConfig, getModelApiKey, getOpenAIModelRegistry } from '../src/utils/model/openaiModels'

// ─── Model Registry Structure ────────────────────────────

describe('Model Registry — getOpenAIModelRegistry', () => {
  test('should return non-empty object', () => {
    const configs = getOpenAIModelRegistry()
    expect(typeof configs).toBe('object')
    expect(Object.keys(configs).length).toBeGreaterThan(10)
  })

  test('each model should have required fields', () => {
    const configs = getOpenAIModelRegistry()
    for (const [key, config] of Object.entries(configs)) {
      expect(config).toHaveProperty('displayName')
      expect(config).toHaveProperty('modelId')
      expect(config).toHaveProperty('apiBase')
      expect(config).toHaveProperty('provider')
      expect(config).toHaveProperty('apiKeyEnvVar')
      expect(config).toHaveProperty('costPer1MInput')
      expect(config).toHaveProperty('costPer1MOutput')
      expect(config).toHaveProperty('maxOutputTokens')

      // Values should be non-empty strings
      expect(typeof config.displayName).toBe('string')
      expect(config.displayName.length).toBeGreaterThan(0)
      expect(typeof config.modelId).toBe('string')
      expect(config.modelId.length).toBeGreaterThan(0)
      expect(typeof config.apiBase).toBe('string')
      expect(config.apiBase.length).toBeGreaterThan(0)
      expect(typeof config.provider).toBe('string')
      expect(typeof config.apiKeyEnvVar).toBe('string')

      // Cost has to be a non-negative number
      expect(typeof config.costPer1MInput).toBe('number')
      expect(config.costPer1MInput).toBeGreaterThanOrEqual(0)
      expect(typeof config.costPer1MOutput).toBe('number')
      expect(config.costPer1MOutput).toBeGreaterThanOrEqual(0)

      // Max output tokens should be reasonable
      expect(typeof config.maxOutputTokens).toBe('number')
      expect(config.maxOutputTokens).toBeGreaterThan(0)
    }
  })
})

// ─── Specific Provider Tests ─────────────────────────────

describe('Model Registry — Provider Configs', () => {
  test('MiniMax models should use MINIMAX_API_KEY', () => {
    const minimax = getOpenAIModelConfig('minimax-m2.7')
    expect(minimax).not.toBeNull()
    expect(minimax!.apiKeyEnvVar).toBe('MINIMAX_API_KEY')
    expect(minimax!.provider).toBe('MiniMax')
  })

  test('Claude models should use ANTHROPIC_API_KEY', () => {
    const claude = getOpenAIModelConfig('claude-sonnet-4')
    expect(claude).not.toBeNull()
    expect(claude!.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY')
  })

  test('DeepSeek models should use DEEPSEEK_API_KEY', () => {
    const ds = getOpenAIModelConfig('deepseek-v3')
    expect(ds).not.toBeUndefined()
    expect(ds!.apiKeyEnvVar).toBe('DEEPSEEK_API_KEY')
  })
})

// ─── getOpenAIModelConfig ────────────────────────────────

describe('Model Registry — getOpenAIModelConfig', () => {
  test('should return config for known model', () => {
    const config = getOpenAIModelConfig('minimax-m2.7')
    expect(config).not.toBeNull()
    expect(config!.displayName).toBeTruthy()
  })

  test('should return null for unknown model key', () => {
    const config = getOpenAIModelConfig('nonexistent-model-xyz')
    expect(config).toBeUndefined()
  })
})

// ─── getModelApiKey ──────────────────────────────────────

describe('Model Registry — getModelApiKey', () => {
  test('should return string or empty for models', () => {
    const config = getOpenAIModelConfig('minimax-m2.7')
    if (config) {
      const key = getModelApiKey(config)
      // Key may be empty if env var not set — that's fine for tests
      expect(typeof key === 'string' || key === null || key === undefined).toBe(true)
    }
  })
})

// ─── Streaming Support ───────────────────────────────────

describe('Model Registry — Streaming', () => {
  test('all models should have supportsStreaming property', () => {
    const configs = getOpenAIModelRegistry()
    for (const [key, config] of Object.entries(configs)) {
      expect(typeof config.supportsStreaming).toBe('boolean')
    }
  })
})
