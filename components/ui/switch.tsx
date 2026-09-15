'use client'

import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Switch.
 *
 * Immediate-effect boolean settings (recursion, DNSSEC validation, query
 * logging, per-record enabled flags). Sized `h-5 w-9` rather than the usual
 * `h-6` so it sits on the same optical baseline as `h-8`/`h-9` controls in a
 * dense settings grid; Radix supplies `role="switch"` + `aria-checked`.
 */

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        // `relative`: Radix mounts a hidden absolutely-positioned form input
        // inside the root; without a positioned ancestor it escapes to the
        // document and stretches the page scroll area.
        'relative peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
