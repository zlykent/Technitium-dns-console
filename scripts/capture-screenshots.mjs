/**
 * Visual QA capture — every console route, in a real browser, against a real
 * Technitium server.
 *
 * Why this is a script and not a spec: the E2E suite already proves each page
 * *behaves*, and it runs on every change. What it cannot prove is that the pages
 * look right, because an assertion on a heading passes just as happily over a
 * broken layout. This walks the same routes a human reviewer would and leaves
 * behind the evidence, so "did the redesign actually land?" is answerable by
 * looking rather than by reading test output.
 *
 * It is strictly read-only. Every dialog it opens is cancelled, and the one
 * write-shaped action it reaches for (`dnsClient/resolve` with `import`) is
 * stopped at its confirmation dialog — sending it would create a primary zone
 * on the operator's server (`.probe/console-js/dnsclient.js:149-152`).
 *
 * Usage:
 *   pnpm build && pnpm exec next start -p 3200    # in another shell
 *   node scripts/capture-screenshots.mjs
 *
 *   --base    console origin          (default http://127.0.0.1:3200)
 *   --target  Technitium server       (default http://127.0.0.1:5380)
 *   --user    / --pass                (default admin / 123456)
 *   --out     output directory        (default docs/screenshots)
 *   --zone    zone for the detail pages (default: discovered from /zones)
 *   --only    substring filter on shot ids, repeatable
 *
 * Exits non-zero when a page logs a console error or fails to render, which is
 * the part that makes this verification rather than decoration.
 */

