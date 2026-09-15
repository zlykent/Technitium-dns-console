import type { SessionEntry } from './common'

/** Account self-service: profile, password, TOTP, API tokens, update check. */

export interface LoginParams {
  user: string
  pass: string
  /** Six-digit code; required when the account has TOTP enabled. */
  totp?: string
  /** Always true from this UI — we need the permission map to gate navigation. */
  includeInfo?: boolean
}

export interface UserProfile {
  displayName: string
  username: string
  isSsoUser: boolean
  totpEnabled: boolean
  disabled: boolean
  previousSessionLoggedOn: string | null
  previousSessionRemoteAddress: string | null
  recentSessionLoggedOn: string | null
  recentSessionRemoteAddress: string | null
  sessionTimeoutSeconds: number
  ssoManagedGroups: boolean
  memberOfGroups: string[]
  sessions: SessionEntry[]
}

export interface ChangePasswordParams {
  pass: string
  newPass: string
  totp?: string
  /** Returns a fresh session payload so the UI can refresh permissions in place. */
  includeInfo?: boolean
}

/** `user/2fa/init` — the secret to seed an authenticator app with. */
export interface TotpInitResult {
  /** Base64 PNG, rendered as a `data:` image. */
  qrCodePngImage: string
  /** Base32 secret for manual entry. */
  totpSecretKey?: string
  totpSecretKeyBase32?: string
}

export interface EnableTotpParams {
  totp: string
}

/** `user/createToken` — a long-lived API token for the calling user. */
export interface CreateTokenParams {
  tokenName: string
}

export interface CreatedToken {
  token: string
  tokenName: string
  partialToken: string
  username?: string
}

export interface CheckForUpdateResult {
  dnsServerEnableCheckForUpdate: boolean
  updateAvailable: boolean
  updateVersion: string
  currentVersion: string
}

/**
 * Which parts of a backup archive to include. Mirrors the checkbox matrix on the
 * Settings page; every flag defaults to on because that is what "back up
 * everything" means to an operator.
 */
export interface BackupOptions {
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
  node?: string
}

export const ALL_BACKUP_OPTIONS: (keyof BackupOptions)[] = [
  'authConfig',
  'clusterConfig',
  'webServiceSettings',
  'dnsSettings',
  'logSettings',
  'stats',
  'scopes',
  'zones',
  'allowedZones',
  'blockedZones',
  'blockLists',
  'apps',
  'logs',
]

export const DEFAULT_BACKUP_OPTIONS: BackupOptions = {
  authConfig: true,
  clusterConfig: true,
  webServiceSettings: true,
  dnsSettings: true,
  logSettings: true,
  stats: true,
  scopes: true,
  zones: true,
  allowedZones: true,
  blockedZones: true,
  blockLists: true,
  apps: true,
  logs: false,
  deleteExistingFiles: false,
}
