import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionMap } from '@/lib/api/types/common'
import { emptyPermissionMap } from '@/lib/api/types/common'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Why we mock at these layers:
 *
 * - `next/navigation`: ConsoleShell calls `useRouter().replace` for the auth
 *   redirect and `usePathname()` to build the `?next=` parameter. Both are
 *   Next.js internals unavailable in jsdom.
 *
 * - `lib/auth/session`: the guard branches entirely on the session context
 *   (ready/isAuthenticated/connectionError/permissions). Mocking the hook
 *   directly makes each branch testable in isolation without standing up the
 *   full TanStack Query lifecycle.
 *
 * - `lib/servers/provider`: Sidebar (rendered inside ConsoleShell) calls
 *   `useServers()`. We mock it to prevent errors from the missing provider.
 *
 * - `next-themes`: ThemeToggle (inside Topbar) depends on it.
 *
 * - `sonner`: toast side-effects.
 */

const mockReplace = vi.fn()
const mockPush = vi.fn()
const mockRouterRefresh = vi.fn()

let mockPathname = '/dashboard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, refresh: mockRouterRefresh }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

const mockSessionRefresh = vi.fn()

let sessionFixture: {
  session: { displayName: string; username: string; isSsoUser: boolean; totpEnabled: boolean; info: { version: string; permissions: PermissionMap } } | null
  permissions: PermissionMap
  ready: boolean
  isLoading: boolean
  isAuthenticated: boolean
  connectionError: string | null
  refresh: () => void
  adopt: (s: unknown) => void
  signOut: () => Promise<void>
  canView: (s: string) => boolean
  canModify: (s: string) => boolean
  canDelete: (s: string) => boolean
  flagsFor: (s: string) => { canView: boolean; canModify: boolean; canDelete: boolean }
}

vi.mock('@/lib/auth/session', () => ({
  useSession: () => sessionFixture,
  usePermissions: () => sessionFixture.permissions,
  useCan: (section: string) => sessionFixture.flagsFor(section),
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/lib/servers/provider', () => ({
  useServers: () => ({
    profiles: [{ id: '__env__', name: 'dns.local', url: 'http://192.168.1.1:5380' }],
    customProfiles: [],
    active: { id: '__env__', name: 'dns.local', url: 'http://192.168.1.1:5380' },
    ready: true,
    defaultTarget: 'http://192.168.1.1:5380',
    setActive: vi.fn(),
    addProfile: vi.fn(),
    updateProfile: vi.fn(),
    removeProfile: vi.fn(),
    selectByUrl: vi.fn(),
  }),
  useTargetKey: () => '__env__',
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn(), resolvedTheme: 'light', themes: ['light', 'dark', 'system'] }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

function perms(overrides?: Partial<PermissionMap>): PermissionMap {
  return { ...emptyPermissionMap(), ...overrides }
}

function allViewPerms(): PermissionMap {
  const p = emptyPermissionMap()
  for (const key of Object.keys(p) as (keyof PermissionMap)[]) {
    p[key] = { canView: true, canModify: true, canDelete: true }
  }
  return p
}

function setSession(overrides?: Partial<typeof sessionFixture>) {
  sessionFixture = {
    session: null,
    permissions: emptyPermissionMap(),
    ready: false,
    isLoading: true,
    isAuthenticated: false,
    connectionError: null,
    refresh: mockSessionRefresh,
    adopt: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    canView: (s: string) => (sessionFixture.permissions as Record<string, { canView: boolean }>)[s]?.canView ?? false,
    canModify: () => false,
    canDelete: () => false,
    flagsFor: (s: string) =>
      (sessionFixture.permissions as Record<string, { canView: boolean; canModify: boolean; canDelete: boolean }>)[s] ?? {
        canView: false,
        canModify: false,
        canDelete: false,
      },
    ...overrides,
  }
}

async function renderShell(children?: React.ReactNode) {
  const { ConsoleShell } = await import('@/components/app/console-shell')
  return renderWithProviders(<ConsoleShell>{children ?? <div data-testid="page-content">Hello</div>}</ConsoleShell>)
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPathname = '/dashboard'
  setSession()
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ConsoleShell — loading state', () => {
  it('renders a spinner and does not redirect when ready=false', async () => {
    setSession({ ready: false, isLoading: true })
    await renderShell()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})

describe('ConsoleShell — unauthenticated redirect', () => {
  it('redirects to /login?next=<pathname> when ready && !isAuthenticated && !connectionError', async () => {
    mockPathname = '/zones'
    setSession({ ready: true, isAuthenticated: false, connectionError: null })
    await renderShell()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login?next=%2Fzones')
    })
  })

  it('redirects to /login without ?next when pathname is /', async () => {
    mockPathname = '/'
    setSession({ ready: true, isAuthenticated: false, connectionError: null })
    await renderShell()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login')
    })
  })
})

