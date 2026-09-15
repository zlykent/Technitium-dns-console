import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Why we mock at these layers:
 *
 * - `next-themes`: ThemeToggle calls `useTheme()` to get `theme` and `setTheme`.
 *   The real `ThemeProvider` requires DOM manipulation (class on <html>,
 *   localStorage) that jsdom does not meaningfully support. Mocking the hook
 *   lets us verify the component's branching logic (icon selection, setTheme
 *   calls) without a provider.
 *
 * - `next/navigation`: LocaleToggle calls `useRouter().refresh()` after writing
 *   the cookie. We need to verify that call.
 *
 * - `lib/hooks/use-mounted`: ThemeToggle gates icon rendering on mounted state.
 *   We mock it to return true (simulating post-hydration) so the real icon logic
 *   is exercised.
 */

const mockSetTheme = vi.fn()
let mockTheme = 'light'

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
    resolvedTheme: mockTheme,
    themes: ['light', 'dark', 'system'],
  }),
}))

const mockRouterRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: mockRouterRefresh }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/hooks/use-mounted', () => ({
  useMounted: () => true,
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

async function renderThemeToggle() {
  const { ThemeToggle } = await import('@/components/layout/theme-toggle')
  return renderWithProviders(<ThemeToggle />)
}

async function renderLocaleToggle() {
  const { LocaleToggle } = await import('@/components/layout/locale-toggle')
  return renderWithProviders(<LocaleToggle />)
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockTheme = 'light'
})

// ─── ThemeToggle tests ────────────────────────────────────────────────────────

describe('ThemeToggle — rendering', () => {
  it('renders a button with aria-label "主题"', async () => {
    await renderThemeToggle()
    expect(screen.getByRole('button', { name: '主题' })).toBeInTheDocument()
  })
})

describe('ThemeToggle — theme switching', () => {
  it('calls setTheme("dark") when dark option is clicked', async () => {
    const user = userEvent.setup()
    await renderThemeToggle()

    await user.click(screen.getByRole('button', { name: '主题' }))
    const darkItem = await screen.findByText('深色')
    await user.click(darkItem)

    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('calls setTheme("light") when light option is clicked', async () => {
    const user = userEvent.setup()
    mockTheme = 'dark'
    await renderThemeToggle()

    await user.click(screen.getByRole('button', { name: '主题' }))
    const lightItem = await screen.findByText('浅色')
    await user.click(lightItem)

    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })

  it('calls setTheme("system") when system option is clicked', async () => {
    const user = userEvent.setup()
    await renderThemeToggle()

    await user.click(screen.getByRole('button', { name: '主题' }))
    const systemItem = await screen.findByText('跟随系统')
    await user.click(systemItem)

    expect(mockSetTheme).toHaveBeenCalledWith('system')
  })
})

// ─── LocaleToggle tests ───────────────────────────────────────────────────────

describe('LocaleToggle — rendering', () => {
  it('renders a button with aria-label "语言"', async () => {
    await renderLocaleToggle()
    expect(screen.getByRole('button', { name: '语言' })).toBeInTheDocument()
  })

  it('lists available locales when opened', async () => {
    const user = userEvent.setup()
    await renderLocaleToggle()

    await user.click(screen.getByRole('button', { name: '语言' }))
    expect(await screen.findByText('简体中文')).toBeInTheDocument()
    // English locale shows "English" in both native and english columns
    expect(screen.getAllByText('English').length).toBeGreaterThanOrEqual(1)
  })
})

describe('LocaleToggle — switching', () => {
  it('writes the locale cookie and calls router.refresh()', async () => {
    const user = userEvent.setup()
    await renderLocaleToggle()

    await user.click(screen.getByRole('button', { name: '语言' }))
    // Current locale is 'zh' (from renderWithProviders default), click English item
    const englishItem = await screen.findByRole('menuitemradio', { name: /English/ })
    await user.click(englishItem)

    expect(document.cookie).toContain('tdns_locale=en')
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1)
  })

  it('updates document.documentElement.lang', async () => {
    const user = userEvent.setup()
    await renderLocaleToggle()

    await user.click(screen.getByRole('button', { name: '语言' }))
    const englishItem = await screen.findByRole('menuitemradio', { name: /English/ })
    await user.click(englishItem)

    expect(document.documentElement.lang).toBe('en')
  })

  it('does nothing when the current locale is selected', async () => {
    const user = userEvent.setup()
    await renderLocaleToggle()

    await user.click(screen.getByRole('button', { name: '语言' }))
    // Click the already-active locale (zh)
    const zhItem = await screen.findByText('简体中文')
    await user.click(zhItem)

    expect(mockRouterRefresh).not.toHaveBeenCalled()
  })
})
