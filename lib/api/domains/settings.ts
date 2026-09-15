import { apiDownload, apiRequest, type QueryParams } from '../client'
import type { DnsSettings, QpmPrefixLimit, UpstreamProxy } from '../types/settings'

/**
 * Server settings.
 *
 * `settings/get` returns ~132 fields and `settings/set` accepts any subset of
 * them as one flat form, so this module is deliberately thin: a typed read, a
 * typed patch writer, and helpers for the handful of values whose wire format
 * differs from the JSON we render (proxy, network ACLs, prefix limits).
 */

export type SettingsValue = string | number | boolean | readonly string[] | null

/** A partial settings document, exactly as `settings/set` wants it. */
export type SettingsPatch = Record<string, SettingsValue | undefined>

export function getSettings(node?: string): Promise<DnsSettings> {
  return apiRequest<DnsSettings>('settings/get', { params: { node } })
}

/**
 * Write any subset of the settings. Technitium applies only the keys present,
 * which is what lets the UI split one giant form across several sections and
 * still save each independently.
 */
export function setSettings(patch: SettingsPatch, node?: string): Promise<DnsSettings> {
  const body: QueryParams = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    body[key] = value as QueryParams[string]
  }
  if (node) body.node = node
  return apiRequest<DnsSettings>('settings/set', { method: 'POST', body })
}

/** Names of the TSIG keys configured on the server, for the zone-option pickers. */
export function getTsigKeyNames(): Promise<{ tsigKeyNames: string[] }> {
  return apiRequest<{ tsigKeyNames: string[] }>('settings/getTsigKeyNames')
}

/** Force every block-list URL to refresh right now instead of on schedule. */
export function forceUpdateBlockLists(node?: string): Promise<{ totalBlockLists: number; taskWasAlreadyRunning: boolean }> {
  return apiRequest<{ totalBlockLists: number; taskWasAlreadyRunning: boolean }>('settings/forceUpdateBlockLists', { params: { node } })
}

/**
 * Suspend blocking for a while — the classic "let me reach one site without
 * editing the block list" escape hatch.
 */
export function temporaryDisableBlocking(minutes: number, node?: string): Promise<null> {
  return apiRequest<null>('settings/temporaryDisableBlocking', { params: { minutes, node } })
}

/**
 * Stream a `.tzsp` backup. Every section is opt-in; the console defaults to
 * everything except the log files, so we mirror that in the caller.
 */
export interface BackupSections {
  authConfig?: boolean
  clusterConfig?: boolean
  webServiceSettings?: boolean
  dnsSettings?: boolean
  logSettings?: boolean
  stats?: boolean
  scopes?: boolean
  zones?: boolean
  allowedZones?: boolean
  blockedZones?: boolean
  blockLists?: boolean
  apps?: boolean
  logs?: boolean
  deleteExistingFiles?: boolean
}

export function backup(sections: BackupSections = {}, filename = 'dns-app-config-backup.tzsp'): Promise<void> {
  const params: QueryParams = {}
  for (const [key, value] of Object.entries(sections)) {
    if (value !== undefined) params[key] = value
  }
  return apiDownload('settings/backup', params, filename)
}

/** Restore from a `.tzsp` file. Replaces server configuration — destructive. */
export function restore(file: File, node?: string): Promise<null> {
  const form = new FormData()
  form.append('file', file, file.name)
  if (node) form.append('node', node)
  return apiRequest<null>('settings/restore', { method: 'POST', formData: form })
}

// ------------------------------------------------------------------ mappers

/**
 * `settings/get` nests the upstream proxy under `proxy`; `settings/set` wants
 * five flat `proxy*` keys. Keeping both directions here means no page has to
 * remember which spelling applies.
 */
export function proxyToPatch(proxy: UpstreamProxy | null): SettingsPatch {
  if (!proxy || proxy.type === 'None') {
    return { proxyType: 'None', proxyAddress: '', proxyPort: 0, proxyUsername: '', proxyPassword: '', proxyBypass: [] }
  }
  return {
    proxyType: proxy.type,
    proxyAddress: proxy.address,
    proxyPort: proxy.port,
    proxyUsername: proxy.username ?? '',
    proxyPassword: proxy.password ?? '',
    proxyBypass: proxy.bypass ?? [],
  }
}

export function patchToProxy(patch: Partial<Record<'proxyType' | 'proxyAddress' | 'proxyPort' | 'proxyUsername' | 'proxyPassword' | 'proxyBypass', SettingsValue>>): UpstreamProxy | null {
  const type = (patch.proxyType as UpstreamProxy['type']) ?? 'None'
  if (type === 'None') return null
  const bypass = patch.proxyBypass
  return {
    type,
    address: String(patch.proxyAddress ?? ''),
    port: Number(patch.proxyPort ?? 0),
    username: (patch.proxyUsername as string | null) ?? null,
    password: (patch.proxyPassword as string | null) ?? null,
    bypass: Array.isArray(bypass) ? (bypass as string[]) : undefined,
  }
}

/**
 * One rate-limit row per line as `prefix/udp/tcp` in the UI. `prefix` is a mask
 * length (32 = a single IPv4 host, 64 = an IPv6 subnet).
 */
export function parseQpmPrefixLimits(text: string): QpmPrefixLimit[] {
  const out: QpmPrefixLimit[] = []
  for (const line of text.split('\n')) {
    const value = line.trim()
    if (!value || value.startsWith('#')) continue
    const parts = value.split('/').map((p) => p.trim())
    const prefix = Number(parts[0])
    if (!Number.isFinite(prefix)) continue
    out.push({ prefix, udpLimit: Number(parts[1] ?? 0), tcpLimit: Number(parts[2] ?? 0) })
  }
  return out
}

export function formatQpmPrefixLimits(limits: QpmPrefixLimit[] | null | undefined): string {
  return (limits ?? []).map((l) => `${l.prefix}/${l.udpLimit}/${l.tcpLimit}`).join('\n')
}

/**
 * Technitium's `serializeTableData(table, 3)` is a *flat* `|`-joined list of
 * every cell, row after row — not rows joined by commas. Reproduced exactly,
 * because the server parses it back with the same convention.
 */
export function serializeQpmPrefixLimits(limits: QpmPrefixLimit[]): string | undefined {
  if (limits.length === 0) return undefined
  return limits.map((l) => `${l.prefix}|${l.udpLimit}|${l.tcpLimit}`).join('|')
}

/** Turn a `<textarea>` of one-entry-per-line into the comma list the API wants. */
export function parseLineList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

export function formatLineList(items: string[] | null | undefined): string {
  return (items ?? []).join('\n')
}

/**
 * Same as `cleanTextList` in the stock console: newlines become commas, runs of
 * commas collapse, and a list that ends up empty is omitted so the server keeps
 * its current value.
 */
export function serializeLineList(items: readonly string[]): string | undefined {
  const value = items.map((i) => i.trim()).filter(Boolean).join(',')
  return value.length === 0 ? undefined : value
}
