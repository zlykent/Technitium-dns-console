import { expect, test } from '@playwright/test'
import { captureApiCalls, gotoConsole, moduleTitle, watchConsole } from './helpers'

/**
 * Query logs (/logs) and system logs (/system-logs).
 *
 * The two routes share an endpoint prefix and a permission section but nothing
 * else, and the live server dictates what each can prove:
 *
 *  - **Whether a query-logging app is installed** decides the shape of `/logs`.
 *    With none, the page renders the guided `NoLoggingAppState` instead of the
 *    filter + table, probes `apps/list` and never fires a doomed `logs/query`.
 *    With one installed, the filter form and results table render and `logs/query`
 *    fires (read-only, therefore safe). The operator's server decides which, so
 *    the test branches on what actually appears rather than assuming a state.
 *  - **System log files exist** and `logs/list` returns `size` as a
 *    pre-formatted string (`57.79 KB`). The console re-parses and re-formats it
 *    through `formatBytes`, so the rendered cell is a one-decimal byte string.
 *
 * Safety: the preview dialog is opened and dismissed with Escape (the daily log
 * can be ~2.5 MB — v15.4 ignores `limit`, and the client tails to 256 KB, so we
 * assert the container rather than waiting on a full decode). The single-file
 * delete confirmation is opened and *cancelled*; "delete all" is never touched.
 */

test.describe('query logs adapt to whether a logging app is installed', () => {
  test('renders the guided no-app state or the filter + table, matching the server', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/logs')

    await expect(moduleTitle(page)).toHaveText('查询日志')

    // The page settles into one of two shapes depending on whether the server
    // has a query-logging app: the guided `NoLoggingAppState`, or the filter
    // form plus the results table. Which one is the operator's business, so
    // both are valid — the suite runs against whatever server it is pointed at.
    const noApp = page.locator('[data-slot="no-logging-app-state"]')
    const filterForm = page.locator('#query-logs-client')
    await Promise.race([
      noApp.waitFor({ state: 'visible', timeout: 20_000 }),
      filterForm.waitFor({ state: 'visible', timeout: 20_000 }),
    ])

    if (await noApp.isVisible()) {
      // No logging app: the guided empty state, not the red ErrorState — a
      // missing app is a setup condition the operator can act on, not a fault.
      await expect(noApp.getByText('尚未安装查询日志应用')).toBeVisible()

      // It points at /apps to install a logging app.
      const cta = noApp.locator('a[href="/apps"]')
      await expect(cta).toBeVisible()
      await expect(cta).toContainText('前往应用页面')

      // The filter form is suppressed in this state — there is no app to query.
      await expect(page.locator('#query-logs-client')).toHaveCount(0)
      await expect(page.locator('#query-logs-qname')).toHaveCount(0)

      // Refreshing re-probes apps but must not fire logs/query (which would only
      // earn a "DNS application was not found" the view would then hide).
      const calls = await captureApiCalls(page, async () => {
        await page.getByRole('button', { name: '刷新' }).click()
      })
      expect(calls.some((url) => url.includes('apps/list')), 'apps/list is probed').toBe(true)
      expect(calls.some((url) => url.includes('logs/query')), 'logs/query is not fired without an app').toBe(false)

      watcher.expectClean('query logs no-app')
    } else {
      // A logging app is installed: the filter form and the results table render,
      // and querying is read-only, so letting logs/query fire is safe.
      await expect(filterForm).toBeVisible()
      await expect(page.locator('#query-logs-qname')).toBeVisible()
      await expect(page.locator('[data-slot="data-table"]')).toBeVisible()

      const calls = await captureApiCalls(page, async () => {
        await page.getByRole('button', { name: '刷新' }).click()
      })
      expect(calls.some((url) => url.includes('logs/query')), 'logs/query fires once an app exists').toBe(true)

      // Row click opens the detail dialog. Entries the logging app never timed
      // arrive with no `responseRtt` at all, and the detail grid used to crash
      // on exactly those rows ("Cannot read properties of undefined (reading
      // 'trim')"), taking the whole route down. Open whichever row the server
      // has and demand the dialog — RTT line included — not the error boundary.
      const clickable = page.locator('[data-slot="data-table"] tbody tr.cursor-pointer')
      if ((await clickable.count()) > 0) {
        await clickable.first().click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible({ timeout: 20_000 })
        await expect(dialog.getByText('耗时', { exact: true })).toBeVisible()
        await dialog.getByRole('button', { name: '关闭' }).click()
        await expect(dialog).toHaveCount(0)
      }

      watcher.expectClean('query logs with app')
    }
  })
})

