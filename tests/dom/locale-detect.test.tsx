import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * `LocaleDetect` is a side-effect-only guard in the root layout: on a first visit
 * with no preference cookie it reads the system language from `navigator.languages`,
 * persists it, and — only when it disagrees with what the server rendered —
 * refreshes so the UI switches. It exists because a reverse proxy can strip
 * `Accept-Language`, leaving the server to fall back to Chinese in front of an
 * English-system operator. The regressions worth pinning are the guards that keep
 * it correct and unobtrusive:
 *
 *  - it must never override an existing cookie (a manual switch wins forever),
 *  - it must not refresh when detection agrees with the server locale (no flash),
 *  - it must do nothing when the system speaks a language we do not ship,
 *  - and it must correct + persist when the server fell back but the system speaks
 *    a language we do ship (the stripped-`Accept-Language` case).
 *
 * `next/navigation` is mocked so `router.refresh()` is observable, exactly as the
 * LocaleToggle suite does.
 */

const mockRouterRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: mockRouterRefresh }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

/** Point `navigator.languages` at a fixed preference list for one test. */
function setSystemLanguages(languages: string[]) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => languages })
  Object.defineProperty(navigator, 'language', { configurable: true, get: () => languages[0] ?? 'en-US' })
}

/** Expire the locale cookie so each test starts from a clean, first-visit state. */
function clearLocaleCookie() {
  document.cookie = 'tdns_locale=; Path=/; Max-Age=0'
}

async function renderDetect(locale: 'zh' | 'en' = 'zh') {
  const { LocaleDetect } = await import('@/components/layout/locale-detect')
  return renderWithProviders(<LocaleDetect />, { locale })
}

beforeEach(() => {
  mockRouterRefresh.mockClear()
  clearLocaleCookie()
  setSystemLanguages(['en-US', 'en'])
  document.documentElement.lang = ''
})

describe('LocaleDetect — first visit, no cookie', () => {
  it('corrects a server fallback to the system language, persists it, and refreshes', async () => {
    // The server rendered 'zh' (Accept-Language stripped) but the system is English.
    await renderDetect('zh')
    expect(document.cookie).toContain('tdns_locale=en')
    expect(document.documentElement.lang).toBe('en')
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1)
  })

  it('persists without refreshing when detection agrees with the server locale', async () => {
    await renderDetect('en')
    expect(document.cookie).toContain('tdns_locale=en')
    // No disagreement, so no refresh and no flash.
    expect(mockRouterRefresh).not.toHaveBeenCalled()
  })

  it('does nothing when the system speaks a language we do not ship', async () => {
    setSystemLanguages(['fr-FR', 'de'])
    await renderDetect('zh')
    expect(document.cookie).not.toContain('tdns_locale')
    expect(mockRouterRefresh).not.toHaveBeenCalled()
  })
})

describe('LocaleDetect — existing preference cookie', () => {
  it('never overrides a cookie, even when the system language differs', async () => {
    // The operator manually chose English; the system is Chinese. The choice wins.
    document.cookie = 'tdns_locale=en; Path=/; Max-Age=31536000'
    setSystemLanguages(['zh-CN', 'zh'])
    await renderDetect('en')
    expect(document.cookie).toContain('tdns_locale=en')
    expect(document.cookie).not.toContain('tdns_locale=zh')
    expect(mockRouterRefresh).not.toHaveBeenCalled()
  })
})
