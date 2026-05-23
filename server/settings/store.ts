import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'

const SETTINGS_PATH = join(process.cwd(), 'data', 'settings.json')

export const userSettingsSchema = z.object({
  userName: z.string().default(''),
  leaderName: z.string().default(''),
  leaderOpenId: z.string().optional(),
  leaderUserId: z.string().optional(),
  leaderMobile: z.string().optional(),
  leaderEmail: z.string().optional(),
  feishuAppId: z.string().optional(),
  feishuAppSecret: z.string().optional(),
  homeAddress: z.string().default(''),
  emergencyContactName: z.string().default(''),
  emergencyContactFeishuName: z.string().default(''),
  emergencyPhone: z.string().default(''),
  emergencyOpenId: z.string().optional(),
  emergencyUserId: z.string().optional(),
  emergencyEmail: z.string().optional(),
  allergies: z.string().default(''),
  medicalNotes: z.string().default(''),
  tencentMapKey: z.string().default(''),
  autoRide: z.boolean().default(true),
  autoMessage: z.boolean().default(true),
  autoExecute: z.boolean().default(true),
})

export type UserSettings = z.infer<typeof userSettingsSchema>

export const defaultUserSettings: UserSettings = userSettingsSchema.parse({})

export async function readUserSettings(): Promise<UserSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf8')
    return userSettingsSchema.parse(JSON.parse(raw))
  } catch {
    return defaultUserSettings
  }
}

export async function saveUserSettings(input: Partial<UserSettings>): Promise<UserSettings> {
  const current = await readUserSettings()
  const next = userSettingsSchema.parse({ ...current, ...input })
  await mkdir(dirname(SETTINGS_PATH), { recursive: true })
  await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

export async function mergeWithStoredSettings(input: Partial<UserSettings> = {}): Promise<UserSettings> {
  const stored = await readUserSettings()
  const cleaned = Object.fromEntries(
    Object.entries(input).filter(([, value]) => !(typeof value === 'string' && value.trim() === '')),
  )
  return userSettingsSchema.parse({ ...stored, ...cleaned })
}