test.describe('system logs', () => {
  test('lists log files with formatted sizes and totals', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/system-logs')

    await expect(moduleTitle(page)).toHaveText('系统日志')

    const rows = page.locator('[data-slot="data-table"] tbody tr')
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    expect(await rows.count(), 'at least one log file is listed').toBeGreaterThan(0)

    // `size` reaches the console as a pre-formatted string and is re-rendered
    // through formatBytes, so the cell is a one-decimal byte value — never a raw
    // number and never blank.
    const sizeCell = rows.first().locator('.font-data').filter({ hasText: /\d+(?:\.\d+)?\s+(?:B|KB|MB|GB|TB)/ }).first()
    await expect(sizeCell).toBeVisible()

    // The footer carries the file count and the summed size.
    await expect(page.getByText(/共\s*\d+\s*个文件/).first()).toBeVisible()
    await expect(page.getByText(/合计\s*\d+(?:\.\d+)?\s+(?:B|KB|MB|GB|TB)/).first()).toBeVisible()

    watcher.expectClean('system logs list')
  })

  test('the preview dialog opens on the file name and closes on Escape', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/system-logs')

    const firstRow = page.locator('[data-slot="data-table"] tbody tr').first()
    await expect(firstRow).toBeVisible({ timeout: 20_000 })
    const fileName = (await firstRow.locator('td').first().innerText()).trim()
    expect(fileName, 'the row exposes a log file name').not.toBe('')

    await firstRow.getByRole('button', { name: '预览' }).click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    // Title is "日志预览 — <file>"; assert both parts without depending on the
    // exact em-dash spacing.
    await expect(dialog).toContainText('日志预览')
    await expect(dialog).toContainText(fileName)
    // The content region is present immediately (spinner / tail / empty all live
    // inside it) — we do not wait on the full download of a multi-MB file.
    await expect(dialog.locator('div.relative.min-h-40')).toBeVisible({ timeout: 30_000 })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    watcher.expectClean('log preview dialog')
  })

  test('the download button emits a download', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/system-logs')

    const firstRow = page.locator('[data-slot="data-table"] tbody tr').first()
    await expect(firstRow).toBeVisible({ timeout: 20_000 })

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      firstRow.getByRole('button', { name: '下载' }).click(),
    ])
    // `downloadLogFile` saves as `<fileName>.log`.
    expect(download.suggestedFilename()).toMatch(/\.log$/)

    watcher.expectClean('log download')
  })

  test('the single-file delete confirmation opens and can be cancelled', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/system-logs')

    const rows = page.locator('[data-slot="data-table"] tbody tr')
    const firstRow = rows.first()
    await expect(firstRow).toBeVisible({ timeout: 20_000 })
    const before = await rows.count()
    const fileName = (await firstRow.locator('td').first().innerText()).trim()

    // Delete lives in the row's overflow menu (canDelete only).
    await firstRow.getByRole('button', { name: '更多' }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()

    const confirm = page.locator('[role="alertdialog"]')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('确认删除')
    await expect(confirm).toContainText(fileName)

    // Cancel — the file must never be removed.
    await confirm.getByRole('button', { name: '取消' }).click()
    await expect(confirm).toBeHidden()
    await expect(rows).toHaveCount(before)

    watcher.expectClean('log delete cancelled')
  })
})
