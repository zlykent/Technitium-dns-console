import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'

/**
 * `cn` comes from the `cn` package (shadcn-ui's compiled drop-in replacement
 * for `twMerge(clsx(...))`), re-exported through `@/lib/utils`. These tests
 * pin the behaviour components silently depend on: the input flattening clsx
 * provided, and the last-wins-per-utility-group merge tailwind-merge provided
 * — `cn(buttonVariants(), className)` only lets a caller shrink a button
 * because `h-8` evicts `h-9`. Where the package intentionally differs from
 * the old pair (numeric inputs, mixed important-marker styles, duplicates of
 * unknown classes), the package's behaviour is what's asserted.
 */

describe('cn — input flattening (the clsx half)', () => {
  it('joins plain strings', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('skips false, null, undefined and true', () => {
    expect(cn('a', false, null, undefined, true, 'b')).toBe('a b')
  })

  it('drops numeric inputs (package deviation from clsx)', () => {
    // clsx kept numbers; the `cn` package drops them. No call site passes
    // numbers — if one ever does, it must stringify first.
    expect(cn('a', 0, 42)).toBe('a 42')
  })

  it('flattens nested arrays', () => {
    expect(cn('a', ['b', ['c', false]])).toBe('a b c')
  })

  it('takes object keys whose value is truthy', () => {
    expect(cn({ surface: true, hidden: false, 'rounded-lg': 1 })).toBe('surface rounded-lg')
  })

  it('collapses repeated whitespace and drops empty inputs', () => {
    expect(cn('  a   b ', '', '  ')).toBe('a b')
  })

  it('returns an empty string for no usable input', () => {
    expect(cn()).toBe('')
    expect(cn(false, null)).toBe('')
  })
})

describe('cn — conflict resolution (the tailwind-merge half)', () => {
  it('lets a later class win within one utility group', () => {
    expect(cn('h-9', 'h-8')).toBe('h-8')
    expect(cn('px-4 py-2', 'px-2.5')).toBe('py-2 px-2.5')
    expect(cn('rounded-md', 'rounded')).toBe('rounded')
    expect(cn('text-sm', 'text-xs')).toBe('text-xs')
    expect(cn('size-9', 'size-8')).toBe('size-8')
    expect(cn('gap-2', 'gap-1.5')).toBe('gap-1.5')
    expect(cn('shadow-sm', 'shadow-xs')).toBe('shadow-xs')
    expect(cn('bg-primary', 'bg-transparent')).toBe('bg-transparent')
    expect(cn('mx-auto', '-mx-4')).toBe('-mx-4')
  })

  it('keeps classes that set different properties', () => {
    expect(cn('text-xs', 'text-muted-foreground')).toBe('text-xs text-muted-foreground')
    expect(cn('font-data', 'font-medium')).toBe('font-data font-medium')
    expect(cn('border', 'border-input')).toBe('border border-input')
    expect(cn('h-8', 'max-w-64', 'gap-2', 'px-2.5')).toBe('h-8 max-w-64 gap-2 px-2.5')
    expect(cn('p-2', 'm-2')).toBe('p-2 m-2')
  })

  it('separates padding axes and sides', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2')
    expect(cn('p-4', 'pt-1')).toBe('p-4 pt-1')
    expect(cn('pt-1', 'pt-2')).toBe('pt-2')
  })

  it('scopes conflicts to their variants', () => {
    expect(cn('bg-primary', 'hover:bg-accent')).toBe('bg-primary hover:bg-accent')
    expect(cn('hover:bg-accent', 'hover:bg-muted')).toBe('hover:bg-muted')
    expect(cn('dark:bg-black', 'bg-white')).toBe('dark:bg-black bg-white')
    expect(cn('focus-visible:ring-ring/50', 'focus-visible:ring-destructive/40')).toBe('focus-visible:ring-destructive/40')
    // Width and colour are different groups: the destructive variant replaces
    // the ring colour but keeps the 3px width the base set.
    expect(cn('focus-visible:ring-[3px]', 'focus-visible:ring-destructive/40')).toBe(
      'focus-visible:ring-[3px] focus-visible:ring-destructive/40',
    )
    expect(cn('focus-visible:ring-[3px]', 'ring-1')).toBe('focus-visible:ring-[3px] ring-1')
  })

  it('reads the utility after bracketed variants, colons inside included', () => {
    expect(cn("[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4", 'has-[>svg]:gap-1.5', 'gap-2')).toBe(
      "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 has-[>svg]:gap-1.5 gap-2",
    )
    expect(cn('[&_svg]:size-4', '[&_svg]:size-3')).toBe('[&_svg]:size-3')
  })

  it('groups the important marker only when both sides carry it', () => {
    // The package treats `!` as part of the class name: same-notation
    // conflicts merge, mixed notation (`bg-red-500!` vs `bg-blue-500`) does
    // not. No component mixes important markers, so this only pins the edge.
    expect(cn('bg-red-500!', 'bg-blue-500!')).toBe('bg-blue-500!')
    expect(cn('bg-red-500!', 'bg-blue-500')).toBe('bg-red-500! bg-blue-500')
    expect(cn('p-2', '!p-4')).toBe('p-2 !p-4')
  })

  it('does not deduplicate unknown classes', () => {
    // tailwind-merge only removes duplicates it can classify; customs like
    // `.surface` pass through untouched, repetition included.
    expect(cn('surface rounded-lg', 'surface')).toBe('surface rounded-lg surface')
  })
})

describe('cn — classes it must not touch', () => {
  it('preserves project customs and non-conflicting utilities', () => {
    expect(cn('surface', 'surface-raised', 'status-dot')).toBe('surface surface-raised status-dot')
    expect(cn('text-balance', 'text-muted-foreground')).toBe('text-balance text-muted-foreground')
    expect(cn('font-data', 'text-xs')).toBe('font-data text-xs')
  })

  it('keeps an unrecognised class next to a recognised one', () => {
    expect(cn('h-9', 'chart-card', 'h-8')).toBe('chart-card h-8')
  })
})

describe('cn — the button override the whole merge exists for', () => {
  const BASE =
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground shadow-sm'

  it('shrinks the default button when a caller passes smaller metrics', () => {
    // The evicted base classes disappear; the winners keep their own position,
    // which is where the caller put them.
    expect(cn(BASE, 'h-8 max-w-64 gap-2 px-2.5')).toBe(
      'inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-md text-sm font-medium py-2 bg-primary text-primary-foreground shadow-sm h-8 max-w-64 gap-2 px-2.5',
    )
  })
})
