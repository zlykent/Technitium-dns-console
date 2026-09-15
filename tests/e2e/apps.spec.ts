import { expect, test, type Page } from '@playwright/test'
import { gotoConsole, moduleTitle, settle, watchConsole } from './helpers'

/**
 * DNS Applications — installed panel and app store.
 *
 * SAFETY: This spec NEVER installs, updates, or uninstalls any application.
 * The installed panel is asserted adaptively: the live server may have 0 apps
 * (empty state) or some installed (table rows) — both are valid, and the suite
 * runs against whatever server the operator points it at. The store request
 * may fail if the DNS server cannot reach the internet — both outcomes (cards
 * rendered or error state) are treated as passing.
 *
 * What it does verify:
 *  - The installed tab shows the empty state or the installed table, matching
 *    what the server reports.
 *  - The store tab either renders app cards or shows a retryable error.
 *  - The install-from-ZIP dialog can be opened and cancelled.
 *  - The ZIP dropzone exists and only accepts .zip files.
 */

/**
 * The installed panel settles into exactly one of two shapes: the guided empty
 * state (0 apps) or a table with one row per installed app. Returns which one
 * is on screen. The empty state also lives inside a table row, so the row count
 * alone cannot tell them apart — the centred-state slot can.
 */
async function waitInstalledPanel(page: Page) {
  const emptyState = page.locator('[data-slot="centred-state"]')
  const appRows = page.locator('[data-slot="data-table"] tbody tr').filter({ has: page.locator('td .font-data') })
  await Promise.race([
    emptyState.waitFor({ state: 'visible', timeout: 20_000 }),
    appRows.first().waitFor({ state: 'visible', timeout: 20_000 }),
  ])
  return { emptyState, appRows, isEmpty: await emptyState.isVisible() }
}

test.describe('Apps — installed panel', () => {
  test('renders the installed set — empty state or app rows, matching the server', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/apps')

    // Top-level module: named by the topbar label, no <h1> of its own.
    await expect(moduleTitle(page)).toHaveText('应用')

    // The installed tab is active by default.
    const { emptyState, appRows, isEmpty } = await waitInstalledPanel(page)

    if (isEmpty) {
      await expect(emptyState).toContainText('还没有安装任何应用')
      // The "go to store" action button should be present in the empty state.
      await expect(emptyState.getByRole('button', { name: '浏览应用商店' })).toBeVisible()
    } else {
      // Every row is a real installed package: name, version and the per-row
      // action menu. Which apps are installed is the operator's business.
      expect(await appRows.count()).toBeGreaterThan(0)
      await expect(appRows.first().getByRole('button', { name: '操作' }).first()).toBeVisible()
    }

    watcher.expectClean('/apps installed')
  })

  test('the store tab is reachable — via the empty-state shortcut or directly', async ({ page }) => {
    await gotoConsole(page, '/apps')

    const { emptyState, isEmpty } = await waitInstalledPanel(page)

    // With 0 apps the empty state offers a shortcut; take it to prove the
    // wiring. With apps installed the tab is clicked directly.
    if (isEmpty) {
      await emptyState.getByRole('button', { name: '浏览应用商店' }).click()
    } else {
      await page.getByRole('tab', { name: '应用商店' }).click()
    }
    await settle(page)

    // The store tab should now be selected.
    const storeTab = page.getByRole('tab', { name: '应用商店' })
    await expect(storeTab).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('Apps — store panel', () => {
  test('store renders cards or a retryable error (both are valid)', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/apps')

    // Switch to the store tab.
    const storeTab = page.getByRole('tab', { name: '应用商店' })
    await storeTab.click()

    // Wait for either app cards to render OR an error/empty state to appear.
    // The store fetch depends on the DNS server reaching the internet.
    const cards = page.locator('.grid .surface')
    const errorState = page.locator('[data-slot="error-state"]')
    const emptyState = page.locator('[data-slot="centred-state"]')

    // Wait for any of the three possible outcomes.
    await Promise.race([
      cards.first().waitFor({ state: 'visible', timeout: 30_000 }),
      errorState.waitFor({ state: 'visible', timeout: 30_000 }),
      emptyState.waitFor({ state: 'visible', timeout: 30_000 }),
    ]).catch(() => {
      // If all three time out, something unexpected happened — let assertions below diagnose.
    })

    // Determine which state we landed in.
    const hasCards = await cards.first().isVisible().catch(() => false)
    const hasError = await errorState.isVisible().catch(() => false)
    const hasEmpty = await emptyState.isVisible().catch(() => false)

    if (hasCards) {
      // Store is reachable — at least one card rendered.
      expect(await cards.count()).toBeGreaterThan(0)
    } else if (hasError) {
      // Store unreachable — error state with retry button is correct.
      await expect(errorState).toContainText('无法加载商店列表')
      const retryBtn = errorState.getByRole('button', { name: '重试' })
      await expect(retryBtn).toBeVisible()
    } else if (hasEmpty) {
      // Store returned zero apps — empty state is also valid.
      await expect(emptyState).toContainText('商店中没有可用应用')
    } else {
      // Should not happen — fail with diagnostic info.
      throw new Error('Store tab rendered neither cards, error, nor empty state')
    }

    // Filter console errors: the store request may 4xx/5xx when unreachable.
    const relevantErrors = watcher.errors.filter(
      (e) => !e.includes('listStoreApps') && !e.includes('apps/list') && !e.includes('Failed to fetch'),
    )
    expect(relevantErrors, `unexpected console errors: ${relevantErrors.join('; ')}`).toEqual([])
  })
})

test.describe('Apps — install dialog', () => {
  test('install-from-ZIP dialog opens, shows dropzone, then cancels', async ({ page }) => {
    const watcher = watchConsole(page)
    await gotoConsole(page, '/apps')

    // Click "上传 ZIP 安装" in the installed panel toolbar.
    const installBtn = page.getByRole('button', { name: '上传 ZIP 安装' })
    await expect(installBtn).toBeVisible({ timeout: 20_000 })
    await installBtn.click()

    // The dialog should appear.
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText('从本地 ZIP 安装')

    // The ZIP dropzone should be present.
    const dropzone = dialog.locator('[data-slot="zip-dropzone"]')
    await expect(dropzone).toBeVisible()
    await expect(dropzone).toContainText('拖放 .zip 文件到此处')

    // The hidden file input should only accept .zip.
    const fileInput = dialog.locator('input[type="file"]')
    const accept = await fileInput.getAttribute('accept')
    expect(accept).toContain('.zip')

    // The name field should exist.
    const nameInput = dialog.locator('#install-app-name')
    await expect(nameInput).toBeVisible()

    // Submit should be disabled when name is empty.
    const submitBtn = dialog.getByRole('button', { name: '安装' })
    await expect(submitBtn).toBeDisabled()

    // Cancel — NEVER install.
    const cancelBtn = dialog.getByRole('button', { name: '取消' })
    await cancelBtn.click()
    await expect(dialog).not.toBeVisible({ timeout: 5_000 })

    watcher.expectClean('/apps install dialog')
  })
})
