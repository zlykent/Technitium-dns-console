import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Two projects, split by directory rather than by a per-file docblock.
 *
 * The proxy kernel is written against the Web `Request`/`Response` API and must
 * be exercised with Node's own undici globals — jsdom shadows `Blob`, `File` and
 * `FormData` with implementations that are not interchangeable with undici's, so
 * running transport tests under jsdom produces failures that have nothing to do
 * with the code. Component tests need the opposite: a real DOM. Keeping them in
 * separate projects means neither side pays for the other's environment.
 *
 *   tests/node/**  pure logic — proxy, SDK, formatters, stores
 *   tests/dom/**   React components, hooks that touch `window`
 */

const alias = { '@': fileURLToPath(new URL('.', import.meta.url)) }

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/node/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/dom/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/dom/setup.ts'],
        },
      },
    ],
    // Fail on an unhandled rejection rather than letting a floating promise
    // (every mutation here is fire-and-forget from the UI's point of view) turn
    // a red test green.
    dangerouslyIgnoreUnhandledErrors: false,
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'components/**'],
      // Generated from the upstream console JS; asserting its own contents
      // would only duplicate `scripts/probe/gen-registry.mjs`.
      exclude: ['lib/api/registry.ts', 'lib/api/types/**', '**/*.d.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
})
