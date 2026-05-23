import { mkdir, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const logPath = join(process.cwd(), 'logs', 'realtime.ndjson')

export async function logEvent(event: string, payload: unknown) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    event,
    payload,
  })

  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `${line}\n`, 'utf8')
}

