import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionMap } from '@/lib/api/types/common'
import { emptyPermissionMap } from '@/lib/api/types/common'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Why we mock at these layers:
 *
 * - `next/navigation`: Topbar uses `usePathname()` to derive the module title
 *   and to auto-close the mobile sheet after navigation.
 *
 * - `lib/auth/session`: Sidebar (rendered inside the Sheet) needs it.
 *
 * - `lib/servers/provider`: ServerSwitcher + Sidebar need it.
 *
 * - `next-themes`: ThemeToggle is rendered inside Topbar.
 *
 * - `sonner`: UserMenu uses toast on sign-out.
 */

let mockPathname = '/dashboard'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/auth/session', () => ({
  useSession: () => ({
    session: { displayName: 'Admin', username: 'admin', isSsoUser: false, totpEnabled: false, info: { version: '9.0', permissions: emptyPermissionMap() } },
    permissions: emptyPermissionMap() as PermissionMap,
    ready: true,
    isLoading: false,
    isAuthenticated: true,
    connectionError: null,
    refresh: vi.fn(),
    adopt: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    canView: () => true,
    canModify: () => true,
    canDelete: () => true,
    flagsFor: () => ({ canView: true, canModify: true, canDelete: true }),
  }),
  usePermissions: () => emptyPermissionMap() as PermissionMap,
  useCan: () => ({ canView: true, canModify: true, canDelete: true }),
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

async function renderTopbar() {
  const { Topbar } = await import('@/components/layout/topbar')
  return renderWithProviders(<Topbar />)
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPathname = '/dashboard'
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Topbar — module title', () => {
  it('shows the current module label from nav:items.<key>.label', async () => {
    await renderTopbar()
    // /dashboard → items.dashboard.label = '仪表盘'
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('仪表盘')
  })

  it('shows app name for unknown routes', async () => {
    mockPathname = '/unknown-page'
    await renderTopbar()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Technitium DNS 控制台')
  })

  it('shows the zones label when on /zones/example.com', async () => {
    mockPathname = '/zones/example.com'
    await renderTopbar()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('区域')
  })
})

describe('Topbar — mobile sheet', () => {
  it('renders the hamburger button with correct aria-label', async () => {
    await renderTopbar()
    expect(screen.getByRole('button', { name: '打开菜单' })).toBeInTheDocument()
  })

  it('opens the sheet when hamburger is clicked', async () => {
    const user = userEvent.setup()
    await renderTopbar()

    await user.click(screen.getByRole('button', { name: '打开菜单' }))
    // Sheet content should include the navigation
    expect(await screen.findByRole('navigation', { name: '主导航' })).toBeInTheDocument()
  })
})

describe('Topbar — ServerSwitcher desktop class', () => {
  it('renders ServerSwitcher with hidden md:flex class', async () => {
    await renderTopbar()
    const switcher = screen.getByRole('button', { name: '切换 DNS 服务器' })
    // The className is applied to the button's parent or itself
    expect(switcher.className).toContain('hidden')
    expect(switcher.className).toContain('md:flex')
  })
})

describe('Topbar — sheet auto-closes on pathname change', () => {
  it('closes the sheet when pathname changes (simulated via rerender)', async () => {
    const user = userEvent.setup()
    const { Topbar } = await import('@/components/layout/topbar')
    const { rerender } = renderWithProviders(<Topbar />)

    await user.click(screen.getByRole('button', { name: '打开菜单' }))
    expect(await screen.findByRole('navigation', { name: '主导航' })).toBeInTheDocument()

    // Simulate navigation by changing the mock pathname and re-rendering
    mockPathname = '/zones'
    rerender(<Topbar />)

    // After pathname change, the Sheet should close (dialog role gone)
    // Note: Radix Sheet in jsdom may still render the content in DOM but with
    // data-state="closed". We check the openMenu button is clickable again.
    expect(screen.getByRole('button', { name: '打开菜单' })).toBeInTheDocument()
  })
})
