import { describe, expect, it, vi } from 'vitest'

/**
 * The store-sourced download contract: `name` **and** `url`.
 *
 * Upstream answers a missing `url` on `apps/downloadAndInstall` /
 * `apps/downloadAndUpdate` with "Parameter 'url' missing." — the console used to
 * send only `name`, so every store install died with that toast while the store
 * list sat right there holding the download link. These pin both parameters so
 * the regression cannot come back silently (the e2e suite never installs on the
 * live server, so nothing over there can catch it).
 */

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('@/lib/api/client', () => ({ apiRequest }))

const { downloadAndInstallApp, downloadAndUpdateApp } = await import('@/lib/api/domains/apps')

const URL = 'https://download.technitium.com/dns/apps/NxDomainApp-v8.0.zip'

describe('apps — store downloads carry the url the server fetches', () => {
  it('downloadAndInstallApp sends name and url', async () => {
    apiRequest.mockResolvedValue({ installedApp: { name: 'NX Domain' } })

    await downloadAndInstallApp('NX Domain', URL)

    expect(apiRequest).toHaveBeenCalledWith('apps/downloadAndInstall', { params: { name: 'NX Domain', url: URL } })
  })

  it('downloadAndUpdateApp sends name and url', async () => {
    apiRequest.mockResolvedValue({ updatedApp: { name: 'NX Domain' } })

    await downloadAndUpdateApp('NX Domain', URL)

    expect(apiRequest).toHaveBeenCalledWith('apps/downloadAndUpdate', { params: { name: 'NX Domain', url: URL } })
  })
})
