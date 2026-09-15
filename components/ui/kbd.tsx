import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Kbd.
 *
 * Styled `<kbd>` for keyboard shortcut hints in menus, tooltips and help text.
 * Uses a muted border + background to visually separate from surrounding copy.
 */

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
