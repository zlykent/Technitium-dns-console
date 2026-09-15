import { expect, test, type Page } from '@playwright/test'
import { E2E, E2E_PREFIX } from './env'
import { gotoConsole, moduleTitle, watchConsole } from './helpers'

/**
 * Filtering scopes: /cache, /allowed, /blocked.
 *
 * All three routes render the same `FilterView` + lazy `DomainTree`, so these
 * tests guard the shared surface (heading, search, tree, records) once per
 * scope and then focus the write-path coverage on the two editable lists.
 *
 * Non-obvious constraints learned from the live server (and encoded below):
 *
 *  - A *lone* allowed/blocked entry is returned by `<scope>/list?domain=` as
 *    its own apex records (NS + SOA), which `DomainTree` renders in a compact
 *    records table with NO per-row delete affordance. Two siblings under one
 *    parent, by contrast, come back as full-name zone nodes, each with a trash
 *    action whose `delete?domain=<fqdn>` actually removes the entry. The
 *    add/delete round-trip therefore creates two sub-domains of a unique
 *    `e2e-*` parent and drills to that parent so both render as deletable
 *    nodes. (Deleting a bare branch label such as `test` is an upstream no-op —
 *    see the final report.)
 *  - The cache scope is read-only: no add/import/export buttons, only eviction.
 *    Its *contents* are also volatile — an idle resolver caches nothing but its
 *    root hints — so the tree test creates its own precondition with a plain
 *    recursive `dnsClient/resolve` instead of assuming the server has seen
 *    recent traffic. See `warmResolverCache` for why that call must not carry
 *    `import=true`.
 *  - Search re-roots the tree on `currentDomain`; an empty subtree at a
 *    non-empty domain must show the "no match" state, never the scope-level
 *    "list is empty" state — the two look similar and the distinction is the
 *    whole point of the `filterActive`/`domain` branch in `DomainTree`.
 *
 * Everything written to the server is `e2e-`-prefixed and purged in `afterAll`
 * straight against Technitium (mirroring `global-teardown.ts`), so a mid-test
 * failure cannot orphan an entry on the operator's real list.
 */

type EditableScope = 'allowed' | 'blocked'

/** Domains this file created, purged after the run regardless of test outcome. */
const created: { scope: EditableScope; domain: string }[] = []

test.afterAll(async () => {
  await purgeCreated()
})

/** A parent domain that cannot collide with real data, unique per call. */
function scratchParent(): string {
  return `${E2E_PREFIX}par-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}.test`
}

// ---------------------------------------------------------------------------
// Direct-to-Technitium cleanup. The console's own delete path is exercised in
// the tests; this is only the safety net for entries a failed test left behind.
// ---------------------------------------------------------------------------

async function dnsToken(): Promise<string | null> {
  const response = await fetch(`${E2E.dnsUrl}/api/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user: E2E.user, pass: E2E.pass }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!response || !response.ok) return null
  const parsed = (await response.json()) as { status?: string; token?: string }
  return parsed.status === 'ok' && parsed.token ? parsed.token : null
}

async function purgeCreated(): Promise<void> {
  if (created.length === 0) return
  const token = await dnsToken()
  if (!token) return
  for (const { scope, domain } of created) {
    const query = new URLSearchParams({ domain })
    await fetch(`${E2E.dnsUrl}/api/${scope}/delete?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined)
  }
}

/** How many *zone* nodes the resolver cache currently has at its root. */
async function cacheRootZoneCount(token: string): Promise<number> {
  const response = await fetch(`${E2E.dnsUrl}/api/cache/list`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!response || !response.ok) return -1
  const parsed = (await response.json()) as { status?: string; response?: { zones?: unknown[] } }
  return parsed.status === 'ok' ? (parsed.response?.zones?.length ?? 0) : -1
}

/**
 * Make the resolver cache hold at least one zone node, and report how many it
 * ended up with (`-1` when the server could not be reached at all).
 *
 * The tree's expand chevron only renders on *zone* rows, and a long-idle
 * resolver holds nothing but its root hints — which `cache/list` returns under
 * `records`, not `zones`. Asserting "the first row expands" against that state
 * measures the server's recent traffic instead of the console, which is exactly
 * how this test came to fail on an otherwise correct page.
 *
 * Two facts about how the cache is warmed, both measured against the live
 * server:
 *
 *  - `import=true` must NEVER be sent. Upstream documents it as "Importing all
 *    the records from the response of this query will add them into an existing
 *    primary or conditional forwarder zone. If a matching zone does not exist,
 *    a new primary zone for '<domain>' will be created."
 *    (`.probe/console-js/dnsclient.js:149-152`) — it writes *authoritative
 *    zones*, not cache entries, and a test that sent it left real junk zones on
 *    the operator's server for `global-teardown.ts` to sweep.
 *  - Resolving a domain the server is authoritative for does not cache either
 *    (the answer comes straight from the zone), so the warm-up has to recurse.
 *    That makes internet reachability a genuine precondition; when it is
 *    missing the assertion below names the real reason instead of failing on a
 *    missing chevron.
 *
 * `www.iana.org` is IANA-operated and stable, and a cached answer is
 * TTL-bounded — unlike the allowed/blocked writes below it needs no cleanup and
 * cannot orphan anything.
 */
