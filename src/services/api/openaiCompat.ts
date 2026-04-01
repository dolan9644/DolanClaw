/**
 * OpenAI-compatible format adapter.
 *
 * Converts between Anthropic Messages API format (used internally by
 * Claude Code) and OpenAI Chat Completions format (used by MiniMax,
 * DeepSeek, Kimi, Qwen, GLM, Gemini, OpenAI, etc.)
 *
 * The adapter handles:
 * - Request conversion:  Anthropic system prompt + messages + tools → OpenAI request
 * - Response conversion: OpenAI response → Anthropic BetaMessage
 * - Stream conversion:   OpenAI SSE deltas → Anthropic stream events
 * - Tool call mapping:   tool_use ↔ function_call / tool_calls
 */

import type {
  BetaContentBlock,
  BetaMessage,
  BetaRawMessageStreamEvent,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { logForDebugging } from '../../utils/debug.js'

// ─── OpenAI Types (subset we need) ──────────────────────

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIChatMessage[]
  tools?: OpenAITool[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  max_tokens?: number
  temperature?: number
  stream?: boolean
  stream_options?: { include_usage: boolean }
}

export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason: 'stop' | 'tool_calls' | 'length' | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface OpenAIStreamDelta {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: 'assistant'
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason: 'stop' | 'tool_calls' | 'length' | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  } | null
}

// ─── Request Conversion: Anthropic → OpenAI ─────────────

/**
 * Convert Anthropic system prompt + message array into OpenAI messages.
 */
export function toOpenAIMessages(
  systemPrompt: string | Array<{ type: 'text'; text: string }>,
  anthropicMessages: Array<{ role: string; content: unknown }>,
): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = []

  // System prompt
  const sysText =
    typeof systemPrompt === 'string'
      ? systemPrompt
      : systemPrompt.map(b => b.text).join('\n\n')
  if (sysText) {
    messages.push({ role: 'system', content: sysText })
  }

  for (const msg of anthropicMessages) {
    if (msg.role === 'user') {
      messages.push(...convertUserMessage(msg.content))
    } else if (msg.role === 'assistant') {
      messages.push(...convertAssistantMessage(msg.content))
    }
  }

  return messages
}

function convertUserMessage(content: unknown): OpenAIChatMessage[] {
  if (typeof content === 'string') {
    return [{ role: 'user', content }]
  }

  if (!Array.isArray(content)) {
    return [{ role: 'user', content: String(content) }]
  }

  const messages: OpenAIChatMessage[] = []
  const textParts: string[] = []
  const toolResults: Array<{ id: string; content: string }> = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_result') {
      // Anthropic tool_result → OpenAI tool message
      let resultContent = ''
      if (typeof block.content === 'string') {
        resultContent = block.content
      } else if (Array.isArray(block.content)) {
        resultContent = block.content
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('\n')
      }
      if (block.is_error) {
        resultContent = `[ERROR] ${resultContent}`
      }
      toolResults.push({
        id: block.tool_use_id,
        content: resultContent,
      })
    }
    // image blocks, document blocks etc. are dropped for now
    // (TODO: convert to OpenAI vision format for models that support it)
  }

  // Emit tool results first (OpenAI requires tool messages right after assistant tool_calls)
  for (const tr of toolResults) {
    messages.push({
      role: 'tool',
      content: tr.content,
      tool_call_id: tr.id,
    })
  }

  // Then emit text if any
  if (textParts.length > 0) {
    messages.push({ role: 'user', content: textParts.join('\n') })
  }

  return messages
}

function convertAssistantMessage(content: unknown): OpenAIChatMessage[] {
  if (typeof content === 'string') {
    return [{ role: 'assistant', content }]
  }

  if (!Array.isArray(content)) {
    return [{ role: 'assistant', content: String(content) }]
  }

  const textParts: string[] = []
  const toolCalls: OpenAIToolCall[] = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input),
        },
      })
    }
    // thinking blocks are skipped — OpenAI doesn't have this concept
  }

  const msg: OpenAIChatMessage = {
    role: 'assistant',
    content: textParts.length > 0 ? textParts.join('\n') : null,
  }
  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls
  }
  return [msg]
}

/**
 * Convert Anthropic tool schemas to OpenAI function schemas.
 */
export function toOpenAITools(
  anthropicTools: BetaToolUnion[],
): OpenAITool[] {
  return anthropicTools
    .filter((t): t is BetaToolUnion & { name: string } => 'name' in t)
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: (tool as { description?: string }).description || '',
        parameters:
          (tool as { input_schema?: Record<string, unknown> }).input_schema || {},
      },
    }))
}

// ─── Response Conversion: OpenAI → Anthropic ────────────

/**
 * Convert an OpenAI Chat Completion response to an Anthropic BetaMessage.
 */
