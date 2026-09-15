import { describe, expect, it } from 'vitest'
import { buildCreateUserPayload, buildSetUserPayload, type UserPayloadForm } from '@/components/admin/user-payload'

/**
 * `admin/users/create` and `admin/users/set` request bodies.
 *
 * Everything pinned here fails *silently* against a real server, which is why it
 * is tested rather than left to the E2E run: `admin/*` answers `status: ok` to a
 * parameter it does not recognise and then changes nothing, so the dialog shows
 * a success toast and the operator believes the rename happened.
 *
 * The three contracts, each originally discovered by watching what the stock
 * console sends rather than by reading anything:
 *
 *  1. **Field spelling.** Upstream reads `newUser` and `newPass`; `newUsername`
 *     and `pass` are ignored without complaint.
 *  2. **`memberOfGroups` cannot be an empty array.** `appendParams`
 *     (`lib/api/client.ts:233`) drops empty arrays entirely, so clearing the
 *     last group would send nothing and leave the membership untouched. The
 *     single-empty-string form serialises to `memberOfGroups=`, matching
 *     `.probe/console-js/auth.js:1443`.
 *  3. **`totpEnabled` is a transition, not a state.** The endpoint is
 *     all-or-nothing and rejects an unchanged 2FA flag with "TOTP is already
 *     disabled for user" — taking the rename, the timeout and the group
 *     membership in the same request down with it. This is the regression that
 *     made the entire edit dialog fail, so it gets the most coverage below.
 */

/** A saved edit form for an account with 2FA off and one group. */
function form(overrides: Partial<UserPayloadForm> = {}): UserPayloadForm {
  return {
    user: 'operator',
    newUsername: '',
    displayName: 'Operator',
    pass: '',
    disabled: false,
    totpEnabled: false,
    sessionTimeoutSeconds: 1800,
    ...overrides,
  }
}

describe('buildCreateUserPayload', () => {
  it('sends only the three parameters admin/users/create takes', () => {
    expect(buildCreateUserPayload(form({ pass: 'hunter2!' }))).toEqual({
      user: 'operator',
      pass: 'hunter2!',
      displayName: 'Operator',
    })
  })

  it('omits displayName when blank rather than sending an empty one', () => {
    // `displayName=` is not "no display name" upstream — it overwrites.
    const payload = buildCreateUserPayload(form({ displayName: '', pass: 'hunter2!' }))
    expect(payload).toEqual({ user: 'operator', pass: 'hunter2!' })
    expect(payload).not.toHaveProperty('displayName')
  })

  it('never carries an edit-only field onto the create request', () => {
    // `admin/users/create` accepts a subset; leaking `disabled` or
    // `sessionTimeoutSeconds` here would be ignored today and could start
    // meaning something on a version bump.
    const payload = buildCreateUserPayload(
      form({ pass: 'hunter2!', disabled: true, sessionTimeoutSeconds: 60, totpEnabled: true, newUsername: 'renamed' }),
    )
    expect(Object.keys(payload).sort()).toEqual(['displayName', 'pass', 'user'])
  })
})

describe('buildSetUserPayload', () => {
  it('always sends the four fields the edit form owns outright', () => {
    expect(buildSetUserPayload(form(), ['staff'], false)).toEqual({
      user: 'operator',
      displayName: 'Operator',
      disabled: false,
      sessionTimeoutSeconds: 1800,
      memberOfGroups: ['staff'],
    })
  })

  it('uses upstream spelling for the rename and the password reset', () => {
    const payload = buildSetUserPayload(form({ newUsername: 'ops-lead', pass: 'hunter2!' }), [], false)
    expect(payload.newUser).toBe('ops-lead')
    expect(payload.newPass).toBe('hunter2!')
    expect(payload).not.toHaveProperty('newUsername')
    expect(payload).not.toHaveProperty('pass')
  })

  it('omits newUser when the rename field is blank or unchanged', () => {
    // Blank means "keep the name"; echoing the current name back would send a
    // rename onto the "user already exists" path.
    expect(buildSetUserPayload(form({ newUsername: '' }), [], false)).not.toHaveProperty('newUser')
    expect(buildSetUserPayload(form({ newUsername: 'operator' }), [], false)).not.toHaveProperty('newUser')
  })

  it('omits newPass when the password field is blank', () => {
    // Blank is "leave the stored password alone" in edit mode.
    expect(buildSetUserPayload(form({ pass: '' }), [], false)).not.toHaveProperty('newPass')
  })

  it('sends the single-empty-string form when the last group is removed', () => {
    expect(buildSetUserPayload(form(), [], false).memberOfGroups).toEqual([''])
  })

  it('sends the whole replacement list when groups are present', () => {
    // The endpoint replaces membership; it does not merge.
    expect(buildSetUserPayload(form(), ['staff', 'admins'], false).memberOfGroups).toEqual(['staff', 'admins'])
  })

  describe('totpEnabled transition rule', () => {
    it('omits the field when 2FA is already off and stays off', () => {
      // The regression: sending `false` here answers "TOTP is already disabled
      // for user" and the all-or-nothing endpoint rejects the whole request, so
      // a plain rename failed.
      const payload = buildSetUserPayload(form({ totpEnabled: false }), [], false)
      expect(payload).not.toHaveProperty('totpEnabled')
    })

    it('omits the field when 2FA is already on and stays on', () => {
      expect(buildSetUserPayload(form({ totpEnabled: true }), [], true)).not.toHaveProperty('totpEnabled')
    })

    it('sends false when the operator turns 2FA off', () => {
      // The one direction an administrator is allowed to take for someone else.
      expect(buildSetUserPayload(form({ totpEnabled: false }), [], true).totpEnabled).toBe(false)
    })

    it('sends true when the flag genuinely moves to on', () => {
      // Unreachable from the dialog — upstream refuses to let an administrator
      // enable 2FA for another account — but the builder is pure and must not
      // silently drop a transition it was asked to make.
      expect(buildSetUserPayload(form({ totpEnabled: true }), [], false).totpEnabled).toBe(true)
    })

    it('leaves the rest of a rename-only edit intact', () => {
      // The end-to-end shape of the request that used to fail: rename plus a
      // timeout change on an account whose 2FA is off.
      const payload = buildSetUserPayload(
        form({ newUsername: 'ops-lead', sessionTimeoutSeconds: 3600, totpEnabled: false }),
        ['staff'],
        false,
      )
      expect(payload).toEqual({
        user: 'operator',
        newUser: 'ops-lead',
        displayName: 'Operator',
        disabled: false,
        sessionTimeoutSeconds: 3600,
        memberOfGroups: ['staff'],
      })
    })
  })
})
