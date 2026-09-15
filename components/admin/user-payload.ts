import type { CreateUserParams, SetUserParams } from '@/lib/api/types/admin'

/**
 * Request-body construction for `admin/users/create` and `admin/users/set`.
 *
 * Split out of `user-dialog.tsx` because every rule here is a *silent-failure*
 * trap: `admin/*` answers `status: ok` to a parameter it does not recognise and
 * then does nothing, so a wrong payload produces a success toast and no change.
 * None of that is observable from a rendered component, which is why these are
 * pure functions with their own tests rather than branches inside a mutation.
 *
 * The three rules encoded below were each found by watching the stock console's
 * own requests rather than by reading documentation:
 *
 *  - **`newUser` / `newPass`, never `newUsername` / `pass`.** Verified against
 *    v15.4 by renaming a scratch account and then signing in with the new
 *    password; the obvious spellings left both unchanged (`SetUserParams` in
 *    `lib/api/types/admin.ts` carries the same warning).
 *  - **`memberOfGroups: []` cannot be sent.** `appendParams`
 *    (`lib/api/client.ts:233`) drops empty arrays, so clearing the last group
 *    would be a no-op. `['']` serialises to `memberOfGroups=` — byte-for-byte
 *    what the stock console does (`.probe/console-js/auth.js:1443`).
 *  - **`totpEnabled` is a transition, not a state.** See `buildSetUserPayload`.
 */

/**
 * The subset of the dialog's form values the payload depends on.
 *
 * Declared structurally rather than reusing the zod-inferred type so this module
 * stays free of `zod` and of the dialog's message-parameterised schema builder —
 * a test can hand it a plain object literal.
 */
export interface UserPayloadForm {
  /** The account's *current* username; the key upstream addresses it by. */
  user: string
  /** Rename target. Blank means "keep the current username". */
  newUsername: string
  displayName: string
  /** New password. Blank means "leave the stored password alone". */
  pass: string
  disabled: boolean
  totpEnabled: boolean
  sessionTimeoutSeconds: number
}

/** `admin/users/create` — three parameters, and only those. */
export function buildCreateUserPayload(values: UserPayloadForm): CreateUserParams {
  const create: CreateUserParams = { user: values.user, pass: values.pass }
  // Omitted rather than sent blank: an empty `displayName=` is not "no display
  // name" to upstream, it overwrites whatever was there with nothing.
  if (values.displayName) create.displayName = values.displayName
  return create
}

/**
 * `admin/users/set` — the whole edit form, minus the fields that must not ride
 * along.
 *
 * @param groups       The membership list to replace the stored one with.
 * @param originalTotp The 2FA state as the server currently holds it.
 *
 * The endpoint is all-or-nothing, and it reads `totpEnabled` as a *transition*:
 * sending `false` for an account whose 2FA is already off answers "TOTP is
 * already disabled for user", and because nothing else in the request survives
 * that rejection, a plain rename or a session-timeout change failed with it.
 * The stock console never hits this because its edit dialog does not send the
 * field at all — 2FA is a separate row action there
 * (`.probe/console-js/auth.js:1428-1444`, and `:1643` for the off transition).
 *
 * So the field goes out only when the operator actually moved the switch.
 */
export function buildSetUserPayload(values: UserPayloadForm, groups: string[], originalTotp: boolean): SetUserParams {
  // Assembled as a typed object instead of an inline literal with conditional
  // spreads: `...(x ? { newUser: x } : {})` bypasses excess-property checking,
  // which is exactly how the two misnamed fields above survived review.
  const update: SetUserParams = {
    user: values.user,
    displayName: values.displayName,
    disabled: values.disabled,
    sessionTimeoutSeconds: values.sessionTimeoutSeconds,
    // See the `['']` note in the module header.
    memberOfGroups: groups.length > 0 ? groups : [''],
  }
  if (values.totpEnabled !== originalTotp) update.totpEnabled = values.totpEnabled
  // A rename to the name the account already has is not a rename; sending it
  // would make upstream answer with the "user already exists" path.
  if (values.newUsername && values.newUsername !== values.user) update.newUser = values.newUsername
  if (values.pass) update.newPass = values.pass
  return update
}
