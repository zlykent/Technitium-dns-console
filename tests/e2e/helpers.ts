import { expect, type Page } from '@playwright/test'
import { E2E } from './env'

/**
 * Shared E2E plumbing.
 *
 * Three things every spec needs and none should re-implement:
 *
 *  1. A console-error sentinel. A page that renders but logs a React warning is
 *     still broken, and headless screenshots cannot show it.
 *  2. Navigation that waits for the *content*, not for `load`. Every console
 *     page is a client component that fetches through the proxy, so `load`
 *     fires while the shell is still showing skeletons.
 *  3. The login sequence, which is also what `global-setup.ts` runs.
 */

/**
 * Noise that is not a defect in this app.
 *
 * Deliberately short: every entry here is a class of message the suite cannot
 * act on, and anything else should fail the test.
 */
const BENIGN = [
  // Chromium surfaces a late ResizeObserver delivery as a page error. Recharts
  // and Radix both resize during layout; the notification arrives after paint.
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
  // Firefox's equivalent of the above.
  /NS_BINDING_ABORTED/,
]

export interface ConsoleWatcher {
  readonly errors: string[]
  /**
   * Drop everything captured so far.
   *
   * For the one class of noise page script cannot prevent: the browser logs
   * `Failed to load resource: … 4xx` itself, so any request that is *expected*
   * to be rejected shows up here. A blanket allowlist entry for 401 would hide
   * a genuinely broken session, so the caller marks the boundary instead.
   */
  clear(): void
  /** Assert nothing unexpected was logged since the last {@link clear}. */
  expectClean(label?: string): void
}

export function watchConsole(page: Page): ConsoleWatcher {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (BENIGN.some((pattern) => pattern.test(text))) return
    errors.push(`console.error: ${text}`)
  })

  page.on('pageerror', (error) => {
    const text = `${error.name}: ${error.message}`
    if (BENIGN.some((pattern) => pattern.test(text))) return
    errors.push(`pageerror: ${text}`)
  })

  return {
    errors,
    clear() {
      errors.length = 0
    },
    expectClean(label = page.url()) {
      expect(errors, `unexpected console output on ${label}`).toEqual([])
    },
  }
}

/** The scrollable region every console route renders. Top-level modules carry
 *  no `<h1>` of their own — the topbar label names them — so the shell is the
 *  stable "the page is alive" gate. */
export function pageSurface(page: Page) {
  return page.locator('[data-slot="page-shell"]').first()
}

/** The `<h1>` sub-pages render through `PageHeader` (the zone name plus
 *  breadcrumbs); top-level modules intentionally have none. */
export function pageHeading(page: Page) {
  return page.locator('[data-slot="page-shell"] h1')
}

/** The topbar module label — the one place top-level modules print their name. */
export function moduleTitle(page: Page) {
  return page.locator('[data-slot="topbar"] h2')
}

/**
 * Navigate to a console route and wait until it has actually rendered.
 *
 * Waiting on the shell alone is not enough — it is present while the body is
 * still a skeleton — so this also settles any in-flight proxy request.
 *
 * The shell and the guard's redirect to /login are raced rather than awaited
 * in sequence. A revoked shared token used to show up here as a bare 20s
 * timeout repeated across every remaining spec; naming the redirect as it
 * happens turns that into one actionable message at the first affected test.
 */
export async function gotoConsole(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })

  // Both arms swallow their own rejection so the loser of the race cannot
  // surface as an unhandled error once the winner has settled.
  const rendered = pageSurface(page)
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(
      () => 'surface' as const,
      () => null,
    )
  const bounced = page.waitForURL(/\/login/, { timeout: 20_000 }).then(
    () => 'login' as const,
    () => null,
  )
  const outcome = await Promise.race([rendered, bounced])

  if (outcome === 'login') {
    throw new Error(
      `Opening ${path} was redirected to /login: the shared storageState token was rejected. ` +
        `A spec revoked it — sign-out, a password change, or a session delete. Such a spec must ` +
        `declare test.use({ storageState: ANONYMOUS }) and sign in on its own.`,
    )
  }
  if (outcome === null) {
    throw new Error(`${path} rendered neither its page shell nor a redirect to /login within 20s.`)
  }

  await expect(pageSurface(page)).toBeVisible({ timeout: 20_000 })
  await settle(page)
}

