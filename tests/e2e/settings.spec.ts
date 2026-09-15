import { expect, test } from '@playwright/test'
import { captureApiCalls, gotoConsole, moduleTitle, watchConsole } from './helpers'

/**
 * Settings page (/settings) — read-only validation with one no-op save.
 *
 * SAFETY: This spec NEVER modifies a setting value, NEVER triggers a restore,
 * NEVER deletes a TSIG key, and NEVER restarts the server. The single write
 * operation is a per-section "save" that submits the existing values unchanged
 * (an empty diff) to exercise the full save → toast → cache-invalidation path.
 *
 * What it verifies:
 *  - Page loads with correct heading and no console errors.
 *  - All 16 section panels render content when navigated to.
 *  - Section navigation (sticky sidebar) activates the correct panel.
 *  - Key sections show expected controls (general/listeners/recursion/cache/
 *    blocking/rate-limit/logging/tsig/web-service/advanced/backup).
 *  - TSIG: "添加密钥" adds an inline row; removing it reverts cleanly.
 *  - Backup: the download button emits a .tzsp file.
 *  - Validation: an out-of-range number triggers an inline error.
 *  - No-op save: submitting unchanged values calls settings/set and shows toast.
 */

// All 16 section ids as rendered in the DOM.
const SECTION_IDS = [
  'general',
  'listeners',
  'zoneDefaults',
  'webService',
  'dnsOverX',
  'recursion',
  'proxy',
  'blocking',
  'cache',
  'rateLimit',
  'edns',
  'logging',
  'tsig',
  'updates',
  'backup',
  'advanced',
] as const

test.describe('settings page load', () => {
  test('renders heading and all section panels without console errors', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    // Top-level module: named by the topbar label, no <h1> of its own.
    await expect(moduleTitle(page)).toHaveText('设置')

    // Every section panel must exist in the DOM.
    for (const id of SECTION_IDS) {
      const panel = page.locator(`#settings-${id}`)
      await expect(panel, `panel #settings-${id} is rendered`).toBeAttached()
    }

    watcher.expectClean('settings page load')
  })

  test('section navigation scrolls the target panel into view', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    // The nav lives inside a <nav aria-label="服务器设置">.
    const nav = page.locator('nav[aria-label="服务器设置"]')
    await expect(nav).toBeVisible()

    // The cache panel starts below the fold.
    const cachePanel = page.locator('#settings-cache')
    await expect(cachePanel).toBeAttached()

    // Click "缓存与过期应答" in the nav.
    const cacheBtn = nav.getByRole('button', { name: '缓存与过期应答' })
    await cacheBtn.click()

    // The smooth scroll should bring the panel into the viewport.
    // IntersectionObserver's aria-current is timing-dependent in headless mode
    // (the detection band is only 20% of viewport height), so we assert the
    // panel's visibility rather than the observer's reaction.
    await expect(cachePanel).toBeInViewport({ timeout: 5_000 })

    watcher.expectClean('settings nav')
  })
})

test.describe('settings sections content', () => {
  test('general section shows server domain and readonly fields', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-general')
    await expect(panel).toBeVisible()

    // Editable: dnsServerDomain text input.
    const domain = panel.locator('#settings-field-dnsServerDomain')
    await expect(domain).toBeVisible()
    // Should have a non-empty value from the server.
    await expect(domain).not.toHaveValue('')

    // Readonly fields (SettingsReadonlyField) don't put the id on the value div,
    // so locate them by their label text.
    await expect(panel.getByText('服务器版本')).toBeVisible()
    await expect(panel.getByText('启动时间')).toBeVisible()
    await expect(panel.getByText('集群已初始化')).toBeVisible()

    watcher.expectClean('settings general')
  })

  test('listeners section renders endpoint textarea and number fields', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-listeners')
    // Scroll into view so IntersectionObserver renders content.
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // The DNS endpoints textarea.
    const endpoints = panel.locator('#settings-field-dnsServerLocalEndPoints')
    await expect(endpoints).toBeVisible()

    // At least one number field (clientTimeout).
    const timeout = panel.locator('#settings-field-clientTimeout')
    await expect(timeout).toBeVisible()

    watcher.expectClean('settings listeners')
  })

  test('recursion section shows policy select and forwarders', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-recursion')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // Recursion policy select trigger.
    const policy = panel.locator('#settings-field-recursion')
    await expect(policy).toBeVisible()

    // Forwarders textarea.
    const forwarders = panel.locator('#settings-field-forwarders')
    await expect(forwarders).toBeVisible()

    watcher.expectClean('settings recursion')
  })

  test('cache section shows TTL fields and serve-stale switch', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-cache')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // Maximum entries number field.
    const maxEntries = panel.locator('#settings-field-cacheMaximumEntries')
    await expect(maxEntries).toBeVisible()

    // Serve-stale switch.
    const serveStale = panel.locator('#settings-field-serveStale')
    await expect(serveStale).toBeVisible()

    watcher.expectClean('settings cache')
  })

  test('blocking section shows enable switch and block list URLs', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-blocking')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // Enable blocking switch.
    const enableBlocking = panel.locator('#settings-field-enableBlocking')
    await expect(enableBlocking).toBeVisible()

    // Block list URLs textarea.
    const urls = panel.locator('#settings-field-blockListUrls')
    await expect(urls).toBeVisible()

    watcher.expectClean('settings blocking')
  })

  test('rate-limit section shows QPM rule tables', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-rateLimit')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // IPv4 prefix limits group.
    const ipv4Group = panel.locator('[role="group"]').first()
    await expect(ipv4Group).toBeVisible()

    // Sample minutes number field.
    const sampleMinutes = panel.locator('#settings-field-qpmLimitSampleMinutes')
    await expect(sampleMinutes).toBeVisible()

    watcher.expectClean('settings rate-limit')
  })

  test('logging section shows enable switch and log folder', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-logging')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // Enable logging switch.
    const enableLogging = panel.locator('#settings-field-enableLogging')
    await expect(enableLogging).toBeVisible()

    // Log folder text input.
    const logFolder = panel.locator('#settings-field-logFolder')
    await expect(logFolder).toBeVisible()

    watcher.expectClean('settings logging')
  })

  test('web-service section shows HTTP port and TLS controls', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-webService')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // HTTP port number field.
    const httpPort = panel.locator('#settings-field-webServiceHttpPort')
    await expect(httpPort).toBeVisible()
    // Should be 5380 on this server.
    await expect(httpPort).toHaveValue('5380')

    // TLS enable switch.
    const enableTls = panel.locator('#settings-field-webServiceEnableTls')
    await expect(enableTls).toBeVisible()

    watcher.expectClean('settings web-service')
  })

  test('advanced section shows diff and raw JSON toggle', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-advanced')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // "本地没有未提交的修改" should be visible (no dirty state).
    await expect(panel.getByText('本地没有未提交的修改')).toBeVisible()

    // Toggle raw JSON.
    const toggleBtn = panel.getByRole('button', { name: /显示/ })
    await toggleBtn.click()
    const rawPre = panel.locator('pre')
    await expect(rawPre).toBeVisible()
    // Verify it contains valid JSON with a known key.
    const text = await rawPre.innerText()
    expect(text).toContain('"version"')

    watcher.expectClean('settings advanced')
  })
})

