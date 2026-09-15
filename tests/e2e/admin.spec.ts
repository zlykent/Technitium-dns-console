import { expect, test as base, type Locator, type Page, type Route } from '@playwright/test'
import { E2E, E2E_PREFIX } from './env'
import { captureApiCalls, gotoConsole, moduleTitle, settle, watchConsole } from './helpers'

/**
 * Administration — users, groups, permissions, sessions, SSO and the cluster.
 *
 * What this file guards:
 *
 *  - The six tabs are lazy. `AdminView` mounts one `TabsContent` at a time, so
 *    opening `/admin` must fetch `admin/users/list` and *nothing* else. A panel
 *    that hoisted its query into the page would fire all six on every visit.
 *  - Each read-only table is a faithful mirror of its endpoint. The strongest
 *    assertion compares rendered cells against a direct Technitium call, because
 *    a table that draws *something* plausible is exactly the failure a
 *    screenshot cannot show.
 *  - Users/groups/sessions search and filter entirely in the browser
 *    (`filtered` memos), so those keystrokes must produce zero proxy traffic. A
 *    filter that quietly re-fetched would look identical until the server
 *    disagreed.
 *  - The self-protection rules upstream does not enforce: `admin` cannot be
 *    deleted or disabled from its own session, and the current session cannot be
 *    revoked from its own row.
 *  - Every dialog validates client-side before spending a round trip, and every
 *    write that does go out reaches the endpoint it claims to.
 *
 * Why the shape is what it is:
 *
 *  - This drives a **live production DNS server**. Every mutation therefore
 *    targets a fixture created here and named `e2e-<base36 timestamp>`, and the
 *    `guard` fixture below blocks — at the network layer, before the request
 *    leaves the browser — anything that could touch a pre-existing account, a
 *    session, the SSO configuration or the cluster. The cluster and SSO tabs are
 *    read-only on purpose: initialising a cluster rewrites this machine's
 *    network identity and a bad `sso/set` locks everybody out.
 *  - Confirm dialogs for destructive bulk actions are *opened and cancelled*,
 *    never confirmed. Asserting the copy and the disabled-until-typed arm is
 *    what the operator actually sees; confirming it would delete live sessions.
 *  - `workers: 1` + `fullyParallel: false` make `describe.serial` a real
 *    guarantee, so the lifecycle block can create a user in one test and delete
 *    it eleven tests later.
 *  - `globalTeardown` only sweeps zones, and `E2E_SKIP_TEARDOWN=1` disables it
 *    entirely, so the file-level `afterAll` deletes every `e2e-*` user and group
 *    over the Technitium API instead of trusting the last UI test to run.
 *  - The write-path tests at the bottom assert what the UI *sends*, not merely
 *    that a toast appeared: `admin/*` answers `status: ok` to a parameter it
 *    does not recognise and then changes nothing, so a payload that silently
 *    does nothing still looks like a success on screen. Three of them were
 *    originally written as `test.fail()` markers against known defects and now
 *    pin the fixed behaviour instead.
 */

/* ------------------------------------------------------------------ */
/* Fixtures this run owns                                              */
/* ------------------------------------------------------------------ */

const RUN = Date.now().toString(36)

/** The only account this file is allowed to create, edit and delete. */
const USER = `${E2E_PREFIX}u-${RUN}`
/** The only group this file is allowed to create, grant and delete. */
const GROUP = `${E2E_PREFIX}g-${RUN}`
const TOKEN_NAME = `${E2E_PREFIX}tok-${RUN}`
const DISPLAY = `E2E 账户 ${RUN}`
const DISPLAY_EDITED = `E2E 账户 ${RUN} 已改名`
const PASSWORD = `e2e-pass-${RUN}`

/**
 * The section whose ACL is written to.
 *
 * `Dashboard` and never `Administration`: `admin/permissions/set` is a full
 * replace, and clobbering the Administration grant would 403 every panel of the
 * very page under test with no way back except another administrator.
 */
const SECTION = 'Dashboard'
const SECTION_LABEL = '仪表盘'

/** `admin.json:users.columns.*`, in render order. */
const USER_COLUMNS = ['显示名', '用户名', '来源', '两步验证', '状态', '最近登录', '操作']
/** `admin.json:groups.columns.*`. */
const GROUP_COLUMNS = ['名称', '描述', '成员', '操作']
/** `admin.json:permissions.sectionLabel` + `common.json:fields.*`. */
const PERMISSION_COLUMNS = ['权限分节', '状态', '用户权限', '用户组权限', '操作']
/** `admin.json:sessions.columns.*`. */
const SESSION_COLUMNS = ['用户', '类型', '令牌名称', '令牌指纹', '最近活动', '来源地址', '客户端', '操作']

/** `admin.json:permissions.sections.*.label`, keyed by the wire section name. */
const SECTION_LABELS: Record<string, string> = {
  Administration: '管理',
  Allowed: '允许列表',
  Apps: '应用',
  Blocked: '阻止列表',
  Cache: '缓存',
  Dashboard: '仪表盘',
  DhcpServer: 'DHCP 服务器',
  DnsClient: 'DNS 客户端',
  Logs: '日志',
  Settings: '设置',
  Zones: '区域',
}

/** Every label the users table's status column can produce. */
const PERMISSION_STATUS_LABELS = ['无', '只读', '完全控制']

/**
 * `admin.json:cluster.nodes.states.*` — the only three values a v15.4
 * `clusterNodes[].state` carries. An earlier pass listed `Online`/`Offline`/
 * `Syncing`, which the server never sends, so the map matched nothing and every
 * comparison silently fell through to the raw wire value.
 */
const NODE_STATES: Record<string, string> = {
  Self: '本机',
  Connected: '已连接',
  Unreachable: '不可达',
}

/** `admin.json:cluster.nodes.types.*`. */
const NODE_TYPES: Record<string, string> = {
  Primary: '主节点',
  Secondary: '辅助节点',
}

/**
 * This machine's row, the way the stock console finds it.
 *
 * There is no `isPrimaryNode` and no `clusterPrimaryNodeName` on the wire —
 * `state: 'Self'` is the only marker that exists, and the role comes from that
 * row's `type`. The spec derives both the same way the panel does; asserting
 * against a field the response never had would pass vacuously forever.
 */
function selfNodeType(state: ClusterStatePayload): string | undefined {
  return (state.clusterNodes ?? []).find((node) => node.state === 'Self')?.type
}

function primaryNodeName(state: ClusterStatePayload): string | undefined {
  return (state.clusterNodes ?? []).find((node) => node.type === 'Primary')?.name
}

/* ------------------------------------------------------------------ */
/* The write guard                                                     */
/* ------------------------------------------------------------------ */

const PROXY = '/api/dns/'

/**
 * Endpoints that must never be reached, whatever the UI does.
 *
 * Blocking happens in `page.route`, i.e. before the request leaves the browser:
 * an assertion that runs *after* the fact would only report that the production
 * server had already been reconfigured.
 */
const NEVER = new Set([
  'admin/sso/set',
  'admin/sessions/delete',
  'admin/cluster/init',
  'admin/cluster/initJoin',
  'admin/cluster/primary/delete',
  'admin/cluster/primary/setOptions',
  'admin/cluster/primary/deleteSecondary',
  'admin/cluster/primary/removeSecondary',
  'admin/cluster/secondary/leave',
  'admin/cluster/secondary/promote',
  'admin/cluster/secondary/resync',
  'admin/cluster/secondary/updatePrimary',
  'admin/cluster/updateIpAddress',
])

export interface WriteGuard {
  /** Requests the guard refused, with the reason. Must stay empty. */
  readonly blocked: string[]
}

/** Why a request may not proceed, or `null` when it may. */
function guardVerdict(endpoint: string, url: URL, body: string): string | null {
  if (NEVER.has(endpoint)) return 'on the never-touch list'

  // `create`/`set` on users travel as a form-encoded POST body; the rest as
  // query parameters. Both spellings have to be checked or the guard has a hole.
  const param = (name: string): string | null => url.searchParams.get(name) ?? bodyField(body, name)

  switch (endpoint) {
    case 'admin/users/create':
    case 'admin/users/set':
    case 'admin/users/delete':
    case 'admin/sessions/createToken':
      return fixtureOnly(param('user'), 'user')
    case 'admin/groups/create':
    case 'admin/groups/set':
    case 'admin/groups/delete':
      return fixtureOnly(param('group'), 'group')
    case 'admin/permissions/set':
      return param('section') === 'Administration' ? 'refusing to rewrite the Administration ACL' : null
    default:
      return null
  }
}

function fixtureOnly(value: string | null, label: string): string | null {
  if (value === null) return `${label} parameter missing`
  return value.startsWith(E2E_PREFIX) ? null : `${label}=${value} is not an ${E2E_PREFIX} fixture`
}

function bodyField(body: string, name: string): string | null {
  const match = new RegExp(`(?:^|&)${name}=([^&]*)`).exec(body)
  return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null
}

