import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionMap } from '@/lib/api/types/common'
import { emptyPermissionMap } from '@/lib/api/types/common'
import type { ServerProfile } from '@/lib/servers/store'
import { DEFAULT_PROFILE_ID } from '@/lib/servers/store'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Why we mock at these layers:
 *
 * - `lib/servers/provider`: ServerSwitcher calls `useServers()` for profiles,
 *   active, setActive, addProfile, updateProfile, removeProfile. Mocking the hook
 *   directly gives us deterministic control over the server list and lets us spy
 *   on mutations without standing up the real localStorage-backed store.
 *
 * - `lib/auth/session`: ServerSwitcher reads `isAuthenticated`, `connectionError`,
 *   `isLoading` to determine the status dot colour.
 *
 * - `lib/api/client`: `setActiveTarget` is called internally when switching; we
 *   mock it to verify the correct value (null for default profile).
 */

const mockSetActive = vi.fn()
const mockAddProfile = vi.fn<(input: { name: string; url: string }) => ServerProfile | null>()
const mockUpdateProfile = vi.fn<(id: string, patch: Partial<Pick<ServerProfile, 'name' | 'url'>>) => boolean>()
const mockRemoveProfile = vi.fn<(id: string) => boolean>()

/**
 * The switcher verifies reachability through `fetch('/api/dns/status')` before
 * applying a selection, so every test stubs the network. A plain object is
 * enough: the probe only reads `ok` and, on failure, `json()`.
 */
const mockFetch = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()

function probeOk() {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
}

function probeFail(code: string, message = 'boom') {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ code, message }) })
}

let profilesFixture: ServerProfile[] = []
let activeFixture: ServerProfile | null = null

vi.mock('@/lib/servers/provider', () => ({
  useServers: () => ({
    profiles: profilesFixture,
    customProfiles: profilesFixture.filter((p) => p.id !== DEFAULT_PROFILE_ID),
    active: activeFixture,
    ready: true,
    defaultTarget: 'http://192.168.1.1:5380',
    setActive: mockSetActive,
    addProfile: mockAddProfile,
    updateProfile: mockUpdateProfile,
    removeProfile: mockRemoveProfile,
    selectByUrl: vi.fn(),
  }),
  useTargetKey: () => activeFixture?.url ?? DEFAULT_PROFILE_ID,
}))

vi.mock('@/lib/auth/session', () => ({
  useSession: () => ({
    session: null,
    permissions: emptyPermissionMap(),
    ready: true,
    isLoading: false,
    isAuthenticated: true,
    connectionError: null,
    refresh: vi.fn(),
    adopt: vi.fn(),
    signOut: vi.fn(),
    canView: () => true,
    canModify: () => true,
    canDelete: () => true,
    flagsFor: () => ({ canView: true, canModify: true, canDelete: true }),
  }),
  usePermissions: () => emptyPermissionMap() as PermissionMap,
  useCan: () => ({ canView: true, canModify: true, canDelete: true }),
  PermissionGate: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn(), resolvedTheme: 'light', themes: ['light', 'dark', 'system'] }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_PROFILE: ServerProfile = { id: DEFAULT_PROFILE_ID, name: 'dns.local', url: 'http://192.168.1.1:5380' }
const CUSTOM_PROFILE: ServerProfile = { id: 'srv2', name: 'Production', url: 'http://10.0.0.1:5380' }

async function renderSwitcher() {
  const { ServerSwitcher } = await import('@/components/layout/server-switcher')
  return renderWithProviders(<ServerSwitcher />)
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  profilesFixture = [DEFAULT_PROFILE, CUSTOM_PROFILE]
  activeFixture = DEFAULT_PROFILE
  mockAddProfile.mockReturnValue(CUSTOM_PROFILE)
  mockUpdateProfile.mockReturnValue(true)
  mockRemoveProfile.mockReturnValue(true)
  mockFetch.mockReset()
  probeOk()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ServerSwitcher — listing profiles', () => {
  it('shows the active server name in the trigger button', async () => {
    await renderSwitcher()
    expect(screen.getByRole('button', { name: '切换 DNS 服务器' })).toHaveTextContent('dns.local')
  })

  it('lists all profiles when the dropdown is opened', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('dns.local')).toBeInTheDocument()
    expect(within(menu).getByText('Production')).toBeInTheDocument()
  })

  it('shows the default badge for the env profile', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    expect(await screen.findByText('默认（环境变量）')).toBeInTheDocument()
  })
})

describe('ServerSwitcher — switching', () => {
  it('calls setActive with the profile id once the probe succeeds', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const productionItem = await screen.findByText('Production')
    await user.click(productionItem)

    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith('srv2'))
  })

  it('probes every listed server when the menu opens', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    // Both rows settle to "reachable"; the env default is probed without a
    // target header, the custom one with it.
    await waitFor(() => expect(screen.getAllByText('可用')).toHaveLength(2))
    const urls = mockFetch.mock.calls.map(([url]) => url)
    expect(urls.every((url) => url === '/api/dns/status')).toBe(true)
    const headers = mockFetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-Dns-Target'))
    expect(headers).toContain(null)
    expect(headers).toContain('http://10.0.0.1:5380')
  })
})

