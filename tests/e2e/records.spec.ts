import { expect, test, type Locator, type Page } from '@playwright/test'
import { E2E, E2E_PREFIX, scratchZone } from './env'
import { captureApiCalls, gotoConsole, pageHeading, watchConsole } from './helpers'

/**
 * Record CRUD for one zone, end to end through the UI.
 *
 * What this file guards:
 *
 *  - The detail page is a faithful read of `zones/records/get?listZone=true`:
 *    the summary block, the SOA panel, the owner-name rail and the table all
 *    describe the *same* array, so the record count in three places must agree.
 *  - Every filter on this page is client-side. That is the documented design
 *    (one request returns the whole zone), and it is asserted on the wire: a
 *    keystroke in the search box must not produce a single proxied call.
 *  - The add dialog is *generated* from `lib/api/record-params.ts`, so switching
 *    type swaps the whole field set. The walk over A → AAAA → CNAME → TXT → MX
 *    is what stops a SPEC edit from silently orphaning a control.
 *  - rData renders through `.font-data` in the shape `summarizeRecord` produces
 *    per type — bare address, `preference exchange`, quoted character string.
 *    A cell that prints `[object Object]` or an empty string is the failure
 *    mode this catches.
 *  - Writes report through a toast *and* change the row. The toast alone would
 *    also fire on a mutation whose invalidation never landed.
 *
 * Constraints that are not visible from the tests themselves:
 *
 *  - Everything happens inside `SCRATCH`, a zone this file creates and deletes.
 *    The live server also holds zones the suite must never touch, and a record
 *    write is addressed by `zone`, so a stray selector could not reach them —
 *    but the zone is scratch-only regardless.
 *  - The address records' `ptr` / `createPtrZone` switches are asserted **off**
 *    and never toggled: turning them on would make the server create or modify
 *    reverse zones, i.e. write outside the scratch zone.
 *  - `workers: 1` + `test.describe.serial` make the ordering a real guarantee;
 *    `seeded` is captured by the first test and reused by the row-count maths.
 *  - `globalTeardown` skips its sweep under `E2E_SKIP_TEARDOWN=1`, so `afterAll`
 *    deletes the scratch zone (and with it every record created here) over the
 *    Technitium API rather than trusting the last UI test to have run.
 */

/** The only zone this file is allowed to write to. */
const SCRATCH = scratchZone()

/** Everything this file created and has not deleted yet; swept in `afterAll`. */
const created: string[] = []

const ZONE_PATH = `/zones/${encodeURIComponent(SCRATCH)}`

/** Owner labels created here. Every one is unique, so rows are addressable. */
const OWNERS = { a: 'a1', aaaa: 'aaaa1', cname: 'www', txt: 'txt1', mx: 'mx1' } as const

const A_IP = '10.20.30.40'
const AAAA_IP = '2001:db8::1'
const AAAA_IP_NEXT = '2001:db8::2'
const TXT_VALUE = 'e2e text record'
const MX_PREFERENCE = '10'

/**
 * Records the server seeds into a brand-new primary zone (an NS and an SOA at
 * the apex). Read off the page by the first test instead of hardcoded: the
 * exact set depends on the server's own configuration.
 */
let seeded = 0

/** Flat-table column indexes. Column 0 is the row-selection checkbox. */
const COL = {
  name: 1,
  type: 2,
  ttl: 3,
  data: 4,
  expiry: 5,
  status: 6,
  dnssec: 7,
  comments: 10,
  actions: 11,
} as const

/** The FQDN the server stores for an owner label typed into the editor. */
const fqdn = (label: string): string => `${label}.${SCRATCH}`

/**
 * Rows that carry a record, in either display mode.
 *
 * The empty / no-match placeholder is also a `<tr>`, so rows are selected by the
 * owner-name span every real row renders — see `record-table.tsx`.
 */
function anyRows(page: Page): Locator {
  return page.locator('[data-slot="data-table"] tbody tr:has(span.font-data[title])')
}

/** The row owned by `name`, addressed by the `title` on its name cell. */
function rowFor(page: Page, name: string): Locator {
  return anyRows(page).filter({ has: page.locator(`span.font-data[title="${name}"]`) })
}

/**
 * The rData cell.
 *
 * `DataValue` wraps the value in `<span title="…"><span class="font-data">…`,
 * while the owner-name cell puts `title` and `font-data` on the *same* span — so
 * this child combinator matches the data column and nothing else in the row.
 */