async function installWriteGuard(page: Page): Promise<WriteGuard> {
  const blocked: string[] = []

  await page.route(
    (url) => url.pathname.startsWith(`${PROXY}admin/`),
    async (route: Route) => {
      const request = route.request()
      const url = new URL(request.url())
      const endpoint = url.pathname.slice(PROXY.length)
      const verdict = guardVerdict(endpoint, url, request.postData() ?? '')
      if (verdict === null) {
        await route.continue()
        return
      }
      blocked.push(`${endpoint} — ${verdict}`)
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'error', errorMessage: `blocked by the e2e write guard: ${verdict}` }),
      })
    },
  )

  return { blocked }
}

/**
 * Auto, not opt-in: a guard only on the tests that remembered to ask for it is
 * no guard at all.
 */
const test = base.extend<{ guard: WriteGuard }>({
  guard: [
    async ({ page }, use) => {
      const guard = await installWriteGuard(page)
      await use(guard)
      expect(guard.blocked, 'the write guard refused a request this spec must never make').toEqual([])
    },
    { auto: true },
  ],
})

/**
 * Sweep every fixture this file may have left behind.
 *
 * Prefix-scoped rather than list-scoped on purpose: a test that crashed before
 * recording its creation still gets cleaned up, which is the whole reason this
 * hook exists.
 */
test.afterAll(async () => {
  const token = await apiToken()
  if (token === null) return

  for (const user of (await serverUserNames(token)).filter((name) => name.startsWith(E2E_PREFIX))) {
    await apiCall(token, 'admin/users/delete', { user })
  }
  for (const group of (await serverGroupNames(token)).filter((name) => name.startsWith(E2E_PREFIX))) {
    await apiCall(token, 'admin/groups/delete', { group })
  }
})

/* ------------------------------------------------------------------ */
/* Read-only coverage                                                  */
/* ------------------------------------------------------------------ */

