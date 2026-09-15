import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Input.
 *
 * A single-line text control with the shared focus ring and aria-invalid
 * treatment used across every form in the console. `InputGroup` + `InputAddon`
 * compose prefix/suffix decorations (protocol badges, unit labels) without
 * breaking the native input's layout or a11y contract.
 */

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/30',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Wraps an `Input` with optional leading/trailing addons. Uses CSS grid so
 * addons sit inside the same visual border as the input.
 */
function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      className={cn('relative flex w-full items-stretch', className)}
      {...props}
    />
  )
}

function InputAddon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="input-addon"
      className={cn(
        'inline-flex items-center border border-input bg-muted px-3 text-sm text-muted-foreground first:rounded-l-md first:border-r-0 last:rounded-r-md last:border-l-0',
        className,
      )}
      {...props}
    />
  )
}

export { Input, InputGroup, InputAddon }
