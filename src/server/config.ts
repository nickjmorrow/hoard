// The server's settings from the environment, checked before anything starts.

const DEFAULT_PORT = 8781

/**
 * The port to listen on and where Hoard's store lives (`HOARD_DATA`, default ~/Library/Application Support/Hoard).
 * Throws with a message naming the variable when a setting is missing or invalid.
 */
export function serverConfig(env: Record<string, string | undefined>): { port: number; dataDir: string } {
  const dataDir = env.HOARD_DATA?.trim() || `${env.HOME ?? '.'}/Library/Application Support/Hoard`
  const raw = env.PORT?.trim() ?? ''
  if (raw === '') return { port: DEFAULT_PORT, dataDir }
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!(port >= 1 && port <= 65535)) throw new Error(`PORT must be a whole number from 1 to 65535, got ${JSON.stringify(env.PORT)}`)
  return { port, dataDir }
}