import { chromium } from '@playwright/test'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ─── configuration ────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
function flag(name) {
  return args.includes(`--${name}`)
}
function argAll(name) {
  const out = []
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}` && args[i + 1]) out.push(args[++i])
  return out
}

const BASE = arg('base', process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3200')
const TARGET = arg('target', process.env.E2E_DNS_URL ?? 'http://127.0.0.1:5380')
const USER = arg('user', process.env.E2E_DNS_USER ?? 'admin')
const PASS = arg('pass', process.env.E2E_DNS_PASS ?? '123456')
const OUT = resolve(arg('out', 'docs/screenshots'))
const ZONE_OVERRIDE = arg('zone', '')
const ONLY = argAll('only')
const KEEP_STALE = flag('keep-stale')

/** The locale cookie the app itself reads; without it the first visit negotiates
 *  from `Accept-Language` and the zh-labelled selectors below would not match. */
const LOCALE_COOKIE = 'tdns_locale'

const DESKTOP = { width: 1600, height: 1000 }
const MOBILE = { width: 390, height: 844 }

/** Same allowlist as `tests/e2e/helpers.ts` — keep the two in step. */
const BENIGN = [/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/, /NS_BINDING_ABORTED/]

function log(message) {
  process.stdout.write(message + '\n')
}

// ─── shot table ───────────────────────────────────────────────────────────────

/**
 * Every shot, in the order a reviewer would flip through them.
 *
 * `group` selects the browser context, which is how theme and locale are varied
 * without fighting `next-themes`: it owns `<html class>` and `localStorage.theme`,
 * so a second context seeded with a different value is the only reliable lever.
 *
 * `setup` runs after the heading is on screen and before the capture; it is where
 * a tab is clicked, a dialog opened, or the page scrolled. Anything it opens is
 * dismissed afterwards, so a later shot never inherits an overlay.
 */
const SHOTS = [
  // ── unauthenticated ──
  { id: '01-login', group: 'anon', path: '/login', wait: '#username', allowResourceErrors: true },

  // ── console, zh + dark ──
  { id: '02-dashboard', group: 'zh', path: '/dashboard' },
  {
    id: '03-dashboard-flush-confirm',
    group: 'zh',
    path: '/dashboard',
    viewportOnly: true,
    setup: async (page, h) => {
      await h.button('清空缓存').click()
      await h.dialog()
    },
  },
  { id: '04-zones', group: 'zh', path: '/zones' },
  {
    id: '05-zones-create-dialog',
    group: 'zh',
    path: '/zones',
    viewportOnly: true,
    setup: async (page, h) => {
      await h.button('创建区域').click()
      await h.dialog('[role="dialog"]')
    },
  },
  { id: '06-zone-records', group: 'zh', path: '/zones/{zone}' },
  {
    id: '07-zone-add-record-dialog',
    group: 'zh',
    path: '/zones/{zone}',
    viewportOnly: true,
    setup: async (page, h) => {
      await h.button('添加记录').click()
      await h.dialog('[role="dialog"]')
    },
  },
  { id: '08-zone-dnssec', group: 'zh', path: '/zones/{zone}/dnssec' },
  { id: '09-zone-options', group: 'zh', path: '/zones/{zone}/options' },
  { id: '10-zone-permissions', group: 'zh', path: '/zones/{zone}/permissions' },
  { id: '11-cache', group: 'zh', path: '/cache' },
  { id: '12-allowed', group: 'zh', path: '/allowed' },
  { id: '13-blocked', group: 'zh', path: '/blocked' },
  { id: '14-logs', group: 'zh', path: '/logs' },
  { id: '15-system-logs', group: 'zh', path: '/system-logs' },
  { id: '16-dhcp', group: 'zh', path: '/dhcp' },
  { id: '17-apps', group: 'zh', path: '/apps' },
  {
    id: '18-resolve',
    group: 'zh',
    path: '/resolve',
    setup: async (page, h) => {
      // A read-only query against a record the server is authoritative for:
      // instant, deterministic, and it cannot mutate anything.
      await page.locator('#resolve-domain').fill('zly.wskj')
      await h.button('解析', true).click()
      await page.locator('.font-data').first().waitFor({ state: 'visible', timeout: 30_000 })
      await h.settle()
    },
  },
  {
    id: '19-resolve-import-confirm',
    group: 'zh',
    path: '/resolve',
    viewportOnly: true,
    setup: async (page, h) => {
      await page.locator('#resolve-domain').fill('zly.wskj')
      await h.button('解析', true).click()
      await page.locator('.font-data').first().waitFor({ state: 'visible', timeout: 30_000 })
      // Stops here on purpose. Confirming would write records into a zone, and
      // with no matching zone the server creates a brand new primary one.
      await h.button('添加为区域记录').click()
      await h.dialog()
    },
  },
  { id: '20-settings', group: 'zh', path: '/settings' },
  {
    id: '21-settings-advanced',
    group: 'zh',
    path: '/settings',
    setup: async (page, h) => {
      await page.locator('#settings-advanced').scrollIntoViewIfNeeded()
      await h.settle(1_500)
    },
  },
  { id: '22-admin-users', group: 'zh', path: '/admin' },
  { id: '23-admin-groups', group: 'zh', path: '/admin', setup: (page, h) => h.tab('用户组') },
  { id: '24-admin-permissions', group: 'zh', path: '/admin', setup: (page, h) => h.tab('权限') },
  { id: '25-admin-sessions', group: 'zh', path: '/admin', setup: (page, h) => h.tab('会话') },
  { id: '26-admin-sso', group: 'zh', path: '/admin', setup: (page, h) => h.tab('单点登录') },
  { id: '27-admin-cluster', group: 'zh', path: '/admin', setup: (page, h) => h.tab('集群') },
  { id: '28-account-profile', group: 'zh', path: '/account?tab=profile' },
  { id: '29-account-security', group: 'zh', path: '/account?tab=security' },
  { id: '30-account-tokens', group: 'zh', path: '/account?tab=tokens' },
  { id: '31-account-sessions', group: 'zh', path: '/account?tab=sessions' },
  { id: '32-account-about', group: 'zh', path: '/account?tab=about' },
  { id: '33-not-found', group: 'zh', path: '/definitely-not-a-route', heading: false },

  // ── light theme: the design system has to hold up in both ──
  { id: '34-dashboard-light', group: 'light', path: '/dashboard' },
  { id: '35-zones-light', group: 'light', path: '/zones' },
  { id: '36-settings-light', group: 'light', path: '/settings' },

  // ── English: the two locales must not drift in layout ──
  { id: '37-dashboard-en', group: 'en', path: '/dashboard' },
  { id: '38-zones-en', group: 'en', path: '/zones' },
  { id: '39-account-about-en', group: 'en', path: '/account?tab=about' },

  // ── narrow viewport: the sidebar becomes a sheet ──
  {
    id: '40-dashboard-mobile',
    group: 'mobile',
    path: '/dashboard',
    viewportOnly: true,
    setup: async (page, h) => {
      await page.locator('header button[aria-haspopup="dialog"]').first().click()
      await h.settle(1_000)
    },
  },
]

// ─── runner ───────────────────────────────────────────────────────────────────

const results = []

/** Attach the console sentinel and return a drain function. */
function watch(page, { allowResourceErrors = false } = {}) {
  const errors = []
  const keep = (text) => {
    if (BENIGN.some((pattern) => pattern.test(text))) return false
    // The browser logs every non-2xx fetch itself. The login page probes the
    // stored session before there is one, so a 401 there is the expected path.
    if (allowResourceErrors && /Failed to load resource/.test(text)) return false
    return true
  }
  page.on('console', (message) => {
    if (message.type() === 'error' && keep(message.text())) errors.push(`console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    const text = `${error.name}: ${error.message}`
    if (keep(text)) errors.push(`pageerror: ${text}`)
  })
  return errors
}

