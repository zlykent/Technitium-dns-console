// Dev tool: verify that every lucide-react icon name used in this codebase
// actually exists in the installed version, so a renamed icon fails here rather
// than rendering `undefined` at runtime.
//
//   node scripts/check-icons.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dts = readFileSync(join(root, 'node_modules', 'lucide-react', 'dist', 'lucide-react.d.ts'), 'utf8')

const declared = new Set()
for (const m of dts.matchAll(/declare const ([A-Z][A-Za-z0-9]*):/g)) declared.add(m[1])
// aliases are re-exported under deprecated names too
for (const m of dts.matchAll(/declare const ([A-Z][A-Za-z0-9]*) as ([A-Z][A-Za-z0-9]*);/g)) declared.add(m[2])

function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.probe') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) collect(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const files = collect(join(root, 'app'), []).concat(collect(join(root, 'components'), []), collect(join(root, 'lib'), []))

let problems = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)
  if (!importMatch) continue
  for (const clause of importMatch) {
    const inner = clause.slice(clause.indexOf('{') + 1, clause.lastIndexOf('}'))
    for (const raw of inner.split(',')) {
      const trimmed = raw.trim()
      // `import { type LucideIcon }` is a type-only entry, not an icon component.
      if (trimmed.startsWith('type ')) continue
      const name = trimmed.split(/\s+as\s+/)[0].trim()
      if (!name || name.startsWith('//')) continue
      if (!declared.has(name)) {
        console.error(`✗ ${file.replace(root + '\\', '')}: lucide icon "${name}" does not exist`)
        problems++
      }
    }
  }
}

if (problems > 0) {
  console.error(`\nicon check FAILED with ${problems} problem(s)`)
  process.exit(1)
}
console.log(`icon check passed across ${files.length} files (${declared.size} icons available)`)
