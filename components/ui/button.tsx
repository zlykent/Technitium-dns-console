'use client'

import { Slot } from '@radix-ui/react-slot'
import { LoaderCircle } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'
import { buttonVariants, type ButtonVariants } from '@/components/ui/button-variants'

/**
 * Button.
 *
 * `asChild` delegates to a `next/link` so navigation and actions look
 * identical. The `loading` variant keeps the button's width stable by swapping
 * the icon for a spinner rather than reflowing the label.
 *
 * The class variants live in `button-variants.ts` — a module without
 * `'use client'` — so Server Components can call `buttonVariants()` too. See
 * the note there for the exact build error that motivated the split.
 */
export interface ButtonProps extends React.ComponentProps<'button'>, ButtonVariants {
  asChild?: boolean
  /** Renders a spinner and disables interaction without unmounting the label. */
  loading?: boolean
}

function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      data-loading={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