async function warmResolverCache(): Promise<number> {
  const token = await dnsToken()
  if (!token) return -1
  const query = new URLSearchParams({
    server: 'this-server',
    domain: 'www.iana.org',
    type: 'A',
    protocol: 'Udp',
    dnssec: 'false',
  })
  await fetch(`${E2E.dnsUrl}/api/dnsClient/resolve?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined)
  return cacheRootZoneCount(token)
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Open the add-domain dialog, submit one domain, wait for it to close. */
async function addDomainViaDialog(page: Page, domain: string): Promise<void> {
  await page.getByRole('button', { name: '添加域名' }).click()
  const dialog = page.locator('[role="dialog"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('#add-domain').fill(domain)
  await dialog.getByRole('button', { name: '添加', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

/** Delete a full-name tree node through its trash action + confirm dialog. */
async function deleteNodeViaUi(page: Page, fqdn: string): Promise<void> {
  const node = page.locator(`button[title="${fqdn}"]`)
  const row = page.locator('div.group').filter({ has: node })
  // The trash button is opacity-0 until the row is hovered; hovering first also
  // guarantees we click the action belonging to *this* node.
  await row.hover()
  await row.getByRole('button', { name: '删除' }).click()

  const confirm = page.locator('[role="alertdialog"]')
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText(fqdn)
  await confirm.getByRole('button', { name: '删除', exact: true }).click()
  await expect(confirm).toBeHidden({ timeout: 20_000 })
}

// ---------------------------------------------------------------------------
// Scope rendering
// ---------------------------------------------------------------------------

test.describe('filtering scopes render', () => {
  const cases = [
    { path: '/cache', title: '缓存' },
    { path: '/allowed', title: '允许列表' },
    { path: '/blocked', title: '阻止列表' },
  ] as const

  for (const { path, title } of cases) {
    test(`${path} renders the ${title} surface`, async ({ page }) => {
      const watcher = watchConsole(page)
      await gotoConsole(page, path)

      await expect(moduleTitle(page)).toHaveText(title)
      // The search field and the running total are present on every scope.
      await expect(page.getByPlaceholder('按域名搜索…')).toBeVisible()
      await expect(page.getByText(/共\s*\d+\s*个域名/).first()).toBeVisible()

      watcher.expectClean(path)
    })
  }

  test('cache is read-only while allowed/blocked expose add + import', async ({ page }) => {
    const watcher = watchConsole(page)

    await gotoConsole(page, '/cache')
    await expect(page.getByRole('button', { name: '添加域名' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '批量导入' })).toHaveCount(0)

    await gotoConsole(page, '/allowed')
    await expect(page.getByRole('button', { name: '添加域名' })).toBeVisible()
    await expect(page.getByRole('button', { name: '批量导入' })).toBeVisible()

    watcher.expectClean('read-only vs editable')
  })
})

// ---------------------------------------------------------------------------
// Cache tree
// ---------------------------------------------------------------------------

test.describe('cache tree', () => {
  test('records render monospace and zone nodes expand', async ({ page }) => {
    const watcher = watchConsole(page)

    // Warmed before the navigation on purpose: the page's first `cache/list`
    // is what decides whether any expandable zone row exists at all.
    const zones = await warmResolverCache()
    expect(zones, 'resolver cache holds no zone node to expand').toBeGreaterThan(0)

    await gotoConsole(page, '/cache')

    // A live resolver's cache root carries NS/SOA records; `DomainTree` renders
    // them in a compact data table whose cells use the `.font-data` mono class.
    const table = page.locator('[data-slot="data-table"]').first()
    await expect(table).toBeVisible({ timeout: 20_000 })
    // The cache root's NS records have an empty owner name, so the first
    // `.font-data` cell can be blank; assert a populated one (a type badge or
    // rData value) is rendered monospace instead.
    await expect(table.locator('.font-data').filter({ hasText: /\S/ }).first()).toBeVisible()

    // Zone nodes are expandable: click the chevron and assert it flips to
    // expanded, then that a nested (indented) level is fetched into view.
    const treeSurface = page.locator('[data-slot="page-shell"] .surface.rounded-lg').first()
    const firstRow = treeSurface.locator('div.group').first()
    const chevron = firstRow.locator('button[aria-expanded]')
    await expect(chevron).toBeVisible({ timeout: 20_000 })
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')
    await chevron.click()
    await expect(chevron).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('div.ml-4.border-l').first()).toBeVisible({ timeout: 20_000 })

    watcher.expectClean('cache tree')
  })

  test('searching an uncached domain shows "no match", not the empty-list state', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/cache')

    const bogus = `${E2E_PREFIX}missing-${Date.now().toString(36)}.invalid`
    await page.getByPlaceholder('按域名搜索…').fill(bogus)

    // Re-rooting on a domain with no subtree is the NoResultsState branch: the
    // title is the generic "no match" copy and the body names the domain. The
    // scope-level "cache is empty" state must NOT appear — that would claim the
    // whole resolver cache is unset, which the visible entries contradict.
    await expect(page.getByText('没有匹配的结果')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(bogus).first()).toBeVisible()
    await expect(page.getByText('解析器缓存当前为空')).toHaveCount(0)

    // Drilling in also surfaces the "back" affordance.
    await expect(page.getByRole('button', { name: '返回' })).toBeVisible()

    watcher.expectClean('cache search no-match')
  })
})

// ---------------------------------------------------------------------------
// Add-domain dialog validation (no writes)
// ---------------------------------------------------------------------------

test.describe('add-domain dialog', () => {
  test('validates the domain format before arming submit', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/allowed')

    await page.getByRole('button', { name: '添加域名' }).click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('添加域名').first()).toBeVisible()

    const input = dialog.locator('#add-domain')
    const submit = dialog.getByRole('button', { name: '添加', exact: true })

    // A space is not legal in a label -> invalid once the field is touched.
    await input.fill('not a domain')
    await input.blur()
    await expect(dialog.getByText('域名格式不正确')).toBeVisible()
    await expect(submit).toBeDisabled()

    // Emptying a touched field swaps to the required-field message.
    await input.fill('')
    await input.blur()
    await expect(dialog.getByText('此项为必填')).toBeVisible()
    await expect(submit).toBeDisabled()

    // A well-formed domain clears the error and arms submit.
    await input.fill(`${E2E_PREFIX}valid.test`)
    await expect(dialog.getByText('域名格式不正确')).toHaveCount(0)
    await expect(dialog.getByText('此项为必填')).toHaveCount(0)
    await expect(submit).toBeEnabled()

    // Cancel: nothing is written.
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()

    watcher.expectClean('add dialog validation')
  })
})

// ---------------------------------------------------------------------------
// Import dialog (opens + cancels, never imports)
// ---------------------------------------------------------------------------

test.describe('import-domains dialog', () => {
  test('opens, previews the parsed count, and cancels without importing', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/allowed')

    await page.getByRole('button', { name: '批量导入' }).click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('批量导入域名').first()).toBeVisible()

    const textarea = dialog.locator('#import-domains')
    await expect(textarea).toBeVisible()
    // The drop target is advertised; we never feed it a file.
    await expect(dialog.getByText('拖放文本文件到此处，或点击选择')).toBeVisible()

    const submit = dialog.getByRole('button', { name: '导入', exact: true })
    // Nothing parsed yet -> submit is disabled.
    await expect(submit).toBeDisabled()

    // Typing a list shows the live parsed count and arms submit — but we cancel,
    // so no `allowed/import` call is ever made.
    await textarea.fill(`${E2E_PREFIX}import-a.test\n${E2E_PREFIX}import-b.test`)
    await expect(dialog.getByText('已识别 2 个域名')).toBeVisible()
    await expect(submit).toBeEnabled()

    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(dialog).toBeHidden()

    watcher.expectClean('import dialog')
  })
})

// ---------------------------------------------------------------------------
// Add -> appears -> delete -> gone, on both editable scopes
// ---------------------------------------------------------------------------

function addDeleteRoundTrip(scope: EditableScope, path: '/allowed' | '/blocked', title: string) {
  test(`${scope}: add two e2e sub-domains, then delete one through the tree`, async ({ page }) => {
    const watcher = watchConsole(page)

    const parent = scratchParent()
    const childA = `a.${parent}`
    const childB = `b.${parent}`
    // Track every name so afterAll can purge leftovers from a failed run.
    created.push({ scope, domain: childA }, { scope, domain: childB }, { scope, domain: parent })

    await gotoConsole(page, path)
    await expect(moduleTitle(page)).toHaveText(title)

    await addDomainViaDialog(page, childA)
    await addDomainViaDialog(page, childB)

    // Drill to the shared parent: with two siblings present the server returns
    // them as full-name zone nodes, each with a working trash action.
    await page.getByPlaceholder('按域名搜索…').fill(parent)
    const nodeA = page.locator(`button[title="${childA}"]`)
    const nodeB = page.locator(`button[title="${childB}"]`)
    await expect(nodeA).toBeVisible({ timeout: 20_000 })
    await expect(nodeB).toBeVisible()

    await deleteNodeViaUi(page, childA)

    // childA is gone entirely. childB, now a lone entry under the parent,
    // collapses back to apex records — still listed, but no longer a node.
    await expect(page.locator(`button[title="${childA}"]`)).toHaveCount(0, { timeout: 20_000 })
    await expect(page.locator('.font-data').filter({ hasText: childA })).toHaveCount(0)
    await expect(page.locator('.font-data').filter({ hasText: childB }).first()).toBeVisible({ timeout: 20_000 })

    watcher.expectClean(`${scope} add/delete`)
  })
}

test.describe('allowed/blocked write path', () => {
  addDeleteRoundTrip('allowed', '/allowed', '允许列表')
  addDeleteRoundTrip('blocked', '/blocked', '阻止列表')
})