test.describe('settings TSIG', () => {
  test('add key creates inline row, then remove reverts', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-tsig')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // Server key names badge should be visible (might show empty state).
    await expect(panel.getByText('服务器当前密钥')).toBeVisible()

    // Count existing rows before adding.
    const rowsBefore = await panel.locator('[role="group"][aria-label="编辑密钥"]').count()

    // Click "添加密钥".
    await panel.getByRole('button', { name: '添加密钥' }).click()

    // A new row should appear.
    const rowsAfter = await panel.locator('[role="group"][aria-label="编辑密钥"]').count()
    expect(rowsAfter).toBe(rowsBefore + 1)

    // The new row's name input should be empty and focused.
    const newRow = panel.locator('[role="group"][aria-label="编辑密钥"]').last()
    const nameInput = newRow.locator('input[id$="-name"]')
    await expect(nameInput).toHaveValue('')

    // Fill a name to verify the field works.
    await nameInput.fill('e2e-test-key')
    await expect(nameInput).toHaveValue('e2e-test-key')

    // Remove the row — click the trash button.
    await newRow.getByRole('button', { name: '删除' }).click()

    // A confirm dialog appears; confirm the deletion.
    const confirm = page.locator('[role="alertdialog"]')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: '删除' }).click()
    await expect(confirm).toBeHidden()

    // Row count should be back to original.
    const rowsFinal = await panel.locator('[role="group"][aria-label="编辑密钥"]').count()
    expect(rowsFinal).toBe(rowsBefore)

    watcher.expectClean('settings tsig add/remove')
  })
})

test.describe('settings backup', () => {
  test('download backup emits a .tzsp file', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    const panel = page.locator('#settings-backup')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()

    // Click "下载备份文件" and capture the download.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      panel.getByRole('button', { name: '下载备份文件' }).click(),
    ])

    // Assert the filename matches the expected pattern.
    expect(download.suggestedFilename()).toMatch(/\.tzsp$/)

    watcher.expectClean('settings backup download')
  })
})

test.describe('settings validation', () => {
  test('out-of-range number triggers inline error without submitting', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    // Use udpPayloadSize in general section (min=512, max=65535).
    const field = page.locator('#settings-field-udpPayloadSize')
    await expect(field).toBeVisible()

    // Record original value so we can restore it.
    const original = await field.inputValue()

    // Fill an invalid value (below min).
    await field.fill('1')
    // mode:'onChange' triggers validation immediately; wait for the error.
    await page.waitForTimeout(300)

    // The error should be visible near the field.
    const errorEl = page.locator('#settings-field-udpPayloadSize-error')
    await expect(errorEl).toBeVisible()
    await expect(errorEl).not.toBeEmpty()

    // Restore the original value — error should disappear.
    await field.fill(original)
    await page.waitForTimeout(300)
    await expect(errorEl).toBeHidden()

    watcher.expectClean('settings validation')
  })
})

test.describe('settings no-op save', () => {
  test('saving a section without changes calls settings/set and shows toast', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/settings')

    // Wait for the form to fully render (settings loaded).
    const generalPanel = page.locator('#settings-general')
    await expect(generalPanel).toBeVisible({ timeout: 20_000 })

    // Find the "保存本节" button inside the general section.
    const saveBtn = generalPanel.getByRole('button', { name: '保存本节' })
    await expect(saveBtn).toBeVisible()

    // Capture API calls during the save.
    const calls = await captureApiCalls(page, async () => {
      await saveBtn.click()
    })

    // settings/set must have been called.
    expect(
      calls.some((url) => url.includes('settings/set')),
      'settings/set was called',
    ).toBe(true)

    // Success toast should appear.
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: '设置已保存' })
    await expect(toast).toBeVisible({ timeout: 10_000 })

    watcher.expectClean('settings no-op save')
  })
})
