'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Toaster.
 *
 * One instance, mounted once in the root layout, for every mutation result.
 * `richColors` maps the toast type onto the semantic tokens (success on save,
 * destructive on a failed delete) so callers never hand-pick colours, and
 * `position="top-right"` keeps toasts clear of the sidebar nav and the table
 * pagination row. `closeButton` matters here because an ops console can fire
 * several toasts in a row during a bulk apply.
 */
function Toaster({ ...props }: ToasterProps) {
  const { theme } = useTheme()
  const resolvedTheme: ToasterProps['theme'] = theme === 'dark' || theme === 'light' ? theme : 'system'

  return (
    <Sonner
      data-slot="toaster"
      theme={resolvedTheme}
      position="top-right"
      richColors
      closeButton
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast flex w-full items-start gap-3 rounded-md border border-border bg-card p-4 text-sm text-foreground shadow-raised',
          title: 'text-sm font-medium text-foreground',
          description: 'text-muted-foreground',
          actionButton: 'rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground',
          cancelButton: 'rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground',
          closeButton: 'border-border bg-card text-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
