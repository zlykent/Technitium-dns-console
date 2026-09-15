import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionMap } from '@/lib/api/types/common'
import { emptyPermissionMap } from '@/lib/api/types/common'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Why we mock at these layers:
 *
 * - `next/navigation`: Sidebar uses `usePathname()` to determine which nav item
 *   is active. No real router exists in jsdom.
 *
 * - `lib/auth/session`: Sidebar reads `permissions` to filter visible sections
 *   and `session` to render the user identity footer.
 *
 * - `lib/servers/provider`: Sidebar reads `active` to display the server URL
 *   under the brand name.
 *
 * - `next-themes`: Not directly used by Sidebar, but the Tooltip provider in
 *   the UI kit may reference it transitively. Mocking avoids import errors.
 */

let mockPathname = '/dashboard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

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

// ─── helpers ──────────────────────────────────────────────────────────────────

function perms(overrides?: Partial<PermissionMap>): PermissionMap {
  return { ...emptyPermissionMap(), ...overrides }
}

function setSession(overrides?: Partial<typeof sessionFixture>) {
  sessionFixture = {
    session: null,
    permissions: emptyPermissionMap(),
    ready: true,
    isLoading: false,
    isAuthenticated: true,
    connectionError: null,
    refresh: vi.fn(),
    adopt: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    canView: () => false,
    canModify: () => false,
    canDelete: () => false,
    flagsFor: () => ({ canView: false, canModify: false, canDelete: false }),
    ...overrides,
  }
}

async function renderSidebar(props?: { collapsed?: boolean; variant?: 'desktop' | 'mobile'; onToggleCollapse?: () => void; onNavigate?: () => void }) {
  const { Sidebar } = await import('@/components/layout/sidebar')
  const defaultProps = {
    collapsed: false,
    onToggleCollapse: props?.onToggleCollapse ?? vi.fn(),
    variant: props?.variant ?? ('desktop' as const),
    onNavigate: props?.onNavigate,
  }
  return renderWithProviders(<Sidebar {...defaultProps} collapsed={props?.collapsed ?? false} />)
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPathname = '/dashboard'
  setSession({
    permissions: perms({
      Dashboard: { canView: true, canModify: true, canDelete: true },
      Zones: { canView: true, canModify: true, canDelete: false },
      DnsClient: { canView: true, canModify: false, canDelete: false },
      Cache: { canView: true, canModify: false, canDelete: false },
      Allowed: { canView: true, canModify: false, canDelete: false },
      Blocked: { canView: true, canModify: false, canDelete: false },
      Logs: { canView: true, canModify: false, canDelete: false },
      DhcpServer: { canView: true, canModify: false, canDelete: false },
      Apps: { canView: true, canModify: false, canDelete: false },
      Settings: { canView: true, canModify: false, canDelete: false },
      Administration: { canView: true, canModify: false, canDelete: false },
    }),
    session: { displayName: 'Admin', username: 'admin', isSsoUser: false, totpEnabled: false, info: { version: '9.0', permissions: emptyPermissionMap() } },
  })
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Sidebar — permission filtering', () => {
  it('hides items for sections without canView', async () => {
    setSession({
      permissions: perms({ Dashboard: { canView: true, canModify: false, canDelete: false } }),
      session: { displayName: 'User', username: 'user', isSsoUser: false, totpEnabled: false, info: { version: '9.0', permissions: emptyPermissionMap() } },
    })
    await renderSidebar()

    expect(screen.getByText('仪表盘')).toBeInTheDocument()
    // Zones is not permitted
    expect(screen.queryByText('区域')).not.toBeInTheDocument()
  })

  it('hides entire section headings when all items are filtered out', async () => {
    setSession({
      permissions: perms({ Dashboard: { canView: true, canModify: false, canDelete: false } }),
      session: { displayName: 'User', username: 'user', isSsoUser: false, totpEnabled: false, info: { version: '9.0', permissions: emptyPermissionMap() } },
    })
    await renderSidebar()

    // 'DNS' section heading should not appear because none of its items are permitted
    expect(screen.queryByText('DNS')).not.toBeInTheDocument()
    // 'Monitor' section should appear because Dashboard is permitted
    expect(screen.getByText('监控')).toBeInTheDocument()
  })

  it('does not render hidden items (e.g. /account)', async () => {
    await renderSidebar()
    // The 'account' nav item is hidden:true, so it should never appear in the sidebar
    const nav = screen.getByRole('navigation', { name: '主导航' })
    const links = within(nav).getAllByRole('link')
    const hrefs = links.map((l) => l.getAttribute('href'))
    expect(hrefs).not.toContain('/account')
  })
})

describe('Sidebar — active item highlighting', () => {
  it('marks the current route with aria-current="page"', async () => {
    mockPathname = '/zones'
    await renderSidebar()

    const zonesLink = screen.getByRole('link', { name: '区域' })
    expect(zonesLink).toHaveAttribute('aria-current', 'page')
  })

  it('uses longest-prefix matching for sub-routes', async () => {
    mockPathname = '/zones/example.com'
    await renderSidebar()

    const zonesLink = screen.getByRole('link', { name: '区域' })
    expect(zonesLink).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark unrelated items as active', async () => {
    mockPathname = '/zones'
    await renderSidebar()

    const dashLink = screen.getByRole('link', { name: '仪表盘' })
    expect(dashLink).not.toHaveAttribute('aria-current')
  })
})

describe('Sidebar — collapsed state', () => {
  it('does not render text labels when collapsed', async () => {
    await renderSidebar({ collapsed: true })

    // Labels should not be visible in the rail
    expect(screen.queryByText('仪表盘')).not.toBeInTheDocument()
    expect(screen.queryByText('区域')).not.toBeInTheDocument()
  })

  it('still renders link elements for navigation when collapsed', async () => {
    await renderSidebar({ collapsed: true })

    const nav = screen.getByRole('navigation', { name: '主导航' })
    const links = within(nav).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
  })

  it('calls onToggleCollapse when the collapse button is clicked', async () => {
    const user = userEvent.setup()
    const onToggleCollapse = vi.fn()
    await renderSidebar({ onToggleCollapse })

    await user.click(screen.getByRole('button', { name: '折叠/展开侧边栏' }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })
})

describe('Sidebar — mobile variant', () => {
  it('does not render the collapse button in mobile variant', async () => {
    await renderSidebar({ variant: 'mobile' })
    expect(screen.queryByRole('button', { name: '折叠/展开侧边栏' })).not.toBeInTheDocument()
  })

  it('calls onNavigate when a link is clicked', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    await renderSidebar({ variant: 'mobile', onNavigate })

    await user.click(screen.getByRole('link', { name: '仪表盘' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})

describe('Sidebar — user identity footer', () => {
  it('displays session displayName and username', async () => {
    await renderSidebar()

    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
  })
})
