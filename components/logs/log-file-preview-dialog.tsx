'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { ArrowDownToLine, Copy, RefreshCw } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { copyText } from '@/components/app/copy-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { apiDownloadBlob, describeError } from '@/lib/api/client'
import { useTargetKey } from '@/lib/servers/provider'
import { cn } from '@/lib/utils'

/**
 * Read-only tail of a system log file.
 *
 * `logs/download` is the *only* way to read a log file's content — Technitium has
 * no `logs/read` — so a preview is the same endpoint with `limit=N`, which makes
 * the server send the last N lines instead of the whole file. Two consequences
 * worth knowing:
 *
 *  - It goes through `apiDownloadBlob`, not `downloadLogFile`. The latter calls
 *    `saveBlob` and would pop a browser save dialog for what is meant to be a
 *    glance at the tail; `apiDownloadBlob` also skips the `kind === 'file'`
 *    registry assertion, which is exactly what a read-into-memory wants.
 *  - "Load more" cannot seek backwards. There is no offset parameter, so the
 *    only way to show more history is to re-request a larger `limit` and replace
 *    the text. `keepPreviousData` stops the pane from flashing empty while the
 *    bigger response is in flight.
 *  - **Technitium v15.4 ignores `limit` on `logs/download`** — verified against
 *    127.0.0.1:5380, where a `limit=200` response still began at
 *    "Logging started." The tail is therefore applied client-side over whatever
 *    came back (`tailLines`); the parameter is still sent so a server that does
 *    honour it shortens the transfer, in which case the slice is a no-op.
 *
 * The key is built by hand because `queryKeys` has no preview entry (see the
 * report); the `[target, 'logs', …]` prefix is kept deliberately so a
 * `domain(target, 'logs')` invalidation — fired after a delete — also drops any
 * cached tail of a file that no longer exists.
 */

/** Last `lines` lines of `text`, or `text` unchanged when it is already shorter. */
function tailLines(text: string, lines: number): string {
  const all = text.split('\n')
  return all.length <= lines ? text : all.slice(-lines).join('\n')
}

/** Tail sizes offered in the picker, in lines. */
export const PREVIEW_LINE_STEPS = [200, 500, 1000, 5000] as const

const DEFAULT_LINES = 200

/** Doubling stops here: a LAN admin API should not be asked for a 40k-line tail. */
const MAX_LINES = 20000

/**
 * Bytes decoded from the end of the file.
 *
 * Since v15.4 ignores `limit` (see the file header), previewing the daily log
 * downloads all of it — 2.5 MB on the server this was written against. Turning
 * that into a string and splitting it on `\n` is synchronous main-thread work,
 * and it is what made the dialog feel wedged: Escape appeared to do nothing
 * while the browser chewed through the whole file. `Blob#slice` is a cheap view
 * rather than a copy, and 256 KB holds far more lines than `MAX_LINES` can
 * display, so the slice never shortens what the operator could have asked for.
 */
const TAIL_BYTES = 256 * 1024

