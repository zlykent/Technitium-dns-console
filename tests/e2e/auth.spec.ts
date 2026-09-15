import { expect, test } from '@playwright/test'
import { E2E } from './env'
import { gotoConsole, gotoLogin, login, pageSurface, watchConsole } from './helpers'

/**
 * Authentication and the route guard.
 *
 * These tests deliberately do not reuse the shared session: they need to see
 * what an anonymous visitor sees. `storageState` is overridden per describe
 * block rather than globally so the rest of the suite keeps its fast path.
 */

// Playwright 1.63 does not re-export the `StorageState` type, so the empty
// state is written structurally. The `never[]` casts matter: `as const` would
// produce `readonly []` tuples, which the fixture's mutable arrays reject.
const ANONYMOUS = { cookies: [] as never[], origins: [] as never[] }

test.describe('route guard', () => {
  test.use({ storageState: ANONYMOUS })

  test('an anonymous visit to a console route is sent to /login with the target preserved', async ({ page }) => {
    await page.goto('/zones', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/login/, { timeout: 20_000 })
    // The guard records where the visitor wanted to go so login can return them
    // there instead of dumping everyone on the dashboard.
    await expect(page).toHaveURL(/next=%2Fzones/)
  })

  test('the login page itself is reachable anonymously', async ({ page }) => {
    await gotoLogin(page)
    await expect(page.locator('#username')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    // The server address is seeded from TECHNITIUM_API_URL, not left blank.
    await expect(page.locator('#server')).toHaveValue(E2E.dnsUrl)
  })

  test('the root path redirects rather than rendering a blank page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/login/, { timeout: 20_000 })
    await expect(page.locator('#username')).toBeVisible()
  })
})

test.describe('sign in', () => {
  test.use({ storageState: ANONYMOUS })

  test('a wrong password is reported and the visitor stays put', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoLogin(page)
    await page.locator('#server').fill(E2E.dnsUrl)
    await page.locator('#username').fill(E2E.user)
    await page.locator('#password').fill('definitely-not-the-password')
    await page.locator('button[type="submit"]').click()

    // The proxy surfaces the upstream's own reason; swallowing it would leave
    // the operator guessing whether the server or the password is at fault.
    await expect(page.locator('[data-slot="page-shell"], main, form').first()).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.locator('#username')).toBeVisible()
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20_000 })

    // 401 from a rejected login is the API doing its job, not a page defect.
    expect(watcher.errors.filter((e) => !e.includes('401'))).toEqual([])
  })

  test('empty credentials are rejected before any request is made', async ({ page }) => {
    await gotoLogin(page)
    await page.locator('#server').fill(E2E.dnsUrl)
    await page.locator('#username').fill('')
    await page.locator('#password').fill('')

    const calls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/dns/user/login')) calls.push(request.url())
    })
    await page.locator('button[type="submit"]').click()
    await page.waitForTimeout(1_500)

    expect(calls, 'client-side validation short-circuits the request').toEqual([])
    await expect(page).toHaveURL(/\/login/)
  })

  test('a valid sign-in lands on the dashboard and stores an httpOnly session', async ({ page, context }) => {
    const watcher = watchConsole(page)
    await gotoLogin(page)
    await page.locator('#server').fill(E2E.dnsUrl)
    await page.locator('#username').fill(E2E.user)
    await page.locator('#password').fill(E2E.pass)
    // Everything before the submit is expected noise: the login page probes
    // `user/session/get` on mount to find out whether a session already exists,
    // and with no token yet that answers 401, which the browser logs as
    // "Failed to load resource" on its own initiative. What this test is about
    // is the dashboard *after* a successful sign-in, so the boundary is the
    // submit — a 401 from here on would still be caught.
    watcher.clear()
    await page.locator('button[type="submit"]').click()

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    await expect(pageSurface(page)).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/dashboard/)

    // The token must not be readable from script — that is the whole point of
    // routing it through the proxy instead of keeping it in localStorage.
    const visibleToScript = await page.evaluate(() => document.cookie)
    expect(visibleToScript).not.toContain('tdns_t_')

    const cookies = await context.cookies()
    const session = cookies.find((cookie) => cookie.name.startsWith('tdns_t_'))
    expect(session, 'proxy set a session cookie').toBeDefined()
    expect(session!.httpOnly, 'session cookie is httpOnly').toBe(true)
    expect(session!.value.length, 'session cookie carries a real token').toBeGreaterThan(16)

    watcher.expectClean('post-login dashboard')
  })

  test('?next= returns the visitor to the page they asked for', async ({ page }) => {
    await gotoLogin(page)
    await page.goto('/login?next=%2Fsettings', { waitUntil: 'domcontentloaded' })
    await page.waitForResponse((r) => r.url().includes('/api/dns/user/session/get'), { timeout: 20_000 }).catch(() => null)
    await page.locator('#server').fill(E2E.dnsUrl)
    await page.locator('#username').fill(E2E.user)
    await page.locator('#password').fill(E2E.pass)
    await page.locator('button[type="submit"]').click()

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    await expect(page).toHaveURL(/\/settings/)
  })

  test('an absolute ?next= is refused instead of becoming an open redirect', async ({ page }) => {
    await page.goto('/login?next=%2F%2Fevil.example.com%2Fphish', { waitUntil: 'domcontentloaded' })
    await page.waitForResponse((r) => r.url().includes('/api/dns/user/session/get'), { timeout: 20_000 }).catch(() => null)
    await page.locator('#server').fill(E2E.dnsUrl)
    await page.locator('#username').fill(E2E.user)
    await page.locator('#password').fill(E2E.pass)
    await page.locator('button[type="submit"]').click()

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    const landed = new URL(page.url())
    expect(landed.origin, 'still on the console origin').toBe(new URL(E2E.baseUrl).origin)
    expect(landed.pathname).toBe('/dashboard')
  })
})

