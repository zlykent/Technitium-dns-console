import { expect, test } from '@playwright/test'
import { escapeRegExp, gotoConsole, moduleTitle, navigateBySidebar, pageHeading, sidebar, sidebarLink, watchConsole } from './helpers'

/**
 * Every route renders, and renders cleanly.
 *
 * This is the widest net in the suite: it walks all thirteen top-level routes
 * plus the four per-zone ones and asserts that each renders and is named —
 * top-level modules by the topbar label, zone sub-pages by their own heading —
 * that the sidebar agrees about where the visitor is, and that nothing was
 * thrown along the way. A page that 200s but crashes during render — a shape
 * mismatch with the upstream, a missing translation key — fails here and
 * nowhere else, because the later specs assume the surface they test is alive.
 */

const TOP_LEVEL = [
  '/dashboard',
  '/zones',
  '/resolve',
  '/cache',
  '/allowed',
  '/blocked',
  '/logs',
  '/system-logs',
  '/dhcp',
  '/apps',
  '/settings',
  '/admin',
  '/account',
] as const

test.describe('route smoke', () => {
  for (const path of TOP_LEVEL) {
    test(`${path} renders its heading without console errors`, async ({ page }) => {
      const watcher = watchConsole(page)
      await gotoConsole(page, path)

      await expect(moduleTitle(page)).toBeVisible()
      // A label that is present but empty means a translation key resolved to
      // nothing, which is exactly the failure this pass exists to catch.
      await expect(moduleTitle(page)).not.toHaveText(/^\s*$/)
      await expect(moduleTitle(page)).not.toContainText('MISSING_MESSAGE')

      watcher.expectClean(path)
    })
  }

  test('per-zone routes render for a real zone', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/zones')

    // Discover the zone instead of hardcoding one: the suite runs against
    // whatever server the operator points it at.
    const firstZone = page.locator('[data-slot="page-shell"] table tbody tr a[href^="/zones/"]').first()
    await expect(firstZone).toBeVisible({ timeout: 20_000 })
    const href = await firstZone.getAttribute('href')
    expect(href, 'zone row links to the zone detail route').toMatch(/^\/zones\/[^/]+$/)
    const zone = decodeURIComponent(href!.replace('/zones/', ''))

    for (const suffix of ['', '/dnssec', '/options', '/permissions']) {
      await gotoConsole(page, `/zones/${encodeURIComponent(zone)}${suffix}`)
      await expect(pageHeading(page)).toBeVisible()
      await expect(pageHeading(page)).not.toContainText('MISSING_MESSAGE')
    }

    watcher.expectClean('zone routes')
  })
})

test.describe('sidebar navigation', () => {
  test('every visible nav entry reaches its route and marks itself current', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dashboard')

    const links = sidebar(page).locator('nav[aria-label] a[href^="/"]')
    const count = await links.count()
    // Twelve modules are visible to an administrator; `account` is hidden from
    // the sidebar and reached through the user menu instead.
    expect(count, 'sidebar exposes the console modules').toBe(12)

    const hrefs: string[] = []
    for (let index = 0; index < count; index += 1) {
      const href = await links.nth(index).getAttribute('href')
      if (href) hrefs.push(href)
    }
    expect(new Set(hrefs).size, 'no duplicate nav targets').toBe(hrefs.length)

    for (const href of hrefs) {
      await sidebarLink(page, href).click()
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}(/|$|\\?)`))
      await expect(moduleTitle(page)).toBeVisible()
      // Exactly one entry may claim the current route.
      await expect(sidebarLink(page, href)).toHaveAttribute('aria-current', 'page')
      await expect(sidebar(page).locator('a[aria-current="page"]')).toHaveCount(1)
    }

    watcher.expectClean('sidebar walk')
  })

  test('collapsing the sidebar keeps the links reachable', async ({ page }) => {
    await gotoConsole(page, '/dashboard')

    const rail = sidebar(page)
    // The collapse toggle is the only <button> in the sidebar: nav entries are
    // links and the brand block is static, so no label lookup is needed.
    const collapse = rail.locator('button')
    await expect(collapse).toHaveCount(1)
    await expect(rail).not.toHaveAttribute('data-collapsed')

    await collapse.click()
    await expect(rail).toHaveAttribute('data-collapsed', 'true')
    // Icon-only rail: the links must still be there, just without their labels.
    await expect(sidebarLink(page, '/zones')).toBeVisible()
    await expect(sidebarLink(page, '/zones')).toHaveAttribute('href', '/zones')

    await collapse.click()
    await expect(rail).not.toHaveAttribute('data-collapsed')
    await expect(sidebarLink(page, '/zones')).toBeVisible()
  })

  test('navigating by sidebar from a deep route returns to the module root', async ({ page }) => {
    await gotoConsole(page, '/zones')
    const firstZone = page.locator('[data-slot="page-shell"] table tbody tr a[href^="/zones/"]').first()
    await expect(firstZone).toBeVisible({ timeout: 20_000 })
    await firstZone.click()
    await expect(pageHeading(page)).toBeVisible()

    await navigateBySidebar(page, '/zones')
    await expect(page).toHaveURL(/\/zones$/)
  })
})

test.describe('unreachable routes', () => {
  test('an unknown path renders the 404 page', async ({ page }) => {
    await page.goto('/definitely-not-a-route')
    await expect(page.locator('text=404').first()).toBeVisible()
    await expect(page.locator('a[href="/dashboard"]')).toBeVisible()
  })
})
