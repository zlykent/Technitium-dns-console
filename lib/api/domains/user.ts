import { apiRequest } from '../client'
import type { Session, SessionEntry } from '../types/common'
import type {
  ChangePasswordParams,
  CheckForUpdateResult,
  CreatedToken,
  EnableTotpParams,
  LoginParams,
  TotpInitResult,
  UserProfile,
} from '../types/user'

/**
 * Authentication and account self-service.
 *
 * `login` is the only call whose success has a side effect in the proxy: the
 * returned token is captured into an httpOnly cookie there and stripped from the
 * payload before it reaches the browser, so `Session.token` is always undefined
 * client-side. Callers must not depend on it.
 */
export async function login(params: LoginParams): Promise<Session> {
  const session = await apiRequest<Session>('user/login', {
    method: 'POST',
    body: { user: params.user, pass: params.pass, totp: params.totp ?? '', includeInfo: true },
  })
  return { ...session, token: undefined }
}

export async function logout(): Promise<void> {
  await apiRequest<null>('user/logout')
}

/** Re-reads the session payload; the proxy also refreshes the stored token. */
export function getSession(): Promise<Session> {
  return apiRequest<Session>('user/session/get')
}

export function deleteSession(partialToken: string, node?: string): Promise<null> {
  return apiRequest<null>('user/session/delete', { params: { partialToken, node } })
}

export function getProfile(): Promise<UserProfile> {
  return apiRequest<UserProfile>('user/profile/get')
}

export function setProfile(displayName: string): Promise<null> {
  return apiRequest<null>('user/profile/set', { params: { displayName } })
}

export function changePassword(params: ChangePasswordParams): Promise<Session> {
  return apiRequest<Session>('user/changePassword', {
    method: 'POST',
    body: { pass: params.pass, newPass: params.newPass, totp: params.totp ?? '', includeInfo: params.includeInfo ?? true },
  })
}

export function initTotp(): Promise<TotpInitResult> {
  return apiRequest<TotpInitResult>('user/2fa/init')
}

export function enableTotp(params: EnableTotpParams): Promise<null> {
  return apiRequest<null>('user/2fa/enable', { method: 'POST', body: { totp: params.totp } })
}

export function disableTotp(totp: string): Promise<null> {
  return apiRequest<null>('user/2fa/disable', { params: { totp } })
}

export function createApiToken(tokenName: string): Promise<CreatedToken> {
  return apiRequest<CreatedToken>('user/createToken', { method: 'POST', body: { tokenName } })
}

export function checkForUpdate(): Promise<CheckForUpdateResult> {
  return apiRequest<CheckForUpdateResult>('user/checkForUpdate')
}

export type { SessionEntry }
