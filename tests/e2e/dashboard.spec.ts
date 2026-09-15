import { expect, test, type Page } from '@playwright/test'
import { captureApiCalls, gotoConsole, moduleTitle, watchConsole } from './helpers'

/**
 * Dashboard (/dashboard).
 *
 * Everything on this page derives from a single `dashboard/stats/get` call for
 * the *selected time window*, so the tests are organised around that window and
 * around what the live server actually returns:
 *
 *  - The default window is **last hour**, and on an idle server that window is
 *    empty (`totalQueries === 0`). `TrendChart`/`DonutChart`/`RankList` all have
 *    an explicit "no data" branch, so a chart is *rendered* either as a recharts
 *    surface (when the window has traffic) or as its empty label (when it does
 *    not). The chart tests therefore switch to a wider window and tie the
 *    assertion to the "查询总数" counter: `total > 0` ⇒ a real SVG must be
 *    plotted, otherwise the empty label must show. This holds for any real
 *    server instead of baking in one server's traffic.
 *  - Stat counters such as `zones` / `cachedEntries` are current-state values
 *    independent of the window, so they are real numbers even in an empty
 *    window. `formatNumber` renders `—` only for a missing counter and can never
 *    produce `NaN`, so asserting every primary card matches `/^\d[\d,]*$/`
 *    proves the values came from the API and are neither NaN nor blank.
 *
 * SAFETY (production server):
 *  - Both destructive header actions ("清空缓存" and "清除统计数据") gate behind
 *    a `ConfirmDialog`. Each test opens the dialog, checks the copy, cancels,
 *    and then asserts that the corresponding endpoint was **never requested** —
 *    which is a stronger claim than "the test did not click it", because it also
 *    catches a dialog whose cancel button silently submits.
 *  - The cache flush shares its confirmation copy with the /cache page, so a
 *    reword on one side shows up as a failure on the other.
 */

/** The primary 4-column metric grid is the first `[data-slot="stat-grid"]`. */
function primaryGrid(page: Page) {
  return page.locator('[data-slot="stat-grid"]').first()
}

/** A `ChartCard` `<section>`, located by its `<h3>` title. */
function chartCard(page: Page, title: string) {
  return page.locator('[data-slot="chart-card"]').filter({ has: page.locator('h3', { hasText: title }) })
}

/** The large value `<span>` of the stat card whose label is exactly `label`. */
function statValue(page: Page, label: string) {
  return page
    .locator('[data-slot="stat-card"]')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('span.font-semibold')
    .first()
}

/** Parse a `zh-CN` grouped integer ("9,617") back to a number. */
function parseCount(text: string): number {
  return Number(text.replace(/[,，\s]/g, ''))
}

