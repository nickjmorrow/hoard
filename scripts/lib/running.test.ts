import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { isHoardRunning } from './running.ts'

const servers: ReturnType<typeof createServer>[] = []
afterEach(() => { for (const s of servers.splice(0)) s.closeAllConnections(), s.close() })

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler)
  servers.push(server)
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
}

it('a server that answers is running', async () => {
  const port = await listen((_req, res) => res.end('[]'))
  expect(await isHoardRunning(port)).toBe(true)
})

it('a server that accepts but is slow to answer still counts as running', async () => {
  const port = await listen(() => { /* never answers */ })
  expect(await isHoardRunning(port, 200)).toBe(true)
})

it('nothing listening means stopped', async () => {
  const port = await listen((_req, res) => res.end())
  const server = servers.pop()!
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
  expect(await isHoardRunning(port)).toBe(false)
})