export interface LogFilePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` keeps the dialog mounted but idle. */
  fileName: string | null
}

export function LogFilePreviewDialog({ open, onOpenChange, fileName }: LogFilePreviewDialogProps) {
  const t = useTranslations('logs')
  const tc = useTranslations('common')
  const target = useTargetKey()
  const [lines, setLines] = React.useState<number>(DEFAULT_LINES)
  const [shownFile, setShownFile] = React.useState<string | null>(fileName)
  const [wasOpen, setWasOpen] = React.useState(open)

  // Render-phase reconciliation rather than effects: an effect would fire the
  // query once with the previous tail before resetting it, doubling the request
  // against a single-threaded admin API.
  //
  // `shownFile` deliberately survives the close. The caller derives `open` from
  // the same state it hands over as `fileName`, so the flip that starts the exit
  // animation also nulls the name; without this the heading reads "Preview —"
  // over text `keepPreviousData` is still holding, which reads as a broken
  // dialog rather than a closing one.
  if (fileName !== null && fileName !== shownFile) setShownFile(fileName)
  if (open !== wasOpen) {
    setWasOpen(open)
    // A different file must start from the default tail again, otherwise
    // opening a second one inherits the 5000-line request the operator asked
    // for on the first.
    if (open) setLines(DEFAULT_LINES)
  }

  const preview = useQuery({
    queryKey: [target, 'logs', 'preview', shownFile, lines],
    queryFn: async () => {
      const { blob } = await apiDownloadBlob('logs/download', { fileName: shownFile, limit: lines })
      const clipped = blob.size > TAIL_BYTES
      const raw = await (clipped ? blob.slice(blob.size - TAIL_BYTES) : blob).text()
      if (!clipped) return raw
      // A byte offset can land mid-codepoint, and the first line of a clipped
      // tail is partial by definition, so it goes either way.
      const firstBreak = raw.indexOf('\n')
      return firstBreak === -1 ? '' : raw.slice(firstBreak + 1)
    },
    enabled: open && shownFile !== null,
    // The file is being appended to while we look at it; a cached tail would be
    // stale the moment the dialog reopens.
    staleTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  })

  const text = preview.data ?? ''
  const atMax = lines >= MAX_LINES
  // The server-side `limit` is advisory at best (see the file header), so the
  // tail the operator actually reads is cut here.
  const shown = React.useMemo(() => tailLines(text, lines), [text, lines])
  const shownLines = React.useMemo(
    () => (shown ? shown.split('\n').filter((line) => line.length > 0).length : 0),
    [shown],
  )

  const onCopy = async () => {
    const ok = await copyText(shown)
    if (ok) toast.success(tc('toast.copied'))
    else toast.error(tc('toast.failed'))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* flex-col (evicting the base grid) so max-h caps the card and the log
          pane's flex-1 overflow-auto scrolls inside it instead of spilling. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {t('system.previewTitle', { file: shownFile ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('system.previewHint', { lines })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <Field className="w-40">
            <FieldLabel htmlFor="log-preview-lines">{t('system.previewLines')}</FieldLabel>
            <Select
              value={String(lines)}
              onValueChange={(next) => {
                const parsed = Number(next)
                if (Number.isFinite(parsed) && parsed > 0) setLines(parsed)
              }}
            >
              <SelectTrigger id="log-preview-lines" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREVIEW_LINE_STEPS.map((step) => (
                  <SelectItem key={step} value={String(step)}>
                    {step}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines((prev) => Math.min(prev * 2, MAX_LINES))}
            disabled={atMax || preview.isPending}
          >
            <ArrowDownToLine className="size-3.5" aria-hidden />
            {t('system.loadMore')}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void preview.refetch()}
            loading={preview.isFetching}
            disabled={shownFile === null}
          >
            {!preview.isFetching && <RefreshCw className="size-3.5" aria-hidden />}
            {tc('actions.refresh')}
          </Button>

          <span className="text-muted-foreground ml-auto text-xs">
            {t('system.previewShown', { count: shownLines })}
          </span>
        </div>

        {preview.isError ? (
          <div className="border-destructive/25 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
            {describeError(preview.error).message}
          </div>
        ) : (
          <div className="border-border/60 bg-muted/40 relative min-h-40 flex-1 overflow-auto rounded-md border">
            {preview.isPending ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-xs">
                <Spinner className="size-3.5" />
                <span className="sr-only">{tc('table.loading')}</span>
              </div>
            ) : shown.trim() ? (
              <pre
                className={cn(
                  'font-data p-3 text-xs leading-relaxed whitespace-pre-wrap',
                  preview.isFetching && 'opacity-60',
                )}
              >
                {shown}
              </pre>
            ) : (
              <p className="text-muted-foreground py-10 text-center text-xs">{t('system.previewEmpty')}</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" onClick={() => void onCopy()} disabled={!shown}>
            <Copy className="size-3.5" aria-hidden />
            {t('system.copyAll')}
          </Button>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              {tc('actions.close')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
