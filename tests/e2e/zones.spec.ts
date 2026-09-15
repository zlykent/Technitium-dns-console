import { expect, test, type Locator, type Page } from '@playwright/test'
import { E2E, E2E_PREFIX, scratchZone } from './env'
import { captureApiCalls, escapeRegExp, gotoConsole, moduleTitle, pageHeading, watchConsole } from './helpers'

/**
 * Zone inventory, zone lifecycle, and the two per-zone configuration pages.
 *
 * What this file guards:
 *
 *  - The list is a faithful read of `zones/list`: the column set and order, one
 *    badge per row out of the known label sets, and a footer total that agrees
 *    with the server's own count. The strongest assertion compares the rendered
 *    zone names against a direct `zones/list` call, because a table that draws
 *    *something* plausible is exactly the failure mode a screenshot cannot show.
 *  - Every filter is a query parameter, never a client-side `.filter()`. The
 *    server paginates, so filtering in the browser would silently narrow only
 *    the page it happens to hold — identical on screen until the inventory
 *    outgrows 25 rows.
 *  - An empty table under a filter says "没有匹配的结果", not "还没有任何区域"
 *    (`DataTableProps.filterActive`). The second invites the operator to create
 *    a duplicate of the zone they were looking for.
 *  - The create dialog validates in the browser *before* spending a round trip,
 *    including the two type-dependent rules (primary name servers, forwarder).
 *  - Each write affordance reaches the server and reports back through a toast:
 *    enable/disable, export, options save, permissions save, delete.
 *
 * Constraints that are not visible from the tests themselves:
 *
 *  - This runs against a live DNS server that also holds zones nobody asked the
 *    suite to touch. Every mutation therefore targets `SCRATCH`, and every
 *    inventory assertion reads names off the page or off the API rather than
 *    hardcoding them, so the file stays valid on any server.
 *  - `workers: 1` + `fullyParallel: false` make `test.describe.serial` a real
 *    guarantee: the zone created here is the one later tests toggle, export,
 *    reconfigure and finally delete.
 *  - `globalTeardown` skips its sweep when `E2E_SKIP_TEARDOWN=1` — the
 *    documented way to iterate on one spec — so `afterAll` deletes the scratch
 *    zone over the Technitium API instead of trusting the last UI test to run.
 */

/** The only zone this file is allowed to write to. */
const SCRATCH = scratchZone()

/** Everything this file created and has not deleted yet; swept in `afterAll`. */
const created: string[] = []

/** Zone table headers, in render order. Column 0 is the selection checkbox. */
const COLUMNS = ['区域名', '类型', '状态', 'SOA 序列号', 'DNSSEC', '最后修改', '所属目录区域', '操作']

/** `zones:types.*.label` for the seven entries of `ZONE_TYPES`. */
const TYPE_LABELS = ['主要区域', '辅助区域', '存根区域', '转发区域', '辅助转发区域', '目录区域', '辅助目录区域']

/** `zones:list.dnssecStatus.*`. */
const DNSSEC_LABELS = ['未签名', '已签名', '待签名', '已停用']

/** Every label `zoneStatus()` can produce, i.e. the whole status vocabulary. */
const STATUS_LABELS = ['启用中', '已禁用', '已过期', '同步失败', '校验失败', '通知失败']

/** Rows that carry a zone (excludes the empty/no-result placeholder row). */
function zoneRows(page: Page): Locator {
  return page.locator('[data-slot="page-shell"] table tbody tr:has(a[href^="/zones/"])')
}

/** The one row belonging to `zone`, addressed by its detail-route href. */
function zoneRow(page: Page, zone: string): Locator {
  return zoneRows(page).filter({ has: page.locator(`a[href="/zones/${encodeURIComponent(zone)}"]`) })
}

/** The zone-name search box. Its `aria-label` is the placeholder itself. */
function zoneSearch(page: Page): Locator {
  return page.getByLabel('按区域名搜索…')
}

