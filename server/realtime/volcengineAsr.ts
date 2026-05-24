import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const HEADER_VERSION = 0x1
const HEADER_SIZE = 0x1
const MESSAGE_TYPE_FULL_CLIENT_REQUEST = 0x1
const MESSAGE_TYPE_AUDIO_ONLY_REQUEST = 0x2
const MESSAGE_TYPE_ERROR = 0xf
const SERIALIZATION_NONE = 0x0
const SERIALIZATION_JSON = 0x1
const COMPRESSION_NONE = 0x0

type VolcengineAsrConfig = {
  endpoint: string
  appKey: string
  resourceId: string
  rate?: number
  bits?: number
  channels?: number
  uid?: string
}

type VolcengineAsrResult = {
  text: string
  stableText: string
  logId: string
}

type VolcengineResponse = {
  flags: number
  data: Record<string, unknown>
}

export class VolcengineAsrSession {
  private socket: WebSocket | null = null
  private waiters: Array<{ resolve: (value: Buffer) => void; reject: (error: Error) => void }> = []
  private pendingFrames: Buffer[] = []
  private receiveLoop: Promise<VolcengineAsrResult> | null = null
  private responseLogId = ''
  private lastText = ''
  private stableText = ''
  private closed = false
  private readonly config: VolcengineAsrConfig
  private readonly callbacks: { onStableText?: (text: string) => void | Promise<void> }

  constructor(
    config: VolcengineAsrConfig,
    callbacks: { onStableText?: (text: string) => void | Promise<void> } = {},
  ) {
    this.config = config
    this.callbacks = callbacks
  }

  async connect() {
    const requestId = randomUUID()
    const connectId = randomUUID()
    const socket = new WebSocket(this.config.endpoint, {
      headers: {
        'X-Api-Key': this.config.appKey,
        'X-Api-Resource-Id': this.config.resourceId,
        'X-Api-Request-Id': requestId,
        'X-Api-Sequence': '-1',
        'X-Api-Connect-Id': connectId,
      },
    })
    this.socket = socket

    socket.once('upgrade', (response) => {
      const logId = response.headers['x-tt-logid']
      this.responseLogId = Array.isArray(logId) ? logId[0] || '' : logId || ''
    })
    socket.on('message', (data) => this.onMessage(data))
    socket.on('close', () => this.flushWaiters(new Error('Volcengine ASR connection closed')))
    socket.on('error', (error) => this.flushWaiters(error instanceof Error ? error : new Error(String(error))))

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })

    const requestPayload = Buffer.from(JSON.stringify(buildVolcengineRequest(this.config)), 'utf8')
    this.sendBinary(buildClientMessage(MESSAGE_TYPE_FULL_CLIENT_REQUEST, 0x0, requestPayload, SERIALIZATION_JSON))
    parseServerMessage(await this.receiveBinary())
    this.receiveLoop = this.startReceiveLoop()
    this.receiveLoop.catch(() => undefined)
  }

  write(chunk: Buffer) {
    if (this.closed || chunk.length === 0) return
    this.sendBinary(buildClientMessage(MESSAGE_TYPE_AUDIO_ONLY_REQUEST, 0x0, chunk, SERIALIZATION_NONE))
  }

  async finish(finalChunk?: Buffer) {
    if (this.closed) {
      return this.receiveLoop || { text: this.lastText, stableText: this.stableText, logId: this.responseLogId }
    }
    if (finalChunk?.length) {
      this.sendBinary(buildClientMessage(MESSAGE_TYPE_AUDIO_ONLY_REQUEST, 0x0, finalChunk, SERIALIZATION_NONE))
    }
    this.closed = true
    this.sendBinary(buildEmptyLastAudioMessage())

    try {
      return await (this.receiveLoop || Promise.resolve({ text: this.lastText, stableText: this.stableText, logId: this.responseLogId }))
    } finally {
      this.close()
    }
  }

  abort() {
    this.closed = true
    this.close()
  }

  private async startReceiveLoop(): Promise<VolcengineAsrResult> {
    while (true) {
      const response = parseServerMessage(await this.receiveBinary(30000))
      const nextText = appendableText(response.data?.result && (response.data.result as { text?: unknown }).text)
      if (nextText) this.lastText = nextText

      const nextStableText = appendableText(getStableText(response.data))
      const stableDelta = diffSuffix(this.stableText, nextStableText)
      if (stableDelta) {
        this.stableText = nextStableText
        await this.callbacks.onStableText?.(stableDelta)
      }

      if (response.flags === 0x3) {
        return {
          text: this.lastText,
          stableText: this.stableText,
          logId: this.responseLogId,
        }
      }
    }
  }

  private onMessage(data: WebSocket.RawData) {
    const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(frame)
    else this.pendingFrames.push(frame)
  }

  private sendBinary(payload: Buffer) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Volcengine ASR is not connected')
    }
    this.socket.send(payload)
  }

  private async receiveBinary(timeoutMs = 30000) {
    if (this.pendingFrames.length > 0) return this.pendingFrames.shift() as Buffer

    return new Promise<Buffer>((resolve, reject) => {
      const waiter = {
        resolve: (value: Buffer) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error: Error) => {
          clearTimeout(timer)
          reject(error)
        },
      }
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter)
        reject(new Error('Timed out waiting for Volcengine ASR response'))
      }, timeoutMs)
      this.waiters.push(waiter)
    })
  }

  private flushWaiters(error: Error) {
    while (this.waiters.length > 0) this.waiters.shift()?.reject(error)
  }

  private close() {
    try {
      this.socket?.close()
    } catch {
      // Ignore close failures.
    }
    this.socket = null
  }
}