test.describe('administration — read only', () => {
  test('only the open tab fetches, and the page carries all six', async ({ page }) => {
    const watcher = watchConsole(page)
    const calls = await captureApiCalls(page, () => gotoConsole(page, '/admin'))

    await expect(moduleTitle(page)).toHaveText('管理')
    await expect(page.getByRole('tablist')).toBeVisible()

    const tabs = ['用户', '用户组', '权限', '会话', '单点登录', '集群']
    await expect(page.getByRole('tab')).toHaveCount(tabs.length)
    for (const label of tabs) {
      // `exact`: "用户" is a prefix of "用户组" and would otherwise match twice.
      await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('tab', { name: '用户', exact: true })).toHaveAttribute('aria-selected', 'true')
    // Radix unmounts inactive panels, so exactly one is in the DOM.
    await expect(page.getByRole('tabpanel')).toHaveCount(1)

    const hit = endpoints(calls)
    expect(hit).toContain('admin/users/list')
    for (const lazy of [
      'admin/groups/list',
      'admin/permissions/list',
      'admin/sessions/list',
      'admin/sso/get',
      'admin/cluster/state',
    ]) {
      expect(hit, `${lazy} must stay lazy`).not.toContain(lazy)
    }

    watcher.expectClean('admin skeleton')
  })

  test('the users table mirrors admin/users/list cell by cell', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    const users = await serverUsers(token)

    await gotoConsole(page, '/admin')
    const table = usersTable(page)

    const headers = table.locator('thead th')
    await expect(headers).toHaveCount(USER_COLUMNS.length)
    for (const [index, column] of USER_COLUMNS.entries()) {
      // `toContainText`: sortable headers append a screen-reader-only 排序依据.
      await expect(headers.nth(index)).toContainText(column)
    }

    // `clientPagination` slices at 25; the server holds one account today, but
    // the assertion has to stay true if that changes.
    const shown = users.slice(0, 25)
    await expect(dataRows(table)).toHaveCount(shown.length)

    for (const user of shown) {
      const row = rowFor(page, table, user.username)
      await expect(row).toBeVisible()
      expect(await cellText(row, 0)).toBe(user.displayName || '—')
      expect(await cellText(row, 2)).toBe(user.isSsoUser ? '单点登录' : '本地账户')
      expect(await cellText(row, 3)).toBe(user.totpEnabled ? '是' : '否')
      expect(await cellText(row, 4)).toBe(user.disabled ? '已禁用' : '已启用')
    }

    await expect(footerNote(page, `共 ${users.length} 个用户`)).toBeVisible()
    watcher.expectClean('users table')
  })

  test('searching and filtering users stays in the browser', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    const users = await serverUsers(token)

    await gotoConsole(page, '/admin')
    const table = usersTable(page)
    const search = page.getByLabel('按用户名或显示名搜索…')

    const bySearch = await captureApiCalls(page, async () => {
      await search.fill('admin')
      await expect(dataRows(table)).toHaveCount(1)
    })
    expect(adminCalls(bySearch), 'the search memo is client-side').toEqual([])

    // `filterActive` is what makes an empty result say "no match" instead of
    // "no users" — the second invites a duplicate of the account being sought.
    const noMatch = await captureApiCalls(page, async () => {
      await search.fill(`${E2E_PREFIX}nobody-here`)
      await expect(page.getByText('没有匹配的结果')).toBeVisible()
      await expect(dataRows(table)).toHaveCount(0)
    })
    expect(adminCalls(noMatch)).toEqual([])

    await search.fill('')
    for (const [option, matches] of [
      ['仅启用', users.filter((row) => !row.disabled)],
      ['仅禁用', users.filter((row) => row.disabled)],
      ['仅单点登录', users.filter((row) => row.isSsoUser)],
    ] as const) {
      const calls = await captureApiCalls(page, async () => {
        await selectOption(page, '筛选', option)
      })
      expect(adminCalls(calls), `${option} must not refetch`).toEqual([])
      await expect(dataRows(table)).toHaveCount(matches.length)
      await expect(footerNote(page, `共 ${matches.length} 个用户`)).toBeVisible()
      if (matches.length === 0) await expect(page.getByText('没有匹配的结果')).toBeVisible()
    }

    watcher.expectClean('users filtering')
  })

  test('the signed-in account cannot be deleted or disabled', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')
    const row = rowFor(page, usersTable(page), 'admin')

    const edited = await captureApiCalls(page, async () => {
      await openRowMenu(page, row)
      await page.getByRole('menuitem', { name: '编辑' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: '编辑用户 — admin' })).toBeVisible()
      // The username is the primary key upstream; renaming is a separate field.
      await expect(dialog.locator('#ud-user')).toBeDisabled()
      await expect(dialog.locator('#ud-user')).toHaveValue('admin')
      await expect(dialog.locator('#ud-new-username')).toBeVisible()
      // Disabling yourself would end the session mid-request.
      await expect(dialog.locator('#ud-disabled')).toBeDisabled()
      await expect(dialog.getByText('不能禁用当前登录的账户')).toBeVisible()
      // Read-only: `SetUserParams` has no `ssoManagedGroups` field.
      await expect(dialog.locator('#ud-sso-groups')).toBeDisabled()

      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(dialog).toBeHidden()
      // The menu that opened the dialog is still mounted — see `dismissRowMenu`.
      await dismissRowMenu(page)
    })
    expect(endpoints(edited)).not.toContain('admin/users/set')

    await openRowMenu(page, row)
    const remove = page.getByRole('menuitem', { name: '不能删除当前登录的账户' })
    await expect(remove).toBeVisible()
    await expect(remove).toBeDisabled()
    // The plain label must not exist for this row, or the guard is decorative.
    await expect(page.getByRole('menuitem', { name: '删除', exact: true })).toHaveCount(0)
    // TOTP was never enabled here and an administrator cannot enable it for
    // another account, so the reset entry has no business showing up.
    await expect(page.getByRole('menuitem', { name: '重置两步验证' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    watcher.expectClean('self protection')
  })

  test('the user detail pane lists live sessions and protects the current one', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')

    await openRowMenu(page, rowFor(page, usersTable(page), 'admin'))
    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('menuitem', { name: '详情' }).click()
      await dismissRowMenu(page)
    })
    // The list endpoint carries no sessions, so selecting a row must fetch one.
    expect(endpoints(calls)).toContain('admin/users/get')

    const pane = page
      .locator('[data-slot="section"]')
      .filter({ has: page.getByRole('heading', { name: 'admin 的详细信息' }) })
    await expect(pane).toBeVisible()
    await expect(pane.locator('[data-slot="definition-list"] dt')).toHaveCount(9)
    await expect(pane.getByRole('heading', { name: 'admin 的活动会话' })).toBeVisible()

    const current = pane.locator('li').filter({ hasText: '当前会话' }).first()
    await expect(current).toBeVisible()
    // Killing your own session would invalidate the request that asked for it.
    await expect(current.getByRole('button', { name: '撤销' })).toHaveCount(0)

    // The bulk dialog is opened and cancelled: confirming it would sign out
    // every session on the server, including this one.
    const bulk = await captureApiCalls(page, async () => {
      await pane.getByRole('button', { name: '撤销全部会话' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toBeVisible()
      await expect(confirm.getByText('确定要撤销 admin 的全部会话吗？该用户会被立即登出。')).toBeVisible()
      await expect(confirm.getByText('你当前正在使用的会话会被保留，以免把自己锁在控制台之外。')).toBeVisible()
      await confirm.getByRole('button', { name: '取消' }).click()
      await expect(confirm).toBeHidden()
    })
    expect(endpoints(bulk)).not.toContain('admin/sessions/delete')

    await pane.getByRole('button', { name: '关闭' }).click()
    await expect(pane).toBeHidden()

    watcher.expectClean('user detail')
  })

  test('the new-user dialog validates before it spends a round trip', async ({ page }) => {
    const watcher = watchConsole(page)
    const calls = await captureApiCalls(page, async () => {
      await gotoConsole(page, '/admin')
      await page.getByRole('button', { name: '新建用户' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: '新建用户' })).toBeVisible()

      await dialog.getByRole('button', { name: '创建用户' }).click()
      await expect(dialog.getByText('此项为必填')).toHaveCount(3)
      await expect(dialog).toBeVisible()

      await dialog.locator('#ud-user').fill(USER)
      await dialog.locator('#ud-pass').fill('short')
      await dialog.locator('#ud-confirm').fill('short')
      await dialog.getByRole('button', { name: '创建用户' }).click()
      await expect(dialog.getByText('密码至少需要 8 个字符')).toBeVisible()

      // Reported only once the password is long enough — otherwise both errors
      // fire and the operator fixes the wrong one first.
      await dialog.locator('#ud-pass').fill(`${PASSWORD}-a`)
      await dialog.locator('#ud-confirm').fill(`${PASSWORD}-b`)
      await dialog.getByRole('button', { name: '创建用户' }).click()
      await expect(dialog.getByText('两次输入的密码不一致')).toBeVisible()
      await expect(dialog.getByText('密码至少需要 8 个字符')).toHaveCount(0)

      // Create mode cannot disable: `admin/users/create` has no such parameter.
      await expect(dialog.locator('#ud-disabled')).toBeDisabled()
      // Nor can it enable 2FA — the endpoint takes no `totpEnabled` either, and
      // upstream refuses an administrator turning it on for somebody else in any
      // case. A switch that could be flipped here would be silently dropped from
      // the request, so it is locked and the help text carries the reason.
      await expect(dialog.locator('#ud-totp')).toBeDisabled()
      await expect(dialog.locator('#ud-totp')).not.toBeChecked()
      await expect(dialog).toContainText('管理员无法为他人开启两步验证')
      // Group membership only exists once the account does.
      await expect(dialog.getByText('所属用户组')).toHaveCount(0)

      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(dialog).toBeHidden()
    })

    expect(adminEndpoints(calls)).toEqual(['admin/users/list'])
    watcher.expectClean('user dialog validation')
  })

  test('the groups table mirrors the server and its dialog validates first', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    const groups = await serverGroups(token)

    await gotoConsole(page, '/admin')
    await openTab(page, '用户组')
    const table = groupsTable(page)

    const headers = table.locator('thead th')
    await expect(headers).toHaveCount(GROUP_COLUMNS.length)
    for (const [index, column] of GROUP_COLUMNS.entries()) {
      await expect(headers.nth(index)).toContainText(column)
    }

    await expect(dataRows(table)).toHaveCount(groups.length)
    for (const [index, group] of groups.entries()) {
      const row = dataRows(table).nth(index)
      expect(await cellText(row, 0)).toBe(group.name)
      expect(await cellText(row, 1)).toBe(group.description || '—')
    }
    await expect(footerNote(page, `共 ${groups.length} 个用户组`)).toBeVisible()

    // `admin/groups/list` has no members; the column is a lazy trigger instead.
    const inspected = await cellText(dataRows(table).first(), 0)
    const members = await captureApiCalls(page, async () => {
      await dataRows(table).first().getByRole('button', { name: '查看成员' }).click()
    })
    expect(adminCalls(members)).toContain('admin/groups/get')
    await expect(page.getByRole('heading', { name: `用户组 ${inspected} 的成员` })).toBeVisible()
    await page.getByRole('button', { name: '关闭' }).click()

    const searched = await captureApiCalls(page, async () => {
      await page.getByLabel('按名称搜索…').fill(`${E2E_PREFIX}nobody-here`)
      await expect(page.getByText('没有匹配的结果')).toBeVisible()
    })
    expect(adminCalls(searched)).toEqual([])
    await page.getByLabel('按名称搜索…').fill('')

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '新建用户组' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: '新建用户组' })).toBeVisible()

      await dialog.getByRole('button', { name: '创建用户组' }).click()
      await expect(dialog.getByText('请填写用户组名称')).toBeVisible()

      // Nothing picked yet, so the add button stays inert rather than adding "".
      await expect(dialog.getByRole('button', { name: '添加成员' })).toBeDisabled()
      await expect(dialog.getByText('该用户组还没有成员')).toBeVisible()

      await dialog.locator('#gd-name').fill(GROUP)
      await dialog.locator('#gd-description').fill('由 E2E 规格创建')
      await selectOption(page, '选择用户…', 'admin')
      await expect(dialog.getByRole('button', { name: '添加成员' })).toBeEnabled()
      await dialog.getByRole('button', { name: '添加成员' }).click()
      await expect(dialog.getByRole('button', { name: '移除 — admin' })).toBeVisible()
      // The picker resets so the same user cannot be granted twice.
      await expect(dialog.getByRole('button', { name: '添加成员' })).toBeDisabled()

      await dialog.getByRole('button', { name: '移除 — admin' }).click()
      await expect(dialog.getByText('该用户组还没有成员')).toBeVisible()

      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(dialog).toBeHidden()
    })

    expect(endpoints(calls)).not.toContain('admin/groups/create')
    expect(endpoints(calls)).not.toContain('admin/groups/set')
    watcher.expectClean('groups panel')
  })

  test('the permissions overview lists every section the server reports', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    const sections = await serverSections(token)

    await gotoConsole(page, '/admin')
    await openTab(page, '权限')
    const table = permissionsTable(page)

    const headers = table.locator('thead th')
    await expect(headers).toHaveCount(PERMISSION_COLUMNS.length)
    for (const [index, column] of PERMISSION_COLUMNS.entries()) {
      await expect(headers.nth(index)).toContainText(column)
    }

    // The server orders sections its own way, which is not `PERMISSION_SECTIONS`.
    expect(sections.map((row) => row.section).sort()).toEqual(Object.keys(SECTION_LABELS).sort())
    await expect(dataRows(table)).toHaveCount(sections.length)

    for (const [index, entry] of sections.entries()) {
      const row = dataRows(table).nth(index)
      expect(await cellText(row, 0)).toContain(SECTION_LABELS[entry.section])
      expect(await cellText(row, 2)).toBe(String(entry.userPermissions.length))
      expect(await cellText(row, 3)).toBe(String(entry.groupPermissions.length))
      // The status column is the *viewer's own* grant, not the row's contents.
      expect(PERMISSION_STATUS_LABELS).toContain(await cellText(row, 1))
    }
    await expect(footerNote(page, '每个分节独立授权；未授予任何权限的用户看不到对应页面。')).toBeVisible()

    // `permissions/list` carries no picker lists; only `permissions/get` does,
    // and selecting a section is what triggers the second call.
    const chosen = await captureApiCalls(page, async () => {
      await selectOption(page, '权限分节', SECTION_LABEL)
    })
    expect(chosen.some((url) => url.includes('/api/dns/admin/permissions/get') && url.includes(`section=${SECTION}`))).toBe(true)

    await expect(page.getByRole('heading', { name: '用户权限' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '用户组权限' })).toBeVisible()
    await expect(page.getByText('区域级权限可在每个区域的“权限”标签页中单独细化。')).toBeVisible()

    // `withFlag` couples the three boxes asymmetrically, and the asymmetry is
    // exactly what an operator gets wrong: granting modify implies view, but
    // revoking modify leaves view alone — only revoking view cascades down.
    // Everything here is local state; selecting another section below discards
    // it, and only `保存权限` would write.
    const view = page.getByRole('checkbox', { name: '查看: Administrators' })
    const modify = page.getByRole('checkbox', { name: '修改: Administrators' })
    await expect(view).toBeChecked()
    await expect(modify).toBeChecked()

    await modify.click()
    await expect(modify).not.toBeChecked()
    await expect(view, 'revoking modify must not revoke view').toBeChecked()

    await modify.click()
    await expect(modify).toBeChecked()

    await view.click()
    await expect(view).not.toBeChecked()
    await expect(modify, 'revoking view must revoke modify').not.toBeChecked()
    await expect(page.getByText('勾选修改会自动包含查看权限')).toBeVisible()

    // The self-lockout warning is the reason `Administration` is never written to.
    await selectOption(page, '权限分节', '管理')
    await expect(
      page.getByText('警告：你正在编辑的授权包含你自己的账户或所属用户组，保存后可能立即失去本页面的访问权限。'),
    ).toBeVisible()

    // Opened, read, cancelled. Confirming would clear the section for everyone.
    const reset = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '重置为默认' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toBeVisible()
      await expect(confirm.getByText('将清空该分节的全部授权，除管理员外无人可以访问。确定继续？')).toBeVisible()
      await expect(
        confirm.getByText('警告：你正在编辑的授权包含你自己的账户或所属用户组，保存后可能立即失去本页面的访问权限。'),
      ).toBeVisible()
      await confirm.getByRole('button', { name: '取消' }).click()
      await expect(confirm).toBeHidden()
    })
    expect(endpoints(reset)).not.toContain('admin/permissions/set')

    watcher.expectClean('permissions panel')
  })

  test('the overview edit button carries the operator down to the editor', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')
    await openTab(page, '权限')
    const table = permissionsTable(page)
    await dataRows(table).first().waitFor()

    // Eleven section rows fill a 720px viewport, so the editor card starts
    // below the fold and a selection that does not scroll reads as a dead
    // click. The pre-assertion keeps the test honest about that setup.
    const editorHeading = page.getByRole('heading', { name: '用户权限' })
    await expect(editorHeading).not.toBeInViewport()
    await dataRows(table).first().getByRole('button', { name: '编辑', exact: true }).click()
    await expect(editorHeading).toBeInViewport()

    watcher.expectClean('permissions edit scroll')
  })

  test('the sessions table is read-only and protects the current session', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    const sessions = await serverSessions(token)

    await gotoConsole(page, '/admin')
    await openTab(page, '会话')
    const table = sessionsTable(page)

    const headers = table.locator('thead th')
    await expect(headers).toHaveCount(SESSION_COLUMNS.length)
    for (const [index, column] of SESSION_COLUMNS.entries()) {
      await expect(headers.nth(index)).toContainText(column)
    }

    await expect(dataRows(table)).toHaveCount(Math.min(sessions.length, 25))
    await expect(footerNote(page, `共 ${sessions.length} 个会话`)).toBeVisible()

    // Client-side pagination only appears once the inventory outgrows one page.
    if (sessions.length > 25) await expect(page.locator('[data-slot="pagination"]')).toBeVisible()
    else await expect(page.locator('[data-slot="pagination"]')).toHaveCount(0)

    // The badged row is *this* browser's session. The payload cannot name it:
    // `admin/sessions/list` was fetched with a different token than the console
    // cookie, so its `isCurrentSession` flags the wrong row.
    const current = dataRows(table).filter({ has: page.getByText('当前会话', { exact: true }) }).first()
    await expect(current).toBeVisible()
    // The fingerprint is masked on screen; `title` carries the recoverable half.
    const fingerprint = current.locator('td').nth(3).locator('span[title]').first()
    const partial = await fingerprint.getAttribute('title')
    expect(partial, 'a masked fingerprint keeps a 16-hex recoverable half').toMatch(/^[0-9a-f]{16}$/)
    await expect(fingerprint).toContainText(`${partial!.slice(0, 4)}${'•'.repeat(8)}${partial!.slice(-4)}`)

    // The row menu for your own session offers a token but never a revoke.
    await current.getByRole('button', { name: '更多' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: '创建 API 令牌' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '撤销', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // Searching by the fingerprint proves the memo matches on it, without
    // depending on which session the payload happens to call current.
    const searched = await captureApiCalls(page, async () => {
      await page.getByLabel('按用户名、地址或令牌指纹搜索…').fill(partial!)
      await expect(dataRows(table)).toHaveCount(1)
    })
    expect(adminCalls(searched), 'the session search is a memo, not a query').toEqual([])
    await page.getByLabel('按用户名、地址或令牌指纹搜索…').fill('')

    for (const [option, matches] of [
      ['仅标准会话', sessions.filter((row) => row.type === 'Standard')],
      ['仅 API 令牌', sessions.filter((row) => row.type === 'ApiToken')],
      ['全部类型', sessions],
    ] as const) {
      const calls = await captureApiCalls(page, async () => {
        await selectOption(page, '筛选', option)
      })
      expect(adminCalls(calls), `${option} must not refetch`).toEqual([])
      // The table paginates at 25 rows; a filtered total above that still shows
      // only the first page, while the footer note carries the true count.
      await expect(dataRows(table)).toHaveCount(Math.min(matches.length, 25))
      await expect(footerNote(page, `共 ${matches.length} 个会话`)).toBeVisible()
    }

    // Opened and cancelled: confirming would revoke every live session.
    const bulk = await captureApiCalls(page, async () => {
      await selectOption(page, '筛选', '全部类型')
      await page.getByRole('button', { name: '撤销全部会话' }).click()
      const confirm = page.getByRole('alertdialog')
      await expect(confirm).toBeVisible()
      await expect(
        confirm.getByText('这将登出所有用户并使全部 API 令牌失效，自动化脚本会立即中断。确定继续？'),
      ).toBeVisible()
      await expect(confirm.getByText('你当前正在使用的会话会被保留，以免把自己锁在控制台之外。')).toBeVisible()
      await confirm.getByRole('button', { name: '取消' }).click()
      await expect(confirm).toBeHidden()
    })
    expect(endpoints(bulk)).not.toContain('admin/sessions/delete')

    watcher.expectClean('sessions panel')
  })

  test('the SSO panel renders the stored configuration and never writes it', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    const sso = await serverSso(token)
    const groups = await serverGroupNames(token)

    const calls = await captureApiCalls(page, async () => {
      await gotoConsole(page, '/admin')
      // The group fallback hangs off the `sso/get` response, one React tick
      // behind it; `settle`'s idle gap can land exactly between the two, so the
      // second hop gets an explicit wait instead of a hope.
      const groupsList = page.waitForRequest((request) =>
        request.url().includes('/api/dns/admin/groups/list'),
      )
      await openTab(page, '单点登录')
      await groupsList
    })
    expect(endpoints(calls)).toContain('admin/sso/get')
    // `sso/get` never sends `includeGroups`, so `localGroups` is absent and the
    // mapping rows fall back to the group inventory.
    expect(endpoints(calls)).toContain('admin/groups/list')

    await expect(
      page.getByText('配置错误可能导致所有人都无法登录。建议保留一个本地管理员账户作为后备。'),
    ).toBeVisible()
    await expect(page.locator('#sso-enabled')).toBeChecked({ checked: sso.ssoEnabled })
    await expect(page.locator('#sso-authority')).toHaveValue(sso.ssoAuthority ?? '')
    await expect(page.locator('#sso-authority')).toHaveAttribute(
      'placeholder',
      'https://login.microsoftonline.com/<tenant>/v2.0',
    )
    await expect(page.locator('#sso-client-id')).toHaveValue(sso.ssoClientId ?? '')
    // The stored secret is write-only; the field is blank and the mask is a hint.
    await expect(page.locator('#sso-client-secret')).toHaveValue('')
    await expect(page.locator('#sso-scopes')).toHaveValue((sso.ssoScopes ?? []).join('\n'))
    await expect(page.locator('#sso-allow-signup')).toBeChecked({ checked: sso.ssoAllowSignup })
    await expect(page.locator('#sso-mapped-only')).toBeChecked({
      checked: sso.ssoAllowSignupOnlyForMappedUsers,
    })

    // The callback is derived from the *selected server profile*, not from
    // `window.location` — the console is not what the identity provider calls.
    await expect(page.locator('code').filter({ hasText: '/sso/callback' })).toHaveText(
      `${E2E.dnsUrl.replace(/\/+$/, '')}/sso/callback`,
    )
    // A disabled provider cannot be test-signed-in against.
    await expect(page.getByRole('button', { name: '测试登录' })).toBeDisabled()
    await expect(page.getByText('在新窗口中打开单点登录流程，验证配置是否可用。')).toBeVisible()

    await expect(page.getByText('尚未配置任何组映射')).toBeVisible()
    const mapped = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '添加映射' }).click()
      await page.getByLabel('身份提供方的组').fill(`${E2E_PREFIX}remote`)
      // The option list is read but nothing is chosen: picking a group and
      // saving would rewrite the production SSO mapping.
      await page.getByRole('combobox', { name: '本地用户组' }).click()
      await expect(page.getByRole('option')).toHaveCount(groups.length + 1)
      for (const group of groups) {
        await expect(page.getByRole('option', { name: group, exact: true })).toBeVisible()
      }
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: `移除 — ${E2E_PREFIX}remote` }).click()
      await expect(page.getByText('尚未配置任何组映射')).toBeVisible()
    })
    expect(endpoints(mapped)).not.toContain('admin/sso/set')

    // The save button exists and is reachable — clicking it is what is forbidden.
    await expect(page.getByRole('button', { name: '保存配置' })).toBeEnabled()

    watcher.expectClean('sso panel')
  })

  test('the cluster panel reports state and offers no way to change it', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    const state = await serverClusterState(token)

    const calls = await captureApiCalls(page, async () => {
      await gotoConsole(page, '/admin')
      await openTab(page, '集群')
    })
    expect(endpoints(calls)).toContain('admin/cluster/state')

    const definition = page.locator('[data-slot="definition-list"]')
    // Seven rows always; the four cluster intervals only exist once a cluster does.
    await expect(definition.locator('dt')).toHaveCount(state.clusterInitialized ? 11 : 7)
    expect(await definitionValue(page, '集群状态')).toBe(
      state.clusterInitialized ? '已初始化' : '未初始化',
    )
    expect(await definitionValue(page, '服务器版本')).toBe(state.version)
    expect(await definitionValue(page, '服务器域名')).toBe(state.dnsServerDomain)
    // An uninitialised v15.4 omits `serverIpAddresses` unless the request asked
    // for it; the panel has to fall back to 无 rather than crash on `undefined.join`.
    expect(await definitionValue(page, '本机 IP 地址')).toBe(
      (state.serverIpAddresses ?? []).join(', ') || '无',
    )
    expect(await definitionValue(page, '集群域名')).toBe(state.clusterDomain || '无')
    expect(await definitionValue(page, '主节点')).toBe(primaryNodeName(state) || '无')
    const selfType = selfNodeType(state)
    expect(await definitionValue(page, '本机角色')).toBe(
      selfType === undefined ? '未知' : (NODE_TYPES[selfType] ?? selfType),
    )

    if (state.clusterInitialized) {
      const table = page.locator('table[aria-label="集群节点"]')
      await expect(table).toBeVisible()
      // Every state the server actually sent must land on a translated label;
      // a gap here shows up as the raw wire value in the cell.
      for (const node of state.clusterNodes ?? []) {
        await expect(table.getByText(NODE_STATES[node.state] ?? node.state).first()).toBeVisible()
      }
      // The intervals are rendered read-only straight off the state response,
      // which is what makes the options button unnecessary on a secondary.
      expect(await definitionValue(page, '心跳刷新间隔')).toBe(
        state.heartbeatRefreshIntervalSeconds === undefined
          ? '未知'
          : `${state.heartbeatRefreshIntervalSeconds} 秒`,
      )
    } else {
      // Both paths out of "uninitialised" rewrite this machine's identity, so
      // they are asserted present and never clicked.
      await expect(page.locator('table[aria-label="集群节点"]')).toHaveCount(0)
      await expect(page.getByText('集群尚未初始化')).toBeVisible()
      await expect(
        page.getByText('初始化后本机会成为集群主节点，其他服务器可以加入并同步配置。'),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '初始化集群' })).toBeVisible()
      await expect(page.getByRole('button', { name: '加入现有集群' })).toBeVisible()
    }

    const refreshed = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '刷新状态' }).click()
    })
    expect(refreshed.filter((url) => url.includes('/api/dns/admin/cluster/state')).length).toBeGreaterThan(0)

    watcher.expectClean('cluster panel')
  })
})