/** Per-shot helpers handed to `setup`, so the table above stays declarative. */
function makeHelpers(page) {
  const settle = (timeout = 8_000) =>
    page.waitForLoadState('networkidle', { timeout }).catch(() => {
      // A polling query means networkidle never fires; not a failure.
    })

  return {
    settle,
    button(name, exact = false) {
      return page.getByRole('button', { name, exact })
    },
    /** Wait for a modal. Destructive confirms are `alertdialog`, forms are `dialog`. */
    async dialog(selector = '[role="alertdialog"]') {
      await page.locator(selector).first().waitFor({ state: 'visible', timeout: 15_000 })
      await settle(1_500)
    },
    /** Click a Radix tab by its visible label and wait for the panel to fetch. */
    async tab(label) {
      await page.getByRole('tab', { name: label }).click()
      await settle()
    },
  }
}

async function signIn(page) {
  // `domcontentloaded` fires before hydration; filling a controlled input in
  // that window is silently reverted by the first render. The session probe is
  // the signal that React owns the form (same reasoning as `helpers.ts`).
  const hydrated = page
    .waitForResponse((response) => response.url().includes('/api/dns/user/session/get'), { timeout: 20_000 })
    .catch(() => null)

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await hydrated
  await page.locator('#username').waitFor({ state: 'visible', timeout: 20_000 })

  await page.locator('#server').fill(TARGET)
  await page.locator('#username').fill(USER)
  await page.locator('#password').fill(PASS)
  await page.locator('button[type="submit"]').click()

  // A rejected login stays on /login behind an ErrorState, so the bare
  // `waitForURL` timeout below would say nothing about *why*. Reading the
  // rendered message first is the difference between an actionable report and
  // half a minute of guessing.
  const arrived = await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    .then(() => true, () => false)

  if (!arrived) {
    const reason = await page
      .locator('[role="alert"], [data-slot="error-state"]')
      .first()
      .innerText({ timeout: 3_000 })
      .catch(() => '')
    throw new Error(`sign-in to ${TARGET} as ${USER} did not leave /login${reason ? `: ${reason.trim()}` : ' (no error rendered)'}`)
  }
}

/** Read a real zone name off the list page so the detail shots need no config. */
async function discoverZone(page) {
  await page.goto('/zones', { waitUntil: 'domcontentloaded' })
  const link = page.locator('[data-slot="data-table"] tbody tr a[href^="/zones/"]').first()
  try {
    await link.waitFor({ state: 'visible', timeout: 30_000 })
  } catch {
    throw new Error('No zone is listed on /zones, so the per-zone shots have nothing to open. Pass --zone <name>.')
  }
  const href = await link.getAttribute('href')
  return decodeURIComponent(String(href).replace('/zones/', '').split('/')[0])
}

async function capture(context, shot, zone) {
  const page = await context.newPage()
  const errors = watch(page, { allowResourceErrors: shot.allowResourceErrors })
  const path = shot.path.replace('{zone}', encodeURIComponent(zone))
  const started = Date.now()

  try {
    await page.goto(path, { waitUntil: 'domcontentloaded' })

    if (shot.wait) {
      await page.locator(shot.wait).waitFor({ state: 'visible', timeout: 25_000 })
    } else if (shot.heading !== false) {
      // The heading renders while the body is still a skeleton, so settling the
      // network afterwards is what makes the shot show real data.
      await page.locator('[data-slot="page-shell"] h1').waitFor({ state: 'visible', timeout: 25_000 })
    }
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined)

    if (shot.setup) await shot.setup(page, makeHelpers(page))

    const file = join(OUT, `${shot.id}.png`)
    await page.screenshot({ path: file, fullPage: !shot.viewportOnly })
    results.push({ id: shot.id, path, file, ms: Date.now() - started, errors: [...errors] })
    log(`  ok   ${shot.id.padEnd(30)} ${String(Date.now() - started).padStart(5)}ms  ${errors.length ? `!! ${errors.length} console error(s)` : ''}`)
  } catch (error) {
    results.push({ id: shot.id, path, file: null, ms: Date.now() - started, errors: [...errors], failed: String(error?.message ?? error).split('\n')[0] })
    log(`  FAIL ${shot.id.padEnd(30)} ${String(error?.message ?? error).split('\n')[0]}`)
  } finally {
    await page.close()
  }
}

