/**
 * Password strength scoring.
 *
 * A deliberately tiny, dependency-free heuristic rather than a port of
 * zxcvbn: this runs on every keystroke in the change-password form and its only
 * job is to nudge operators away from short, low-variety or common secrets. It
 * is exported as a pure function so it can be unit-tested without mounting any
 * React, and so the copy stays in the component (the function returns stable
 * hint *tokens*, the caller maps them to `security.password.strength.hint*`).
 *
 * `score` is a 0..3 ordinal (weak / fair / good / strong) — four buckets match
 * the four `Progress` tones and the four label keys, so the UI needs no maths.
 */

/** Technitium rejects anything shorter than this; the form enforces the same. */
export const MIN_PASSWORD_LENGTH = 8

export type StrengthScore = 0 | 1 | 2 | 3

/** Hint tokens; the component maps each to a `strength.hint*` message key. */
export type StrengthHint = 'length' | 'mix' | 'common'

export interface PasswordStrength {
  score: StrengthScore
  hints: StrengthHint[]
}

/** A short blocklist of the passwords that dominate real-world breach corpora. */
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'admin',
  'administrator',
  'welcome',
  'welcome1',
  'iloveyou',
  '111111',
  '000000',
  '1q2w3e4r',
  'qwertyuiop',
])

export function passwordStrength(value: string): PasswordStrength {
  const hints: StrengthHint[] = []
  const length = value.length

  if (length < MIN_PASSWORD_LENGTH) hints.push('length')

  const hasLower = /[a-z]/.test(value)
  const hasUpper = /[A-Z]/.test(value)
  const hasDigit = /\d/.test(value)
  const hasSymbol = /[^A-Za-z0-9]/.test(value)
  const variety = Number(hasLower) + Number(hasUpper) + Number(hasDigit) + Number(hasSymbol)
  if (variety < 3) hints.push('mix')

  const lower = value.toLowerCase()
  const isCommon = COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(lower.replace(/\d+$/, ''))
  if (isCommon) hints.push('common')

  if (length === 0) return { score: 0, hints }
  if (isCommon || length < MIN_PASSWORD_LENGTH) return { score: 0, hints }

  // Points reward both length and character-class variety; the thresholds keep
  // an 8-char single-class password at "weak" and a 12+ char mixed one at "strong".
  let points = 0
  if (length >= MIN_PASSWORD_LENGTH) points += 1
  if (length >= 12) points += 1
  if (variety >= 3) points += 1
  if (variety >= 4) points += 1

  const score: StrengthScore = points <= 2 ? 1 : points === 3 ? 2 : 3
  return { score, hints }
}