export function fromOpenAIResponse(
  response: OpenAIChatResponse,
): BetaMessage {
  const choice = response.choices[0]
  if (!choice) {
    throw new Error('OpenAI response has no choices')
  }

  const content: BetaContentBlock[] = []

  // Text content
  if (choice.message.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    } as BetaContentBlock)
  }

  // Tool calls → tool_use blocks
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let parsedInput: Record<string, unknown>
      try {
        parsedInput = JSON.parse(tc.function.arguments)
      } catch {
        parsedInput = { raw: tc.function.arguments }
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      } as unknown as BetaContentBlock)
    }
  }

  // Map finish_reason
  let stopReason: string
  switch (choice.finish_reason) {
    case 'tool_calls':
      stopReason = 'tool_use'
      break
    case 'length':
      stopReason = 'max_tokens'
      break
    case 'stop':
    default:
      stopReason = 'end_turn'
      break
  }

  const usage: BetaUsage = {
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  } as BetaUsage

  return {
    id: response.id || `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: response.model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  } as unknown as BetaMessage
}

// ─── Stream Conversion: OpenAI SSE → Anthropic Events ───

/**
 * Convert an OpenAI SSE stream into Anthropic-compatible stream events.
 * This is an async generator that yields BetaRawMessageStreamEvent objects.
 */
export async function* fromOpenAIStream(
  response: Response,
  model: string,
): AsyncGenerator<BetaRawMessageStreamEvent> {
  const msgId = `msg_${randomUUID()}`
  let inputTokens = 0
  let outputTokens = 0

  // Emit message_start
  yield {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  } as unknown as BetaRawMessageStreamEvent

  // Track content block state
  let currentBlockIndex = 0
  let hasStartedTextBlock = false
  const toolCallAccumulators: Map<
    number,
    { id: string; name: string; args: string; blockIndex: number }
  > = new Map()

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete SSE lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (!trimmed.startsWith('data: ')) continue

        const data = trimmed.slice(6)
        if (data === '[DONE]') {
          // Close any open tool call blocks
          for (const [, acc] of toolCallAccumulators) {
            let parsedArgs: Record<string, unknown>
            try {
              parsedArgs = JSON.parse(acc.args)
            } catch {
              parsedArgs = { raw: acc.args }
            }
            yield {
              type: 'content_block_stop',
              index: acc.blockIndex,
            } as unknown as BetaRawMessageStreamEvent
          }

          // Close text block if open
          if (hasStartedTextBlock) {
            yield {
              type: 'content_block_stop',
              index: 0,
            } as unknown as BetaRawMessageStreamEvent
          }
          continue
        }

        let chunk: OpenAIStreamDelta
        try {
          chunk = JSON.parse(data)
        } catch {
          logForDebugging(`[openai-compat] Failed to parse SSE chunk: ${data}`)
          continue
        }

        // Extract usage if present
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens || 0
          outputTokens = chunk.usage.completion_tokens || 0
        }

        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        // Text delta
        if (delta.content) {
          if (!hasStartedTextBlock) {
            hasStartedTextBlock = true
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            } as unknown as BetaRawMessageStreamEvent
          }
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: delta.content },
          } as unknown as BetaRawMessageStreamEvent
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            let acc = toolCallAccumulators.get(tc.index)
            if (!acc) {
              // New tool call starting
              currentBlockIndex++
              const blockIdx = currentBlockIndex
              acc = {
                id: tc.id || `call_${randomUUID()}`,
                name: tc.function?.name || '',
                args: '',
                blockIndex: blockIdx,
              }
              toolCallAccumulators.set(tc.index, acc)

              yield {
                type: 'content_block_start',
                index: blockIdx,
                content_block: {
                  type: 'tool_use',
                  id: acc.id,
                  name: acc.name,
                  input: {},
                },
              } as unknown as BetaRawMessageStreamEvent
            }

            // Accumulate function name and arguments
            if (tc.function?.name) {
              acc.name += tc.function.name
            }
            if (tc.function?.arguments) {
              acc.args += tc.function.arguments
              yield {
                type: 'content_block_delta',
                index: acc.blockIndex,
                delta: {
                  type: 'input_json_delta',
                  partial_json: tc.function.arguments,
                },
              } as unknown as BetaRawMessageStreamEvent
            }
          }
        }

        // Check finish reason
        const finishReason = chunk.choices?.[0]?.finish_reason
        if (finishReason) {
          let stopReason: string
          switch (finishReason) {
            case 'tool_calls':
              stopReason = 'tool_use'
              break
            case 'length':
              stopReason = 'max_tokens'
              break
            default:
              stopReason = 'end_turn'
          }

          yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: outputTokens },
          } as unknown as BetaRawMessageStreamEvent
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  // Final message_stop
  yield {
    type: 'message_stop',
  } as unknown as BetaRawMessageStreamEvent
}