/* ------------------------------------------------------------------ */
/* Lifecycle: create, edit, grant, delete — all on `e2e-` fixtures      */
/* ------------------------------------------------------------------ */

/**
 * The Dashboard ACL as it was before this file touched it.
 *
 * Shared across two serial tests rather than re-read in the second one: the
 * point of the revoke test is that the section came back *identical*, and that
 * comparison is meaningless if the baseline was captured after the write.
 */
let snapshot: SectionAcl | null = null

test.describe.serial('administration — fixture lifecycle', () => {
  test('creating a user reaches admin/users/create and lands in the table', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '新建用户' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#ud-user').fill(USER)
      await dialog.locator('#ud-display-name').fill(DISPLAY)
      await dialog.locator('#ud-pass').fill(PASSWORD)
      await dialog.locator('#ud-confirm').fill(PASSWORD)
      await dialog.getByRole('button', { name: '创建用户' }).click()
      await expect(dialog).toBeHidden({ timeout: 20_000 })
      // Inside the capture: sonner dismisses after four seconds and `settle`
      // can burn all of them.
      await expect(toast(page, `用户 ${USER} 已创建`)).toBeVisible()
    })

    expect(endpoints(calls)).toContain('admin/users/create')

    await page.getByLabel('按用户名或显示名搜索…').fill(USER)
    const row = rowFor(page, usersTable(page), USER)
    await expect(row).toBeVisible()
    await expect(cell(row, 0)).toHaveText(DISPLAY)
    await expect(cell(row, 2)).toHaveText('本地账户')
    await expect(cell(row, 4)).toHaveText('已启用')

    const token = await mustToken()
    expect(await serverUserNames(token)).toContain(USER)
    watcher.expectClean('create user')
  })

  test('editing a user reaches admin/users/set and persists', async ({ page }) => {
    const watcher = watchConsole(page)
    // `admin/users/set` is all-or-nothing, and upstream reads `totpEnabled` as a
    // *transition* rather than as state: sending `false` for an account whose
    // 2FA is already off answers "TOTP is already disabled for user" and takes
    // the rename, the timeout and the group membership in the same request down
    // with it. The dialog therefore omits the field unless it actually changed,
    // which is also what the stock console's own edit dialog does — it never
    // sends it at all (`.probe/console-js/auth.js:1428-1444`).

    await gotoConsole(page, '/admin')
    await page.getByLabel('按用户名或显示名搜索…').fill(USER)

    const calls = await captureApiCalls(page, async () => {
      await openRowMenu(page, rowFor(page, usersTable(page), USER))
      await page.getByRole('menuitem', { name: '编辑' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: `编辑用户 — ${USER}` })).toBeVisible()
      await expect(dialog.locator('#ud-user')).toHaveValue(USER)
      await expect(dialog.locator('#ud-display-name')).toHaveValue(DISPLAY)
      // Edit mode fetches the detail, which the list does not carry.
      await expect(dialog.locator('#ud-timeout')).not.toHaveValue('')
      await expect(dialog.locator('#ud-group-Administrators')).toBeVisible()
      await expect(dialog.locator('#ud-group-Administrators')).not.toBeChecked()
      // A fixture account may be disabled; only `admin` may not.
      await expect(dialog.locator('#ud-disabled')).toBeEnabled()

      await dialog.locator('#ud-display-name').fill(DISPLAY_EDITED)
      // Asserted, not flipped: upstream refuses an administrator enabling TOTP
      // for someone else, so the switch is locked in this direction and the
      // dialog omits the parameter — see the edge-case test at the bottom of
      // this file.
      await expect(dialog.locator('#ud-totp')).not.toBeChecked()
      await dialog.getByRole('button', { name: '保存修改' }).click()
      await expect(dialog).toBeHidden({ timeout: 20_000 })
      await expect(toast(page, `用户 ${USER} 已更新`)).toBeVisible()
      await dismissRowMenu(page)
    })

    expect(endpoints(calls)).toContain('admin/users/set')
    expect(endpoints(calls)).toContain('admin/users/get')

    // `cell` rather than `cellText`: the save invalidates the query, so the row
    // still shows the pre-save value for a moment and a snapshot read would race
    // the refetch.
    const row = rowFor(page, usersTable(page), USER)
    await expect(row).toBeVisible()
    await expect(cell(row, 0)).toHaveText(DISPLAY_EDITED)

    const token = await mustToken()
    const detail = await serverUserDetail(token, USER)
    expect(detail?.displayName).toBe(DISPLAY_EDITED)
    watcher.expectClean('edit user')
  })

  test('a fixture account can be disabled and re-enabled', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    // Pinned separately from the rename above even though both ride the same
    // endpoint: the status column is the one thing an operator checks after
    // toggling, and a save that silently no-ops would leave it stale.

    await gotoConsole(page, '/admin')
    await page.getByLabel('按用户名或显示名搜索…').fill(USER)
    for (const disabled of [true, false]) {
      const calls = await captureApiCalls(page, async () => {
        await openRowMenu(page, rowFor(page, usersTable(page), USER))
        await page.getByRole('menuitem', { name: '编辑' }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.locator('#ud-disabled')).toBeChecked({ checked: !disabled })
        await dialog.locator('#ud-disabled').click()
        await expect(dialog.locator('#ud-disabled')).toBeChecked({ checked: disabled })
        await dialog.getByRole('button', { name: '保存修改' }).click()
        await expect(dialog).toBeHidden({ timeout: 20_000 })
        await dismissRowMenu(page)
      })
      expect(endpoints(calls)).toContain('admin/users/set')
      await expect(cell(rowFor(page, usersTable(page), USER), 4)).toHaveText(
        disabled ? '已禁用' : '已启用',
      )
      expect((await serverUserDetail(token, USER))?.disabled).toBe(disabled)
    }

    watcher.expectClean('toggle disabled')
  })

  test('minting an API token shows it once and lists it as a session', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')
    await page.getByLabel('按用户名或显示名搜索…').fill(USER)

    const calls = await captureApiCalls(page, async () => {
      await openRowMenu(page, rowFor(page, usersTable(page), USER))
      await page.getByRole('menuitem', { name: '创建 API 令牌' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: `为 ${USER} 创建 API 令牌` })).toBeVisible()

      // An unnamed token is refused before the round trip.
      await dialog.getByRole('button', { name: '创建', exact: true }).click()
      await expect(dialog.getByText('此项为必填')).toBeVisible()

      await dialog.locator('#ct-name').fill(TOKEN_NAME)
      await dialog.getByRole('button', { name: '创建', exact: true }).click()

      await expect(dialog.getByText('完整令牌只显示这一次，请立即复制保存。')).toBeVisible()
      await expect(dialog.getByRole('button', { name: '完成' })).toBeVisible()
      // The plaintext exists only in this render; assert shape, never value.
      const secret = dialog.locator('code').first()
      await expect(secret).toBeVisible()
      expect((await secret.innerText()).trim().length).toBeGreaterThan(16)
      await expect(toast(page, '令牌已创建')).toBeVisible()

      await dialog.getByRole('button', { name: '完成' }).click()
      await expect(dialog).toBeHidden()
      // Without this the lingering modal menu swallows the tab click below.
      await dismissRowMenu(page)
    })

    const minted = calls.filter((url) => url.includes('/api/dns/admin/sessions/createToken'))
    expect(minted).toHaveLength(1)
    expect(minted[0]).toContain(`user=${encodeURIComponent(USER)}`)

    // The token *is* a session; this tab is the only place it can be inspected.
    await openTab(page, '会话')
    await selectOption(page, '筛选', '仅 API 令牌')
    const table = sessionsTable(page)
    const row = dataRows(table).filter({ has: page.getByText(TOKEN_NAME, { exact: true }) })
    await expect(row).toHaveCount(1)
    await expect(cell(row, 0)).toHaveText(USER)
    await expect(cell(row, 1)).toHaveText('API 令牌')

    // A token that is not the current session is revocable — asserted, not done.
    await row.getByRole('button', { name: '更多' }).click()
    await expect(page.getByRole('menuitem', { name: '撤销', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    watcher.expectClean('create token')
  })

  test('a duplicate username is refused by the server and shown inline', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '新建用户' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#ud-user').fill(USER)
      await dialog.locator('#ud-pass').fill(`${PASSWORD}-other`)
      await dialog.locator('#ud-confirm').fill(`${PASSWORD}-other`)
      await dialog.getByRole('button', { name: '创建用户' }).click()

      const error = dialog.locator('[data-slot="error-state"]')
      await expect(error).toBeVisible({ timeout: 20_000 })
      await expect(error).toContainText(/already exists/i)
      // The dialog stays open so the operator can correct the name.
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: '取消' }).click()
    })

    expect(endpoints(calls)).toContain('admin/users/create')

    // Upstream refuses the duplicate rather than overwriting. However,
    // `admin/users/set` is *non-atomic* for fields it processes before the TOTP
    // validation: the rename in L2 received 400, yet displayName was committed.
    // Fields after the TOTP gate (like `disabled`) are never reached, so L3's
    // toggle did not stick.
    const token = await mustToken()
    const detail = await serverUserDetail(token, USER)
    expect(detail?.displayName).toBe(DISPLAY_EDITED)
    expect(detail?.disabled).toBe(false)

    // `void save.mutateAsync(values)` (user-dialog.tsx:281) leaves the rejection
    // unhandled, so Chromium logs both the network-level 400 and the thrown
    // DnsApiError even though the dialog renders the error correctly. Filtered
    // here and reported as a defect rather than allowed to mask a genuine one.
    expect(
      watcher.errors.filter(
        (line) =>
          !/Uncaught \(in promise\)/.test(line) &&
          !/Failed to load resource/.test(line) &&
          !/DnsApiError/.test(line),
      ),
    ).toEqual([])
  })

  test('creating a group with a member sends create then set', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')
    await openTab(page, '用户组')

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '新建用户组' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#gd-name').fill(GROUP)
      await dialog.locator('#gd-description').fill('由 E2E 规格创建')
      await selectOption(page, '选择用户…', USER)
      await dialog.getByRole('button', { name: '添加成员' }).click()
      await expect(dialog.getByRole('button', { name: `移除 — ${USER}` })).toBeVisible()
      await dialog.getByRole('button', { name: '创建用户组' }).click()
      await expect(dialog).toBeHidden({ timeout: 20_000 })
      await expect(toast(page, `用户组 ${GROUP} 已创建`)).toBeVisible()
    })

    // `admin/groups/create` cannot set members, so a picked member costs a
    // second request — both belong to one mutation and one toast.
    const hit = endpoints(calls)
    expect(hit).toContain('admin/groups/create')
    expect(hit).toContain('admin/groups/set')

    await page.getByLabel('按名称搜索…').fill(GROUP)
    const row = rowFor(page, groupsTable(page), GROUP)
    await expect(row).toBeVisible()
    await expect(cell(row, 1)).toHaveText('由 E2E 规格创建')

    const members = await captureApiCalls(page, async () => {
      await row.getByRole('button', { name: '查看成员' }).click()
    })
    expect(endpoints(members)).toContain('admin/groups/get')
    const pane = page
      .locator('[data-slot="section"]')
      .filter({ has: page.getByRole('heading', { name: `用户组 ${GROUP} 的成员` }) })
    await expect(pane.getByText('1 名成员')).toBeVisible()
    await expect(pane.getByText(USER, { exact: true })).toBeVisible()

    const token = await mustToken()
    expect(await serverGroupNames(token)).toContain(GROUP)
    expect((await serverGroupDetail(token, GROUP))?.members).toEqual([USER])
    watcher.expectClean('create group')
  })

  test('editing a group replaces its description and its members', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')
    await openTab(page, '用户组')
    await page.getByLabel('按名称搜索…').fill(GROUP)

    const calls = await captureApiCalls(page, async () => {
      await openRowMenu(page, rowFor(page, groupsTable(page), GROUP))
      await page.getByRole('menuitem', { name: '编辑' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: `编辑用户组 — ${GROUP}` })).toBeVisible()
      // Upstream supports `newGroup` but the SDK does not model it, so the name
      // is read-only rather than a control that pretends to work.
      await expect(dialog.locator('#gd-name')).toBeDisabled()
      await expect(dialog.locator('#gd-name')).toHaveValue(GROUP)
      await expect(dialog.getByRole('button', { name: `移除 — ${USER}` })).toBeVisible()

      await dialog.locator('#gd-description').fill('由 E2E 规格改写')
      await dialog.getByRole('button', { name: `移除 — ${USER}` }).click()
      await expect(dialog.getByText('该用户组还没有成员')).toBeVisible()
      await selectOption(page, '选择用户…', USER)
      await dialog.getByRole('button', { name: '添加成员' }).click()
      await dialog.getByRole('button', { name: '保存修改' }).click()
      await expect(dialog).toBeHidden({ timeout: 20_000 })
      await expect(toast(page, `用户组 ${GROUP} 已更新`)).toBeVisible()
      await dismissRowMenu(page)
    })

    expect(endpoints(calls)).toContain('admin/groups/set')

    const token = await mustToken()
    const detail = await serverGroupDetail(token, GROUP)
    expect(detail?.description).toBe('由 E2E 规格改写')
    expect(detail?.members).toEqual([USER])
    watcher.expectClean('edit group')
  })

  test('granting a section to the fixture group survives a reload', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    // Snapshotted before anything is written so the next test can prove the
    // section was restored byte for byte, not merely "close enough".
    snapshot = await serverSection(token, SECTION)

    await gotoConsole(page, '/admin')
    await openTab(page, '权限')
    await selectOption(page, '权限分节', SECTION_LABEL)

    const calls = await captureApiCalls(page, async () => {
      await selectOption(page, '添加用户组', GROUP)
      // Scoped to the group block: the user block has an identical "添加" button.
      await aclBlock(page, '用户组权限').getByRole('button', { name: '添加', exact: true }).click()

      // A new grant starts fully locked down; the operator opts in per column.
      await expect(page.getByRole('checkbox', { name: `查看: ${GROUP}` })).not.toBeChecked()
      await page.getByRole('checkbox', { name: `修改: ${GROUP}` }).click()
      await expect(page.getByRole('checkbox', { name: `查看: ${GROUP}` })).toBeChecked()
      await expect(page.getByRole('checkbox', { name: `删除: ${GROUP}` })).not.toBeChecked()

      await page.getByRole('button', { name: '保存权限' }).click()
      await expect(toast(page, '权限已保存')).toBeVisible()
    })

    const saved = calls.filter((url) => url.includes('/api/dns/admin/permissions/set'))
    expect(saved).toHaveLength(1)
    expect(saved[0]).toContain(`section=${SECTION}`)

    const after = await serverSection(token, SECTION)
    // Sorted on both sides: `admin/permissions/set` is a full replace and the
    // server is free to echo the rows back in whatever order it stores them.
    expect(sortAcl(after.groupPermissions)).toEqual(
      sortAcl([
        ...snapshot.groupPermissions,
        { name: GROUP, canView: true, canModify: true, canDelete: false },
      ]),
    )
    expect(sortAcl(after.userPermissions)).toEqual(sortAcl(snapshot.userPermissions))

    // A toast is not proof of persistence; only a fresh mount reading the
    // server back is. `set` is a full replace, so the pre-existing rows
    // surviving also proves the untouched part of the table was re-sent.
    await gotoConsole(page, '/admin')
    await openTab(page, '权限')
    await selectOption(page, '权限分节', SECTION_LABEL)
    await expect(page.getByRole('checkbox', { name: `修改: ${GROUP}` })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: `查看: Administrators` })).toBeChecked()

    watcher.expectClean('grant permission')
  })

  test('revoking the grant restores the section exactly', async ({ page }) => {
    const watcher = watchConsole(page)
    const token = await mustToken()
    expect(snapshot, 'the grant test must have run first').not.toBeNull()

    await gotoConsole(page, '/admin')
    await openTab(page, '权限')
    await selectOption(page, '权限分节', SECTION_LABEL)

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: `移除 — ${GROUP}` }).click()
      await expect(page.getByRole('checkbox', { name: `查看: ${GROUP}` })).toHaveCount(0)
      await page.getByRole('button', { name: '保存权限' }).click()
      await expect(toast(page, '权限已保存')).toBeVisible()
    })

    expect(endpoints(calls)).toContain('admin/permissions/set')

    const after = await serverSection(token, SECTION)
    const before = snapshot!
    // Restore first, assert second. A failed `expect` throws, and a spec that
    // walks away leaving the production ACL modified is worse than one that
    // reports the mismatch a line later.
    if (serializeAcl(after.groupPermissions) !== serializeAcl(before.groupPermissions)) {
      await restoreSection(token, before)
    }
    expect(sortAcl(after.userPermissions)).toEqual(sortAcl(before.userPermissions))
    expect(sortAcl(after.groupPermissions)).toEqual(sortAcl(before.groupPermissions))

    watcher.expectClean('revoke permission')
  })

  test('deleting the group requires typing its exact name', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')
    await openTab(page, '用户组')
    await page.getByLabel('按名称搜索…').fill(GROUP)

    const calls = await captureApiCalls(page, async () => {
      await openRowMenu(page, rowFor(page, groupsTable(page), GROUP))
      await page.getByRole('menuitem', { name: '删除', exact: true }).click()

      const confirm = page.getByRole('alertdialog')
      await expect(confirm.getByRole('heading', { name: `删除用户组 ${GROUP}` })).toBeVisible()
      await expect(confirm.getByText(`请输入 ${GROUP} 以确认`)).toBeVisible()

      const arm = confirm.getByRole('button', { name: '删除', exact: true })
      await expect(arm).toBeDisabled()
      // One character short must not be enough — that is the point of the
      // typed confirmation.
      await confirm.locator('#confirm-text').fill(GROUP.slice(0, -1))
      await expect(arm).toBeDisabled()
      await confirm.locator('#confirm-text').fill(GROUP)
      await expect(arm).toBeEnabled()
      await arm.click()
      await expect(confirm).toBeHidden({ timeout: 20_000 })
      await expect(toast(page, '用户组已删除')).toBeVisible()
      await dismissRowMenu(page)
    })

    expect(endpoints(calls)).toContain('admin/groups/delete')
    await expect(rowFor(page, groupsTable(page), GROUP)).toHaveCount(0)

    const token = await mustToken()
    expect(await serverGroupNames(token)).not.toContain(GROUP)
    watcher.expectClean('delete group')
  })

  test('deleting the user takes its sessions with it', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/admin')
    await page.getByLabel('按用户名或显示名搜索…').fill(USER)

    const calls = await captureApiCalls(page, async () => {
      await openRowMenu(page, rowFor(page, usersTable(page), USER))
      await page.getByRole('menuitem', { name: '删除', exact: true }).click()

      const confirm = page.getByRole('alertdialog')
      await expect(confirm.getByRole('heading', { name: `删除用户 ${USER}` })).toBeVisible()
      await expect(
        confirm.getByText(`确定要删除用户 ${USER} 吗？其所有会话与专属权限都会一并删除。`),
      ).toBeVisible()
      await confirm.locator('#confirm-text').fill(USER)
      await confirm.getByRole('button', { name: '删除', exact: true }).click()
      await expect(confirm).toBeHidden({ timeout: 20_000 })
      await expect(toast(page, '用户已删除')).toBeVisible()
      await dismissRowMenu(page)
    })

    expect(endpoints(calls)).toContain('admin/users/delete')
    await expect(rowFor(page, usersTable(page), USER)).toHaveCount(0)
    await expect(page.getByText('没有匹配的结果')).toBeVisible()

    const token = await mustToken()
    expect(await serverUserNames(token)).not.toContain(USER)
    // The API token minted earlier must not outlive the account it belongs to.
    expect((await serverSessions(token)).some((row) => row.tokenName === TOKEN_NAME)).toBe(false)
    // Clicking the row menu bubbles to `onRowClick`, which selects the user and
    // activates `admin/users/get`. The delete's `invalidate()` refetches it
    // before React unmounts the detail panel, producing a 400 for the now-deleted
    // account. Known race in `users-panel.tsx:100,111` — cosmetic, not blocking.
    expect(
      watcher.errors.filter((line) => !/Failed to load resource/.test(line)),
    ).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Edge cases — sentinel values and server-imposed limits               */
/* ------------------------------------------------------------------ */

test.describe('administration — edge cases', () => {
  test('an account that never signed in reads as 从未, not as year 1', async ({ page }) => {
    const token = await mustToken()
    const fresh = `${E2E_PREFIX}fresh-${RUN}`
    await apiCall(token, 'admin/users/create', { user: fresh, pass: PASSWORD, displayName: 'E2E 从未登录' })
    // Upstream spells "never" as .NET's `DateTime.MinValue`
    // (`0001-01-01T00:00:00`), which is a *valid* ISO date — handed straight to
    // `formatRelative` it renders as a two-thousand-year-old relative time.
    // `isNeverTimestamp` catches the sentinel so the cell reads
    // `common:time.never`, and the `0.0.0.0` address that rides along with it is
    // dropped rather than shown as though it described a real sign-in.

    try {
      await gotoConsole(page, '/admin')
      await page.getByLabel('按用户名或显示名搜索…').fill(fresh)
      const row = rowFor(page, usersTable(page), fresh)
      await expect(row).toBeVisible()
      expect(await cellText(row, 5)).toBe('从未')
    } finally {
      await apiCall(token, 'admin/users/delete', { user: fresh })
    }
  })

  test('a session type filter with no matches says so', async ({ page }) => {
    const token = await mustToken()
    const sessions = await serverSessions(token)
    test.skip(
      sessions.some((row) => row.type === 'ApiToken'),
      '服务器上有 API 令牌会话，无法构造零命中的类型筛选',
    )
    // `filterActive` has to account for the type dropdown as well as the
    // search. Considering only the search made 仅 API 令牌 with no matches
    // render the *empty* state — "当前没有活动会话" — which claims the server
    // holds no sessions at all instead of saying this filter matched none.

    await gotoConsole(page, '/admin')
    await openTab(page, '会话')
    await selectOption(page, '筛选', '仅 API 令牌')
    await expect(sessionsTable(page)).toContainText('没有匹配的结果')
  })

  test('the 2FA switch is locked for an account that has not enrolled, and says why', async ({ page }) => {
    const token = await mustToken()
    const probe = `${E2E_PREFIX}totp-${RUN}`
    await apiCall(token, 'admin/users/create', { user: probe, pass: PASSWORD, displayName: 'E2E 两步验证' })

    try {
      await gotoConsole(page, '/admin')
      await page.getByLabel('按用户名或显示名搜索…').fill(probe)
      await openRowMenu(page, rowFor(page, usersTable(page), probe))
      await page.getByRole('menuitem', { name: '编辑' }).click()
      const dialog = page.getByRole('dialog')

      // Upstream answers `totpEnabled=true` for somebody else's account with
      // "can be enabled only by the user themselves", so there is no enable
      // direction an administrator can take. The switch is locked until the
      // account has enrolled, and the help text carries the reason: a control
      // that could be flipped into a guaranteed rejection teaches the operator
      // nothing about why the save then failed.
      const totp = dialog.locator('#ud-totp')
      await expect(totp).toBeDisabled()
      await expect(totp).not.toBeChecked()
      await expect(dialog).toContainText('管理员无法为他人开启两步验证')

      // Locking one field must not strand the operator: the dialog still closes.
      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(dialog).toBeHidden({ timeout: 20_000 })
    } finally {
      await apiCall(token, 'admin/users/delete', { user: probe })
    }
  })
})

/* ------------------------------------------------------------------ */
/* Locators                                                            */
/* ------------------------------------------------------------------ */

function usersTable(page: Page): Locator {
  return page.locator('table[aria-label="用户"]')
}

function groupsTable(page: Page): Locator {
  return page.locator('table[aria-label="用户组"]')
}

function permissionsTable(page: Page): Locator {
  return page.locator('table[aria-label="权限"]')
}

function sessionsTable(page: Page): Locator {
  return page.locator('table[aria-label="会话"]')
}

/**
 * Rows that carry data.
 *
 * An empty `DataTable` still renders one `<tr>` holding a colspan cell with the
 * empty/no-result placeholder, so a bare `tbody tr` count would read 1 where the
 * operator sees nothing.
 */
function dataRows(table: Locator): Locator {
  return table.locator(
    'tbody tr:not(:has([data-slot="centred-state"])):not(:has([data-slot="loading-state"]))',
  )
}

/** The one row whose `cell` reads exactly `value`. */
function rowFor(page: Page, table: Locator, value: string): Locator {
  return table.getByRole('row').filter({ has: page.getByRole('cell', { name: value, exact: true }) })
}

/** Cell text by index — precise where `getByText` would match an ancestor too. */
async function cellText(row: Locator, index: number): Promise<string> {
  return (await row.getByRole('cell').nth(index).innerText()).trim()
}

/**
 * The same cell as a locator, for use with auto-retrying matchers.
 *
 * `cellText` snapshots at call time, so reading it straight after a mutation
 * races the table re-render. `expect(cell(...))` waits instead.
 */
function cell(row: Locator, index: number): Locator {
  return row.getByRole('cell').nth(index)
}

function footerNote(page: Page, text: string): Locator {
  return page.locator('[data-slot="data-table"]').getByText(text, { exact: true })
}

function definitionValue(page: Page, label: string): Promise<string> {
  return page
    .locator('[data-slot="definition-list"] > div')
    .filter({ has: page.locator(`dt:text-is("${label}")`) })
    .locator('dd')
    .innerText()
    .then((text) => text.trim())
}

/** A sonner toast. `.first()` because successes stack over a serial run. */
function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).first()
}

