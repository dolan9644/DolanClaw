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
const ANTHROPIC_API_VERSION = '2023-06-01'

function isAnthropicProvider(config: OpenAIModelConfig): boolean {
  return config.provider === 'Anthropic'
}

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

  // Anthropic needs special request format + URL
  const url = isAnthropicProvider(config)
    ? `${config.apiBase}/v1/messages`
    : `${config.apiBase}/chat/completions`

  const requestBody = isAnthropicProvider(config)
    ? buildAnthropicRequestBody(body, config)
    : JSON.stringify(body)

  const response = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: buildHeaders(apiKey, config),
      body: requestBody,
      signal: options.signal,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    config.displayName,
  )

  // If Anthropic, wrap the response to convert SSE format to OpenAI format
  if (isAnthropicProvider(config) && response.ok && response.body) {
    return wrapAnthropicStreamAsOpenAI(response)
  }

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
    const url = isAnthropicProvider(config)
      ? `${config.apiBase}/v1/messages`
      : `${config.apiBase}/chat/completions`

    const body = isAnthropicProvider(config)
      ? JSON.stringify({
          model: config.modelId,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        })
      : JSON.stringify({
          model: config.modelId,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
          stream: false,
        })

    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: buildHeaders(apiKey, config),
        body,
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
  if (isAnthropicProvider(config)) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  return headers
}

// ─── Anthropic Adapter ──────────────────────────────────

/**
 * Convert OpenAI-style request body to Anthropic Messages API format.
 * Key differences:
 * - system prompt is a separate top-level field, not in messages
 * - max_tokens is required
 * - stream is a boolean at top level
 */
function buildAnthropicRequestBody(
  request: OpenAIChatRequest,
  config: OpenAIModelConfig,
): string {
  // Extract system messages and regular messages
  const systemParts: string[] = []
  const messages: Array<{ role: string; content: string }> = []

  for (const msg of request.messages || []) {
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
    } else {
      messages.push({
        role: msg.role as string,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      })
    }
  }

  const body: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: request.max_tokens || config.maxOutputTokens,
    messages,
    stream: true,
  }

  if (systemParts.length > 0) {
    body.system = systemParts.join('\n\n')
  }

  return JSON.stringify(body)
}

/**
 * Wrap an Anthropic SSE stream response into an OpenAI-compatible SSE stream.
 * Anthropic events:
 *   event: content_block_delta  → data: {"delta":{"type":"text_delta","text":"..."}}
 *   event: message_delta        → data: {"usage":{"output_tokens":N}}
 *   event: message_start        → data: {"message":{"usage":{"input_tokens":N}}}
 *   event: message_stop         → end of stream
 * Converted to OpenAI:
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: {"usage":{"prompt_tokens":N,"completion_tokens":N}}
 *   data: [DONE]
 */
function wrapAnthropicStreamAsOpenAI(response: Response): Response {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let inputTokens = 0
  let outputTokens = 0

  const transformed = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        // Send final usage + DONE
        const usageChunk = JSON.stringify({
          usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
        })
        controller.enqueue(encoder.encode(`data: ${usageChunk}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
        return
      }

      const text = decoder.decode(value, { stream: true })
      const lines = text.split('\n')

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const dataStr = trimmed.slice(6)

        try {
          const event = JSON.parse(dataStr)

          // message_start → extract input tokens
          if (event.type === 'message_start' && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens || 0
          }

          // content_block_delta → text content
          if (event.type === 'content_block_delta' && event.delta?.text) {
            const openaiChunk = JSON.stringify({
              choices: [{ delta: { content: event.delta.text } }],
            })
            controller.enqueue(encoder.encode(`data: ${openaiChunk}\n\n`))
          }

          // message_delta → output tokens
          if (event.type === 'message_delta' && event.usage) {
            outputTokens = event.usage.output_tokens || 0
          }

          // message_stop → will be handled when reader.done=true
        } catch {
          // Ignore parse errors
        }
      }
    },
  })

  return new Response(transformed, {
    status: response.status,
    headers: response.headers,
  })
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
