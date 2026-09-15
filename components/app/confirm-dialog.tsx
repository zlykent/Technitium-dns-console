'use client'

import { useTranslations } from 'next-intl'
import * as React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { ErrorState } from '@/components/app/states'

/**
 * Confirmation for destructive actions.
 *
 * The convention (`docs/ui-conventions.md`) is that delete / flush / uninstall /
 * revoke / restore always pass through a confirm dialog, never a bare click.
 * Two details matter for an ops console:
 *
 *  - `requireText` — the operator must type the resource name before the
 *    confirm button arms. Bulk zone deletion and config restore use it.
 *  - the dialog stays open while the mutation is pending and surfaces the
 *    upstream error inline, so a failed delete does not look like a success.
 */

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** Label of the confirm button; defaults to `common:actions.confirm`. */
  confirmLabel?: string
  /** `destructive` styles the confirm button red. */
  tone?: 'destructive' | 'default'
  /** Value the operator must type exactly to arm the confirm button. */
  requireText?: string
  /** Async work; the dialog shows a pending state and any thrown error. */
  onConfirm?: () => void | Promise<void>
  pending?: boolean
  /** Error from the last confirm attempt. */
  error?: unknown
  children?: React.ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'destructive',
  requireText,
  onConfirm,
  pending = false,
  error,
  children,
}: ConfirmDialogProps) {
  const tc = useTranslations('common')
  const [typed, setTyped] = React.useState('')
  const [internalPending, setInternalPending] = React.useState(false)
  const [internalError, setInternalError] = React.useState<unknown>(null)

  const busy = pending || internalPending
  const shownError = error ?? internalError
  const confirmVariant = tone === 'destructive' ? 'destructive' : 'default'

  // Reset the typed confirmation whenever a new dialog is opened. Reconciled
  // during render instead of in an effect so the stale text from the previous
  // confirmation is never painted, even for a single frame.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setTyped('')
      setInternalError(null)
    }
  }

  const armed = !requireText || typed.trim() === requireText.trim()

  const run = async () => {
    if (!onConfirm || !armed || busy) return
    if (error !== undefined) {
      // caller owns the mutation + error state
      await onConfirm()
      return
    }
    setInternalError(null)
    setInternalPending(true)
    try {
      await onConfirm()
    } catch (err) {
      setInternalError(err)
      return
    } finally {
      setInternalPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title || tc('dialog.confirmTitle')}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>

        {children}

        {requireText && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-text" className="text-xs text-muted-foreground">
              {tc('dialog.typeToConfirm', { value: requireText })}
            </label>
            <input
              id="confirm-text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-data h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-invalid={!armed && typed.length > 0 ? true : undefined}
            />
          </div>
        )}

        {shownError ? <ErrorState error={shownError} compact /> : null}

        <AlertDialogFooter>
          <AlertDialogCancel asChild disabled={busy}>
            <Button variant="outline">{tc('actions.cancel')}</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild disabled={!armed || busy}>
            <Button
              variant={confirmVariant}
              // `AlertDialogAction` uses `asChild`, so it injects its own *default*
              // `buttonVariants()` classes into this Button. Button resolves
              // `cn(buttonVariants({ variant }), className)` with tailwind-merge,
              // which lets the injected default (bg-primary) win over the tone.
              // Re-applying the tone as an explicit className places it last in the
              // merge so a destructive confirm actually renders red.
              className={buttonVariants({ variant: confirmVariant })}
              loading={busy}
              onClick={() => void run()}
            >
              {confirmLabel ?? tc('actions.confirm')}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Imperative-ish helper: keeps the open state and the pending/error plumbing
 * next to the mutation so page code stays a one-liner.
 */
export function useConfirmAction(run: () => Promise<void>) {
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  const confirm = React.useCallback(async () => {
    setPending(true)
    setError(null)
    try {
      await run()
      setOpen(false)
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }, [run])

  return { open, setOpen, pending, error, confirm }
}
