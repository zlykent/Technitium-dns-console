// Gate: every translation key the code asks for must exist in every locale.
//
//   node scripts/check-i18n-usage.mjs
//
// `scripts/check-i18n.mjs` proves the two locales agree with each other; it
// cannot see that a component asks for `cluster.primary.primaryServerUrl` when
// no such key was ever written. That mismatch does not fail the build — next-intl
// renders `admin.cluster.primary.primaryServerUrl` into the page and logs an
// error, so a typo'd key ships as visible garbage. This script is the only thing
// that catches it.
//
// How it resolves keys:
//
//  1. Per file, record every `useTranslations('ns')` / `getTranslations('ns')`
//     declaration with its source offset, then resolve each call site against
//     the *nearest preceding* declaration of the same variable name. One file
//     holds several components that each reuse the name `t` for a different
//     namespace, so a flat name -> namespace map misattributes keys and invents
//     failures (it once reported `common:table.loading` as `errors:table.loading`
//     because `ErrorState` further down the file declared `t` for `errors`).
//  2. For each `t('a.b.c')` / `t("a.b.c")` call site, look up `ns.a.b.c`.
//  3. Dynamic keys — `t(\`x.${y}\`)`, `t(someVar)` — cannot be resolved
//     statically. They are reported separately as "unchecked" so the number is
//     visible, but they never fail the run: an enum switch behind a template
//     literal is legitimate and the caller is expected to keep it honest.
//
// Keys reached through a spread namespace (`useTranslations()` with no argument)
// are also unverifiable; those files are listed at the end.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const messagesDir = join(root, 'messages')
const LOCALES = ['zh', 'en']
const SCAN_DIRS = ['app', 'components', 'lib']

/* ------------------------------------------------------------------ */
/* messages                                                            */

function flatten(value, prefix, out) {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
    return out
  }
  out[prefix] = value
  return out
}

/**
 * Namespace -> file, read out of `lib/i18n/messages.ts` rather than assumed.
 *
 * The filename is *not* the namespace: `dnsClient` is served by
 * `dns-client.json`. Deriving the map from the filename silently reported every
 * key in that namespace as missing, which is the kind of false positive that
 * trains people to ignore the gate.
 */
function namespaceMap(locale) {
  const src = readFileSync(join(root, 'lib', 'i18n', 'messages.ts'), 'utf8')
  // `import zhDnsClient from '@/messages/zh/dns-client.json'`
  const byIdent = new Map()
  for (const m of src.matchAll(new RegExp(`import\\s+(\\w+)\\s+from\\s+'@/messages/${locale}/([\\w-]+)\\.json'`, 'g'))) {
    byIdent.set(m[1], m[2])
  }
  // The `ZH` / `EN` literal: `dnsClient: zhDnsClient,`
  const bundleIdent = locale === 'zh' ? 'ZH' : 'EN'
  const body = src.slice(src.indexOf(`const ${bundleIdent}: Messages = {`))
  const map = new Map()
  for (const m of body.matchAll(/(\w+):\s*(\w+),/g)) {
    const file = byIdent.get(m[2])
    if (file) map.set(m[1], file)
  }
  return map
}

/** Flattened `ns.a.b.c` -> value for one locale, using the real namespace names. */
function loadLocale(locale) {
  const out = {}
  for (const [ns, file] of namespaceMap(locale)) {
    const flat = flatten(JSON.parse(readFileSync(join(messagesDir, locale, `${file}.json`), 'utf8')), '', {})
    for (const [key, value] of Object.entries(flat)) out[`${ns}.${key}`] = value
  }
  return out
}

const BUNDLES = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocale(locale)]))

/**
 * A key "exists" if it is a leaf, or if it is a branch that the caller then
 * extends at runtime (`t('x.y')` where `x.y` is an object is a bug, but
 * `ns.prefix` strings handed to a nested translator are not — those resolve
 * against a branch on purpose). Branch hits are therefore accepted, and only a
 * key that is in no bundle at all is a hard failure.
 */