function contextOptions(base) {
  return { ...base, baseURL: BASE, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' }
}

async function main() {
  const wanted = ONLY.length ? SHOTS.filter((shot) => ONLY.some((needle) => shot.id.includes(needle))) : SHOTS
  if (wanted.length === 0) {
    log(`No shot id matches ${ONLY.join(', ')}`)
    process.exit(2)
  }

  mkdirSync(OUT, { recursive: true })
  log(`Capturing ${wanted.length} screenshot(s) from ${BASE} into ${OUT}`)

  const browser = await chromium.launch()
  try {
    // One login, then hand the session to every variant context. The token is an
    // httpOnly cookie on our own origin and the server list is localStorage, so
    // `storageState` carries both — same trick as `global-setup.ts`.
    //
    // Sign-in is lazy on purpose: an anonymous-only run (`--only 01-login`) must
    // work without credentials, and when the upstream DNS server is unreachable
    // the report should say which shots needed it rather than dying before the
    // first capture.
    const needsAuth = wanted.some((shot) => shot.group !== 'anon')
    let storageState
    let zone = ZONE_OVERRIDE

    if (needsAuth) {
      const auth = await browser.newContext(contextOptions({ viewport: DESKTOP }))
      await auth.addCookies([{ name: LOCALE_COOKIE, value: 'zh', url: BASE }])
      const authPage = await auth.newPage()
      await signIn(authPage)
      storageState = await auth.storageState()
      if (!zone) zone = await discoverZone(authPage)
      log(`Signed in. Zone for the detail pages: ${zone}`)
      await auth.close()
    } else {
      log('Anonymous run — no sign-in attempted.')
    }

    /** Reuse the captured session, or omit the key entirely when there is none. */
    const withSession = (options) => (storageState ? { ...options, storageState } : options)

    const groups = {
      zh: async () => {
        const context = await browser.newContext(contextOptions(withSession({ viewport: DESKTOP })))
        await context.addCookies([{ name: LOCALE_COOKIE, value: 'zh', url: BASE }])
        return context
      },
      light: async () => {
        const context = await browser.newContext(contextOptions(withSession({ viewport: DESKTOP })))
        await context.addCookies([{ name: LOCALE_COOKIE, value: 'zh', url: BASE }])
        // Runs before page scripts on every navigation, so it wins over whatever
        // `storageState` restored. Guarded because init scripts also execute on
        // `about:blank`, where touching localStorage throws.
        await context.addInitScript(() => {
          try {
            window.localStorage.setItem('theme', 'light')
          } catch {
            /* no origin yet */
          }
        })
        return context
      },
      en: async () => {
        const context = await browser.newContext(contextOptions(withSession({ viewport: DESKTOP })))
        await context.addCookies([{ name: LOCALE_COOKIE, value: 'en', url: BASE }])
        return context
      },
      mobile: async () => {
        const context = await browser.newContext(
          contextOptions(withSession({ viewport: MOBILE, isMobile: true, hasTouch: true })),
        )
        await context.addCookies([{ name: LOCALE_COOKIE, value: 'zh', url: BASE }])
        return context
      },
      anon: async () => {
        const context = await browser.newContext(contextOptions({ viewport: DESKTOP }))
        await context.addCookies([{ name: LOCALE_COOKIE, value: 'zh', url: BASE }])
        return context
      },
    }

    /** One context per group, created on first use and reused across its shots. */
    const live = new Map()
    for (const shot of wanted) {
      if (!live.has(shot.group)) live.set(shot.group, await groups[shot.group]())
      await capture(await live.get(shot.group), shot, zone)
    }
    for (const context of live.values()) await context.close()
  } finally {
    await browser.close()
  }

  // ── report ──
  const failed = results.filter((entry) => entry.failed)
  const noisy = results.filter((entry) => !entry.failed && entry.errors.length > 0)
  const files = readdirSync(OUT).filter((name) => name.endsWith('.png'))

  // A shot that failed to capture would otherwise leave last run's PNG behind,
  // and a reviewer flipping through the folder could not tell the difference.
  // Skipped for a partial run: with `--only`, every shot not requested would
  // look stale and be deleted.
  if (!KEEP_STALE && ONLY.length === 0) {
    const captured = new Set(results.filter((entry) => entry.file).map((entry) => `${entry.id}.png`))
    for (const name of files) {
      if (captured.has(name)) continue
      rmSync(join(OUT, name))
      log(`  removed stale ${name}`)
    }
  }

  const remaining = readdirSync(OUT).filter((name) => name.endsWith('.png'))
  log('')
  log(`${results.length - failed.length}/${results.length} captured · ${remaining.length} png in ${OUT}`)
  for (const entry of noisy) {
    log(`console errors on ${entry.id}:`)
    for (const line of entry.errors) log(`  ${line}`)
  }
  for (const entry of failed) log(`FAILED ${entry.id} (${entry.path}): ${entry.failed}`)

  process.exit(failed.length > 0 || noisy.length > 0 ? 1 : 0)
}

try {
  await main()
} catch (error) {
  // `main` closes the browser in its own `finally`, so all that is left is to
  // report one line instead of a stack trace for what is usually an
  // environment problem (server down, wrong port, bad credentials).
  log(`\n${String(error?.message ?? error).split('\n')[0]}`)
  process.exit(1)
}
