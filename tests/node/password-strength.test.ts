import { describe, expect, it } from 'vitest'
import {
  MIN_PASSWORD_LENGTH,
  passwordStrength,
  type PasswordStrength,
  type StrengthHint,
  type StrengthScore,
} from '@/components/account/password-strength'
import { loadMessages } from '@/lib/i18n/messages'

/**
 * `passwordStrength` runs on every keystroke of the change-password form, so it
 * has two jobs worth locking down and one that is easy to silently break.
 *
 * The two behavioural jobs are the bucket boundaries (the four `score` values
 * map 1:1 to the four `Progress` tones / label keys, so an off-by-one in the
 * points maths recolors the meter for every operator) and monotonicity — a
 * strictly stronger secret must never score lower, because a meter that goes
 * *down* as you add a symbol teaches people to delete it.
 *
 * The job that is easy to break is the copy contract. The function deliberately
 * returns stable hint *tokens* (`length` / `mix` / `common`) rather than text,
 * and `security-panel.tsx` maps each to a `security.password.strength.hint*`
 * message key plus the `score` to `weak|fair|good|strong`. If someone renames a
 * token here or a key in `messages/{zh,en}/account.json`, the pure function still
 * "works" and only the live component renders `undefined`. The last describe
 * block is the regression that matters most: it re-derives the component's exact
 * mapping and asserts every reachable key exists in the real bundle.
 */

/** Every token the function can emit; must stay in sync with `StrengthHint`. */
const ALL_HINTS: readonly StrengthHint[] = ['length', 'mix', 'common']

/** Mirrors `security-panel.tsx`: `score` indexes this tuple to pick a label key. */
const SCORE_LABEL_KEYS = ['weak', 'fair', 'good', 'strong'] as const

/** Mirrors `security-panel.tsx`'s `hint === 'length' ? hintLength : …` chain. */
const HINT_MESSAGE_KEYS: Record<StrengthHint, string> = {
  length: 'hintLength',
  mix: 'hintMix',
  common: 'hintCommon',
}