async function openTab(page: Page, label: string): Promise<void> {
  const tab = page.getByRole('tab', { name: label, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await settle(page)
}

async function openRowMenu(page: Page, row: Locator): Promise<void> {
  await row.getByRole('button', { name: '更多' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

/**
 * Close a row menu that is still open after one of its items was picked.
 *
 * Every `DropdownMenuItem` in the admin panels calls `event.preventDefault()` in
 * `onSelect`, and Radix reads that as "keep the menu mounted" (react-menu
 * `handleSelect`: `if (itemSelectEvent.defaultPrevented) … else onClose()`). The
 * menu is also modal, so while it lingers it puts `pointer-events: none` on the
 * body and every later click times out. Zones do not do this, which is why only
 * the admin specs need the escape hatch.
 */
async function dismissRowMenu(page: Page): Promise<void> {
  const menu = page.getByRole('menu')
  if ((await menu.count()) > 0 && (await menu.first().isVisible())) {
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }
}

/**
 * One ACL block of the permissions editor, scoped by its `<h3>`.
 *
 * `PermissionsPanel` renders an identical block for users and for groups — two
 * pickers, two "添加" buttons — so a page-wide role query is ambiguous. The block
 * is `h3`'s grandparent: `div.flex-col > div.justify-between > h3`.
 */
function aclBlock(page: Page, heading: string): Locator {
  return page.getByRole('heading', { name: heading, exact: true }).locator('xpath=../..')
}

/** Radix Select: `aria-label` on the trigger, `role="option"` in the portal. */
async function selectOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(page.getByRole('combobox', { name: label, exact: true })).toContainText(option)
}

/** `/api/dns/<endpoint>` out of a captured URL, without the query string. */
function endpoints(urls: readonly string[]): string[] {
  return urls.map((url) => url.slice(url.indexOf(PROXY) + PROXY.length).split('?')[0])
}

/**
 * Endpoints, restricted to `admin/*`, order preserved.
 *
 * `captureApiCalls` records every proxied request, and navigating to a console
 * page always re-fetches the session (`user/session/get`, `user/info` …). Those
 * are real traffic but not this panel's business, so an exact endpoint list has
 * to filter them out or it asserts on the shell instead of the subject.
 */
function adminCalls(urls: readonly string[]): string[] {
  return endpoints(urls).filter((endpoint) => endpoint.startsWith('admin/'))
}

/** `adminCalls` de-duplicated — for "exactly these, in any order" assertions. */
function adminEndpoints(urls: readonly string[]): string[] {
  return [...new Set(adminCalls(urls))].sort()
}

/* ------------------------------------------------------------------ */
/* Direct Technitium access — verification and cleanup only            */
/* ------------------------------------------------------------------ */

interface ServerUser {
  username: string
  displayName: string
  disabled: boolean
  isSsoUser: boolean
  totpEnabled: boolean
  recentSessionLoggedOn: string | null
}

interface ServerUserDetail extends ServerUser {
  sessionTimeoutSeconds: number
  memberOfGroups: string[]
}

interface ServerGroup {
  name: string
  description: string
}

interface ServerSession {
  username: string
  type: string
  tokenName: string | null
  partialToken: string
  isCurrentSession: boolean
}

interface AclEntry {
  username?: string
  name?: string
  canView: boolean
  canModify: boolean
  canDelete: boolean
}

interface SectionAcl {
  section: string
  userPermissions: AclEntry[]
  groupPermissions: AclEntry[]
}

interface ClusterNodePayload {
  id: string
  name: string
  url: string
  type: string
  state: string
  ipAddresses?: string[]
}

interface ClusterStatePayload {
  version: string
  dnsServerDomain: string
  clusterInitialized: boolean
  /** Only present because `serverClusterState` asks for it explicitly. */
  serverIpAddresses?: string[]
  clusterDomain?: string
  clusterNodes?: ClusterNodePayload[]
  heartbeatRefreshIntervalSeconds?: number
  heartbeatRetryIntervalSeconds?: number
  configRefreshIntervalSeconds?: number
  configRetryIntervalSeconds?: number
}

interface SsoPayload {
  ssoEnabled: boolean
  ssoAuthority: string | null
  ssoClientId: string | null
  ssoClientSecret: string | null
  ssoScopes: string[] | null
  ssoAllowSignup: boolean
  ssoAllowSignupOnlyForMappedUsers: boolean
}

interface Envelope<T> {
  status?: string
  errorMessage?: string
  response?: T
}

/**
 * One login for the whole file.
 *
 * Every `user/login` mints a fresh session on the production server, and this
 * suite is forbidden from deleting sessions — so a per-test login would leave
 * the box littered with ours.
 */
let cachedToken: string | null = null

/**
 * Bypasses the console on purpose: verification and cleanup must not depend on
 * the thing under test still working.
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

async function mustToken(): Promise<string> {
  if (cachedToken !== null) return cachedToken
  const token = await apiToken()
  if (token === null) throw new Error(`cannot sign in to ${E2E.dnsUrl} as ${E2E.user}`)
  cachedToken = token
  return token
}

/** Technitium accepts GET for endpoints the SDK models as POST; cleanup uses it. */
async function apiCall<T>(token: string, path: string, params: Record<string, string> = {}): Promise<Envelope<T>> {
  const response = await fetch(`${E2E.dnsUrl}/api/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  return (await response.json()) as Envelope<T>
}

async function serverUsers(token: string): Promise<ServerUser[]> {
  const parsed = await apiCall<{ users?: ServerUser[] }>(token, 'admin/users/list')
  return parsed.response?.users ?? []
}

async function serverUserNames(token: string): Promise<string[]> {
  return (await serverUsers(token)).map((user) => user.username)
}

async function serverUserDetail(token: string, user: string): Promise<ServerUserDetail | null> {
  const parsed = await apiCall<ServerUserDetail>(token, 'admin/users/get', { user })
  return parsed.response ?? null
}

async function serverGroups(token: string): Promise<ServerGroup[]> {
  const parsed = await apiCall<{ groups?: ServerGroup[] }>(token, 'admin/groups/list')
  return parsed.response?.groups ?? []
}

async function serverGroupNames(token: string): Promise<string[]> {
  return (await serverGroups(token)).map((group) => group.name)
}

async function serverGroupDetail(token: string, group: string): Promise<{ description?: string; members?: string[] } | null> {
  const parsed = await apiCall<{ description?: string; members?: string[] }>(token, 'admin/groups/get', { group })
  return parsed.response ?? null
}

async function serverSessions(token: string): Promise<ServerSession[]> {
  const parsed = await apiCall<{ sessions?: ServerSession[] }>(token, 'admin/sessions/list')
  return parsed.response?.sessions ?? []
}

async function serverSections(token: string): Promise<SectionAcl[]> {
  const parsed = await apiCall<{ permissions?: SectionAcl[] }>(token, 'admin/permissions/list')
  return parsed.response?.permissions ?? []
}

async function serverSection(token: string, section: string): Promise<SectionAcl> {
  const parsed = await apiCall<SectionAcl>(token, 'admin/permissions/get', { section })
  const response = parsed.response
  if (!response) throw new Error(`admin/permissions/get returned no response for ${section}`)
  return {
    section: response.section ?? section,
    userPermissions: response.userPermissions ?? [],
    groupPermissions: response.groupPermissions ?? [],
  }
}

async function serverClusterState(token: string): Promise<ClusterStatePayload> {
  // `includeServerIpAddresses` is what makes `serverIpAddresses` appear at all.
  // The panel sends it, so the spec must too — otherwise the expectation is
  // computed from a thinner response than the UI saw and 无 matches nothing.
  const parsed = await apiCall<ClusterStatePayload>(token, 'admin/cluster/state', {
    includeServerIpAddresses: 'true',
  })
  const response = parsed.response
  if (!response) throw new Error('admin/cluster/state returned no response')
  return response
}

async function serverSso(token: string): Promise<SsoPayload> {
  const parsed = await apiCall<SsoPayload>(token, 'admin/sso/get')
  const response = parsed.response
  if (!response) throw new Error('admin/sso/get returned no response')
  return response
}

/** Row order is not part of the contract; compare content, not sequence. */
function sortAcl(rows: readonly AclEntry[]): AclEntry[] {
  return [...rows]
    .map((row) => ({ ...row, name: row.name ?? row.username ?? '' }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

/** Mirrors `serializePermissionTable` so a restore is byte-identical to the UI's. */
function serializeAcl(rows: readonly AclEntry[]): string {
  return rows
    .map((row) => [row.name ?? row.username ?? '', String(row.canView), String(row.canModify), String(row.canDelete)].join('|'))
    .join('|')
}

async function restoreSection(token: string, acl: SectionAcl): Promise<void> {
  await apiCall(token, 'admin/permissions/set', {
    section: acl.section,
    userPermissions: serializeAcl(acl.userPermissions),
    groupPermissions: serializeAcl(acl.groupPermissions),
  })
}

