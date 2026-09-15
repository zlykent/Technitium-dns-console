import { expect, test } from '@playwright/test'
import { captureApiCalls, gotoConsole, moduleTitle, watchConsole } from './helpers'

/**
 * DNS Client — resolve tool, bulk resolve, history, and raw response viewer.
 *
 * SAFETY: This spec only reads. The "import" toggle is exercised, but only up
 * to its confirmation dialog — which is cancelled, and the absence of any
 * `import=true` request is then asserted. That matters because an import does
 * not merely add a record: with no matching zone the server creates a whole new
 * primary one. All queries are against the local authoritative record
 * `zly.wskj` or well-known public domains that cannot mutate state.
 *
 * CONSTRAINTS:
 *  - DNS resolution is a real network operation; generous timeouts are used.
 *  - The spec asserts outcomes that hold for both "resolved successfully" and
 *    "upstream refused/timed out" wherever possible, but `zly.wskj` is a local
 *    authoritative record that MUST succeed.
 *  - The bulk panel resolves sequentially against the real server.
 */

test.describe('DNS Client — single resolve', () => {
  test('resolves zly.wskj A and shows 192.168.3.2 in .font-data', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/resolve')

    await expect(moduleTitle(page)).toHaveText('DNS 客户端')

    // Fill in the domain — server defaults to "this-server", type to "A".
    const domainInput = page.locator('#resolve-domain')
    await expect(domainInput).toBeVisible({ timeout: 10_000 })
    await domainInput.fill('zly.wskj')

    // Submit the query. Use exact match to avoid colliding with "开始批量解析".
    const submitBtn = page.getByRole('button', { name: '解析', exact: true })
    await submitBtn.click()

    // Wait for the result to render — the answer section should show the IP.
    // This is an authoritative local record so it MUST succeed.
    const answerCell = page.locator('.font-data', { hasText: '192.168.3.2' })
    await expect(answerCell.first()).toBeVisible({ timeout: 30_000 })

    watcher.expectClean('/resolve zly.wskj A')
  })

  test('switching record type to SOA and resolving produces a result', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/resolve')

    // Fill domain.
    await page.locator('#resolve-domain').fill('wskj')

    // Switch record type to SOA via Radix Select.
    const typeTrigger = page.locator('#resolve-type')
    await typeTrigger.click()
    await page.getByRole('option', { name: 'SOA' }).click()

    // Submit (exact match to avoid the bulk resolve button).
    await page.getByRole('button', { name: '解析', exact: true }).click()

    // The result section should appear (either an answer or a "no answer" state).
    // For SOA on an existing zone, we expect actual answer records.
    const resultSection = page.locator('text=解析结果').first()
    await expect(resultSection).toBeVisible({ timeout: 30_000 })

    // Wait for the response to finish loading (skeleton disappears).
    const skeleton = page.locator('[role="status"]')
    await expect(skeleton).not.toBeVisible({ timeout: 30_000 })

    // The RCODE badge should be visible (NOERROR for an existing zone).
    const rcodeBadge = page.locator('.font-data', { hasText: /NOERROR|NXDOMAIN|SERVFAIL/ })
    await expect(rcodeBadge.first()).toBeVisible({ timeout: 15_000 })

    watcher.expectClean('/resolve SOA')
  })

  test('specifying a custom DNS server and protocol is sent in the API request', async ({ page }) => {
    await gotoConsole(page, '/resolve')

    // Switch the resolver picker to "Custom".
    const serverTrigger = page.locator('#resolve-server')
    await serverTrigger.click()
    await page.getByRole('option', { name: /自定义/ }).click()

    // Fill the custom server address.
    const customInput = page.locator('#resolve-server-custom')
    await expect(customInput).toBeVisible()
    await customInput.fill('8.8.8.8')

    // Switch protocol to TCP.
    const protocolTrigger = page.locator('#resolve-protocol')
    await protocolTrigger.click()
    await page.getByRole('option', { name: 'TCP' }).click()

    // Fill domain.
    await page.locator('#resolve-domain').fill('example.com')

    // Capture API calls when submitting.
    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '解析', exact: true }).click()
      // Wait a bit for the request to fire.
      await page.waitForTimeout(2_000)
    })

    // Verify the request was made with our parameters.
    const resolveCall = calls.find((url) => url.includes('dnsClient/resolve'))
    expect(resolveCall, 'a resolve API call was made').toBeDefined()

    const url = new URL(resolveCall!)
    expect(url.searchParams.get('server')).toBe('8.8.8.8')
    expect(url.searchParams.get('protocol')).toBe('TCP')
    expect(url.searchParams.get('domain')).toBe('example.com')
    expect(url.searchParams.get('type')).toBe('A')
  })

  test('raw response viewer can be expanded after a successful resolve', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/resolve')

    // Resolve a local authoritative record.
    await page.locator('#resolve-domain').fill('zly.wskj')
    await page.getByRole('button', { name: '解析', exact: true }).click()

    // Wait for result.
    const answerCell = page.locator('.font-data', { hasText: '192.168.3.2' })
    await expect(answerCell.first()).toBeVisible({ timeout: 30_000 })

    // The raw response viewer should be present. It's a Collapsible.
    // It may show "没有原始报文数据" if rawResponses is empty, or a trigger button.
    const rawSection = page.locator('text=原始应答').first()
    const rawEmpty = page.locator('text=没有原始报文数据').first()

    // One of the two should be visible.
    const hasRawTrigger = await rawSection.isVisible().catch(() => false)
    const hasRawEmpty = await rawEmpty.isVisible().catch(() => false)

    if (hasRawTrigger) {
      // Click to expand the collapsible.
      await rawSection.click()
      // The expanded content should show the raw message hint.
      await expect(page.locator('text=服务器返回的完整报文文本')).toBeVisible({ timeout: 5_000 })
    } else {
      // rawResponses was empty — that is a valid server response.
      expect(hasRawEmpty).toBe(true)
    }

    watcher.expectClean('/resolve raw viewer')
  })
})