/** Wait for the network to go quiet, bounded — a polling query would hang it. */
export async function settle(page: Page, timeout = 10_000): Promise<void> {
  await page
    .waitForLoadState('networkidle', { timeout })
    .catch(() => {
      // networkidle never fires if something polls; the heading wait above is
      // the real gate, so a timeout here is not a failure.
    })
}

/**
 * Open the login page and wait until React owns the form.
 *
 * `domcontentloaded` fires well before hydration. Filling a controlled input in
 * that window sets the DOM value but reaches no `onChange`, so the first render
 * re-applies the component's own (empty) state and silently wipes it — the
 * submit then fails validation and the page never leaves `/login`.
 *
 * The page issues `user/session/get` from an effect that runs only once the
 * persisted server store has hydrated, so that response is a precise signal.
 * It is allowed to be missing (a cached or aborted probe must not hang setup).
 */
export async function gotoLogin(page: Page): Promise<void> {
  const hydrated = page
    .waitForResponse((response) => response.url().includes('/api/dns/user/session/get'), { timeout: 20_000 })
    .catch(() => null)

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await hydrated
  await expect(page.locator('#username')).toBeVisible({ timeout: 20_000 })
}

export async function login(page: Page, credentials?: { user?: string; pass?: string }): Promise<void> {
  const user = credentials?.user ?? E2E.user
  const pass = credentials?.pass ?? E2E.pass

  await gotoLogin(page)
  await page.locator('#server').fill(E2E.dnsUrl)
  await page.locator('#username').fill(user)
  await page.locator('#password').fill(pass)
  await page.locator('button[type="submit"]').click()

  // Success is a redirect away from /login; failure leaves an ErrorState behind.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
  await expect(pageSurface(page)).toBeVisible({ timeout: 20_000 })
}

/**
 * A sidebar entry, addressed by href so renaming a label cannot break it.
 *
 * Scoped to `[data-slot="sidebar"]` on purpose: the breadcrumb on every detail
 * page is also a `<nav aria-label>`, and its "back to the list" link points at
 * the very same hrefs, so a bare `nav[aria-label]` matches twice.
 */
export function sidebarLink(page: Page, href: string) {
  return page.locator(`[data-slot="sidebar"] nav[aria-label] a[href="${href}"]`)
}

/** The desktop sidebar. The mobile one lives in a Sheet and is unmounted while closed. */
export function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]').first()
}

export async function navigateBySidebar(page: Page, href: string): Promise<void> {
  await sidebarLink(page, href).click()
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}(/|$|\\?)`))
  await expect(pageSurface(page)).toBeVisible()
  await settle(page)
}

/** Open the mobile navigation sheet; a no-op when the sidebar is already shown. */
export async function openMobileNav(page: Page): Promise<void> {
  const toggle = page.locator('header button[aria-haspopup="dialog"]').first()
  if (await toggle.isVisible()) await toggle.click()
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Run an action and return the proxied API calls it triggered.
 *
 * Several assertions are about *what the UI asked for* rather than what it drew:
 * a filter that re-fetches with the wrong parameter looks identical on screen
 * until the server disagrees.
 */
export async function captureApiCalls(page: Page, action: () => Promise<void>): Promise<string[]> {
  const urls: string[] = []
  const listener = (request: { url(): string }) => {
    const url = request.url()
    if (url.includes('/api/dns/')) urls.push(url)
  }
  page.on('request', listener)
  try {
    await action()
    await settle(page, 4_000)
  } finally {
    page.off('request', listener)
  }
  return urls
}
