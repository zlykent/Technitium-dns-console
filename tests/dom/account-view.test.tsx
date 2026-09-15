import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountView } from '@/components/account/account-view'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Account tab ↔ URL synchronisation.
 *
 * The user menu deep-links with `/account?tab=…` and the tab bar writes the
 * choice back, so the URL is the single source of truth. The regression this
 * guards is subtle: an earlier version seeded local state from an `initialTab`
 * prop once at mount, so an operator who was *already* on `/account` and then
 * used the top-right menu got a fresh prop but a stale tab — the click appeared
 * to do nothing. Deriving from `useSearchParams` (and re-rendering with a changed
 * query here) is exactly that "menu click while already on the page" path.
 *
 * The five panels are stubbed because this test is about the tab bar and the
 * query string, not about profile/token/session data; stubbing also keeps the
 * panels' server/provider hooks out of the harness.
 */

const mockReplace = vi.fn()
const mockPush = vi.fn()

let currentParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/account',
  useSearchParams: () => currentParams,
}))

vi.mock('@/components/account/profile-panel', () => ({
  ProfilePanel: () => <div data-testid="panel-profile" />,
}))
vi.mock('@/components/account/security-panel', () => ({
  SecurityPanel: () => <div data-testid="panel-security" />,
}))
vi.mock('@/components/account/tokens-panel', () => ({
  TokensPanel: () => <div data-testid="panel-tokens" />,
}))
vi.mock('@/components/account/my-sessions-panel', () => ({
  MySessionsPanel: () => <div data-testid="panel-sessions" />,
}))
vi.mock('@/components/account/about-panel', () => ({ AboutPanel: () => <div data-testid="panel-about" /> }))

function setParams(query: string) {
  currentParams = new URLSearchParams(query)
}

beforeEach(() => {
  mockReplace.mockReset()
  mockPush.mockReset()
  setParams('')
})

describe('AccountView — tab is driven by the ?tab= query string', () => {
  it('defaults to the profile tab with no param', () => {
    renderWithProviders(<AccountView consoleVersion="1.0" />)
    expect(screen.getByTestId('panel-profile')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '个人资料', selected: true })).toBeInTheDocument()
  })

  it('opens the tab named by a menu deep link on first paint', () => {
    setParams('tab=security')
    renderWithProviders(<AccountView consoleVersion="1.0" />)
    expect(screen.getByTestId('panel-security')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '安全', selected: true })).toBeInTheDocument()
  })

  it('follows a menu deep link that arrives while already on /account', () => {
    // The operator is sitting on the profile tab; the menu then pushes
    // ?tab=sessions. The mounted view must switch — this is the stale-prop bug.
    const view = renderWithProviders(<AccountView consoleVersion="1.0" />)
    expect(screen.getByTestId('panel-profile')).toBeInTheDocument()

    setParams('tab=sessions')
    view.rerender(<AccountView consoleVersion="1.0" />)

    expect(screen.getByTestId('panel-sessions')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '我的会话', selected: true })).toBeInTheDocument()
  })

  it('falls back to profile for an unknown tab value', () => {
    setParams('tab=nonsense')
    renderWithProviders(<AccountView consoleVersion="1.0" />)
    expect(screen.getByTestId('panel-profile')).toBeInTheDocument()
  })

  it('writes the query string when the tab bar is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AccountView consoleVersion="1.0" />)

    await user.click(screen.getByRole('tab', { name: 'API 令牌' }))

    expect(mockReplace).toHaveBeenCalledWith('/account?tab=tokens')
  })

  it('preserves unrelated query params when switching tabs', async () => {
    const user = userEvent.setup()
    setParams('foo=bar')
    renderWithProviders(<AccountView consoleVersion="1.0" />)

    await user.click(screen.getByRole('tab', { name: '关于' }))

    expect(mockReplace).toHaveBeenCalledWith('/account?foo=bar&tab=about')
  })
})
