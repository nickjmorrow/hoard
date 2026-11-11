import { defineConfig } from 'vitest/config'

// Dates like `finished` follow the local time zone; tests pin one so they pass on any machine.
process.env.TZ = 'America/New_York'

// Client test files start with `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    globals: true,
    // Grimoire tests run many real `grim` calls; a busy machine can push one past the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
})