/** Narrow an unknown message tree one key at a time; never trust it as an object. */
function readMessage(node: unknown, path: readonly string[]): unknown {
  let current = node
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** The `account` namespace's `security.password.strength` subtree. */
function strengthMessages(locale: 'zh' | 'en'): unknown {
  return readMessage(loadMessages(locale), ['account', 'security', 'password', 'strength'])
}

function expectScore(value: string, expected: StrengthScore): PasswordStrength {
  const result = passwordStrength(value)
  expect(result.score, `score for ${JSON.stringify(value)}`).toBe(expected)
  return result
}

describe('passwordStrength — score buckets', () => {
  it('scores an empty string as weak (0) with no crash', () => {
    // The meter is hidden until the field is non-empty, but the function is
    // still called with '' on the first render — it must return, not throw.
    expectScore('', 0)
  })

  it('keeps anything below the minimum length at weak (0)', () => {
    // Even a high-variety secret is capped at 0 while it is too short: length is
    // the gate the early-return enforces before the points maths runs.
    expectScore('aB1!', 0)
    expectScore('Ab1', 0)
  })

  it('scores a single-class 8+ char secret as fair (1)', () => {
    // points = 1 (length only): variety < 3 keeps it out of the higher buckets.
    expectScore('abcdefgh', 1)
  })

  it('scores a long single-class secret as fair (1), not higher', () => {
    // points = 2 (length + >=12); variety still < 3, so it must not reach "good".
    expectScore('abcdefghijkl', 1)
  })

  it('scores a short 4-class secret as good (2)', () => {
    // points = 3 (length + variety>=3 + variety>=4) at exactly 8 chars.
    expectScore('Abcdef1!', 2)
  })

  it('scores a long 3-class secret as good (2)', () => {
    // points = 3 (length + >=12 + variety>=3); no fourth class, so not "strong".
    expectScore('Abcdefghijkl1', 2)
  })

  it('scores a long 4-class secret as strong (3)', () => {
    // points = 4 — the only way to reach the top bucket.
    expectScore('Abcdefghijkl1!', 3)
  })

  it('always returns a score inside the 0..3 ordinal', () => {
    const corpus = ['', 'x', 'abcdefgh', 'Abcdef1!', 'Abcdefghijkl1!', 'password', '密码密码密码密码']
    for (const value of corpus) {
      const { score } = passwordStrength(value)
      expect([0, 1, 2, 3], `score ${score} out of range for ${JSON.stringify(value)}`).toContain(score)
    }
  })
})

describe('passwordStrength — hints', () => {
  it('flags length only below the minimum, exactly at the boundary it does not', () => {
    // Ties the `length` hint to the exported MIN_PASSWORD_LENGTH constant rather
    // than a hard-coded 8, so changing the constant moves the boundary too.
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    const exact = 'a'.repeat(MIN_PASSWORD_LENGTH)
    expect(passwordStrength(short).hints).toContain('length')
    expect(passwordStrength(exact).hints).not.toContain('length')
  })

  it('flags mix when fewer than three character classes are present', () => {
    expect(passwordStrength('abcdefgh').hints).toContain('mix') // lower only
    expect(passwordStrength('Abcdefgh').hints).toContain('mix') // lower + upper (2)
    expect(passwordStrength('Abcdefgh1').hints).not.toContain('mix') // 3 classes
  })

  it('counts a symbol as the fourth class and clears the mix hint', () => {
    expect(passwordStrength('Abcdef1!').hints).not.toContain('mix')
  })

  it('returns length and mix together for an empty string', () => {
    expect(passwordStrength('').hints).toEqual(['length', 'mix'])
  })

  it('emits no hints for a strong, uncommon secret', () => {
    expect(passwordStrength('Abcdefghijkl1!').hints).toEqual([])
  })

  it('never emits a hint token outside the declared union', () => {
    // A stray token here would render `undefined` in the component's hint list.
    const corpus = ['', 'a', 'abcdefgh', 'password', '123456', 'Abcdef1!', 'welcome99', '密码']
    for (const value of corpus) {
      for (const hint of passwordStrength(value).hints) {
        expect(ALL_HINTS, `unexpected hint ${hint} for ${JSON.stringify(value)}`).toContain(hint)
      }
    }
  })
})

describe('passwordStrength — common-password blocklist', () => {
  it('flags every listed breach-corpus password as common with score 0', () => {
    const common = [
      'password', 'password1', 'password123', '123456', '12345678', '123456789',
      '1234567890', 'qwerty', 'qwerty123', 'abc123', 'letmein', 'admin',
      'administrator', 'welcome', 'welcome1', 'iloveyou', '111111', '000000',
      '1q2w3e4r', 'qwertyuiop',
    ]
    for (const value of common) {
      const result = passwordStrength(value)
      expect(result.hints, `${value} should be common`).toContain('common')
      expect(result.score, `${value} should score 0`).toBe(0)
    }
  })

  it('matches the blocklist case-insensitively', () => {
    expect(passwordStrength('PASSWORD').hints).toContain('common')
    expect(passwordStrength('QwErTy').hints).toContain('common')
  })

  it('catches a blocklist word with trailing digits appended', () => {
    // The `.replace(/\d+$/, '')` branch: 'admin123' is not literally listed but
    // strips to 'admin', which is — a very common "I made it stronger" trick.
    expect(passwordStrength('admin123').hints).toContain('common')
    expect(passwordStrength('welcome99').hints).toContain('common')
  })

  it('does not flag an uncommon secret that merely ends in digits', () => {
    // Guards against the trailing-digit strip over-matching legitimate secrets.
    expect(passwordStrength('Tr0ub4dor&3').hints).not.toContain('common')
    expect(passwordStrength('correct-horse-9').hints).not.toContain('common')
  })
})

describe('passwordStrength — monotonicity', () => {
  it('never decreases the score as a secret is strengthened step by step', () => {
    // Each step adds length or a character class; a meter that regresses here is
    // the classic "it went down when I added a symbol" support ticket.
    const ladder = [
      '',
      'a',
      'abc',
      'abcdefgh',
      'Abcdefgh',
      'Abcdefgh1',
      'Abcdefgh1!',
      'Abcdefghijkl1!',
    ]
    const scores = ladder.map((value) => passwordStrength(value).score)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i], `${ladder[i]} scored below ${ladder[i - 1]}`).toBeGreaterThanOrEqual(scores[i - 1])
    }
    // And the ladder actually climbs to the top bucket rather than plateauing.
    expect(scores[scores.length - 1]).toBe(3)
  })

  it('holds the top score when extra length is appended to a strong secret', () => {
    const base = passwordStrength('Abcdefghijkl1!').score
    const longer = passwordStrength('Abcdefghijkl1!moreSecret').score
    expect(longer).toBeGreaterThanOrEqual(base)
  })
})

