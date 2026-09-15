import { apiRequest } from '../client'
import type { AppConfigResult, AppListResult, InstallAppResult, StoreAppListResult, UpdateAppResult } from '../types/apps'

/**
 * DNS applications: what is installed, what the store offers, and each app's
 * free-form configuration.
 *
 * Installing from a local zip posts multipart; installing from the store is a
 * plain GET that makes the *server* fetch the download, which is why it needs no
 * body and why a locked-down network can fail there but succeed here.
 */

export function listApps(node?: string): Promise<AppListResult> {
  return apiRequest<AppListResult>('apps/list', { params: { node } })
}

export function listStoreApps(): Promise<StoreAppListResult> {
  return apiRequest<StoreAppListResult>('apps/listStoreApps')
}

export function installApp(name: string, fileAppZip: File): Promise<InstallAppResult> {
  const formData = new FormData()
  formData.append('fileAppZip', fileAppZip)
  return apiRequest<InstallAppResult>('apps/install', { method: 'POST', params: { name }, formData })
}

export function updateApp(name: string, fileAppZip: File): Promise<UpdateAppResult> {
  const formData = new FormData()
  formData.append('fileAppZip', fileAppZip)
  return apiRequest<UpdateAppResult>('apps/update', { method: 'POST', params: { name }, formData })
}

/**
 * Install straight from the app store; the DNS server performs the download.
 *
 * Upstream requires BOTH parameters: `name` identifies the app and `url` is the
 * store row's download link the server fetches. Sending only `name` earns
 * "Parameter 'url' missing." — the store list (`apps/listStoreApps`) and the
 * installed row's `updateUrl` are the two sources for it.
 */
export function downloadAndInstallApp(name: string, url: string): Promise<InstallAppResult> {
  return apiRequest<InstallAppResult>('apps/downloadAndInstall', { params: { name, url } })
}

/** Store-sourced update: same `name` + `url` contract as `downloadAndInstall`. */
export function downloadAndUpdateApp(name: string, url: string): Promise<UpdateAppResult> {
  return apiRequest<UpdateAppResult>('apps/downloadAndUpdate', { params: { name, url } })
}

export function uninstallApp(name: string): Promise<null> {
  return apiRequest<null>('apps/uninstall', { params: { name } })
}

/**
 * The app's configuration as an opaque string. Most apps use JSON but the format
 * is theirs to choose — render with `tryParseJsonConfig` and fall back to a plain
 * text editor.
 */
export function getAppConfig(name: string, node?: string): Promise<AppConfigResult> {
  return apiRequest<AppConfigResult>('apps/config/get', { params: { name, node } })
}

/** Saving also reloads the app, so a bad config surfaces as an error here. */
export function setAppConfig(name: string, config: string): Promise<null> {
  return apiRequest<null>('apps/config/set', { method: 'POST', params: { name }, body: { config } })
}