/** The per-row `DropdownMenu` trigger. */
function rowMenuTrigger(page: Page, zone: string): Locator {
  return zoneRow(page, zone).getByRole('button', { name: '更多' })
}

async function openRowMenu(page: Page, zone: string): Promise<void> {
  await rowMenuTrigger(page, zone).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

/** A sonner toast. `.first()` because successes stack over the run. */
function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).first()
}

/**
 * Arm a wait for the `zones/list` round trip a filter change triggers.
 *
 * The promise has to exist *before* the keystroke: `captureApiCalls` settles on
 * `networkidle`, which resolves immediately when the network is already quiet —
 * i.e. before the search box's 250 ms debounce has even fired.
 */
function nextZoneList(page: Page) {
  return page.waitForResponse((response) => response.url().includes('/api/dns/zones/list'), { timeout: 20_000 })
}

/** Land on the list narrowed to one zone, waiting for its row to be the only one. */
async function findZone(page: Page, zone: string): Promise<void> {
  await gotoConsole(page, '/zones')
  await zoneSearch(page).fill(zone)
  await expect(zoneRow(page, zone)).toBeVisible({ timeout: 20_000 })
}

test.describe.serial('zones', () => {
  test.afterAll(async () => {
    // The `E2E_PREFIX` guard means a bug in this file can never reach a zone the
    // operator created by hand.
    const leftovers = created.filter((zone) => zone.startsWith(E2E_PREFIX))
    created.length = 0
    if (leftovers.length === 0) return

    const token = await apiToken()
    if (!token) return
    for (const zone of leftovers) await deleteZone(token, zone)
  })

  test('the list mirrors what the server reports, column by column', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/zones')

    await expect(moduleTitle(page)).toHaveText('区域')

    const headers = page.locator('[data-slot="page-shell"] table thead th')
    await expect(headers).toHaveCount(COLUMNS.length + 1)
    for (const [index, column] of COLUMNS.entries()) {
      // `toContainText` rather than `toHaveText`: sortable headers append a
      // screen-reader-only "排序依据" to their own text content.
      await expect(headers.nth(index + 1)).toContainText(column)
    }

    const list = zoneRows(page)
    await expect(list.first()).toBeVisible({ timeout: 20_000 })
    const rowCount = await list.count()

    for (let index = 0; index < rowCount; index += 1) {
      const cells = list.nth(index).locator('td')
      const href = await cells.nth(1).locator('a').getAttribute('href')
      expect(href, 'every row links to its own detail route').toMatch(/^\/zones\/[^/]+$/)
      expect(TYPE_LABELS, 'type badge is a known label').toContain((await cells.nth(2).innerText()).trim())
      expect(STATUS_LABELS, 'status is a known label').toContain((await cells.nth(3).innerText()).trim())
      expect((await cells.nth(4).innerText()).trim(), 'SOA serial is numeric').toMatch(/^\d+$/)
      expect(DNSSEC_LABELS, 'DNSSEC badge is a known label').toContain((await cells.nth(5).innerText()).trim())
      await expect(cells.nth(8).getByRole('button', { name: '更多' })).toHaveCount(1)
    }

    const note = page.getByText(/^共 \d+ 个区域$/)
    await expect(note).toBeVisible()
    const total = Number(((await note.textContent()) ?? '').match(/\d+/)?.[0])
    expect(total, 'the footer total is a real count').toBeGreaterThanOrEqual(rowCount)

    // `zones/list` paginates at 25 per page, so the page only equals the whole
    // inventory while that inventory fits on one page.
    if (total <= 25) {
      expect(rowCount, 'one page holds the whole inventory').toBe(total)

      const hrefs = await list.locator('a[href^="/zones/"]').evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
      const rendered = hrefs.map((href) => decodeURIComponent(href.replace('/zones/', ''))).sort()
      const token = await apiToken()
      expect(token, 'the suite can reach the DNS server directly').not.toBeNull()
      expect(rendered, 'the table draws exactly the zones the server has').toEqual((await serverZoneNames(token!)).sort())
    }

    watcher.expectClean('/zones')
  })

  test('searching narrows the list, and a miss is reported as a miss', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/zones')

    // Derive the needle from the page instead of a fixture zone name: the suite
    // runs against whatever server the operator points it at.
    const firstHref = await zoneRows(page).first().locator('a[href^="/zones/"]').getAttribute('href')
    const firstZone = decodeURIComponent((firstHref ?? '').replace('/zones/', ''))
    const needle = firstZone.split('.')[0]
    expect(needle.length, 'a zone name has a usable first label').toBeGreaterThan(0)

    const hitCalls = await captureApiCalls(page, async () => {
      const inflight = nextZoneList(page)
      await zoneSearch(page).fill(needle)
      await inflight
    })
    expect(
      hitCalls.some((url) => url.includes('/zones/list') && url.includes(`filterName=${needle}`)),
      'the keyword travels to the server rather than filtering the current page',
    ).toBe(true)
    await expect(zoneRows(page).first()).toBeVisible()
    const hits = await zoneRows(page).evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('a[href^="/zones/"]')?.textContent ?? ''),
    )
    expect(hits.length, 'at least the zone the needle came from matches').toBeGreaterThan(0)
    for (const name of hits) expect(name.toLowerCase(), 'every hit contains the needle').toContain(needle.toLowerCase())

    const miss = 'zz-no-such-zone-anywhere'
    const missCalls = await captureApiCalls(page, async () => {
      const inflight = nextZoneList(page)
      await zoneSearch(page).fill(miss)
      await inflight
    })
    expect(
      missCalls.some((url) => url.includes(`filterName=${miss}`)),
      'a miss is a server answer, not a client-side empty list',
    ).toBe(true)
    await expect(zoneRows(page)).toHaveCount(0)
    await expect(page.getByText('没有匹配的结果')).toBeVisible()
    // Saying "no zones exist" over a search that simply had no hits would offer
    // to create a duplicate of the very zone being looked for.
    await expect(page.getByText('还没有任何区域')).toHaveCount(0)

    // Clearing lands back on the unfiltered key, which the query client still
    // holds fresh — so the rows returning is the assertion, not a round trip.
    await zoneSearch(page).fill('')
    await expect(zoneRows(page).first()).toBeVisible()

    watcher.expectClean('zone search')
  })

  test('the type filter is a server parameter and only admits that type', async ({ page }) => {
    await gotoConsole(page, '/zones')
    const trigger = page.getByRole('combobox', { name: '全部类型', exact: true })

    const calls = await captureApiCalls(page, async () => {
      const inflight = nextZoneList(page)
      await trigger.click()
      await page.getByRole('option', { name: '主要区域', exact: true }).click()
      await inflight
    })
    expect(
      calls.some((url) => url.includes('/zones/list') && url.includes('filterType=Primary')),
      'the wire enum, not the label, is what gets sent',
    ).toBe(true)

    const matched = await zoneRows(page).count()
    for (let index = 0; index < matched; index += 1) {
      await expect(zoneRows(page).nth(index).locator('td').nth(2)).toHaveText('主要区域')
    }

    await trigger.click()
    await page.getByRole('option', { name: '全部类型', exact: true }).click()
    // Resetting returns to the unfiltered key the query client still holds
    // fresh, so the rows may never disappear — assert on the control instead.
    await expect(trigger).toContainText('全部类型')
    await expect(zoneRows(page).first()).toBeVisible()
  })

  test('the create dialog refuses an invalid zone without contacting the server', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/zones')

    await page.getByRole('button', { name: '创建区域' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '创建区域' })).toBeVisible()

    const submit = dialog.locator('button[type="submit"]')
    const zone = dialog.locator('#cz-zone')

    // A space and a `!` both fall outside the character class the schema allows.
    await zone.fill('not a zone name!')
    const badName = await captureApiCalls(page, async () => {
      await submit.click()
      // Waiting on the message rather than on a timer keeps the capture window
      // open until validation has definitely had its chance to be skipped.
      await expect(dialog.getByText('区域名不合法')).toBeVisible()
    })
    expect(badName.filter((url) => url.includes('zones/create')), 'validation short-circuits the request').toEqual([])
    await expect(zone).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog).toBeVisible()

    await zone.fill('   ')
    await submit.click()
    await expect(dialog.getByText('区域名不合法')).toBeVisible()

    // Type-dependent rule 1: anything that replicates needs a primary.
    await dialog.locator('#cz-type').click()
    await page.getByRole('option', { name: '辅助区域', exact: true }).click()
    await expect(dialog.locator('#cz-primary')).toBeVisible()
    await zone.fill(`${E2E_PREFIX}secondary-probe.test`)
    const noPrimary = await captureApiCalls(page, async () => {
      await submit.click()
      await expect(dialog.getByText('该区域类型至少需要一个主要名称服务器地址')).toBeVisible()
    })
    expect(noPrimary.filter((url) => url.includes('zones/create'))).toEqual([])

    // Type-dependent rule 2: a forwarder needs somewhere to forward to.
    await dialog.locator('#cz-type').click()
    await page.getByRole('option', { name: '转发区域', exact: true }).click()
    await expect(dialog.locator('#cz-primary')).toHaveCount(0)
    await zone.fill(`${E2E_PREFIX}forwarder-probe.test`)
    const noForwarder = await captureApiCalls(page, async () => {
      await submit.click()
      await expect(dialog.getByText('转发区域必须填写转发目标')).toBeVisible()
    })
    expect(noForwarder.filter((url) => url.includes('zones/create'))).toEqual([])

    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()

    watcher.expectClean('create validation')
  })

  test('creating a primary zone lists it and opens its detail page', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/zones')

    await page.getByRole('button', { name: '创建区域' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Primary is the default, so the plain path needs no type selection at all.
    await expect(dialog.locator('#cz-type')).toContainText('主要区域')

    await dialog.locator('#cz-zone').fill(SCRATCH)
    await dialog.locator('button[type="submit"]').click()
    // Tracked before the outcome is known: a create that succeeded while its
    // toast assertion failed must still be swept.
    created.push(SCRATCH)

    await expect(toast(page, `区域 ${SCRATCH} 已创建`)).toBeVisible({ timeout: 30_000 })
    await expect(dialog).toBeHidden()

    await zoneSearch(page).fill(SCRATCH)
    const row = zoneRow(page, SCRATCH)
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row.locator('td').nth(2)).toHaveText('主要区域')
    await expect(row.locator('td').nth(3)).toHaveText('启用中')
    await expect(row.locator('td').nth(4)).toHaveText(/^\d+$/)

    await row.locator('a').click()
    await expect(page).toHaveURL(new RegExp(`/zones/${escapeRegExp(encodeURIComponent(SCRATCH))}$`))
    await expect(pageHeading(page)).toHaveText(SCRATCH)

    watcher.expectClean('zone create')
  })

  test('a zone can be disabled and re-enabled from its row menu', async ({ page }) => {
    const watcher = watchConsole(page)
    await findZone(page, SCRATCH)

    const status = zoneRow(page, SCRATCH).locator('td').nth(3)
    await openRowMenu(page, SCRATCH)
    await page.getByRole('menuitem', { name: '禁用区域' }).click()

    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await expect(confirm.getByRole('heading', { name: '禁用区域' })).toBeVisible()
    await expect(confirm.getByText('禁用后该区域将不再应答任何查询。确定继续？')).toBeVisible()
    await confirm.getByRole('button', { name: '禁用区域' }).click()

    await expect(toast(page, `区域 ${SCRATCH} 已禁用`)).toBeVisible({ timeout: 30_000 })
    await expect(status).toHaveText('已禁用')

    await openRowMenu(page, SCRATCH)
    // Enabling is not destructive, so it fires straight from the menu item.
    await page.getByRole('menuitem', { name: '启用区域' }).click()
    await expect(toast(page, `区域 ${SCRATCH} 已启用`)).toBeVisible({ timeout: 30_000 })
    await expect(status).toHaveText('启用中')

    watcher.expectClean('enable/disable')
  })

  test('exporting a zone downloads its zone file', async ({ page }) => {
    await findZone(page, SCRATCH)

    // `saveBlob` clicks a synthetic `<a download href="blob:">`, which Chromium
    // reports as a real download — so the assertion is on the event, not on a
    // toast that could fire even if the browser swallowed the file.
    const pending = page.waitForEvent('download')
    await openRowMenu(page, SCRATCH)
    await page.getByRole('menuitem', { name: '导出区域文件' }).click()

    const download = await pending
    expect(download.suggestedFilename()).toBe(`${SCRATCH}.zone`)
    await expect(toast(page, `已开始下载 ${SCRATCH}`)).toBeVisible({ timeout: 30_000 })
  })

  test('clone and convert open for the scratch zone and cancel without writing', async ({ page }) => {
    await findZone(page, SCRATCH)

    const cloneCalls = await captureApiCalls(page, async () => {
      await openRowMenu(page, SCRATCH)
      await page.getByRole('menuitem', { name: '克隆区域' }).click()

      const clone = page.getByRole('dialog')
      await expect(clone).toBeVisible()
      await expect(clone.getByRole('heading', { name: '克隆区域' })).toBeVisible()
      // The source is fixed by the row that opened the dialog and not editable.
      await expect(clone.locator('#clone-source')).toHaveValue(SCRATCH)
      await expect(clone.locator('#clone-source')).toBeDisabled()
      // With no target name the submit is dead, so cancelling cannot half-write.
      await expect(clone.locator('#clone-name')).toHaveValue('')
      await expect(clone.locator('button[type="submit"]')).toBeDisabled()

      await clone.getByRole('button', { name: '取消' }).click()
      await expect(clone).toBeHidden()
      await page.waitForTimeout(500)
    })
    expect(cloneCalls.filter((url) => url.includes('zones/clone')), 'clone is never submitted').toEqual([])

    const convertCalls = await captureApiCalls(page, async () => {
      await openRowMenu(page, SCRATCH)
      await page.getByRole('menuitem', { name: '转换类型' }).click()

      const convert = page.getByRole('alertdialog')
      await expect(convert).toBeVisible()
      await expect(convert.getByRole('heading', { name: '转换区域类型' })).toBeVisible()
      await expect(convert.getByText('转换会改变区域的数据来源')).toBeVisible()
      await expect(convert.getByText(SCRATCH)).toBeVisible()

      // A Primary can only become a Forwarder or a Catalog — offering the type
      // it already is would be a no-op the server rejects.
      await convert.locator('#convert-type').click()
      await expect(page.getByRole('option')).toHaveCount(2)
      await expect(page.getByRole('option', { name: '转发区域', exact: true })).toBeVisible()
      await page.getByRole('option', { name: '目录区域', exact: true }).click()
      await expect(convert.locator('#convert-type')).toContainText('目录区域')

      await convert.getByRole('button', { name: '取消' }).click()
      await expect(convert).toBeHidden()
      await page.waitForTimeout(500)
    })
    expect(convertCalls.filter((url) => url.includes('zones/convert')), 'convert is never submitted').toEqual([])

    // Both dialogs are pure intent until confirmed, so the zone is untouched.
    await expect(zoneRow(page, SCRATCH).locator('td').nth(2)).toHaveText('主要区域')
  })

  test('the options page renders every policy block and a save survives a reload', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, `/zones/${encodeURIComponent(SCRATCH)}/options`)
    await expect(pageHeading(page)).toHaveText(SCRATCH)

    // Same tabbed surface as records: this tab is current, the sibling tabs are
    // reachable, and the breadcrumb leads back to the zone list.
    await expect(page.getByRole('link', { name: '选项', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: '记录', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '返回区域列表' })).toBeVisible()

    for (const section of ['常规', '查询访问', '区域传输', '变更通知', '动态更新']) {
      await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
    }
    // The secondary-source and catalog-override blocks are type-gated; a Primary
    // zone that is not a catalog member must not render either.
    await expect(page.locator('#zo-primary-ns')).toHaveCount(0)
    await expect(page.locator('#zo-override-notify')).toHaveCount(0)
    // Returned by `get` but absent from `SetZoneOptionsParams`, so it is pinned.
    await expect(page.locator('#zo-delete-protected')).toBeDisabled()

    const access = page.locator('#zo-query-access')
    const current = (await access.innerText()).trim()
    const target = current === '允许所有' ? '仅允许私有网络' : '允许所有'

    await access.click()
    await page.getByRole('option', { name: target, exact: true }).click()
    await expect(access).toContainText(target)

    await page.locator('form button[type="submit"]').click()
    await expect(toast(page, '区域选项已保存')).toBeVisible({ timeout: 30_000 })

    // A toast is not proof of persistence; only a fresh mount reading the server
    // back is.
    await gotoConsole(page, `/zones/${encodeURIComponent(SCRATCH)}/options`)
    await expect(page.locator('#zo-query-access')).toContainText(target)

    watcher.expectClean('zone options')
  })

  test('the permissions page renders both ACL tables and a grant survives a reload', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, `/zones/${encodeURIComponent(SCRATCH)}/permissions`)
    await expect(pageHeading(page)).toHaveText(SCRATCH)

    // Tabbed like every other zone sub-page, breadcrumb back to the zone list.
    await expect(page.getByRole('link', { name: '权限', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: '返回区域列表' })).toBeVisible()

    const users = page.locator('section', { has: page.getByRole('heading', { name: '用户', exact: true }) })
    const groups = page.locator('section', { has: page.getByRole('heading', { name: '用户组', exact: true }) })
    await expect(users).toBeVisible()
    await expect(groups).toBeVisible()
    await expect(page.getByText('区域权限继承自')).toBeVisible()

    // The server seeds a new zone's ACL with the creating user and its two
    // administrator groups, so neither table is guaranteed to start empty.
    // Assert the *shape* — headers when there are rows, the explanatory copy
    // when there are not — rather than a count that only holds on a server
    // Technitium has just been installed on.
    for (const scope of [users, groups]) {
      const principal = scope.getByRole('columnheader', { name: '主体', exact: true })
      if ((await principal.count()) > 0) {
        for (const column of ['查看', '修改', '删除']) {
          await expect(scope.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
        }
        await expect(scope.locator('tbody tr').first()).toBeVisible()
      } else {
        await expect(scope.getByText('尚未为该区域授予任何权限')).toBeVisible()
      }
    }

    // Whichever principal set still has an ungranted candidate drives the write:
    // `AddPicker` disables itself once its list is exhausted, and which one that
    // is depends on how many users and groups this particular server has.
    const addUser = page.getByRole('combobox', { name: '添加用户', exact: true })
    const addGroup = page.getByRole('combobox', { name: '添加用户组', exact: true })
    const picker = (await addUser.isEnabled())
      ? { trigger: addUser, scope: users }
      : { trigger: addGroup, scope: groups }
    await expect(picker.trigger, 'at least one picker still has a candidate').toBeEnabled()

    await picker.trigger.click()
    const option = page.getByRole('option').first()
    const principal = (await option.innerText()).trim()
    expect(principal, 'the picker offers a real principal').not.toBe('')
    await option.click()

    await picker.scope.getByRole('button', { name: '添加', exact: true }).click()
    // A new grant starts fully locked down; the operator opts in per column.
    const view = picker.scope.getByRole('checkbox', { name: `查看: ${principal}` })
    await expect(view).toBeVisible()
    await expect(view).not.toBeChecked()
    await expect(picker.scope.getByRole('checkbox', { name: `修改: ${principal}` })).not.toBeChecked()
    await view.click()
    await expect(view).toBeChecked()

    await page.getByRole('button', { name: '保存权限' }).click()
    await expect(toast(page, '区域权限已保存')).toBeVisible({ timeout: 30_000 })

    // A toast is not proof of persistence; only a fresh mount reading the server
    // back is. `set` is a full replace of both lists, so the grant surviving
    // also proves the untouched table was re-sent instead of cleared.
    await gotoConsole(page, `/zones/${encodeURIComponent(SCRATCH)}/permissions`)
    await expect(page.getByRole('checkbox', { name: `查看: ${principal}` })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: `删除: ${principal}` })).not.toBeChecked()

    watcher.expectClean('zone permissions')
  })

  test('deleting the scratch zone requires typing its exact name', async ({ page }) => {
    const watcher = watchConsole(page)
    await findZone(page, SCRATCH)

    await openRowMenu(page, SCRATCH)
    await page.getByRole('menuitem', { name: '删除区域' }).click()

    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await expect(confirm.getByRole('heading', { name: '删除区域' })).toBeVisible()
    await expect(confirm.getByText(`确定要删除区域 ${SCRATCH} 吗？`)).toBeVisible()
    await expect(confirm.getByText(`请输入 ${SCRATCH} 以确认`)).toBeVisible()

    const arm = confirm.getByRole('button', { name: '删除区域' })
    await expect(arm).toBeDisabled()
    // One character short must not be enough — that is the whole point of the
    // typed confirmation.
    await confirm.locator('#confirm-text').fill(SCRATCH.slice(0, -1))
    await expect(arm).toBeDisabled()
    await confirm.locator('#confirm-text').fill(SCRATCH)
    await expect(arm).toBeEnabled()
    await arm.click()

    await expect(toast(page, `区域 ${SCRATCH} 已删除`)).toBeVisible({ timeout: 30_000 })
    await expect(zoneRow(page, SCRATCH)).toHaveCount(0)
    await expect(page.getByText('没有匹配的结果')).toBeVisible()

    const at = created.indexOf(SCRATCH)
    if (at >= 0) created.splice(at, 1)

    watcher.expectClean('zone delete')
  })
})

/**
 * Direct Technitium access, used for verification and cleanup only.
 *
 * This deliberately bypasses the console: cleanup must not depend on the thing
 * under test still working, and `E2E_SKIP_TEARDOWN=1` turns the global sweep
 * off. Mirrors `global-teardown.ts` rather than importing it, because that file
 * is a Playwright hook and importing it would drag its default export into the
 * test list.
 */
async function apiToken(): Promise<string | null> {
  const response = await fetch(`${E2E.dnsUrl}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: E2E.user, pass: E2E.pass }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return null
  const parsed = (await response.json()) as { status?: string; token?: string }
  return parsed.status === 'ok' && parsed.token ? parsed.token : null
}

async function serverZoneNames(token: string): Promise<string[]> {
  const response = await fetch(`${E2E.dnsUrl}/api/zones/list`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) return []
  const parsed = (await response.json()) as { response?: { zones?: { name?: string }[] } }
  return (parsed.response?.zones ?? []).map((zone) => zone.name ?? '').filter(Boolean)
}

async function deleteZone(token: string, zone: string): Promise<void> {
  await fetch(`${E2E.dnsUrl}/api/zones/delete?${new URLSearchParams({ zone })}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
}