function buildVolcengineRequest(config: VolcengineAsrConfig) {
  return {
    user: {
      uid: config.uid || 'test_user_001',
    },
    audio: {
      format: 'pcm',
      rate: config.rate || 16000,
      bits: config.bits || 16,
      channel: config.channels || 1,
      codec: 'raw',
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: true,
      end_window_size: 800,
      show_utterances: true,
    },
  }
}

function buildProtocolHeader(messageType: number, flags: number, serialization: number, compression: number) {
  return Buffer.from([
    (HEADER_VERSION << 4) | HEADER_SIZE,
    (messageType << 4) | flags,
    (serialization << 4) | compression,
    0x00,
  ])
}

function buildClientMessage(messageType: number, flags: number, payload: Buffer, serialization: number) {
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length, 0)
  return Buffer.concat([
    buildProtocolHeader(messageType, flags, serialization, COMPRESSION_NONE),
    size,
    payload,
  ])
}

function buildEmptyLastAudioMessage() {
  const payload = Buffer.alloc(0)
  const size = Buffer.alloc(4)
  size.writeUInt32BE(payload.length, 0)
  return Buffer.concat([
    buildProtocolHeader(MESSAGE_TYPE_AUDIO_ONLY_REQUEST, 0x2, SERIALIZATION_NONE, COMPRESSION_NONE),
    size,
    payload,
  ])
}

function parseServerMessage(message: Buffer): VolcengineResponse {
  if (message.length < 8) throw new Error('Invalid Volcengine response frame')

  const headerSize = (message[0] & 0x0f) * 4
  const messageType = message[1] >> 4
  const flags = message[1] & 0x0f
  const serialization = message[2] >> 4
  let offset = headerSize

  if (messageType === MESSAGE_TYPE_ERROR) {
    const code = message.readUInt32BE(offset)
    offset += 4
    const payloadSize = message.readUInt32BE(offset)
    offset += 4
    const payload = message.subarray(offset, offset + payloadSize)
    throw new Error(`Volcengine ASR error ${code}: ${payload.toString('utf8')}`)
  }

  if (flags === 0x1 || flags === 0x3) offset += 4
  const payloadSize = message.readUInt32BE(offset)
  offset += 4
  const payload = message.subarray(offset, offset + payloadSize)

  return {
    flags,
    data: serialization === SERIALIZATION_JSON ? JSON.parse(payload.toString('utf8')) : { payload },
  }
}

function appendableText(text: unknown) {
  return typeof text === 'string' ? text.trim() : ''
}

function diffSuffix(previous: string, next: string) {
  if (!next) return ''
  if (!previous) return next
  if (next.startsWith(previous)) return next.slice(previous.length).trim()
  return ''
}

function getStableText(data: Record<string, unknown>) {
  const result = data.result as { utterances?: Array<{ definite?: boolean; text?: string }> } | undefined
  const utterances = Array.isArray(result?.utterances) ? result.utterances : []
  return utterances
    .filter((item) => item?.definite && typeof item.text === 'string' && item.text.trim())
    .map((item) => item.text)
    .join('')
    .trim()
}
