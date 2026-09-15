import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Brand mark: the "Resolve-Tree" glyph.
 *
 * An inverted DNS namespace tree — root ring on top, three branches below —
 * where the dot inside the root ring is the root zone "." and the single lit
 * branch is one resolution path (also reading as "the server currently
 * selected" in a multi-server console).
 *
 * Drawn with `currentColor` so it inherits `text-primary` and follows the
 * theme; unlit branches drop to 45% opacity to keep the lit-path reading
 * without introducing a second colour. Geometry is shared with
 * `app/icon.svg` and `public/logo.svg` (viewBox 0 0 64 64) — keep all three
 * in sync when the mark changes.
 */
export function BrandMark({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden className={cn('shrink-0', className)} {...props}>
      {/* unlit branches */}
      <g stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" opacity={0.45}>
        <path d="M32 24 L14 45" />
        <path d="M32 24 L32 45" />
      </g>
      <g fill="currentColor" opacity={0.45}>
        <circle cx="14" cy="50" r="5" />
        <circle cx="32" cy="50" r="5" />
      </g>
      {/* lit resolution path */}
      <path d="M32 24 L50 45" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" />
      <circle cx="50" cy="50" r="5" fill="currentColor" />
      {/* root zone: ring + root dot */}
      <circle cx="32" cy="17.5" r="6" stroke="currentColor" strokeWidth={4.5} />
      <circle cx="32" cy="17.5" r="2" fill="currentColor" />
    </svg>
  )
}
