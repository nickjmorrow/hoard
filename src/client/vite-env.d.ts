/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" runs the client against the in-memory fake API (pnpm dev:fake). */
  readonly VITE_FAKE_API?: string
  /** The server's name in the UI ("On <name>"); default "the server". */
  readonly VITE_SERVER_NAME?: string
}
