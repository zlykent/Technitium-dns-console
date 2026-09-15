'use client'

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { CircleDot } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * RadioGroup.
 *
 * For mutually exclusive choices that must stay visible at once (zone type,
 * record edit mode, cluster apply scope) where a `Select` would hide the
 * alternatives. Radix provides `role="radiogroup"` plus arrow-key navigation;
 * the indicator is `CircleDot` so the filled dot reads as "selected" even when
 * the surrounding label is long.
 */

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('grid gap-3', className)} {...props} />
  )
}

function RadioGroupItem({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-4 shrink-0 cursor-pointer rounded-full border border-input text-primary shadow-xs transition-shadow outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <CircleDot className="size-3.5 text-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