describe('ServerSwitcher — reachability gate', () => {
  it('refuses to switch to a server that does not answer and says why', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    probeFail('upstream_unreachable')
    const productionItem = await screen.findByText('Production')
    await user.click(productionItem)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('无法切换到「Production」：服务器无响应'),
    )
    expect(mockSetActive).not.toHaveBeenCalled()
    // The menu stays open and the row carries the failure.
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(await screen.findByText('服务器无响应')).toBeInTheDocument()
  })

  it('reports a policy-blocked address with its own wording', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    probeFail('blocked_target')
    await user.click(await screen.findByText('Production'))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('无法切换到「Production」：该地址被代理安全策略拦截'),
    )
    expect(mockSetActive).not.toHaveBeenCalled()
  })
})

describe('ServerSwitcher — add profile dialog', () => {
  it('opens the add dialog and calls addProfile on valid submit', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const addButton = await screen.findByText('添加服务器')
    await user.click(addButton)

    // Dialog should appear
    const urlInput = await screen.findByLabelText(/地址/)
    await user.type(urlInput, 'http://10.0.0.5:5380')
    const nameInput = screen.getByLabelText('名称')
    await user.type(nameInput, 'Staging')

    await user.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(mockAddProfile).toHaveBeenCalledWith({ name: 'Staging', url: 'http://10.0.0.5:5380' }))
  })

  it('refuses to save a profile whose server does not answer', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const addButton = await screen.findByText('添加服务器')
    await user.click(addButton)

    const urlInput = await screen.findByLabelText(/地址/)
    await user.type(urlInput, 'http://10.0.0.9:5380')

    probeFail('upstream_unreachable')
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(await screen.findByText('服务器无响应')).toBeInTheDocument()
    expect(mockAddProfile).not.toHaveBeenCalled()
  })

  it('rejects an invalid URL and shows error', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const addButton = await screen.findByText('添加服务器')
    await user.click(addButton)

    const urlInput = await screen.findByLabelText(/地址/)
    // ftp:// is rejected by parseServerUrl's protocol guard
    await user.type(urlInput, 'ftp://bad-server')
    await user.click(screen.getByRole('button', { name: '添加' }))

    expect(screen.getByText('请输入有效的 URL')).toBeInTheDocument()
    expect(mockAddProfile).not.toHaveBeenCalled()
  })
})

describe('ServerSwitcher — edit profile', () => {
  it('opens edit dialog pre-filled with profile data', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const editButton = await screen.findByRole('button', { name: '编辑服务器' })
    await user.click(editButton)

    const nameInput = await screen.findByLabelText('名称')
    expect(nameInput).toHaveValue('Production')
    const urlInput = screen.getByLabelText(/地址/)
    expect(urlInput).toHaveValue('http://10.0.0.1:5380')
  })

  it('calls updateProfile on edit submit', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const editButton = await screen.findByRole('button', { name: '编辑服务器' })
    await user.click(editButton)

    const nameInput = await screen.findByLabelText('名称')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith('srv2', { name: 'Renamed', url: 'http://10.0.0.1:5380' }))
  })
})

describe('ServerSwitcher — remove profile', () => {
  it('opens confirm dialog and calls removeProfile on confirm', async () => {
    const user = userEvent.setup()
    await renderSwitcher()
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const removeButton = await screen.findByRole('button', { name: '移除服务器' })
    await user.click(removeButton)

    // Confirm dialog
    const confirmText = await screen.findByText(/确定要移除服务器/)
    expect(confirmText).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '移除' }))
    expect(mockRemoveProfile).toHaveBeenCalledWith('srv2')
  })
})

describe('ServerSwitcher — null editing state (regression)', () => {
  it('does not crash when the dialog submit fires while editing is null', async () => {
    // This is a regression test for the null-narrowing bug: if `editing` is
    // null when onSubmit fires, the component should return false gracefully.
    const user = userEvent.setup()
    await renderSwitcher()

    // Open and close the add dialog quickly to set editing back to null
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))
    const addButton = await screen.findByText('添加服务器')
    await user.click(addButton)

    // Close the dialog via Cancel
    await user.click(screen.getByRole('button', { name: '取消' }))

    // If we reach here without an error, the null-narrowing is correct
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

describe('ServerSwitcher — no profiles state', () => {
  it('shows empty message when no profiles exist', async () => {
    profilesFixture = []
    activeFixture = null
    const user = userEvent.setup()
    await renderSwitcher()

    expect(screen.getByRole('button', { name: '切换 DNS 服务器' })).toHaveTextContent('尚未添加服务器')
    await user.click(screen.getByRole('button', { name: '切换 DNS 服务器' }))

    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('尚未添加服务器')).toBeInTheDocument()
    expect(within(menu).getByText(/添加一台服务器/)).toBeInTheDocument()
  })
})
