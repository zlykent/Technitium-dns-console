import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Spinner.
 *
 * Inline loading indicator for actions and small async states. For full
 * content regions use `Skeleton` instead — the spinner is meant for buttons,
 * icon slots and compact "please wait" blocks.
 */

const spinnerVariants = cva('animate-spin text-muted-foreground', {
  variants: {
    size: {
      sm: 'size-3.5',
      default: 'size-4',
      lg: 'size-5',
    },
  },
  defaultVariants: { size: 'default' },
})

export interface SpinnerProps extends React.ComponentProps<'svg'>, VariantProps<typeof spinnerVariants> {}

function Spinner({ className, size, ...props }: SpinnerProps) {
  return (
    <LoaderCircle
      data-slot="spinner"
      aria-hidden
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    />
  )
}

export interface LoadingBlockProps extends React.ComponentProps<'div'> {
  /** Optional text displayed next to the spinner. */
  label?: string
}

/**
 * Centred spinner + label for async content blocks that haven't loaded yet.
 */
function LoadingBlock({ className, label, ...props }: LoadingBlockProps) {
  return (
    <div
      data-slot="loading-block"
      role="status"
      className={cn('flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground', className)}
      {...props}
    >
      <Spinner />
      {label && <span>{label}</span>}
    </div>
  )
}

export { Spinner, spinnerVariants, LoadingBlock }
