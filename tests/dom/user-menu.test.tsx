import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Why we mock at these layers:
 *
 * - `next/navigation`: UserMenu calls `router.push` and `router.replace` for
 *   navigation after sign-out and to account tabs.
 *
 * - `lib/auth/session`: UserMenu reads `session` for display and calls
 *   `signOut()` on logout. We need to observe these calls.
 *
 * - `sonner`: toast.success is called after sign-out.
 */

const mockReplace = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

const mockSignOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

let sessionFixture: {
  session: { displayName: string; username: string; isSsoUser: boolean; totpEnabled: boolean } | null
  signOut: () => Promise<void>
}

vi.mock('@/lib/auth/session', () => ({
  useSession: () => ({
    ...sessionFixture,
    permissions: {},
    ready: true,
    isLoading: false,
    isAuthenticated: Boolean(sessionFixture.session),
    connectionError: null,
    refresh: vi.fn(),
    adopt: vi.fn(),
    canView: () => true,
    canModify: () => true,
    canDelete: () => true,
    flagsFor: () => ({ canView: true, canModify: true, canDelete: true }),
  }),
  usePermissions: () => ({}),
  useCan: () => ({ canView: true, canModify: true, canDelete: true }),
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

async function renderUserMenu() {
  const { UserMenu } = await import('@/components/layout/user-menu')
  return renderWithProviders(<UserMenu />)
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  sessionFixture = {
    session: { displayName: 'Admin User', username: 'admin', isSsoUser: false, totpEnabled: false },
    signOut: mockSignOut,
  }
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('UserMenu — display', () => {
  it('shows the user displayName in the trigger button', async () => {
    await renderUserMenu()
    expect(screen.getByRole('button', { name: 'Admin User' })).toBeInTheDocument()
  })

  it('shows username and displayName in the dropdown', async () => {
    const user = userEvent.setup()
    await renderUserMenu()
    await user.click(screen.getByRole('button', { name: 'Admin User' }))

    expect(await screen.findByText('已登录为')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
  })
})

describe('UserMenu — account navigation', () => {
  it('navigates to /account?tab=profile when profile item is clicked', async () => {
    const user = userEvent.setup()
    await renderUserMenu()
    await user.click(screen.getByRole('button', { name: 'Admin User' }))

    const profileItem = await screen.findByText('个人资料')
    await user.click(profileItem)

    expect(mockPush).toHaveBeenCalledWith('/account?tab=profile')
  })

  it('navigates to /account?tab=security when change password is clicked', async () => {
    const user = userEvent.setup()
    await renderUserMenu()
    await user.click(screen.getByRole('button', { name: 'Admin User' }))

    const changePwItem = await screen.findByText('修改密码')
    await user.click(changePwItem)

    expect(mockPush).toHaveBeenCalledWith('/account?tab=security')
  })

  it('navigates to /account?tab=tokens when API tokens is clicked', async () => {
    const user = userEvent.setup()
    await renderUserMenu()
    await user.click(screen.getByRole('button', { name: 'Admin User' }))

    const tokensItem = await screen.findByText('API 令牌')
    await user.click(tokensItem)

    expect(mockPush).toHaveBeenCalledWith('/account?tab=tokens')
  })
})

describe('UserMenu — sign out', () => {
  it('calls signOut and redirects to /login', async () => {
    const user = userEvent.setup()
    await renderUserMenu()
    await user.click(screen.getByRole('button', { name: 'Admin User' }))

    const signOutItem = await screen.findByText('退出登录')
    await user.click(signOutItem)

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1)
      expect(mockReplace).toHaveBeenCalledWith('/login')
    })
  })
})

describe('UserMenu — no session', () => {
  it('renders a login button when session is null', async () => {
    sessionFixture = { session: null, signOut: mockSignOut }
    await renderUserMenu()

    // When no session, renders an "open" button that navigates to login
    const button = screen.getByRole('button', { name: '打开' })
    expect(button).toBeInTheDocument()
  })

  it('navigates to /login when the no-session button is clicked', async () => {
    const user = userEvent.setup()
    sessionFixture = { session: null, signOut: mockSignOut }
    await renderUserMenu()

    await user.click(screen.getByRole('button', { name: '打开' }))
    expect(mockPush).toHaveBeenCalledWith('/login')
  })
})