test.describe('api token sign in', () => {
  test.use({ storageState: ANONYMOUS })

  test('a too-short token is blocked in the browser', async ({ page }) => {
    await gotoLogin(page)
    await page.getByRole('tab').nth(1).click()
    await expect(page.locator('#api-token')).toBeVisible()

    await page.locator('#api-token').fill('short')
    await expect(page.locator('#api-token-error')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeDisabled()

    const calls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/token')) calls.push(request.url())
    })
    await page.locator('button[type="submit"]').click({ force: true }).catch(() => undefined)
    await page.waitForTimeout(1_000)
    expect(calls, 'no request for a token that cannot be valid').toEqual([])
  })

  test('a bogus token is verified before it is stored, and reported', async ({ page, context }) => {
    await gotoLogin(page)
    await page.getByRole('tab').nth(1).click()
    await page.locator('#token-server').fill(E2E.dnsUrl)
    await page.locator('#api-token').fill('0000000000000000000000000000000000000000')

    let status = 0
    page.on('response', (response) => {
      if (response.url().includes('/api/auth/token')) status = response.status()
    })
    await page.locator('button[type="submit"]').click()

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20_000 })
    expect(status, 'the route rejects the token').toBe(401)

    // Rejecting must not leave a half-set cookie behind, or every later page
    // would fail with a confusing upstream error.
    const cookies = await context.cookies()
    expect(cookies.find((c) => c.name.startsWith('tdns_t_')), 'no session cookie stored').toBeUndefined()
  })
})

test.describe('sign out', () => {
  // Anonymous, then signing in inside the test. This is not cosmetic: signing
  // out asks the server to *revoke the token it is holding*, and with the shared
  // `storageState` that token is the one every later spec authenticates with.
  // Revoking it left the rest of the suite redirecting to /login, where each
  // `gotoConsole` burned its full heading timeout — 20s per test, all failing.
  test.use({ storageState: ANONYMOUS })

  test('leaves the console and clears the session cookie', async ({ page, context }) => {
    await login(page)
    await gotoConsole(page, '/dashboard')

    const menu = page.getByRole('button', { name: /Administrator|admin/i }).first()
    await menu.click()
    await page.getByRole('menuitem').last().click()

    await page.waitForURL(/\/login/, { timeout: 20_000 })
    await expect(page.locator('#username')).toBeVisible()

    // And stay there: /login's already-signed-in bounce fires within a tick of
    // mount, so a stale session flag would show up as a quick hop back into
    // the console rather than as a failed assertion above.
    await page.waitForTimeout(1_500)
    await expect(page).toHaveURL(/\/login/)

    const cookies = await context.cookies()
    expect(cookies.find((c) => c.name.startsWith('tdns_t_') && c.value !== ''), 'session cookie cleared').toBeUndefined()

    // And the guard is armed again.
    await page.goto('/zones', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/login/, { timeout: 20_000 })
  })
})
