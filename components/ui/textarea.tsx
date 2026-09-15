import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Textarea.
 *
 * Multi-line variant of Input with the same focus ring and aria-invalid
 * treatment. `min-h-20` gives a comfortable starting height without being
 * oversized in dense forms. Callers apply `font-data` explicitly when the
 * content is technical (zone files, rData blobs, TSIG keys).
 */

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/30',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
