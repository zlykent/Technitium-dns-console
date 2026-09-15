import { z } from 'zod'

/**
 * The numeric-field contract shared by every dialog that sends a number to
 * Technitium.
 *
 * This used to live in `components/dnssec/validation.ts`, which was fine while
 * only the DNSSEC dialogs needed it. The cluster options dialog needs exactly
 * the same thing, and `components/admin` importing from `components/dnssec`
 * would mean deleting the DNSSEC feature breaks Administration — so the part
 * that is about *the platform* rather than about DNSSEC lives here.
 *
 * The platform fact that forces the shape: every Technitium parameter travels
 * in the query string, so numeric inputs are held as strings in
 * react-hook-form and parsed on submit. That makes "empty" and "not a number"
 * the same failure, and it must be reported with the console-wide
 * `common:form.*` copy rather than zod's built-in English messages — hence
 * `integerField` takes resolved strings instead of a translator.
 *
 * The bounds themselves are documented at each call site because they come from
 * unrelated places: RFC 5155 (NSEC3 iterations / salt length are one octet
 * each), the .NET `int` the server stores TTLs in, the ranges the cluster
 * options endpoint accepts, and plain operator sanity.
 */

/**
 * Copy for the numeric validators, resolved once per dialog from the `common`
 * translator.
 *
 * Passing strings and closures instead of the translator itself keeps this
 * module free of next-intl's `Translator<Messages, Namespace>` generics, which
 * are not structurally compatible with a plain call signature. Each caller
 * therefore builds this literal — the duplication is deliberate and is the
 * price of not threading a generic translator type through the schema builders.
 */
export interface NumberFieldMessages {
  /** `common:form.invalidNumber` */
  invalid: string
  /** `common:form.minValue` with the bound interpolated. */
  tooSmall: (min: number) => string
  /** `common:form.maxValue` with the bound interpolated. */
  tooBig: (max: number) => string
}

/**
 * Inclusive non-negative integer field. Returns a `ZodString` (zod v4 keeps
 * `.trim()` / `.refine()` composable), so the parsed value is already trimmed
 * and safe to hand straight to `Number(...)` on submit.
 *
 * The regex runs before both bound refines on purpose: zod v4 collects every
 * failed check rather than aborting, and `Number('abc')` is `NaN`, which fails
 * `>= min` and `<= max` too. react-hook-form's resolver surfaces the *first*
 * issue, so the format error has to be ordered ahead of a misleading
 * "too small".
 */
export function integerField(min: number, max: number, messages: NumberFieldMessages) {
  return z
    .string()
    .trim()
    .regex(/^\d+$/, messages.invalid)
    .refine((value) => Number(value) >= min, messages.tooSmall(min))
    .refine((value) => Number(value) <= max, messages.tooBig(max))
}
