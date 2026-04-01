/**
 * HTTP client for OpenAI-compatible APIs.
 *
 * This is a standalone HTTP client that directly calls third-party
 * LLM APIs using `fetch`. It does NOT use the Anthropic SDK.
 *
 * The client supports:
 * - Non-streaming requests (returns full response)
 * - Streaming requests (returns Response for SSE parsing)
 * - Automatic retry with exponential backoff
 * - Request/response logging for debugging
 */

import { getProxyFetchOptions } from '../../utils/proxy.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import {
  type OpenAIModelConfig,
  getModelApiKey,
  getOpenAIModelConfig,
} from '../../utils/model/openaiModels.js'
import type { OpenAIChatRequest, OpenAIChatResponse } from './openaiCompat.js'

// ─── Config ─────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1000

// ─── Client ─────────────────────────────────────────────

export interface OpenAIClientOptions {
  modelKey: string
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Send a non-streaming request to an OpenAI-compatible API.
 */
export async function openaiChatCompletion(
  request: OpenAIChatRequest,
  options: OpenAIClientOptions,
): Promise<OpenAIChatResponse> {
  const config = getOpenAIModelConfig(options.modelKey)
  if (!config) {
    throw new Error(`Unknown model: ${options.modelKey}`)
  }

  const apiKey = getModelApiKey(config)
  if (!apiKey) {
    throw new Error(
      `API key not found for ${config.displayName}. ` +
      `Set the ${config.apiKeyEnvVar} environment variable.`,
    )
  }

  const body: OpenAIChatRequest = {
    ...request,
    model: config.modelId,
    stream: false,
  }

  const response = await fetchWithRetry(
    `${config.apiBase}/chat/completions`,
    {
      method: 'POST',
      headers: buildHeaders(apiKey, config),
      body: JSON.stringify(body),
      signal: options.signal,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    config.displayName,
  )

  const json = await response.json()
  return json as OpenAIChatResponse
}

/**
 * Send a streaming request to an OpenAI-compatible API.
 * Returns the raw Response object for SSE parsing.
 */
export async function openaiChatCompletionStream(
  request: OpenAIChatRequest,
  options: OpenAIClientOptions,
): Promise<Response> {
  const config = getOpenAIModelConfig(options.modelKey)
  if (!config) {
    throw new Error(`Unknown model: ${options.modelKey}`)
  }

  const apiKey = getModelApiKey(config)
  if (!apiKey) {
    throw new Error(
      `API key not found for ${config.displayName}. ` +
      `Set the ${config.apiKeyEnvVar} environment variable.`,
    )
  }

  if (!config.supportsStreaming) {
    throw new Error(`${config.displayName} does not support streaming`)
  }

  const body: OpenAIChatRequest = {
    ...request,
    model: config.modelId,
    stream: true,
    stream_options: { include_usage: true },
  }

  const response = await fetchWithRetry(
    `${config.apiBase}/chat/completions`,
    {
      method: 'POST',
      headers: buildHeaders(apiKey, config),
      body: JSON.stringify(body),
      signal: options.signal,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    config.displayName,
  )

  return response
}

/**
 * Test connection to an OpenAI-compatible API.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function testOpenAIConnection(
  modelKey: string,
): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
  const config = getOpenAIModelConfig(modelKey)
  if (!config) {
    return { ok: false, error: `Unknown model: ${modelKey}` }
  }

  const apiKey = getModelApiKey(config)
  if (!apiKey) {
    return {
      ok: false,
      error: `API key not configured. Set ${config.apiKeyEnvVar}`,
    }
  }

  const start = Date.now()
  try {
    const response = await fetchWithRetry(
      `${config.apiBase}/chat/completions`,
      {
        method: 'POST',
        headers: buildHeaders(apiKey, config),
        body: JSON.stringify({
          model: config.modelId,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
          stream: false,
        }),
      },
      15_000, // 15s timeout for test
      config.displayName,
    )
    const latencyMs = Date.now() - start

    if (!response.ok) {
      const text = await response.text()
      return { ok: false, error: `HTTP ${response.status}: ${text}`, latencyMs }
    }

    return { ok: true, latencyMs }
  } catch (err) {
    return {
      ok: false,
      error: errorMessage(err),
      latencyMs: Date.now() - start,
    }
  }
}

// ─── Internals ──────────────────────────────────────────

function buildHeaders(
  apiKey: string,
  config: OpenAIModelConfig,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  // Some providers need extra headers
  if (config.provider === 'Zhipu') {
    // GLM uses a JWT-style token, but their OpenAI compat endpoint
    // accepts Bearer too — keep it simple for now.
  }

  return headers
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  modelName: string,
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
      logForDebugging(
        `[openai-client] Retrying ${modelName} (attempt ${attempt + 1}) after ${delay}ms`,
      )
      await new Promise(r => setTimeout(r, delay))
    }

    try {
      logForDebugging(
        `[openai-client] ${modelName} → POST ${url} (attempt ${attempt + 1})`,
      )

      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

      // Merge signals if the caller provided one
      const callerSignal = (init as { signal?: AbortSignal }).signal
      if (callerSignal?.aborted) {
        clearTimeout(timeoutHandle)
        throw new Error('Request aborted by caller')
      }

      const proxyFetchOptions = getProxyFetchOptions({ forAnthropicAPI: false })

      const response = await fetch(url, {
        ...init,
        ...proxyFetchOptions,
        signal: controller.signal,
      })

      clearTimeout(timeoutHandle)

      // Only retry on 5xx errors
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new Error(`HTTP ${response.status}`)
        logForDebugging(
          `[openai-client] ${modelName} returned ${response.status}, will retry`,
        )
        continue
      }

      // 429 rate limit — retry with back-pressure
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('retry-after')
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        logForDebugging(
          `[openai-client] ${modelName} rate limited, waiting ${waitMs}ms`,
        )
        await new Promise(r => setTimeout(r, waitMs))
        continue
      }

      logForDebugging(
        `[openai-client] ${modelName} → ${response.status} (${Date.now()}ms)`,
      )
      return response
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      if (lastError.name === 'AbortError') {
        throw new Error(
          `Request to ${modelName} timed out after ${timeoutMs}ms`,
        )
      }

      if (attempt === MAX_RETRIES) {
        throw lastError
      }

      logForDebugging(
        `[openai-client] ${modelName} error: ${lastError.message}`,
      )
    }
  }

  throw lastError || new Error('Unexpected retry exhaustion')
}