describe('passwordStrength — unicode robustness', () => {
  it('handles a CJK secret without crashing', () => {
    // Every Han character is a "symbol" to the ASCII classes, so variety is 1 and
    // the secret is fair at 8 chars; the point is that it returns rather than throws.
    const result = passwordStrength('密码密码密码密码')
    expect(result.score).toBe(1)
    expect(result.hints).toContain('mix')
  })

  it('handles emoji (surrogate pairs) without crashing', () => {
    const result = passwordStrength('🔒🔒🔒🔒')
    expect([0, 1, 2, 3]).toContain(result.score)
  })

  it('treats a mixed-script secret as high variety', () => {
    // Latin upper + Latin lower + digit + a non-ASCII symbol class = 4 classes.
    const result = passwordStrength('Passw0rd密')
    expect(result.hints).not.toContain('mix')
  })
})

describe('passwordStrength — i18n copy contract', () => {
  // This is the assertion that protects the live component: the pure function
  // only emits tokens/ordinals, and `security-panel.tsx` is what turns them into
  // message keys. Re-derive that exact mapping against the real bundle so a
  // renamed token or a deleted key fails here instead of rendering `undefined`.
  const locales = ['zh', 'en'] as const

  it.each(locales)('maps every score ordinal to an existing %s label key', (locale) => {
    const strength = strengthMessages(locale)
    const scores: StrengthScore[] = [0, 1, 2, 3]
    for (const score of scores) {
      const key = SCORE_LABEL_KEYS[score]
      const value = readMessage(strength, [key])
      expect(typeof value, `${locale}:strength.${key} missing`).toBe('string')
      expect((value as string).length, `${locale}:strength.${key} empty`).toBeGreaterThan(0)
    }
  })

  it.each(locales)('maps every hint token to an existing %s message key', (locale) => {
    const strength = strengthMessages(locale)
    for (const hint of ALL_HINTS) {
      const key = HINT_MESSAGE_KEYS[hint]
      const value = readMessage(strength, [key])
      expect(typeof value, `${locale}:strength.${key} (hint ${hint}) missing`).toBe('string')
      expect((value as string).length, `${locale}:strength.${key} empty`).toBeGreaterThan(0)
    }
  })

  it.each(locales)('exposes the shared label and a {min} placeholder on hintLength in %s', (locale) => {
    const strength = strengthMessages(locale)
    // The component renders `t('strength.label')` for the row caption and passes
    // `{ min: MIN_PASSWORD_LENGTH }` into hintLength, so both must be present.
    expect(typeof readMessage(strength, ['label']), `${locale}:strength.label missing`).toBe('string')
    const hintLength = readMessage(strength, ['hintLength'])
    expect(typeof hintLength).toBe('string')
    expect(hintLength as string, `${locale}:hintLength lacks {min}`).toContain('{min}')
  })

  it.each(locales)('provides a message key for every hint actually emitted (%s)', (locale) => {
    // Drive the real function over a corpus and confirm each emitted hint has a
    // translation — catches a token that exists in the type but has no copy.
    const strength = strengthMessages(locale)
    const corpus = ['', 'a', 'abcdefgh', 'password', '123456', 'admin123', 'Abcdef1!']
    const emitted = new Set<StrengthHint>()
    for (const value of corpus) {
      for (const hint of passwordStrength(value).hints) emitted.add(hint)
    }
    expect(emitted.size, 'corpus should exercise more than one hint').toBeGreaterThan(1)
    for (const hint of emitted) {
      expect(readMessage(strength, [HINT_MESSAGE_KEYS[hint]]), `${locale}: hint ${hint} has no copy`).toBeDefined()
    }
  })
})

describe('MIN_PASSWORD_LENGTH', () => {
  it('is the boundary the length hint and the early-return both use', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8)
    // One char under the constant is weak + length-hinted; at the constant it is
    // not length-hinted. This is what makes the exported number load-bearing.
    expect(passwordStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1)).score).toBe(0)
    expect(passwordStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1)).hints).toContain('length')
    expect(passwordStrength('a'.repeat(MIN_PASSWORD_LENGTH)).hints).not.toContain('length')
  })
})