describe('ConsoleShell — connection error state', () => {
  it('shows ServerCrash panel with retry and backToLogin, does NOT redirect', async () => {
    setSession({ ready: true, isAuthenticated: false, connectionError: 'ECONNREFUSED' })
    await renderShell()

    expect(screen.getByText('无法连接到 DNS 服务器')).toBeInTheDocument()
    expect(screen.getByText('ECONNREFUSED')).toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('retry button calls refresh', async () => {
    const user = userEvent.setup()
    setSession({ ready: true, isAuthenticated: false, connectionError: 'timeout' })
    await renderShell()

    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(mockSessionRefresh).toHaveBeenCalledTimes(1)
  })

  it('backToLogin button navigates to /login', async () => {
    const user = userEvent.setup()
    setSession({ ready: true, isAuthenticated: false, connectionError: 'down' })
    await renderShell()

    await user.click(screen.getByRole('button', { name: '返回登录页' }))
    expect(mockReplace).toHaveBeenCalledWith('/login')
  })
})

describe('ConsoleShell — authenticated shell', () => {
  it('renders sidebar, topbar and children when authenticated', async () => {
    const permissions = allViewPerms()
    setSession({
      ready: true,
      isAuthenticated: true,
      permissions,
      session: { displayName: 'Admin', username: 'admin', isSsoUser: false, totpEnabled: false, info: { version: '9.0', permissions } },
    })
    await renderShell()

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    // Topbar landmark
    expect(screen.getByRole('banner')).toBeInTheDocument()
    // Sidebar nav landmark
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  })

  it('includes a skip-link pointing to #main', async () => {
    const permissions = allViewPerms()
    setSession({ ready: true, isAuthenticated: true, permissions })
    await renderShell()

    const skipLink = screen.getByText('跳转到主内容')
    expect(skipLink).toBeInTheDocument()
    expect(skipLink.closest('a')).toHaveAttribute('href', '#main')
  })
})

describe('ConsoleShell — permission guard', () => {
  it('renders PermissionDenied and NOT children when section.canView is false', async () => {
    mockPathname = '/settings'
    const permissions = perms({ Settings: { canView: false, canModify: false, canDelete: false } })
    setSession({ ready: true, isAuthenticated: true, permissions })
    await renderShell()

    expect(screen.getByText('权限不足')).toBeInTheDocument()
    expect(screen.queryByTestId('page-content')).not.toBeInTheDocument()
  })

  it('renders children when the required section has canView', async () => {
    mockPathname = '/settings'
    const permissions = perms({ Settings: { canView: true, canModify: false, canDelete: false } })
    setSession({ ready: true, isAuthenticated: true, permissions })
    await renderShell()

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
    expect(screen.queryByText('权限不足')).not.toBeInTheDocument()
  })

  it('renders children for a route with no required section (unknown path)', async () => {
    mockPathname = '/some-unknown-path'
    setSession({ ready: true, isAuthenticated: true, permissions: emptyPermissionMap() })
    await renderShell()

    expect(screen.getByTestId('page-content')).toBeInTheDocument()
  })
})
