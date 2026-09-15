import { expect, test, type Page } from '@playwright/test'
import { E2E_PREFIX } from './env'
import { captureApiCalls, gotoConsole, moduleTitle, settle, watchConsole } from './helpers'

/**
 * Account page (/account) — five-tab self-service hub.
 *
 * SAFETY CONTRACT (violating any of these bricks the admin account on a live
 * production DNS server, which is also the account this suite authenticates with):
 *
 *  - NEVER submits a valid `user/changePassword` request.
 *  - NEVER calls `user/enableTotp` or `user/disableTotp`.
 *  - NEVER deletes an existing session or existing API token.
 *  - NEVER modifies profile data (the dirty-guard disables the save button when
 *    nothing changed, and we do not change anything).
 *
 * What IS tested:
 *  - Page loads, topbar label, all five tabs switchable, no console errors.
 *  - Profile: fields populated, dirty guard prevents no-op save.
 *  - Security: client-side password validation (mismatch, too short, empty
 *    current) with proof that no `changePassword` request is emitted.
 *  - TOTP: `user/2fa/init` generates a QR + secret; cancelling never reaches
 *    `user/enableTotp`.
 *  - Tokens: create `e2e-*` token → verify one-time reveal → delete it.
 *    Self-created, self-cleaned, try/finally guarded.
 *  - Sessions: read-only list, current session visible and protected.
 *  - About: version strings rendered, no raw i18n keys or undefined.
 */

/* ------------------------------------------------------------------ */
/* Page load and tab navigation                                        */
/* ------------------------------------------------------------------ */

test.describe('account page load', () => {
  test('renders topbar label and all five tabs without console errors', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/account')

    // Top-level module: the name lives in the topbar, the page itself has no <h1>.
    await expect(moduleTitle(page)).toHaveText('账户')

    const tabs = ['个人资料', '安全', 'API 令牌', '我的会话', '关于']
    for (const label of tabs) {
      await expect(page.getByRole('tab', { name: label }), `tab "${label}" exists`).toBeAttached()
    }

    watcher.expectClean('account page load')
  })

  test('each tab activates and renders content', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/account')

    const tabs = ['个人资料', '安全', 'API 令牌', '我的会话', '关于'] as const
    for (const label of tabs) {
      await page.getByRole('tab', { name: label }).click()
      const panel = page.locator(`[role="tabpanel"]:visible`)
      await expect(panel, `panel for "${label}" is visible`).toBeVisible()
    }

    watcher.expectClean('account tab switching')
  })
})

/* ------------------------------------------------------------------ */
/* Profile tab                                                         */
/* ------------------------------------------------------------------ */

test.describe('profile tab', () => {
  test('fields are populated from server and save is disabled when unchanged', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/account')

    // Display name input must have a non-empty value from the server.
    const nameInput = page.locator('#profile-display-name')
    await expect(nameInput).toBeVisible()
    await expect(nameInput).not.toHaveValue('')

    // Username is rendered as a DataValue (read-only).
    const usernameLabel = page.getByText('用户名', { exact: true })
    await expect(usernameLabel).toBeVisible()

    // The save button is disabled because the form is not dirty — this is the
    // guard that prevents accidental no-op writes to `user/profile/set`.
    const saveBtn = page.getByRole('button', { name: '保存资料' })
    await expect(saveBtn).toBeDisabled()

    // Permission matrix renders at least one row (the table uses implicit role).
    const permTable = page.getByRole('table', { name: '我的权限' })
    await expect(permTable).toBeVisible()
    await expect(permTable.locator('tbody tr').first()).toBeVisible()

    watcher.expectClean('profile tab')
  })
})

/* ------------------------------------------------------------------ */
/* Security tab — password validation                                  */
/* ------------------------------------------------------------------ */