test.describe('dashboard', () => {
  test('the primary stat cards render real numeric values from the API', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dashboard')

    await expect(moduleTitle(page)).toHaveText('仪表盘')

    // Eight primary cards are always mounted (they show a skeleton while the
    // stats load), so the count is stable before the data arrives.
    const cards = primaryGrid(page).locator('[data-slot="stat-card"]')
    await expect(cards).toHaveCount(8, { timeout: 20_000 })

    // Wait for the load to finish, then every value must be a grouped integer —
    // never `NaN`, never `—`, never empty.
    const values = cards.locator('span.font-semibold')
    await expect(values.first()).toBeVisible({ timeout: 20_000 })
    expect(await values.count()).toBe(8)
    for (let i = 0; i < 8; i += 1) {
      const text = (await values.nth(i).innerText()).trim()
      expect(text, `primary card ${i} shows a real number`).toMatch(/^\d[\d,]*$/)
    }

    watcher.expectClean('dashboard stat cards')
  })

  test('switching the time range re-requests stats and updates the picker', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dashboard')

    const range = page.getByRole('combobox', { name: '时间范围' })
    await expect(range).toContainText('最近 1 小时') // default window

    // Applying a preset changes the query key, which must fire a fresh
    // `dashboard/stats/get` carrying the new `type`.
    const calls = await captureApiCalls(page, async () => {
      await range.click()
      await page.getByRole('option', { name: '最近 24 小时' }).click()
    })
    expect(
      calls.some((url) => url.includes('dashboard/stats/get') && url.includes('type=lastDay')),
      'stats are re-requested for the new window',
    ).toBe(true)

    // The trigger reflects the applied window and the "last updated" stamp shows
    // once a fetch has resolved.
    await expect(range).toContainText('最近 24 小时')
    await expect(page.getByText(/更新于/).first()).toBeVisible({ timeout: 20_000 })

    watcher.expectClean('dashboard range switch')
  })

  test('a custom range reaches the API as start/end and renders without an error', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dashboard')

    // Entering custom mode with an empty draft applies a default last-24h
    // window immediately. Upstream names the window edges `start` / `end` —
    // any other spelling answers "Parameter 'start' missing." and the whole
    // page falls into ErrorState, which is exactly what this test guards.
    const calls = await captureApiCalls(page, async () => {
      const range = page.getByRole('combobox', { name: '时间范围' })
      await range.click()
      await page.getByRole('option', { name: '自定义' }).click()
    })
    const custom = calls.find((url) => url.includes('dashboard/stats/get') && url.includes('type=custom'))
    expect(custom, 'the custom window requests stats').toBeDefined()
    expect(custom, 'range edges travel as start/end').toMatch(/start=.+&end=/)

    // A successful response renders the stat cards; a rejected one replaces
    // the content region with the red error state instead.
    await expect(primaryGrid(page).locator('span.font-semibold').first()).toBeVisible({ timeout: 20_000 })

    watcher.expectClean('custom range')
  })

  test('the trend chart, response donut and leaderboards render for a window with traffic', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dashboard')

    // Widen to a week so a real, actively-used server has traffic to plot. The
    // assertions below stay correct even if the window turns out to be empty.
    const range = page.getByRole('combobox', { name: '时间范围' })
    await range.click()
    await page.getByRole('option', { name: '最近 7 天' }).click()

    // Wait for the new window's stats to load (the cards flip back from their
    // skeleton), then read the authoritative query count.
    await expect(primaryGrid(page).locator('span.font-semibold').first()).toBeVisible({ timeout: 30_000 })
    const total = parseCount(await statValue(page, '查询总数').innerText())

    const trend = chartCard(page, '查询趋势')
    const response = chartCard(page, '响应结果分布')
    const topDomains = chartCard(page, '热门域名')
    const topClients = chartCard(page, '活跃客户端')

    if (total > 0) {
      // Trend: a recharts surface with at least one plotted area series.
      await expect(trend.locator('.recharts-surface')).toBeVisible({ timeout: 20_000 })
      expect(await trend.locator('.recharts-area').count(), 'trend plots its visible series').toBeGreaterThan(0)

      // Response-composition donut: a recharts pie is present.
      await expect(response.locator('.recharts-surface')).toBeVisible({ timeout: 20_000 })
      expect(await response.locator('.recharts-pie').count(), 'response donut is plotted').toBeGreaterThan(0)

      // Leaderboards: queries imply at least one client and one domain.
      expect(await topDomains.locator('ol li').count(), 'top domains has rows').toBeGreaterThan(0)
      expect(await topClients.locator('ol li').count(), 'top clients has rows').toBeGreaterThan(0)
    } else {
      // Empty window: each surface resolves to its explicit "no data" branch
      // rather than staying a skeleton or crashing.
      await expect(trend.getByText('所选范围内没有查询数据')).toBeVisible({ timeout: 20_000 })
      await expect(response.getByText('暂无数据')).toBeVisible({ timeout: 20_000 })
      await expect(topDomains.getByText('所选范围内没有查询记录')).toBeVisible({ timeout: 20_000 })
    }

    watcher.expectClean('dashboard charts and leaderboards')
  })

  test('both destructive actions gate behind a confirm dialog and cancel cleanly', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dashboard')

    // Recorded around the whole interaction so "cancelled" is proven by the
    // absence of a write request, not by the test's own restraint.
    const calls = await captureApiCalls(page, async () => {
      // The flush button used to fire `cache/flush` on a single click, with no
      // dialog, on the console's most-visited page. It must now confirm first.
      await page.getByRole('button', { name: '清空缓存' }).click()
      const flushConfirm = page.locator('[role="alertdialog"]')
      await expect(flushConfirm).toBeVisible()
      await expect(flushConfirm).toContainText('确定要清空全部解析器缓存吗')
      await flushConfirm.getByRole('button', { name: '取消' }).click()
      await expect(flushConfirm).toBeHidden()

      await page.getByRole('button', { name: '清除统计数据' }).click()
      const wipeConfirm = page.locator('[role="alertdialog"]')
      await expect(wipeConfirm).toBeVisible()
      await expect(wipeConfirm).toContainText('清除统计数据')
      await wipeConfirm.getByRole('button', { name: '取消' }).click()
      await expect(wipeConfirm).toBeHidden()
    })

    expect(calls.filter((url) => url.includes('cache/flush'))).toEqual([])
    expect(calls.filter((url) => url.includes('dashboard/stats/deleteAll'))).toEqual([])

    watcher.expectClean('dashboard destructive actions')
  })
})
