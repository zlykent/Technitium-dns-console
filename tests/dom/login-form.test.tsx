import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, PermissionMap } from '@/lib/api/types/common'
import { emptyPermissionMap } from '@/lib/api/types/common'
import { DnsApiError } from '@/lib/api/errors'
import type { ServerProfile } from '@/lib/servers/store'
import { DEFAULT_PROFILE_ID } from '@/lib/servers/store'
import { renderWithProviders } from './utils/render-with-providers'

/**
 * Why we mock at these layers:
 *
 * - `next/navigation`: the component calls `useRouter().replace` and reads
 *   `useSearchParams()`. Both are Next.js framework internals that do not exist
 *   in jsdom; we need controllable spies.
 *
 * - `lib/auth/session`: mocking the hook directly (rather than intercepting
 *   `fetch` to drive the TanStack Query state) avoids coupling every assertion
 *   to query-cache timing. The login form calls `adopt` and `refresh` — these
 *   must be observable synchronously.
 *
 * - `lib/servers/provider`: `selectByUrl` is the critical side-effect that must
 *   fire *before* the credential POST. Mocking the hook lets us assert call
 *   order deterministically.
 *
 * - `lib/api/domains/user`: `login()` wraps `apiRequest` which does real fetch;
 *   mocking here keeps the test focused on the component's branching logic.
 *
 * - `sonner`: toast is a global side-channel; we just verify it was called.
 *
 * - `globalThis.fetch`: only exercised in the token-tab path which posts to
 *   `/api/auth/token` directly (bypasses the SDK client).
 */

// ─── module-level mock handles ────────────────────────────────────────────────
const mockReplace = vi.fn()
const mockPush = vi.fn()
const mockRefresh = vi.fn()

let mockSearchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, refresh: mockRefresh }),
  usePathname: () => '/login',
  useSearchParams: () => mockSearchParams,
}))

const mockAdopt = vi.fn()
const mockSessionRefresh = vi.fn()
const mockSignOut = vi.fn<() => Promise<void>>()