function dataCell(row: Locator): Locator {
  return row.locator('span[title] > span.font-data')
}

function cell(row: Locator, index: number): Locator {
  return row.locator('td').nth(index)
}

/** The `共 N 条记录` note under the table. */
function total(page: Page, count: number): Locator {
  return page.getByText(`共 ${count} 条记录`)
}

function search(page: Page): Locator {
  return page.getByLabel('按名称或数据搜索…')
}

/**
 * The "include disabled records" switch.
 *
 * Addressed through its wrapping `<label>` rather than by role and name: a
 * `<button role="switch">` is not a labelable element, so the label text never
 * becomes its accessible name.
 */
function includeDisabled(page: Page): Locator {
  return page.locator('label', { hasText: '包含已禁用记录' }).locator('[data-slot="switch"]')
}

/** A sonner toast. `.first()` because successes stack within one test. */
function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).first()
}

async function openEditor(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '添加记录' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: '添加记录' })).toBeVisible()
  return dialog
}

/** Pick a record type in the add dialog. `exact` matters: "A" ⊂ "AAAA"/"ANAME". */
async function selectType(page: Page, dialog: Locator, label: string): Promise<void> {
  await dialog.locator('#rec-type').click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(dialog.locator('#rec-type')).toHaveText(label)
}

/** Pick a type in the toolbar filter, whose trigger keeps a fixed `aria-label`. */
async function filterByType(page: Page, label: string): Promise<void> {
  await page.getByRole('combobox', { name: '全部类型', exact: true }).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

async function openRowMenu(page: Page, name: string): Promise<void> {
  await rowFor(page, name).getByRole('button', { name: '更多' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

interface AddOptions {
  type?: string
  name?: string
  ttl?: string
  comments?: string
  /** rData values, keyed by the SPEC's `add` parameter name. */
  values?: Record<string, string>
}

/**
 * Add one record through the dialog and wait for it to land in the table.
 *
 * The dialog closes only in the mutation's `onSuccess`, so "dialog hidden" is a
 * stronger success gate than the toast — which would still be on screen from the
 * previous add when several run back to back.
 */
async function addRecord(page: Page, options: AddOptions): Promise<void> {
  const dialog = await openEditor(page)
  if (options.type) await selectType(page, dialog, options.type)
  if (options.name !== undefined) await dialog.locator('#rec-domain').fill(options.name)
  for (const [field, value] of Object.entries(options.values ?? {})) {
    await dialog.locator(`#rec-${field}`).fill(value)
  }
  if (options.ttl !== undefined) await dialog.locator('#rec-ttl').fill(options.ttl)
  if (options.comments !== undefined) await dialog.locator('#rec-comments').fill(options.comments)

  await dialog.getByRole('button', { name: '保存记录' }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
  await expect(toast(page, '记录已添加')).toBeVisible({ timeout: 30_000 })
}

test.describe.serial('records', () => {
  test.afterAll(async () => {
    // Deleting the zone takes every record created here with it. The
    // `E2E_PREFIX` guard means a bug in this file can never reach a zone the
    // operator created by hand.
    const leftovers = created.filter((zone) => zone.startsWith(E2E_PREFIX))
    created.length = 0
    if (leftovers.length === 0) return

    const token = await apiToken()
    if (!token) return
    for (const zone of leftovers) await deleteZone(token, zone)
  })

  test('a fresh zone opens on its records, and three counts agree', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/zones')

    // Created through the UI on purpose: the record suite needs a zone, and
    // going through the dialog means this file also covers the create path.
    await page.getByRole('button', { name: '创建区域' }).click()
    const create = page.getByRole('dialog')
    await expect(create).toBeVisible()
    await create.locator('#cz-zone').fill(SCRATCH)
    await create.locator('button[type="submit"]').click()
    // Tracked before the outcome is known: a create that succeeded while its
    // toast assertion failed must still be swept.
    created.push(SCRATCH)
    await expect(toast(page, `区域 ${SCRATCH} 已创建`)).toBeVisible({ timeout: 30_000 })
    await expect(create).toBeHidden()

    await gotoConsole(page, ZONE_PATH)
    await expect(pageHeading(page)).toHaveText(SCRATCH)
    // The heading is monospace: a zone name is data, not prose.
    await expect(pageHeading(page).locator('span.font-data')).toHaveText(SCRATCH)
    await expect(page.getByText(`${SCRATCH} 区域中的全部 DNS 记录`)).toBeVisible()

    const tabs = page.locator('nav[aria-label="区域"] a')
    await expect(tabs).toHaveCount(4)
    await expect(tabs.nth(0)).toHaveText('记录')
    await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'page')
    await expect(tabs.nth(1)).toHaveText('DNSSEC')
    await expect(tabs.nth(2)).toHaveText('选项')
    await expect(tabs.nth(3)).toHaveText('权限')

    for (const action of ['刷新', '导入区域文件', '导出区域文件', '添加记录']) {
      await expect(page.getByRole('button', { name: action })).toBeVisible()
    }

    // The summary block is a real <dl>, so the labels are addressable by role.
    const terms = page.locator('[data-slot="definition-list"] dt')
    await expect(terms).toHaveText([
      '类型',
      '状态',
      'SOA 序列号',
      '最后修改',
      'DNSSEC 状态',
      '所属目录区域',
      '过期时间',
      '记录数量',
    ])
    const values = page.locator('[data-slot="definition-list"] dd')
    await expect(values.nth(0)).toHaveText('主要区域')
    await expect(values.nth(1)).toHaveText('启用中')
    await expect(values.nth(2)).toHaveText(/^\d+$/)

    // Whatever the server seeds, it seeds at the apex — and never nothing.
    const rows = anyRows(page)
    await expect(rows.first()).toBeVisible({ timeout: 20_000 })
    seeded = await rows.count()
    expect(seeded, 'a new primary zone is never empty').toBeGreaterThan(0)
    for (let index = 0; index < seeded; index += 1) {
      await expect(rows.nth(index).locator('span.font-data[title]')).toHaveAttribute('title', SCRATCH)
      expect(['NS', 'SOA'], 'only the seeded apex records exist').toContain(
        (await cell(rows.nth(index), COL.type).innerText()).trim(),
      )
    }
    await expect(values.nth(7)).toHaveText(String(seeded))
    await expect(total(page, seeded)).toBeVisible()

    // The owner rail mirrors the same array: apex only, with the seeded count.
    await expect(page.getByRole('button', { name: '域名' })).toBeVisible()
    await expect(page.getByRole('button', { name: '全部名称' })).toBeVisible()
    await expect(page.locator(`button[title="${SCRATCH}"]`)).toContainText(String(seeded))

    watcher.expectClean('zone detail')
  })

  test('the seeded SOA and NS records are shown read-only', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    const soaSection = page.locator('section[data-slot="section"]', {
      has: page.getByRole('heading', { name: 'SOA 记录' }),
    })
    await expect(soaSection).toBeVisible()
    await expect(soaSection.getByRole('button', { name: '递增序列号' })).toBeVisible()
    await expect(soaSection.getByRole('button', { name: '编辑 SOA' })).toBeVisible()
    await expect(soaSection.getByText('序列号必须在每次变更后递增')).toBeVisible()
    // A display panel, not a form: no control of any kind inside it.
    await expect(soaSection.locator('input, textarea, select, [role="switch"]')).toHaveCount(0)

    await filterByType(page, 'SOA')
    const soaRow = anyRows(page)
    await expect(soaRow).toHaveCount(1)
    const summary = (await dataCell(soaRow).innerText()).trim()
    await expect(soaSection.locator('.font-data')).toHaveText(summary)

    // `mname rname serial refresh retry expire minimum` — seven tokens, the last
    // five numeric. A missing rData key would collapse the spacing silently.
    const tokens = summary.split(/\s+/)
    expect(tokens, 'the SOA summary carries all seven fields').toHaveLength(7)
    for (const token of tokens.slice(2)) expect(token, 'timers and serial are numeric').toMatch(/^\d+$/)

    // The summary panel and the table row read the same record, so the serial in
    // the definition list must be the serial in the rData.
    const serial = page.locator('[data-slot="definition-list"] dd').nth(2)
    await expect(serial).toHaveText(tokens[2])

    await filterByType(page, 'NS')
    const nsRow = anyRows(page)
    await expect(nsRow).toHaveCount(1)
    await expect(cell(nsRow, COL.type)).toHaveText('NS')
    const nameServer = (await dataCell(nsRow).innerText()).trim()
    expect(nameServer.length, 'the NS target is rendered, not a placeholder').toBeGreaterThan(0)
    expect(nameServer, 'a missing rData key would fall back to an em dash').not.toBe('—')

    await filterByType(page, '全部类型')
    await expect(anyRows(page)).toHaveCount(seeded)

    // Editing the SOA is an explicit act, and the dialog locks the type: it is a
    // Badge, not a Select, so an operator cannot turn the SOA into something else.
    await page.getByRole('button', { name: '编辑 SOA' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: '编辑记录' })).toBeVisible()
    await expect(dialog.locator('#rec-type')).toHaveCount(0)
    // `exact` matters: the singleton hint further down also starts with "SOA".
    await expect(dialog.getByText('SOA', { exact: true })).toBeVisible()
    await expect(dialog.getByText('当前值')).toBeVisible()
    await expect(dialog.locator('#rec-primaryNameServer')).not.toHaveValue('')
    // SOA is a singleton per name, and the dialog says so.
    await expect(dialog.getByText('SOA、CNAME、DNAME 每个名称下只能存在一条')).toBeVisible()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    await expect(anyRows(page)).toHaveCount(seeded)

    watcher.expectClean('soa/ns read-only')
  })

  test('the editor is generated from the type matrix and validates first', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    const dialog = await openEditor(page)
    // A is the default, so the address block is up before any choice is made.
    await expect(dialog.getByText('域名到 IPv4 地址的映射')).toBeVisible()
    await expect(dialog.locator('#rec-domain')).toHaveAttribute('placeholder', 'www')
    await expect(dialog.getByText(`留空表示区域顶点；填写 www 即 www.${SCRATCH}。`)).toBeVisible()

    const submit = dialog.getByRole('button', { name: '保存记录' })
    const calls = await captureApiCalls(page, async () => {
      await submit.click()
      // Waiting on the alert rather than on a timer keeps the capture window
      // open until validation has definitely had its chance to be skipped.
      await expect(dialog.getByText('请填写必填字段')).toBeVisible()
    })
    expect(calls.filter((url) => url.includes('zones/records/add')), 'validation short-circuits the request').toEqual([])
    await expect(dialog.locator('#rec-ipAddress')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByText('此项为必填')).toBeVisible()
    await expect(dialog).toBeVisible()

    // The three address extras ride along with every address record. They must
    // stay off — enabling them would make the server write reverse zones.
    await selectType(page, dialog, 'AAAA')
    await expect(dialog.getByText('域名到 IPv6 地址的映射')).toBeVisible()
    await expect(dialog.locator('#rec-ipAddress')).toHaveCount(1)
    for (const id of ['ptr', 'createPtrZone', 'updateSvcbHints']) {
      await expect(dialog.locator(`#rec-${id}`)).not.toBeChecked()
    }

    // A TTL that cannot be parsed is refused in the browser, with its own alert.
    await dialog.locator('#rec-ttl').fill('not-a-ttl')
    await submit.click()
    await expect(dialog.locator('#rec-ttl')).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByText('请输入有效数字')).toBeVisible()
    // Quick-pick presets write the seconds straight into the same input. The
    // preset alone does *not* clear the alert: `record-editor-dialog.tsx` calls
    // `setTtlText` from the button without the `setTtlError(undefined)` the
    // input's own `onChange` performs, so the red state outlives the fix. That
    // is a real defect (reported, not asserted around) — typing is what an
    // operator does next, and that does clear it.
    await dialog.getByRole('button', { name: '300', exact: true }).click()
    await expect(dialog.locator('#rec-ttl')).toHaveValue('300')
    await dialog.locator('#rec-ttl').fill('600')
    await expect(dialog.locator('#rec-ttl')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(dialog.getByText('请输入有效数字')).toHaveCount(0)

    // Switching type swaps the whole field set rather than hiding parts of it.
    await selectType(page, dialog, 'CNAME')
    await expect(dialog.locator('#rec-ipAddress')).toHaveCount(0)
    await expect(dialog.locator('#rec-cname')).toBeVisible()

    await selectType(page, dialog, 'TXT')
    await expect(dialog.locator('#rec-text')).toBeVisible()
    await expect(dialog.locator('#rec-splitText')).toBeVisible()

    await selectType(page, dialog, 'MX')
    await expect(dialog.locator('#rec-preference')).toHaveAttribute('type', 'number')
    await expect(dialog.locator('#rec-exchange')).toBeVisible()

    // Add-only affordances: overwrite, and create-then-disable (the API has no
    // `disable` parameter on add, so the console chains a state change).
    await expect(dialog.locator('#rec-overwrite')).not.toBeChecked()
    await expect(dialog.locator('#rec-create-disabled')).not.toBeChecked()

    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()
    await expect(anyRows(page)).toHaveCount(seeded)

    watcher.expectClean('record editor validation')
  })

  test('an A record can be added and renders its address', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    await addRecord(page, {
      name: OWNERS.a,
      ttl: '300',
      comments: 'e2e A record',
      values: { ipAddress: A_IP },
    })

    const row = rowFor(page, fqdn(OWNERS.a))
    await expect(row).toHaveCount(1)
    // The name cell shows the label relative to the zone but keeps the FQDN as
    // the tooltip, which is what every locator in this file keys off.
    await expect(cell(row, COL.name).locator('span.font-data')).toHaveText(OWNERS.a)
    await expect(cell(row, COL.name).locator('span.font-data')).toHaveAttribute('title', fqdn(OWNERS.a))
    await expect(cell(row, COL.type)).toHaveText('A')
    await expect(cell(row, COL.ttl)).toHaveText('5m')
    await expect(dataCell(row)).toHaveText(A_IP)
    await expect(cell(row, COL.status)).toHaveText('启用')
    await expect(cell(row, COL.comments)).toHaveText('e2e A record')
    // No expiry was given, so the column keeps its placeholder rather than "0s".
    await expect(cell(row, COL.expiry)).toHaveText('—')

    await expect(anyRows(page)).toHaveCount(seeded + 1)
    await expect(total(page, seeded + 1)).toBeVisible()
    await expect(page.locator('[data-slot="definition-list"] dd').nth(7)).toHaveText(String(seeded + 1))
    // The owner rail picked the new name up without a reload.
    await expect(page.locator(`button[title="${fqdn(OWNERS.a)}"]`)).toBeVisible()

    watcher.expectClean('add A')
  })

  test('AAAA, CNAME, TXT and MX each render their own rData shape', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    await addRecord(page, { type: 'AAAA', name: OWNERS.aaaa, values: { ipAddress: AAAA_IP } })
    await expect(dataCell(rowFor(page, fqdn(OWNERS.aaaa)))).toHaveText(AAAA_IP)

    await addRecord(page, { type: 'CNAME', name: OWNERS.cname, values: { cname: fqdn(OWNERS.a) } })
    // `displayDomain` strips the root dot the server stores, so the cell reads
    // like a zone file rather than like the wire format.
    await expect(dataCell(rowFor(page, fqdn(OWNERS.cname)))).toHaveText(fqdn(OWNERS.a))

    await addRecord(page, { type: 'TXT', name: OWNERS.txt, values: { text: TXT_VALUE } })
    // A character string is quoted, the way `dig` prints it.
    await expect(dataCell(rowFor(page, fqdn(OWNERS.txt)))).toHaveText(`"${TXT_VALUE}"`)

    await addRecord(page, {
      type: 'MX',
      name: OWNERS.mx,
      values: { preference: MX_PREFERENCE, exchange: `mail.${SCRATCH}` },
    })
    // Preference before exchange — the order matters to anyone reading a row.
    await expect(dataCell(rowFor(page, fqdn(OWNERS.mx)))).toHaveText(`${MX_PREFERENCE} mail.${SCRATCH}`)

    await expect(anyRows(page)).toHaveCount(seeded + 5)
    await expect(total(page, seeded + 5)).toBeVisible()

    // Every rData cell goes through the monospace treatment, not just the first.
    for (const label of Object.values(OWNERS)) {
      const value = dataCell(rowFor(page, fqdn(label)))
      await expect(value).toBeVisible()
      expect(await value.getAttribute('class'), `${label} renders through .font-data`).toContain('font-data')
    }

    watcher.expectClean('add AAAA/CNAME/TXT/MX')
  })

  test('search, type and owner filters all run in the browser', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)
    const everything = seeded + 5

    // The whole zone arrives in one response, so a keystroke must not cost a
    // round trip. This is the assertion that would catch a "helpful" refactor
    // into a server-side search.
    const searchCalls = await captureApiCalls(page, async () => {
      await search(page).fill(A_IP)
      // Outlive the 250 ms debounce: `captureApiCalls` settles on `networkidle`,
      // which resolves at once while the page is already quiet — that would make
      // the empty capture below vacuous rather than proof of anything.
      await expect(anyRows(page)).toHaveCount(1)
      await page.waitForTimeout(600)
    })
    expect(searchCalls, 'searching is client-side').toEqual([])
    await expect(anyRows(page)).toHaveCount(1)
    await expect(rowFor(page, fqdn(OWNERS.a))).toBeVisible()

    // The haystack is `name + summary + comments`, so rData is searchable too.
    await search(page).fill(TXT_VALUE)
    await expect(anyRows(page)).toHaveCount(1)
    await expect(rowFor(page, fqdn(OWNERS.txt))).toBeVisible()

    await search(page).fill('zz-no-such-record-anywhere')
    await expect(anyRows(page)).toHaveCount(0)
    // A miss under a filter is a miss, not an empty zone: the second would offer
    // to create the record the operator was looking for.
    await expect(page.getByText('没有匹配的结果')).toBeVisible()
    await expect(page.getByText('区域中还没有任何记录。')).toHaveCount(0)
    await expect(total(page, 0)).toBeVisible()

    await search(page).fill('')
    await expect(anyRows(page)).toHaveCount(everything)

    await filterByType(page, 'TXT')
    await expect(anyRows(page)).toHaveCount(1)
    await expect(cell(anyRows(page), COL.type)).toHaveText('TXT')
    await filterByType(page, '全部类型')
    await expect(anyRows(page)).toHaveCount(everything)

    // The owner rail is a facet: clicking an entry shows exactly the records
    // its badge counts — apex included, whose subtree would otherwise be the
    // whole zone and make `@` a synonym for "all names".
    await page.locator(`button[title="${fqdn(OWNERS.aaaa)}"]`).click()
    await expect(anyRows(page)).toHaveCount(1)
    await expect(rowFor(page, fqdn(OWNERS.aaaa))).toBeVisible()
    await page.locator(`button[title="${SCRATCH}"]`).click()
    await expect(anyRows(page)).toHaveCount(seeded)
    await expect(total(page, seeded)).toBeVisible()
    await page.getByRole('button', { name: '全部名称' }).click()
    await expect(anyRows(page)).toHaveCount(everything)

    // Badges track the other active filters: a search that matches one record
    // leaves just that owner in the rail, counted once, while every other name
    // drops out instead of advertising rows the table no longer shows.
    await search(page).fill(TXT_VALUE)
    await expect(page.locator(`button[title="${fqdn(OWNERS.txt)}"]`).getByText('1', { exact: true })).toBeVisible()
    await expect(page.locator(`button[title="${SCRATCH}"]`)).toHaveCount(0)
    await search(page).fill('')
    await expect(page.locator(`button[title="${SCRATCH}"]`)).toBeVisible()

    watcher.expectClean('record filters')
  })

  test('grouping buckets rows by owner without losing any', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)
    const everything = seeded + 5

    // The button relabels to its own inverse (按名称分组 ⇄ 平铺显示), which is the
    // only cue that the table below changed shape — so address it by the
    // `aria-pressed` it carries in both states, never by its name. The sibling
    // 展开胶合记录 toggle is the other `aria-pressed` button, hence the text filter.
    const toggle = page.locator('button[aria-pressed]').filter({ hasText: /按名称分组|平铺显示/ })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle).toHaveText('平铺显示')

    // One collapsible card per owner name: the apex plus the five created here.
    await expect(page.locator('[data-slot="data-table"]')).toHaveCount(6)
    await expect(anyRows(page)).toHaveCount(everything)
    await expect(total(page, everything)).toBeVisible()

    const apex = page.locator('button', { has: page.locator(`span.font-data[title="${SCRATCH}"]`) })
    await expect(apex).toContainText('@')
    await expect(apex).toContainText(String(seeded))
    for (const label of Object.values(OWNERS)) {
      const group = page.locator('button', { has: page.locator(`span.font-data[title="${fqdn(label)}"]`) })
      await expect(group, `${label} gets its own group`).toBeVisible()
      await expect(group).toContainText('1')
    }

    // Selection is deliberately off while grouped: a per-group table cannot share
    // one selection map without "select all" lying about its scope.
    await expect(page.locator('[data-slot="data-table"] [role="checkbox"]')).toHaveCount(0)

    // Collapsing a group hides its rows but keeps the card.
    await apex.click()
    await expect(anyRows(page)).toHaveCount(everything - seeded)
    await apex.click()
    await expect(anyRows(page)).toHaveCount(everything)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle).toHaveText('按名称分组')
    await expect(page.locator('[data-slot="data-table"]')).toHaveCount(1)
    await expect(anyRows(page)).toHaveCount(everything)
    // Back in flat mode, bulk selection is available again.
    await expect(page.locator('[data-slot="data-table"] [role="checkbox"]')).not.toHaveCount(0)

    watcher.expectClean('grouping')
  })

  test('editing a record replaces its rData', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    // The AAAA record, not the A one: `lib/api/record-params.ts:90` maps A's
    // `ipAddress` through the identity-only helper, so an A update sends the new
    // address as the *identity* and never sends `newIpAddress`. The server then
    // answers "the record does not exists to be updated". Reported, not worked
    // around here — this test exercises the update path that does work.
    await openRowMenu(page, fqdn(OWNERS.aaaa))
    await page.getByRole('menuitem', { name: '编辑', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: '编辑记录' })).toBeVisible()
    // Type is fixed on edit: a Badge, not the add-mode Select.
    await expect(dialog.locator('#rec-type')).toHaveCount(0)
    await expect(dialog.getByText(AAAA_IP)).toBeVisible()
    await expect(dialog.getByText('上方字段用于定位要修改的记录')).toBeVisible()
    await expect(dialog.getByText('新值')).toBeVisible()
    // The owner input is prefilled with the *relative* label, and the rData field
    // with the current value — editing starts from what is there.
    await expect(dialog.locator('#rec-domain')).toHaveValue(OWNERS.aaaa)
    await expect(dialog.locator('#rec-ipAddress')).toHaveValue(AAAA_IP)

    await dialog.getByRole('button', { name: '原始数据' }).click()
    await expect(dialog.getByText('以下为服务器返回的 rData 原始 JSON')).toBeVisible()
    await expect(dialog.locator('pre')).toContainText('ipAddress')

    await dialog.locator('#rec-ipAddress').fill(AAAA_IP_NEXT)
    await dialog.getByRole('button', { name: '保存记录' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(toast(page, '记录已更新')).toBeVisible({ timeout: 30_000 })

    await expect(dataCell(rowFor(page, fqdn(OWNERS.aaaa)))).toHaveText(AAAA_IP_NEXT)
    await expect(anyRows(page)).toHaveCount(seeded + 5)

    watcher.expectClean('edit record')
  })

  test('a record can be disabled and re-enabled from its row menu', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    await expect(includeDisabled(page)).toHaveAttribute('aria-checked', 'true')
    await openRowMenu(page, fqdn(OWNERS.a))
    await page.getByRole('menuitem', { name: '禁用', exact: true }).click()
    await expect(toast(page, '记录已禁用')).toBeVisible({ timeout: 30_000 })
    await expect(cell(rowFor(page, fqdn(OWNERS.a)), COL.status)).toHaveText('已禁用')

    // With "include disabled" off the row disappears, and the table says so as a
    // filtered result rather than as an empty zone.
    await includeDisabled(page).click()
    await expect(includeDisabled(page)).toHaveAttribute('aria-checked', 'false')
    await expect(rowFor(page, fqdn(OWNERS.a))).toHaveCount(0)
    await expect(anyRows(page)).toHaveCount(seeded + 4)
    await expect(page.getByText('区域中还没有任何记录。')).toHaveCount(0)

    await includeDisabled(page).click()
    await expect(rowFor(page, fqdn(OWNERS.a))).toBeVisible()
    await expect(anyRows(page)).toHaveCount(seeded + 5)

    await openRowMenu(page, fqdn(OWNERS.a))
    // The menu entry is a toggle, so exactly one of the two is ever offered.
    await page.getByRole('menuitem', { name: '启用', exact: true }).click()
    await expect(toast(page, '记录已启用')).toBeVisible({ timeout: 30_000 })
    await expect(cell(rowFor(page, fqdn(OWNERS.a)), COL.status)).toHaveText('启用')

    watcher.expectClean('disable/enable record')
  })

  test('bulk selection drives disable, enable and delete', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    const txt = rowFor(page, fqdn(OWNERS.txt))
    const mx = rowFor(page, fqdn(OWNERS.mx))
    await txt.getByRole('checkbox', { name: '选择此行' }).click()
    await mx.getByRole('checkbox', { name: '选择此行' }).click()

    // Two counts on purpose: the DataTable renders its own generic one, the
    // records view renders the record-specific one next to the bulk buttons.
    await expect(page.getByText('已选择 2 项')).toBeVisible()
    await expect(page.getByText('已选择 2 条')).toBeVisible()

    await page.getByRole('button', { name: '批量禁用' }).click()
    await expect(toast(page, '记录已禁用')).toBeVisible({ timeout: 30_000 })
    await expect(cell(txt, COL.status)).toHaveText('已禁用')
    await expect(cell(mx, COL.status)).toHaveText('已禁用')
    // A completed bulk mutation clears the selection instead of leaving a bar
    // that now points at rows whose state it no longer describes.
    await expect(page.getByText('已选择 2 条')).toHaveCount(0)

    await expect(page.getByRole('button', { name: '批量启用' })).toHaveCount(0)
    await txt.getByRole('checkbox', { name: '选择此行' }).click()
    await mx.getByRole('checkbox', { name: '选择此行' }).click()
    await page.getByRole('button', { name: '批量启用' }).click()
    await expect(toast(page, '记录已启用')).toBeVisible({ timeout: 30_000 })
    await expect(cell(txt, COL.status)).toHaveText('启用')
    await expect(cell(mx, COL.status)).toHaveText('启用')

    await txt.getByRole('checkbox', { name: '选择此行' }).click()
    await mx.getByRole('checkbox', { name: '选择此行' }).click()
    await page.getByRole('button', { name: '批量删除' }).click()

    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading', { name: '删除记录' })).toBeVisible()
    await expect(confirm.getByText('确定要删除选中的 2 条记录吗？')).toBeVisible()
    await expect(confirm.getByText('请输入 2 以确认')).toBeVisible()
    const arm = confirm.getByRole('button', { name: '批量删除' })
    await expect(arm).toBeDisabled()
    // The count, not a name: the operator has to read how many rows are going.
    await confirm.locator('#confirm-text').fill('1')
    await expect(arm).toBeDisabled()
    await confirm.locator('#confirm-text').fill('2')
    await expect(arm).toBeEnabled()
    await arm.click()

    await expect(toast(page, '已删除 2 条记录')).toBeVisible({ timeout: 30_000 })
    await expect(rowFor(page, fqdn(OWNERS.txt))).toHaveCount(0)
    await expect(rowFor(page, fqdn(OWNERS.mx))).toHaveCount(0)
    await expect(anyRows(page)).toHaveCount(seeded + 3)
    await expect(total(page, seeded + 3)).toBeVisible()

    watcher.expectClean('bulk actions')
  })

  test('a single record is deleted through its own confirmation', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, ZONE_PATH)

    await openRowMenu(page, fqdn(OWNERS.a))
    await page.getByRole('menuitem', { name: '删除', exact: true }).click()

    const confirm = page.getByRole('alertdialog')
    await expect(confirm.getByRole('heading', { name: '删除记录' })).toBeVisible()
    // The FQDN and the type are both named, so the wrong row cannot be deleted by
    // accident when two owners differ by one label.
    await expect(confirm.getByText(`确定要删除记录 ${fqdn(OWNERS.a)} (A) 吗？`)).toBeVisible()
    await confirm.getByRole('button', { name: '删除', exact: true }).click()

    await expect(toast(page, '记录已删除')).toBeVisible({ timeout: 30_000 })
    await expect(rowFor(page, fqdn(OWNERS.a))).toHaveCount(0)
    await expect(anyRows(page)).toHaveCount(seeded + 2)
    await expect(total(page, seeded + 2)).toBeVisible()
    // The CNAME that pointed at it survives: the console does not cascade.
    await expect(rowFor(page, fqdn(OWNERS.cname))).toBeVisible()

    watcher.expectClean('delete record')
  })
})

/**
 * Direct Technitium access, used for cleanup only.
 *
 * Cleanup must not depend on the thing under test still working, and
 * `E2E_SKIP_TEARDOWN=1` turns the global sweep off. Mirrors `global-teardown.ts`
 * rather than importing it, because that file is a Playwright hook and importing
 * it would drag its default export into the test list.
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

async function deleteZone(token: string, zone: string): Promise<void> {
  await fetch(`${E2E.dnsUrl}/api/zones/delete?${new URLSearchParams({ zone })}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
}
