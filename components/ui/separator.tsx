'use client'

import * as SeparatorPrimitive from '@radix-ui/react-separator'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Separator.
 *
 * Radix Separator renders a semantic `<hr>` (horizontal) or `role="separator"`
 * div (vertical) and handles `aria-orientation`, so screen readers announce the
 * boundary between toolbar sections, sidebar groups and form groups.
 */

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}

export { Separator }
