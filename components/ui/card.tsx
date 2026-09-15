import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Card.
 *
 * A surface-raised container used for every dashboard tile, settings section
 * and list panel. The `CardHeader` grid reserves a slot on the right for
 * `CardAction` via `has-data-[slot=card-action]`, so callers can drop a button
 * or badge into the header without hand-rolling flex layouts.
 */

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'relative flex flex-col gap-0 rounded-lg border border-border bg-card py-4 text-card-foreground shadow-card',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-5 pb-3 has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-base leading-none font-semibold', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />
}

/**
 * `divider` adds a top border when the footer visually separates from content
 * above (e.g. dialog-style cards). Default is off so stacked cards stay flat.
 */
function CardFooter({ className, divider = false, ...props }: React.ComponentProps<'div'> & { divider?: boolean }) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-2 px-5 pt-3', divider && 'border-t border-border', className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter }
