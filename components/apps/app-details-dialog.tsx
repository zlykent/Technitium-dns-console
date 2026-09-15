'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Boxes, ScrollText } from 'lucide-react'
import { CopyButton } from '@/components/app/copy-button'
import { EmptyState } from '@/components/app/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { InstalledApp } from '@/lib/api/types/apps'

/**
 * Read-only inspector for the DNS apps an installed package registers.
 *
 * A single Technitium app package (`InstalledApp`) can register *several* DNS
 * apps (`dnsApps: DnsAppEntry[]`), each with its own `classPath`. That
 * `classPath` is the fully-qualified type name `logs/query` filters on, and the
 * `isQueryLogs` flag is what unlocks the Logs ▸ Query tab — so this dialog is
 * where an operator copies a class path or jumps into the logs for a logging app.
 *
 * Purely presentational: no mutation, no query. It receives the already-loaded
 * `InstalledApp` and renders. The scroll body is a plain `overflow-y-auto` div
 * (not `ScrollArea`, whose `size-full` viewport will not converge inside a
 * `max-h` flex dialog — the same trap `app-config-dialog.tsx` documents).
 */

export interface AppDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` keeps the dialog mounted but idle. */
  app: InstalledApp | null
}

export function AppDetailsDialog({ open, onOpenChange, app }: AppDetailsDialogProps) {
  const t = useTranslations('apps')
  const tc = useTranslations('common')
  const dnsApps = app?.dnsApps ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('dnsApps.title')}</DialogTitle>
          <DialogDescription>
            {app ? `${app.name} · v${app.version}` : t('dnsApps.hint')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="mb-3 text-xs text-muted-foreground text-pretty">{t('dnsApps.hint')}</p>

          {dnsApps.length === 0 ? (
            <EmptyState title={t('dnsApps.empty')} icon={Boxes} className="py-8" />
          ) : (
            <ul className="flex flex-col gap-2">
              {dnsApps.map((entry) => (
                <li key={entry.classPath} className="surface rounded-md p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="sr-only">{t('dnsApps.name')}: </span>
                      <span className="text-sm font-medium">{entry.name}</span>
                    </div>
                    {entry.isQueryLogs && (
                      <Badge variant="info">
                        <ScrollText aria-hidden />
                        {t('dnsApps.queryLogsBadge')}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="sr-only">{t('dnsApps.classPath')}: </span>
                    <code className="font-data min-w-0 flex-1 truncate text-xs text-muted-foreground" title={entry.classPath}>
                      {entry.classPath}
                    </code>
                    <CopyButton value={entry.classPath} label={tc('toast.copied')} />
                  </div>

                  {entry.isQueryLogs && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
                      <span className="text-xs text-muted-foreground">{t('dnsApps.isQueryLogs')}</span>
                      <Button asChild size="xs" variant="outline" className="ml-auto">
                        <Link href="/logs">
                          <ScrollText className="size-3.5" aria-hidden />
                          {t('dnsApps.useInLogs')}
                        </Link>
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tc('actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
