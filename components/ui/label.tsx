'use client'

import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Label.
 *
 * Radix Label wires `htmlFor` → click-to-focus and announces the association to
 * screen readers. `peer-disabled:opacity-50` dims the label when its sibling
 * control is disabled, matching the visual state of the input.
 */

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
