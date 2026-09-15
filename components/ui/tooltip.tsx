'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Tooltip.
 *
 * Icon-only controls (`icon-sm` / `icon-xs` buttons in table rows and the
 * topbar) carry no visible label, so every one of them is wrapped in a tooltip.
 * `delayDuration` is 200ms rather than Radix's default 700ms: this is an ops
 * console where the pointer crosses dense rows constantly, and a slower delay
 * makes the labels feel broken — but instant tooltips strobe while sweeping the
 * table, hence not 0 either.
 */

function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // Radix Tooltip reports `delayed-open` / `instant-open` / `closed` — never
          // plain `open` — so the enter animation has to be unconditional (it only
          // runs while the content is mounted) while the exit stays state-driven.
          'z-50 w-fit max-w-xs origin-[var(--radix-tooltip-content-transform-origin)] animate-in fade-in-0 zoom-in-95 rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-balance text-popover-foreground shadow-raised data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow
          data-slot="tooltip-arrow"
          className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-xs bg-popover fill-popover"
        />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
