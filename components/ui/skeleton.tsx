import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton.
 *
 * Content-area loading placeholder. The convention in this project is to use
 * Skeleton (not Spinner) for any region that will be filled with data, because
 * it avoids layout shift and signals "something is coming here" rather than
 * "the whole page is busy".
 */

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

export interface SkeletonTextProps extends React.ComponentProps<'div'> {
  /** Number of placeholder lines to render. */
  lines?: number
}

/**
 * Convenience helper that renders `lines` skeleton bars with decreasing width
 * on the last line, mimicking a paragraph.
 */
function SkeletonText({ className, lines = 3, ...props }: SkeletonTextProps) {
  return (
    <div data-slot="skeleton-text" className={cn('flex flex-col gap-2', className)} {...props}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 && 'w-3/4')} />
      ))}
    </div>
  )
}

export { Skeleton, SkeletonText }