test.describe('DNS Client — bulk resolve', () => {
  test('bulk resolve accepts multiple domains and produces results', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/resolve')

    // Scroll to / locate the bulk resolve section.
    const bulkSection = page.locator('[data-slot="bulk-resolve"]')
    await expect(bulkSection).toBeVisible({ timeout: 10_000 })

    // Fill the textarea with two local domains.
    const textarea = bulkSection.locator('#bulk-domains')
    await textarea.fill('zly.wskj\nwskj')

    // Submit bulk resolve.
    const bulkSubmit = bulkSection.getByRole('button', { name: '开始批量解析' })
    await bulkSubmit.click()

    // Wait for results — the DataTable inside bulk section should show rows.
    // Bulk resolves sequentially, so 2 domains may take a few seconds.
    const resultTable = bulkSection.locator('[data-slot="data-table"] table')
    await expect(resultTable).toBeVisible({ timeout: 60_000 })

    // At least one row should show "zly.wskj".
    const rows = resultTable.locator('tbody tr')
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThanOrEqual(1)

    // The first domain should appear in the results.
    await expect(resultTable.locator('tbody').first()).toContainText('zly.wskj', { timeout: 15_000 })

    watcher.expectClean('/resolve bulk')
  })
})

test.describe('DNS Client — import gate', () => {
  test('the import toggle warns, and the write is gated behind a dialog that cancels', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/resolve')

    // Resolve first, with the toggle still off, so nothing in this test can send
    // `import=true`: the flag rides on the *same* request as an ordinary query.
    await page.locator('#resolve-domain').fill('zly.wskj')
    await page.getByRole('button', { name: '解析', exact: true }).click()
    await expect(page.locator('.font-data', { hasText: '192.168.3.2' }).first()).toBeVisible({ timeout: 30_000 })

    // Turning the toggle on must explain the real consequence. `dnsClient/resolve`
    // takes no zone parameter, so a "target zone" control would be a lie — and
    // one used to be rendered here, as a label with no input behind it.
    await page.locator('#resolve-import').click()
    await expect(page.getByText('服务器会为该域名新建一个主区域')).toBeVisible()
    await expect(page.getByText('目标区域')).toHaveCount(0)

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '添加为区域记录' }).click()

      const confirm = page.locator('[role="alertdialog"]')
      await expect(confirm).toBeVisible()
      // The dialog names the domain it is about to write, which is the whole
      // point of gating: the operator sees what zone may appear.
      await expect(confirm).toContainText('zly.wskj')
      await confirm.getByRole('button', { name: '取消' }).click()
      await expect(confirm).toBeHidden()
    })

    expect(calls.filter((url) => url.includes('import=true'))).toEqual([])

    watcher.expectClean('/resolve import gate')
  })
})

test.describe('DNS Client — history', () => {
  test('history panel records a completed resolve', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/resolve')

    // The history panel should exist.
    const historyPanel = page.locator('[data-slot="history-panel"]')
    await expect(historyPanel).toBeVisible({ timeout: 10_000 })

    // Initially it may show "还没有查询记录" or entries from a previous session.
    // Perform a resolve to guarantee at least one entry.
    await page.locator('#resolve-domain').fill('zly.wskj')
    await page.getByRole('button', { name: '解析', exact: true }).click()

    // Wait for the result.
    const answerCell = page.locator('.font-data', { hasText: '192.168.3.2' })
    await expect(answerCell.first()).toBeVisible({ timeout: 30_000 })

    // The history panel should now contain an entry with our domain.
    await expect(historyPanel).toContainText('zly.wskj', { timeout: 10_000 })

    // It should also show the record type badge.
    await expect(historyPanel.locator('text=A').first()).toBeVisible()

    watcher.expectClean('/resolve history')
  })
})
