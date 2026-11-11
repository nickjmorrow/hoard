// Whether Hoard's server is up, so a script never changes the store's file under a live writer.

/**
 * True unless nothing is listening on the port. A server that is slow to answer (just started, busy)
 * counts as running: only a refused connection proves it's stopped.
 */
export async function isHoardRunning(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/library`, { signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch (err) {
    const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined
    return cause?.code !== 'ECONNREFUSED'
  }
}
