import { z } from 'zod'

/**
 * PEM validators for the DNSSEC dialogs.
 *
 * Only the private-key checks live here. `integerField` and
 * `NumberFieldMessages` moved to `@/lib/validation/number-field` once the
 * cluster options dialog needed them too: they describe how *any* Technitium
 * numeric query-string parameter behaves, not anything about DNSSEC, and
 * leaving them here would make `components/admin` depend on `components/dnssec`.
 *
 * The message strings are passed in rather than resolved here for the same
 * reason the numeric ones are — the copy belongs to the caller's namespace
 * (`dnssec:sign.pemInvalid`), and this module stays free of next-intl's
 * `Translator<Messages, Namespace>` generics.
 */

/**
 * A PEM private-key block header. Deliberately permissive about the algorithm
 * label (`RSA`, `EC`, `OPENSSH`, `PRIVATE KEY`) — the server does the real
 * parsing — but strict enough to reject a pasted *public* key or a block whose
 * first line was lost in copy/paste.
 */
export const PEM_PRIVATE_KEY_HEADER = /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/

/**
 * Optional PEM field: blank means "let the server generate the key", so only a
 * non-empty value is checked against the block header.
 *
 * There is deliberately no `requiredPemField`. Both dialogs that can demand a
 * key ("use my key" in add-private-key, and the KSK/ZSK pair in sign-zone) make
 * the field optional at the schema level and add the issue from a `superRefine`
 * instead, because whether a PEM is required depends on *another* field's value
 * (`generationMode`) and on the two fields cross-checking each other. A separate
 * required variant could not express either, and the one that existed was never
 * called.
 */
export function pemField(message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === '' || PEM_PRIVATE_KEY_HEADER.test(value), message)
}