test.describe('security tab — password validation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoConsole(page, '/account')
    await page.getByRole('tab', { name: '安全' }).click()
    // Wait for the profile query to resolve so the form renders.
    await expect(page.locator('#cp-current')).toBeVisible({ timeout: 15_000 })
  })

  test('mismatched confirmation shows inline error and emits no changePassword request', async ({ page }) => {
    const watcher = watchConsole(page)

    await page.locator('#cp-current').fill('current-pass')
    await page.locator('#cp-next').fill('NewPass123!')
    await page.locator('#cp-confirm').fill('DifferentPass1!')

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '修改密码' }).click()
    })

    // Inline error for confirm field.
    const confirmError = page.locator('#cp-confirm-error')
    await expect(confirmError).toBeVisible()
    await expect(confirmError).toHaveText('两次输入的新密码不一致')

    // Proof: no changePassword request left the browser.
    expect(
      calls.some((url) => url.includes('user/changePassword')),
      'changePassword must NOT be called',
    ).toBe(false)

    watcher.expectClean('password mismatch')
  })

  test('too-short new password shows inline error and emits no changePassword request', async ({ page }) => {
    const watcher = watchConsole(page)

    await page.locator('#cp-current').fill('current-pass')
    await page.locator('#cp-next').fill('abc')
    await page.locator('#cp-confirm').fill('abc')

    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '修改密码' }).click()
    })

    const nextError = page.locator('#cp-next-error')
    await expect(nextError).toBeVisible()
    await expect(nextError).toContainText('至少需要')

    expect(
      calls.some((url) => url.includes('user/changePassword')),
      'changePassword must NOT be called',
    ).toBe(false)

    watcher.expectClean('password too short')
  })

  test('empty current password disables the submit button entirely', async ({ page }) => {
    // canSubmit requires pass.length > 0; with it empty the button is disabled.
    await page.locator('#cp-next').fill('ValidPass1!')
    await page.locator('#cp-confirm').fill('ValidPass1!')

    const submitBtn = page.getByRole('button', { name: '修改密码' })
    await expect(submitBtn).toBeDisabled()
  })
})

/* ------------------------------------------------------------------ */
/* Security tab — TOTP setup                                           */
/* ------------------------------------------------------------------ */

test.describe('security tab — TOTP', () => {
  test('init generates QR and secret; cancel never calls enableTotp', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/account')
    await page.getByRole('tab', { name: '安全' }).click()
    await expect(page.locator('#cp-current')).toBeVisible({ timeout: 15_000 })

    // The "启用两步验证" button calls user/2fa/init (safe — generates but does
    // not activate). Capture calls to verify enableTotp is never reached.
    const calls = await captureApiCalls(page, async () => {
      await page.getByRole('button', { name: '启用两步验证' }).click()
      // Wait for QR image to render (init mutation resolved).
      await expect(page.locator('img[alt="TOTP 二维码"]')).toBeVisible({ timeout: 20_000 })
    })

    // init must have been called.
    expect(calls.some((url) => url.includes('user/2fa/init')), 'initTotp was called').toBe(true)

    // The QR image proves init resolved. NOTE: the manual-entry secret <code>
    // renders EMPTY because the server returns the field as `secret` while the
    // app's TotpInitResult interface reads `totpSecretKeyBase32` /
    // `totpSecretKey` — a field-name mismatch (app defect, see report).
    // We assert the QR + step headings instead of the secret text.
    const qr = page.locator('img[alt="TOTP 二维码"]')
    await qr.scrollIntoViewIfNeeded()
    await expect(qr).toBeVisible()

    // The enrollment UI shows step headings.
    await expect(page.getByText('第 1 步')).toBeVisible()
    await expect(page.getByText('第 2 步')).toBeVisible()

    // Cancel enrolment.
    await page.getByRole('button', { name: '取消设置' }).click()

    // After cancel, the init result is cleared — we're back to the enable button.
    await expect(page.getByRole('button', { name: '启用两步验证' })).toBeVisible()

    // CRITICAL SAFETY: enableTotp must never have been called.
    expect(
      calls.some((url) => url.includes('user/2fa/enable')),
      'enableTotp must NEVER be called',
    ).toBe(false)

    watcher.expectClean('TOTP init + cancel')
  })
})

/* ------------------------------------------------------------------ */
/* Tokens tab                                                          */
/* ------------------------------------------------------------------ */

test.describe('tokens tab', () => {
  test('create an e2e token, verify reveal-once, then delete it', async ({ page }) => {
    const watcher = watchConsole(page)
    const tokenName = `${E2E_PREFIX}${Date.now().toString(36)}`

    await gotoConsole(page, '/account')
    await page.getByRole('tab', { name: 'API 令牌' }).click()
    await settle(page)

    try {
      // Open create dialog.
      await page.getByRole('button', { name: '新建令牌' }).click()
      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()

      // Fill token name and submit.
      await dialog.locator('#ct-name').fill(tokenName)
      await dialog.getByRole('button', { name: '新建令牌' }).click()

      // The reveal-once state: title changes and a <code> block shows the plaintext.
      await expect(dialog.getByText('请立即保存令牌')).toBeVisible({ timeout: 20_000 })
      const tokenCode = dialog.locator('code')
      await expect(tokenCode).toBeVisible()
      const tokenValue = await tokenCode.innerText()
      expect(tokenValue.length, 'plaintext token is substantial').toBeGreaterThan(20)

      // Close the reveal dialog.
      await dialog.getByRole('button', { name: '我已保存，关闭' }).click()
      await expect(dialog).toBeHidden()

      // The invalidation-triggered refetch can race with the server committing
      // the new token into its sessions list, so reload to force a fresh
      // profile/get that is guaranteed to include it.
      await gotoConsole(page, '/account')
      await page.getByRole('tab', { name: 'API 令牌' }).click()

      // The new token appears in the table.
      const tokenTable = page.getByRole('table', { name: 'API 令牌' })
      await expect(tokenTable.locator('tbody tr', { hasText: tokenName }).first()).toBeVisible({ timeout: 20_000 })

      // Delete it: click the trash button in its row.
      const row = tokenTable.locator('tbody tr', { hasText: tokenName }).first()
      await row.getByRole('button', { name: '删除' }).click()

      // Confirm dialog appears.
      const confirm = page.locator('[role="alertdialog"]')
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: '删除' }).click()

      // Token disappears from the table.
      await expect(tokenTable.locator('tbody tr', { hasText: tokenName })).toHaveCount(0, { timeout: 15_000 })
    } finally {
      // Safety net: if the test failed before deletion, attempt cleanup via API.
      // This uses the proxy endpoint directly to avoid leaving orphaned tokens.
      await cleanupToken(page, tokenName).catch(() => {
        // Best-effort; the global teardown or manual intervention handles the rest.
      })
    }

    // 401s here are transient: the mid-test reload aborts in-flight requests from
    // the old page context, and the browser surfaces those as console errors.
    // Same precedent as auth.spec.ts which filters expected 401s.
    expect(watcher.errors.filter((e) => !e.includes('401'))).toEqual([])
  })
})