let sessionFixture: {
  session: Session | null
  permissions: PermissionMap
  ready: boolean
  isLoading: boolean
  isAuthenticated: boolean
  connectionError: string | null
  refresh: () => void
  adopt: (s: Session) => void
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

const mockSelectByUrl = vi.fn<(url: string | null) => ServerProfile | null>()
const mockSetActive = vi.fn()

let serversFixture: {
  profiles: ServerProfile[]
  customProfiles: ServerProfile[]
  active: ServerProfile | null
  ready: boolean
  defaultTarget: string | null
  setActive: (id: string) => void
  addProfile: (input: { name: string; url: string }) => ServerProfile | null
  updateProfile: (id: string, patch: Partial<Pick<ServerProfile, 'name' | 'url'>>) => boolean
  removeProfile: (id: string) => boolean
  selectByUrl: (url: string | null) => ServerProfile | null
}

vi.mock('@/lib/servers/provider', () => ({
  useServers: () => serversFixture,
  useTargetKey: () => serversFixture.active?.url ?? DEFAULT_PROFILE_ID,
}))

const mockLogin = vi.fn()
vi.mock('@/lib/api/domains/user', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSession(perms?: Partial<PermissionMap>): Session {
  const permissions = { ...emptyPermissionMap(), ...perms } as PermissionMap
  return {
    displayName: 'Admin',
    username: 'admin',
    isSsoUser: false,
    totpEnabled: false,
    info: {
      version: '9.0.0',
      uptimestamp: '1700000000',
      dnsServerDomain: 'dns.local',
      defaultRecordTtl: 3600,
      defaultNsRecordTtl: 3600,
      defaultSoaRecordTtl: 3600,
      useSoaSerialDateScheme: false,
      dnssecValidation: false,
      clusterInitialized: false,
      permissions,
    },
  }
}

function defaultServersFixture(overrides?: Partial<typeof serversFixture>) {
  const base = {
    profiles: [{ id: DEFAULT_PROFILE_ID, name: 'dns.local', url: 'http://192.168.1.1:5380' }],
    customProfiles: [],
    active: { id: DEFAULT_PROFILE_ID, name: 'dns.local', url: 'http://192.168.1.1:5380' } as ServerProfile | null,
    ready: true,
    defaultTarget: 'http://192.168.1.1:5380' as string | null,
    setActive: mockSetActive,
    addProfile: vi.fn().mockReturnValue(null),
    updateProfile: vi.fn().mockReturnValue(false),
    removeProfile: vi.fn().mockReturnValue(false),
    selectByUrl: mockSelectByUrl,
  }
  serversFixture = { ...base, ...overrides }
}

function defaultSessionFixture(overrides?: Partial<typeof sessionFixture>) {
  sessionFixture = {
    session: null,
    permissions: emptyPermissionMap(),
    ready: true,
    isLoading: false,
    isAuthenticated: false,
    connectionError: null,
    refresh: mockSessionRefresh,
    adopt: mockAdopt,
    signOut: mockSignOut,
    canView: () => false,
    canModify: () => false,
    canDelete: () => false,
    flagsFor: () => ({ canView: false, canModify: false, canDelete: false }),
    ...overrides,
  }
}

async function renderLoginForm() {
  const { LoginForm } = await import('@/components/auth/login-form')
  return renderWithProviders(<LoginForm />)
}

// ─── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  mockSelectByUrl.mockReturnValue({ id: 'srv1', name: 'dns.local', url: 'http://192.168.1.1:5380' })
  defaultServersFixture()
  defaultSessionFixture()
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('LoginForm — rendering & mode switching', () => {
  it('renders password mode by default with server, username and password fields', async () => {
    await renderLoginForm()
    expect(screen.getByLabelText('服务器地址')).toBeInTheDocument()
    expect(screen.getByLabelText(/用户名/, { selector: 'input' })).toBeInTheDocument()
    expect(screen.getByLabelText(/密码/, { selector: 'input' })).toBeInTheDocument()
    // token fields should not be visible (inactive tab panel is not rendered)
    expect(screen.queryByLabelText(/API 令牌/, { selector: 'input' })).not.toBeInTheDocument()
  })

  it('switches to token mode when the API token tab is clicked', async () => {
    const user = userEvent.setup()
    await renderLoginForm()
    await user.click(screen.getByRole('tab', { name: /使用 API 令牌/ }))
    expect(screen.getByLabelText(/API 令牌/, { selector: 'input' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/用户名/, { selector: 'input' })).not.toBeInTheDocument()
  })

  it('renders the 2FA step when needsTotp is triggered', async () => {
    const user = userEvent.setup()
    mockLogin.mockRejectedValueOnce(new DnsApiError('two_factor_required', '2FA needed'))
    await renderLoginForm()

    // Fill and submit to trigger 2FA
    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'secret')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByLabelText(/验证码/, { selector: 'input' })).toBeInTheDocument()
    })
    expect(screen.getByText('两步验证')).toBeInTheDocument()
  })
})

describe('LoginForm — selectByUrl called before request', () => {
  it('calls selectByUrl with the server address before invoking login', async () => {
    const user = userEvent.setup()
    const callOrder: string[] = []
    mockSelectByUrl.mockImplementation((url) => {
      callOrder.push(`selectByUrl:${url}`)
      return { id: 'srv1', name: 'dns.local', url: 'http://192.168.1.1:5380' }
    })
    mockLogin.mockImplementation(async () => {
      callOrder.push('login')
      return makeSession()
    })

    await renderLoginForm()
    const serverInput = screen.getByLabelText('服务器地址')
    await user.clear(serverInput)
    await user.type(serverInput, 'http://192.168.1.1:5380')
    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(callOrder).toEqual(['selectByUrl:http://192.168.1.1:5380', 'login'])
    })
  })
})

describe('LoginForm — server address validation', () => {
  it('shows serverRequired error when address is empty and no default target', async () => {
    const user = userEvent.setup()
    defaultServersFixture({ defaultTarget: null, active: null, profiles: [] })
    await renderLoginForm()

    // Clear the server field (it may be seeded)
    const serverInput = screen.getByLabelText('服务器地址')
    await user.clear(serverInput)
    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByText('请输入服务器地址。')).toBeInTheDocument()
    })
    expect(mockLogin).not.toHaveBeenCalled()
  })
})

describe('LoginForm — TOTP input sanitisation', () => {
  it('strips non-digits and truncates to 6 characters', async () => {
    const user = userEvent.setup()
    mockLogin.mockRejectedValueOnce(new DnsApiError('two_factor_required', '2FA'))
    await renderLoginForm()

    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass')
    await user.click(screen.getByRole('button', { name: '登录' }))

    const totpInput = await screen.findByLabelText(/验证码/, { selector: 'input' })
    await user.type(totpInput, '12ab34cd56789')
    expect(totpInput).toHaveValue('123456')
  })
})

