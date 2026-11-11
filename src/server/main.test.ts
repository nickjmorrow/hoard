import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { serverConfig } from './config.ts'

describe('serverConfig', () => {
  test('PORT unset or empty uses 8781', () => {
    expect(serverConfig({})).toMatchObject({ port: 8781 })
    expect(serverConfig({ PORT: '' })).toMatchObject({ port: 8781 })
    expect(serverConfig({ PORT: ' 9000 ' })).toMatchObject({ port: 9000 })
    expect(serverConfig({ HOME: '/Users/alice' }).dataDir).toBe('/Users/alice/Library/Application Support/Hoard')
    expect(serverConfig({ HOARD_DATA: '/data' }).dataDir).toBe('/data')
  })

  test('a PORT that is not a valid port is an error that names it', () => {
    for (const PORT of ['abc', '80x', '0', '65536', '-1', '1.5']) {
      expect(() => serverConfig({ PORT })).toThrow(/PORT/)
    }
  })

  test('needs nothing but its own settings: no Grimoire graph', () => {
    expect(serverConfig({ HOME: '/h' })).toEqual({ port: 8781, dataDir: '/h/Library/Application Support/Hoard' })
  })
})

test('main exits with a clear message, before listening, when PORT is not a valid port', async () => {
  const main = fileURLToPath(new URL('./main.ts', import.meta.url))
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: 'abc' }
  const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = execFile(process.execPath, [main], { env, timeout: 10_000 }, (_err, _stdout, stderr) => {
      resolve({ code: child.exitCode, stderr })
    })
  })
  expect(result.code).toBe(1)
  expect(result.stderr).toMatch(/PORT/)
}, 15_000)
