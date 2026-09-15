'use client'

import { CircleAlert } from 'lucide-react'
import * as React from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Field.
 *
 * The universal form-field wrapper. Every settings row, dialog input and filter
 * bar composes Field → FieldLabel → control → FieldError/FieldDescription so
 * spacing, labelling and a11y wiring stay consistent without each page
 * re-inventing the same flex column.
 */

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field"
      className={cn('flex flex-col gap-1.5', className)}
      {...props}
    />
  )
}

export interface FieldLabelProps extends React.ComponentProps<typeof Label> {
  /** A short muted hint rendered after the label text. */
  hint?: string
  /** Renders a red asterisk and `aria-required`. */
  required?: boolean
}

function FieldLabel({ className, hint, required = false, children, ...props }: FieldLabelProps) {
  return (
    <Label
      data-slot="field-label"
      aria-required={required || undefined}
      className={cn('flex items-center gap-1', className)}
      {...props}
    >
      {children}
      {required && <span aria-hidden className="text-destructive">*</span>}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </Label>
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export interface FieldErrorProps extends React.ComponentProps<'p'> {
  /** Must match the id passed to `aria-describedby` on the control. */
  id?: string
}

/**
 * Renders nothing when no message is provided so callers can always mount it
 * (keeping layout stable) and pass the error string only when validation fails.
 */
function FieldError({ className, id, children, ...props }: FieldErrorProps) {
  if (!children) return null
  return (
    <p
      id={id}
      data-slot="field-error"
      role="alert"
      className={cn('flex items-start gap-1.5 text-sm text-destructive', className)}
      {...props}
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  )
}

/**
 * Horizontal settings row: label + description on the left, control on the
 * right. Used on every settings page so the toggle/select always aligns to the
 * trailing edge regardless of label length.
 */
function FieldRow({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-row"
      className={cn('flex items-start justify-between gap-4 py-2', className)}
      {...props}
    />
  )
}

export { Field, FieldLabel, FieldDescription, FieldError, FieldRow }