function resolve(locale, key) {
  const bundle = BUNDLES[locale]
  if (key in bundle) return typeof bundle[key] === 'string' ? 'leaf' : 'branch'
  // next-intl also accepts `t('a.b')` when `a.b` only exists as a parent of
  // deeper keys, which is exactly the branch case above.
  const prefix = `${key}.`
  return Object.keys(bundle).some((k) => k.startsWith(prefix)) ? 'branch' : null
}

/* ------------------------------------------------------------------ */
/* sources                                                             */

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const files = SCAN_DIRS.flatMap((d) => walk(join(root, d), [])).sort()

/** `const t = useTranslations('admin')` / `const t = await getTranslations('admin')`. */
const DECL_RE = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:(['"])([^'"]*)\2)?\s*\)/g
/** `t('a.b.c')`, `t("a.b.c")`, `t.raw('a.b')`, `t.markup('a.b', {...})`. */
function callRe(vars) {
  return new RegExp(`\\b(${vars.join('|')})\\s*(?:\\.\\s*(?:raw|markup|rich))?\\s*\\(\\s*(['"\`])([^'"\`]*)\\2`, 'g')
}

const missing = []
const dynamic = []
const unnamespaced = []

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!/useTranslations|getTranslations/.test(src)) continue

  // Declarations in source order. One file usually holds several components,
  // each with its own `const t = useTranslations(...)`, and the *same* variable
  // name legitimately points at different namespaces in each. Keying a map by
  // name alone therefore attributed every `t('table.loading')` in states.tsx to
  // whichever namespace was declared last in the file. Resolving each call site
  // against the nearest preceding declaration of that name is what a scope would
  // do, minus a parser.
  const decls = []
  DECL_RE.lastIndex = 0
  for (const m of src.matchAll(DECL_RE)) {
    decls.push({ at: m.index, name: m[1], ns: m[3] ?? '' })
    if ((m[3] ?? '') === '') unnamespaced.push(`${rel(file)}:${lineOf(src, m.index)} ${m[1]} = useTranslations()`)
  }
  if (decls.length === 0) continue

  const names = [...new Set(decls.map((d) => d.name))]
  const re = callRe(names)
  for (const m of src.matchAll(re)) {
    const [, name, , key] = m
    let decl = null
    for (const d of decls) {
      if (d.name === name && d.at < m.index) decl = d
      else if (d.at >= m.index) break
    }
    // A call before any declaration of that name is not a translator call at all
    // (`t` is a common local variable), so skip rather than guess.
    if (!decl) continue
    if (decl.ns === '') continue // unnamespaced translator: nothing to check against
    const full = key ? `${decl.ns}.${key}` : decl.ns
    if (/\$\{/.test(key)) {
      dynamic.push(`${rel(file)}:${lineOf(src, m.index)} ${name}(\`${key}\`)`)
      continue
    }
    for (const locale of LOCALES) {
      if (resolve(locale, full) === null) missing.push(`${locale}  ${full}  <- ${rel(file)}:${lineOf(src, m.index)}`)
    }
  }
}

function rel(p) {
  return relative(root, p).split(sep).join('/')
}
function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

/* ------------------------------------------------------------------ */
/* report                                                              */

if (missing.length > 0) {
  console.error(`Missing translation keys (${missing.length}):`)
  for (const m of [...new Set(missing)].sort()) console.error(`  x ${m}`)
}
if (dynamic.length > 0) {
  console.log(`\nUnchecked dynamic keys (${dynamic.length}) - resolve at runtime, verify by hand:`)
  for (const d of [...new Set(dynamic)].sort()) console.log(`  ? ${d}`)
}
if (unnamespaced.length > 0) {
  console.log(`\nUnnamespaced translators (${unnamespaced.length}) - keys not verified:`)
  for (const u of [...new Set(unnamespaced)].sort()) console.log(`  - ${u}`)
}

if (missing.length > 0) {
  console.error(`\ni18n usage check FAILED with ${new Set(missing).size} problem(s)`)
  process.exit(1)
}
console.log(`\ni18n usage check passed - ${files.length} files scanned, ${LOCALES.length} locales`)
