'use client'

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Checkbox.
 *
 * Row selection in every data table plus multi-value form fields. The
 * indeterminate state is first-class (not just a checked variant) because the
 * select-all header cell has to show "some rows selected" — Radix exposes it as
 * `checked="indeterminate"`, and we swap the glyph to `Minus` so the state is
 * legible without colour alone.
 */

function Checkbox({ className, checked, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // `relative`: Radix mounts a hidden absolutely-positioned form input
        // inside the root; without a positioned ancestor it escapes to the
        // document and stretches the page scroll area.
        'relative peer size-4 shrink-0 cursor-pointer rounded-sm border border-input shadow-xs transition-shadow outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      checked={checked}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {checked === 'indeterminate' ? <Minus className="size-3.5" /> : <Check className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