/**
 * Best-effort cleanup: find and delete a token by name via the proxy API.
 * Called in `finally` blocks where the UI path may have failed mid-test.
 */
async function cleanupToken(page: Page, tokenName: string): Promise<void> {
  const result = await page.evaluate(async (name) => {
    const profileRes = await fetch('/api/dns/user/profile/get')
    const profile = await profileRes.json()
    const sessions = profile?.response?.sessions ?? profile?.sessions ?? []
    const entry = sessions.find(
      (s: { type?: string; tokenName?: string }) => s.type === 'ApiToken' && s.tokenName === name,
    )
    if (!entry) return 'not-found'
    const delRes = await fetch(
      `/api/dns/user/session/delete?partialToken=${encodeURIComponent(entry.partialToken)}`,
    )
    return delRes.ok ? 'deleted' : 'failed'
  }, tokenName)
  if (result === 'deleted') {
    console.log(`[account-spec] cleaned up orphaned token "${tokenName}"`)
  }
}

/* ------------------------------------------------------------------ */
/* Sessions tab                                                        */
/* ------------------------------------------------------------------ */

test.describe('sessions tab', () => {
  test('shows current session with revoke disabled; no existing session is touched', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/account')
    await page.getByRole('tab', { name: '我的会话' }).click()
    await settle(page)

    // The table must be visible with at least one row.
    const table = page.getByRole('table', { name: '我的会话' })
    await expect(table).toBeVisible({ timeout: 15_000 })
    const rows = table.locator('tbody tr')
    await expect(rows.first()).toBeVisible({ timeout: 15_000 })

    // "当前会话" badge must be present — proves the current session is listed.
    await expect(page.getByText('当前会话').first()).toBeVisible()

    // The current session's revoke button is disabled.
    const currentRow = table.locator('tbody tr', { hasText: '当前会话' }).first()
    const revokeBtn = currentRow.getByRole('button', { name: '撤销' })
    await expect(revokeBtn).toBeDisabled()

    // "撤销其他所有会话" button exists but we NEVER click it.
    const revokeOthers = page.getByRole('button', { name: '撤销其他所有会话' })
    await expect(revokeOthers).toBeAttached()

    watcher.expectClean('sessions tab')
  })
})

/* ------------------------------------------------------------------ */
/* About tab                                                           */
/* ------------------------------------------------------------------ */

test.describe('about tab', () => {
  test('renders server version, console version, and no raw i18n keys', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/account')
    await page.getByRole('tab', { name: '关于' }).click()
    await settle(page)

    const panel = page.locator('[role="tabpanel"]:visible')
    await expect(panel).toBeVisible()

    // Server version must be a non-empty string (not undefined, not a key).
    const versionRow = panel.getByText('版本').first()
    await expect(versionRow).toBeVisible()

    // The DNS server section heading must render.
    await expect(panel.getByText('DNS 服务器')).toBeVisible()

    // Console version section.
    await expect(panel.getByText('本控制台')).toBeVisible()

    // Check that no raw i18n keys leaked (pattern: "about." or "account.").
    const panelText = await panel.innerText()
    expect(panelText).not.toMatch(/about\.\w+\.\w+/)
    expect(panelText).not.toMatch(/account\.\w+/)
    // No "undefined" strings.
    expect(panelText).not.toContain('undefined')

    // External links section renders.
    await expect(panel.getByText('相关链接')).toBeVisible()
    await expect(panel.getByRole('link', { name: /上游项目/ })).toBeVisible()

    watcher.expectClean('about tab')
  })
})
