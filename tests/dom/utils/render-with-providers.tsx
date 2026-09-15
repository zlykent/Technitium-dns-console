import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import * as React from 'react'
import { loadMessages } from '@/lib/i18n/messages'
import type { Locale } from '@/lib/i18n/config'

/**
 * Shared render harness.
 *
 * Components are rendered with the **real** message bundles rather than a stub
 * dictionary. That is deliberate: a test that renders `t('zones.delete.confirm')`
 * against a fake dictionary passes even when the key was renamed in
 * `messages/`, which is exactly the regression worth catching. The cost is that
 * a missing key surfaces as an `IntlError` — which is also what we want.
 *
 * A fresh `QueryClient` per render (with retry disabled) keeps a failing query
 * in one test from leaking into the next and from making assertions wait on
 * three backoff rounds.
 */

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  locale?: Locale
  /** Merged over the real bundle, for the rare case a test needs a new string. */
  messages?: Record<string, unknown>
  queryClient?: QueryClient
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(ui: React.ReactElement, options: RenderWithProvidersOptions = {}) {
  const { locale = 'zh', messages, queryClient, ...renderOptions } = options
  const client = queryClient ?? createTestQueryClient()
  const bundle = messages ? { ...loadMessages(locale), ...messages } : loadMessages(locale)

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale={locale} messages={bundle} timeZone="UTC" now={new Date('2026-01-01T00:00:00Z')}>
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    )
  }

  return { ...render(ui, { wrapper: Wrapper, ...renderOptions }), queryClient: client }
}

/**
 * `next-intl` throws on a missing key by default, which would fail the whole
 * suite for a copy change. Tests want the throw; the app wants a console noise.
 * This keeps the strict behaviour but makes the message actionable.
 */
export function expectNoMissingKeys(locale: Locale = 'zh'): void {
  const bundle = loadMessages(locale)
  if (Object.keys(bundle).length === 0) {
    throw new Error(`loadMessages('${locale}') returned an empty bundle — check lib/i18n/messages.ts`)
  }
}
