'use client'

import { useTranslations } from 'next-intl'
import { ChevronRight, FileText } from 'lucide-react'
import * as React from 'react'
import { CopyButton } from '@/components/app/copy-button'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/**
 * Raw DNS message inspector.
 *
 * `dnsClient/resolve` returns `rawResponses[]` — one entry per hop the server
 * consulted while recursing (empty for a single-hop query, which is why the
 * probe fixtures show `[]`). This is the field-by-field ground truth an operator
 * falls back to when the parsed tables look wrong, so it is rendered verbatim in
 * a monospace `<pre>` and never re-flowed.
 *
 * It is collapsed by default: raw messages are verbose and would push the parsed
 * answer off-screen. The prop is typed `readonly unknown[]` even though the SDK
 * declares `string[]`, because the stock console `JSON.stringify`s each element
 * (`dnsclient.js` line 186) — the upstream has historically emitted objects here
 * too, and a defensive stringify costs nothing.
 */

export interface RawResponseViewerProps {
  rawResponses: readonly unknown[]
  className?: string
}

/** Print a raw segment: strings verbatim, anything else pretty-printed JSON. */
function renderRaw(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function RawResponseViewer({ rawResponses, className }: RawResponseViewerProps) {
  const t = useTranslations('dnsClient')
  const [open, setOpen] = React.useState(false)

  const segments = React.useMemo(() => rawResponses.map((entry) => renderRaw(entry)), [rawResponses])

  if (segments.length === 0) {
    return (
      <div className={cn('surface flex items-center gap-2 rounded-lg px-4 py-3 text-xs text-muted-foreground', className)}>
        <FileText className="size-4" aria-hidden />
        {t('result.raw.empty')}
      </div>
    )
  }

  const allText = segments.join('\n\n')

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('surface rounded-lg', className)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start gap-2 px-1 text-muted-foreground">
            <ChevronRight className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
            <span className="truncate text-sm font-medium text-foreground">{t('result.raw.title')}</span>
            <span className="font-data truncate text-xs">{t('result.raw.multiple', { count: segments.length })}</span>
          </Button>
        </CollapsibleTrigger>
        <CopyButton value={allText} label={t('result.raw.copied')} variant="outline" size="icon-xs" />
      </div>

      <CollapsibleContent className="border-t border-border/60">
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t('result.raw.hint')}</p>
        <div className="flex flex-col gap-3 p-4">
          {segments.map((segment, index) => (
            <figure key={index} className="min-w-0 rounded-md border border-border/60 bg-muted/40">
              <figcaption className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
                <span className="font-data text-xs text-muted-foreground">#{index + 1}</span>
                <CopyButton value={segment} label={t('result.raw.copied')} size="icon-xs" />
              </figcaption>
              <pre className="font-data px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                {segment}
              </pre>
            </figure>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
