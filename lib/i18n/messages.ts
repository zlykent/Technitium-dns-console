import type { Locale } from './config'

/**
 * Message loading.
 *
 * Translations are split into one file per feature namespace under
 * `messages/<locale>/`. Splitting matters for two reasons: a 4k-line JSON blob
 * is unreviewable, and a page only needs its own slice.
 *
 * The imports are static (not `import(\`...\${locale}\`)`) so the bundler can
 * resolve them at build time and a typo fails the build instead of rendering
 * raw keys at runtime.
 */

import zhCommon from '@/messages/zh/common.json'
import zhNav from '@/messages/zh/nav.json'
import zhAuth from '@/messages/zh/auth.json'
import zhErrors from '@/messages/zh/errors.json'
import zhDashboard from '@/messages/zh/dashboard.json'
import zhZones from '@/messages/zh/zones.json'
import zhRecords from '@/messages/zh/records.json'
import zhDnssec from '@/messages/zh/dnssec.json'
import zhFiltering from '@/messages/zh/filtering.json'
import zhLogs from '@/messages/zh/logs.json'
import zhDhcp from '@/messages/zh/dhcp.json'
import zhApps from '@/messages/zh/apps.json'
import zhDnsClient from '@/messages/zh/dns-client.json'
import zhSettings from '@/messages/zh/settings.json'
import zhAdmin from '@/messages/zh/admin.json'
import zhAccount from '@/messages/zh/account.json'

import enCommon from '@/messages/en/common.json'
import enNav from '@/messages/en/nav.json'
import enAuth from '@/messages/en/auth.json'
import enErrors from '@/messages/en/errors.json'
import enDashboard from '@/messages/en/dashboard.json'
import enZones from '@/messages/en/zones.json'
import enRecords from '@/messages/en/records.json'
import enDnssec from '@/messages/en/dnssec.json'
import enFiltering from '@/messages/en/filtering.json'
import enLogs from '@/messages/en/logs.json'
import enDhcp from '@/messages/en/dhcp.json'
import enApps from '@/messages/en/apps.json'
import enDnsClient from '@/messages/en/dns-client.json'
import enSettings from '@/messages/en/settings.json'
import enAdmin from '@/messages/en/admin.json'
import enAccount from '@/messages/en/account.json'

export type Messages = Record<string, unknown>

const ZH: Messages = {
  common: zhCommon,
  nav: zhNav,
  auth: zhAuth,
  errors: zhErrors,
  dashboard: zhDashboard,
  zones: zhZones,
  records: zhRecords,
  dnssec: zhDnssec,
  filtering: zhFiltering,
  logs: zhLogs,
  dhcp: zhDhcp,
  apps: zhApps,
  dnsClient: zhDnsClient,
  settings: zhSettings,
  admin: zhAdmin,
  account: zhAccount,
}

const EN: Messages = {
  common: enCommon,
  nav: enNav,
  auth: enAuth,
  errors: enErrors,
  dashboard: enDashboard,
  zones: enZones,
  records: enRecords,
  dnssec: enDnssec,
  filtering: enFiltering,
  logs: enLogs,
  dhcp: enDhcp,
  apps: enApps,
  dnsClient: enDnsClient,
  settings: enSettings,
  admin: enAdmin,
  account: enAccount,
}

const BUNDLES: Record<Locale, Messages> = { zh: ZH, en: EN }

export const MESSAGE_NAMESPACES = Object.keys(ZH)

export function loadMessages(locale: Locale): Messages {
  return BUNDLES[locale] ?? ZH
}
