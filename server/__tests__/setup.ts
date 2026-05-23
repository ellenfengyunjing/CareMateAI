// Sets minimal env vars so server/config/env.ts parses cleanly during tests.
process.env.OPENAI_API_KEY ??= 'test-openai-key'
process.env.FEISHU_MOCK ??= 'true'
process.env.TENCENT_MAP_KEY ??= 'test-tencent-key'
