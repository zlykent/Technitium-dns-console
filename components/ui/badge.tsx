import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-colors [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/12 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive/12 text-destructive',
        success: 'border-transparent bg-success/14 text-success',
        warning: 'border-transparent bg-warning/16 text-warning',
        info: 'border-transparent bg-info/12 text-info',
        outline: 'border-border text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        solid: 'border-transparent bg-primary text-primary-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

/**
 * Status dot + label. Used for zone DNSSEC state, cluster node state, session
 * liveness — anywhere a colour has to carry meaning at a glance.
 */
const dotVariants = cva('status-dot', {
  variants: {
    tone: {
      neutral: 'bg-muted-foreground text-muted-foreground',
      success: 'bg-success text-success',
      warning: 'bg-warning text-warning',
      danger: 'bg-destructive text-destructive',
      info: 'bg-info text-info',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export interface StatusDotProps extends React.ComponentProps<'span'>, VariantProps<typeof dotVariants> {
  /** Animate a soft pulse for "live" states. */
  pulse?: boolean
}

function StatusDot({ className, tone, pulse = false, ...props }: StatusDotProps) {
  return <span data-slot="status-dot" className={cn(dotVariants({ tone }), pulse && 'animate-pulse', className)} {...props} />
}

export { Badge, badgeVariants, StatusDot, dotVariants }
