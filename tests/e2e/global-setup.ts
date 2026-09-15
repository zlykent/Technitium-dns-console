import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { E2E } from './env'
import { gotoLogin } from './helpers'
import { LOCALE_COOKIE } from '../../lib/i18n/config'

/**
 * Authenticate once, reuse everywhere.
 *
 * The session token lives in an httpOnly cookie set by the proxy, and the
 * server profile list lives in localStorage — `storageState` captures both, so
 * every spec starts already signed in instead of paying for a login round trip
 * against a real DNS server on each of ~90 tests.
 *
 * The locale cookie is pinned here for the same reason the app pins it: with no
 * cookie the first visit negotiates from `Accept-Language`, and a suite that
 * asserts on rendered text must not depend on the runner's language.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  mkdirSync(dirname(E2E.storageState), { recursive: true })

  const browser = await chromium.launch()
  // A context built here does not inherit `use.baseURL` from the config, so the
  // relative `page.goto('/login')` below needs it set explicitly.
  const context = await browser.newContext({ baseURL: E2E.baseUrl, locale: 'zh-CN' })

  await context.addCookies([{ name: LOCALE_COOKIE, value: 'zh', url: E2E.baseUrl }])

  const page = await context.newPage()
  try {
    await gotoLogin(page)
    await page.locator('#server').fill(E2E.dnsUrl)
    await page.locator('#username').fill(E2E.user)
    await page.locator('#password').fill(E2E.pass)
    await page.locator('button[type="submit"]').click()

    // A failed login stays on /login with an ErrorState; waiting for the URL to
    // change turns that into a clear setup failure instead of 90 confusing ones.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

    await context.storageState({ path: E2E.storageState })
  } finally {
    await browser.close()
  }
}
