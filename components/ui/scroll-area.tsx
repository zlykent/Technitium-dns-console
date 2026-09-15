'use client'

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * ScrollArea.
 *
 * Custom scrollbars for the fixed-height panels (sidebar nav, log tail, record
 * list inside a dialog) so the chrome does not jump between the OS-themed
 * native bar and the rest of the console. The thumb colour mirrors the native
 * scrollbar styling in `globals.css` (muted-foreground at ~30%) so both look
 * like the same product.
 *
 * The Root is a flex column and the Viewport is `min-h-0 flex-1` rather than
 * Radix's stock `size-full`. That detail is load-bearing: `height: 100%`
 * resolves against the parent's *content* height, so inside a `max-h-[85dvh]`
 * flex `DialogContent` the viewport grows to the full height of its children and
 * silently overflows the footer — covering the submit button and eating real
 * mouse clicks while programmatic `.click()` still works, which makes the
 * failure look like a dead handler. `flex-1 min-h-0` bounds it in both a
 * max-height flex parent and a fixed-height one (`h-[400px]`).
 */

function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative flex flex-col overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="w-full min-h-0 flex-1 rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
    </ScrollAreaPrimitive.Root>
  )
}

const scrollBarVariants = cva('flex touch-none transition-colors select-none', {
  variants: {
    orientation: {
      vertical: 'h-full w-2.5 border-l border-l-transparent p-px',
      horizontal: 'h-2.5 flex-col border-t border-t-transparent p-px',
    },
  },
  defaultVariants: { orientation: 'vertical' },
})

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> &
  VariantProps<typeof scrollBarVariants>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(scrollBarVariants({ orientation }), className)}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/30"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar, scrollBarVariants }
