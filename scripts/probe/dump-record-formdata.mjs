// Dev tool: dump the exact per-record-type parameter names the console sends to
// zones/records/{add,update,delete}.
//
// The three mutations look alike but differ in a way that is impossible to guess:
// `update` carries both the record's current value and its replacement, and the
// replacement parameter is named inconsistently (`newIpAddress`, but
// `naptrNewOrder`). This walks each call site back to the enclosing function and
// groups every `formData +=` by the `case "<TYPE>"` label above it.
//
//   node scripts/probe/dump-record-formdata.mjs [consoleJsDir]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? '.probe/console-js'
const src = readFileSync(join(dir, 'zone.js'), 'utf8')
const lines = src.split(/\r?\n/)

const CASE_RE = /^\s*case "([A-Z0-9]+)":/
// A `formData +=` may be split across lines, in which case the continuations are
// bare `"&key=" + ...` fragments. Both forms are harvested.
const FORM_LINE_RE = /formData\s*\+?=\s*"|^\s*"&/
const KEY_RE = /(?:^|&)([A-Za-z][A-Za-z0-9_]*)=/g

/** Line index (0-based) of the `function` that encloses `at`. */
function enclosingFunctionStart(at) {
  for (let i = at; i >= 0; i--) {
    if (/^\s*function\s+[A-Za-z0-9_]+\s*\(/.test(lines[i])) return i
  }
  return 0
}

for (const op of ['add', 'update', 'delete']) {
  const callIdx = lines.findIndex((l) => l.includes(`api/zones/records/${op}`))
  if (callIdx < 0) {
    console.log(`\n### ${op}: call site not found`)
    continue
  }
  const fnStart = enclosingFunctionStart(callIdx)
  const fnName = (lines[fnStart].match(/function\s+([A-Za-z0-9_]+)/) ?? [, '?'])[1]

  console.log(`\n### ${op}  (${fnName}, lines ${fnStart + 1}-${callIdx + 1})`)

  const perCase = new Map()
  const shared = new Set()
  let currentCase = '(base)'

  for (let i = fnStart; i <= callIdx; i++) {
    const line = lines[i]
    const cm = line.match(CASE_RE)
    if (cm) {
      currentCase = cm[1]
      continue
    }
    if (FORM_LINE_RE.test(line)) {
      for (const lit of line.matchAll(/"([^"]*)"/g)) {
        KEY_RE.lastIndex = 0
        let km
        while ((km = KEY_RE.exec(lit[1])) !== null) {
          const bucket = currentCase === '(base)' ? shared : (perCase.get(currentCase) ?? new Set())
          if (currentCase !== '(base)') perCase.set(currentCase, bucket)
          bucket.add(km[1])
        }
      }
    }
  }

  // `formData = "zone=" + ... + formData` re-states the shared keys; drop the
  // trailing `formData` token artefacts by keeping insertion order only.
  console.log(`base: ${[...shared].join(', ') || '(none)'}`)
  for (const [type, keys] of perCase) console.log(`  ${type.padEnd(8)} ${[...keys].join(', ')}`)

  const queryKeys = [...lines[callIdx].matchAll(/[?&]([A-Za-z][A-Za-z0-9_]*)=/g)].map((m) => m[1])
  console.log(`query: ${queryKeys.join(', ') || '(none)'}`)
}