describe('LoginForm — API token validation', () => {
  it('disables submit and shows error when token is shorter than 16 chars', async () => {
    const user = userEvent.setup()
    await renderLoginForm()
    await user.click(screen.getByRole('tab', { name: /使用 API 令牌/ }))

    const tokenInput = screen.getByLabelText(/API 令牌/, { selector: 'input' })
    await user.type(tokenInput, 'short')

    expect(screen.getByText('API 令牌至少需要 16 个字符。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled()
  })

  it('enables submit when token is 16+ chars', async () => {
    const user = userEvent.setup()
    await renderLoginForm()
    await user.click(screen.getByRole('tab', { name: /使用 API 令牌/ }))

    const tokenInput = screen.getByLabelText(/API 令牌/, { selector: 'input' })
    await user.type(tokenInput, 'a'.repeat(16))

    expect(screen.queryByText('API 令牌至少需要 16 个字符。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
  })
})

describe('LoginForm — open redirect protection', () => {
  it('rejects ?next=https://evil.com and falls back to landingRoute', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams('next=https://evil.com')
    mockLogin.mockResolvedValueOnce(makeSession({ Dashboard: { canView: true, canModify: false, canDelete: false } }))
    defaultSessionFixture({
      permissions: { ...emptyPermissionMap(), Dashboard: { canView: true, canModify: false, canDelete: false } },
    })

    await renderLoginForm()
    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('rejects ?next=//evil.com and falls back to landingRoute', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams('next=//evil.com')
    mockLogin.mockResolvedValueOnce(makeSession({ Zones: { canView: true, canModify: false, canDelete: false } }))
    defaultSessionFixture({
      permissions: { ...emptyPermissionMap(), Zones: { canView: true, canModify: false, canDelete: false } },
    })

    await renderLoginForm()
    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      // landingRoute returns /zones because the session permissions grant Zones.canView
      // and Dashboard.canView is false — open redirect blocked, safe fallback used
      expect(mockReplace).toHaveBeenCalledWith('/zones')
    })
  })

  it('accepts a safe relative ?next=/zones path', async () => {
    const user = userEvent.setup()
    mockSearchParams = new URLSearchParams('next=/zones')
    mockLogin.mockResolvedValueOnce(makeSession())

    await renderLoginForm()
    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/zones')
    })
  })
})

describe('LoginForm — auto-redirect when already authenticated', () => {
  it('redirects immediately when isAuthenticated is true', async () => {
    defaultSessionFixture({
      isAuthenticated: true,
      permissions: { ...emptyPermissionMap(), Dashboard: { canView: true, canModify: false, canDelete: false } },
    })
    await renderLoginForm()
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/dashboard')
    })
  })
})

describe('LoginForm — default credentials warning', () => {
  it('shows warning when logging in with admin/123456', async () => {
    const user = userEvent.setup()
    mockLogin.mockResolvedValueOnce(makeSession())
    await renderLoginForm()

    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), '123456')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText('该服务器仍在使用默认凭据，请尽快修改管理员密码。')).toBeInTheDocument()
    })
  })
})

describe('LoginForm — error rendering', () => {
  it('renders API errors via ErrorState', async () => {
    const user = userEvent.setup()
    mockLogin.mockRejectedValueOnce(new DnsApiError('upstream_unreachable', 'no route'))
    await renderLoginForm()

    await user.type(screen.getByLabelText(/用户名/, { selector: 'input' }), 'admin')
    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('无法连接到 DNS 服务器')).toBeInTheDocument()
    })
  })

  it('shows usernameRequired error when username is blank', async () => {
    const user = userEvent.setup()
    await renderLoginForm()

    await user.type(screen.getByLabelText(/密码/, { selector: 'input' }), 'pass')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByText('请输入用户名。')).toBeInTheDocument()
    })
    expect(mockLogin).not.toHaveBeenCalled()
  })
})

describe('LoginForm — token tab fetch', () => {
  it('posts to /api/auth/token with the trimmed token value', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(makeSession()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    await renderLoginForm()
    await user.click(screen.getByRole('tab', { name: /使用 API 令牌/ }))

    const tokenInput = screen.getByLabelText(/API 令牌/, { selector: 'input' })
    await user.type(tokenInput, 'valid-long-token-here')
    await user.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/token',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'valid-long-token-here' }),
        }),
      )
    })
    fetchSpy.mockRestore()
  })
})
