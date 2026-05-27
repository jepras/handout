export type McpToolResult<T> = T

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id?: number | string
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

type ToolContent = {
  type: 'text'
  text: string
}

type ToolCallResult = {
  content?: ToolContent[]
  isError?: boolean
}

const MCP_ENDPOINT = import.meta.env.VITE_NORDPENSION_MCP_URL ?? '/mcp'
const JSON_RPC_VERSION = '2.0'

let nextId = 1
let sessionId: string | null = null
let initializePromise: Promise<void> | null = null

function parseSsePayload(raw: string): JsonRpcResponse {
  const events = raw
    .split(/\n\n+/)
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n'),
    )
    .filter(Boolean)

  const payload = events.at(-1)
  if (!payload) {
    throw new Error('MCP svarede med en tom event-stream')
  }
  return JSON.parse(payload) as JsonRpcResponse
}

async function parseResponse(response: Response): Promise<JsonRpcResponse | null> {
  const text = await response.text()
  if (!text.trim()) return null

  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    return parseSsePayload(text)
  }
  return JSON.parse(text) as JsonRpcResponse
}

async function postJsonRpc(method: string, params?: unknown, includeId = true): Promise<unknown> {
  const requestId = includeId ? nextId++ : undefined
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  }
  if (sessionId) headers['mcp-session-id'] = sessionId

  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: JSON_RPC_VERSION,
      ...(includeId ? { id: requestId } : {}),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  })

  const returnedSessionId = response.headers.get('mcp-session-id')
  if (returnedSessionId) sessionId = returnedSessionId

  const payload = await parseResponse(response)

  if (!response.ok) {
    const message = payload?.error?.message ?? `${response.status} ${response.statusText}`
    throw new Error(`MCP HTTP-fejl: ${message}`)
  }

  if (!payload) return undefined
  if (payload.error) {
    throw new Error(`MCP-fejl: ${payload.error.message}`)
  }
  return payload.result
}

async function ensureInitialized(): Promise<void> {
  if (initializePromise) return initializePromise

  initializePromise = (async () => {
    await postJsonRpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'nordpension-data-visualizer',
        version: '1.0.0',
      },
    })
    await postJsonRpc('notifications/initialized', undefined, false)
  })()

  return initializePromise
}

export async function callMcpTool<T>(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult<T>> {
  await ensureInitialized()
  const result = (await postJsonRpc('tools/call', { name, arguments: args })) as ToolCallResult
  const text = result.content?.find((item) => item.type === 'text')?.text

  if (result.isError) {
    throw new Error(text ?? `MCP-værktøjet ${name} fejlede`)
  }
  if (!text) {
    throw new Error(`MCP-værktøjet ${name} returnerede ikke JSON-tekst`)
  }

  const parsed = JSON.parse(text) as T
  if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
    throw new Error(String((parsed as { error: unknown }).error))
  }
  return parsed
}

