import { expect, test } from '@playwright/test'
import { captureApiCalls, gotoConsole, moduleTitle, settle, watchConsole } from './helpers'

/**
 * DHCP scopes and leases — read-only validation.
 *
 * SAFETY: This spec NEVER enables a scope, NEVER submits the scope form, and
 * NEVER creates/deletes anything on the real server. The live server has one
 * disabled scope (`Default`) with no address pool; enabling it or assigning a
 * pool would start handing out IPs on the operator's LAN.
 *
 * What it does verify:
 *  - The scope table renders the real `Default` scope with "disabled" state.
 *  - The leases tab renders a correct empty state (no leases on this server).
 *  - Searching leases with no match shows the "no results" state.
 *  - The create-scope dialog opens, validates required fields, and cancels.
 */

test.describe('DHCP scopes', () => {
  test('scope list renders the Default scope in disabled state', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dhcp')

    // Top-level module: named by the topbar label, no <h1> of its own.
    await expect(moduleTitle(page)).toHaveText('DHCP')

    // The scopes tab is active by default; find the "Default" row.
    const table = page.locator('[data-slot="data-table"] table').first()
    await expect(table).toBeVisible({ timeout: 20_000 })

    // The scope named "Default" must be present.
    const row = table.locator('tbody tr', { hasText: 'Default' })
    await expect(row).toBeVisible()

    // The Switch shows the scope is disabled (aria-checked="false").
    const toggle = row.locator('button[role="switch"]')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    watcher.expectClean('/dhcp scopes')
  })

  test('leases tab shows empty state when no leases exist', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dhcp')

    // Switch to the leases tab.
    const leasesTab = page.getByRole('tab', { name: '租约' })
    await leasesTab.click()
    await settle(page)

    // The DataTable shows the empty state (not "no results") because
    // filterActive is false and there are truly zero leases.
    const emptyState = page.locator('[data-slot="centred-state"]')
    await expect(emptyState).toBeVisible({ timeout: 20_000 })
    await expect(emptyState).toContainText('当前没有任何租约')

    watcher.expectClean('/dhcp leases empty')
  })

  test('searching leases with no match shows "no results" state', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dhcp')

    // Switch to leases tab.
    await page.getByRole('tab', { name: '租约' }).click()
    await settle(page)

    // Type a search term that cannot match any lease.
    const searchInput = page.locator('[data-slot="data-table"] input[type="search"], [data-slot="data-table"] input[placeholder*="搜索"]').first()
    await searchInput.fill('zzz-no-such-host-zzz')
    // Give React time to re-render with the filter active.
    await page.waitForTimeout(500)

    // With filterActive=true and 0 rows, DataTable renders NoResultsState.
    const noResults = page.locator('[data-slot="centred-state"]')
    await expect(noResults).toBeVisible({ timeout: 10_000 })
    await expect(noResults).toContainText('没有匹配的结果')

    watcher.expectClean('/dhcp leases no-match')
  })

  test('create scope dialog opens, validates required name, then cancels', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dhcp')

    // Click the "新建作用域" button in the page header.
    const createBtn = page.getByRole('button', { name: '新建作用域' })
    await expect(createBtn).toBeVisible({ timeout: 10_000 })
    await createBtn.click()

    // The dialog should appear.
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText('新建作用域')

    // Clear the name field (it defaults to empty, but ensure it).
    const nameInput = dialog.locator('#sf-name')
    await expect(nameInput).toBeVisible()
    await nameInput.fill('')

    // Clear startingAddress to also trigger its validation (it has a default).
    const startInput = dialog.locator('#sf-start')
    await startInput.fill('')

    // Attempt submit — no API call should fire because validation blocks it.
    const calls = await captureApiCalls(page, async () => {
      const submitBtn = dialog.getByRole('button', { name: '保存作用域' })
      await submitBtn.click()
      // Give React Hook Form time to process.
      await page.waitForTimeout(1_000)
    })

    // No dhcp/scopes/set call should have been made.
    const setCalls = calls.filter((url) => url.includes('dhcp/scopes/set'))
    expect(setCalls, 'validation prevents the API call').toHaveLength(0)

    // Validation error messages should be visible.
    await expect(dialog.locator('text=此项为必填').first()).toBeVisible({ timeout: 5_000 })

    // Cancel the dialog — NEVER submit.
    const cancelBtn = dialog.getByRole('button', { name: '取消' })
    await cancelBtn.click()
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })

    watcher.expectClean('/dhcp create dialog')
  })

  test('editing a scope opens the form with pre-filled data then cancels', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/dhcp')

    // Open the row actions menu for "Default".
    const table = page.locator('[data-slot="data-table"] table').first()
    await expect(table).toBeVisible({ timeout: 20_000 })
    const row = table.locator('tbody tr', { hasText: 'Default' })
    await expect(row).toBeVisible()

    // Click the "more" dropdown trigger.
    const moreBtn = row.getByRole('button', { name: '更多' })
    await moreBtn.click()

    // Click "编辑" in the dropdown.
    await page.getByRole('menuitem', { name: '编辑' }).click()

    // The dialog should open in edit mode.
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText('编辑作用域')

    // The name field should contain "Default" and be disabled in edit mode.
    const nameInput = dialog.locator('#sf-name')
    await expect(nameInput).toHaveValue('Default')
    await expect(nameInput).toBeDisabled()

    // The exclusions and reservations sub-panels must render inside the form.
    await expect(dialog.locator('text=排除范围').first()).toBeVisible()
    await expect(dialog.locator('text=保留租约').first()).toBeVisible()
    // Both show their empty state text since Default has none configured.
    await expect(dialog.locator('text=没有排除范围')).toBeVisible()
    await expect(dialog.locator('text=没有保留租约')).toBeVisible()

    // Cancel — NEVER submit.
    const cancelBtn = dialog.getByRole('button', { name: '取消' })
    await cancelBtn.click()
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })

    watcher.expectClean('/dhcp edit dialog')
  })
})
